import {
  cancelSubscriptionRequestSchema,
  checkoutResponseSchema,
  consumerPaymentListResponseSchema,
  defaultPageSize,
  pageSizeSchema,
  consumerSubscriptionListResponseSchema,
  consumerSubscriptionResponseSchema,
  idempotencyHeader,
  idempotencyKeySchema,
  paymentIdSchema,
  productErrorCodes,
  startCheckoutRequestSchema,
} from '@velora/validation';

import {
  contractHeader,
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
} from '../users/context.js';
import type {
  CheckoutOutcome,
  CheckoutRefusal,
  CheckoutService,
} from './checkout-service.js';
import { decodeOfferCursor, encodeOfferCursor } from './cursor.js';
import type { OfferRepository, OfferRow } from './offer-repository.js';
import type { PaymentRow } from './payment-repository.js';
import { maximumPaymentPageSize } from './payment-policy.js';
import type { SubscriptionService } from './subscription-service.js';
import type {
  SubscriptionRepository,
  SubscriptionRow,
} from './subscription-repository.js';

/**
 * The consumer purchase surface.
 *
 * Consumer Web only. A Consumer Mobile bearer token is refused here even though
 * it is a perfectly valid consumer credential, because
 * `docs/surfaces/02-consumer-mobile.md` and the app-store rules behind it mean
 * a purchase initiated from a mobile app is a different commercial arrangement
 * with different obligations. Refusing at the API rather than only omitting the
 * screen is what makes that a boundary rather than a convention.
 *
 * Nothing a client sends decides money. The request names an offer and a
 * currency; the amount comes from the price row, the acting consumer comes from
 * the session, and no field in any schema here could carry a card number
 * because none exists.
 */

function paymentBody(payment: PaymentRow, offer?: OfferRow) {
  return {
    amount: {
      amountMinor: payment.amountMinor.toString(),
      currency: payment.currency,
    },
    createdAt: payment.createdAt.toISOString(),
    ...(payment.failureReason === null
      ? {}
      : { failureReason: payment.failureReason }),
    id: payment.id,
    offerId: payment.offerId,
    ...(offer === undefined
      ? {}
      : { resource: { id: offer.resourceId, type: offer.resourceType } }),
    state: payment.state,
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export interface CheckoutRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly offers: OfferRepository;
  readonly service: CheckoutService;
  readonly subscriptionService: SubscriptionService;
  readonly subscriptions: SubscriptionRepository;
}

/**
 * A subscription as the person holding it may see it.
 *
 * The resource travels as an opaque identifier and its type, which is exactly
 * what BILLING stores. What that identifier names, what it is called, and what
 * is inside it belong to the domain that owns it; a surface that wants a club's
 * name asks PRIVATE CLUBS for it under the same identifier.
 *
 * An offer that cannot be read leaves the projection out rather than guessing:
 * a subscription whose offer has been deleted is a state this platform has no
 * story for, and inventing a resource for it would be inventing what somebody
 * bought.
 */
function subscriptionBody(
  row: SubscriptionRow,
  context: {
    readonly interval: 'month' | 'year' | undefined;
    readonly offer: OfferRow | undefined;
  },
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
    ...(context.interval === undefined ? {} : { interval: context.interval }),
    offerId: row.offerId,
    ...(context.offer === undefined
      ? {}
      : {
          resource: {
            id: context.offer.resourceId,
            type: context.offer.resourceType,
          },
        }),
    state: row.state,
  };
}

export class CheckoutRoutes {
  constructor(private readonly dependencies: CheckoutRoutesDependencies) {}

