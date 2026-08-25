import type { Executor, TransactionHandle } from '../database/executor.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import type { JournalStore } from '../money/journal.js';
import { money, moneyEquals, type Money } from '../money/money.js';
import type { CommercePolicy } from './commerce-policy.js';
import type { DisputeRepository, DisputeRow } from './dispute-repository.js';
import { entitlementRevokedEvent } from './entitlement-events.js';
import type { OfferRepository } from './offer-repository.js';
import type { PaymentRow } from './payment-repository.js';
import { billingBusinessTypes } from './policy.js';
import type { RefundRepository } from './refund-repository.js';
import type { GiftRepository } from './gift-repository.js';
import { unwindEntries } from './revenue-entries.js';
import { revenueReversedEvent } from './revenue-events.js';
import {
  openDisputeStates,
  type DisputeReasonCode,
  type DisputeState,
} from './reversal-policy.js';

/**
 * What a cardholder's claim does to Velora's books and to access.
 *
 * A dispute is not a refund and is modelled as one only by systems that later
 * discover they cannot tell an operator's decision from a bank's. Velora does
 * not decide that a dispute has happened, cannot decide when it resolves, and
 * may lose it — so the only thing that creates or moves one of these records is
 * a verified provider event.
 *
 * Three rules hold whatever order events arrive in.
 *
 * **Opening withholds.** The provider has taken the money out of Velora's
 * position and is holding it pending the outcome. That is a real movement and
 * it is posted when the claim opens, not when it ends.
 *
 * **Resolution settles in one direction or the other.** Won or withdrawn puts
 * the money back; lost unwinds the sale, because the money went to the
 * cardholder and the purchase it paid for did not survive it.
 *
 * **Access is untouched while a claim is live.** Whether somebody keeps what
 * they bought during a dispute is unresolved commercial policy in
 * `docs/decisions/DECISIONS_REQUIRED.md`, and inventing either answer would be
 * inventing a commercial term. What is fail-closed is *new* commercial access:
 * the checkout path refuses a consumer with a live claim, which withdraws
 * nothing anybody already has and commits Velora to nothing further while the
 * question is open.
 */

export interface DisputeEvidence {
  readonly amount: Money;
  readonly evidenceDueAt: Date | undefined;
  /**
   * When the provider says this notice happened, which is not when it arrived.
   *
   * One instant rather than an opening and a resolution, because a provider
   * sends one instant per notice and Velora holds only what it was told. On an
   * opening it is when the claim was raised; on a resolution it is when the
   * money stopped moving; and on a resolution that arrives with no opening
   * before it, it becomes both — which is truthful, because the provider never
   * said when the claim began.
   */
  readonly occurredAt: Date;
  readonly providerReference: string;
  readonly reasonCode: DisputeReasonCode;
  readonly state: DisputeState;
}

export interface DisputeServiceDependencies {
  readonly disputes: DisputeRepository;
  readonly journal: JournalStore;
  readonly gifts?: GiftRepository;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly outbox: OutboxAppendPort;
  /** Approved commercial terms. A lost claim cannot be unwound without them. */
  readonly policy: CommercePolicy;
  /** Reversals already posted against the capture, for exact allocation. */
  readonly refunds: RefundRepository;
}

export class DisputeService {
  constructor(private readonly dependencies: DisputeServiceDependencies) {}

