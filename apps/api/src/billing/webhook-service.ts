import { createHash } from 'node:crypto';

import type { SafeLogger } from '@velora/observability/server';

import type { TransactionHandle } from '../database/executor.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import { money } from '../money/money.js';
import type { JournalStore } from '../money/journal.js';
import {
  entitlementGrantedEvent,
  entitlementRevokedEvent,
} from './entitlement-events.js';
import type {
  ProviderEventRepository,
  ProviderEventRow,
} from './event-repository.js';
import type { CommercePolicy } from './commerce-policy.js';
import type { DisputeRepository } from './dispute-repository.js';
import type { DisputeEvidence, DisputeService } from './dispute-service.js';
import type { OfferRepository } from './offer-repository.js';
import type { PaymentRepository, PaymentRow } from './payment-repository.js';
import { billingBusinessTypes } from './policy.js';
import type { PaymentProviderPort } from './provider.js';
import type { RefundRepository } from './refund-repository.js';
import { captureEntries } from './revenue-entries.js';
import type { RefundService } from './refund-service.js';
import {
  disputeReasonCodes,
  disputeStates,
  type DisputeReasonCode,
  type DisputeState,
} from './reversal-policy.js';
import type { SubscriptionRepository } from './subscription-repository.js';
import {
  maximumProviderEventAttempts,
  maximumWebhookBodyBytes,
} from './subscription-policy.js';

/**
 * Turning authenticated external facts into deterministic internal state.
 *
 * Two halves that never run together. Intake verifies a signature over the
 * exact bytes that arrived, persists a receipt, and answers — nothing about the
 * business is decided on the request thread, because a provider retries an
 * endpoint that is slow and a slow endpoint is how duplicates multiply.
 * Processing drains the receipts under a lease, applies each one to current
 * state, and settles the row.
 *
 * Everything in between assumes the worst about delivery, because
 * `docs/security/05-payments-webhooks.md` says to: events are duplicated,
 * delayed, reordered, replayed, and occasionally absent until reconciliation
 * finds them. The design that survives all five is the same one — verify, store
 * by provider event identity, and re-evaluate current state rather than
 * assuming what came before.
 */

export type WebhookIntakeOutcome =
  | { readonly kind: 'accepted'; readonly duplicate: boolean }
  | { readonly kind: 'rejected'; readonly reason: 'oversized' | 'unverified' }
  | { readonly kind: 'unavailable' };

export interface WebhookProcessReport {
  readonly claimed: number;
  readonly deadLettered: number;
  readonly ignored: number;
  readonly processed: number;
  readonly retried: number;
}

export interface WebhookServiceDependencies {
  readonly disputeService: DisputeService;
  readonly disputes: DisputeRepository;
  readonly events: ProviderEventRepository;
  readonly journal: JournalStore;
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly outbox: OutboxAppendPort;
  readonly owner: string;
  readonly payments: PaymentRepository;
  /** Approved commercial terms. A capture cannot be split without them. */
  readonly policy: CommercePolicy;
  readonly provider: PaymentProviderPort;
  readonly refundService: RefundService;
  readonly refunds: RefundRepository;
  readonly subscriptions: SubscriptionRepository;
}

/**
 * Whether a verified event's money agrees with the record it names.
 *
 * An event that carries no amount is not a disagreement — several event types
 * legitimately have none — so absence passes. What fails is a stated amount or
 * currency that is not the one Velora already holds, which is either a provider
 * misunderstanding or a tampered payload, and neither is something to account
 * for.
 */
function agreesWithRecord(
  event: ProviderEventRow,
  record: { readonly amountMinor: bigint; readonly currency: string },
): boolean {
  if (event.amountMinor === null || event.currency === null) return true;
  return (
    event.amountMinor === record.amountMinor &&
    event.currency === record.currency
  );
}

/**
 * The dispute a verified receipt describes, or nothing.
 *
 * Every field is required together. A dispute notice missing its amount, its
 * reason, or its own reference is not a partial dispute to be filled in later;
 * it is a receipt Velora cannot account for, and it is recorded as seen rather
 * than acted on.
 */
