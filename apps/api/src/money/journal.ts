import { createHash } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import type { DatabaseHandle, Executor } from '../database/executor.js';
import {
  journalCorrectionReason,
  type JournalTables,
  type JournalTransactionRow,
} from './journal-table.js';
import {
  addMoney,
  isPositiveMoney,
  money,
  moneyEquals,
  zeroMoney,
  type Money,
} from './money.js';
import type { JournalDirection, JournalSubjectType } from './policy.js';

/**
 * Posting to, and reading from, a balanced append-only journal.
 *
 * One instance per owner. It holds the tables the owner declared and knows
 * nothing about what the amounts mean: the vocabulary of accounts and reasons
 * belongs to BILLING or PAYOUTS, and the arithmetic belongs here.
 *
 * Every method takes an executor rather than opening its own transaction. A
 * posting is almost always the accounting half of a business transition, and
 * the two have to commit together or the books disagree with the state that
 * produced them.
 */

/** Which position an entry moves. Identity, never a name somebody typed. */
export interface JournalAccountRef {
  readonly category: string;
  /** Present exactly when the subject type is not `platform`. */
  readonly subjectId?: string;
  readonly subjectType: JournalSubjectType;
}

export interface JournalEntryInput {
  readonly account: JournalAccountRef;
  readonly amount: Money;
  readonly direction: JournalDirection;
}

export interface JournalPosting {
  /** Identity of the business event, unique within its type. */
  readonly businessReference: string;
  readonly businessType: string;
  readonly correctsTransactionId?: string;
  readonly correlationId?: string;
  readonly entries: readonly JournalEntryInput[];
  /** When the event happened, which is not when it is being recorded. */
  readonly occurredAt: Date;
  readonly reason: string;
}

export interface JournalPostingResult {
  /** True when this business event already had a transaction. */
  readonly alreadyPosted: boolean;
  readonly transactionId: string;
}

export interface JournalTransactionView {
  readonly entries: readonly {
    readonly accountId: string;
    readonly amount: Money;
    readonly direction: JournalDirection;
  }[];
  readonly transaction: JournalTransactionRow;
}

/**
 * A posting was rejected before it reached the database.
 *
 * These are programming errors in the calling domain rather than user input
 * problems: an unbalanced posting or a cross-currency entry is a bug in how a
 * financial event was described, and it should surface as one.
 */
export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalError';
  }
}

/**
 * The account identifier for one position, derived rather than allocated.
 *
 * A deterministic identifier makes "ensure this account exists" a single
 * idempotent insert with no read, and makes the same position carry the same
 * identifier in every environment, which is what lets a test assert against one
 * without seeding it first.
 *
 * UUID version 8 is the RFC 9562 slot for exactly this: an identifier whose
 * bits are defined by the application. The owner prefix is part of the hashed
 * input, so BILLING's platform revenue account and PAYOUTS' can never collide.
 */