  /**
   * Applies one verified dispute notice to current state.
   *
   * Idempotent and order-independent by construction rather than by checking
   * what came before. The dispute is established on its provider reference, so
   * a redelivery produces no second row; the opening posting is keyed on the
   * dispute and the resolution posting on a separate business type, so each
   * posts once however many times it arrives; and the lifecycle transition
   * names the states it will move from, so a late opening cannot reopen a
   * resolved claim.
   *
   * Returns false when the notice cannot be applied at all — an amount that
   * disagrees with the capture, or a currency that is not the one the money was
   * taken in. Those are recorded as seen and left for reconciliation rather
   * than accounted for, because a dispute Velora cannot reconcile against its
   * own record is not evidence of anything.
   */
  async apply(
    executor: Executor,
    input: {
      readonly evidence: DisputeEvidence;
      readonly payment: PaymentRow;
      readonly provider: string;
    },
  ): Promise<boolean> {
    const { disputes, refunds } = this.dependencies;
    // The same capture lock every reversal takes. A lost claim allocates
    // against what refunds have already unwound, so it has to queue behind
    // them rather than read a total one of them is still writing.
    await refunds.lockPayment(executor, input.payment.id);
    const captured = money(input.payment.amountMinor, input.payment.currency);
    if (input.evidence.amount.currency !== captured.currency) return false;
    if (input.evidence.amount.amountMinor > captured.amountMinor) return false;

    const resolved = !openDisputeStates.includes(input.evidence.state);
    const established = await disputes.establish(executor, {
      amountMinor: input.evidence.amount.amountMinor,
      currency: input.evidence.amount.currency,
      evidenceDueAt: input.evidence.evidenceDueAt,
      now: this.dependencies.now(),
      openedAt: input.evidence.occurredAt,
      paymentId: input.payment.id,
      provider: input.provider,
      providerReference: input.evidence.providerReference,
      reasonCode: input.evidence.reasonCode,
      resolvedAt: resolved ? input.evidence.occurredAt : undefined,
      state: input.evidence.state,
    });
    const dispute =
      established ??
      (await disputes.findByProviderReference(executor, {
        provider: input.provider,
        providerReference: input.evidence.providerReference,
      }));
    if (dispute === undefined) return false;

    // The withholding, posted once per dispute whatever established it. A claim
    // that arrived already resolved still moved money out of the provider
    // position on its way to its outcome, and a book that skipped the first leg
    // would balance while describing a movement that did not happen.
    const withheld = money(dispute.amountMinor, dispute.currency);
    await this.postOpening(executor, { dispute, withheld });

    if (established === undefined) {
      // The claim already existed, so this notice is either a redelivery or the
      // outcome of one Velora had already opened.
      const moved = await disputes.transition(executor, {
        disputeId: dispute.id,
        ...(input.evidence.evidenceDueAt === undefined
          ? {}
          : { evidenceDueAt: input.evidence.evidenceDueAt }),
        from: [...openDisputeStates],
        now: this.dependencies.now(),
        ...(resolved ? { resolvedAt: input.evidence.occurredAt } : {}),
        to: input.evidence.state,
      });
      if (moved === undefined) return true;
    }

    if (!resolved) return true;
    await this.postResolution(executor, {
      dispute,
      occurredAt: input.evidence.occurredAt,
      payment: input.payment,
      state: input.evidence.state,
      withheld,
    });
    return true;
  }

  /** The provider took the money out of Velora's position, pending an outcome. */
  private async postOpening(
    executor: Executor,
    input: { readonly dispute: DisputeRow; readonly withheld: Money },
  ): Promise<void> {
    await this.dependencies.journal.post(executor, {
      businessReference: input.dispute.id,
      businessType: billingBusinessTypes.dispute,
      entries: [
        {
          account: disputesAccount,
          amount: input.withheld,
          direction: 'debit',
        },
        {
          account: clearingAccount,
          amount: input.withheld,
          direction: 'credit',
        },
      ],
      occurredAt: input.dispute.openedAt,
      reason: 'dispute_opened',
    });
  }