function disputeEvidenceOf(
  event: ProviderEventRow,
): DisputeEvidence | undefined {
  const reference = event.providerDisputeReference;
  const reason = event.reasonCode;
  const status = event.status;
  if (reference === null || reason === null || status === null)
    return undefined;
  if (event.amountMinor === null || event.currency === null) return undefined;
  if (!(disputeReasonCodes as readonly string[]).includes(reason)) {
    return undefined;
  }
  if (!(disputeStates as readonly string[]).includes(status)) return undefined;
  return {
    amount: money(event.amountMinor, event.currency),
    evidenceDueAt: event.evidenceDueAt ?? undefined,
    occurredAt: event.occurredAt,
    providerReference: reference,
    reasonCode: reason as DisputeReasonCode,
    state: status as DisputeState,
  };
}

/** How long one worker may hold a claimed event before another may take it. */
const leaseMilliseconds = 60_000;
const batchSize = 50;

/** Deterministic capped backoff, matching the outbox relay's schedule. */
function backoffMilliseconds(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts) * 1_000, 300_000);
}

/**
 * Adds one billing interval to an instant.
 *
 * Arithmetic rather than policy: which cadences are permitted is approved
 * commercial policy, and this only computes where the paid period ends once one
 * has been chosen. `setUTCMonth` handles the short-month case the way a
 * subscription should — the 31st of January plus a month lands in February,
 * not in March.
 */
function periodEnd(start: Date, interval: 'month' | 'year'): Date {
  const end = new Date(start.getTime());
  if (interval === 'year') {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    return end;
  }
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDay));
  return end;
}

export class WebhookService {
  constructor(private readonly dependencies: WebhookServiceDependencies) {}

  /**
   * Verifies and records one inbound event.
   *
   * The order is the security property. Size is bounded before anything is
   * read as data, the signature is checked over the raw bytes before they are
   * parsed as anything, and only a verified event reaches storage. An
   * unverified request changes nothing and leaves nothing behind — writing it
   * would let anybody fill this table by posting nonsense.
   */
  async receive(input: {
    readonly correlationId: string;
    readonly headers: Headers;
    readonly rawBody: string;
  }): Promise<WebhookIntakeOutcome> {
    const { events, logger, provider } = this.dependencies;
    if (provider.provider === 'unavailable') return { kind: 'unavailable' };
    if (input.rawBody.length > maximumWebhookBodyBytes) {
      return { kind: 'rejected', reason: 'oversized' };
    }

    let envelope;
    try {
      envelope = await provider.verifyEvent({
        headers: input.headers,
        rawBody: input.rawBody,
      });
    } catch {
      // Denied and audited without state change. Nothing about the presented
      // signature, the expected one, or the body is logged: a verification
      // failure is an operational fact, and the payload is somebody's attempt.
      logger.warn(
        { correlationId: input.correlationId, provider: provider.provider },
        'provider webhook signature rejected',
      );
      return { kind: 'rejected', reason: 'unverified' };
    }

    const now = this.dependencies.now();
    // A dispute carries its own amount, which is not the payment's. Normalizing
    // both onto the receipt means the verification `docs/security/05-payments-webhooks.md`
    // requires — that an inbound amount and currency agree with Velora's own
    // immutable record — is performed against what the provider actually sent
    // rather than against something re-derived afterwards.
    const amount = envelope.dispute?.amount ?? envelope.amount;
    const received = await events.transaction(async (executor) =>
      events.receive(executor, {
        amountMinor: amount?.amountMinor,
        currency: amount?.currency,
        eventType: envelope.eventType,
        evidenceDueAt: envelope.dispute?.evidenceDueAt,
        now,
        occurredAt: envelope.occurredAt,
        // The exact verified bytes, as a digest. Enough to prove later which
        // payload arrived, without retaining provider data indefinitely under
        // a retention policy nobody has approved.
        payloadDigest: createHash('sha256')
          .update(input.rawBody, 'utf8')
          .digest('hex'),
        provider: provider.provider,
        providerDisputeReference: envelope.dispute?.providerDisputeReference,
        providerEventId: envelope.eventId,
        providerPaymentReference: envelope.providerPaymentReference,
        providerRefundReference: envelope.providerRefundReference,
        reasonCode: envelope.dispute?.reason,
        status: envelope.dispute?.status ?? envelope.status,
      }),
    );
    return { duplicate: received === undefined, kind: 'accepted' };
  }