  async startCheckout(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    if (resolved.context.auth.audience !== 'consumer_web') {
      return routeFailure(
        403,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }
    const parsed = parseRouteBody(startCheckoutRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);
    // A client key is required rather than optional. Without one a double-click
    // is two purchases, and the server has nothing to recognise the second by.
    const key = idempotencyKeySchema.safeParse(
      contractHeader(input.request, idempotencyHeader) ?? '',
    );
    if (!key.success) return this.invalid(input);

    const outcome = await this.dependencies.service.start({
      consumerId: resolved.context.userId,
      correlationId: input.correlationId,
      currency: parsed.value.currency,
      idempotencyKey: key.data,
      ...(parsed.value.interval === undefined
        ? {}
        : { interval: parsed.value.interval }),
      offerId: parsed.value.offerId,
    });
    return this.answer(input, outcome);
  }

  /**
   * The state of one of the caller's own payments.
   *
   * This is what a return URL reads. It is an ordinary authorized read of
   * server truth, and it is deliberately the only thing a browser coming back
   * from a provider can cause: there is no transition on this path, so a
   * consumer who types the success URL by hand learns exactly what the platform
   * already believed.
   */
  async readCheckout(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const raw = new URL(input.request.url).searchParams.get('paymentId');
    const paymentId = paymentIdSchema.safeParse(raw);
    if (!paymentId.success) return this.invalid(input);
    const payment = await this.dependencies.service.read({
      consumerId: resolved.context.userId,
      paymentId: paymentId.data,
    });
    if (payment === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: checkoutResponseSchema.parse({ payment: paymentBody(payment) }),
      status: 200,
    };
  }

  /**
   * The caller's own subscriptions.
   *
   * Read from BILLING's record of the commercial relationship, not from any
   * entitlement. What somebody may read is PRIVATE CLUBS' answer, taken on
   * every protected read; this says only what they are paying for.
   */
  async listSubscriptions(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const rows = await this.dependencies.subscriptions.listOwnSubscriptions(
      this.dependencies.subscriptions.transactionless,
      { consumerId: resolved.context.userId, limit: maximumPaymentPageSize },
    );
    const projected = await this.project(rows);
    return {
      body: consumerSubscriptionListResponseSchema.parse({
        subscriptions: projected,
      }),
      status: 200,
    };
  }

  /**
   * Everything this person has been charged, or nearly charged.
   *
   * A record of attempts rather than a set of receipts. Every state appears,
   * including the ones that failed and the one that means Velora does not know
   * yet — somebody whose payment is unresolved is owed that fact rather than an
   * absence.
   */
  async listPayments(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const query = new URL(input.request.url).searchParams;
    const rawPageSize = query.get('pageSize');
    const pageSize =
      rawPageSize === null
        ? defaultPageSize
        : pageSizeSchema.safeParse(rawPageSize).data;
    if (pageSize === undefined) return this.invalid(input);
    const cursor = query.get('cursor');
    const { offers, service } = this.dependencies;
    const rows = await service.listOwnPayments({
      after: cursor === null ? undefined : decodeOfferCursor(cursor),
      consumerId: resolved.context.userId,
      limit: pageSize + 1,
    });
    const page = rows.slice(0, pageSize);
    const offerRows = await offers.findOffersForPurchase(
      offers.transactionless,
      [...new Set(page.map((row) => row.offerId))],
    );
    const byOffer = new Map(offerRows.map((offer) => [offer.id, offer]));
    const last = page.at(-1);
    return {
      body: consumerPaymentListResponseSchema.parse({
        ...(rows.length > pageSize && last !== undefined
          ? {
              nextCursor: encodeOfferCursor({
                id: last.id,
                moment: last.createdAt,
              }),
            }
          : {}),
        payments: page.map((row) => paymentBody(row, byOffer.get(row.offerId))),
      }),
      status: 200,
    };
  }

  /**
   * The holder stops a subscription renewing.
   *
   * Open to every consumer surface, deliberately, and not restricted the way
   * starting a purchase is. Beginning one from a mobile application is a
   * different commercial arrangement with different obligations; stopping one
   * is not a commercial arrangement at all. Making a subscription harder to
   * leave than to enter is the pattern consumer-protection law exists to
   * prevent, and a surface that showed somebody their own subscription while
   * refusing to end it would be exactly that.
   */
  async cancelSubscription(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(cancelSubscriptionRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.subscriptionService.cancel({
      consumerId: resolved.context.userId,
      subscriptionId: parsed.value.subscriptionId,
    });
    if (outcome.kind === 'refused') {
      return outcome.reason === 'not_found'
        ? routeFailure(404, productErrorCodes.notFound, input.correlationId)
        : routeFailure(
            409,
            productErrorCodes.actionNotPermitted,
            input.correlationId,
          );
    }
    const projected = await this.project([outcome.subscription]);
    return {
      body: consumerSubscriptionResponseSchema.parse({
        subscription: projected[0],
      }),
      status: 200,
    };
  }

  /**
   * Offers and price cadences for a page of subscriptions, in two statements.
   *
   * Batched rather than read per row, because a person with a handful of
   * memberships should not cost a query each to describe.
   */
  private async project(rows: readonly SubscriptionRow[]) {
    if (rows.length === 0) return [];
    const { offers } = this.dependencies;
    const offerIds = [...new Set(rows.map((row) => row.offerId))];
    const [offerRows, priceRows] = await Promise.all([
      offers.findOffersForPurchase(offers.transactionless, offerIds),
      offers.pricesForOffers(offers.transactionless, offerIds),
    ]);
    const byOffer = new Map(offerRows.map((offer) => [offer.id, offer]));
    const byPrice = new Map(priceRows.map((price) => [price.id, price]));
    return rows.map((row) =>
      subscriptionBody(row, {
        interval: byPrice.get(row.priceId)?.billingInterval ?? undefined,
        offer: byOffer.get(row.offerId),
      }),
    );
  }

  private answer(input: RouteRequest, outcome: CheckoutOutcome): RouteResult {
    if (outcome.kind === 'started') {
      return {
        body: checkoutResponseSchema.parse({
          payment: paymentBody(outcome.payment),
          ...(outcome.redirectUrl === undefined
            ? {}
            : { redirectUrl: outcome.redirectUrl }),
        }),
        status: 201,
      };
    }
    return this.refusal(input, outcome.reason);
  }

  private refusal(input: RouteRequest, reason: CheckoutRefusal): RouteResult {
    if (reason === 'unavailable' || reason === 'provider_unavailable') {
      // The environment cannot take money. Two internal reasons, one answer:
      // a consumer has no use for the difference between "no approved terms"
      // and "no approved provider", and neither is their doing.
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (reason === 'conflict') {
      return routeFailure(
        409,
        productErrorCodes.idempotencyMismatch,
        input.correlationId,
      );
    }
    return routeFailure(
      403,
      reason === 'surface_not_permitted'
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