  /**
   * The money stopped moving, one way or the other.
   *
   * Won and withdrawn return it to the provider position and the sale stands.
   * Lost sends it to the cardholder, which withdraws every claim the capture
   * created in the proportion it created them — so a fully lost dispute leaves
   * the provider position, the creator's payable, the platform's share, and the
   * dispute position all back at zero, which is what a sale that did not
   * survive should look like.
   */
  private async postResolution(
    executor: Executor,
    input: {
      readonly dispute: DisputeRow;
      readonly occurredAt: Date;
      readonly payment: PaymentRow;
      readonly state: DisputeState;
      readonly withheld: Money;
    },
  ): Promise<void> {
    const { gifts, journal, offers, outbox } = this.dependencies;
    const lost = input.state === 'lost';
    const offer = await offers.findOfferForPurchase(
      executor,
      input.payment.offerId,
    );
    if (offer === undefined) return;

    const entries = lost
      ? await this.unwindFor({
          dispute: input.dispute,
          executor,
          offer,
          payment: input.payment,
        })
      : [
          {
            account: clearingAccount,
            amount: input.withheld,
            direction: 'debit' as const,
          },
        ];
    const posted = await journal.post(executor, {
      businessReference: input.dispute.id,
      businessType: billingBusinessTypes.disputeResolution,
      entries: [
        ...entries,
        {
          account: disputesAccount,
          amount: input.withheld,
          direction: 'credit',
        },
      ],
      occurredAt: input.occurredAt,
      reason: 'dispute_resolved',
    });
    if (posted.alreadyPosted || !lost) return;

    // The creator's share of what the bank took, published so the payout book
    // falls with it. Same seam a refund uses, because the two are the same
    // financial consequence arriving through different doors.
    const creatorShare = entries.find(
      (entry) => entry.account.category === 'creator_payable',
    );
    if (creatorShare !== undefined) {
      await outbox.append(executor as TransactionHandle, {
        eventName: revenueReversedEvent,
        eventVersion: 1,
        now: this.dependencies.now(),
        occurredAt: input.occurredAt,
        payload: {
          creatorId: offer.creatorId,
          creatorMinor: creatorShare.amount.amountMinor.toString(),
          currency: creatorShare.amount.currency,
          paymentId: input.payment.id,
          reason: 'dispute_lost',
          reversalId: input.dispute.id,
        },
        subjectId: input.dispute.id,
        subjectType: 'billing.dispute',
      });
    }

    if (offer.resourceType === 'gift') {
      if (gifts === undefined)
        throw new Error('Gift dispute has no gift repository');
      const totalReversed = await gifts.settledReversalTotal(
        executor,
        input.payment.id,
      );
      const full = totalReversed >= input.payment.amountMinor;
      await gifts.transitionByPayment(executor, {
        from: ['sent', 'partially_reversed'],
        now: input.occurredAt,
        paymentId: input.payment.id,
        to: full ? 'reversed' : 'partially_reversed',
      });
      return;
    }

    // A dispute lost for the whole capture is that purchase reversed, and access
    // follows the money out through the same door it came in. A partial loss
    // leaves the purchase standing, for the same reason a partial refund does:
    // withdrawing access for part of a reversal is a commercial term nobody has
    // approved.
    if (
      !moneyEquals(
        input.withheld,
        money(input.payment.amountMinor, input.payment.currency),
      )
    ) {
      return;
    }
    await outbox.append(executor as TransactionHandle, {
      ...(input.payment.correlationId === null
        ? {}
        : { correlationId: input.payment.correlationId }),
      eventName: entitlementRevokedEvent,
      eventVersion: 1,
      now: this.dependencies.now(),
      occurredAt: this.dependencies.now(),
      payload: {
        commercialReference: input.dispute.id,
        consumerId: input.payment.consumerId,
        offerId: offer.id,
        reason: 'payment_reversed',
        resourceId: offer.resourceId,
        resourceType: offer.resourceType,
      },
      subjectId: input.dispute.id,
      subjectType: 'billing.dispute',
    });
  }

  /**
   * The debit legs of a lost claim, withdrawing what the sale allocated.
   *
   * Anything the cardholder took beyond what the sale ever allocated — possible
   * when a partial refund preceded a full chargeback — lands on the platform's
   * own share rather than on the creator's payable, because charging it to the
   * creator would take back money Velora already agreed it owed them on the
   * strength of an event they had no part in.
   */
  private async unwindFor(input: {
    readonly dispute: DisputeRow;
    readonly executor: Executor;
    readonly offer: { readonly creatorId: string };
    readonly payment: PaymentRow;
  }) {
    const { policy, refunds } = this.dependencies;
    const currency = input.dispute.currency;
    const unwound = unwindEntries({
      alreadyReversed: await refunds.unwoundTotalExcluding(input.executor, {
        currency,
        // This claim has already reached `lost` by the time the resolution is
        // posted, so it has to exclude itself or it would look like the
        // reversal that exhausted the capture.
        exceptDisputeId: input.dispute.id,
        paymentId: input.payment.id,
      }),
      amount: money(input.dispute.amountMinor, currency),
      captured: money(input.payment.amountMinor, input.payment.currency),
      creatorId: input.offer.creatorId,
      policy,
    });
    if (unwound === undefined) {
      throw new Error(
        'A lost dispute cannot be allocated: no approved commercial terms',
      );
    }
    return unwound.entries;
  }
}

const clearingAccount = {
  category: 'provider_clearing',
  subjectType: 'platform',
} as const;

const disputesAccount = {
  category: 'disputes',
  subjectType: 'platform',
} as const;
