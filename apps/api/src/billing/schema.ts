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
  disputeReasonCodes,
  disputeStates,
  maximumRefundIdempotencyKeyLength,
  refundFailureReasons,
  refundStates,
  refundReasonCodes,
  type DisputeReasonCode,
  type DisputeState,
  type RefundFailureReason,
  type RefundReasonCode,
  type RefundState,
} from './reversal-policy.js';
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
import {
  giftCatalogStates,
  giftContextTypes,
  giftStates,
  giftTiers,
  giftVisuals,
  type GiftCatalogState,
  type GiftContextType,
  type GiftState,
  type GiftTier,
  type GiftVisual,
} from './gift-policy.js';

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

/** Platform gift vocabulary. Rows are product data; prices remain offers. */
export const billingGiftCatalogItems = pgTable(
  'billing_gift_catalog_items',
  {
    createdAt: timestamptz('created_at').notNull(),
    description: text('description').notNull(),
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    state: text('state').notNull().$type<GiftCatalogState>(),
    tier: text('tier').notNull().$type<GiftTier>(),
    updatedAt: timestamptz('updated_at').notNull(),
    visual: text('visual').notNull().$type<GiftVisual>(),
  },
  (table) => [
    uniqueIndex('billing_gift_catalog_sort_uk').on(table.sortOrder),
    check(
      'billing_gift_catalog_state_check',
      inList(table.state, giftCatalogStates),
    ),
    check('billing_gift_catalog_tier_check', inList(table.tier, giftTiers)),
    check(
      'billing_gift_catalog_visual_check',
      inList(table.visual, giftVisuals),
    ),
    check('billing_gift_catalog_name_check', lengthBetween(table.name, 1, 48)),
    check(
      'billing_gift_catalog_description_check',
      lengthBetween(table.description, 1, 160),
    ),
    check('billing_gift_catalog_sort_check', sql`${table.sortOrder} >= 0`),
  ],
);

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
      .on(
        table.creatorId,
        table.resourceType,
        table.resourceId,
        table.commercialMode,
      )
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
    // One live price per offer, per currency, per cadence.
    //
    // The rule used to be one per offer per currency, on the reasoning that two
    // would make "the price" a question with two answers at the moment somebody
    // pays. The cadence is what makes it one answer again: a purchase names the
    // currency *and* how often it recurs, so "twelve euros a month" and "a
    // hundred and twenty euros a year" are two prices for two different things
    // rather than two prices for the same one.
    //
    // Two indexes rather than one over a nullable column, because a NULL is not
    // equal to itself in a unique index and "no cadence twice" would silently
    // stop being enforced. The recurrence CHECK above already guarantees the
    // interval is present exactly when the mode recurs, so the two partial
    // indexes cover every row between them with no overlap.
    uniqueIndex('billing_prices_live_recurring_uk')
      .on(table.offerId, table.currency, table.billingInterval)
      .where(
        sql`${table.state} = 'active' and ${table.billingInterval} is not null`,
      ),
    uniqueIndex('billing_prices_live_once_uk')
      .on(table.offerId, table.currency)
      .where(
        sql`${table.state} = 'active' and ${table.billingInterval} is null`,
      ),
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
    /**
     * Which authority assessed the tax on this sale, and what it said.
     *
     * A snapshot, frozen with the rest of what the purchase meant. Recomputing
     * a historical sale against today's rates would silently rewrite what
     * somebody was charged, and a rate change is exactly what makes that
     * happen. The pair is set together or not at all: an amount with no
     * authority is a number nobody stands behind, and an authority with no
     * amount is a claim with no content. Zero with an authority is a real
     * answer; absent is the honest state of a platform with no tax engine.
     */
    taxAuthority: text('tax_authority'),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }),
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
    // The foreign-key target that makes a reversal's currency agree with the
    // capture it reverses. A EUR refund against a USD charge would balance
    // perfectly inside its own transaction and mean nothing, so the pairing is
    // a key rather than a check some service performs.
    unique('billing_payments_currency_uk').on(table.id, table.currency),
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
    check(
      'billing_payments_tax_shape_check',
      nullablePairing(table.taxMinor, table.taxAuthority),
    ),
    // Tax cannot be negative and cannot exceed what was charged. Both are
    // arithmetic bounds rather than tax opinions: an assessment outside them is
    // a malfunction, not a jurisdiction.
    check(
      'billing_payments_tax_range_check',
      sql`${table.taxMinor} is null or (${table.taxMinor} >= 0 and ${table.taxMinor} <= ${table.amountMinor})`,
    ),
  ],
);

