import { and, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import { coinAccountId } from './ledger.js';
import { livePreferenceEntitlementOpenStates } from './policy.js';
import type {
  LivePreferenceEntitlementState,
  LivePremiumGenderValue,
  WalletTransactionReason,
} from './policy.js';
import { livePreferenceEntitlements, walletAcquisitions } from './schema.js';

export type LivePreferenceEntitlementRow =
  typeof livePreferenceEntitlements.$inferSelect;
export type WalletAcquisitionRow = typeof walletAcquisitions.$inferSelect;

/**
 * One movement of one person's coins, as the history query produces it.
 *
 * Deliberately not a ledger row. It carries what moved and why, and nothing
 * about the accounts either side of it — the shape is the first thing standing
 * between a history somebody may read and the book behind it.
 */
export interface WalletActivityRow {
  readonly coins: bigint;
  readonly gender: string | null;
  readonly id: string;
  readonly language: string | null;
  readonly occurredAt: Date;
  readonly reason: WalletTransactionReason;
  readonly region: string | null;
  /** The keyset position this line was read at. Opaque outside this domain. */
  readonly sequence: number;
}

/** The raw shape the history statement returns, before it is given names. */
interface WalletActivityQueryRow {
  readonly coins: string;
  readonly id: string;
  readonly occurred_at: string;
  readonly preference_gender: string | null;
  readonly preference_language: string | null;
  readonly preference_region: string | null;
  readonly reason: WalletTransactionReason;
  readonly sequence: string;
}

/**
 * WALLET's storage.
 *
 * The same two rules the LIVE and REALTIME repositories follow. A transition is
 * applied by a guarded `update` whose `where` clause restates the state it
 * expects, so two callers racing to settle the same activation produce one
 * transition and the loser observes it rather than overwriting it. And a
 * settled activation, its instant, and the transaction that settled it are
 * always written by the same statement, because a row saying an activation
 * finished without saying which posting paid for it is a row where the product
 * and the books disagree.
 *
 * The ledger tables are not touched here. {@link ./ledger.js} owns them, for the
 * same reason `src/money/journal.ts` owns BILLING's: the arithmetic and the
 * balance invariant are one thing, and the business rows that reference them
 * are another.
 */
export class WalletRepository {
  constructor(private readonly database: DatabaseHandle) {}

  transaction<T>(run: (executor: TransactionHandle) => Promise<T>): Promise<T> {
    return this.database.transaction(run);
  }

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  async insertEntitlement(
    executor: TransactionHandle,
    input: {
      readonly coins: bigint;
      readonly expiresAt: Date;
      readonly id: string;
      readonly now: Date;
      readonly preferenceGender: LivePremiumGenderValue | undefined;
      readonly preferenceLanguage: string | undefined;
      readonly preferenceRegion: string | undefined;
      readonly reservationTransactionId: string;
      readonly userId: string;
    },
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    // `on conflict do nothing` against the one-open-window index rather than a
    // prior read: two concurrent activations both pass a read and only one
    // passes this, which is what makes a double tap cost one reservation.
    const rows = await executor
      .insert(livePreferenceEntitlements)
      .values({
        coins: input.coins,
        createdAt: input.now,
        encounterId: null,
        expiresAt: input.expiresAt,
        id: input.id,
        preferenceGender: input.preferenceGender ?? null,
        preferenceLanguage: input.preferenceLanguage ?? null,
        preferenceRegion: input.preferenceRegion ?? null,
        reservationTransactionId: input.reservationTransactionId,
        settledAt: null,
        settlementTransactionId: null,
        state: 'active',
        updatedAt: input.now,
        userId: input.userId,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0];
  }

  /**
   * The window this person currently holds, if any, locked for update.
   *
   * Both open states, because a charged window is still a window: cancelling
   * one, broadening one, and sweeping one all have to see it, and only the
   * capture path cares that it has not been charged yet.
   *
   * Locked rather than read, because every caller of this is about to decide
   * whether to settle it — and two callers deciding that at once is exactly the
   * race that would capture and release the same reservation.
   */
  async lockOpenEntitlement(
    executor: TransactionHandle,
    userId: string,
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .select()
      .from(livePreferenceEntitlements)
      .where(
        and(
          eq(livePreferenceEntitlements.userId, userId),
          inArray(
            livePreferenceEntitlements.state,
            livePreferenceEntitlementOpenStates,
          ),
        ),
      )
      .for('update')
      .limit(1);
    return rows[0];
  }

  /**
   * The open windows held by any of these people, in one query.
   *
   * The matcher's own question, and it is asked about a candidate list the
   * caller already holds rather than about the population — so this can never
   * become a way to find out who is paying for what. One query for the batch,
   * because the alternative is one per candidate inside a transaction that is
   * already holding a pair lock.
   */
  async findOpenEntitlementsAmong(
    executor: Executor,
    userIds: readonly string[],
  ): Promise<readonly LivePreferenceEntitlementRow[]> {
    if (userIds.length === 0) return [];
    return executor
      .select()
      .from(livePreferenceEntitlements)
      .where(
        and(
          inArray(livePreferenceEntitlements.userId, [...userIds]),
          inArray(
            livePreferenceEntitlements.state,
            livePreferenceEntitlementOpenStates,
          ),
        ),
      );
  }

  /** The same window, read without a lock, for a surface that only renders it. */
  async findOpenEntitlement(
    executor: Executor,
    userId: string,
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .select()
      .from(livePreferenceEntitlements)
      .where(
        and(
          eq(livePreferenceEntitlements.userId, userId),
          inArray(
            livePreferenceEntitlements.state,
            livePreferenceEntitlementOpenStates,
          ),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Drops preferences from a window that is already running.
   *
   * Broadening only, and the service is what enforces that; this writes what it
   * was given. It never touches `coins`, `state`, or either settlement column,
   * because widening a search changes what the window does and not what was
   * paid for it — and it restates the open states in the predicate so a window
   * that closed under the caller is not quietly amended after the fact.
   */
  async broadenEntitlement(
    executor: TransactionHandle,
    input: {
      readonly id: string;
      readonly now: Date;
      readonly preferenceGender: LivePremiumGenderValue | undefined;
      readonly preferenceLanguage: string | undefined;
      readonly preferenceRegion: string | undefined;
    },
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .update(livePreferenceEntitlements)
      .set({
        preferenceGender: input.preferenceGender ?? null,
        preferenceLanguage: input.preferenceLanguage ?? null,
        preferenceRegion: input.preferenceRegion ?? null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(livePreferenceEntitlements.id, input.id),
          inArray(
            livePreferenceEntitlements.state,
            livePreferenceEntitlementOpenStates,
          ),
        ),
      )
      .returning();
    return rows[0];
  }

  /**
   * Closes a charged window whose time is up.
   *
   * No posting and no settlement columns: the money moved at capture, and this
   * only stops the narrowing and frees the person to open another. The `where`
   * clause restates `captured`, so it can never touch a window that is still
   * holding coins.
   */
  async expireCapturedEntitlement(
    executor: TransactionHandle,
    input: { readonly id: string; readonly now: Date },
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .update(livePreferenceEntitlements)
      .set({ state: 'expired', updatedAt: input.now })
      .where(
        and(
          eq(livePreferenceEntitlements.id, input.id),
          eq(livePreferenceEntitlements.state, 'captured'),
        ),
      )
      .returning();
    return rows[0];
  }

  async findEntitlementById(
    executor: Executor,
    id: string,
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .select()
      .from(livePreferenceEntitlements)
      .where(eq(livePreferenceEntitlements.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Settles one window's coins, once.
   *
   * The `where` clause restates `active`, so a second settlement of the same
   * window changes nothing and returns nothing — which is what makes the sweep,
   * a capture, and a person's own cancellation safe to race. It is the single
   * gate through which coins may leave the reserved position, and it is why
   * "captured can never later release" and "released can never later capture"
   * are properties of one `update` rather than of an ordering somebody has to
   * maintain.
   */
  async settleEntitlement(
    executor: TransactionHandle,
    input: {
      readonly encounterId?: string;
      readonly id: string;
      readonly now: Date;
      readonly settlementTransactionId: string;
      readonly state: Exclude<
        LivePreferenceEntitlementState,
        'active' | 'expired'
      >;
    },
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .update(livePreferenceEntitlements)
      .set({
        encounterId: input.encounterId ?? null,
        settledAt: input.now,
        settlementTransactionId: input.settlementTransactionId,
        state: input.state,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(livePreferenceEntitlements.id, input.id),
          eq(livePreferenceEntitlements.state, 'active'),
        ),
      )
      .returning();
    return rows[0];
  }

  /**
   * Windows whose time is up, oldest first, bounded.
   *
   * Not locked here. The sweep takes each row's lock individually inside its
   * own transaction, so one row that is briefly contended does not hold the
   * whole batch — and a row another worker settles between this read and that
   * lock is refused by the guarded update rather than double-settled.
   */
  async findExpiredEntitlements(
    executor: Executor,
    input: { readonly limit: number; readonly now: Date },
  ): Promise<readonly LivePreferenceEntitlementRow[]> {
    return executor
      .select()
      .from(livePreferenceEntitlements)
      .where(
        and(
          inArray(
            livePreferenceEntitlements.state,
            livePreferenceEntitlementOpenStates,
          ),
          lte(livePreferenceEntitlements.expiresAt, input.now),
        ),
      )
      .orderBy(livePreferenceEntitlements.expiresAt)
      .limit(input.limit);
  }

  async countActivationsSince(
    executor: Executor,
    input: { readonly since: Date; readonly userId: string },
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(livePreferenceEntitlements)
      .where(
        and(
          eq(livePreferenceEntitlements.userId, input.userId),
          gte(livePreferenceEntitlements.createdAt, input.since),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  async recentEntitlements(
    executor: Executor,
    input: { readonly limit: number; readonly userId: string },
  ): Promise<readonly LivePreferenceEntitlementRow[]> {
    return executor
      .select()
      .from(livePreferenceEntitlements)
      .where(eq(livePreferenceEntitlements.userId, input.userId))
      .orderBy(desc(livePreferenceEntitlements.sequence))
      .limit(input.limit);
  }

  /**
   * One page of somebody's own coin history, newest first.
   *
   * Written as one statement rather than as a read-then-enrich, because the
   * alternative is N queries for the preference behind N lines, inside a route
   * a person refreshes.
   *
   * Two rules make it safe to hand to a client. It is anchored on this person's
   * *own* two accounts, so a transaction that never touched their balance is
   * not in the answer however it was posted — a capture credits
   * `platform_revenue`, and the platform's side of it is not this person's
   * business. And it selects the movement rather than the postings: what comes
   * back is a reason, an instant, a magnitude, and the preference the window
   * named, never an account, a direction, or a transaction identifier.
   *
   * Keyset paging on `sequence`, which never moves once written, so a page
   * boundary cannot shift under a reader part-way through.
   */
  async listActivity(
    executor: Executor,
    input: {
      readonly before?: number | undefined;
      readonly limit: number;
      readonly userId: string;
    },
  ): Promise<readonly WalletActivityRow[]> {
    const balanceAccount = coinAccountId({
      category: 'consumer_balance',
      subjectId: input.userId,
    });
    const reservedAccount = coinAccountId({
      category: 'consumer_reserved',
      subjectId: input.userId,
    });
    const rows = await executor.execute(sql`
      select
        t.id as id,
        t.reason as reason,
        t.occurred_at as occurred_at,
        t.sequence as sequence,
        greatest(
          abs(coalesce(sum(case when e.account_id = ${balanceAccount}
                                then case when e.direction = 'credit' then e.amount else -e.amount end
                                else 0 end), 0)),
          abs(coalesce(sum(case when e.account_id = ${reservedAccount}
                                then case when e.direction = 'credit' then e.amount else -e.amount end
                                else 0 end), 0))
        ) as coins,
        max(w.preference_gender) as preference_gender,
        max(w.preference_language) as preference_language,
        max(w.preference_region) as preference_region
      from wallet_transactions t
      join wallet_entries e on e.transaction_id = t.id
      left join wallet_live_preference_entitlements w
        on w.user_id = ${input.userId}
        and t.business_reference = w.id::text
      where e.account_id in (${balanceAccount}, ${reservedAccount})
        ${input.before === undefined ? sql`` : sql`and t.sequence < ${input.before}`}
      group by t.id, t.reason, t.occurred_at, t.sequence
      order by t.sequence desc
      limit ${input.limit}
    `);
    return (rows as unknown as readonly WalletActivityQueryRow[]).map(
      (row) => ({
        coins: BigInt(row.coins),
        gender: row.preference_gender,
        id: row.id,
        language: row.preference_language,
        occurredAt: new Date(row.occurred_at),
        reason: row.reason,
        region: row.preference_region,
        sequence: Number(row.sequence),
      }),
    );
  }

  /**
   * Records that one external purchase produced coins, or reports that it
   * already had.
   *
   * The unique index over channel and reference is the idempotency, and the
   * insert is what consults it: a redelivered acknowledgement, a reinstall
   * replaying a token, and two devices racing all collide here and credit once.
   */
  async insertAcquisition(
    executor: TransactionHandle,
    input: {
      readonly channel: string;
      readonly coins: bigint;
      readonly id: string;
      readonly now: Date;
      readonly purchaseReference: string;
      readonly transactionId: string;
      readonly userId: string;
    },
  ): Promise<WalletAcquisitionRow | undefined> {
    const rows = await executor
      .insert(walletAcquisitions)
      .values({
        channel: input.channel,
        coins: input.coins,
        createdAt: input.now,
        id: input.id,
        purchaseReference: input.purchaseReference,
        transactionId: input.transactionId,
        userId: input.userId,
      })
      .onConflictDoNothing({
        target: [
          walletAcquisitions.channel,
          walletAcquisitions.purchaseReference,
        ],
      })
      .returning();
    return rows[0];
  }

  async findAcquisition(
    executor: Executor,
    input: {
      readonly channel: string;
      readonly purchaseReference: string;
    },
  ): Promise<WalletAcquisitionRow | undefined> {
    const rows = await executor
      .select()
      .from(walletAcquisitions)
      .where(
        and(
          eq(walletAcquisitions.channel, input.channel),
          eq(walletAcquisitions.purchaseReference, input.purchaseReference),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Serializes concurrent decisions about one person's wallet.
   *
   * A transaction-scoped advisory lock, taken by every path that both reads a
   * balance and writes one. The balance row lock already serializes two
   * spenders; this additionally serializes a spender against a path that
   * creates the row, and it keys on the person rather than on a row that may
   * not exist yet.
   *
   * Released when the transaction ends either way, so a pooled connection never
   * carries one forward. Two unrelated people can collide on a key, which makes
   * them serialize for the length of one short transaction — a throughput
   * detail and never a correctness one.
   */
  async lockWallet(executor: TransactionHandle, userId: string): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`velora:wallet:${userId.toLowerCase()}`}, 0))`,
    );
  }
}
