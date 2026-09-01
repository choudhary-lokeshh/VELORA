import { canonicalCreatorHandle, type CurrencyCode } from '@velora/validation';

import type { CommerceEligibility } from './commerce-eligibility.js';
import type { CommercePolicy } from './commerce-policy.js';
import type {
  OfferRepository,
  OfferRow,
  PriceRow,
} from './offer-repository.js';
import type { MonetisationReadiness, OfferService } from './offer-service.js';
import type { CommercialConsumerPort, CommercialCreatorPort } from './ports.js';
import type {
  SubscriptionRepository,
  SubscriptionRow,
} from './subscription-repository.js';

/**
 * What one creator currently sells, as somebody standing on their page sees it.
 *
 * The half of a membership card that is money, and only that half. This
 * publishes an opaque resource identifier, a price, and a cadence; the club
 * that identifier names, what it is called, and what a member gets are PRIVATE
 * CLUBS' to publish under the same identifier through its own route. Neither
 * domain reads the other's tables and neither route knows the other exists —
 * the surface asks for both and joins them, which is where a join between two
 * owners belongs.
 *
 * Three answers travel together because a surface that had only one of them
 * would mislead. The offers say what exists. `readiness` says whether the
 * platform may transact at all, so an empty list is not mistaken for a creator
 * who has published nothing. And the gates say why this particular person
 * cannot buy, which is the difference between "not for sale" and "not for sale
 * to you, here, in this currency".
 */

export interface MembershipOfferView {
  readonly offer: OfferRow;
  readonly prices: readonly PriceRow[];
}

export interface MembershipOfferListing {
  /** Every gate shut for this viewer, or nothing when no viewer was resolved. */
  readonly gates: readonly string[] | undefined;
  readonly handle: string;
  /**
   * The cadence of every price behind these offers, live or retired.
   *
   * Retired ones are here deliberately. A subscription taken out before a price
   * change still references the row it was sold at, and a page that could only
   * describe live prices would have nothing to say about what somebody is
   * actually paying.
   */
  readonly intervalsByPrice: ReadonlyMap<string, 'month' | 'year' | undefined>;
  readonly offers: readonly MembershipOfferView[];
  readonly readiness: MonetisationReadiness;
  readonly subscriptions: readonly SubscriptionRow[];
}

export interface MembershipServiceDependencies {
  readonly consumers: CommercialConsumerPort;
  readonly creators: CommercialCreatorPort;
  readonly eligibility: CommerceEligibility;
  readonly now: () => Date;
  readonly offers: OfferRepository;
  readonly offerService: OfferService;
  readonly policy: CommercePolicy;
  readonly subscriptions: SubscriptionRepository;
}

/** Widest page of one creator's live offers a public page will render. */
const maximumPublicOffers = 50;

export class MembershipService {
  constructor(private readonly dependencies: MembershipServiceDependencies) {}

  /**
   * One creator's live offers, with the viewer's own position against them.
   *
   * `consumerId` is absent for somebody with no session, and that absence is
   * carried rather than defaulted: an anonymous visitor gets prices and no
   * gates, because Velora cannot evaluate a country it was never told.
   */
  async listFor(input: {
    readonly consumerId: string | undefined;
    readonly handle: string;
  }): Promise<MembershipOfferListing | undefined> {
    const { creators, offers, offerService, subscriptions } = this.dependencies;
    const executor = offers.transactionless;
    const creatorId = await creators.publishedCreatorFor({
      executor,
      handle: input.handle,
    });
    // An unknown handle, an unpublished page, and a creator who may not operate
    // are one answer, so no caller can tell them apart.
    if (creatorId === undefined) return undefined;
    if (!(await creators.mayOperate({ creatorId, executor }))) return undefined;

    const readiness = offerService.readiness();
    const live = await offers.listActiveOffers(executor, {
      creatorId,
      limit: maximumPublicOffers,
    });
    const prices =
      live.length === 0
        ? []
        : await offers.pricesForOffers(
            executor,
            live.map((offer) => offer.id),
          );
    const views = live.map((offer) => ({
      offer,
      // Only live prices reach a page. A retired one is what somebody who
      // bought last month is still paying, and showing it to a stranger would
      // advertise a price they cannot have.
      prices: prices.filter(
        (price) => price.offerId === offer.id && price.state === 'active',
      ),
    }));

    const held =
      input.consumerId === undefined || live.length === 0
        ? []
        : await subscriptions.listForOffers(executor, {
            consumerId: input.consumerId,
            offerIds: live.map((offer) => offer.id),
          });

    return {
      gates: await this.gatesFor({
        consumerId: input.consumerId,
        creatorId,
        currencies: this.currenciesOf(views, readiness),
      }),
      handle: canonicalCreatorHandle(input.handle),
      intervalsByPrice: new Map(
        prices.map((price) => [price.id, price.billingInterval ?? undefined]),
      ),
      offers: views,
      readiness,
      subscriptions: held,
    };
  }

  /**
   * Which currencies to test the pairing against.
   *
   * What is actually on offer, when anything is; otherwise what approved terms
   * would allow, so a creator with nothing published still produces a truthful
   * answer about whether this visitor could buy from them at all.
   */
  private currenciesOf(
    views: readonly MembershipOfferView[],
    readiness: MonetisationReadiness,
  ): readonly CurrencyCode[] {
    const offered = new Set<string>();
    for (const view of views) {
      for (const price of view.prices) offered.add(price.currency);
    }
    return offered.size === 0
      ? readiness.currencies
      : ([...offered].sort() as readonly CurrencyCode[]);
  }

  /**
   * Every gate shut for this viewer, or none when any currency would pass.
   *
   * The union rather than the first refusal, because an operator and a consumer
   * both need to know which approvals are missing rather than which one was
   * checked first. A pairing that passes in any offered currency reports no
   * gates at all: the surface's job is then to offer that currency.
   */
  private async gatesFor(input: {
    readonly consumerId: string | undefined;
    readonly creatorId: string;
    readonly currencies: readonly CurrencyCode[];
  }): Promise<readonly string[] | undefined> {
    const { consumers, creators, eligibility, offers } = this.dependencies;
    if (input.consumerId === undefined) return undefined;
    const executor = offers.transactionless;
    const now = this.dependencies.now();
    const [standing, sellerCountry] = await Promise.all([
      consumers.standingForUser({ executor, now, userId: input.consumerId }),
      creators.operatingCountryFor({
        creatorId: input.creatorId,
        executor,
        now,
      }),
    ]);
    // Nothing to evaluate against. That is not a gate this viewer failed, it
    // is the platform having approved no currency at all, and `readiness`
    // already says so — reporting a per-viewer refusal here would blame a
    // person for a decision nobody has taken.
    if (input.currencies.length === 0) return undefined;
    const shut = new Set<string>();
    for (const currency of input.currencies) {
      const verdict = eligibility.evaluate({
        consumerCountry: standing?.region,
        sellerCountry,
        currency,
      });
      if (verdict.kind === 'permitted') return [];
      for (const gate of verdict.gates) shut.add(gate);
    }
    return [...shut].sort();
  }
}
