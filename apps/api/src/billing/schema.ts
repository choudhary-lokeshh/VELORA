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

import {
  digestColumn,
  inList,
  isHexDigest,
  lengthBetween,
  nullablePairing,
  timestamptz,
} from '../database/columns.js';
import { outboxTable } from '../events/outbox-table.js';
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
  maximumProviderEventIdLength,
  maximumProviderEventTypeLength,
  providerEventStates,
  subscriptionStates,
  type ProviderEventState,
  type SubscriptionState,
} from './subscription-policy.js';
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

/**
 * Every verified provider event, kept.
 *
 * The durable inbox `docs/security/05-payments-webhooks.md` requires: verify
 * the signature over the raw bytes, persist the receipt, acknowledge, and
 * process asynchronously. A request whose signature does not verify never
 * reaches this table — it is denied and audited, and writing it here would
 * make an attacker able to fill Velora's storage by posting nonsense.
 *
 * Uniqueness over provider and provider event identifier is what makes
 * redelivery safe. A provider that sends the same event five times produces one
 * row, and the four later attempts are acknowledged without re-effect.
 *
 * The body itself is not retained. What is kept is a digest of the exact bytes
 * that were verified — enough to prove later that a given payload is the one
 * that arrived, without holding provider data indefinitely under a retention
 * policy nobody has approved. Normalized fields carry what processing needs.
 */
