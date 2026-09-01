import { createHash, randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { Executor, TransactionHandle } from '../database/executor.js';
import {
  maximumStorableCoins,
  maximumWalletOperationCoins,
  minimumStorableCoins,
  type WalletAccountCategory,
  type WalletDirection,
  type WalletTransactionReason,
} from './policy.js';
import {
  walletAccounts,
  walletBalances,
  walletEntries,
  walletTransactions,
} from './schema.js';

/**
 * A coin rule was broken before anything reached the database.
 *
 * Distinct from a generic `Error` so a caller can tell "this could never be a
 * posting" from "this operation failed", and so a test can assert the class
 * rather than matching on a message.
 */
export class CoinLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoinLedgerError';
  }
}

/** Which position an entry moves. Identity, never a name somebody typed. */
export interface CoinAccountRef {
  readonly category: WalletAccountCategory;
  /** Present exactly when the category is a consumer position. */
  readonly subjectId?: string;
}

export interface CoinEntryInput {
  readonly account: CoinAccountRef;
  readonly amount: bigint;
  readonly direction: WalletDirection;
}

export interface CoinPosting {
  /** Identity of the business event, unique within its type. */
  readonly businessReference: string;
  readonly businessType: string;
  readonly correctsTransactionId?: string;
  readonly correlationId?: string;
  readonly entries: readonly CoinEntryInput[];
  /** When the event happened, which is not when it is being recorded. */
  readonly occurredAt: Date;
  readonly reason: WalletTransactionReason;
}

export interface CoinPostingResult {
  /** True when this business event already had a transaction. */
  readonly alreadyPosted: boolean;
  readonly transactionId: string;
}

export interface CoinBalance {
  readonly available: bigint;
  readonly reserved: bigint;
}

/**
 * The account identifier for one position, derived rather than allocated.
 *
 * A deterministic identifier makes "ensure this account exists" a single
 * idempotent insert with no read, and makes the same position carry the same
 * identifier in every environment — which is what lets a test assert against
 * one without seeding it first.
 *
 * UUID version 8 is the RFC 9562 slot for an identifier whose bits the
 * application defines. The `wallet` prefix is part of the hashed input, so this
 * domain's platform issuance account can never collide with BILLING's or
 * PAYOUTS'.
 */
