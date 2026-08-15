import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, lengthBetween, timestamptz } from '../database/columns.js';
import { journalTables } from '../money/journal-table.js';
import { currencyCodePattern } from '../money/policy.js';
import {
  billingIntervals,
  commercialModes,
  commercialResourceTypes,
  offerStates,
  priceStates,
  type BillingInterval,
  type CommercialMode,
  type CommercialResourceType,
  type OfferState,
  type PriceState,
} from './offer-policy.js';
import {
  maximumIdempotencyKeyLength,
  maximumProviderReferenceLength,
  paymentFailureReasons,
  paymentStates,
  type PaymentFailureReason,
  type PaymentState,
} from './payment-policy.js';
import {
  billingJournalCategories,
  billingJournalPrefix,
  billingJournalReasons,
} from './policy.js';

/**
 * BILLING-owned persistence.
 *
 * `docs/architecture/03-domain-boundaries.md` gives this domain payment
 * intents, charges, refunds, and platform subscription state, and explicitly
 * not payout disbursement or content access decisions. Everything here lives
 * under `billing_` and nothing outside this domain writes it.
 *
 * The journal is the first thing built, before any offer, payment, or
 * subscription exists. [ADR-0021](../../../../docs/decisions/ADR-0021-monetization-money-architecture.md)
 * gives the reason: a payment recorded before there is somewhere to account for
 * it is a payment that gets accounted for retroactively, by inference, from
 * records that were not designed to support it.
 *
 * The tables come from the shared factory in `src/money/journal-table.ts`, on
 * the same rule the transactional outbox follows: the shape and its invariants
 * are declared once, the storage is owned per domain. PAYOUTS will instantiate
 * the same factory under its own prefix, and the two books will never share a
 * row.
 */
const journal = journalTables(billingJournalPrefix, {
  categories: billingJournalCategories,
  reasons: billingJournalReasons,
});

export const billingJournalAccounts = journal.accounts;
export const billingJournalTransactions = journal.transactions;
export const billingJournalEntries = journal.entries;

export const billingJournalTables = journal;

/**
 * What a creator sells, separated from how money is collected for it.
 *
 * An offer points at a resource another domain owns — a private club today — by
 * opaque identifier with no foreign key, for the ownership reason recorded in
 * `docs/architecture/05-data-ownership.md`. BILLING never learns what is inside
 * a club, and PRIVATE CLUBS never learns what one costs; the two meet through a
 * published contract at the moment an offer is activated and at the moment
 * access is granted.
 *
 * Nothing about an offer is a price. An offer that carries no active price is
 * simply not purchasable, which is the state every offer starts in and the
 * state all of them stay in while no commercial terms are approved.
 */
