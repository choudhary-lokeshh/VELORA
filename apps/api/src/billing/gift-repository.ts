import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import { billingBusinessTypes } from './policy.js';
import type { GiftState } from './gift-policy.js';
import {
  billingDisputes,
  billingGiftCatalogItems,
  billingGifts,
  billingJournalEntries,
  billingJournalTransactions,
  billingOffers,
  billingPayments,
  billingPrices,
  billingRefunds,
} from './schema.js';

export type GiftRow = typeof billingGifts.$inferSelect;
export type GiftCatalogRow = typeof billingGiftCatalogItems.$inferSelect;

export interface GiftCatalogOfferRow {
  readonly amountMinor: bigint;
  readonly catalog: GiftCatalogRow;
  readonly currency: string;
  readonly offerId: string;
}

export interface GiftHistoryRow {
  readonly amountMinor: bigint;
  readonly catalogItemId: string;
  readonly createdAt: Date;
  readonly currency: string;
  readonly giftId: string;
  readonly name: string;
  readonly paymentId: string | null;
  readonly recipientCreatorId: string;
  readonly recipientDisplayName: string;
  readonly recipientHandle: string;
  readonly sentAt: Date | null;
  readonly state: GiftState;
  readonly visual: GiftCatalogRow['visual'];
}

export class GiftRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }

  async catalogForCreator(
    executor: Executor,
    input: { readonly creatorId: string; readonly currency: string },
  ): Promise<GiftCatalogOfferRow[]> {
    const rows = await executor
      .select({
        amountMinor: billingPrices.amountMinor,
        catalog: billingGiftCatalogItems,
        currency: billingPrices.currency,
        offerId: billingOffers.id,
      })
      .from(billingGiftCatalogItems)
      .innerJoin(
        billingOffers,
        and(
          eq(billingOffers.resourceId, billingGiftCatalogItems.id),
          eq(billingOffers.resourceType, 'gift'),
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingOffers.commercialMode, 'one_time'),
          eq(billingOffers.state, 'active'),
        ),
      )
      .innerJoin(
        billingPrices,
        and(
          eq(billingPrices.offerId, billingOffers.id),
          eq(billingPrices.currency, input.currency),
          eq(billingPrices.state, 'active'),
        ),
      )
      .where(eq(billingGiftCatalogItems.state, 'active'))
      .orderBy(billingGiftCatalogItems.sortOrder);
    return rows;
  }

  /** Builds fixed local/test offer projections. No caller supplies a term. */
  async provisionLocalCatalog(
    executor: Executor,
    input: { readonly creatorId: string; readonly now: Date },
  ): Promise<number> {
    const catalog = await executor
      .select()
      .from(billingGiftCatalogItems)
      .where(eq(billingGiftCatalogItems.state, 'active'))
      .orderBy(billingGiftCatalogItems.sortOrder);
    for (const item of catalog) {
      await executor
        .insert(billingOffers)
        .values({
          activatedAt: input.now,
          commercialMode: 'one_time',
          createdAt: input.now,
          creatorId: input.creatorId,
          id: crypto.randomUUID(),
          // A gift is sold by the creator who receives it. Stated rather than
          // defaulted, because the column decides whose money the sale becomes.
          ownerType: 'creator',
          resourceId: item.id,
          resourceType: 'gift',
          state: 'active',
          updatedAt: input.now,
        })
        .onConflictDoNothing();
    }
    const offers = await executor
      .select({ id: billingOffers.id, resourceId: billingOffers.resourceId })
      .from(billingOffers)
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingOffers.resourceType, 'gift'),
          eq(billingOffers.state, 'active'),
        ),
      );
    const amountByOrder = [
      100n,
      250n,
      500n,
      1_000n,
      2_500n,
      5_000n,
      10_000n,
      25_000n,
    ];
    const itemById = new Map(catalog.map((item) => [item.id, item]));
    for (const offer of offers) {
      const item = itemById.get(offer.resourceId);
      const amountMinor =
        item === undefined ? undefined : amountByOrder[item.sortOrder];
      if (amountMinor === undefined) continue;
      await executor
        .insert(billingPrices)
        .values({
          amountMinor,
          billingInterval: null,
          commercialMode: 'one_time',
          createdAt: input.now,
          currency: 'USD',
          effectiveFrom: input.now,
          id: crypto.randomUUID(),
          offerId: offer.id,
          state: 'active',
        })
        .onConflictDoNothing();
    }
    return offers.length;
  }

  async findBySenderKey(
    executor: Executor,
    input: { readonly idempotencyKey: string; readonly senderUserId: string },
  ): Promise<GiftRow | undefined> {
    const rows = await executor
      .select()
      .from(billingGifts)
      .where(
        and(
          eq(billingGifts.senderUserId, input.senderUserId),
          eq(billingGifts.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async insert(
    executor: Executor,
    input: {
      readonly catalogItemId: string;
      readonly contextType: 'creator_profile';
      readonly idempotencyKey: string;
      readonly now: Date;
      readonly offerId: string;
      readonly recipientCreatorId: string;
      readonly recipientDisplayName: string;
      readonly recipientHandle: string;
      readonly recipientUserId: string;
      readonly senderUserId: string;
    },
  ): Promise<GiftRow | undefined> {
    const rows = await executor
      .insert(billingGifts)
      .values({
        ...input,
        createdAt: input.now,
        id: crypto.randomUUID(),
        state: 'pending',
        updatedAt: input.now,
      })
      .onConflictDoNothing({
        target: [billingGifts.senderUserId, billingGifts.idempotencyKey],
      })
      .returning();
    return rows[0];
  }

  async linkPayment(
    executor: Executor,
    input: {
      readonly giftId: string;
      readonly now: Date;
      readonly paymentId: string;
    },
  ): Promise<GiftRow | undefined> {
    const rows = await executor
      .update(billingGifts)
      .set({
        paymentId: input.paymentId,
        updatedAt: input.now,
        version: sql`${billingGifts.version} + 1`,
      })
      .where(
        and(
          eq(billingGifts.id, input.giftId),
          sql`${billingGifts.paymentId} is null or ${billingGifts.paymentId} = ${input.paymentId}`,
        ),
      )
      .returning();
    return rows[0];
  }

  async findByPayment(
    executor: Executor,
    paymentId: string,
  ): Promise<GiftRow | undefined> {
    const rows = await executor
      .select()
      .from(billingGifts)
      .where(eq(billingGifts.paymentId, paymentId))
      .limit(1);
    return rows[0];
  }

  async transitionByPayment(
    executor: Executor,
    input: {
      readonly from: readonly GiftState[];
      readonly now: Date;
      readonly paymentId: string;
      readonly to: GiftState;
    },
  ): Promise<GiftRow | undefined> {
    const rows = await executor
      .update(billingGifts)
      .set({
        ...(input.to === 'sent' ? { sentAt: input.now } : {}),
        ...(input.to === 'reversed' ? { reversedAt: input.now } : {}),
        state: input.to,
        updatedAt: input.now,
        version: sql`${billingGifts.version} + 1`,
      })
      .where(
        and(
          eq(billingGifts.paymentId, input.paymentId),
          inArray(billingGifts.state, [...input.from]),
        ),
      )
      .returning();
    return rows[0];
  }

  async listSent(
    executor: Executor,
    senderUserId: string,
    limit: number,
  ): Promise<GiftHistoryRow[]> {
    return this.listHistory(
      executor,
      eq(billingGifts.senderUserId, senderUserId),
      limit,
    );
  }

  async listReceived(
    executor: Executor,
    creatorId: string,
    limit: number,
  ): Promise<GiftHistoryRow[]> {
    return this.listHistory(
      executor,
      and(
        eq(billingGifts.recipientCreatorId, creatorId),
        // A failed or still-pending attempt was never received. Keeping it out
        // also prevents an attempted sender from creating creator-visible
        // activity before verified settlement.
        inArray(billingGifts.state, ['sent', 'partially_reversed', 'reversed']),
      ),
      limit,
    );
  }

  async findOwnHistory(
    executor: Executor,
    input: { readonly giftId: string; readonly senderUserId: string },
  ): Promise<GiftHistoryRow | undefined> {
    const rows = await this.listHistory(
      executor,
      and(
        eq(billingGifts.id, input.giftId),
        eq(billingGifts.senderUserId, input.senderUserId),
      ),
      1,
    );
    return rows[0];
  }

  /** Net creator-payable impact of gift captures and settled reversals. */
  async creatorEarningsForPayments(
    executor: Executor,
    input: {
      readonly accountId: string;
      readonly currency: string;
      readonly paymentIds: readonly string[];
    },
  ): Promise<ReadonlyMap<string, bigint>> {
    const result = new Map<string, bigint>();
    if (input.paymentIds.length === 0) return result;
    const apply = (row: {
      readonly amountMinor: bigint;
      readonly direction: 'credit' | 'debit';
      readonly paymentId: string;
    }) => {
      const signed =
        row.direction === 'credit' ? row.amountMinor : -row.amountMinor;
      result.set(row.paymentId, (result.get(row.paymentId) ?? 0n) + signed);
    };
    const captures = await executor
      .select({
        amountMinor: billingJournalEntries.amountMinor,
        direction: billingJournalEntries.direction,
        paymentId: billingJournalTransactions.businessReference,
      })
      .from(billingJournalEntries)
      .innerJoin(
        billingJournalTransactions,
        eq(billingJournalEntries.transactionId, billingJournalTransactions.id),
      )
      .where(
        and(
          eq(billingJournalEntries.accountId, input.accountId),
          eq(billingJournalEntries.currency, input.currency),
          eq(
            billingJournalTransactions.businessType,
            billingBusinessTypes.payment,
          ),
          inArray(billingJournalTransactions.businessReference, [
            ...input.paymentIds,
          ]),
        ),
      );
    captures.forEach(apply);

    const refunds = await executor
      .select({
        amountMinor: billingJournalEntries.amountMinor,
        direction: billingJournalEntries.direction,
        paymentId: billingRefunds.paymentId,
      })
      .from(billingJournalEntries)
      .innerJoin(
        billingJournalTransactions,
        eq(billingJournalEntries.transactionId, billingJournalTransactions.id),
      )
      .innerJoin(
        billingRefunds,
        sql`${billingJournalTransactions.businessReference} = ${billingRefunds.id}::text`,
      )
      .where(
        and(
          eq(billingJournalEntries.accountId, input.accountId),
          eq(billingJournalEntries.currency, input.currency),
          eq(
            billingJournalTransactions.businessType,
            billingBusinessTypes.refund,
          ),
          inArray(billingRefunds.paymentId, [...input.paymentIds]),
        ),
      );
    refunds.forEach(apply);

    const disputes = await executor
      .select({
        amountMinor: billingJournalEntries.amountMinor,
        direction: billingJournalEntries.direction,
        paymentId: billingDisputes.paymentId,
      })
      .from(billingJournalEntries)
      .innerJoin(
        billingJournalTransactions,
        eq(billingJournalEntries.transactionId, billingJournalTransactions.id),
      )
      .innerJoin(
        billingDisputes,
        sql`${billingJournalTransactions.businessReference} = ${billingDisputes.id}::text`,
      )
      .where(
        and(
          eq(billingJournalEntries.accountId, input.accountId),
          eq(billingJournalEntries.currency, input.currency),
          eq(
            billingJournalTransactions.businessType,
            billingBusinessTypes.disputeResolution,
          ),
          inArray(billingDisputes.paymentId, [...input.paymentIds]),
        ),
      );
    disputes.forEach(apply);
    return result;
  }

  /** Verified refund and lost-dispute money applied to one gift payment. */
  async settledReversalTotal(
    executor: Executor,
    paymentId: string,
  ): Promise<bigint> {
    const [row] = await executor
      .select({
        total: sql<string>`(
          coalesce((select sum(${billingRefunds.amountMinor}) from ${billingRefunds} where ${billingRefunds.paymentId} = ${paymentId} and ${billingRefunds.state} = 'succeeded'), 0)
          + coalesce((select sum(${billingDisputes.amountMinor}) from ${billingDisputes} where ${billingDisputes.paymentId} = ${paymentId} and ${billingDisputes.state} = 'lost'), 0)
        )::text`,
      })
      .from(billingPayments)
      .where(eq(billingPayments.id, paymentId));
    return BigInt(row?.total ?? '0');
  }

  private async listHistory(
    executor: Executor,
    predicate: SQL | undefined,
    limit: number,
  ): Promise<GiftHistoryRow[]> {
    const rows = await executor
      .select({
        amountMinor: billingPayments.amountMinor,
        catalogItemId: billingGifts.catalogItemId,
        createdAt: billingGifts.createdAt,
        currency: billingPayments.currency,
        giftId: billingGifts.id,
        name: billingGiftCatalogItems.name,
        paymentId: billingGifts.paymentId,
        recipientCreatorId: billingGifts.recipientCreatorId,
        recipientDisplayName: billingGifts.recipientDisplayName,
        recipientHandle: billingGifts.recipientHandle,
        sentAt: billingGifts.sentAt,
        state: billingGifts.state,
        visual: billingGiftCatalogItems.visual,
      })
      .from(billingGifts)
      .innerJoin(
        billingGiftCatalogItems,
        eq(billingGiftCatalogItems.id, billingGifts.catalogItemId),
      )
      .innerJoin(
        billingPayments,
        eq(billingPayments.id, billingGifts.paymentId),
      )
      .where(predicate)
      .orderBy(desc(billingGifts.createdAt), desc(billingGifts.id))
      .limit(limit);
    return rows;
  }
}