export function coinAccountId(account: CoinAccountRef): string {
  const digest = createHash('sha256')
    .update(`wallet|${account.category}|${account.subjectId ?? ''}`, 'utf8')
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function isConsumerCategory(category: WalletAccountCategory): boolean {
  return category === 'consumer_balance' || category === 'consumer_reserved';
}

/**
 * A balanced, append-only coin journal, and the projection a spend locks.
 *
 * Every method takes an executor rather than opening its own transaction. A
 * posting is always the accounting half of a business transition — an
 * activation, a settlement, a purchase becoming coins — and the two have to
 * commit together or the books disagree with the state that produced them.
 *
 * The class knows nothing about *why* coins move. The vocabulary of reasons and
 * the rules about which positions a given business event touches belong to the
 * service above it; the arithmetic, the balance invariant, and the idempotency
 * belong here.
 */
export class CoinLedger {
  constructor(private readonly now: () => Date = () => new Date()) {}

  /**
   * Posts one business event, exactly once.
   *
   * Uniqueness is settled by PostgreSQL rather than by looking first: the
   * insert carries `on conflict do nothing` against the business identity, and
   * a caller that gets no row back reads the transaction the winner wrote.
   * Fifty simultaneous postings of one event produce one transaction and
   * forty-nine `alreadyPosted` answers, with no lock and no retry loop.
   */
  async post(
    executor: Executor,
    posting: CoinPosting,
  ): Promise<CoinPostingResult> {
    this.validate(posting);
    const now = this.now();

    // Sorted so two concurrent postings touching the same accounts take them in
    // the same order and cannot wait on each other.
    const accounts = [
      ...new Map(
        posting.entries.map((entry) => [
          `${entry.account.category}|${entry.account.subjectId ?? ''}`,
          entry.account,
        ]),
      ),
    ].sort(([left], [right]) => (left < right ? -1 : 1));

    await executor
      .insert(walletAccounts)
      .values(
        accounts.map(([, account]) => ({
          category: account.category,
          createdAt: now,
          id: coinAccountId(account),
          subjectId: account.subjectId ?? null,
          subjectType: isConsumerCategory(account.category)
            ? ('consumer' as const)
            : ('platform' as const),
        })),
      )
      .onConflictDoNothing();

    const transactionId = randomUUID();
    const inserted = await executor
      .insert(walletTransactions)
      .values({
        businessReference: posting.businessReference,
        businessType: posting.businessType,
        correctsTransactionId: posting.correctsTransactionId ?? null,
        correlationId: posting.correlationId ?? null,
        id: transactionId,
        occurredAt: posting.occurredAt,
        reason: posting.reason,
        recordedAt: now,
      })
      .onConflictDoNothing({
        target: [
          walletTransactions.businessType,
          walletTransactions.businessReference,
        ],
      })
      .returning({ id: walletTransactions.id });

    const row = inserted[0];
    if (row === undefined) {
      const existing = await this.findByBusinessEvent(executor, {
        businessReference: posting.businessReference,
        businessType: posting.businessType,
      });
      if (existing === undefined) {
        throw new CoinLedgerError(
          'A coin posting conflicted with an event that cannot be read back',
        );
      }
      return { alreadyPosted: true, transactionId: existing };
    }

    await executor.insert(walletEntries).values(
      posting.entries.map((entry) => ({
        accountId: coinAccountId(entry.account),
        amount: entry.amount,
        direction: entry.direction,
        id: randomUUID(),
        transactionId,
      })),
    );

    return { alreadyPosted: false, transactionId };
  }

  async findByBusinessEvent(
    executor: Executor,
    input: {
      readonly businessReference: string;
      readonly businessType: string;
    },
  ): Promise<string | undefined> {
    const rows = await executor
      .select({ id: walletTransactions.id })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.businessType, input.businessType),
          eq(walletTransactions.businessReference, input.businessReference),
        ),
      )
      .limit(1);
    return rows[0]?.id;
  }

  /**
   * The position of one account, derived from its entries.
   *
   * Credits minus debits, which for a consumer balance is "coins this person
   * holds" and for platform issuance is the negative of "coins issued". The
   * sign convention is stated once here and nowhere else, so a caller reading a
   * number never has to reconstruct it.
   *
   * This is the *proof*, not the read path. Product code reads
   * {@link balanceOf}, which is the projection; this exists so a test can
   * rebuild that projection from the entries and assert they agree, and so an
   * operator investigating a discrepancy has an authoritative number.
   */
  async derivedBalanceOf(
    executor: Executor,
    account: CoinAccountRef,
  ): Promise<bigint> {
    const rows = await executor
      .select({
        // `sum` over `bigint` returns `numeric` in PostgreSQL, so this cannot
        // overflow however many entries an account accumulates. Cast to text
        // because a numeric is not a JavaScript number and must never be read
        // as one.
        balance: sql<string>`coalesce(sum(case when ${walletEntries.direction} = 'credit' then ${walletEntries.amount} else -${walletEntries.amount} end), 0)::text`,
      })
      .from(walletEntries)
      .where(eq(walletEntries.accountId, coinAccountId(account)));
    const balance = rows[0]?.balance;
    return balance === undefined ? 0n : BigInt(balance);
  }

  /**
   * What somebody can spend, and what is held. The read path.
   *
   * A person with no row has never held a coin, which is zero of each rather
   * than an absence: a caller that had to distinguish the two would eventually
   * render "unknown" where "none" was true.
   */
  async balanceOf(executor: Executor, userId: string): Promise<CoinBalance> {
    const rows = await executor
      .select({
        available: walletBalances.available,
        reserved: walletBalances.reserved,
      })
      .from(walletBalances)
      .where(eq(walletBalances.userId, userId))
      .limit(1);
    const row = rows[0];
    return {
      available: row?.available ?? 0n,
      reserved: row?.reserved ?? 0n,
    };
  }

  /**
   * Takes the row lock every spend is serialized by, creating it if needed.
   *
   * The `insert … on conflict do nothing` before the `for update` is what makes
   * a first-ever spend safe: two concurrent activations for somebody with no
   * balance row would otherwise both find nothing to lock and both proceed.
   * After this returns, the caller holds the row and every other spender for
   * this person waits.
   *
   * A transaction handle rather than any executor, deliberately. `for update`
   * outside a transaction is a lock released the instant the statement ends,
   * which is a lock that protects nothing, and the type is what stops that
   * being written by accident.
   */
  async lockBalance(
    executor: TransactionHandle,
    userId: string,
  ): Promise<CoinBalance> {
    const now = this.now();
    await executor
      .insert(walletBalances)
      .values({
        available: 0n,
        createdAt: now,
        reserved: 0n,
        updatedAt: now,
        userId,
        version: 1,
      })
      .onConflictDoNothing();
    const rows = await executor
      .select({
        available: walletBalances.available,
        reserved: walletBalances.reserved,
      })
      .from(walletBalances)
      .where(eq(walletBalances.userId, userId))
      .for('update')
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new CoinLedgerError('A coin balance could not be locked');
    }
    return { available: row.available, reserved: row.reserved };
  }

  /**
   * Moves the projection by two deltas, refusing anything that would go
   * negative.
   *
   * The refusal is the database's: `available` and `reserved` both carry a
   * `CHECK` that they are non-negative, so an overspend raises rather than
   * writing a negative balance somebody later reads as a very large unsigned
   * number. This method is only ever called with the row already locked by
   * {@link lockBalance}, in the same transaction as the posting that justifies
   * the movement.
   */
  async applyBalanceDelta(
    executor: TransactionHandle,
    input: {
      readonly availableDelta: bigint;
      readonly reservedDelta: bigint;
      readonly userId: string;
    },
  ): Promise<void> {
    await executor
      .update(walletBalances)
      .set({
        available: sql`${walletBalances.available} + ${input.availableDelta}`,
        reserved: sql`${walletBalances.reserved} + ${input.reservedDelta}`,
        updatedAt: this.now(),
        version: sql`${walletBalances.version} + 1`,
      })
      .where(eq(walletBalances.userId, input.userId));
  }

  /**
   * Everything that could make a posting meaningless, refused before it is one.
   *
   * Balance is checked here as well as by the deferred database trigger. The
   * trigger is the guarantee; this is the diagnosis, because a constraint
   * violation at commit names a transaction and not the line of code that
   * described it wrongly.
   */
  private validate(posting: CoinPosting): void {
    if (posting.entries.length < 2) {
      throw new CoinLedgerError(
        'A coin posting needs at least two entries to be balanced',
      );
    }
    let debits = 0n;
    let credits = 0n;
    for (const entry of posting.entries) {
      if (typeof entry.amount !== 'bigint') {
        throw new CoinLedgerError('A coin amount must be an integer of coins');
      }
      if (entry.amount <= 0n) {
        throw new CoinLedgerError(
          'A coin entry amount must be strictly positive; direction carries the sign',
        );
      }
      if (entry.amount > maximumWalletOperationCoins) {
        throw new CoinLedgerError(
          `A coin entry of ${entry.amount.toString()} exceeds what one operation may move`,
        );
      }
      if (isConsumerCategory(entry.account.category)) {
        if (entry.account.subjectId === undefined) {
          throw new CoinLedgerError(
            `A ${entry.account.category} entry must name a consumer`,
          );
        }
      } else if (entry.account.subjectId !== undefined) {
        throw new CoinLedgerError(
          `A ${entry.account.category} entry must not name a subject`,
        );
      }
      if (entry.direction === 'debit') debits += entry.amount;
      else credits += entry.amount;
    }
    if (debits !== credits) {
      throw new CoinLedgerError(
        `A coin posting must balance; debits ${debits.toString()} credits ${credits.toString()}`,
      );
    }
    if (debits < minimumStorableCoins || debits > maximumStorableCoins) {
      throw new CoinLedgerError('A coin posting is outside the storable range');
    }
  }
}
