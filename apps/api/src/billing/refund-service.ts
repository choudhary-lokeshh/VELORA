import { isCurrencyCode } from '@velora/validation';

import type { Executor, TransactionHandle } from '../database/executor.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import type { JournalStore } from '../money/journal.js';
import { addMoney, compareMoney, money, moneyEquals } from '../money/money.js';
import type { CommercePolicy } from './commerce-policy.js';
import { entitlementRevokedEvent } from './entitlement-events.js';
import type { OfferRepository } from './offer-repository.js';
import type { PaymentRepository, PaymentRow } from './payment-repository.js';
import { billingBusinessTypes } from './policy.js';
import type { PaymentProviderPort } from './provider.js';
import type { RefundRepository, RefundRow } from './refund-repository.js';
import { clearingAccount, sellerOf, unwindEntries } from './revenue-entries.js';
import { revenueReversedEvent } from './revenue-events.js';
import type { RefundReasonCode } from './reversal-policy.js';
import type { GiftRepository } from './gift-repository.js';

/**
 * Reversing captured money.
 *
 * The same prepare, commit, call, record ordering checkout follows, for the
 * same reason [ADR-0021](../../../../docs/decisions/ADR-0021-monetization-money-architecture.md)
 * gives: a reversal that contacted a provider before it was durable is a
 * movement of money nobody has a record of, and no amount of retrying finds it.
 *
 * What is different is the arithmetic. A payment is bounded by a price nobody
 * else is spending; a refund is bounded by an amount that other refunds are
 * spending at the same time. That bound is taken under a lock on the capture
 * and enforced again by a database trigger, so fifty simultaneous full refunds
 * of one charge return the money once.
 *
 * There is no consumer-facing entry point to any of this, deliberately. Refund
 * eligibility — who may ask, within what window, for what proportion — is
 * unresolved commercial policy, and a self-service control would be a promise
 * nobody approved. What exists is an operator path that is itself unreachable
 * in a deployed environment, because no payment provider is approved and no
 * Platform Admin session can hold the assurance it requires.
 */

export type RefundRefusal =
  /** The same key already names a reversal for a different amount. */
  | 'idempotency_mismatch'
  /** The capture did not settle, or is not the capture the caller named. */
  | 'not_refundable'
  /** Reversing this would return more than was ever taken. */
  | 'over_refund'
  /** No approved provider, or no approved commercial terms, in this environment. */
  | 'unavailable';

export type RefundOutcome =
  | { readonly kind: 'issued'; readonly refund: RefundRow }
  | { readonly kind: 'refused'; readonly reason: RefundRefusal };

export interface RefundServiceDependencies {
  readonly journal: JournalStore;
  readonly gifts?: GiftRepository;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly outbox: OutboxAppendPort;
  readonly payments: PaymentRepository;
  readonly policy: CommercePolicy;
  readonly provider: PaymentProviderPort;
  readonly refunds: RefundRepository;
}

function refused(reason: RefundRefusal): {
  readonly kind: 'refused';
  readonly reason: RefundRefusal;
} {
  return { kind: 'refused', reason };
}

export class RefundService {
  constructor(private readonly dependencies: RefundServiceDependencies) {}

