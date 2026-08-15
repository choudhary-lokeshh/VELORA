import {
  checkoutResponseSchema,
  consumerSubscriptionListResponseSchema,
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
import type { PaymentRow } from './payment-repository.js';
import { maximumPaymentPageSize } from './payment-policy.js';
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

function paymentBody(payment: PaymentRow) {
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
    state: payment.state,
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export interface CheckoutRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly service: CheckoutService;
  readonly subscriptions: SubscriptionRepository;
}

/** A subscription as the person holding it may see it. */
function subscriptionBody(row: SubscriptionRow) {
  return {
    amount: { amountMinor: row.amountMinor.toString(), currency: row.currency },
    createdAt: row.createdAt.toISOString(),
    ...(row.currentPeriodEnd === null
      ? {}
      : { currentPeriodEnd: row.currentPeriodEnd.toISOString() }),
    id: row.id,
    offerId: row.offerId,
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
    return {
      body: consumerSubscriptionListResponseSchema.parse({
        subscriptions: rows.map(subscriptionBody),
      }),
      status: 200,
    };
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
