import {
  apiErrorCodes,
  productErrorCodes,
  providerEventAcknowledgementSchema,
} from '@velora/validation';

import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { NotificationProviderEventService } from './provider-events.js';

/**
 * Where a delivery provider tells this platform what happened to a notice.
 *
 * Public only in transport terms: the raw-body signature is the credential,
 * and there is no session, no audience, and no CSRF token because the caller is
 * a machine holding a shared secret rather than a person holding a cookie.
 *
 * It answers `202` rather than `200`, deliberately. The platform has recorded
 * the event, not acted on it — applying happens on a worker against a lease, so
 * a provider's retry budget is never spent waiting for work chosen to be done
 * later.
 */
export class NotificationProviderEventRoutes {
  constructor(private readonly service: NotificationProviderEventService) {}

  async receive(input: RouteRequest): Promise<RouteResult> {
    const outcome = await this.service.receive({
      correlationId: input.correlationId,
      headers: input.request.headers,
      rawBody: input.rawBody,
    });
    if (outcome.kind === 'accepted') {
      return {
        body: providerEventAcknowledgementSchema.parse({ received: true }),
        status: 202,
      };
    }
    if (outcome.kind === 'unavailable') {
      // No approved provider, so nothing is entitled to be calling this.
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (outcome.reason === 'oversized') {
      return routeFailure(
        413,
        apiErrorCodes.payloadTooLarge,
        input.correlationId,
      );
    }
    // One answer for a bad signature, a mutated body, an unknown event type,
    // and an unparseable payload: telling them apart would tell a forger which
    // part to fix next.
    return routeFailure(
      401,
      'NOTIFICATION_PROVIDER_EVENT_REJECTED',
      input.correlationId,
    );
  }
}
