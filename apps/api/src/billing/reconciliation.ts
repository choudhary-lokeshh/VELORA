import type { SafeLogger } from '@velora/observability/server';

import { money, moneyEquals } from '../money/money.js';
import type { PaymentRepository, PaymentRow } from './payment-repository.js';
import type { PaymentProviderPort } from './provider.js';
import type { RefundRepository, RefundRow } from './refund-repository.js';
import type { RefundService } from './refund-service.js';
import type { WebhookService } from './webhook-service.js';

/**
 * Resolving what the platform does not know from what the provider does.
 *
 * Every ambiguous outcome in this domain leaves a durable row saying so: an
 * operation whose provider answer was lost, a reversal in the same position, an
 * instruction that was sent and never confirmed. None of them is a failure and
 * none is a success, and the one honest thing the platform can say about them
 * is that it does not know yet. This is what makes that a temporary state.
 *
 * Three rules shape it.
 *
 * **It reads rather than retries.** A provider is asked what it holds under the
 * key Velora already sent — `retrievePayment` for a capture, and for a reversal
 * the same `refundPayment` call under the same idempotency key, which is a
 * read-your-write rather than a second instruction. `docs/operations/03-finance-payout-operations.md`
 * forbids an operator marking money moved from anything but verified provider
 * state, and the same rule binds a job.
 *
 * **No provider call happens inside a transaction.** The stale rows are read,
 * the transaction closes, the provider is asked, and a second transaction
 * records the answer — the same ordering every other provider interaction here
 * follows.
 *
 * **Every correction is idempotent and lands through the ordinary path.** A
 * settlement discovered by reconciliation posts through exactly the code a
 * webhook would, so it posts once, publishes once, and cannot produce a
 * transaction shape that the ordinary path could not.
 *
 * Nothing here deletes anything. Financial record retention is unresolved and
 * `LEGAL REVIEW REQUIRED`; a sweep that tidied up would be the one retention
 * decision that cannot be undone.
 */

export interface ReconciliationReport {
  readonly failed: number;
  readonly refundsExamined: number;
  readonly refundsResolved: number;
  readonly paymentsExamined: number;
  readonly paymentsResolved: number;
}

export interface ReconciliationDependencies {
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly payments: PaymentRepository;
  readonly provider: PaymentProviderPort;
  readonly refundService: RefundService;
  readonly refunds: RefundRepository;
  /** How long an operation may sit unsettled before it is examined. */
  readonly staleAfterMilliseconds: number;
  readonly webhooks: WebhookService;
}

/** How many rows one sweep examines. Bounded so a backlog cannot stall a cycle. */
const batchSize = 50;

export class BillingReconciliation {
  constructor(private readonly dependencies: ReconciliationDependencies) {}

  /**
   * One sweep.
   *
   * Called by a poller on the worker inside one database admission permit, the
   * same way the provider-event drain and the outbox relay are. Nothing here
   * runs on a request thread.
   */
  async reconcileOnce(): Promise<ReconciliationReport> {
    const payments = await this.reconcilePayments();
    const refunds = await this.reconcileRefunds();
    return {
      failed: payments.failed + refunds.failed,
      paymentsExamined: payments.examined,
      paymentsResolved: payments.resolved,
      refundsExamined: refunds.examined,
      refundsResolved: refunds.resolved,
    };
  }

  private async reconcilePayments(): Promise<{
    readonly examined: number;
    readonly failed: number;
    readonly resolved: number;
  }> {
    const { payments, provider } = this.dependencies;
    if (provider.provider === 'unavailable') {
      return { examined: 0, failed: 0, resolved: 0 };
    }
    const stale = await payments.listUnsettledBefore(payments.transactionless, {
      before: this.staleBefore(),
      limit: batchSize,
    });
    let resolved = 0;
    let failed = 0;
    for (const operation of stale) {
      try {
        if (await this.resolvePayment(operation)) resolved += 1;
      } catch (error) {
        failed += 1;
        // The provider is unreachable, or answered something this platform
        // cannot use. The row stays exactly where it was and the next sweep
        // tries again; nothing is guessed and nothing is written.
        this.dependencies.logger.warn(
          { error, provider: operation.provider },
          'payment reconciliation could not resolve an operation',
        );
      }
    }
    return { examined: stale.length, failed, resolved };
  }