  /**
   * Issues, or resumes, one reversal.
   *
   * Everything that could refuse is decided inside the transaction that writes,
   * against the capture held under lock. A payment that settled a moment ago, a
   * refund that landed a moment ago, and a currency the policy withdrew a moment
   * ago all either win over this call or lose to it, never land in between.
   */
  async issue(input: {
    readonly actorReference: string;
    readonly amountMinor: bigint;
    readonly correlationId: string;
    readonly currency: string;
    readonly idempotencyKey: string;
    readonly paymentId: string;
    readonly reasonCode: RefundReasonCode;
  }): Promise<RefundOutcome> {
    const { provider, refunds } = this.dependencies;
    // Two environment refusals before anything is read. A platform with no
    // approved commercial terms has no approved refund terms either, and an
    // adapter that refuses every call cannot reverse anything — recording a
    // durable intention to reverse money through a provider that does not exist
    // would be worse than saying so.
    if (this.dependencies.policy.currencies().length === 0) {
      return refused('unavailable');
    }
    if (provider.provider === 'unavailable') return refused('unavailable');

    const prepared = await refunds.transaction(async (executor) =>
      this.prepare(executor, input),
    );
    if (prepared.kind === 'refused') return prepared;
    const reversal = prepared.refund;

    // Already past the provider call. A replay answers with current state.
    if (reversal.state !== 'requested') {
      return { kind: 'issued', refund: reversal };
    }

    // Claim the instruction before sending it, so fifty replays of one request
    // produce one instruction rather than fifty identical ones. The provider
    // key would have prevented a second reversal either way; this prevents the
    // fifty calls.
    const claimed = await refunds.transaction(async (executor) =>
      refunds.transition(executor, {
        from: ['requested'],
        now: this.dependencies.now(),
        refundId: reversal.id,
        to: 'provider_pending',
      }),
    );
    if (claimed === undefined) {
      const current = await refunds.findById(
        refunds.transactionless,
        reversal.id,
      );
      return { kind: 'issued', refund: current ?? reversal };
    }

    const payment = prepared.payment;
    const providerPaymentReference = payment.providerReference;
    if (providerPaymentReference === null) {
      // A settled payment always names the provider object that settled it —
      // a CHECK constraint says so — but the type does not, and a reversal sent
      // without one would be an instruction about nothing.
      const stalled = await refunds.transaction(async (executor) =>
        refunds.transition(executor, {
          from: ['provider_pending'],
          now: this.dependencies.now(),
          refundId: reversal.id,
          to: 'reconciliation_pending',
        }),
      );
      return { kind: 'issued', refund: stalled ?? claimed };
    }

    let snapshot;
    try {
      // Outside every transaction, deliberately.
      snapshot = await provider.refundPayment({
        amount: money(reversal.amountMinor, reversal.currency),
        idempotencyKey: reversal.providerIdempotencyKey,
        operationReference: reversal.id,
        providerPaymentReference,
      });
    } catch {
      // The provider may or may not have moved the money. That is not a failure
      // and it is certainly not a success: the reversal waits for
      // reconciliation to read the provider's own record, no second instruction
      // is sent under a new key, and the amount stays reserved against the
      // capture so nothing else can claim it in the meantime.
      const pending = await refunds.transaction(async (executor) =>
        refunds.transition(executor, {
          from: ['provider_pending'],
          now: this.dependencies.now(),
          refundId: reversal.id,
          to: 'reconciliation_pending',
        }),
      );
      return { kind: 'issued', refund: pending ?? claimed };
    }

    // The provider's answer is evidence, not authority: an adapter that
    // reported a different amount than the one instructed has either
    // misunderstood or been tampered with, and neither is something to account
    // for. It becomes a reconciliation case rather than a posting.
    if (
      !moneyEquals(
        snapshot.amount,
        money(reversal.amountMinor, reversal.currency),
      )
    ) {
      const mismatched = await refunds.transaction(async (executor) =>
        refunds.transition(executor, {
          from: ['provider_pending'],
          lastProviderSyncAt: this.dependencies.now(),
          now: this.dependencies.now(),
          refundId: reversal.id,
          to: 'reconciliation_pending',
        }),
      );
      return { kind: 'issued', refund: mismatched ?? claimed };
    }

    const recorded = await this.record({
      claimed,
      payment,
      providerReference: snapshot.providerReference,
      status: snapshot.status,
    });
    return { kind: 'issued', refund: recorded };
  }