export function journalAccountId(
  prefix: string,
  currency: string,
  account: JournalAccountRef,
): string {
  const digest = createHash('sha256')
    .update(
      `${prefix}|${account.category}|${currency}|${account.subjectId ?? ''}`,
      'utf8',
    )
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

function accountKey(currency: string, account: JournalAccountRef): string {
  return `${account.category}|${currency}|${account.subjectId ?? ''}`;
}

export class JournalStore {
  private readonly now: () => Date;

  private readonly prefix: string;

  private readonly tables: JournalTables;

  constructor(input: {
    readonly now?: () => Date;
    readonly prefix: string;
    readonly tables: JournalTables;
  }) {
    this.now = input.now ?? (() => new Date());
    this.prefix = input.prefix;
    this.tables = input.tables;
  }

  accountId(currency: string, account: JournalAccountRef): string {
    return journalAccountId(this.prefix, currency, account);
  }

  /**
   * Posts one business event, exactly once.
   *
   * The uniqueness of a business event is settled by PostgreSQL, not by looking
   * first: the insert carries `on conflict do nothing` against the business
   * identity, and a caller that gets no row back reads the transaction the
   * winner wrote. That is why fifty simultaneous postings of one event produce
   * one transaction and forty-nine `alreadyPosted` answers, with no lock and no
   * retry loop.
   *
   * A conflicting insert blocks until the other transaction settles. If it
   * committed, the follow-up read sees its row under `read committed`, which is
   * the isolation every executor here runs at. If it rolled back, PostgreSQL
   * completes this insert instead — so a crashed poster does not leave the
   * event unpostable.
   */
  async post(
    executor: Executor,
    posting: JournalPosting,
  ): Promise<JournalPostingResult> {
    const currency = this.validate(posting);
    const now = this.now();

    // Sorted so two concurrent postings that touch the same accounts take them
    // in the same order and cannot wait on each other.
    const accounts = [
      ...new Map(
        posting.entries.map((entry) => [
          accountKey(currency, entry.account),
          entry.account,
        ]),
      ),
    ].sort(([left], [right]) => (left < right ? -1 : 1));

    await executor
      .insert(this.tables.accounts)
      .values(
        accounts.map(([, account]) => ({
          category: account.category,
          createdAt: now,
          currency,
          id: this.accountId(currency, account),
          subjectId: account.subjectId ?? null,
          subjectType: account.subjectType,
        })),
      )
      .onConflictDoNothing();

    const transactionId = crypto.randomUUID();
    const inserted = await executor
      .insert(this.tables.transactions)
      .values({
        businessReference: posting.businessReference,
        businessType: posting.businessType,
        correctsTransactionId: posting.correctsTransactionId ?? null,
        correlationId: posting.correlationId ?? null,
        createdAt: now,
        currency,
        id: transactionId,
        occurredAt: posting.occurredAt,
        reason: posting.reason,
      })
      .onConflictDoNothing({
        target: [
          this.tables.transactions.businessType,
          this.tables.transactions.businessReference,
        ],
      })
      .returning({ id: this.tables.transactions.id });

    const row = inserted[0];
    if (row === undefined) {
      const existing = await this.findByBusinessEvent(
        executor,
        posting.businessType,
        posting.businessReference,
      );
      if (existing === undefined) {
        throw new JournalError(
          'A journal posting conflicted with an event that cannot be read back',
        );
      }
      return { alreadyPosted: true, transactionId: existing.id };
    }

    await executor.insert(this.tables.entries).values(
      posting.entries.map((entry) => ({
        accountId: this.accountId(currency, entry.account),
        amountMinor: entry.amount.amountMinor,
        createdAt: now,
        currency,
        direction: entry.direction,
        id: crypto.randomUUID(),
        transactionId,
      })),
    );

    return { alreadyPosted: false, transactionId };
  }

  async findByBusinessEvent(
    executor: Executor,
    businessType: string,
    businessReference: string,
  ): Promise<JournalTransactionRow | undefined> {
    const rows = await executor
      .select()
      .from(this.tables.transactions)
      .where(
        and(
          eq(this.tables.transactions.businessType, businessType),
          eq(this.tables.transactions.businessReference, businessReference),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The current position of one account, as a signed amount.
   *
   * Debits minus credits, always. Which sign is "good" for a given category is
   * an accounting question the owning domain answers; this returns the movement
   * and refuses to guess.
   *
   * Derived on every call rather than cached. A cached balance is a second
   * source of truth that a concurrency bug can corrupt without anything
   * noticing, and the entry index carries the direction and the amount so this
   * reads from the index rather than the heap.
   */
  async balanceOf(
    executor: Executor,
    currency: string,
    account: JournalAccountRef,
  ): Promise<Money> {
    const accountId = this.accountId(currency, account);
    const rows = await executor
      .select({
        // `sum` over `bigint` returns `numeric` in PostgreSQL, so this cannot
        // overflow however many entries an account accumulates. It is cast to
        // text because a numeric is not a JavaScript number and must never be
        // read as one.
        balance: sql<string>`coalesce(sum(case when ${this.tables.entries.direction} = 'debit' then ${this.tables.entries.amountMinor} else -${this.tables.entries.amountMinor} end), 0)::text`,
      })
      .from(this.tables.entries)
      .where(eq(this.tables.entries.accountId, accountId));
    const balance = rows[0]?.balance;
    return balance === undefined
      ? zeroMoney(currency)
      : money(BigInt(balance), currency);
  }

  async readTransaction(
    executor: Executor,
    transactionId: string,
  ): Promise<JournalTransactionView | undefined> {
    const transactions = await executor
      .select()
      .from(this.tables.transactions)
      .where(eq(this.tables.transactions.id, transactionId))
      .limit(1);
    const transaction = transactions[0];
    if (transaction === undefined) return undefined;
    const entries = await executor
      .select()
      .from(this.tables.entries)
      .where(eq(this.tables.entries.transactionId, transactionId));
    return {
      entries: entries.map((entry) => ({
        accountId: entry.accountId,
        amount: money(entry.amountMinor, entry.currency),
        direction: entry.direction,
      })),
      transaction,
    };
  }

  transaction<T>(
    database: DatabaseHandle,
    work: (executor: Executor) => Promise<T>,
  ): Promise<T> {
    return database.transaction(async (executor) => work(executor));
  }

  /**
   * Rejects a posting that could never be sound, before any row is written.
   *
   * The database enforces all of this too — that is what the deferred balance
   * trigger and the composite currency keys are for — but a constraint
   * violation at commit is a poor description of "you built a transaction whose
   * debits and credits differ by three". These checks exist for the error
   * message; the database's exist for the guarantee.
   */
  private validate(posting: JournalPosting): string {
    if (posting.entries.length < 2) {
      throw new JournalError(
        'A balanced journal transaction needs at least two entries',
      );
    }
    const first = posting.entries[0];
    if (first === undefined) {
      throw new JournalError('A journal transaction needs entries');
    }
    const currency = first.amount.currency;
    let debits = zeroMoney(currency);
    let credits = zeroMoney(currency);
    for (const entry of posting.entries) {
      if (entry.amount.currency !== currency) {
        throw new JournalError(
          `A journal transaction is single-currency; found ${currency} and ${entry.amount.currency}`,
        );
      }
      if (!isPositiveMoney(entry.amount)) {
        throw new JournalError(
          'A journal entry amount must be strictly positive; direction carries the sign',
        );
      }
      if (
        (entry.account.subjectType === 'platform') !==
        (entry.account.subjectId === undefined)
      ) {
        throw new JournalError(
          'A platform account has no subject and every other account has one',
        );
      }
      if (entry.direction === 'debit') {
        debits = addMoney(debits, entry.amount);
      } else {
        credits = addMoney(credits, entry.amount);
      }
    }
    if (!moneyEquals(debits, credits)) {
      throw new JournalError(
        `A journal transaction must balance; debits ${debits.amountMinor.toString()} credits ${credits.amountMinor.toString()}`,
      );
    }
    if (
      (posting.reason === journalCorrectionReason) !==
      (posting.correctsTransactionId !== undefined)
    ) {
      throw new JournalError(
        'A correction names the transaction it corrects, and nothing else may',
      );
    }
    return currency;
  }
}