/**
 * One consumer's durable intention to gift one catalog item to one creator.
 *
 * The row precedes checkout and is linked to exactly one payment operation.
 * Settlement changes its lifecycle through the verified provider path; it
 * never creates an entitlement.
 */
export const billingGifts = pgTable(
  'billing_gifts',
  {
    catalogItemId: uuid('catalog_item_id')
      .notNull()
      .references(() => billingGiftCatalogItems.id),
    contextType: text('context_type').notNull().$type<GiftContextType>(),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => billingOffers.id),
    paymentId: uuid('payment_id').references(() => billingPayments.id),
    /** Opaque CREATORS reference. */
    recipientCreatorId: uuid('recipient_creator_id').notNull(),
    recipientDisplayName: text('recipient_display_name').notNull(),
    recipientHandle: text('recipient_handle').notNull(),
    /** Opaque USERS reference used only for safety re-authorization. */
    recipientUserId: uuid('recipient_user_id').notNull(),
    reversedAt: timestamptz('reversed_at'),
    senderUserId: uuid('sender_user_id').notNull(),
    sentAt: timestamptz('sent_at'),
    state: text('state').notNull().$type<GiftState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('billing_gifts_sender_idempotency_uk').on(
      table.senderUserId,
      table.idempotencyKey,
    ),
    uniqueIndex('billing_gifts_payment_uk')
      .on(table.paymentId)
      .where(sql`${table.paymentId} is not null`),
    index('billing_gifts_sender_history_idx').on(
      table.senderUserId,
      table.createdAt,
      table.id,
    ),
    index('billing_gifts_recipient_history_idx').on(
      table.recipientCreatorId,
      table.createdAt,
      table.id,
    ),
    check('billing_gifts_state_check', inList(table.state, giftStates)),
    check(
      'billing_gifts_context_check',
      inList(table.contextType, giftContextTypes),
    ),
    check(
      'billing_gifts_idempotency_key_check',
      lengthBetween(table.idempotencyKey, 8, maximumIdempotencyKeyLength),
    ),
    check(
      'billing_gifts_distinct_people_check',
      sql`${table.senderUserId} <> ${table.recipientUserId}`,
    ),
    check(
      'billing_gifts_recipient_name_check',
      lengthBetween(table.recipientDisplayName, 1, 80),
    ),
    check(
      'billing_gifts_recipient_handle_check',
      lengthBetween(table.recipientHandle, 3, 32),
    ),
    check('billing_gifts_version_check', sql`${table.version} >= 1`),
    check(
      'billing_gifts_sent_shape_check',
      sql`(${table.state} in ('sent', 'partially_reversed', 'reversed')) = (${table.sentAt} is not null)`,
    ),
    check(
      'billing_gifts_reversed_shape_check',
      sql`(${table.state} = 'reversed') = (${table.reversedAt} is not null)`,
    ),
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
    /**
     * The monetary amount this event is about, where it has one.
     *
     * Normalized from the provider's payload at verification time rather than
     * re-read later, because `docs/security/05-payments-webhooks.md` requires
     * an inbound amount and currency to be checked against Velora's own
     * immutable record — and a check needs the value the provider actually
     * sent, kept beside the digest that proves which bytes carried it.
     */
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    attempts: integer('attempts').notNull().default(0),
    /** Not claimable before this instant. Retry backoff is written here. */
    availableAt: timestamptz('available_at').notNull(),
    currency: text('currency'),
    eventType: text('event_type').notNull(),
    /** When the provider says evidence is due, when it says so at all. */
    evidenceDueAt: timestamptz('evidence_due_at'),
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
    /** Normalized dispute reference, where the event is about one. */
    providerDisputeReference: text('provider_dispute_reference'),
    providerEventId: text('provider_event_id').notNull(),
    /** Normalized reference into Velora's own record, where the event has one. */
    providerPaymentReference: text('provider_payment_reference'),
    /** Normalized refund reference, where the event is about one. */
    providerRefundReference: text('provider_refund_reference'),
    /** Normalized dispute reason, in Velora's vocabulary rather than theirs. */
    reasonCode: text('reason_code'),
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
    // An amount without a currency is a number, and a currency without an
    // amount is a label. Neither is evidence, so the pair is set together or
    // not at all.
    check(
      'billing_provider_events_amount_shape_check',
      nullablePairing(table.amountMinor, table.currency),
    ),
    check(
      'billing_provider_events_amount_check',
      sql`${table.amountMinor} is null or ${table.amountMinor} > 0`,
    ),
    check(
      'billing_provider_events_currency_check',
      sql`${table.currency} is null or ${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
    ),
    check(
      'billing_provider_events_reason_code_check',
      sql`${table.reasonCode} is null or ${inList(table.reasonCode, disputeReasonCodes)}`,
    ),
    check(
      'billing_provider_events_refund_reference_check',
      sql`${table.providerRefundReference} is null or ${lengthBetween(table.providerRefundReference, 1, maximumProviderReferenceLength)}`,
    ),
    check(
      'billing_provider_events_dispute_reference_check',
      sql`${table.providerDisputeReference} is null or ${lengthBetween(table.providerDisputeReference, 1, maximumProviderReferenceLength)}`,
    ),
  ],
);

/**
 * A reversal of money already captured.
 *
 * A refund is a new financial event, not an edit of the payment it reverses.
 * Nothing here rewrites `billing_payments`: the capture keeps its amount, its
 * state, and its provider reference forever, and what somebody was actually
 * left paying is derived by reading the refunds against it. That is the whole
 * reason this is a table rather than a nullable `refunded_amount` column — a
 * column has no history, no provenance, and no way to describe two partial
 * reversals issued by two operators on two days.
 *
 * The currency is carried and keyed to the payment's, so a cross-currency
 * refund cannot be inserted at all. The over-refund guard is a trigger rather
 * than a service check, for the reason `docs/engineering/03-jobs-idempotency-concurrency.md`
 * gives about every financial invariant: a rule the writer upholds is a rule the
 * next writer can break, and fifty simultaneous full refunds are exactly the
 * case where a read-then-decide check has already lost.
 */
export const billingRefunds = pgTable(
  'billing_refunds',
  {
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    correlationId: text('correlation_id'),
    createdAt: timestamptz('created_at').notNull(),
    /** Repeated from the payment so currency agreement is a foreign key. */
    currency: text('currency').notNull(),
    failureReason: text('failure_reason').$type<RefundFailureReason>(),
    id: uuid('id').primaryKey(),
    /**
     * The operator's key, scoped to the payment rather than globally.
     *
     * One payment may legitimately be refunded twice in parts, so a global key
     * would be wrong; two refunds of the same payment under one key are the
     * same instruction sent twice, which is what this deduplicates.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    /**
     * Who asked for this, as an opaque session reference.
     *
     * Never an operator's name or address. An audit needs to identify the actor
     * deterministically; a financial table is the last place to accumulate
     * staff identity.
     */
    initiatedBy: text('initiated_by').notNull(),
    lastProviderSyncAt: timestamptz('last_provider_sync_at'),
    paymentId: uuid('payment_id').notNull(),
    provider: text('provider').notNull(),
    /** Velora's key for the instruction. Unique platform-wide, forever. */
    providerIdempotencyKey: text('provider_idempotency_key').notNull(),
    providerReference: text('provider_reference'),
    reasonCode: text('reason_code').notNull().$type<RefundReasonCode>(),
    state: text('state').notNull().$type<RefundState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    foreignKey({
      columns: [table.paymentId, table.currency],
      foreignColumns: [billingPayments.id, billingPayments.currency],
      name: 'billing_refunds_payment_fk',
    }),
    // The duplicate-refund guarantee. A retried operator request, a
    // double-submitted form, and a client that reconnected all resolve to one
    // reversal because the database admits one.
    uniqueIndex('billing_refunds_idempotency_uk').on(
      table.paymentId,
      table.idempotencyKey,
    ),
    uniqueIndex('billing_refunds_provider_key_uk').on(
      table.providerIdempotencyKey,
    ),
    uniqueIndex('billing_refunds_provider_reference_uk')
      .on(table.provider, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    // Every refund against one payment, which is what the over-refund guard
    // sums and what an operator's view of a charge reads.
    index('billing_refunds_payment_idx').on(table.paymentId, table.createdAt),
    // The reconciliation sweep: reversals still waiting, oldest first.
    index('billing_refunds_unsettled_idx')
      .on(table.updatedAt, table.id)
      .where(
        sql`${table.state} in ('requested', 'provider_pending', 'reconciliation_pending')`,
      ),
    check('billing_refunds_state_check', inList(table.state, refundStates)),
    check(
      'billing_refunds_reason_check',
      inList(table.reasonCode, refundReasonCodes),
    ),
    check('billing_refunds_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'billing_refunds_currency_check',
      sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
    ),
    check(
      'billing_refunds_failure_reason_check',
      sql`${table.failureReason} is null or ${inList(table.failureReason, refundFailureReasons)}`,
    ),
    check(
      'billing_refunds_failure_shape_check',
      sql`${table.failureReason} is null or ${table.state} = 'failed'`,
    ),
    // Nothing may claim a reversal settled without naming the provider object
    // that settled it. This is the constraint that makes a fabricated refund
    // impossible to write, whatever a service believes.
    check(
      'billing_refunds_settled_reference_check',
      sql`${table.state} <> 'succeeded' or ${table.providerReference} is not null`,
    ),
    check(
      'billing_refunds_idempotency_key_check',
      lengthBetween(table.idempotencyKey, 8, maximumRefundIdempotencyKeyLength),
    ),
    check(
      'billing_refunds_provider_key_check',
      lengthBetween(
        table.providerIdempotencyKey,
        8,
        maximumProviderReferenceLength,
      ),
    ),
    check(
      'billing_refunds_provider_reference_check',
      sql`${table.providerReference} is null or ${lengthBetween(table.providerReference, 1, maximumProviderReferenceLength)}`,
    ),
    check(
      'billing_refunds_initiated_by_check',
      lengthBetween(table.initiatedBy, 1, 200),
    ),
    check('billing_refunds_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * A cardholder's claim against a capture, tracked separately from a refund.
 *
 * Deliberately its own table. A refund is Velora deciding to return money; a
 * dispute is somebody else's bank taking it, on a timetable Velora does not
 * control, with an outcome Velora may lose. Modelling one as the other would
 * mean an operator's decision and a provider's notice sharing a lifecycle, and
 * the two have different authorities, different evidence, and different
 * accounting.
 *
 * The row is created by a verified provider event and by nothing else. There is
 * no route that opens a dispute, because a dispute is not something Velora can
 * decide has happened.
 */
export const billingDisputes = pgTable(
  'billing_disputes',
  {
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    createdAt: timestamptz('created_at').notNull(),
    /** Repeated from the payment so currency agreement is a foreign key. */
    currency: text('currency').notNull(),
    /**
     * When the provider says evidence is due, when it says so at all.
     *
     * Null is a truthful answer. A provider that publishes no deadline gets
     * none recorded, because a date Velora invented is a date an operator would
     * plan around.
     */
    evidenceDueAt: timestamptz('evidence_due_at'),
    id: uuid('id').primaryKey(),
    /** When the claim was raised, per the provider, not when it arrived. */
    openedAt: timestamptz('opened_at').notNull(),
    paymentId: uuid('payment_id').notNull(),
    provider: text('provider').notNull(),
    /** The provider's identifier for the dispute. Required: it is the identity. */
    providerReference: text('provider_reference').notNull(),
    reasonCode: text('reason_code').notNull().$type<DisputeReasonCode>(),
    resolvedAt: timestamptz('resolved_at'),
    state: text('state').notNull().$type<DisputeState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    foreignKey({
      columns: [table.paymentId, table.currency],
      foreignColumns: [billingPayments.id, billingPayments.currency],
      name: 'billing_disputes_payment_fk',
    }),
    // One provider dispute, one row. A redelivered opening and an opening that
    // arrives after its own resolution both resolve to this.
    uniqueIndex('billing_disputes_provider_uk').on(
      table.provider,
      table.providerReference,
    ),
    index('billing_disputes_payment_idx').on(table.paymentId, table.openedAt),
    // Live claims an operator has to answer, soonest deadline first. Partial,
    // so it stays the size of the caseload rather than of the history.
    index('billing_disputes_open_idx')
      .on(table.evidenceDueAt, table.id)
      .where(sql`${table.state} in ('opened', 'under_review')`),
    check('billing_disputes_state_check', inList(table.state, disputeStates)),
    check(
      'billing_disputes_reason_check',
      inList(table.reasonCode, disputeReasonCodes),
    ),
    check('billing_disputes_amount_check', sql`${table.amountMinor} > 0`),
    check(
      'billing_disputes_currency_check',
      sql`${table.currency} ~ ${sql.raw(`'${currencyCodePattern}'`)}`,
    ),
    check(
      'billing_disputes_resolved_shape_check',
      sql`(${table.state} in ('won', 'lost', 'withdrawn')) = (${table.resolvedAt} is not null)`,
    ),
    check(
      'billing_disputes_provider_reference_check',
      lengthBetween(table.providerReference, 1, maximumProviderReferenceLength),
    ),
    check('billing_disputes_version_check', sql`${table.version} >= 1`),
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
    // The expiry sweep's only query: scheduled cancellations whose paid period
    // has run out, oldest first. Partial, so it stays the size of what is
    // actually pending rather than of every subscription ever held.
    index('billing_subscriptions_expiry_idx')
      .on(table.currentPeriodEnd, table.id)
      .where(sql`${table.state} = 'cancel_at_period_end'`),
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
