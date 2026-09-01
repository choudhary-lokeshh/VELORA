import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
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
  livePreferenceEntitlementStates,
  livePremiumPreferenceKinds,
  maximumWalletBusinessReferenceLength,
  regionCodePattern,
  walletAccountCategories,
  walletDirections,
  walletSubjectTypes,
  walletTransactionReasons,
  type LivePreferenceEntitlementState,
  type LivePremiumPreferenceKind,
  type WalletAccountCategory,
  type WalletDirection,
  type WalletSubjectType,
} from './policy.js';

/**
 * WALLET-owned persistence.
 *
 * This domain owns one thing: how many coins somebody has, how they got them,
 * what is held against an open commitment, and what became of every one of
 * those movements. It owns no principal, no account, no relationship, no
 * payment, no price, and no match — those belong to AUTH, USERS, DISCOVERY,
 * BILLING, and LIVE, and this domain asks each of them rather than storing a
 * copy of any answer.
 *
 * **It is deliberately not BILLING's journal.** ADR-0011 forbids a shared
 * ledger and requires owner-specific append-only balanced journals, and this is
 * one — but it is denominated in coins, which are whole-number entitlement
 * units with no ISO 4217 currency. BILLING's journal is denominated in money
 * and enforces currency agreement between an entry, its account, and its
 * transaction; a coin cannot satisfy that and must not be given a fake currency
 * code to pretend it can. The two books meet at exactly one place: a payment
 * BILLING settles publishes a fact, and an issuance here consumes it.
 *
 * Three invariants are enforced by PostgreSQL rather than by the code that
 * writes here, on the same reasoning `src/money/journal-table.ts` records —
 * an accounting rule only application code upholds is one bug away from being
 * false:
 *
 * - **Balance.** A deferred constraint trigger checks, at commit, that debits
 *   equal credits for every transaction touched.
 * - **Immutability.** Triggers refuse `UPDATE` and `DELETE` on the accounts,
 *   transactions, and entries below, and refuse an entry inserted by any
 *   transaction other than the one that created the transaction it belongs to.
 *   A correction is a new balanced transaction naming the one it corrects.
 * - **Non-negativity.** The projected balance row carries `CHECK` constraints
 *   that no available or reserved position may go below zero, so an overspend
 *   is refused by the database rather than by whichever code path happened to
 *   read the balance first.
 *
 * Those triggers are created by the migration; `drizzle-kit` does not model
 * triggers, and a schema comment promising them without creating them would be
 * worse than nothing.
 *
 * Retention: nothing here expires. A financial record that vanished would make
 * a dispute unanswerable, and no correctness rule depends on a row being
 * physically deleted.
 */

/**
 * A position coins are held in.
 *
 * Identity is the category and the subject, never a name a human typed, and the
 * identifier is derived from those rather than allocated — so "ensure this
 * account exists" is one idempotent insert with no read, and the same position
 * carries the same identifier in every environment.
 */
