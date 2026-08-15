import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import type { JournalStore } from '../money/journal.js';
import { money, zeroMoney, type Money } from '../money/money.js';
import type { OfferCursor } from './cursor.js';
import { creatorPayableAccount } from './revenue-entries.js';
import { openDisputeStates } from './reversal-policy.js';
import {
  billingDisputes,
  billingOffers,
  billingPayments,
  billingRefunds,
} from './schema.js';

/**
 * What a creator has actually earned, read from what the platform actually
 * holds.
 *
 * Two different kinds of answer live here, and the difference between them is
 * the whole design.
 *
 * The **payable** is the journal's. It is the balance of that creator's
 * `creator_payable` account in one currency, derived from entries on every
 * read, and it is the only number here that is authoritative. Nothing caches
 * it: a stored balance is a second source of truth that a concurrency bug can
 * corrupt with nothing noticing, and this one can be recomputed and compared.
 *
 * Everything else is a **projection** — gross, the platform's share, what has
 * been reversed, what is currently disputed — derived by aggregating the
 * commercial records that produced those entries. Projections are rebuildable
 * by construction because they are computed on read rather than stored, and
 * none of them is what a decision is taken against.
 *
 * Currencies never mix. Every figure is per currency, every list is per
 * currency, and there is no total: adding a euro to a yen produces a number
 * that means nothing, and a creator shown one would plan against it.
 */

export interface CreatorCurrencyEarnings {
  /** Money a cardholder is currently claiming back. Not yet reversed. */
  readonly disputed: Money;
  /** What consumers paid, before anything was taken out of it. */
  readonly gross: Money;
  /** What the platform kept, under approved terms. */
  readonly platform: Money;
  /** The authoritative balance: what the platform owes this creator. */
  readonly payable: Money;
  /** What has been returned to consumers out of this creator's sales. */
  readonly reversed: Money;
  /** Tax withheld against an authority. Zero while no tax engine is approved. */
  readonly tax: Money;
}

/** One commercial event in a creator's history, as they may see it. */
export interface CreatorEarningsEntry {
  readonly amount: Money;
  /** Identifier of the payment, refund, or dispute this describes. */
  readonly id: string;
  readonly occurredAt: Date;
  readonly offerId: string;
  readonly kind: 'capture' | 'dispute' | 'refund';
  readonly state: string;
}

function entryOf(
  row: {
    readonly amountMinor: bigint;
    readonly id: string;
    readonly occurredAt: Date;
    readonly offerId: string;
    readonly state: string;
  },
  kind: CreatorEarningsEntry['kind'],
  currency: string,
): CreatorEarningsEntry {
  return {
    amount: money(row.amountMinor, currency),
    id: row.id,
    kind,
    occurredAt: row.occurredAt,
    offerId: row.offerId,
    state: row.state,
  };
}

