import {
  creatorHandleSchema,
  productErrorCodes,
  publicMembershipOfferListResponseSchema,
} from '@velora/validation';

import type { RouteRequest, RouteResult } from '../http/route-kit.js';
import { routeFailure } from '../http/route-kit.js';
import type { ConsumerContextResolver } from '../users/context.js';
import type { OfferRow, PriceRow } from './offer-repository.js';
import type { MonetisationReadiness } from './offer-service.js';
import type { MembershipService } from './membership-service.js';
import type { SubscriptionRow } from './subscription-repository.js';

/**
 * What a creator sells, on the page a visitor is standing on.
 *
 * Open to a caller with no credential at all, because a public creator page is
 * public and a price is not a secret. A session, when there is one, adds two
 * things and nothing else: the viewer's own subscriptions, and which
 * eligibility gates are shut for them. Neither is derivable from anything a
 * client sends — the acting consumer comes from the session, and a request that
 * named one would be a request to read somebody else's purchases.
 *
 * A session belonging to another surface acts as no consumer here rather than
 * being refused. A creator looking at their own public page is a visitor to it.
 */

function priceBody(price: PriceRow) {
  return {
    amount: {
      amountMinor: price.amountMinor.toString(),
      currency: price.currency,
    },
    id: price.id,
    ...(price.billingInterval === null
      ? {}
      : { interval: price.billingInterval }),
  };
}

function offerBody(view: {
  readonly offer: OfferRow;
  readonly prices: readonly PriceRow[];
}) {
  return {
    id: view.offer.id,
    mode: view.offer.commercialMode,
    prices: view.prices.map(priceBody),
    resource: {
      id: view.offer.resourceId,
      type: view.offer.resourceType,
    },
  };
}

function subscriptionBody(
  row: SubscriptionRow,
  interval: 'month' | 'year' | undefined,
  offer: OfferRow | undefined,
) {
  return {
    amount: { amountMinor: row.amountMinor.toString(), currency: row.currency },
    ...(row.cancelledAt === null
      ? {}
      : { cancelledAt: row.cancelledAt.toISOString() }),
    createdAt: row.createdAt.toISOString(),
    ...(row.currentPeriodEnd === null
      ? {}
      : { currentPeriodEnd: row.currentPeriodEnd.toISOString() }),
    ...(row.currentPeriodStart === null
      ? {}
      : { currentPeriodStart: row.currentPeriodStart.toISOString() }),
    id: row.id,
    ...(interval === undefined ? {} : { interval }),
    offerId: row.offerId,
    ...(offer === undefined
      ? {}
      : { resource: { id: offer.resourceId, type: offer.resourceType } }),
    state: row.state,
  };
}

function readinessBody(readiness: MonetisationReadiness) {
  return {
    currencies: [...readiness.currencies],
    enabled: readiness.enabled,
    intervals: [...readiness.intervals],
    modes: [...readiness.modes],
    source: readiness.source,
  };
}

export interface MembershipRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly service: MembershipService;
}

export class MembershipRoutes {
  constructor(private readonly dependencies: MembershipRoutesDependencies) {}

  async listPublicMemberships(input: RouteRequest): Promise<RouteResult> {
    const handle = creatorHandleSchema.safeParse(
      new URL(input.request.url).searchParams.get('handle'),
    );
    if (!handle.success) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    const viewer = await this.dependencies.consumerContext.resolveOptional(
      input.request,
      input.correlationId,
    );
    if (viewer.kind === 'denied') return viewer.result;
    const consumerId =
      viewer.kind === 'resolved' ? viewer.context.userId : undefined;

    const listing = await this.dependencies.service.listFor({
      consumerId,
      handle: handle.data,
    });
    if (listing === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    const offers = new Map(
      listing.offers.map((view) => [view.offer.id, view.offer]),
    );
    return {
      body: publicMembershipOfferListResponseSchema.parse({
        ...(listing.gates === undefined ? {} : { gates: [...listing.gates] }),
        handle: listing.handle,
        offers: listing.offers.map(offerBody),
        readiness: readinessBody(listing.readiness),
        subscriptions: listing.subscriptions.map((row) =>
          subscriptionBody(
            row,
            listing.intervalsByPrice.get(row.priceId),
            offers.get(row.offerId),
          ),
        ),
      }),
      status: 200,
    };
  }
}