  /**
   * Asks the provider what it holds, and applies it through the ordinary door.
   *
   * An operation with no provider reference is the crash-before-record case:
   * the instruction may have reached the provider under Velora's key and the
   * answer was lost. Re-issuing it under that same key is a read-your-write —
   * the provider returns the object it already created rather than making a
   * second one — which is the only way to learn a reference the platform never
   * received.
   */
  private async resolvePayment(operation: PaymentRow): Promise<boolean> {
    const { payments, provider, webhooks } = this.dependencies;
    let reference = operation.providerReference;
    if (reference === null) {
      const session = await provider.createCheckout({
        amount: money(operation.amountMinor, operation.currency),
        cancelUrl: 'https://reconciliation.invalid/cancelled',
        consumerReference: operation.consumerId,
        correlationId: operation.correlationId ?? operation.id,
        idempotencyKey: operation.providerIdempotencyKey,
        mode: 'payment',
        operationReference: operation.id,
        returnUrl: 'https://reconciliation.invalid/return',
      });
      // Bound outside the closure below: a `let` captured by one is not
      // narrowed by TypeScript, and the reference is a string from here on.
      const learned = session.providerReference;
      reference = learned;
      await payments.transaction(async (executor) =>
        payments.transition(executor, {
          from: [
            'created',
            'provider_pending',
            'requires_action',
            'reconciliation_pending',
          ],
          lastProviderSyncAt: this.dependencies.now(),
          now: this.dependencies.now(),
          paymentId: operation.id,
          providerReference: learned,
          to: 'provider_pending',
        }),
      );
    }

    const snapshot = await provider.retrievePayment(reference);
    // The provider's answer is evidence, not authority. An amount that
    // disagrees with what Velora recorded is not this purchase settling, and it
    // is left for a person rather than accounted for.
    if (
      !moneyEquals(
        snapshot.amount,
        money(operation.amountMinor, operation.currency),
      )
    ) {
      this.dependencies.logger.error(
        { paymentId: operation.id, provider: operation.provider },
        'provider snapshot amount disagrees with the recorded operation',
      );
      return false;
    }

    // Through exactly the path a verified webhook takes, so a settlement
    // discovered here posts once, publishes once, and cannot produce a
    // transaction shape the ordinary path could not.
    return webhooks.applyProviderSnapshot({
      occurredAt: this.dependencies.now(),
      payment: { ...operation, providerReference: reference },
      status: snapshot.status,
    });
  }

  private async reconcileRefunds(): Promise<{
    readonly examined: number;
    readonly failed: number;
    readonly resolved: number;
  }> {
    const { payments, provider, refunds } = this.dependencies;
    if (provider.provider === 'unavailable') {
      return { examined: 0, failed: 0, resolved: 0 };
    }
    const stale = await refunds.listUnsettledBefore(refunds.transactionless, {
      before: this.staleBefore(),
      limit: batchSize,
    });
    let resolved = 0;
    let failed = 0;
    for (const reversal of stale) {
      try {
        const payment = await payments.findById(
          payments.transactionless,
          reversal.paymentId,
        );
        if (payment?.providerReference == null) continue;
        // The same instruction under the same key. A provider that already
        // acted returns the object it created; one that never received it acts
        // now. Either way there is exactly one reversal, which is what makes
        // this a read rather than a retry.
        const snapshot = await provider.refundPayment({
          amount: money(reversal.amountMinor, reversal.currency),
          idempotencyKey: reversal.providerIdempotencyKey,
          operationReference: reversal.id,
          providerPaymentReference: payment.providerReference,
        });
        if (await this.applyRefund(reversal, snapshot, payment)) resolved += 1;
      } catch (error) {
        failed += 1;
        this.dependencies.logger.warn(
          { error, provider: reversal.provider },
          'refund reconciliation could not resolve a reversal',
        );
      }
    }
    return { examined: stale.length, failed, resolved };
  }

  private async applyRefund(
    reversal: RefundRow,
    snapshot: {
      readonly providerReference: string;
      readonly status: 'failed' | 'pending' | 'succeeded';
    },
    payment: PaymentRow,
  ): Promise<boolean> {
    const { refundService, refunds } = this.dependencies;
    if (snapshot.status === 'succeeded') {
      const settled = await refunds.transaction(async (executor) =>
        refundService.settle(executor, {
          occurredAt: this.dependencies.now(),
          payment,
          providerReference: snapshot.providerReference,
          refund: reversal,
        }),
      );
      return settled !== undefined;
    }
    if (snapshot.status === 'failed') {
      const failed = await refunds.transaction(async (executor) =>
        refunds.transition(executor, {
          failureReason: 'declined',
          from: ['requested', 'provider_pending', 'reconciliation_pending'],
          lastProviderSyncAt: this.dependencies.now(),
          now: this.dependencies.now(),
          providerReference: snapshot.providerReference,
          refundId: reversal.id,
          to: 'failed',
        }),
      );
      return failed !== undefined;
    }
    // Still pending at the provider. The reference is worth recording — it is
    // what a later sweep and an inbound event both match on — and the state is
    // not.
    await refunds.transaction(async (executor) =>
      refunds.transition(executor, {
        from: ['requested', 'reconciliation_pending'],
        lastProviderSyncAt: this.dependencies.now(),
        now: this.dependencies.now(),
        providerReference: snapshot.providerReference,
        refundId: reversal.id,
        to: 'provider_pending',
      }),
    );
    return false;
  }

  private staleBefore(): Date {
    return new Date(
      this.dependencies.now().getTime() -
        this.dependencies.staleAfterMilliseconds,
    );
  }
}
