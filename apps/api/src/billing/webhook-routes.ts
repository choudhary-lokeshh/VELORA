import {
  apiErrorCodes,
  providerEventAcknowledgementSchema,
} from '@velora/validation';

import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { WebhookService } from './webhook-service.js';

/**
 * The provider webhook endpoint.
 *
 * Deliberately unlike every other route in the application. There is no
 * session, no audience, no CSRF token, and no consumer to resolve: the
 * provider's signature over the raw body is the entire credential, and
 * `docs/security/05-payments-webhooks.md` requires it to be checked before the
 * payload is trusted as anything at all.
 *
 * The handler decides nothing about money. It verifies, records a receipt, and
 * acknowledges; a worker drains the receipts afterwards. That separation is
 * what keeps a slow business transition from making a provider retry, and a
 * provider retry is how one event becomes five.
 *
 * Every answer is deliberately uninformative. A verification failure and an
 * event for an unknown object look the same from outside, because a webhook
 * endpoint that reported which one applied would tell an attacker whether a
 * forged signature was close and whether a guessed reference exists.
 */

export interface WebhookRoutesDependencies {
  readonly service: WebhookService;
}

export class WebhookRoutes {
  constructor(private readonly dependencies: WebhookRoutesDependencies) {}

  async receiveProviderEvent(input: RouteRequest): Promise<RouteResult> {
    const outcome = await this.dependencies.service.receive({
      correlationId: input.correlationId,
      headers: input.request.headers,
      rawBody: input.body,
    });
    switch (outcome.kind) {
      case 'accepted': {
        // A duplicate is acknowledged exactly like a first delivery. A provider
        // that got a different answer for a redelivery would learn which of its
        // events Velora had already seen, and would have no use for it anyway.
        return {
          body: providerEventAcknowledgementSchema.parse({ received: true }),
          status: 202,
        };
      }
      case 'rejected': {
        if (outcome.reason === 'oversized') {
          return routeFailure(
            413,
            apiErrorCodes.payloadTooLarge,
            input.correlationId,
          );
        }
        return routeFailure(
          401,
          'PROVIDER_EVENT_REJECTED',
          input.correlationId,
        );
      }
      default: {
        return routeFailure(
          503,
          apiErrorCodes.serviceUnavailable,
          input.correlationId,
        );
      }
    }
  }
}
