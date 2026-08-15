import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import type { OfferCursor } from './cursor.js';
import type {
  BillingInterval,
  CommercialMode,
  CommercialResourceType,
} from './offer-policy.js';
import { billingOffers, billingPrices } from './schema.js';

export type OfferRow = typeof billingOffers.$inferSelect;
export type PriceRow = typeof billingPrices.$inferSelect;

/**
 * Offers and their frozen prices.
 *
 * Every read that could reach another creator's commercial terms puts the
 * creator in the predicate rather than filtering afterwards, so an identifier
 * belonging to somebody else is indistinguishable from one that does not exist.
 * Every write that changes what something costs names the state and version it
 * expects, so a stale editor loses rather than overwrites.
 *
 * Nothing here retires a price by editing it. Retirement sets a lifecycle and
 * an instant; the amount, the currency, and the cadence are frozen by a
 * database trigger and cannot be reached from this module at all.
 */
export class OfferRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  async findOwnOffer(
    executor: Executor,
    input: { readonly creatorId: string; readonly offerId: string },
  ): Promise<OfferRow | undefined> {
    const rows = await executor
      .select()
      .from(billingOffers)
      .where(
        and(
          eq(billingOffers.id, input.offerId),
          eq(billingOffers.creatorId, input.creatorId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * One creator's offers, newest first.
   *
   * Keyset paged on the creation instant and identifier, which is exactly the
   * index order, so a creator with a long commercial history pays for the page
   * rather than for the history.
   */
  async listOwnOffers(
    executor: Executor,
    input: {
      readonly after: OfferCursor | undefined;
      readonly creatorId: string;
      readonly limit: number;
    },
  ): Promise<OfferRow[]> {
    const after = input.after;
    return executor
      .select()
      .from(billingOffers)
      .where(
        after === undefined
          ? eq(billingOffers.creatorId, input.creatorId)
          : and(
              eq(billingOffers.creatorId, input.creatorId),
              or(
                lt(billingOffers.createdAt, after.moment),
                and(
                  eq(billingOffers.createdAt, after.moment),
                  lt(billingOffers.id, after.id),
                ),
              ),
            ),
      )
      .orderBy(desc(billingOffers.createdAt), desc(billingOffers.id))
      .limit(input.limit);
  }

  /**
   * Prices for a batch of offers, in one statement.
   *
   * Batched rather than fetched per offer, because a list of twenty offers that
   * issues twenty-one queries is the shape that looks fine in development and
   * falls over on a creator with a real catalog.
   */
  async pricesForOffers(
    executor: Executor,
    offerIds: readonly string[],
  ): Promise<PriceRow[]> {
    if (offerIds.length === 0) return [];
    return executor
      .select()
      .from(billingPrices)
      .where(inArray(billingPrices.offerId, [...offerIds]))
      .orderBy(
        billingPrices.offerId,
        billingPrices.currency,
        desc(billingPrices.createdAt),
      );
  }

  async livePricesFor(
    executor: Executor,
    offerId: string,
  ): Promise<PriceRow[]> {
    return executor
      .select()
      .from(billingPrices)
      .where(
        and(
          eq(billingPrices.offerId, offerId),
          eq(billingPrices.state, 'active'),
        ),
      )
      .orderBy(billingPrices.currency);
  }

  /**
   * Creates an offer, or returns nothing when a live one already covers this
   * resource and mode.
   *
   * The partial unique index decides, not a preceding read: two creators — or
   * one creator twice — racing to open commercial terms for the same club both
   * insert, and PostgreSQL admits one.
   */
  async insertOffer(
    executor: Executor,
    input: {
      readonly commercialMode: CommercialMode;
      readonly creatorId: string;
      readonly now: Date;
      readonly resourceId: string;
      readonly resourceType: CommercialResourceType;
    },
  ): Promise<OfferRow | undefined> {
    const inserted = await executor
      .insert(billingOffers)
      .values({
        commercialMode: input.commercialMode,
        createdAt: input.now,
        creatorId: input.creatorId,
        id: crypto.randomUUID(),
        resourceId: input.resourceId,
        resourceType: input.resourceType,
        state: 'draft',
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /**
   * Moves an offer to a new lifecycle state, if it is still where the caller
   * believed it was.
   *
   * The version and the current state are both in the predicate. A concurrent
   * activation and retirement therefore produce one winner and one caller who
   * is told to re-read, rather than two writes whose order decided the outcome.
   */
  async transitionOffer(
    executor: Executor,
    input: {
      readonly activatedAt?: Date;
      readonly expectedState: OfferRow['state'];
      readonly expectedVersion: number;
      readonly now: Date;
      readonly offerId: string;
      readonly retiredAt?: Date;
      readonly state: OfferRow['state'];
    },
  ): Promise<OfferRow | undefined> {
    const updated = await executor
      .update(billingOffers)
      .set({
        ...(input.activatedAt === undefined
          ? {}
          : { activatedAt: input.activatedAt }),
        ...(input.retiredAt === undefined
          ? {}
          : { retiredAt: input.retiredAt }),
        state: input.state,
        updatedAt: input.now,
        version: sql`${billingOffers.version} + 1`,
      })
      .where(
        and(
          eq(billingOffers.id, input.offerId),
          eq(billingOffers.state, input.expectedState),
          eq(billingOffers.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Publishes a price, or returns nothing when this offer already has a live
   * one in that currency.
   *
   * The conflict is the answer rather than an error: a caller that raced
   * another price for the same currency is told to retire the existing one
   * first, and no second live price is ever created.
   */
  async insertPrice(
    executor: Executor,
    input: {
      readonly amountMinor: bigint;
      readonly billingInterval: BillingInterval | undefined;
      readonly commercialMode: CommercialMode;
      readonly currency: string;
      readonly effectiveFrom: Date;
      readonly now: Date;
      readonly offerId: string;
    },
  ): Promise<PriceRow | undefined> {
    const inserted = await executor
      .insert(billingPrices)
      .values({
        amountMinor: input.amountMinor,
        billingInterval: input.billingInterval ?? null,
        commercialMode: input.commercialMode,
        createdAt: input.now,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom,
        id: crypto.randomUUID(),
        offerId: input.offerId,
        state: 'active',
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /**
   * Withdraws one live price.
   *
   * Only the lifecycle columns are named. The amount, currency, and cadence are
   * frozen by a trigger, so even a future caller that tried to change them here
   * would be refused by the database rather than by review.
   */
  async retirePrice(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly offerId: string;
      readonly priceId: string;
    },
  ): Promise<PriceRow | undefined> {
    const updated = await executor
      .update(billingPrices)
      .set({ retiredAt: input.now, state: 'retired' })
      .where(
        and(
          eq(billingPrices.id, input.priceId),
          eq(billingPrices.offerId, input.offerId),
          eq(billingPrices.state, 'active'),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Withdraws every live price on an offer, when the offer itself retires. */
  async retireLivePrices(
    executor: Executor,
    input: { readonly now: Date; readonly offerId: string },
  ): Promise<number> {
    const updated = await executor
      .update(billingPrices)
      .set({ retiredAt: input.now, state: 'retired' })
      .where(
        and(
          eq(billingPrices.offerId, input.offerId),
          eq(billingPrices.state, 'active'),
        ),
      )
      .returning({ id: billingPrices.id });
    return updated.length;
  }
}
