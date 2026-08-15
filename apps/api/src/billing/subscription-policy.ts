/**
 * Provider-event and subscription vocabulary, restated for the schema.
 *
 * Same rule as the other policy modules here: `drizzle-kit` cannot import the
 * ESM-only contract package while generating migrations, so the values a CHECK
 * needs live here and a unit test asserts they match what `@velora/validation`
 * publishes.
 */

/**
 * What has happened to one verified provider event.
 *
 * `received` means the signature was checked and the receipt is durable, and
 * nothing has been decided from it yet. That separation is the point: a
 * verification failure never reaches this table at all, and a business failure
 * never un-receives an event that genuinely arrived.
 *
 * `ignored` is a first-class outcome rather than a silent drop. A provider
 * sends event types Velora has no rule for, and recording "seen, nothing to
 * do" is what makes the difference between an event nobody handled and an event
 * nobody noticed.
 */
export const providerEventStates = [
  'received',
  'processed',
  'ignored',
  'retry_wait',
  'dead_letter',
] as const;
export type ProviderEventState = (typeof providerEventStates)[number];

/**
 * Velora's subscription lifecycle, mapped from whatever a provider calls it.
 *
 * Deliberately not a mirror of any provider's vocabulary, for the reason
 * `docs/flows/creator-entitlement.md` gives: a provider status arriving late,
 * twice, or out of order must not be able to move access, and it can only fail
 * to if the two vocabularies are separate.
 *
 * `past_due` grants nothing. Whether a lapsed payment keeps access, and for how
 * long, is grace policy — unresolved in `docs/decisions/DECISIONS_REQUIRED.md` —
 * and the fail-closed reading of an unresolved policy is no access. That is a
 * deliberate product choice recorded here rather than a gap: inventing a grace
 * window would be inventing a commercial term.
 */
export const subscriptionStates = [
  'pending',
  'active',
  'past_due',
  'cancel_at_period_end',
  'cancelled',
  'terminated',
] as const;
export type SubscriptionState = (typeof subscriptionStates)[number];

/**
 * The states in which a subscription is still somebody's live commercial
 * relationship, whether or not it currently grants anything.
 *
 * Used by the partial unique index: one live subscription per consumer per
 * offer, so a renewal cannot silently become a second one.
 */
export const liveSubscriptionStates: readonly SubscriptionState[] = [
  'pending',
  'active',
  'past_due',
  'cancel_at_period_end',
];

/**
 * The states that grant access, and nothing else does.
 *
 * `cancel_at_period_end` is included because somebody who cancelled has paid
 * for the period they are in; withdrawing access at the moment they cancel
 * would take something they already bought.
 */
export const entitlingSubscriptionStates: readonly SubscriptionState[] = [
  'active',
  'cancel_at_period_end',
];

/** Widest provider event identifier BILLING will store. */
export const maximumProviderEventIdLength = 200;

/** Widest provider event type BILLING will store. */
export const maximumProviderEventTypeLength = 120;

/** How many times a verified event is re-processed before it dead-letters. */
export const maximumProviderEventAttempts = 8;

/**
 * The largest webhook body BILLING will read.
 *
 * Smaller than the global request ceiling on purpose. A webhook endpoint is
 * unauthenticated until its signature is checked, so the bytes it accepts
 * before doing any work are the cheapest thing an attacker can spend.
 */
export const maximumWebhookBodyBytes = 65_536;
