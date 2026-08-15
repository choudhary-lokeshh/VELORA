import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import { outboxTable } from '../events/outbox-table.js';
import { journalTables } from '../money/journal-table.js';
import { currencyCodePattern } from '../money/policy.js';
import {
  maximumPayoutIdempotencyKeyLength,
  maximumPayoutReferenceLength,
  payoutFailureReasons,
  payoutInstructionStates,
  payoutsJournalCategories,
  payoutsJournalPrefix,
  payoutsJournalReasons,
  recipientStatuses,
  type PayoutFailureReason,
  type PayoutInstructionState,
  type RecipientStatus,
} from './policy.js';

/**
 * PAYOUTS-owned persistence.
 *
 * `docs/architecture/03-domain-boundaries.md` gives this domain creator payable
 * balances, holds, payout readiness, the disbursement lifecycle, and payout
 * reconciliation — and explicitly not charging customers, deciding content
 * entitlement, or validating creator identity itself. Everything here lives
 * under `payouts_` and nothing outside this domain writes it.
 *
 * The journal is the same shared shape BILLING instantiates, under this
 * domain's own prefix. [ADR-0011](../../../../docs/decisions/ADR-0011-payments-payouts.md)
 * forbids one ledger across the two: money collected from a consumer and money
 * owed to a creator are different obligations with different lifecycles and
 * different reversal rules, and one combined book would let a refund and a
 * payout reversal be posted as though they were the same event — which is the
 * class of error that balances perfectly and means nothing.
 *
 * This book learns about revenue from a fact BILLING publishes, never by
 * reading a `billing_` row. `docs/architecture/10-money-flow.md` names that
 * explicitly: a PAYOUTS balance is never derived from a BILLING row read
 * directly, and never from a mutable balance column anywhere.
 */
const journal = journalTables(payoutsJournalPrefix, {
  categories: payoutsJournalCategories,
  reasons: payoutsJournalReasons,
});

export const payoutsJournalAccounts = journal.accounts;
export const payoutsJournalTransactions = journal.transactions;
export const payoutsJournalEntries = journal.entries;

export const payoutsJournalTables = journal;

/**
 * What a payout provider knows about one creator, and nothing more.
 *
 * The whole point of this table is what is absent from it. There is no bank
 * account number, no routing or sort code, no IBAN, no government identifier,
 * no tax identifier, no date of birth, no address, and no identity document —
 * not encrypted, not tokenized, not redacted: absent. Onboarding happens on the
 * provider's own hosted flow under the provider's own compliance obligations,
 * and what Velora keeps is a reference to the provider's record plus a
 * normalized answer about what the provider says it can do.
 *
 * A column that exists is a column something eventually fills, which is why
 * [ADR-0021](../../../../docs/decisions/ADR-0021-monetization-money-architecture.md)
 * states the rule as an absence of fields rather than as validation.
 *
 * One row per creator: a second payout recipient for one creator would make
 * "where does this creator's money go" a question with two answers.
 */
