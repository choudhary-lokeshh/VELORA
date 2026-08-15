import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import {
  currencyCodePattern,
  journalDirections,
  journalSubjectTypes,
  maximumBusinessReferenceLength,
  type JournalDirection,
  type JournalSubjectType,
} from './policy.js';

/**
 * A balanced, append-only financial journal, declared once and owned per
 * domain.
 *
 * [ADR-0011](../../../../docs/decisions/ADR-0011-payments-payouts.md) requires
 * "owner-specific append-only balanced journals" and forbids a shared ledger
 * outright: BILLING owns customer money and PAYOUTS owns creator liability,
 * and neither may write the other's rows. That is why this is a factory rather
 * than one table. What is shared is the shape and the invariants; the storage
 * is not.
 *
 * The same reasoning `src/events/outbox-table.ts` uses. A second owner
 * inherits balance enforcement, immutability, and currency agreement instead
 * of writing a slightly different version of them.
 *
 * Three invariants are enforced by PostgreSQL rather than by the code that
 * writes here, because an accounting rule that only application code upholds is
 * an accounting rule one bug away from being false:
 *
 * - **Currency agreement.** An entry's currency is a foreign key into both its
 *   account and its transaction, so an entry in a currency other than the one
 *   its transaction is denominated in cannot be inserted at all. This is why
 *   `currency` is repeated on the entry rather than being read through a join:
 *   the duplication is what makes the composite foreign key expressible.
 * - **Balance.** A deferred constraint trigger checks, at commit, that debits
 *   equal credits for every transaction touched. Deferred because the entries
 *   arrive after the transaction row and a check that ran per statement would
 *   reject the first one.
 * - **Immutability.** Triggers refuse `UPDATE` and `DELETE` on every table
 *   here, and refuse an entry inserted by any transaction other than the one
 *   that created the journal transaction it belongs to. Without that last
 *   rule a posted transaction could be silently extended afterwards by a pair
 *   of entries that balance on their own — a mutation that no update trigger
 *   would see. A correction is a new balanced transaction that names the one
 *   it corrects, so the books can be replayed and no repair can hide what it
 *   repaired.
 *
 * Those triggers are created by the migration rather than declared here;
 * `drizzle-kit` does not model triggers, and a schema comment that promised
 * them without creating them would be worse than nothing.
 *
 * One guarantee is deliberately outside the schema: `TRUNCATE` fires no row
 * trigger, so the append-only property assumes the application's database role
 * does not hold that privilege. That is a deployment control, recorded in
 * `docs/domains/billing.md`, not something a table can assert about itself.
 */

/** The reason a corrective transaction carries. Every owner must accept it. */
export const journalCorrectionReason = 'correction';

/** Shape of a business event reference: lower-case, dotted, versioned. */
export const journalBusinessTypePattern = '^[a-z][a-z0-9_.]{1,63}$';

export interface JournalTableOptions {
  /** Account categories this owner recognizes. Never a shared vocabulary. */
  readonly categories: readonly string[];
  /** Reasons a transaction may carry. Must include the correction reason. */
  readonly reasons: readonly string[];
}

export type JournalTables = ReturnType<typeof journalTables>;
export type JournalAccountRow = JournalTables['accounts']['$inferSelect'];
export type JournalTransactionRow =
  JournalTables['transactions']['$inferSelect'];
export type JournalEntryRow = JournalTables['entries']['$inferSelect'];

