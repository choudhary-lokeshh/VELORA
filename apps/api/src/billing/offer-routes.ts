import {
  commercialOfferLifecycleRequestSchema,
  commercialOfferListResponseSchema,
  commercialOfferResponseSchema,
  createCommercialOfferRequestSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
  publishCommercialPriceRequestSchema,
  retireCommercialPriceRequestSchema,
} from '@velora/validation';

import {
  requireCreator,
  type CreatorContextResolver,
} from '../creators/context.js';
import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { PriceRow } from './offer-repository.js';
import type {
  MonetisationReadiness,
  OfferOutcome,
  OfferRefusal,
  OfferService,
  OfferView,
} from './offer-service.js';

/**
 * Creator Studio's commercial surface.
 *
 * Creator Studio only. A consumer or Platform Admin credential is refused
 * before any lookup happens on the caller's behalf, and the acting creator
 * comes from the session rather than from anything in the request — there is no
 * field in any schema here that names a creator.
 *
 * A refusal because the platform has approved no commercial terms answers `503`
 * with `DEPENDENCY_UNAVAILABLE`, not a client error. It is a truthful statement
 * about the environment, and it is what lets the Studio say "monetisation is
 * not enabled" instead of showing a form that cannot succeed.
 */

function priceBody(price: PriceRow) {
  return {
    amount: {
      amountMinor: price.amountMinor.toString(),
      currency: price.currency,
    },
    createdAt: price.createdAt.toISOString(),
    effectiveFrom: price.effectiveFrom.toISOString(),
    id: price.id,
    ...(price.billingInterval === null
      ? {}
      : { interval: price.billingInterval }),
    ...(price.retiredAt === null
      ? {}
      : { retiredAt: price.retiredAt.toISOString() }),
    state: price.state,
  };
}

function offerBody(view: OfferView) {
  const { offer } = view;
  return {
    ...(offer.activatedAt === null
      ? {}
      : { activatedAt: offer.activatedAt.toISOString() }),
    createdAt: offer.createdAt.toISOString(),
    id: offer.id,
    mode: offer.commercialMode,
    prices: view.prices.map(priceBody),
    resourceId: offer.resourceId,
    resourceType: offer.resourceType,
    ...(offer.retiredAt === null
      ? {}
      : { retiredAt: offer.retiredAt.toISOString() }),
    state: offer.state,
    updatedAt: offer.updatedAt.toISOString(),
    version: offer.version,
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

function readPageSize(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get('pageSize');
  if (raw === null) return defaultPageSize;
  const parsed = pageSizeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export interface OfferRoutesDependencies {
  readonly creatorContext: CreatorContextResolver;
  readonly service: OfferService;
}

export class OfferRoutes {
  constructor(private readonly dependencies: OfferRoutesDependencies) {}

  async listOffers(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const pageSize = readPageSize(input.request);
    if (pageSize === undefined) return this.invalid(input);
    const page = await this.dependencies.service.listOwn({
      creatorId: resolved.context.creatorId,
      cursor:
        new URL(input.request.url).searchParams.get('cursor') ?? undefined,
      pageSize,
    });
    return {
      body: commercialOfferListResponseSchema.parse({
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
        offers: page.rows.map(offerBody),
        readiness: readinessBody(page.readiness),
      }),
      status: 200,
    };
  }

  async createOffer(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      createCommercialOfferRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);
    const outcome = await this.dependencies.service.createOffer({
      commercialMode: parsed.value.mode,
      creatorId: resolved.context.creatorId,
      resourceId: parsed.value.resourceId,
      resourceType: parsed.value.resourceType,
    });
    return this.answer(input, outcome, 201);
  }

  async publishPrice(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      publishCommercialPriceRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);
    const outcome = await this.dependencies.service.publishPrice({
      // The contract carries minor units as a canonical decimal string, so this
      // is the one place the wire form becomes an integer, and it never passes
      // through a JavaScript number on the way.
      amountMinor: BigInt(parsed.value.amountMinor),
      billingInterval: parsed.value.interval,
      creatorId: resolved.context.creatorId,
      currency: parsed.value.currency,
      offerId: parsed.value.offerId,
    });
    return this.answer(input, outcome, 201);
  }

  async retirePrice(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      retireCommercialPriceRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);
    const outcome = await this.dependencies.service.retirePrice({
      creatorId: resolved.context.creatorId,
      offerId: parsed.value.offerId,
      priceId: parsed.value.priceId,
    });
    return this.answer(input, outcome, 200);
  }

  async setOfferLifecycle(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      commercialOfferLifecycleRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);
    const request = {
      creatorId: resolved.context.creatorId,
      expectedVersion: parsed.value.version,
      offerId: parsed.value.offerId,
    };
    const outcome =
      parsed.value.state === 'active'
        ? await this.dependencies.service.activateOffer(request)
        : await this.dependencies.service.retireOffer(request);
    return this.answer(input, outcome, 200);
  }

  private answer(
    input: RouteRequest,
    outcome: OfferOutcome,
    success: number,
  ): RouteResult {
    if (outcome.kind === 'ready') {
      return {
        body: commercialOfferResponseSchema.parse({
          offer: offerBody(outcome.view),
        }),
        status: success,
      };
    }
    return this.refusal(input, outcome.reason);
  }

  private refusal(input: RouteRequest, reason: OfferRefusal): RouteResult {
    if (reason === 'unavailable') {
      // Shares its status with the capacity refusal and is told apart by its
      // code, never by its status. This one carries no `Retry-After`: there is
      // nothing to come back to until somebody approves commercial terms.
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (reason === 'conflict') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    // A creator who may not operate, a resource that is absent or not theirs or
    // not published, and an amount outside approved terms answer alike. Telling
    // them apart would let one creator probe another's catalog by identifier.
    return routeFailure(
      403,
      reason === 'price_not_permitted'
        ? productErrorCodes.actionNotPermitted
        : productErrorCodes.accountNotEligible,
      input.correlationId,
    );
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