export const payoutsRecipients = pgTable(
  'payouts_recipients',
  {
    /** When the provider's own answer was last read, for staleness. */
    capabilityCheckedAt: timestamptz('capability_checked_at'),
    createdAt: timestamptz('created_at').notNull(),
    /** Opaque CREATORS reference. No foreign key, by ownership rule. */
    creatorId: uuid('creator_id').primaryKey(),
    provider: text('provider').notNull(),
    /** The provider's identifier for its own record. Null before onboarding. */
    providerReference: text('provider_reference'),
    status: text('status').notNull().$type<RecipientStatus>(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // One provider record maps to one creator. Two creators sharing a recipient
    // reference would mean one person's money reaching another's account.
    uniqueIndex('payouts_recipients_provider_uk')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    check(
      'payouts_recipients_status_check',
      inList(table.status, recipientStatuses),
    ),
    // A provider cannot have said anything about a recipient it has no record
    // of, so anything past `absent` must name one.
    check(
      'payouts_recipients_reference_shape_check',
      sql`${table.status} = 'absent' or ${table.providerReference} is not null`,
    ),
    check(
      'payouts_recipients_reference_check',
      sql`${table.providerReference} is null or ${lengthBetween(table.providerReference, 1, maximumPayoutReferenceLength)}`,
    ),
    check('payouts_recipients_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * One instruction to send one creator money.
 *
 * The row exists, and its reservation is posted, before any provider is
 * contacted. That ordering is the design: a process that dies between
 * committing the reservation and hearing the provider's answer leaves a durable
 * record reconciliation can resolve, where the reverse order would leave money
 * sent that Velora has no record of.
 *
 * The amount is bounded by what the journal says a creator may claim, not by a
 * column. `docs/architecture/10-money-flow.md` forbids a single mutable balance
 * column standing as authoritative truth for a creator's money, so the
 * reservation is an accounting transaction — visible to every replica that
 * reads the book — rather than a decrement somewhere.
 */
export const payoutsInstructions = pgTable(
  'payouts_instructions',
  {
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    correlationId: text('correlation_id'),
    createdAt: timestamptz('created_at').notNull(),
    /** Opaque CREATORS reference for the creator being paid. */
    creatorId: uuid('creator_id').notNull(),
    currency: text('currency').notNull(),
    failureReason: text('failure_reason').$type<PayoutFailureReason>(),
    id: uuid('id').primaryKey(),
    /** The caller's key, scoped to the creator rather than globally. */
    idempotencyKey: text('idempotency_key').notNull(),
    lastProviderSyncAt: timestamptz('last_provider_sync_at'),
    provider: text('provider').notNull(),
    /** Velora's key for the instruction. Unique platform-wide, forever. */
    providerIdempotencyKey: text('provider_idempotency_key').notNull(),
    providerReference: text('provider_reference'),
    /** Opaque session reference of whoever asked. Never a name. */
    requestedBy: text('requested_by').notNull(),
    state: text('state').notNull().$type<PayoutInstructionState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // The idempotency guarantee. A double-submitted request, a retried call,
    // and a client that reconnected all resolve to one instruction because the
    // database admits one, not because a handler looked first.
    uniqueIndex('payouts_instructions_idempotency_uk').on(
      table.creatorId,
      table.idempotencyKey,
    ),
    uniqueIndex('payouts_instructions_provider_key_uk').on(
      table.providerIdempotencyKey,
    ),
    uniqueIndex('payouts_instructions_provider_reference_uk')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    index('payouts_instructions_creator_idx').on(
      table.creatorId,
      table.createdAt,
      table.id,
    ),
    // The reconciliation sweep: instructions still in flight, oldest first.
    index('payouts_instructions_unsettled_idx')
      .on(table.updatedAt, table.id)
      .where(sql`${table.state} in ('requested', 'reserved', 'submitted')`),
    check(
      'payouts_instructions_state_check',
      inList(table.state, payoutInstructionStates),
    ),
    check('payouts_instructions_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'payouts_instructions_currency_check',
      sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
    ),
    check(
      'payouts_instructions_failure_reason_check',
      sql`${table.failureReason} is null or ${inList(table.failureReason, payoutFailureReasons)}`,
    ),
    check(
      'payouts_instructions_failure_shape_check',
      sql`${table.failureReason} is null or ${table.state} in ('failed', 'reversed')`,
    ),
    // Nothing may claim money left without naming the provider object that sent
    // it. This is the constraint that makes a fabricated payout impossible to
    // write, whatever a service or an operator believes.
    check(
      'payouts_instructions_paid_reference_check',
      sql`${table.state} <> 'paid' or ${table.providerReference} is not null`,
    ),
    check(
      'payouts_instructions_idempotency_key_check',
      lengthBetween(table.idempotencyKey, 8, maximumPayoutIdempotencyKeyLength),
    ),
    check(
      'payouts_instructions_provider_key_check',
      lengthBetween(
        table.providerIdempotencyKey,
        8,
        maximumPayoutReferenceLength,
      ),
    ),
    check(
      'payouts_instructions_provider_reference_check',
      sql`${table.providerReference} is null or ${lengthBetween(table.providerReference, 1, maximumPayoutReferenceLength)}`,
    ),
    check(
      'payouts_instructions_requested_by_check',
      lengthBetween(table.requestedBy, 1, 200),
    ),
    check('payouts_instructions_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * PAYOUTS' transactional outbox.
 *
 * The seam BILLING learns through. A disbursement and the fact that says so are
 * written by the same transaction, so a creator who was paid and a customer-money
 * book that still thinks it owes them cannot both exist for longer than the
 * relay takes. The same shape every other producer uses, so it inherits the
 * lease, retry, and dead-letter behaviour rather than inventing a financial
 * variant.
 */
export const payoutsOutbox = outboxTable('payouts_outbox');
