import type { SafeLogger } from '@velora/observability/server';

import type { Executor, TransactionHandle } from '../database/executor.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import {
  entitlementRevokedEvent,
  type EntitlementRevocationReason,
} from './entitlement-events.js';
import type { OfferRepository } from './offer-repository.js';
import type {
  SubscriptionRepository,
  SubscriptionRow,
} from './subscription-repository.js';

/**
 * Ending a commercial relationship, from the two places it can end.
 *
 * A person schedules it, or a paid period runs out. Neither is a provider
 * event, which is why neither lives in the webhook service: a consumer
 * cancelling is Velora's own decision about Velora's own record, and a period
 * expiring is arithmetic on a date this domain already stored.
 *
 * One rule shapes both. **Access already paid for is never taken back.** A
 * cancellation moves a live subscription to `cancel_at_period_end` and stops
 * there; the period ends on its own, and only then is the entitlement
 * withdrawn. Ending access at the moment somebody cancels would take something
 * they had already bought, and offering an "end it now" control would be
 * offering a refund this platform has no approved terms for.
 *
 * The one exception is a lapsed subscription. `past_due` grants nothing
 * already — grace policy is unresolved and the fail-closed reading of an
 * unresolved policy is no access — so cancelling one ends it immediately and
 * takes nothing, because there is nothing left to take.
 *
 * Revocation always travels through the outbox, exactly as a grant does.
 * BILLING never writes a `clubs_` row; it publishes that the commercial fact
 * ended and PRIVATE CLUBS applies its own rule to that.
 */

export type CancellationRefusal = 'not_cancellable' | 'not_found';

export type CancellationOutcome =
  | { readonly kind: 'scheduled'; readonly subscription: SubscriptionRow }
  | { readonly kind: 'refused'; readonly reason: CancellationRefusal };

export interface SubscriptionLifecycleReport {
  readonly examined: number;
  readonly expired: number;
}

export interface SubscriptionServiceDependencies {
  readonly logger: SafeLogger;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly outbox: OutboxAppendPort;
  readonly subscriptions: SubscriptionRepository;
}

/** How many expiries one sweep settles, so a backlog cannot stall a cycle. */
const expiryBatchSize = 50;

export class SubscriptionService {
  constructor(private readonly dependencies: SubscriptionServiceDependencies) {}

  /**
   * The holder of a subscription asks for it to stop renewing.
   *
   * Idempotent by state rather than by a preceding read: a second request
   * against something already scheduled finds it in `cancel_at_period_end` and
   * answers with the same record, and a request that races the expiry sweep
   * loses the conditional update rather than un-ending a finished relationship.
   */
  async cancel(input: {
    readonly consumerId: string;
    readonly subscriptionId: string;
  }): Promise<CancellationOutcome> {
    const { now, subscriptions } = this.dependencies;
    return subscriptions.transaction(async (executor) => {
      const held = await subscriptions.findOwnSubscription(executor, input);
      // Somebody else's subscription answers exactly as one that does not
      // exist, so an identifier cannot be probed for existence.
      if (held === undefined) return { kind: 'refused', reason: 'not_found' };
      if (held.state === 'cancel_at_period_end') {
        return { kind: 'scheduled', subscription: held };
      }
      if (held.state === 'active') {
        const moved = await subscriptions.transition(executor, {
          from: ['active'],
          now: now(),
          subscriptionId: held.id,
          to: 'cancel_at_period_end',
        });
        if (moved !== undefined) {
          return { kind: 'scheduled', subscription: moved };
        }
        // Somebody else moved it between the read and the write — a second tab,
        // a retried request, or the expiry sweep. Whoever won, the caller
        // wanted this to stop renewing and it is stopping; re-reading and
        // answering with the current record is the truthful reply, and it is
        // what makes a double-click one cancellation rather than an error.
        const current = await subscriptions.findOwnSubscription(
          executor,
          input,
        );
        return current !== undefined &&
          (current.state === 'cancel_at_period_end' ||
            current.state === 'cancelled')
          ? { kind: 'scheduled', subscription: current }
          : { kind: 'refused', reason: 'not_cancellable' };
      }
      if (held.state === 'past_due') {
        // Nothing is being taken. A lapsed subscription grants no access
        // already, so there is no paid period left to honour and letting it sit
        // in a state that renews would be the unkind answer.
        const ended = await this.end(executor, {
          from: ['past_due'],
          reason: 'subscription_cancelled',
          subscription: held,
        });
        return ended === undefined
          ? { kind: 'refused', reason: 'not_cancellable' }
          : { kind: 'scheduled', subscription: ended };
      }
      // `pending` has not settled, so there is no relationship to end; the two
      // terminal states have already ended.
      return { kind: 'refused', reason: 'not_cancellable' };
    });
  }

  /**
   * One sweep of periods that have run out.
   *
   * Bounded, and each row settled in its own transaction, so one subscription
   * whose offer has vanished cannot hold up the rest. The transition names the
   * state it moves from, so a sweep racing a provider cancellation writes
   * whichever arrives first and the other becomes a no-op.
   */
  async expireOnce(): Promise<SubscriptionLifecycleReport> {
    const { now, subscriptions } = this.dependencies;
    const due = await subscriptions.listExpiredSchedules(
      subscriptions.transactionless,
      { limit: expiryBatchSize, now: now() },
    );
    let expired = 0;
    for (const subscription of due) {
      const ended = await subscriptions.transaction(async (executor) =>
        this.end(executor, {
          from: ['cancel_at_period_end'],
          reason: 'subscription_cancelled',
          subscription,
        }),
      );
      if (ended !== undefined) expired += 1;
    }
    return { examined: due.length, expired };
  }

  /**
   * The end itself: the transition and the published fact, in one transaction.
   *
   * Both or neither. A subscription recorded as ended without the fact that
   * says so is access nobody withdrew, and a fact without the transition is a
   * revocation that would be republished on the next sweep.
   */
  private async end(
    executor: Executor,
    input: {
      readonly from: readonly SubscriptionRow['state'][];
      readonly reason: EntitlementRevocationReason;
      readonly subscription: SubscriptionRow;
    },
  ): Promise<SubscriptionRow | undefined> {
    const { now, offers, outbox } = this.dependencies;
    const at = now();
    const ended = await this.dependencies.subscriptions.transition(executor, {
      cancelledAt: at,
      from: input.from,
      now: at,
      subscriptionId: input.subscription.id,
      to: 'cancelled',
    });
    if (ended === undefined) return undefined;
    const offer = await offers.findOfferForPurchase(executor, ended.offerId);
    if (offer === undefined) {
      // The subscription is ended either way; there is simply nothing to
      // address the revocation to. It is logged rather than thrown, because
      // rolling back would leave a relationship nobody can end.
      this.dependencies.logger.error(
        { subscriptionId: ended.id },
        'ended subscription has no offer to revoke against',
      );
      return ended;
    }
    await outbox.append(executor as TransactionHandle, {
      eventName: entitlementRevokedEvent,
      eventVersion: 1,
      now: at,
      occurredAt: at,
      payload: {
        commercialReference: ended.id,
        consumerId: ended.consumerId,
        offerId: offer.id,
        reason: input.reason,
        resourceId: offer.resourceId,
        resourceType: offer.resourceType,
      },
      subjectId: ended.id,
      subjectType: 'billing.subscription',
    });
    return ended;
  }
}
