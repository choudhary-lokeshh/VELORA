import {
  accountClosureResponseSchema,
  closeAccountRequestSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { AccountClosureService, AccountClosureView } from './closure.js';
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
  type ConsumerRouteContext,
} from './context.js';

export interface AccountClosureRoutesDependencies {
  readonly closure: AccountClosureService;
  readonly consumerContext: ConsumerContextResolver;
}

/**
 * Leaving, from inside the product.
 *
 * Two routes and no third: ask to close, and read what happened. There is
 * deliberately no route that reverses one — a window in which a closure could
 * be undone is a retention and consent decision nobody has taken, and offering
 * one would mean holding an account open for a period this code invented.
 *
 * The read is served to a closed account as well as an open one, and that is
 * the point of having it. Somebody who signs in again after closing should land
 * on an account that says what happened to it rather than on a product that
 * refuses everything without explaining why.
 */
export class AccountClosureRoutes {
  constructor(
    private readonly dependencies: AccountClosureRoutesDependencies,
  ) {}

  async closeAccount(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(closeAccountRequestSchema, input.body);
    // The acknowledgement is checked here rather than treated as decoration.
    // This is the one consumer action with no way back, and a request an empty
    // body could make is a request a mistyped script can make.
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.closure.close({
      account: resolved.context.account,
      correlationId: input.correlationId,
    });
    return outcome.kind === 'closed'
      ? { body: closureBody(outcome.view), status: 200 }
      : routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
  }

  async getClosure(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const outcome = this.dependencies.closure.status(resolved.context.account);
    // An account nobody has asked to close has no closure to report, and that
    // is an absence rather than an error.
    return outcome.kind === 'closing'
      ? { body: closureBody(outcome.view), status: 200 }
      : routeFailure(404, productErrorCodes.notFound, input.correlationId);
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }
}

/**
 * The closure on the wire.
 *
 * `erasureScheduled` is published as false rather than omitted. A surface has
 * to be able to say what is actually true — the account is closed and what
 * remains follows a retention schedule that is not yet published — and a field
 * that was simply absent would leave every client to guess, which is how "your
 * data has been deleted" gets written on a screen by somebody who assumed.
 */
function closureBody(
  view: AccountClosureView,
): ReturnType<typeof accountClosureResponseSchema.parse> {
  return accountClosureResponseSchema.parse({
    erasureScheduled: false,
    requestedAt: view.requestedAt.toISOString(),
    status: view.status,
  });
}
