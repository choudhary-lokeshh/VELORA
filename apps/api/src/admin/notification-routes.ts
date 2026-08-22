import {
  adminNotificationDeliverySchema,
  adminNotificationStateResponseSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { NotificationOperations } from '../notifications/operations.js';
import type { AdminContextResolver } from './context.js';

/**
 * The operator notification surface.
 *
 * Two routes, both reads, and what is missing from them is most of the design.
 *
 * There is **no list of notices and no search**. An operator able to page
 * through notifications has a browsing surface over who is told about whom,
 * which is not an operations tool however it is labelled. The state screen
 * carries no identifier of any kind for the same reason.
 *
 * There is **no action** at all: no retrying a notice, no suppressing a
 * destination, no clearing a dead letter. Every one of those is a decision with
 * consequences for a person — a retry sends somebody a message, a suppression
 * stops one arriving — and none of them has an approved authority, an audit
 * record, or a reason vocabulary yet. An operator button here would be that
 * power with none of those, which is exactly the unaudited action this design
 * refuses. What will not deliver is reconciliation's problem and is surfaced as
 * a number to be alerted on, not as a button to be pressed. Adding one is a
 * decision recorded in `docs/decisions/DECISIONS_REQUIRED.md`, not an
 * implementation detail.
 *
 * Like every other Admin route, these are reachable by nobody today.
 * `AdminContextResolver` requires the Platform Admin audience and a fresh
 * phishing-resistant assurance, no approved verifier can produce one, and the
 * routes therefore fail closed rather than degrading to something weaker.
 */
export interface AdminNotificationRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly operations: NotificationOperations;
}

export class AdminNotificationRoutes {
  constructor(
    private readonly dependencies: AdminNotificationRoutesDependencies,
  ) {}

  /**
   * Delivery in operational terms.
   *
   * Counts, ages, and the adapter name. An operator needs to know how much is
   * owed, how long it has been owed, whether failures are this platform's fault
   * or a destination's, and whether this environment can send at all.
   */
  async getNotificationState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;

    const state = await this.dependencies.operations.operationalState();
    return {
      body: adminNotificationStateResponseSchema.parse(state),
      status: 200,
    };
  }

  /** One delivery, for an operator who already has its identifier. */
  async getNotificationDelivery(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;

    const deliveryId = new URL(input.request.url).searchParams.get(
      'deliveryId',
    );
    if (deliveryId === null || deliveryId.length === 0) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const detail =
      await this.dependencies.operations.deliveryDetail(deliveryId);
    if (detail === undefined) {
      // The same answer one that never existed gets. An operations tool is
      // still a place where guessing identifiers must not be productive.
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return { body: adminNotificationDeliverySchema.parse(detail), status: 200 };
  }
}
