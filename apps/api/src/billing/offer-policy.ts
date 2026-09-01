/**
 * The commercial-offer vocabulary, restated for the schema.
 *
 * Same rule as `src/clubs/policy.ts` and `src/money/policy.ts`: `drizzle-kit`
 * cannot import the ESM-only contract package while generating migrations, so
 * these values live here and a unit test asserts they are identical to what
 * `@velora/validation` publishes.
 *
 * Nothing here is a commercial term. There is no fee, no percentage, no default
 * currency, and no price. What an offer may cost is
 * [approved policy](commerce-policy.ts), which publishes nothing until somebody
 * approves it.
 */

/**
 * What kind of commercial relationship an offer creates.
 *
 * `subscription` recurs and therefore has a billing interval; `one_time` is a
 * single purchase and must not. The two are separated at the offer rather than
 * at the price because they have different lifecycles, different cancellation
 * meanings, and different entitlement consequences, and a price that could
 * change which one applied would change the meaning of a purchase already made.
 */
export const commercialModes = ['subscription', 'one_time'] as const;
export type CommercialMode = (typeof commercialModes)[number];

/** Cadences a recurring offer may bill on. Which are permitted is policy. */
export const billingIntervals = ['month', 'year'] as const;
export type BillingInterval = (typeof billingIntervals)[number];

/**
 * What an offer sells access to.
 *
 * A private club and a gift are a creator's. `coins` is the platform's own
 * product, and it is the reason {@link offerOwnerTypes} exists below: a coin
 * pack is sold by VELORA, its money is VELORA's, and no creator is owed
 * anything out of it. Selling it as somebody's creator offer would have put a
 * stranger's name on the sale and a liability on a payable they never earned.
 */
export const commercialResourceTypes = ['club', 'gift', 'coins'] as const;
export type CommercialResourceType = (typeof commercialResourceTypes)[number];

/**
 * Who is selling, restated for the schema on the rule at the top of this file.
 *
 * The database enforces the pairing rather than trusting it: a creator offer
 * names a creator and a platform offer must not, so there is no row in which
 * "whose money is this" is ambiguous, and no code path that could answer it by
 * defaulting.
 */
export const offerOwnerTypes = ['creator', 'platform'] as const;
export type OfferOwnerType = (typeof offerOwnerTypes)[number];

/**
 * An offer's lifecycle.
 *
 * `draft` is invisible to anybody but its creator and cannot be bought.
 * `active` is purchasable, and reaching it requires every eligibility authority
 * to agree. `retired` is withdrawn: existing purchases keep their price
 * snapshot, and nothing new may be bought.
 *
 * There is no `paused`. A creator who wants to stop selling retires the offer
 * and makes a new one, so nothing has to decide what an interrupted
 * subscription against a paused offer means.
 */
export const offerStates = ['draft', 'active', 'retired'] as const;
export type OfferState = (typeof offerStates)[number];

/**
 * A price's lifecycle.
 *
 * A price is never edited. Retiring one and creating another is the only way to
 * change what something costs, because a purchase references the exact price
 * row it was made against and an edit would silently rewrite what somebody
 * agreed to pay.
 */
export const priceStates = ['active', 'retired'] as const;
export type PriceState = (typeof priceStates)[number];

/** Largest page the Studio offer list returns, whatever a caller asks for. */
export const maximumOfferPageSize = 50;
export const defaultOfferPageSize = 20;

/** Bounded number of live prices one offer may carry, one per currency. */
export const maximumLivePricesPerOffer = 10;
