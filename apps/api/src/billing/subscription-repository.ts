import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import {
  entitlingSubscriptionStates,
  liveSubscriptionStates,
  type SubscriptionState,
} from './subscription-policy.js';
import { billingSubscriptions } from './schema.js';

export type SubscriptionRow = typeof billingSubscriptions.$inferSelect;

/**
 * Provider-neutral subscription state.
 *
 * Nothing here decides access. It records what Velora believes the commercial
 * relationship is; whether that grants anything is PRIVATE CLUBS' decision,
 * taken from the fact this domain publishes rather than from these rows.
 */
export class SubscriptionRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  /**
   * Establishes a subscription from a settled payment, once.
   *
   * Two unique indexes decide rather than a preceding read: one subscription
   * per originating payment, and one live subscription per consumer per offer.
   * A duplicated success event therefore produces no second relationship, and
   * neither does a renewal racing a repair.
   */
  async establish(
    executor: Executor,
    input: {
      readonly amountMinor: bigint;
      readonly consumerId: string;
      readonly currency: string;
      readonly currentPeriodEnd: Date;
      readonly currentPeriodStart: Date;
      readonly now: Date;
      readonly offerId: string;
      readonly originPaymentId: string;
      readonly priceId: string;
      readonly provider: string;
      readonly providerReference: string | undefined;
    },
  ): Promise<SubscriptionRow | undefined> {
    const inserted = await executor
      .insert(billingSubscriptions)
      .values({
        amountMinor: input.amountMinor,
        consumerId: input.consumerId,
        createdAt: input.now,
        currency: input.currency,
        currentPeriodEnd: input.currentPeriodEnd,
        currentPeriodStart: input.currentPeriodStart,
        id: crypto.randomUUID(),
        offerId: input.offerId,
        originPaymentId: input.originPaymentId,
        priceId: input.priceId,
        provider: input.provider,
        providerReference: input.providerReference ?? null,
        state: 'active',
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findByOriginPayment(
    executor: Executor,
    originPaymentId: string,
  ): Promise<SubscriptionRow | undefined> {
    const rows = await executor
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.originPaymentId, originPaymentId))
      .limit(1);
    return rows[0];
  }

  async findOwnSubscription(
    executor: Executor,
    input: { readonly consumerId: string; readonly subscriptionId: string },
  ): Promise<SubscriptionRow | undefined> {
    const rows = await executor
      .select()
      .from(billingSubscriptions)
      .where(
        and(
          eq(billingSubscriptions.id, input.subscriptionId),
          eq(billingSubscriptions.consumerId, input.consumerId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listOwnSubscriptions(
    executor: Executor,
    input: { readonly consumerId: string; readonly limit: number },
  ): Promise<readonly SubscriptionRow[]> {
    return executor
      .select()
      .from(billingSubscriptions)
      .where(eq(billingSubscriptions.consumerId, input.consumerId))
      .orderBy(
        desc(billingSubscriptions.createdAt),
        desc(billingSubscriptions.id),
      )
      .limit(input.limit);
  }

  async findLiveForOffer(
    executor: Executor,
    input: { readonly consumerId: string; readonly offerId: string },
  ): Promise<SubscriptionRow | undefined> {
    const rows = await executor
      .select()
      .from(billingSubscriptions)
      .where(
        and(
          eq(billingSubscriptions.consumerId, input.consumerId),
          eq(billingSubscriptions.offerId, input.offerId),
          inArray(billingSubscriptions.state, [...liveSubscriptionStates]),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Moves a subscription, if it is still in a state that permits it.
   *
   * The states it may move from are named, so a stale provider event cannot
   * resurrect a relationship that has already ended. That is the case
   * `docs/flows/creator-entitlement.md` calls out specifically: a success event
   * arriving after a cancellation must not restore access.
   */
  async transition(
    executor: Executor,
    input: {
      readonly cancelledAt?: Date;
      readonly from: readonly SubscriptionState[];
      readonly now: Date;
      readonly subscriptionId: string;
      readonly to: SubscriptionState;
    },
  ): Promise<SubscriptionRow | undefined> {
    const updated = await executor
      .update(billingSubscriptions)
      .set({
        ...(input.cancelledAt === undefined
          ? {}
          : { cancelledAt: input.cancelledAt }),
        state: input.to,
        updatedAt: input.now,
        version: sql`${billingSubscriptions.version} + 1`,
      })
      .where(
        and(
          eq(billingSubscriptions.id, input.subscriptionId),
          inArray(billingSubscriptions.state, [...input.from]),
        ),
      )
      .returning();
    return updated[0];
  }
}

/** Whether this subscription state is one that may grant access at all. */
export function grants(state: SubscriptionState): boolean {
  return entitlingSubscriptionStates.includes(state);
}
