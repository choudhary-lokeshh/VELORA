/**
 * Approved coin-wallet policy.
 *
 * Every value a wallet decision depends on is defined once, here, on the same
 * rule the money, live, and realtime policy modules follow: `drizzle-kit` reads
 * schema modules through a CommonJS resolver that cannot follow the validation
 * package's import-only exports, so a schema module may not depend on it. What
 * is restated is asserted identical to the published contract by
 * `test/unit/wallet-policy.test.ts`, and drift fails the build.
 *
 * [ADR-0043](../../../../docs/decisions/ADR-0043-coin-wallet-and-premium-live-preferences.md)
 * is the architecture authority.
 */

/**
 * A coin is not money, and this module never pretends otherwise.
 *
 * It has no ISO 4217 currency, no exchange rate, no minor unit, and no
 * denomination outside VELORA. It is a whole-number entitlement unit: one coin
 * is one coin, counts of them are exact integers, and there is no arithmetic
 * anywhere in this domain that a floating-point value can enter.
 *
 * What a coin *costs* is money, and money stays in BILLING's journal under
 * BILLING's currency rules. The two books meet at exactly one place — a
 * verified purchase producing an issuance here — and nothing sums across them,
 * because a total denominated in "coins and pounds" would mean nothing.
 */
export const coinUnit = 'coin';

/**
 * The positions this ledger keeps, and the whole of them.
 *
 * Four, because a reservation has to be somewhere that is neither spendable nor
 * spent. `consumer_reserved` is what makes "held against an activation that has
 * not yet produced anything" a position the books can state rather than a flag
 * on a row somewhere.
 *
 * `platform_issuance` is where coins come from and where a reversal sends them
 * back to. `platform_revenue` is where a captured reservation lands, and it is
 * the only account whose balance means "this was consumed".
 */
export const walletAccountCategories = [
  'consumer_balance',
  'consumer_reserved',
  'platform_issuance',
  'platform_revenue',
] as const;
export type WalletAccountCategory = (typeof walletAccountCategories)[number];

/** Who an account belongs to. Platform accounts have no subject. */
export const walletSubjectTypes = ['platform', 'consumer'] as const;
export type WalletSubjectType = (typeof walletSubjectTypes)[number];

/** The two sides of a posting. Direction plus a strictly positive amount. */
export const walletDirections = ['debit', 'credit'] as const;
export type WalletDirection = (typeof walletDirections)[number];

/**
 * Why a coin transaction exists.
 *
 * A closed vocabulary rather than free text, because "why did this balance
 * move" is the first question anybody asks of a ledger and a string somebody
 * typed is not an answer that can be grouped, counted, or reconciled.
 *
 * `correction` is required of every journal in this repository and means one
 * balanced transaction that names the one it repairs. Nothing here is ever
 * edited or deleted.
 */
export const walletTransactionReasons = [
  /** Coins the platform gave somebody. Development, support, or promotion. */
  'grant',
  /** Coins a verified, settled purchase produced. */
  'purchase',
  /** A purchase that came back. Sends the issuance the way it came. */
  'purchase_reversed',
  /** Coins held against an activation that has not yet produced anything. */
  'reservation',
  /** A held reservation consumed by the thing it was held for. */
  'capture',
  /** A held reservation returned, because the thing never happened. */
  'release',
  'correction',
] as const;
export type WalletTransactionReason = (typeof walletTransactionReasons)[number];

/** Widest business reference a coin transaction may carry. */
export const maximumWalletBusinessReferenceLength = 200;

/**
 * The `bigint` range, which is the storage every coin amount lands in.
 *
 * A representation limit and never a commercial one. What somebody may hold,
 * buy, or spend in a day is unresolved commercial policy in
 * `docs/decisions/DECISIONS_REQUIRED.md`; this only prevents an amount that
 * cannot be stored or a sum that silently wraps.
 */
export const minimumStorableCoins = -9_223_372_036_854_775_808n;
export const maximumStorableCoins = 9_223_372_036_854_775_807n;

/**
 * What a single wallet operation may move.
 *
 * Not a commercial limit either. It bounds one instruction so a malformed or
 * hostile caller cannot ask for an amount whose only purpose is to overflow
 * something downstream, and it is deliberately far above any price this
 * product has.
 */
export const maximumWalletOperationCoins = 1_000_000n;