export const walletAccounts = pgTable(
  'wallet_accounts',
  {
    category: text('category').notNull().$type<WalletAccountCategory>(),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    /** Opaque cross-domain reference. Null exactly for platform accounts. */
    subjectId: uuid('subject_id'),
    subjectType: text('subject_type').notNull().$type<WalletSubjectType>(),
  },
  (table) => [
    uniqueIndex('wallet_accounts_identity_uk').on(
      table.category,
      sql`coalesce(${table.subjectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    check(
      'wallet_accounts_category_check',
      inList(table.category, walletAccountCategories),
    ),
    check(
      'wallet_accounts_subject_type_check',
      inList(table.subjectType, walletSubjectTypes),
    ),
    // A platform position has no subject and a consumer position must have one.
    // Without this a consumer account with a null subject would silently be a
    // second platform account that every consumer's balance summed into.
    check(
      'wallet_accounts_subject_shape_check',
      sql`(${table.subjectType} = 'platform') = (${table.subjectId} is null)`,
    ),
  ],
);

/**
 * One balanced movement of coins, and why it happened.
 *
 * `businessType` and `businessReference` together are the idempotency key. A
 * redelivered purchase fact, a retried activation, and a duplicated sweep all
 * collide on the unique index below and produce one transaction — which is what
 * makes "a retry never double-charges" a property of the database rather than
 * of a prior read two concurrent retries would both pass.
 */
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    /** Identity of the business event, unique within its type. */
    businessReference: text('business_reference').notNull(),
    businessType: text('business_type').notNull(),
    /** Names the transaction this one repairs. Never an edit. */
    correctsTransactionId: uuid('corrects_transaction_id'),
    correlationId: text('correlation_id'),
    id: uuid('id').primaryKey(),
    /** When the event happened, which is not when it is being recorded. */
    occurredAt: timestamptz('occurred_at').notNull(),
    reason: text('reason').notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('wallet_transactions_business_uk').on(
      table.businessType,
      table.businessReference,
    ),
    uniqueIndex('wallet_transactions_sequence_uk').on(table.sequence),
    index('wallet_transactions_occurred_idx').on(table.occurredAt),
    foreignKey({
      columns: [table.correctsTransactionId],
      foreignColumns: [table.id],
      name: 'wallet_transactions_corrects_fk',
    }),
    check(
      'wallet_transactions_reason_check',
      inList(table.reason, walletTransactionReasons),
    ),
    check(
      'wallet_transactions_business_type_check',
      sql`${table.businessType} ~ '^[a-z][a-z0-9_.]{1,63}$'`,
    ),
    check(
      'wallet_transactions_business_reference_check',
      lengthBetween(
        table.businessReference,
        1,
        maximumWalletBusinessReferenceLength,
      ),
    ),
  ],
);

/**
 * One side of one movement.
 *
 * Direction plus a strictly positive amount rather than a signed amount, so
 * "which way did this go" is a value the database can group by and a malformed
 * entry cannot express itself as a negative credit.
 */
export const walletEntries = pgTable(
  'wallet_entries',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => walletAccounts.id),
    amount: bigint('amount', { mode: 'bigint' }).notNull(),
    direction: text('direction').notNull().$type<WalletDirection>(),
    id: uuid('id').primaryKey(),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => walletTransactions.id),
  },
  (table) => [
    index('wallet_entries_transaction_idx').on(table.transactionId),
    // The projection's rebuild query, and the proof that the projection is
    // right: every entry for one account, in order.
    index('wallet_entries_account_idx').on(table.accountId, table.sequence),
    uniqueIndex('wallet_entries_sequence_uk').on(table.sequence),
    check(
      'wallet_entries_direction_check',
      inList(table.direction, walletDirections),
    ),
    // Strictly positive. Zero is not a movement and negative is a direction.
    check('wallet_entries_amount_check', sql`${table.amount} > 0`),
  ],
);

/**
 * What somebody can spend right now, and what is held against a commitment.
 *
 * A projection of the entries above and never an independent truth: every write
 * to this table happens in the same transaction as the posting that justifies
 * it, and `test/integration/wallet-ledger.test.ts` rebuilds every row from the
 * entries and asserts they agree.
 *
 * It exists for two reasons a sum over entries cannot serve. It is the row a
 * spend takes a lock on, which is what serializes two concurrent activations
 * without an advisory lock nobody would remember to take. And it carries the
 * `CHECK` constraints that make an overspend impossible at the database — a
 * balance derived by summing has nothing to attach a constraint to, so
 * "never negative" would live only in whichever query happened to run first.
 */
export const walletBalances = pgTable(
  'wallet_balances',
  {
    /** Spendable. Never negative, and the database says so. */
    available: bigint('available', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    createdAt: timestamptz('created_at').notNull(),
    /** Committed to an open activation. Neither spendable nor spent. */
    reserved: bigint('reserved', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    updatedAt: timestamptz('updated_at').notNull(),
    userId: uuid('user_id').primaryKey(),
    /** Advanced by every mutation, so a stale read is detectable. */
    version: bigint('version', { mode: 'number' }).notNull().default(1),
  },
  (table) => [
    check('wallet_balances_available_check', sql`${table.available} >= 0`),
    check('wallet_balances_reserved_check', sql`${table.reserved} >= 0`),
    check('wallet_balances_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * One person's paid, bounded window of narrowed matching.
 *
 * It is a *commitment*, not a permission to match: every eligibility, standing,
 * block, enforcement, and RTC predicate the free matcher asks is asked
 * identically while this is active, in the same order, and any one of them
 * refusing produces no encounter regardless of what was paid. There is
 * deliberately no column here that could be read as a grant.
 *
 * The preference itself is stored rather than referenced, because it is what
 * was bought: a person who activated a window narrowed to one region and then
 * changed their mind must not have the thing they paid for silently redefined.
 *
 * `reservationTransactionId` and `settlementTransactionId` are what bind this
 * row to the books. A row in a terminal state without a settlement, or an
 * active one without a reservation, is a state where the product and the ledger
 * disagree about whether somebody has been charged — so the database refuses
 * both.
 */
export const livePreferenceEntitlements = pgTable(
  'wallet_live_preference_entitlements',
  {
    /** What was actually charged, in coins. Never re-derived from policy. */
    coins: bigint('coins', { mode: 'bigint' }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    /** The encounter that consumed this window, once one has. */
    encounterId: uuid('encounter_id'),
    /** When the window closes. Evaluated on read as well as swept. */
    expiresAt: timestamptz('expires_at').notNull(),
    id: uuid('id').primaryKey(),
    /** Which supported premium preference this window applies. */
    preferenceKind: text('preference_kind')
      .notNull()
      .$type<LivePremiumPreferenceKind>(),
    /** The declared region this window narrows to. ISO 3166-1 alpha-2. */
    preferenceRegion: text('preference_region'),
    reservationTransactionId: uuid('reservation_transaction_id').notNull(),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    settledAt: timestamptz('settled_at'),
    settlementTransactionId: uuid('settlement_transaction_id'),
    state: text('state').notNull().$type<LivePreferenceEntitlementState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (table) => [
    // One open window per person. Activating twice is idempotent by the
    // database rather than by whichever check ran first, and a second
    // activation can never be funded by coins already committed to the first.
    uniqueIndex('wallet_live_preference_active_uk')
      .on(table.userId)
      .where(sql`${table.state} = 'active'`),
    // The sweep's query: open windows whose time is up.
    index('wallet_live_preference_expiry_idx')
      .on(table.expiresAt)
      .where(sql`${table.state} = 'active'`),
    // "How many has this person activated lately", which the bound asks.
    index('wallet_live_preference_user_recency_idx').on(
      table.userId,
      table.createdAt,
    ),
    uniqueIndex('wallet_live_preference_sequence_uk').on(table.sequence),
    // One window per reservation and one per settlement, so a posting can never
    // be claimed by two activations.
    unique('wallet_live_preference_reservation_uk').on(
      table.reservationTransactionId,
    ),
    uniqueIndex('wallet_live_preference_settlement_uk').on(
      table.settlementTransactionId,
    ),
    check(
      'wallet_live_preference_state_check',
      inList(table.state, livePreferenceEntitlementStates),
    ),
    check(
      'wallet_live_preference_kind_check',
      inList(table.preferenceKind, livePremiumPreferenceKinds),
    ),
    // A region preference names a region, and nothing else may. The day a
    // second preference kind exists this is what stops it inheriting a column
    // that means something else.
    check(
      'wallet_live_preference_region_shape_check',
      sql`(${table.preferenceKind} = 'region') = (${table.preferenceRegion} is not null)`,
    ),
    check(
      'wallet_live_preference_region_check',
      sql`${table.preferenceRegion} is null or ${table.preferenceRegion} ~ ${sql.raw(`'${regionCodePattern}'`)}`,
    ),
    check('wallet_live_preference_coins_check', sql`${table.coins} > 0`),
    check(
      'wallet_live_preference_expiry_order_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    // Settled and terminal are the same fact. An active window has neither a
    // settlement transaction nor a settled instant; a finished one has both.
    check(
      'wallet_live_preference_settlement_shape_check',
      sql`(${table.state} <> 'active') = (${table.settlementTransactionId} is not null)`,
    ),
    check(
      'wallet_live_preference_settled_shape_check',
      sql`(${table.settledAt} is null) = (${table.settlementTransactionId} is null)`,
    ),
    // Only a captured window names an encounter, and a captured one must. A
    // released window naming one would be a record of somebody being charged
    // for a match they were not charged for.
    check(
      'wallet_live_preference_encounter_shape_check',
      sql`(${table.state} = 'captured') = (${table.encounterId} is not null)`,
    ),
  ],
);

/**
 * A purchase this domain has already turned into coins.
 *
 * The idempotency record for acquisition, kept separately from the ledger
 * because the question it answers is different: the ledger says a transaction
 * exists, and this says which external purchase produced it and which channel
 * it arrived through. A Play purchase token and a BILLING payment identifier
 * are different namespaces and must never collide, so the channel is part of
 * the identity.
 *
 * **Nothing here is a receipt.** No purchase payload, signature, price,
 * account, or device identifier is stored: what is durable is that a purchase
 * with this identity was accepted once, by which channel, and what it credited.
 */
export const walletAcquisitions = pgTable(
  'wallet_acquisitions',
  {
    /** `web` or `android`. Which mechanism proved the purchase. */
    channel: text('channel').notNull(),
    coins: bigint('coins', { mode: 'bigint' }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    /** The external purchase's own identifier, within its channel. */
    purchaseReference: text('purchase_reference').notNull(),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => walletTransactions.id),
    userId: uuid('user_id').notNull(),
  },
  (table) => [
    uniqueIndex('wallet_acquisitions_purchase_uk').on(
      table.channel,
      table.purchaseReference,
    ),
    uniqueIndex('wallet_acquisitions_transaction_uk').on(table.transactionId),
    index('wallet_acquisitions_user_idx').on(table.userId, table.createdAt),
    uniqueIndex('wallet_acquisitions_sequence_uk').on(table.sequence),
    check('wallet_acquisitions_coins_check', sql`${table.coins} > 0`),
    check(
      'wallet_acquisitions_channel_check',
      inList(table.channel, ['web', 'android']),
    ),
    check(
      'wallet_acquisitions_reference_check',
      lengthBetween(
        table.purchaseReference,
        1,
        maximumWalletBusinessReferenceLength,
      ),
    ),
  ],
);