export function journalTables(prefix: string, options: JournalTableOptions) {
  if (!options.reasons.includes(journalCorrectionReason)) {
    throw new Error(
      `Journal ${prefix} must accept the ${journalCorrectionReason} reason`,
    );
  }

  /**
   * A position the owner keeps money in.
   *
   * Identity is the category, the currency, and the subject — never a name a
   * human typed. One account per currency, so a "creator payable" position
   * cannot accidentally hold two currencies and be summed into a number that
   * means nothing.
   */
  const accounts = pgTable(
    `${prefix}_journal_accounts`,
    {
      category: text('category').notNull(),
      createdAt: timestamptz('created_at').notNull(),
      currency: text('currency').notNull(),
      id: uuid('id').primaryKey(),
      /** Opaque cross-domain reference. Null exactly for platform accounts. */
      subjectId: uuid('subject_id'),
      subjectType: text('subject_type').notNull().$type<JournalSubjectType>(),
    },
    (table) => [
      // The foreign-key target that makes currency agreement enforceable.
      unique(`${prefix}_journal_accounts_currency_uk`).on(
        table.id,
        table.currency,
      ),
      // Two partial indexes rather than one over a nullable column: PostgreSQL
      // treats NULLs as distinct by default, so a single index would happily
      // admit two platform accounts for the same category and currency.
      uniqueIndex(`${prefix}_journal_accounts_platform_uk`)
        .on(table.category, table.currency)
        .where(sql`${table.subjectId} is null`),
      uniqueIndex(`${prefix}_journal_accounts_subject_uk`)
        .on(table.category, table.currency, table.subjectId)
        .where(sql`${table.subjectId} is not null`),
      index(`${prefix}_journal_accounts_subject_idx`)
        .on(table.subjectId, table.currency)
        .where(sql`${table.subjectId} is not null`),
      check(
        `${prefix}_journal_accounts_category_check`,
        inList(table.category, options.categories),
      ),
      check(
        `${prefix}_journal_accounts_subject_type_check`,
        inList(table.subjectType, journalSubjectTypes),
      ),
      check(
        `${prefix}_journal_accounts_currency_check`,
        sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
      ),
      // A platform position belongs to nobody and everything else belongs to
      // somebody. Without this a creator account could exist with no creator.
      check(
        `${prefix}_journal_accounts_subject_shape_check`,
        sql`(${table.subjectType} = 'platform') = (${table.subjectId} is null)`,
      ),
    ],
  );

  /**
   * One financial event, in one currency.
   *
   * Single-currency by construction. A conversion is two transactions with an
   * explicit rate between them, never one transaction whose two halves are
   * denominated differently and therefore balance only if somebody believed a
   * rate that is not recorded.
   *
   * `businessType` plus `businessReference` is the idempotency identity: one
   * business event posts at most one transaction, decided by the unique index
   * below rather than by a caller checking first.
   */
  const transactions = pgTable(
    `${prefix}_journal_transactions`,
    {
      /** External identity of the event this posting accounts for. */
      businessReference: text('business_reference').notNull(),
      businessType: text('business_type').notNull(),
      /** The transaction this one reverses or repairs, for a correction. */
      correctsTransactionId: uuid('corrects_transaction_id'),
      correlationId: text('correlation_id'),
      createdAt: timestamptz('created_at').notNull(),
      currency: text('currency').notNull(),
      id: uuid('id').primaryKey(),
      /** When the event happened, which is not when it was recorded. */
      occurredAt: timestamptz('occurred_at').notNull(),
      reason: text('reason').notNull(),
    },
    (table) => [
      unique(`${prefix}_journal_transactions_currency_uk`).on(
        table.id,
        table.currency,
      ),
      // The idempotency guarantee. Fifty concurrent postings of one event
      // produce one row because PostgreSQL admits one, not because the losers
      // looked first.
      uniqueIndex(`${prefix}_journal_transactions_event_uk`).on(
        table.businessType,
        table.businessReference,
      ),
      index(`${prefix}_journal_transactions_occurred_idx`).on(
        table.occurredAt,
        table.id,
      ),
      index(`${prefix}_journal_transactions_corrects_idx`)
        .on(table.correctsTransactionId)
        .where(sql`${table.correctsTransactionId} is not null`),
      // Composite, so a correction is denominated in the same currency as the
      // transaction it repairs. A EUR transaction "correcting" a USD one would
      // balance perfectly within itself and mean nothing. `MATCH SIMPLE` makes
      // the whole key inert while `corrects_transaction_id` is null, which is
      // exactly the behaviour an ordinary posting needs.
      foreignKey({
        columns: [table.correctsTransactionId, table.currency],
        foreignColumns: [table.id, table.currency],
        name: `${prefix}_journal_transactions_corrects_fk`,
      }),
      check(
        `${prefix}_journal_transactions_reason_check`,
        inList(table.reason, options.reasons),
      ),
      check(
        `${prefix}_journal_transactions_currency_check`,
        sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
      ),
      check(
        `${prefix}_journal_transactions_business_type_check`,
        sql`${table.businessType} ~ ${sql.raw(`'${journalBusinessTypePattern}'`)}`,
      ),
      check(
        `${prefix}_journal_transactions_business_reference_check`,
        lengthBetween(
          table.businessReference,
          1,
          maximumBusinessReferenceLength,
        ),
      ),
      // A correction names what it corrects, and nothing else does. Without the
      // second half, an ordinary posting could quietly claim to reverse one.
      check(
        `${prefix}_journal_transactions_correction_shape_check`,
        sql`(${table.reason} = ${sql.raw(`'${journalCorrectionReason}'`)}) = (${table.correctsTransactionId} is not null)`,
      ),
      check(
        `${prefix}_journal_transactions_self_correction_check`,
        sql`${table.correctsTransactionId} is null or ${table.correctsTransactionId} <> ${table.id}`,
      ),
    ],
  );

  /**
   * One side of one transaction.
   *
   * The amount is strictly positive and the direction says which way it moved.
   * A signed amount would have made "a credit of minus five" expressible, which
   * is the same movement written two ways and therefore a reconciliation
   * problem nobody would notice until the totals were already wrong.
   */
  const entries = pgTable(
    `${prefix}_journal_entries`,
    {
      accountId: uuid('account_id').notNull(),
      amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
      createdAt: timestamptz('created_at').notNull(),
      /** Repeated from the transaction so currency agreement is a foreign key. */
      currency: text('currency').notNull(),
      direction: text('direction').notNull().$type<JournalDirection>(),
      id: uuid('id').primaryKey(),
      transactionId: uuid('transaction_id').notNull(),
    },
    (table) => [
      foreignKey({
        columns: [table.transactionId, table.currency],
        foreignColumns: [transactions.id, transactions.currency],
        name: `${prefix}_journal_entries_transaction_fk`,
      }),
      foreignKey({
        columns: [table.accountId, table.currency],
        foreignColumns: [accounts.id, accounts.currency],
        name: `${prefix}_journal_entries_account_fk`,
      }),
      // The balance projection reads every entry for one account and needs the
      // direction and the amount to answer. Carrying both in the index lets it
      // stay index-only rather than fetching each row from the heap.
      index(`${prefix}_journal_entries_account_idx`).on(
        table.accountId,
        table.direction,
        table.amountMinor,
      ),
      index(`${prefix}_journal_entries_transaction_idx`).on(
        table.transactionId,
      ),
      check(
        `${prefix}_journal_entries_direction_check`,
        inList(table.direction, journalDirections),
      ),
      check(
        `${prefix}_journal_entries_amount_check`,
        sql`${table.amountMinor} > 0`,
      ),
    ],
  );

  return { accounts, entries, transactions };
}
