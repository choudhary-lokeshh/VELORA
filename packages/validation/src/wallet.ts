import { z } from 'zod';

import { regionSchema } from './users.js';

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
 * The paid narrowing this person currently holds, when they hold one.
 *
 * A *window*, and the shape says so: it names what is being applied, when it
 * ends, and what it cost. It carries no count of matching people, no estimated
 * wait, and no probability, because none of those is a number this platform
 * has — publishing one would be inventing it.
 */
export const livePreferenceEntitlementSchema = z
  .object({
    coins: coinAmountSchema,
    /** When this window closes. After it, the coins return in full. */
    expiresAt: z.iso.datetime(),
    id: z.uuid(),
    /** The declared region the matcher is narrowing to while this is open. */
    region: regionSchema,
  })
  .strict();

/**
 * What one activation costs and how long it lasts, published by the server.
 *
 * Published rather than hard-coded in a surface, so a price can never be
 * rendered that is not the price that will be charged. `durationSeconds` is
 * beside it because the two together are the whole of what is being bought,
 * and a control that showed one without the other would be describing half a
 * purchase.
 */
export const livePreferenceOfferSchema = z
  .object({
    coins: coinAmountSchema,
    durationSeconds: z.int().positive().max(86_400),
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
    livePreferenceOffer: livePreferenceOfferSchema,
  })
  .strict();

/**
 * Opening a paid window of narrowed matching.
 *
 * The region is the whole of the request. There is no amount, no duration, and
 * no product identifier: what it costs and how long it lasts are server
 * constants, so a client cannot ask for a cheaper window or a longer one.
 *
 * The shape admits one declared region and nothing else. It cannot express a
 * gender, an age, an appearance, a compatibility target, or a list — not
 * because a surface would not send one, but because a contract that could hold
 * one is a contract somebody eventually fills in.
 */
export const activateLivePreferenceRequestSchema = z
  .object({
    region: regionSchema,
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
export type CoinBalance = z.infer<typeof coinBalanceSchema>;
export type CoinGrantRequest = z.infer<typeof coinGrantRequestSchema>;
export type LivePreferenceEntitlement = z.infer<
  typeof livePreferenceEntitlementSchema
>;
export type LivePreferenceOffer = z.infer<typeof livePreferenceOfferSchema>;
export type WalletStateResponse = z.infer<typeof walletStateResponseSchema>;
