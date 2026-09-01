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
 * What an activation of a premium live preference costs, in coins.
 *
 * One price, for one thing: a bounded window in which the matcher applies a
 * narrowing the free product does not offer. It is not a per-match fee, not a
 * per-tap fee, and not a subscription.
 *
 * The number itself is provisional and marked as such in
 * `DECISIONS_REQUIRED.md`: what a coin is worth in money is undecided, so what
 * this costs in money is undecided with it. What is *not* provisional is that
 * the cost is a server constant read from here — no request field, header, or
 * client value contributes to what somebody is charged.
 */
export const livePreferenceEntitlementCoins = 25n;

/**
 * How long one activation lasts.
 *
 * Fifteen minutes, which is long enough to be worth buying and short enough
 * that somebody who walks away has not bought an afternoon. The window is what
 * is sold; a match inside it is the outcome, and the charging rule below is
 * what makes the difference between the two honest.
 */
export const livePreferenceEntitlementDurationMilliseconds = 900_000;

/**
 * How the charge actually works, stated once so no surface has to guess.
 *
 * **Reserve on activation, capture on the first filtered encounter, release in
 * full if the window closes without one.**
 *
 * Chosen over the two alternatives deliberately. Charging on tap would mean
 * somebody paying for a pool that turned out to be empty, which is the exact
 * behaviour that makes a paid filter feel like a trick. Charging only after a
 * successful match would mean the platform running a narrowed, more expensive
 * search for free for anybody who never matched, and would make the cost depend
 * on how busy the product happened to be that minute.
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
  'reserve-on-activation-capture-on-first-match-release-on-expiry';

/**
 * The lifecycle of one activation.
 *
 * `active` is a window that is open. `captured` is one that produced a filtered
 * encounter and was paid for. `released` is one that closed without producing
 * anything and cost nothing. `cancelled` is one the person closed themselves
 * before it produced anything, and it releases in full for the same reason.
 *
 * There is no `expired` distinct from `released`. An expiry that had not yet
 * been settled would be a state in which the books and the product disagree
 * about whether somebody has been charged, and the whole point of the sweep is
 * that no such state is durable.
 */
export const livePreferenceEntitlementStates = [
  'active',
  'captured',
  'released',
  'cancelled',
] as const;
export type LivePreferenceEntitlementState =
  (typeof livePreferenceEntitlementStates)[number];

/** The states in which an activation is still worth acting on. */
export const livePreferenceEntitlementOpenStates: readonly LivePreferenceEntitlementState[] =
  ['active'];

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
 * One, and it is the one the data can honestly answer. `region` narrows to a
 * declared ISO 3166-1 alpha-2 region, which is a field a person set themselves
 * during onboarding, which USERS already owns, and which the matcher already
 * reads for the free `same` narrowing.
 *
 * **What is deliberately absent matters more than what is here.** A
 * declared-gender preference — the "Women only" filter this product is
 * eventually expected to sell — has no field to read. `packages/validation`
 * records that the minimum discoverable profile deliberately excludes gender so
 * that "nobody is asked to hand over sensitive data as the price of being
 * seen", and there is no column for it anywhere in USERS. Adding one is a
 * product, policy, and legal decision about collecting a special-category
 * attribute, not an implementation detail, and it is recorded as an owner
 * decision in `DECISIONS_REQUIRED.md`.
 *
 * Nothing here is ever inferred. No camera, face, name, voice, model, or
 * location proxy contributes to any value in this list, and the shape of this
 * module is what makes that checkable: a preference is a declared field or it
 * does not exist.
 */
export const livePremiumPreferenceKinds = ['region'] as const;
export type LivePremiumPreferenceKind =
  (typeof livePremiumPreferenceKinds)[number];

/** ISO 3166-1 alpha-2, upper case. Mirrors USERS' own region constraint. */
export const regionCodePattern = '^[A-Z]{2}$';

/**
 * What has to be decided before coins may exist in a deployed environment.
 * Each entry is a real blocker, not a caution, and configuration enforces the
 * list rather than merely documenting it.
 */
export const productionBlockers = [
  'coin-money-value-undecided',
  'coin-expiry-policy-undecided',
  'coin-refundability-undecided',
  'virtual-currency-tax-treatment-unreviewed',
  'virtual-currency-consumer-protection-unreviewed',
  'play-billing-product-configuration-absent',
  'declared-gender-attribute-not-collected',
] as const;
