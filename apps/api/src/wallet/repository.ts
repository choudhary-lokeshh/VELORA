import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type {
  LivePreferenceEntitlementState,
  LivePremiumPreferenceKind,
} from './policy.js';
import { livePreferenceEntitlements, walletAcquisitions } from './schema.js';

export type LivePreferenceEntitlementRow =
  typeof livePreferenceEntitlements.$inferSelect;
export type WalletAcquisitionRow = typeof walletAcquisitions.$inferSelect;

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
      readonly preferenceKind: LivePremiumPreferenceKind;
      readonly preferenceRegion: string;
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
        preferenceKind: input.preferenceKind,
        preferenceRegion: input.preferenceRegion,
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
   * Locked rather than read, because every caller of this is about to decide
   * whether to settle it — and two callers deciding that at once is exactly the
   * race that would capture and release the same reservation.
   */
  async lockActiveEntitlement(
    executor: TransactionHandle,
    userId: string,
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .select()
      .from(livePreferenceEntitlements)
      .where(
        and(
          eq(livePreferenceEntitlements.userId, userId),
          eq(livePreferenceEntitlements.state, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    return rows[0];
  }

  /** The same window, read without a lock, for a surface that only renders it. */
  async findActiveEntitlement(
    executor: Executor,
    userId: string,
  ): Promise<LivePreferenceEntitlementRow | undefined> {
    const rows = await executor
      .select()
      .from(livePreferenceEntitlements)
      .where(
        and(
          eq(livePreferenceEntitlements.userId, userId),
          eq(livePreferenceEntitlements.state, 'active'),
        ),
      )
      .limit(1);
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
   * Settles one window, once.
   *
   * The `where` clause restates `active`, so a second settlement of the same
   * window changes nothing and returns nothing — which is what makes the sweep
   * and a person's own cancellation safe to race.
   */
  async settleEntitlement(
    executor: TransactionHandle,
    input: {
      readonly encounterId?: string;
      readonly id: string;
      readonly now: Date;
      readonly settlementTransactionId: string;
      readonly state: Exclude<LivePreferenceEntitlementState, 'active'>;
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
          eq(livePreferenceEntitlements.state, 'active'),
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