  /**
   * Drains claimable receipts once.
   *
   * Called by a poller on the worker, inside one database admission permit, the
   * same way the outbox relay is. Nothing here is on a request thread.
   */
  async processOnce(): Promise<WebhookProcessReport> {
    const { events, logger, owner } = this.dependencies;
    const now = this.dependencies.now();
    const claimed = await events.claim({
      leaseMilliseconds,
      limit: batchSize,
      now,
      owner,
    });
    let processed = 0;
    let ignored = 0;
    let retried = 0;
    let deadLettered = 0;

    for (const event of claimed) {
      try {
        const applied = await this.apply(event);
        await events.transaction(async (executor) =>
          events.settle(executor, {
            id: event.id,
            now: this.dependencies.now(),
            owner,
            state: applied ? 'processed' : 'ignored',
          }),
        );
        if (applied) processed += 1;
        else ignored += 1;
      } catch (error) {
        const retirable = event.attempts >= maximumProviderEventAttempts;
        await events.transaction(async (executor) =>
          events.settle(executor, {
            availableAt: new Date(
              this.dependencies.now().getTime() +
                backoffMilliseconds(event.attempts),
            ),
            failureReason: 'processing_failed',
            id: event.id,
            now: this.dependencies.now(),
            owner,
            state: retirable ? 'dead_letter' : 'retry_wait',
          }),
        );
        if (retirable) deadLettered += 1;
        else retried += 1;
        logger.error(
          {
            attempts: event.attempts,
            error,
            eventType: event.eventType,
            provider: event.provider,
          },
          retirable
            ? 'provider event dead-lettered'
            : 'provider event processing failed',
        );
      }
    }
    return {
      claimed: claimed.length,
      deadLettered,
      ignored,
      processed,
      retried,
    };
  }

  /**
   * Applies one verified event to current state, atomically.
   *
   * Returns false when the event is one Velora holds no rule for, or names
   * something it does not know about. That is `ignored` rather than a failure:
   * a provider sends event types nobody asked for, and recording "seen, nothing
   * to do" is the difference between an event nobody handled and one nobody
   * noticed.
   */
  private async apply(event: ProviderEventRow): Promise<boolean> {
    // A refund notice names a reversal rather than a capture, so it is resolved
    // first and against its own table. Everything else is about a payment.
    if (event.eventType === 'refund.succeeded') {
      return this.settleRefund(event);
    }
    if (event.eventType === 'refund.failed') {
      return this.failRefund(event);
    }

    const { payments } = this.dependencies;
    const reference = event.providerPaymentReference;
    if (reference === null) return false;
    const payment = await payments.findByProviderReference(
      payments.transactionless,
      { provider: event.provider, providerReference: reference },
    );
    // An event for something this platform has no record of. Reconciliation
    // owns that case; inventing a payment from a webhook would be taking a
    // provider's word for the existence of a purchase.
    if (payment === undefined) return false;

    switch (event.eventType) {
      case 'payment.succeeded': {
        // The amount the provider claims has to be the amount Velora recorded.
        // A settlement for a different figure is not a settlement of this
        // purchase, and accounting for it would put a number nobody agreed to
        // in the books.
        if (!agreesWithRecord(event, payment)) {
          return this.holdForReconciliation(payment);
        }
        return this.settlePayment(event, payment);
      }
      case 'payment.failed': {
        return this.failPayment(event, payment, 'declined');
      }
      case 'payment.cancelled': {
        return this.failPayment(event, payment, 'cancelled_by_consumer');
      }
      case 'subscription.cancelled': {
        return this.cancelSubscription(event, payment);
      }
      case 'dispute.opened':
      case 'dispute.closed': {
        return this.applyDispute(event, payment);
      }
      default: {
        return false;
      }
    }
  }

  /**
   * A verified reversal, settled with its compensating entries.
   *
   * The reversal is found by the provider's own refund reference, so a
   * confirmation that arrives while the request thread is still waiting — or
   * after that thread lost the answer entirely — lands in exactly the same
   * place and posts exactly once.
   */
  private async settleRefund(event: ProviderEventRow): Promise<boolean> {
    const { payments, refunds, refundService } = this.dependencies;
    const reference = event.providerRefundReference;
    if (reference === null) return false;
    const refund = await refunds.findByProviderReference(
      refunds.transactionless,
      { provider: event.provider, providerReference: reference },
    );
    if (refund === undefined) return false;
    const payment = await payments.findById(
      payments.transactionless,
      refund.paymentId,
    );
    if (payment === undefined) return false;
    if (!agreesWithRecord(event, refund)) return false;
    await refunds.transaction(async (executor) =>
      refundService.settle(executor, {
        occurredAt: event.occurredAt,
        payment,
        providerReference: reference,
        refund,
      }),
    );
    return true;
  }