  /**
   * Settles a reversal that the provider has confirmed, with its accounting.
   *
   * Public because a verified provider event confirms reversals the request
   * thread never saw the answer to, and reconciliation resolves the ones whose
   * answer was lost. All three arrive here so there is one place that posts the
   * compensating entries and one place that decides what it means for access.
   */
  async settle(
    executor: Executor,
    input: {
      readonly occurredAt: Date;
      readonly payment: PaymentRow;
      readonly providerReference: string;
      readonly refund: RefundRow;
    },
  ): Promise<RefundRow | undefined> {
    const { gifts, journal, offers, outbox, refunds } = this.dependencies;
    // The capture, before anything is read from it. Settling allocates against
    // everything already unwound, and that is a read-then-write over a sum:
    // two reversals of one charge settling at once would each see the other's
    // share missing and each debit a creator for money the other was already
    // taking back.
    await refunds.lockPayment(executor, input.payment.id);
    const settled = await refunds.transition(executor, {
      // Every non-terminal state, because a confirmation may arrive while the
      // instruction is in flight, while it is waiting to be sent, or after the
      // answer to it was lost. All three are the same fact arriving.
      from: ['requested', 'provider_pending', 'reconciliation_pending'],
      lastProviderSyncAt: this.dependencies.now(),
      now: this.dependencies.now(),
      providerReference: input.providerReference,
      refundId: input.refund.id,
      to: 'succeeded',
    });
    // Already settled. A redelivered confirmation is the normal case and must
    // not post a second set of entries or revoke access a second time.
    if (settled === undefined) return undefined;

    const offer = await offers.findOfferForPurchase(
      executor,
      input.payment.offerId,
    );
    if (offer === undefined) return settled;

    const amount = money(settled.amountMinor, settled.currency);
    // The compensating posting. Every claim the sale created is withdrawn in
    // the proportion it was created in, and the money leaves through the
    // position the provider holds it in. The capture itself is untouched: what
    // falls is the creator's payable and the platform's share, which is the
    // only reading under which a fully refunded sale leaves nobody owed
    // anything for it.
    const unwound = unwindEntries({
      alreadyReversed: await refunds.unwoundTotalExcluding(executor, {
        currency: settled.currency,
        exceptRefundId: settled.id,
        paymentId: settled.paymentId,
      }),
      amount,
      captured: money(input.payment.amountMinor, input.payment.currency),
      policy: this.dependencies.policy,
      seller: sellerOf(offer),
    });
    if (unwound === undefined) {
      throw new Error(
        'A settled refund cannot be allocated: no approved commercial terms',
      );
    }
    await journal.post(executor, {
      businessReference: settled.id,
      businessType: billingBusinessTypes.refund,
      ...(settled.correlationId === null
        ? {}
        : { correlationId: settled.correlationId }),
      entries: [
        ...unwound.entries,
        { account: clearingAccount, amount, direction: 'credit' },
      ],
      occurredAt: input.occurredAt,
      reason: 'refund_issued',
    });

    // The creator's share of what went back, published so the payout book falls
    // with it. Nothing is published when the creator's share of this reversal
    // rounds to nothing, because a fact about zero money is not a fact.
    const creatorShare = unwound.entries.find(
      (entry) => entry.account.category === 'creator_payable',
    );
    // Guarded on ownership as well as on the entry. A platform sale unwinds
    // VELORA's own revenue and produces no creator entry at all, so this is
    // belt and braces — and it is the belt that reads correctly if somebody
    // later adds a creator-shaped entry to a platform unwind.
    if (offer.creatorId !== null && creatorShare !== undefined) {
      await outbox.append(executor as TransactionHandle, {
        ...(settled.correlationId === null
          ? {}
          : { correlationId: settled.correlationId }),
        eventName: revenueReversedEvent,
        eventVersion: 1,
        now: this.dependencies.now(),
        occurredAt: input.occurredAt,
        payload: {
          creatorId: offer.creatorId,
          creatorMinor: creatorShare.amount.amountMinor.toString(),
          currency: creatorShare.amount.currency,
          paymentId: input.payment.id,
          reason: 'refund',
          reversalId: settled.id,
        },
        subjectId: settled.id,
        subjectType: 'billing.refund',
      });
    }

    // A reversal of everything that was taken is the purchase being undone, and
    // access follows the money out through the same door it came in. A partial
    // reversal is not: withdrawing access for part of a refund would be a
    // commercial policy nobody has approved, so it changes nothing.
    //
    // Money that has moved, not money that is claimed. The bound on a new
    // reversal reserves against every claim that might still settle; deciding
    // that a purchase is entirely undone counts only what actually returned,
    // because a requested reversal that the provider later refuses must not
    // have withdrawn anybody's access on its way to being refused.
    const returned = await refunds.settledTotal(executor, {
      currency: settled.currency,
      paymentId: settled.paymentId,
    });
    if (offer.resourceType === 'gift') {
      if (gifts === undefined)
        throw new Error('Gift reversal has no gift repository');
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
      return settled;
    }
    if (
      !moneyEquals(
        returned,
        money(input.payment.amountMinor, input.payment.currency),
      )
    ) {
      return settled;
    }
    await outbox.append(executor as TransactionHandle, {
      ...(input.payment.correlationId === null
        ? {}
        : { correlationId: input.payment.correlationId }),
      eventName: entitlementRevokedEvent,
      eventVersion: 1,
      now: this.dependencies.now(),
      occurredAt: input.occurredAt,
      payload: {
        commercialReference: settled.id,
        consumerId: input.payment.consumerId,
        offerId: offer.id,
        reason: 'payment_reversed',
        resourceId: offer.resourceId,
        resourceType: offer.resourceType,
      },
      subjectId: settled.id,
      subjectType: 'billing.refund',
    });
    return settled;
  }

  /** Every reversal against one capture, for an operator's view of a charge. */
  async listForPayment(paymentId: string): Promise<readonly RefundRow[]> {
    const { refunds } = this.dependencies;
    return refunds.listForPayment(refunds.transactionless, paymentId);
  }

