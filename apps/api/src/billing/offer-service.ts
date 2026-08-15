import { isCurrencyCode, type CurrencyCode } from '@velora/validation';

import type { Executor } from '../database/executor.js';
import type { CommercePolicy } from './commerce-policy.js';
import { decodeOfferCursor, encodeOfferCursor } from './cursor.js';
import type {
  OfferRepository,
  OfferRow,
  PriceRow,
} from './offer-repository.js';
import {
  maximumLivePricesPerOffer,
  maximumOfferPageSize,
  type BillingInterval,
  type CommercialMode,
  type CommercialResourceType,
} from './offer-policy.js';
import type { CommercialCreatorPort, CommercialResourcePort } from './ports.js';

/**
 * Commercial offers, and the conditions under which one becomes purchasable.
 *
 * The rule this file exists to enforce is that "purchasable" is a conjunction
 * that is re-evaluated at the moment of activation, from current state, and
 * never inferred from an earlier decision. A creator who was active when they
 * drafted an offer, a club that was published last week, and a currency that
 * somebody once approved are each necessary and none of them is sufficient.
 *
 * No commercial term is decided here. What an offer may cost, in what currency,
 * on what cadence, comes entirely from the approved commerce policy, which
 * publishes nothing in any deployed environment.
 */

export interface MonetisationReadiness {
  readonly currencies: readonly CurrencyCode[];
  /** True only when approved terms exist that something could be sold under. */
  readonly enabled: boolean;
  readonly intervals: readonly BillingInterval[];
  readonly modes: readonly CommercialMode[];
  /** The policy adapter in force, for the surface to report honestly. */
  readonly source: string;
}

export interface OfferView {
  readonly offer: OfferRow;
  readonly prices: readonly PriceRow[];
}

export interface OfferPage {
  readonly nextCursor: string | undefined;
  readonly readiness: MonetisationReadiness;
  readonly rows: readonly OfferView[];
}

/**
 * Why a commercial action was refused.
 *
 * `unavailable` is deliberately separate from every other refusal: it describes
 * the environment rather than the caller or the request, and a surface must say
 * "monetisation is not enabled here" rather than implying the creator did
 * something wrong. `not_eligible` collapses an unknown resource, somebody
 * else's resource, an unpublished one, and a creator who may not operate,
 * because telling them apart would let one creator probe another's catalog.
 */
export type OfferRefusal =
  'conflict' | 'not_eligible' | 'price_not_permitted' | 'unavailable';

export type OfferOutcome =
  | { readonly kind: 'refused'; readonly reason: OfferRefusal }
  | { readonly kind: 'ready'; readonly view: OfferView };

export interface OfferServiceDependencies {
  readonly creators: CommercialCreatorPort;
  readonly now: () => Date;
  readonly policy: CommercePolicy;
  readonly repository: OfferRepository;
  readonly resources: CommercialResourcePort;
}

function refused(reason: OfferRefusal): OfferOutcome {
  return { kind: 'refused', reason };
}

export class OfferService {
  constructor(private readonly dependencies: OfferServiceDependencies) {}

  /**
   * What the platform can currently sell, and under what terms.
   *
   * Answered whatever the policy says, because a creator is entitled to know
   * that monetisation is unavailable rather than meeting a form that refuses.
   */
  readiness(): MonetisationReadiness {
    const { policy } = this.dependencies;
    const currencies = policy.currencies();
    return {
      currencies,
      // Terms exist only when there is at least one currency, one mode, and —
      // for anything recurring — one interval. A partial policy is not a
      // reduced-functionality policy; it is an unfinished one.
      enabled: currencies.length > 0 && policy.modes.length > 0,
      intervals: policy.intervals,
      modes: policy.modes,
      source: policy.source,
    };
  }

