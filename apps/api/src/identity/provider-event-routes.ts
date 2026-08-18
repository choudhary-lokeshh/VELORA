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
import type { IdentityProviderEventService } from './provider-events.js';

/** Public only in transport terms: the raw-body signature is the credential. */
export class IdentityProviderEventRoutes {
  constructor(private readonly service: IdentityProviderEventService) {}

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
    return routeFailure(
      401,
      'IDENTITY_PROVIDER_EVENT_REJECTED',
      input.correlationId,
    );
  }
}