/**
 * The premium matching preferences this product sells, and what each costs.
 *
 * **One catalogue, on the server, and nowhere else.** Consumer Web and Consumer
 * Android render what a wallet read returns; neither holds a price, a duration,
 * or a list of kinds, so a surface cannot show a price that is not the price
 * that will be charged, and a kind can be withdrawn without shipping a client.
 *
 * **Three kinds, and each is a field a person set about themselves.** A
 * declared matching category, a declared region, and a declared language.
 * Nothing here is inferred, nothing is derived from a photograph, a name, a
 * voice, a model, or a network address, and there is no kind in this list whose
 * value the platform worked out rather than was told.
 *
 * **A selection is priced as the sum of the kinds in it.** One window, one
 * duration, and a price somebody can check by adding up what they chose. The
 * alternative — a flat price whatever is selected — would mean the person who
 * narrows on one thing subsidising the person who narrows on three, and a
 * tiered "bundle" price would be a discount structure nobody has approved.
 *
 * The numbers are development values and are marked as such in
 * `DECISIONS_REQUIRED.md`: what a coin is worth in money is undecided, so what
 * any of this costs in money is undecided with it. They are changeable here
 * alone, with no migration and no client release. What is *not* provisional is
 * that a charge is computed from this table — no request field, header, or
 * client value contributes to what anybody is charged.
 */
export const livePremiumPreferenceCatalogue: Readonly<
  Record<LivePremiumPreferenceKind, { readonly coins: bigint }>
> = {
  /** Narrows to one declared matching category. Never to `undisclosed`. */
  gender: { coins: 25n },
  /** Narrows to people who declared they speak one particular language. */
  language: { coins: 10n },
  /** Narrows to one declared ISO 3166-1 alpha-2 region. */
  region: { coins: 15n },
};

/**
 * What one selection costs, computed from the catalogue and from nothing else.
 *
 * Returns `undefined` for a selection that names nothing, because a window that
 * narrows nothing is not a thing this product sells — `Everyone` is free and is
 * what a person gets by not buying anything.
 */
export function livePreferenceActivationCoins(selection: {
  readonly gender?: string | undefined;
  readonly language?: string | undefined;
  readonly region?: string | undefined;
}): bigint | undefined {
  let total = 0n;
  for (const kind of livePremiumPreferenceKinds) {
    if (selection[kind] === undefined) continue;
    total += livePremiumPreferenceCatalogue[kind].coins;
  }
  return total === 0n ? undefined : total;
}

/**
 * How long one activation lasts.
 *
 * Fifteen minutes, which is long enough to be worth buying and short enough
 * that somebody who walks away has not bought an afternoon. One duration for
 * every selection, because what is sold is the window: charging more for a
 * longer one, or giving a longer one to a bigger selection, would turn a simple
 * purchase into a matrix nobody can check.
 */
export const livePreferenceEntitlementDurationMilliseconds = 900_000;

/**
 * How the charge actually works, stated once so no surface has to guess.
 *
 * **Reserve on activation, capture once on the first filtered encounter,
 * release in full if the window closes without one — and the window keeps
 * narrowing until it expires, whether or not it has been charged.**
 *
 * Chosen over the two alternatives deliberately. Charging on tap would mean
 * somebody paying for a pool that turned out to be empty, which is the exact
 * behaviour that makes a paid filter feel like a trick. Charging only after a
 * successful match would mean the platform running a narrowed, more expensive
 * search for free for anybody who never matched, and would make the cost depend
 * on how busy the product happened to be that minute.
 *
 * The last clause is what makes this a *window* rather than a match fee. A
 * capture is a money event, not the end of the thing that was bought: after it,
 * the narrowing stays in force for the rest of the fifteen minutes and every
 * further Next inside them is filtered and free. An entitlement that stopped
 * applying the instant it was charged would be a per-match fee wearing a
 * window's clothes, and the person pressing Next would silently be handed the
 * whole pool a second later.
 *
 * A reservation is a real ledger position, not a flag: the coins leave the
 * spendable balance the instant the window opens, so a second activation cannot
 * be funded by money already committed to the first, and the books state at
 * every instant exactly how much is held and against what.
 *
 * The release is automatic and is not a favour. It is the worker's job, it runs
 * whether or not the person ever comes back, and a person who closed the tab
 * gets their coins back exactly as one who is watching does.
 */
export const livePreferenceChargingRule =
  'reserve-on-activation-capture-once-on-first-match-window-runs-to-expiry';

/**
 * The lifecycle of one activation.
 *
 * `active` is an open window whose coins are held and which has produced
 * nothing yet. `captured` is an open window that has produced a filtered
 * encounter and been charged — still narrowing, still running, and never
 * charged again. `expired` is a captured window whose time is up; the money was
 * settled at capture, so closing it moves nothing. `released` is a window that
 * closed without ever producing anything, and its coins come back in full.
 * `cancelled` is one the person closed themselves, and it returns the coins on
 * exactly the same terms if it had not yet been charged.
 *
 * `expired` and `released` are deliberately distinct, and the distinction is
 * financial rather than cosmetic: a `released` window is one nobody was charged
 * for, and an `expired` one is a window somebody paid for and used. Collapsing
 * them would make "how many paid windows found nobody" unanswerable, which is
 * the one number that says whether this feature is honest.
 */