export const billingOffers = pgTable(
  'billing_offers',
  {
    activatedAt: timestamptz('activated_at'),
    commercialMode: text('commercial_mode').notNull().$type<CommercialMode>(),
    createdAt: timestamptz('created_at').notNull(),
    /** Opaque CREATORS reference. No foreign key, by ownership rule. */
    creatorId: uuid('creator_id').notNull(),
    id: uuid('id').primaryKey(),
    /** Opaque reference into the owning product domain. */
    resourceId: uuid('resource_id').notNull(),
    resourceType: text('resource_type')
      .notNull()
      .$type<CommercialResourceType>(),
    retiredAt: timestamptz('retired_at'),
    state: text('state').notNull().$type<OfferState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** Optimistic concurrency token; a stale edit is refused, never applied. */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // The foreign-key target that keeps a price's mode agreeing with its
    // offer's, which is what makes "a subscription price has an interval and a
    // one-time price does not" a structural rule rather than a service check.
    unique('billing_offers_mode_uk').on(table.id, table.commercialMode),
    // One live offer per resource and mode. A second draft alongside an active
    // offer would make "the price of this club" ambiguous, and a retired offer
    // is excluded so a creator may withdraw one and start again.
    uniqueIndex('billing_offers_live_uk')
      .on(table.resourceType, table.resourceId, table.commercialMode)
      .where(sql`${table.state} <> 'retired'`),
    index('billing_offers_creator_idx').on(
      table.creatorId,
      table.createdAt,
      table.id,
    ),
    check('billing_offers_state_check', inList(table.state, offerStates)),
    check(
      'billing_offers_mode_check',
      inList(table.commercialMode, commercialModes),
    ),
    check(
      'billing_offers_resource_type_check',
      inList(table.resourceType, commercialResourceTypes),
    ),
    // A draft has never been purchasable, so it carries no activation instant,
    // and an active offer must carry one. Deliberately two checks rather than a
    // biconditional: an offer may be retired straight from draft without ever
    // having been sellable, and that row legitimately has neither.
    check(
      'billing_offers_draft_shape_check',
      sql`${table.state} <> 'draft' or ${table.activatedAt} is null`,
    ),
    check(
      'billing_offers_activated_shape_check',
      sql`${table.state} <> 'active' or ${table.activatedAt} is not null`,
    ),
    check(
      'billing_offers_retired_shape_check',
      sql`(${table.state} = 'retired') = (${table.retiredAt} is not null)`,
    ),
    check('billing_offers_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * What an offer costs, frozen at the moment it was published.
 *
 * A price is never edited. Changing what something costs means retiring one row
 * and creating another, because a purchase references the exact price it was
 * made against and an edit would rewrite what somebody agreed to pay long after
 * they agreed to it. A trigger enforces that: only the lifecycle columns may
 * change, and no row may be deleted.
 *
 * `amountMinor` is an integer count of minor units and `currency` is beside it
 * on the same row, never apart from it.
 */
export const billingPrices = pgTable(
  'billing_prices',
  {
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    /** Present exactly when the mode is recurring. */
    billingInterval: text('billing_interval').$type<BillingInterval>(),
    /** Repeated from the offer so mode agreement is a foreign key. */
    commercialMode: text('commercial_mode').notNull().$type<CommercialMode>(),
    createdAt: timestamptz('created_at').notNull(),
    currency: text('currency').notNull(),
    /** When this price began to apply, which is not when the row was written. */
    effectiveFrom: timestamptz('effective_from').notNull(),
    id: uuid('id').primaryKey(),
    offerId: uuid('offer_id').notNull(),
    retiredAt: timestamptz('retired_at'),
    state: text('state').notNull().$type<PriceState>(),
  },
  (table) => [
    foreignKey({
      columns: [table.offerId, table.commercialMode],
      foreignColumns: [billingOffers.id, billingOffers.commercialMode],
      name: 'billing_prices_offer_fk',
    }),
    // The foreign-key target that keeps a payment's currency agreeing with the
    // price it was made against, so a snapshot cannot drift from its source.
    unique('billing_prices_currency_uk').on(table.id, table.currency),
    // One live price per offer per currency. Two would make "the price" a
    // question with two answers at the moment somebody pays.
    uniqueIndex('billing_prices_live_uk')
      .on(table.offerId, table.currency)
      .where(sql`${table.state} = 'active'`),
    index('billing_prices_offer_idx').on(
      table.offerId,
      table.createdAt,
      table.id,
    ),
    check('billing_prices_state_check', inList(table.state, priceStates)),
    check('billing_prices_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'billing_prices_currency_check',
      sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
    ),
    check(
      'billing_prices_interval_check',
      sql`${table.billingInterval} is null or ${inList(table.billingInterval, billingIntervals)}`,
    ),
    // A recurring price says how often, and a single purchase must not pretend
    // to. Without this a one-time unlock could carry a monthly cadence nothing
    // would ever act on.
    check(
      'billing_prices_recurrence_shape_check',
      sql`(${table.commercialMode} = 'subscription') = (${table.billingInterval} is not null)`,
    ),
    check(
      'billing_prices_retired_shape_check',
      sql`(${table.state} = 'retired') = (${table.retiredAt} is not null)`,
    ),
  ],
);

/**
 * One consumer's attempt to buy one thing, and everything Velora knows about
 * where that attempt got to.
 *
 * The row exists before any provider is contacted. That ordering is the whole
 * design: a process that dies between committing this and receiving the
 * provider's answer leaves a durable record reconciliation can resolve, where
 * the reverse order would leave a charge nobody in Velora knows about.
 *
 * The amount and currency are a snapshot, not a join. A purchase means what it
 * meant when it was made, and reaching through to the price row to render a
 * receipt would let a later retirement change what somebody was told they paid.
 * The price is still referenced, through a composite key over identifier and
 * currency, so the snapshot cannot disagree with its source.
 *
 * Nothing here is instrument data. There is no card number, no last four
 * digits, no expiry, no security code, and no bank detail — not redacted, not
 * hashed, absent. Collection happens on the provider's page and Velora holds a
 * reference to the provider's object and nothing else.
 */
export const billingPayments = pgTable(
  'billing_payments',
  {
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    /** Opaque USERS reference for the paying consumer. */
    consumerId: uuid('consumer_id').notNull(),
    correlationId: text('correlation_id'),
    createdAt: timestamptz('created_at').notNull(),
    currency: text('currency').notNull(),
    failureReason: text('failure_reason').$type<PaymentFailureReason>(),
    id: uuid('id').primaryKey(),
    /**
     * The caller's key, scoped by consumer and offer rather than globally.
     *
     * Global deduplication would be wrong: somebody may legitimately buy two
     * different things, and may legitimately buy the same thing again after a
     * subscription ends.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    /** When the provider's own record was last read, for reconciliation age. */
    lastProviderSyncAt: timestamptz('last_provider_sync_at'),
    offerId: uuid('offer_id').notNull(),
    priceId: uuid('price_id').notNull(),
    /** Adapter that holds this operation, recorded even before it is called. */
    provider: text('provider').notNull(),
    /**
     * Velora's key for the instruction sent to the provider.
     *
     * Generated before the call and stable across retries, so a provider that
     * already acted returns the same object instead of creating a second one.
     * Unique platform-wide: one instruction, one key, forever.
     */
    providerIdempotencyKey: text('provider_idempotency_key').notNull(),
    /** The provider's identifier, once it has given one. */
    providerReference: text('provider_reference'),
    state: text('state').notNull().$type<PaymentState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // The idempotency guarantee. A double-clicked purchase, a retried request,
    // and a client that reconnected all resolve to one operation because the
    // database admits one, not because a handler looked first.
    uniqueIndex('billing_payments_idempotency_uk').on(
      table.consumerId,
      table.offerId,
      table.idempotencyKey,
    ),
    uniqueIndex('billing_payments_provider_key_uk').on(
      table.providerIdempotencyKey,
    ),
    // One provider object maps to one operation. A duplicate reference would
    // mean two Velora records claiming the same money.
    uniqueIndex('billing_payments_provider_reference_uk')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    index('billing_payments_consumer_idx').on(
      table.consumerId,
      table.createdAt,
      table.id,
    ),
    // The reconciliation sweep: operations that have been waiting too long,
    // oldest first. Partial, so it stays the size of the backlog rather than
    // the size of the history.
    index('billing_payments_unsettled_idx')
      .on(table.updatedAt, table.id)
      .where(
        sql`${table.state} in ('created', 'provider_pending', 'requires_action', 'reconciliation_pending')`,
      ),
    index('billing_payments_offer_idx').on(table.offerId, table.createdAt),
    foreignKey({
      columns: [table.priceId, table.currency],
      foreignColumns: [billingPrices.id, billingPrices.currency],
      name: 'billing_payments_price_fk',
    }),
    foreignKey({
      columns: [table.offerId],
      foreignColumns: [billingOffers.id],
      name: 'billing_payments_offer_fk',
    }),
    check('billing_payments_state_check', inList(table.state, paymentStates)),
    check('billing_payments_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'billing_payments_currency_check',
      sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
    ),
    check(
      'billing_payments_failure_reason_check',
      sql`${table.failureReason} is null or ${inList(table.failureReason, paymentFailureReasons)}`,
    ),
    // A reason belongs to a failure. Without this, a succeeded payment could
    // carry a decline code that a receipt would eventually render.
    check(
      'billing_payments_failure_shape_check',
      sql`${table.failureReason} is null or ${table.state} in ('failed', 'cancelled')`,
    ),
    // Nothing may claim settlement without naming the provider object that
    // settled it. This is the constraint that makes a fabricated success
    // impossible to write, whatever the service believes.
    check(
      'billing_payments_settled_reference_check',
      sql`${table.state} <> 'succeeded' or ${table.providerReference} is not null`,
    ),
    check(
      'billing_payments_idempotency_key_check',
      lengthBetween(table.idempotencyKey, 8, maximumIdempotencyKeyLength),
    ),
    check(
      'billing_payments_provider_key_check',
      lengthBetween(
        table.providerIdempotencyKey,
        8,
        maximumProviderReferenceLength,
      ),
    ),
    check(
      'billing_payments_provider_reference_check',
      sql`${table.providerReference} is null or ${lengthBetween(table.providerReference, 1, maximumProviderReferenceLength)}`,
    ),
    check('billing_payments_version_check', sql`${table.version} >= 1`),
  ],
);
