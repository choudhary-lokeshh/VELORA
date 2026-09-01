/**
 * What a coin pack is worth, decided here and nowhere else.
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
 * The single entry below exists so the Web acquisition path is walkable end to
 * end locally. Adding a real catalogue is an owner decision that depends on
 * what a coin is worth, which `DECISIONS_REQUIRED.md` records as unanswered.
 */
const coinPacks: Readonly<Record<string, bigint>> = {
  /**
   * The one pack the local world sells.
   *
   * Named for what it is rather than for a marketing tier, so nobody has to
   * decide what "starter" means before somebody has decided what a coin is
   * worth.
   */
  'velora.coins.pack.100': 100n,
};

export function coinPackCoins(resourceId: string): bigint | undefined {
  return Object.hasOwn(coinPacks, resourceId)
    ? coinPacks[resourceId]
    : undefined;
}

/** Every pack this platform sells, for a test that asserts the set is closed. */
export const coinPackIdentifiers: readonly string[] = Object.keys(coinPacks);