  /**
   * The transactional half: the capture under lock, the bound, and the row.
   *
   * The lock is the whole design. Everything this method reads about how much
   * has already been claimed is read after it, so two callers cannot both see
   * room that only one of them can have.
   */
  private async prepare(
    executor: Executor,
    input: {
      readonly actorReference: string;
      readonly amountMinor: bigint;
      readonly correlationId: string;
      readonly currency: string;
      readonly idempotencyKey: string;
      readonly paymentId: string;
      readonly reasonCode: RefundReasonCode;
    },
  ): Promise<
    | { readonly kind: 'refused'; readonly reason: RefundRefusal }
    | {
        readonly kind: 'prepared';
        readonly payment: PaymentRow;
        readonly refund: RefundRow;
      }
  > {
    const { policy, provider, refunds } = this.dependencies;
    const payment = await refunds.lockPayment(executor, input.paymentId);
    if (payment === undefined) return refused('not_refundable');
    // Only settled money can be returned. Reversing anything else would be a
    // claim about a movement that never happened.
    if (payment.state !== 'succeeded') return refused('not_refundable');
    // Cross-currency is refused here for the message and by a composite foreign
    // key for the guarantee. A EUR reversal of a USD charge would balance
    // perfectly inside its own transaction and mean nothing.
    if (payment.currency !== input.currency) return refused('not_refundable');
    if (
      !isCurrencyCode(payment.currency) ||
      policy.boundsFor(payment.currency) === undefined
    ) {
      return refused('unavailable');
    }

    const existing = await refunds.findByIdempotency(executor, {
      idempotencyKey: input.idempotencyKey,
      paymentId: input.paymentId,
    });
    if (existing !== undefined) {
      // The same key against a different amount is not a replay; it is a
      // different instruction wearing a used key, and answering it with the old
      // reversal would return the wrong amount.
      if (existing.amountMinor !== input.amountMinor) {
        return refused('idempotency_mismatch');
      }
      return { kind: 'prepared', payment, refund: existing };
    }

    const requested = money(input.amountMinor, payment.currency);
    const outstanding = await refunds.outstandingTotal(executor, {
      currency: payment.currency,
      paymentId: payment.id,
    });
    const captured = money(payment.amountMinor, payment.currency);
    if (compareMoney(addMoney(outstanding, requested), captured) > 0) {
      return refused('over_refund');
    }

    const inserted = await refunds.insertRefund(executor, {
      amountMinor: input.amountMinor,
      correlationId: input.correlationId,
      currency: payment.currency,
      idempotencyKey: input.idempotencyKey,
      initiatedBy: input.actorReference,
      now: this.dependencies.now(),
      paymentId: payment.id,
      provider: provider.provider,
      // Derived from the reversal's own identity rather than random, so a retry
      // sends the key the first attempt sent even if this process never learned
      // what happened to it.
      providerIdempotencyKey:
        `velora-refund-${payment.id}-${input.idempotencyKey}`.slice(0, 200),
      reasonCode: input.reasonCode,
    });
    if (inserted === undefined) {
      // Another request under the same key won between the read and the insert.
      const winner = await refunds.findByIdempotency(executor, {
        idempotencyKey: input.idempotencyKey,
        paymentId: input.paymentId,
      });
      if (winner === undefined) return refused('not_refundable');
      if (winner.amountMinor !== input.amountMinor) {
        return refused('idempotency_mismatch');
      }
      return { kind: 'prepared', payment, refund: winner };
    }
    return { kind: 'prepared', payment, refund: inserted };
  }

  /** Records what the provider said, with the accounting a success implies. */
  private async record(input: {
    readonly claimed: RefundRow;
    readonly payment: PaymentRow;
    readonly providerReference: string;
    readonly status: 'failed' | 'pending' | 'succeeded';
  }): Promise<RefundRow> {
    const { refunds } = this.dependencies;
    if (input.status === 'succeeded') {
      const settled = await refunds.transaction(async (executor) =>
        this.settle(executor, {
          occurredAt: this.dependencies.now(),
          payment: input.payment,
          providerReference: input.providerReference,
          refund: input.claimed,
        }),
      );
      return settled ?? input.claimed;
    }
    const moved = await refunds.transaction(async (executor) =>
      refunds.transition(executor, {
        ...(input.status === 'failed'
          ? { failureReason: 'declined' as const }
          : {}),
        from: ['provider_pending'],
        lastProviderSyncAt: this.dependencies.now(),
        now: this.dependencies.now(),
        // A provider reference is recorded even for a refusal, so reconciliation
        // can ask the provider about the object it created rather than guessing.
        providerReference: input.providerReference,
        refundId: input.claimed.id,
        to: input.status === 'failed' ? 'failed' : 'provider_pending',
      }),
    );
    return moved ?? input.claimed;
  }
}