export class EarningsRepository {
  constructor(
    private readonly database: DatabaseHandle,
    private readonly journal: JournalStore,
  ) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  /**
   * Every currency this creator has ever transacted in.
   *
   * Read from the sales themselves rather than from approved policy, because a
   * currency withdrawn from the policy does not un-earn what was earned in it,
   * and a creator whose only sales were in a currency the platform no longer
   * supports is still owed the money.
   */
  async currenciesFor(
    executor: Executor,
    creatorId: string,
  ): Promise<readonly string[]> {
    const rows = await executor
      .selectDistinct({ currency: billingPayments.currency })
      .from(billingPayments)
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, creatorId),
          eq(billingPayments.state, 'succeeded'),
        ),
      )
      .orderBy(billingPayments.currency);
    return rows.map((row) => row.currency);
  }

  /**
   * One currency's figures for one creator.
   *
   * The payable comes from the journal and the rest from the commercial
   * records. They are read in one transaction so a settlement landing between
   * two of them cannot produce a page where the parts disagree with the whole.
   */
  async earningsFor(
    executor: Executor,
    input: { readonly creatorId: string; readonly currency: string },
  ): Promise<CreatorCurrencyEarnings> {
    const [captured] = await executor
      .select({
        gross: sql<string>`coalesce(sum(${billingPayments.amountMinor}), 0)::text`,
      })
      .from(billingPayments)
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingPayments.currency, input.currency),
          eq(billingPayments.state, 'succeeded'),
        ),
      );
    const [refunded] = await executor
      .select({
        total: sql<string>`coalesce(sum(${billingRefunds.amountMinor}), 0)::text`,
      })
      .from(billingRefunds)
      .innerJoin(
        billingPayments,
        eq(billingRefunds.paymentId, billingPayments.id),
      )
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingRefunds.currency, input.currency),
          eq(billingRefunds.state, 'succeeded'),
        ),
      );
    const [chargedBack] = await executor
      .select({
        total: sql<string>`coalesce(sum(${billingDisputes.amountMinor}), 0)::text`,
      })
      .from(billingDisputes)
      .innerJoin(
        billingPayments,
        eq(billingDisputes.paymentId, billingPayments.id),
      )
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingDisputes.currency, input.currency),
          eq(billingDisputes.state, 'lost'),
        ),
      );
    const [disputed] = await executor
      .select({
        total: sql<string>`coalesce(sum(${billingDisputes.amountMinor}), 0)::text`,
      })
      .from(billingDisputes)
      .innerJoin(
        billingPayments,
        eq(billingDisputes.paymentId, billingPayments.id),
      )
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingDisputes.currency, input.currency),
          inArray(billingDisputes.state, [...openDisputeStates]),
        ),
      );

    // The one authoritative figure. A payable account is credited when a sale
    // settles and debited when one is reversed, so its balance is negative in
    // the journal's debits-minus-credits convention; it is negated here because
    // "what we owe you" reads better as a positive number than as a liability
    // sign a creator has no reason to know about.
    const ledger = await this.journal.balanceOf(
      executor,
      input.currency,
      creatorPayableAccount(input.creatorId),
    );
    const payable = money(-ledger.amountMinor, input.currency);
    const gross = money(BigInt(captured?.gross ?? '0'), input.currency);
    const reversedTotal = money(
      BigInt(refunded?.total ?? '0') + BigInt(chargedBack?.total ?? '0'),
      input.currency,
    );
    const tax = zeroMoney(input.currency);

    return {
      disputed: money(BigInt(disputed?.total ?? '0'), input.currency),
      gross,
      payable,
      // What the platform kept is what is left of the sales after the money
      // that went back and the money still owed onward. Derived rather than
      // read from the platform's own account, because that account is one
      // position for the whole platform and this question is about one creator.
      platform: money(
        gross.amountMinor -
          reversedTotal.amountMinor -
          payable.amountMinor -
          tax.amountMinor,
        input.currency,
      ),
      reversed: reversedTotal,
      // Nothing writes a tax position, because no tax authority is configured
      // and no policy in this repository computes one. Reporting zero here is a
      // statement about what the platform withheld, not about what is owed to
      // any government.
      tax,
    };
  }

  /**
   * One creator's commercial history in one currency, newest first.
   *
   * Captures, reversals, and claims are one list because they are one story:
   * reading them apart turns a sequence of events into three lists nobody can
   * line up.
   *
   * Three keyset-paged reads merged in memory rather than one SQL union. Each
   * branch is bounded by the page size against the index it already has, so at
   * most three pages are ever fetched and the merge is over a fixed number of
   * rows — where a union would have to sort the combined set before it could
   * take a page, and would do it against no single index.
   */
  async historyFor(
    executor: Executor,
    input: {
      readonly after: OfferCursor | undefined;
      readonly creatorId: string;
      readonly currency: string;
      readonly limit: number;
    },
  ): Promise<readonly CreatorEarningsEntry[]> {
    const after = input.after;
    const captures = await executor
      .select({
        amountMinor: billingPayments.amountMinor,
        id: billingPayments.id,
        occurredAt: billingPayments.createdAt,
        offerId: billingPayments.offerId,
        state: billingPayments.state,
      })
      .from(billingPayments)
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingPayments.currency, input.currency),
          eq(billingPayments.state, 'succeeded'),
          after === undefined
            ? undefined
            : or(
                lt(billingPayments.createdAt, after.moment),
                and(
                  eq(billingPayments.createdAt, after.moment),
                  lt(billingPayments.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(billingPayments.createdAt), desc(billingPayments.id))
      .limit(input.limit);
    const reversals = await executor
      .select({
        amountMinor: billingRefunds.amountMinor,
        id: billingRefunds.id,
        occurredAt: billingRefunds.createdAt,
        offerId: billingPayments.offerId,
        state: billingRefunds.state,
      })
      .from(billingRefunds)
      .innerJoin(
        billingPayments,
        eq(billingRefunds.paymentId, billingPayments.id),
      )
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingRefunds.currency, input.currency),
          after === undefined
            ? undefined
            : or(
                lt(billingRefunds.createdAt, after.moment),
                and(
                  eq(billingRefunds.createdAt, after.moment),
                  lt(billingRefunds.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(billingRefunds.createdAt), desc(billingRefunds.id))
      .limit(input.limit);
    const claims = await executor
      .select({
        amountMinor: billingDisputes.amountMinor,
        id: billingDisputes.id,
        occurredAt: billingDisputes.openedAt,
        offerId: billingPayments.offerId,
        state: billingDisputes.state,
      })
      .from(billingDisputes)
      .innerJoin(
        billingPayments,
        eq(billingDisputes.paymentId, billingPayments.id),
      )
      .innerJoin(billingOffers, eq(billingPayments.offerId, billingOffers.id))
      .where(
        and(
          eq(billingOffers.creatorId, input.creatorId),
          eq(billingDisputes.currency, input.currency),
          after === undefined
            ? undefined
            : or(
                lt(billingDisputes.openedAt, after.moment),
                and(
                  eq(billingDisputes.openedAt, after.moment),
                  lt(billingDisputes.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(billingDisputes.openedAt), desc(billingDisputes.id))
      .limit(input.limit);

    const merged: CreatorEarningsEntry[] = [
      ...captures.map((row) => entryOf(row, 'capture', input.currency)),
      ...reversals.map((row) => entryOf(row, 'refund', input.currency)),
      ...claims.map((row) => entryOf(row, 'dispute', input.currency)),
    ];
    // The same ordering every branch was read in, so the merged page continues
    // exactly where the cursor left off rather than approximately.
    merged.sort((left, right) => {
      const byMoment = right.occurredAt.getTime() - left.occurredAt.getTime();
      if (byMoment !== 0) return byMoment;
      return left.id < right.id ? 1 : left.id > right.id ? -1 : 0;
    });
    return merged.slice(0, input.limit);
  }

  transaction<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (executor) => work(executor));
  }
}
