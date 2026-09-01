import { isCurrencyCode, type CurrencyCode } from '@velora/validation';

import type { CommerceEligibility } from '../billing/commerce-eligibility.js';
import type { OfferRepository } from '../billing/offer-repository.js';
import type { CommercialConsumerPort } from '../billing/ports.js';
import { coinPackCoins, coinPacks } from './catalogue.js';
import type { CoinPackCatalogue, CoinPackOffer } from './routes.js';

/**
 * Publishing the platform's own coin packs, where an environment sells them.
 *
 * It exists because a coin pack has no creator to open commercial terms for it.
 * Every other offer in this product is created by the person selling it through
 * a Studio route; VELORA's own product has nobody to press that button, so the
 * offers are published by the platform itself.
 *
 * **It runs only where configuration says the Web may acquire coins**, which is
 * local and test and nowhere else — the environment guard refuses the value
 * outside them. So a deployed environment has no coin-pack offer at all, rather
 * than one that exists and refuses: nothing renders, nothing is purchasable,
 * and there is no row for a later mistake to activate.
 *
 * **The prices are development values and are marked as such.** What a coin is
 * worth in money is undecided, so what a pack costs is undecided with it; these
 * exist to make the purchase path walkable and propose nothing. They are the
 * one thing here that must not survive into a real catalogue, which is why they
 * are computed from the pack's coin count at a flat rate rather than typed as
 * three separate numbers somebody could mistake for approved tiers.
 *
 * Idempotent throughout. It runs at every start, produces one offer and one
 * price per pack however many times it runs, and never edits a price — because
 * a price is never edited anywhere in this repository, and a purchase
 * references the exact one it was made against.
 */

/**
 * The development rate, in minor units per coin.
 *
 * Flat, so a larger pack is proportionally more money and never a better deal.
 * Whether a larger pack should be cheaper per coin is a commercial decision
 * nobody has made, and a fixture that quietly made it would be a discount
 * structure arriving through a test adapter.
 */
const developmentMinorUnitsPerCoin = 5n;

/** The one currency the local commerce authority admits for this pairing. */
const developmentCurrency = 'EUR';

export async function publishPlatformCoinPacks(input: {
  readonly now: () => Date;
  readonly offers: OfferRepository;
}): Promise<void> {
  const at = input.now();
  for (const pack of coinPacks) {
    const offer = await input.offers.ensurePlatformOffer(
      input.offers.transactionless,
      { now: at, resourceId: pack.resourceId, resourceType: 'coins' },
    );
    if (offer === undefined) continue;
    const live = await input.offers.livePricesFor(
      input.offers.transactionless,
      offer.id,
    );
    // One live price per pack. A second would make "what does this cost"
    // ambiguous, and the checkout would have to pick one for somebody.
    if (live.length > 0) continue;
    await input.offers.insertPrice(input.offers.transactionless, {
      amountMinor: pack.coins * developmentMinorUnitsPerCoin,
      billingInterval: undefined,
      commercialMode: 'one_time',
      currency: developmentCurrency,
      effectiveFrom: at,
      now: at,
      offerId: offer.id,
    });
  }
}

/**
 * The coin packs on sale, with the price BILLING published for each, and why a
 * particular person cannot buy one.
 *
 * Assembled where all three domains are visible, which is the composition —
 * WALLET has the coin count, BILLING has the price and the commercial gates,
 * and USERS has where somebody is. None of them holds a copy of another's fact.
 *
 * A pack whose offer or price is missing is simply absent from the answer: a
 * surface must never render a pack it cannot start a checkout for. And the
 * gates are evaluated *here* rather than discovered by a failed purchase,
 * because "your account cannot do that in its current state" is what a generic
 * refusal reads as, and somebody in a country VELORA has not approved has done
 * nothing to their account.
 */
export async function coinPackOffers(input: {
  readonly consumers: CommercialConsumerPort;
  readonly eligibility: CommerceEligibility;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly userId: string;
}): Promise<CoinPackCatalogue> {
  const { offers } = input;
  const published = await offers.findPlatformOffers(
    offers.transactionless,
    'coins',
  );
  const assembled: CoinPackOffer[] = [];
  const currencies = new Set<CurrencyCode>();
  for (const offer of published) {
    const coins = coinPackCoins(offer.resourceId);
    if (coins === undefined) continue;
    const prices = await offers.livePricesFor(offers.transactionless, offer.id);
    const price = prices[0];
    if (price === undefined) continue;
    // The stored value passed the journal's own currency check, so this is the
    // type system catching up with a constraint rather than a second rule.
    if (isCurrencyCode(price.currency)) currencies.add(price.currency);
    assembled.push({
      amountMinor: price.amountMinor,
      coins,
      currency: price.currency,
      offerId: offer.id,
      priceId: price.id,
    });
  }

  // Nothing to evaluate against. That is not a gate this viewer failed, it is
  // the platform selling nothing — and reporting a per-viewer refusal would
  // blame a person for a decision nobody has taken.
  if (currencies.size === 0) return { gates: undefined, packs: assembled };

  const now = input.now();
  const standing = await input.consumers.standingForUser({
    executor: offers.transactionless,
    now,
    userId: input.userId,
  });
  const sellerCountry = input.eligibility.platformCountry();
  const shut = new Set<string>();
  for (const currency of currencies) {
    const verdict = input.eligibility.evaluate({
      consumerCountry: standing?.region,
      currency,
      sellerCountry,
    });
    if (verdict.kind === 'permitted') {
      return { gates: [], packs: assembled };
    }
    for (const gate of verdict.gates) shut.add(gate);
  }
  return { gates: [...shut].sort(), packs: assembled };
}
