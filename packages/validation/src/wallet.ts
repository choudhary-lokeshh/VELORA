import { z } from 'zod';

import { commerceGateSchema } from './billing.js';
import { moneySchema } from './money.js';
import { profileLanguageSchema } from './profile.js';
import { matchableGenderSchema, regionSchema } from './users.js';

/**
 * The coin wallet contract, and the one thing coins currently buy.
 *
 * Three rules shape every schema here, and each is a thing that goes wrong when
 * a virtual balance is modelled carelessly.
 *
 * **A balance is a server fact and a client rendering.** Every response below
 * carries what the server believes; no request below carries a balance, a
 * price, or an amount to charge. There is deliberately no shape in which a
 * client can say what something costs.
 *
 * **Coins are not money and the contract never spells them as money.** They are
 * whole non-negative integers with no currency, no minor unit, and no decimal
 * point. They are carried as strings for the same reason a monetary amount is:
 * a JSON number is a double, and a double will silently accept a fractional
 * coin.
 *
 * **Nothing here is a game.** There is no shape for a streak, a bonus, a
 * multiplier, a random reward, a countdown, a discount, or a scarcity signal.
 * Coins are a utility: they buy one bounded, explicitly described thing, and
 * the response says exactly what that thing is and when it ends.
 */

/** A whole, non-negative count of coins, as the canonical wire spelling. */
export const coinAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,18})$/u, 'must be a whole count of coins');

/**
 * What somebody holds, and what is committed to something already open.
 *
 * Two numbers rather than one, because "you have 40 coins" while 25 of them are
 * held against a window you activated a minute ago is a true statement that
 * makes a person think they can spend 40. `available` is what a purchase can be
 * made from; `reserved` is what is already promised.
 */
export const coinBalanceSchema = z
  .object({
    available: coinAmountSchema,
    reserved: coinAmountSchema,
  })
  .strict();

/**
 * One selection of premium preferences, as every shape here carries it.
 *
 * Named fields rather than a list of kind/value pairs. A list can hold the same
 * kind twice and can hold a kind nobody published, and both are states a
 * surface would then have to have an opinion about. Every field is optional and
 * every combination is a conjunction: `{ gender: 'woman', region: 'FR' }` means
 * women in France, and nothing in this contract can express "or".
 *
 * There is deliberately no field for an age, a body attribute, an appearance,
 * an orientation, a compatibility target, or a person. A contract that could
 * hold one is a contract somebody eventually fills in.
 */
export const livePreferenceSelectionSchema = z
  .object({
    /**
     * A declared matching category.
     *
     * `undisclosed` is absent from this enum and its absence is the point: a
     * preference for people who declined to say would turn declining into an
     * answer with consequences.
     */
    gender: matchableGenderSchema.optional(),
    /**
     * A declared profile language, which the buyer must also speak.
     *
     * It means "the other person speaks this too". Asking for a language you do
     * not speak is a search that means nothing, so the server refuses to sell
     * one rather than selling a filter it would have to quietly drop.
     */
    language: profileLanguageSchema.optional(),
    /** A declared ISO 3166-1 alpha-2 region. */
    region: regionSchema.optional(),
  })
  .strict();

/**
 * The paid narrowing this person currently holds, when they hold one.
 *
 * A *window*, and the shape says so: it names what is being applied, when it
 * ends, what it cost, and whether it has been charged yet. It carries no count
 * of matching people, no estimated wait, and no probability, because none of
 * those is a number this platform has — publishing one would be inventing it.
 */
export const livePreferenceEntitlementSchema = livePreferenceSelectionSchema
  .extend({
    /**
     * Whether the coins have already been charged for this window.
     *
     * `false` means they are held and will come back in full if nothing is
     * found. `true` means the window found somebody and was charged once; it
     * keeps narrowing for the rest of its time, every further match inside it
     * is free, and ending it early returns nothing. A surface that could not
     * tell those apart would either promise a refund that is not coming or
     * threaten a charge that already happened.
     */
    charged: z.boolean(),
    coins: coinAmountSchema,
    /** When this window closes. */
    expiresAt: z.iso.datetime(),
    id: z.uuid(),
  })
  .strict();

/**
 * What the premium preferences cost and how long a window lasts, published by
 * the server.
 *
 * Published rather than hard-coded in a surface, so a price can never be
 * rendered that is not the price that will be charged, and a preference can be
 * withdrawn or repriced without shipping a client. `durationSeconds` is beside
 * the prices because the window is what is being bought, and a control that
 * showed a price without it would be describing half a purchase.
 *
 * A selection costs the sum of the kinds in it. Stated here rather than left to
 * each surface to work out, because two surfaces deriving the same total
 * independently is two surfaces that can disagree with the server about what
 * somebody is about to pay.
 */