  private async failRefund(event: ProviderEventRow): Promise<boolean> {
    const { refunds } = this.dependencies;
    const reference = event.providerRefundReference;
    if (reference === null) return false;
    const refund = await refunds.findByProviderReference(
      refunds.transactionless,
      { provider: event.provider, providerReference: reference },
    );
    if (refund === undefined) return false;
    await refunds.transaction(async (executor) =>
      refunds.transition(executor, {
        failureReason: 'declined',
        // Never from a terminal state. A late refusal for a reversal that
        // already settled is a contradiction the provider resolves through
        // reconciliation, not something this handler settles by overwriting a
        // movement of money that happened.
        from: ['requested', 'provider_pending', 'reconciliation_pending'],
        lastProviderSyncAt: this.dependencies.now(),
        now: this.dependencies.now(),
        refundId: refund.id,
        to: 'failed',
      }),
    );
    return true;
  }

  /** A cardholder's claim, applied to the books and to future commerce. */
  private async applyDispute(
    event: ProviderEventRow,
    payment: PaymentRow,
  ): Promise<boolean> {
    const { disputeService, disputes } = this.dependencies;
    const evidence = disputeEvidenceOf(event);
    if (evidence === undefined) return false;
    return disputes.transaction(async (executor) =>
      disputeService.apply(executor, {
        evidence,
        payment,
        provider: event.provider,
      }),
    );
  }

  /**
   * An answer that disagrees with Velora's own record settles nothing.
   *
   * Not a failure either: the provider may be right and the local record may be
   * the thing that is wrong. It becomes a reconciliation case, which is the one
   * state that means "this platform does not know yet".
   */
  private async holdForReconciliation(payment: PaymentRow): Promise<boolean> {
    const { logger, payments } = this.dependencies;
    logger.error(
      { paymentId: payment.id, provider: payment.provider },
      'provider event amount disagrees with the recorded operation',
    );
    await payments.transaction(async (executor) =>
      payments.transition(executor, {
        from: ['provider_pending', 'requires_action'],
        now: this.dependencies.now(),
        paymentId: payment.id,
        to: 'reconciliation_pending',
      }),
    );
    return true;
  }

  /**
   * A verified settlement: the state, the accounting, the subscription, and the
   * entitlement fact, in one transaction.
   *
   * All four together or none. A payment marked succeeded without its journal
   * entry is money nobody can explain, and an entitlement fact without the
   * payment behind it is access nobody paid for.
   *
   * Every step is idempotent on its own as well, because redelivery is
   * expected: the transition names the states it may move from, the journal
   * posts once per business event, the subscription is unique on its
   * originating payment, and the outbox event's identity is what the consumer
   * deduplicates on.
   */
  private async settlePayment(
    event: ProviderEventRow,
    payment: PaymentRow,
  ): Promise<boolean> {
    const { journal, offers, outbox, payments, subscriptions } =
      this.dependencies;
    return payments.transaction(async (executor) => {
      const settled = await payments.transition(executor, {
        from: ['provider_pending', 'requires_action', 'reconciliation_pending'],
        lastProviderSyncAt: this.dependencies.now(),
        now: this.dependencies.now(),
        paymentId: payment.id,
        to: 'succeeded',
      });
      // Already settled, or already terminal in some other way. A redelivered
      // success against a settled payment is the normal case and does nothing;
      // one against a refunded payment must not walk it backwards.
      if (settled === undefined) return true;

      const offer = await offers.findOfferForPurchase(
        executor,
        payment.offerId,
      );
      if (offer === undefined) return true;

      // The split, taken from approved commercial terms and from nowhere else.
      // A capture posted without one would be a sale divided by a percentage
      // nobody published, so a settlement that reaches here with no approved
      // policy is left for reconciliation rather than accounted for. It cannot
      // happen through the ordinary path — nothing is purchasable without
      // approved terms — but a policy withdrawn between purchase and settlement
      // would produce exactly this.
      const gross = money(payment.amountMinor, payment.currency);
      const allocation = this.dependencies.policy.allocate(gross);
      if (allocation === undefined) {
        throw new Error(
          'A settled payment cannot be allocated: no approved commercial terms',
        );
      }
      await journal.post(executor, {
        businessReference: payment.id,
        businessType: billingBusinessTypes.payment,
        ...(payment.correlationId === null
          ? {}
          : { correlationId: payment.correlationId }),
        entries: captureEntries({
          allocation,
          creatorId: offer.creatorId,
          gross,
        }),
        occurredAt: event.occurredAt,
        reason: 'payment_captured',
      });

      let commercialReference = payment.id;
      if (offer.commercialMode === 'subscription') {
        const prices = await offers.pricesForOffers(executor, [offer.id]);
        const price = prices.find((row) => row.id === payment.priceId);
        const interval = price?.billingInterval ?? 'month';
        const start = event.occurredAt;
        const created = await subscriptions.establish(executor, {
          amountMinor: payment.amountMinor,
          consumerId: payment.consumerId,
          currency: payment.currency,
          currentPeriodEnd: periodEnd(start, interval),
          currentPeriodStart: start,
          now: this.dependencies.now(),
          offerId: offer.id,
          originPaymentId: payment.id,
          priceId: payment.priceId,
          provider: payment.provider,
          providerReference: payment.providerReference ?? undefined,
        });
        const subscription =
          created ??
          (await subscriptions.findByOriginPayment(executor, payment.id));
        if (subscription === undefined) return true;
        commercialReference = subscription.id;
      }

      await outbox.append(executor as TransactionHandle, {
        ...(payment.correlationId === null
          ? {}
          : { correlationId: payment.correlationId }),
        eventName: entitlementGrantedEvent,
        eventVersion: 1,
        now: this.dependencies.now(),
        occurredAt: event.occurredAt,
        payload: {
          commercialReference,
          consumerId: payment.consumerId,
          offerId: offer.id,
          resourceId: offer.resourceId,
          resourceType: offer.resourceType,
        },
        subjectId: payment.id,
        subjectType: 'billing.payment',
      });
      return true;
    });
  }

