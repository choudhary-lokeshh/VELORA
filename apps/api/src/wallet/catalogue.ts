import { createHash } from 'node:crypto';

/**
 * What a coin pack is, decided here and nowhere else.
 *
 * The single place that answers "how many coins does this product produce".
 * Both acquisition channels read it: a settled Web purchase resolves the pack
 * BILLING named, and an Android purchase resolves the product the store
 * confirmed. Neither reads a coin count out of a payload, because a payload
 * that could carry one is a payload that mints currency.
 *
 * **A pack's coin value is fixed for ever once it is sold.** That is why this
 * is a table of identifiers rather than a derivation from a price: a price
 * changes, and an offer whose price changed must not retroactively change what
 * an earlier purchase was worth.
 *
 * **What a pack costs in money is not here.** Prices are BILLING's, in
 * BILLING's currencies, under BILLING's approved commercial policy — and no
 * commercial policy is approved, so no pack has a price in any deployed
 * environment. The separation is deliberate: a coin count that lived beside a
 * price would eventually be computed from one.
 *
 * **Nothing here is a bundle.** The three packs are round multiples of each
 * other and are named for their size, so a larger one is more coins and not a
 * better deal. There is no bonus tier, no "best value", no crossed-out price,
 * and no pack whose only purpose is to make another look cheap — and there is
 * deliberately nowhere in this shape for one, because whether a larger pack
 * should cost proportionally less is a commercial decision nobody has made.
 */
interface CoinPack {
  readonly coins: bigint;
  /**
   * The stable product identity, in the platform's own namespace.
   *
   * It is what a Play product would be named after and what a support question
   * three years from now would quote. It never changes, and a pack that is
   * withdrawn is removed from the offer rather than renamed.
   */
  readonly reference: string;
}

const packs: readonly CoinPack[] = [
  { coins: 100n, reference: 'velora.coins.pack.100' },
  { coins: 500n, reference: 'velora.coins.pack.500' },
  { coins: 1000n, reference: 'velora.coins.pack.1000' },
];

/**
 * The identifier a pack carries as a commercial resource, derived rather than
 * allocated.
 *
 * BILLING's offers point at a resource by UUID, and a coin pack has no row
 * anywhere to take an identifier from — it is a constant of the platform. A
 * derived identifier makes the same pack carry the same identity in every
 * environment, so a settled purchase resolves to the same coin count locally,
 * in a test, and wherever this eventually runs, without a table to keep in
 * step.
 *
 * UUID version 8 is the RFC 9562 slot for an identifier whose bits the
 * application defines. The `wallet.coins` prefix is part of the hashed input,
 * so a pack identifier can never collide with a club's or a gift's.
 */
export function coinPackResourceId(reference: string): string {
  const digest = createHash('sha256')
    .update(`wallet.coins|${reference}`, 'utf8')
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Every pack this platform sells, with the identity BILLING knows it by. */
export const coinPacks: readonly (CoinPack & {
  readonly resourceId: string;
})[] = packs.map((pack) => ({
  ...pack,
  resourceId: coinPackResourceId(pack.reference),
}));

/**
 * How many coins one resource identifier is worth, or nothing.
 *
 * Nothing for an identifier this platform does not sell, which is what makes a
 * commercial fact naming an unknown resource a fact this domain ignores rather
 * than one it guesses at.
 */
export function coinPackCoins(resourceId: string): bigint | undefined {
  return coinPacks.find((pack) => pack.resourceId === resourceId)?.coins;
}

/** Every pack this platform sells, for a test that asserts the set is closed. */
export const coinPackIdentifiers: readonly string[] = coinPacks.map(
  (pack) => pack.reference,
);