export const livePreferenceCatalogueSchema = z
  .object({
    durationSeconds: z.int().positive().max(86_400),
    preferences: z
      .array(
        z
          .object({
            coins: coinAmountSchema,
            kind: z.enum(['gender', 'region', 'language']),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();

/**
 * Everything a wallet surface renders, in one authoritative answer.
 *
 * `enabled` is separate from a zero balance on purpose. An environment with no
 * coin ledger is not somebody with no coins: the first must not be offered a
 * purchase, and a surface that could not tell them apart would offer one that
 * could never complete.
 *
 * `acquisition` says which channels can actually take money right now, so a
 * surface never renders a buy control that would fail. It is a statement about
 * this environment rather than about this person.
 */
export const walletStateResponseSchema = z
  .object({
    acquisition: z
      .object({
        /**
         * Whether the Android application may currently acquire coins, and
         * through which mechanism. `unavailable` is the deployed answer: no
         * Play Console project, product identifier, or service-account
         * credential exists to verify a purchase against.
         */
        android: z.enum(['unavailable', 'local-test']),
        /**
         * Whether the Web may currently acquire coins. It follows the payment
         * provider, which is unavailable in every environment: no provider is
         * approved.
         */
        web: z.enum(['unavailable', 'local-test']),
      })
      .strict(),
    balance: coinBalanceSchema.optional(),
    enabled: z.boolean(),
    livePreference: livePreferenceEntitlementSchema.optional(),
    livePreferenceCatalogue: livePreferenceCatalogueSchema,
  })
  .strict();

/**
 * Opening a paid window of narrowed matching.
 *
 * The selection is the whole of the request. There is no amount, no duration,
 * and no product identifier: what it costs and how long it lasts are server
 * facts, so a client cannot ask for a cheaper window or a longer one, and a
 * client that renders a price it computed itself is rendering a guess.
 *
 * At least one preference is required. A window that narrowed nothing would be
 * somebody being charged for `Everyone`, which is free.
 */
export const activateLivePreferenceRequestSchema =
  livePreferenceSelectionSchema.refine(
    (value) =>
      value.gender !== undefined ||
      value.language !== undefined ||
      value.region !== undefined,
    'An activation must narrow at least one preference',
  );

/**
 * Widening a window that is already running.
 *
 * The body is the selection that should remain — so dropping "in France" from
 * "women in France" is sent as `{ gender: 'woman' }`. Expressed as what is kept
 * rather than as what is removed, because the server then compares two
 * selections rather than applying a diff, and a request that named a kind the
 * window never had is simply refused instead of silently doing nothing.
 *
 * It never charges and never refunds. The server refuses anything that is not
 * strictly a widening — adding a preference, or swapping one value for another
 * — because either could cost more than what was already paid, and a surprise
 * charge is the failure that makes a paid control untrustworthy. Emptying the
 * selection entirely is `Everyone`, which is cancellation and has its own
 * operation, because that is the path that knows whether coins are owed back.
 */
export const broadenLivePreferenceRequestSchema =
  livePreferenceSelectionSchema.refine(
    (value) =>
      value.gender !== undefined ||
      value.language !== undefined ||
      value.region !== undefined,
    'Widening to nothing is a cancellation, not a widening',
  );

/**
 * What one movement of somebody's coins was, in their terms.
 *
 * A closed vocabulary of *product* events rather than the ledger's own reasons,
 * even where the two currently coincide. A person reading their history needs
 * to know what happened to their coins and why; they do not need an account
 * name, a posting direction, a transaction identifier, or the existence of a
 * double-entry book behind any of it.
 *
 * `correction` is the one entry that is deliberately vague, and it is honest
 * about it: it means the platform repaired an earlier mistake, which is a thing
 * that should be visible and is not a thing a person can act on.
 */
export const walletActivityKinds = [
  /** Coins the platform gave. Development, support, or promotion. */
  'grant',
  /** Coins a verified purchase produced. */
  'purchase',
  /** A purchase that came back, and the coins with it. */
  'purchase_reversed',
  /** Coins held against a matching window that had not yet found anybody. */
  'reservation',
  /** Held coins used, because the window found somebody. */
  'spend',
  /** Held coins returned, because the window found nobody. */
  'release',
  /** A balanced repair of an earlier movement. */
  'correction',
] as const;
export const walletActivityKindSchema = z.enum(walletActivityKinds);

/**
 * One line of somebody's own coin history.
 *
 * `coins` is a magnitude and never a signed number: which way it went is what
 * `kind` says, and a surface that had to interpret a sign as well as a kind
 * would eventually render one of them backwards.
 *
 * `preference` is present only on the lines that belong to a matching window,
 * and it is what makes a history line answerable — "25 coins held" is a fact
 * nobody can check, and "Women · France — 25 coins held" is one they can.
 *
 * There is no provider name, no payment identifier, no store token, no account
 * category, and no ledger transaction identifier. None of them is something a
 * person needs, and each is something a leaked history would hand to somebody
 * who should not have it.
 */
export const walletActivitySchema = z
  .object({
    coins: coinAmountSchema,
    id: z.uuid(),
    kind: walletActivityKindSchema,
    occurredAt: z.iso.datetime(),
    /** The window this line belongs to, when it belongs to one. */
    preference: livePreferenceSelectionSchema.optional(),
  })
  .strict();

/**
 * A page of somebody's own coin history, newest first.
 *
 * Paged rather than whole, because a history grows for as long as an account is
 * active and nothing here expires — a financial record that vanished would make
 * a dispute unanswerable.
 */
export const walletActivityListResponseSchema = z
  .object({
    activity: z.array(walletActivitySchema).max(100),
    nextCursor: z.string().min(1).max(512).optional(),
  })
  .strict();

/**
 * One coin pack the platform sells, and what it costs.
 *
 * Two independent facts, side by side and never derived from each other. The
 * coin count is a constant of the product and is fixed for ever once a pack has
 * been sold; the money price is BILLING's, in BILLING's currency, under
 * commercial terms that may change. A surface that computed one from the other
 * would eventually tell somebody a purchase was worth something it was not.
 *
 * There is deliberately no `bestValue`, no `savingPercent`, no crossed-out
 * price, no badge, and no "most popular". Every one of those is a claim about
 * a comparison nobody has approved, and a shape that could hold one is a shape
 * somebody eventually fills in.
 */
export const coinPackSchema = z
  .object({
    coins: coinAmountSchema,
    /** What one purchase of this pack costs, as BILLING publishes money. */
    price: moneySchema,
    /** The identity a checkout is started against. */
    priceId: z.uuid(),
    /** The offer, which is what a checkout names. */
    offerId: z.uuid(),
  })
  .strict();

/**
 * The coin packs on sale, and whether this environment can sell any.
 *
 * `channel` says what could take money right now rather than what exists in
 * principle. `unavailable` comes with an empty list, because a surface holding
 * packs it cannot sell is a surface one refactor away from rendering a buy
 * control that fails.
 */
export const coinPackListResponseSchema = z
  .object({
    channel: z.enum(['unavailable', 'local-test']),
    /**
     * Every commercial gate that is shut for this viewer, empty when none is.
     *
     * Present so a surface can say why rather than offering a purchase that
     * fails with a message about the "account's state". Somebody in a country
     * VELORA has not approved has done nothing wrong, and a refusal that
     * implied otherwise would send them to fix something that was never the
     * problem.
     */
    gates: z.array(commerceGateSchema).optional(),
    packs: z.array(coinPackSchema).max(20),
  })
  .strict();

/**
 * Turning an Android store purchase into coins.
 *
 * The token is evidence, never authority. The server verifies it with the
 * store, derives the coin amount from its own catalogue keyed by the product
 * the store confirmed, and credits idempotently against the store's own
 * purchase identity. A client that sent a token for a small pack and named a
 * large one is credited what it actually bought.
 *
 * There is deliberately no `coins` field. A request that could say what a
 * purchase was worth is a request that mints currency.
 */
export const androidCoinPurchaseRequestSchema = z
  .object({
    productReference: z.string().min(1).max(200),
    purchaseToken: z.string().min(1).max(2_000),
  })
  .strict();

/**
 * A development grant, reachable only where the environment is local or test.
 *
 * It exists so the wallet, the entitlement, and the matching that depends on
 * them are walkable before any store or payment provider is approved. The
 * reference is the caller's idempotency key, so a retried grant credits once.
 *
 * The route refuses outside local and test rather than the shape being absent
 * from the contract, because a published contract that hid an operation would
 * be a contract that did not describe the server.
 */
export const coinGrantRequestSchema = z
  .object({
    coins: coinAmountSchema,
    reference: z.string().min(8).max(128),
  })
  .strict();

export type ActivateLivePreferenceRequest = z.infer<
  typeof activateLivePreferenceRequestSchema
>;
export type AndroidCoinPurchaseRequest = z.infer<
  typeof androidCoinPurchaseRequestSchema
>;
export type BroadenLivePreferenceRequest = z.infer<
  typeof broadenLivePreferenceRequestSchema
>;
export type CoinPack = z.infer<typeof coinPackSchema>;
export type CoinPackListResponse = z.infer<typeof coinPackListResponseSchema>;
export type WalletActivity = z.infer<typeof walletActivitySchema>;
export type WalletActivityKind = z.infer<typeof walletActivityKindSchema>;
export type WalletActivityListResponse = z.infer<
  typeof walletActivityListResponseSchema
>;
export type CoinBalance = z.infer<typeof coinBalanceSchema>;
export type CoinGrantRequest = z.infer<typeof coinGrantRequestSchema>;
export type LivePreferenceCatalogue = z.infer<
  typeof livePreferenceCatalogueSchema
>;
export type LivePreferenceEntitlement = z.infer<
  typeof livePreferenceEntitlementSchema
>;
export type LivePreferenceSelection = z.infer<
  typeof livePreferenceSelectionSchema
>;
export type WalletStateResponse = z.infer<typeof walletStateResponseSchema>;