export const billingProviderEvents = pgTable(
  'billing_provider_events',
  {
    attempts: integer('attempts').notNull().default(0),
    /** Not claimable before this instant. Retry backoff is written here. */
    availableAt: timestamptz('available_at').notNull(),
    eventType: text('event_type').notNull(),
    /** A redacted code, never a provider message or a payload fragment. */
    failureReason: text('failure_reason'),
    id: uuid('id').primaryKey(),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    leaseOwner: text('lease_owner'),
    /** When the provider says it happened, which is not when it arrived. */
    occurredAt: timestamptz('occurred_at').notNull(),
    /** Digest of the exact verified bytes. Never the bytes themselves. */
    payloadDigest: digestColumn('payload_digest').notNull(),
    processedAt: timestamptz('processed_at'),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    /** Normalized reference into Velora's own record, where the event has one. */
    providerPaymentReference: text('provider_payment_reference'),
    receivedAt: timestamptz('received_at').notNull(),
    state: text('state').notNull().$type<ProviderEventState>(),
    /** Normalized provider status, in Velora's vocabulary rather than theirs. */
    status: text('status'),
  },
  (table) => [
    // Redelivery is normal, not exceptional. This index is what makes the fifth
    // copy of an event a no-op rather than a fifth effect.
    uniqueIndex('billing_provider_events_identity_uk').on(
      table.provider,
      table.providerEventId,
    ),
    // The drain: claimable rows, oldest first. Partial, so it stays the size of
    // the backlog rather than of every event ever received.
    index('billing_provider_events_claimable_idx')
      .on(table.availableAt, table.id)
      .where(sql`${table.state} in ('received', 'retry_wait')`),
    index('billing_provider_events_reference_idx')
      .on(table.providerPaymentReference)
      .where(sql`${table.providerPaymentReference} is not null`),
    check(
      'billing_provider_events_state_check',
      inList(table.state, providerEventStates),
    ),
    check(
      'billing_provider_events_digest_check',
      isHexDigest(table.payloadDigest),
    ),
    check(
      'billing_provider_events_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
    check(
      'billing_provider_events_event_id_check',
      lengthBetween(table.providerEventId, 1, maximumProviderEventIdLength),
    ),
    check(
      'billing_provider_events_event_type_check',
      lengthBetween(table.eventType, 1, maximumProviderEventTypeLength),
    ),
    check(
      'billing_provider_events_lease_shape_check',
      nullablePairing(table.leaseOwner, table.leaseExpiresAt),
    ),
    // A lease belongs to a row somebody may still be working on. A settled row
    // holding one would be indistinguishable from a live claim.
    check(
      'billing_provider_events_lease_state_check',
      sql`${table.leaseOwner} is null or ${table.state} in ('received', 'retry_wait')`,
    ),
    check(
      'billing_provider_events_processed_shape_check',
      sql`(${table.state} in ('processed', 'ignored')) = (${table.processedAt} is not null)`,
    ),
  ],
);

/**
 * A consumer's recurring commercial relationship with one offer.
 *
 * Velora's own lifecycle, mapped from whatever the provider calls it. The
 * mapping happens in one place, when a verified event is processed, so a
 * provider that renames a status changes an adapter rather than an
 * authorization rule.
 *
 * The amount and currency are a snapshot for the same reason a payment carries
 * one: what somebody agreed to pay is a fact about the moment they agreed, and
 * a later price change must not rewrite it.
 */
export const billingSubscriptions = pgTable(
  'billing_subscriptions',
  {
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    cancelledAt: timestamptz('cancelled_at'),
    /** Opaque USERS reference for the subscriber. */
    consumerId: uuid('consumer_id').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    currency: text('currency').notNull(),
    /** The period paid for. Access questions are asked against this, not a clock. */
    currentPeriodEnd: timestamptz('current_period_end'),
    currentPeriodStart: timestamptz('current_period_start'),
    id: uuid('id').primaryKey(),
    offerId: uuid('offer_id').notNull(),
    /** The payment operation that established it. */
    originPaymentId: uuid('origin_payment_id').notNull(),
    priceId: uuid('price_id').notNull(),
    provider: text('provider').notNull(),
    providerReference: text('provider_reference'),
    state: text('state').notNull().$type<SubscriptionState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    // One live subscription per consumer per offer. Without it a redelivered
    // activation, or a renewal racing a repair, becomes a second relationship
    // nobody asked for and both of them grant access.
    uniqueIndex('billing_subscriptions_live_uk')
      .on(table.consumerId, table.offerId)
      .where(
        sql`${table.state} in ('pending', 'active', 'past_due', 'cancel_at_period_end')`,
      ),
    // One subscription per payment operation, so a duplicated success event
    // cannot create a second relationship from the same purchase.
    uniqueIndex('billing_subscriptions_origin_uk').on(table.originPaymentId),
    uniqueIndex('billing_subscriptions_provider_uk')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    index('billing_subscriptions_consumer_idx').on(
      table.consumerId,
      table.createdAt,
      table.id,
    ),
    index('billing_subscriptions_offer_idx').on(table.offerId, table.state),
    foreignKey({
      columns: [table.priceId, table.currency],
      foreignColumns: [billingPrices.id, billingPrices.currency],
      name: 'billing_subscriptions_price_fk',
    }),
    foreignKey({
      columns: [table.originPaymentId],
      foreignColumns: [billingPayments.id],
      name: 'billing_subscriptions_payment_fk',
    }),
    check(
      'billing_subscriptions_state_check',
      inList(table.state, subscriptionStates),
    ),
    check('billing_subscriptions_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'billing_subscriptions_currency_check',
      sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
    ),
    check(
      'billing_subscriptions_period_shape_check',
      nullablePairing(table.currentPeriodStart, table.currentPeriodEnd),
    ),
    check(
      'billing_subscriptions_period_order_check',
      sql`${table.currentPeriodEnd} is null or ${table.currentPeriodEnd} > ${table.currentPeriodStart}`,
    ),
    // An ended relationship records when it ended, and a live one has not.
    check(
      'billing_subscriptions_cancelled_shape_check',
      sql`(${table.state} in ('cancelled', 'terminated')) = (${table.cancelledAt} is not null)`,
    ),
    // Access is asked of a period, so anything that grants must have one.
    check(
      'billing_subscriptions_entitling_period_check',
      sql`${table.state} not in ('active', 'cancel_at_period_end') or ${table.currentPeriodEnd} is not null`,
    ),
    check('billing_subscriptions_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * BILLING's transactional outbox.
 *
 * The seam [ADR-0011](../../../../docs/decisions/ADR-0011-payments-payouts.md)
 * requires between commercial truth and product access: BILLING publishes a
 * durable fact in the same transaction that settles the money, and PRIVATE
 * CLUBS consumes it and applies its own grant policy. BILLING never writes
 * `clubs_`, and PRIVATE CLUBS never reads `billing_`.
 *
 * The same shape MESSAGING and DISCOVERY already use, so it inherits the lease,
 * retry, and dead-letter behaviour rather than inventing a financial variant.
 */
export const billingOutbox = outboxTable('billing_outbox');
