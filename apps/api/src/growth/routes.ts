import {
  invitationOpeningRequestSchema,
  invitationOpeningResponseSchema,
  inviteLinkResponseSchema,
  liveWindowListResponseSchema,
  maximumLiveWindows,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  requireConsumerAccount,
  type ConsumerContextResolver,
  type ConsumerRouteContext,
} from '../users/context.js';
import type { GrowthLiveWindowView, GrowthService } from './service.js';

export interface GrowthRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly growth: GrowthService;
}

/**
 * The acquisition surface: two routes behind a session, two in front of one.
 *
 * The two public ones are public because they have to be. An invitation is
 * opened by somebody who does not have an account yet — that is the entire
 * point of an invitation — and a scheduled window is read by a page a search
 * engine and a stranger both fetch. Neither discloses anything: the opening
 * answers a boolean, and the window list is what the platform is publishing to
 * everybody anyway.
 *
 * There is deliberately no route that reads somebody else's invitation, no
 * route that lists who used yours, and no route that reports a count of them. A
 * person who could see who joined through their link would be handed a small
 * social graph they were never given, and every reward scheme that has ever
 * been attached to one of those numbers ended with people buying accounts.
 */
export class GrowthRoutes {
  constructor(private readonly dependencies: GrowthRoutesDependencies) {}

  /** The caller's own link, without minting one. */
  async getInvite(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const invite = await this.dependencies.growth.inviteFor(
      resolved.context.userId,
    );
    return {
      body: inviteLinkResponseSchema.parse(
        invite === undefined
          ? {}
          : {
              invite: {
                code: invite.code,
                createdAt: invite.createdAt.toISOString(),
              },
            },
      ),
      status: 200,
    };
  }

  /** The caller's link, minting one the first time and only the first time. */
  async createInvite(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const invite = await this.dependencies.growth.createInvite(
      resolved.context.userId,
    );
    return {
      body: inviteLinkResponseSchema.parse({
        invite: {
          code: invite.code,
          createdAt: invite.createdAt.toISOString(),
        },
      }),
      status: 200,
    };
  }

  /**
   * Records an invitation opening and says whether the code is usable.
   *
   * No session, and no session is consulted even when one is present: the
   * answer is identical for everybody, and reading a cookie here would attach
   * an identity to a request that has no use for one.
   */
  async recordOpening(input: RouteRequest): Promise<RouteResult> {
    const parsed = parseRouteBody(invitationOpeningRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    const outcome = await this.dependencies.growth.recordOpening({
      code: parsed.value.code,
      openingKey: parsed.value.openingKey,
    });
    return {
      body: invitationOpeningResponseSchema.parse({ usable: outcome.usable }),
      status: 200,
    };
  }

  /** Every window worth announcing, earliest first. Public, and the same for all. */
  async listWindows(): Promise<RouteResult> {
    const windows =
      await this.dependencies.growth.publishableWindows(maximumLiveWindows);
    return { body: windowListBody(windows), status: 200 };
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }
}

/**
 * A window as everybody sees it.
 *
 * Two instants in UTC, a name, an address, and where it is relative to now.
 * There is no attendee count and no capacity in the shape this parses against,
 * so one cannot be added by a handler that decided it would be nice to have.
 */
export function windowListBody(
  windows: readonly GrowthLiveWindowView[],
): ReturnType<typeof liveWindowListResponseSchema.parse> {
  return liveWindowListResponseSchema.parse({
    windows: windows.map((window) => ({
      endsAt: window.endsAt.toISOString(),
      slug: window.slug,
      startsAt: window.startsAt.toISOString(),
      state: window.state,
      title: window.title,
    })),
  });
}