export const livePreferenceEntitlementStates = [
  'active',
  'captured',
  'expired',
  'released',
  'cancelled',
] as const;
export type LivePreferenceEntitlementState =
  (typeof livePreferenceEntitlementStates)[number];

/**
 * The states in which a window is still narrowing somebody's search.
 *
 * Both of them, and that is the whole point: a charged window is still a window.
 * The matcher reads this set and additionally checks the expiry, because a state
 * cannot expire on its own and a sweep that is a few seconds behind must never
 * mean a narrowing outlives what was bought.
 */
export const livePreferenceEntitlementOpenStates: readonly LivePreferenceEntitlementState[] =
  ['active', 'captured'];

/** The one state in which coins are still held and can still be charged. */
export const livePreferenceEntitlementReservedState: LivePreferenceEntitlementState =
  'active';

/**
 * How often the worker settles activations whose window has closed.
 *
 * Short, because an unsettled window is coins somebody cannot spend. It is
 * deliberately much shorter than the window itself, so the gap between "this
 * stopped being useful" and "these coins are spendable again" is seconds.
 */
export const livePreferenceSweepIntervalMilliseconds = 15_000;

/** How many closed activations one sweep settles. Bounded, like every sweep. */
export const livePreferenceSweepBatchSize = 100;

/**
 * How many activations one person may make in the abuse window.
 *
 * Not a spending limit — the balance is that. What this bounds is a client
 * activating and cancelling in a loop, which costs nothing but produces a
 * ledger transaction pair every time.
 */
export const maximumLivePreferenceActivationsPerWindow = 40;
export const walletAbuseWindowMilliseconds = 3_600_000;

/**
 * The premium matching preferences this product actually supports.
 *
 * Three, and every one of them is a field a person set about themselves.
 * `gender` narrows to a declared matching category, which USERS collects
 * through one route on the subject's own account. `region` narrows to a
 * declared ISO 3166-1 alpha-2 region, set during onboarding and already read by
 * the matcher for the free `same` narrowing. `language` narrows to a declared
 * profile language, and only to one the buyer speaks themselves.
 *
 * **What is absent matters as much as what is here.** There is no age band, no
 * body attribute, no appearance, no orientation, no compatibility score, no
 * popularity signal, and no "people like the ones you liked". Each of those is
 * either something VELORA does not collect, something no lawful basis covers,
 * or something that would have to be computed — and a computed preference is an
 * inferred one however it is dressed.
 *
 * Nothing here is ever inferred. No camera, face, name, voice, model, or
 * location proxy contributes to any value in this list, and the shape of this
 * module is what makes that checkable: a preference is a declared field or it
 * does not exist.
 *
 * The order is the order surfaces render, so two clients cannot disagree about
 * it without one of them ignoring the catalogue.
 */
export const livePremiumPreferenceKinds = [
  'gender',
  'region',
  'language',
] as const;
export type LivePremiumPreferenceKind =
  (typeof livePremiumPreferenceKinds)[number];

/**
 * The declared categories a `gender` preference may name.
 *
 * Restated here rather than imported for the reason at the top of this module,
 * and asserted identical to USERS' own list and to the published contract by
 * `test/unit/wallet-policy.test.ts`. `undisclosed` is deliberately absent: a
 * preference for people who declined to say would make declining an answer with
 * consequences.
 */
export const livePremiumGenderValues = ['woman', 'man', 'non_binary'] as const;
export type LivePremiumGenderValue = (typeof livePremiumGenderValues)[number];

/** ISO 3166-1 alpha-2, upper case. Mirrors USERS' own region constraint. */
export const regionCodePattern = '^[A-Z]{2}$';

/** BCP 47 primary subtag. Mirrors USERS' own profile-language constraint. */
export const languageCodePattern = '^[a-z]{2,3}$';

/**
 * What has to be decided before coins may exist in a deployed environment.
 * Each entry is a real blocker, not a caution, and configuration enforces the
 * list rather than merely documenting it.
 *
 * `declared-gender-attribute-not-collected` is gone because it has been
 * answered: the attribute is collected, optionally and by declaration only. The
 * legal question it stood beside has not gone away and is not the same
 * question, so it is stated here as its own blocker.
 */
export const productionBlockers = [
  'coin-money-value-undecided',
  'coin-expiry-policy-undecided',
  'coin-refundability-undecided',
  'virtual-currency-tax-treatment-unreviewed',
  'virtual-currency-consumer-protection-unreviewed',
  'play-billing-product-configuration-absent',
  'gender-preference-lawful-basis-unreviewed',
  'premium-preference-pricing-unapproved',
] as const;