  private async failPayment(
    event: ProviderEventRow,
    payment: PaymentRow,
    reason: 'cancelled_by_consumer' | 'declined',
  ): Promise<boolean> {
    const { payments } = this.dependencies;
    await payments.transaction(async (executor) =>
      payments.transition(executor, {
        failureReason: reason,
        // Deliberately not from a terminal state. A late decline for a payment
        // that already succeeded is a contradiction the provider has to resolve
        // through reconciliation, not something this handler resolves by
        // overwriting a settlement.
        from: [
          'created',
          'provider_pending',
          'requires_action',
          'reconciliation_pending',
        ],
        lastProviderSyncAt: this.dependencies.now(),
        now: this.dependencies.now(),
        paymentId: payment.id,
        to: reason === 'declined' ? 'failed' : 'cancelled',
      }),
    );
    void event;
    return true;
  }

  private async cancelSubscription(
    event: ProviderEventRow,
    payment: PaymentRow,
  ): Promise<boolean> {
    const { offers, outbox, subscriptions } = this.dependencies;
    return subscriptions.transaction(async (executor) => {
      const subscription = await subscriptions.findByOriginPayment(
        executor,
        payment.id,
      );
      if (subscription === undefined) return false;
      const cancelled = await subscriptions.transition(executor, {
        cancelledAt: event.occurredAt,
        from: ['pending', 'active', 'past_due', 'cancel_at_period_end'],
        now: this.dependencies.now(),
        subscriptionId: subscription.id,
        to: 'cancelled',
      });
      // Already ended. A redelivered cancellation is a no-op rather than a
      // second revocation, and it must not rewrite when the first one happened.
      if (cancelled === undefined) return true;

      const offer = await offers.findOfferForPurchase(
        executor,
        subscription.offerId,
      );
      if (offer === undefined) return true;
      await outbox.append(executor as TransactionHandle, {
        eventName: entitlementRevokedEvent,
        eventVersion: 1,
        now: this.dependencies.now(),
        occurredAt: event.occurredAt,
        payload: {
          commercialReference: subscription.id,
          consumerId: subscription.consumerId,
          offerId: offer.id,
          reason: 'subscription_cancelled',
          resourceId: offer.resourceId,
          resourceType: offer.resourceType,
        },
        subjectId: subscription.id,
        subjectType: 'billing.subscription',
      });
      return true;
    });
  }
}

export { periodEnd };