  async listOwn(input: {
    readonly creatorId: string;
    readonly cursor: string | undefined;
    readonly pageSize: number;
  }): Promise<OfferPage> {
    const { repository } = this.dependencies;
    const size = Math.min(input.pageSize, maximumOfferPageSize);
    const rows = await repository.listOwnOffers(repository.transactionless, {
      after:
        input.cursor === undefined
          ? undefined
          : decodeOfferCursor(input.cursor),
      creatorId: input.creatorId,
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    const prices = await repository.pricesForOffers(
      repository.transactionless,
      page.map((offer) => offer.id),
    );
    const byOffer = new Map<string, PriceRow[]>();
    for (const price of prices) {
      const existing = byOffer.get(price.offerId);
      if (existing === undefined) byOffer.set(price.offerId, [price]);
      else existing.push(price);
    }
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeOfferCursor({ id: last.id, moment: last.createdAt })
          : undefined,
      readiness: this.readiness(),
      rows: page.map((offer) => ({
        offer,
        prices: byOffer.get(offer.id) ?? [],
      })),
    };
  }

  /**
   * Opens draft commercial terms against a resource the creator owns.
   *
   * A draft requires the resource to exist and belong to the caller, and
   * nothing more: preparing terms for a club that is not published yet is
   * ordinary work. Publishing them is the step that requires everything else.
   *
   * It still requires an approved policy. A platform that has approved no
   * currency cannot help somebody draft a price, and a form that accepted one
   * would be collecting a number that no approved term could ever validate.
   */
  async createOffer(input: {
    readonly commercialMode: CommercialMode;
    readonly creatorId: string;
    readonly resourceId: string;
    readonly resourceType: CommercialResourceType;
  }): Promise<OfferOutcome> {
    const { policy, repository, resources } = this.dependencies;
    if (!this.readiness().enabled) return refused('unavailable');
    if (!policy.modes.includes(input.commercialMode)) {
      return refused('price_not_permitted');
    }
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const eligible = await this.creatorMayOffer(executor, input.creatorId);
      if (!eligible) return refused('not_eligible');
      const resource = await resources.offerableResource({
        creatorId: input.creatorId,
        executor,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
      });
      if (resource === 'absent') return refused('not_eligible');
      const offer = await repository.insertOffer(executor, {
        commercialMode: input.commercialMode,
        creatorId: input.creatorId,
        now,
        resourceId: input.resourceId,
        resourceType: input.resourceType,
      });
      // The unique index decided. A live offer already covers this resource and
      // mode, and the caller has to retire it before opening another.
      if (offer === undefined) return refused('conflict');
      return { kind: 'ready', view: { offer, prices: [] } } as const;
    });
  }

  /**
   * Publishes a price against an offer.
   *
   * The amount is validated against approved bounds for its currency before
   * anything is written, and the cadence must match the offer's mode. Both are
   * also database constraints; these checks exist so a creator gets an answer
   * rather than a constraint violation.
   */
  async publishPrice(input: {
    readonly amountMinor: bigint;
    readonly billingInterval: BillingInterval | undefined;
    readonly creatorId: string;
    readonly currency: string;
    readonly offerId: string;
  }): Promise<OfferOutcome> {
    const { policy, repository } = this.dependencies;
    if (!this.readiness().enabled) return refused('unavailable');
    if (!isCurrencyCode(input.currency)) return refused('price_not_permitted');
    const bounds = policy.boundsFor(input.currency);
    if (bounds === undefined) return refused('price_not_permitted');
    if (
      input.amountMinor < bounds.minimumMinor ||
      input.amountMinor > bounds.maximumMinor
    ) {
      return refused('price_not_permitted');
    }
    if (
      input.billingInterval !== undefined &&
      !policy.intervals.includes(input.billingInterval)
    ) {
      return refused('price_not_permitted');
    }
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const offer = await repository.findOwnOffer(executor, {
        creatorId: input.creatorId,
        offerId: input.offerId,
      });
      if (offer === undefined) return refused('not_eligible');
      // A retired offer keeps its price history and gains nothing new. Adding
      // to it would create terms that nothing could ever sell under.
      if (offer.state === 'retired') return refused('conflict');
      const recurring = offer.commercialMode === 'subscription';
      if (recurring !== (input.billingInterval !== undefined)) {
        return refused('price_not_permitted');
      }
      const live = await repository.livePricesFor(executor, offer.id);
      if (live.length >= maximumLivePricesPerOffer) return refused('conflict');
      const price = await repository.insertPrice(executor, {
        amountMinor: input.amountMinor,
        billingInterval: input.billingInterval,
        commercialMode: offer.commercialMode,
        currency: input.currency,
        effectiveFrom: now,
        now,
        offerId: offer.id,
      });
      // A live price in this currency already exists. Retiring it is an
      // explicit act, because replacing it silently would change what the next
      // person pays without anybody saying so.
      if (price === undefined) return refused('conflict');
      return {
        kind: 'ready',
        view: { offer, prices: [...live, price] },
      } as const;
    });
  }

  async retirePrice(input: {
    readonly creatorId: string;
    readonly offerId: string;
    readonly priceId: string;
  }): Promise<OfferOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const offer = await repository.findOwnOffer(executor, {
        creatorId: input.creatorId,
        offerId: input.offerId,
      });
      if (offer === undefined) return refused('not_eligible');
      const retired = await repository.retirePrice(executor, {
        now,
        offerId: offer.id,
        priceId: input.priceId,
      });
      if (retired === undefined) return refused('conflict');
      const prices = await repository.livePricesFor(executor, offer.id);
      return { kind: 'ready', view: { offer, prices } } as const;
    });
  }

  /**
   * Makes an offer purchasable, if every authority still agrees.
   *
   * The conjunction, re-read inside the transaction that performs the write:
   * approved commercial terms exist, the creator may operate, the resource is
   * owned and published, and the offer carries at least one live price whose
   * currency is still approved. A price approved yesterday in a currency
   * withdrawn today does not activate.
   */
  async activateOffer(input: {
    readonly creatorId: string;
    readonly expectedVersion: number;
    readonly offerId: string;
  }): Promise<OfferOutcome> {
    const { policy, repository, resources } = this.dependencies;
    if (!this.readiness().enabled) return refused('unavailable');
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const offer = await repository.findOwnOffer(executor, {
        creatorId: input.creatorId,
        offerId: input.offerId,
      });
      if (offer === undefined) return refused('not_eligible');
      if (offer.state !== 'draft' || offer.version !== input.expectedVersion) {
        return refused('conflict');
      }
      if (!policy.modes.includes(offer.commercialMode)) {
        return refused('price_not_permitted');
      }
      const eligible = await this.creatorMayOffer(executor, input.creatorId);
      if (!eligible) return refused('not_eligible');
      const resource = await resources.offerableResource({
        creatorId: input.creatorId,
        executor,
        resourceId: offer.resourceId,
        resourceType: offer.resourceType,
      });
      if (resource !== 'owned_published') return refused('not_eligible');
      const prices = await repository.livePricesFor(executor, offer.id);
      const sellable = prices.filter(
        (price) =>
          isCurrencyCode(price.currency) &&
          policy.boundsFor(price.currency) !== undefined,
      );
      if (sellable.length === 0) return refused('price_not_permitted');
      const activated = await repository.transitionOffer(executor, {
        activatedAt: now,
        expectedState: 'draft',
        expectedVersion: input.expectedVersion,
        now,
        offerId: offer.id,
        state: 'active',
      });
      if (activated === undefined) return refused('conflict');
      return { kind: 'ready', view: { offer: activated, prices } } as const;
    });
  }

  /**
   * Withdraws an offer and every live price on it.
   *
   * Nothing is deleted and no historical price changes. A purchase made against
   * a retired offer keeps pointing at the exact price row it was made under,
   * which is the whole reason a price is never edited.
   */
  async retireOffer(input: {
    readonly creatorId: string;
    readonly expectedVersion: number;
    readonly offerId: string;
  }): Promise<OfferOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    return repository.transaction(async (executor) => {
      const offer = await repository.findOwnOffer(executor, {
        creatorId: input.creatorId,
        offerId: input.offerId,
      });
      if (offer === undefined) return refused('not_eligible');
      if (
        offer.state === 'retired' ||
        offer.version !== input.expectedVersion
      ) {
        return refused('conflict');
      }
      const retired = await repository.transitionOffer(executor, {
        expectedState: offer.state,
        expectedVersion: input.expectedVersion,
        now,
        offerId: offer.id,
        retiredAt: now,
        state: 'retired',
      });
      if (retired === undefined) return refused('conflict');
      await repository.retireLivePrices(executor, { now, offerId: offer.id });
      return { kind: 'ready', view: { offer: retired, prices: [] } } as const;
    });
  }

  private async creatorMayOffer(
    executor: Executor,
    creatorId: string,
  ): Promise<boolean> {
    return this.dependencies.creators.mayOperate({ creatorId, executor });
  }
}
