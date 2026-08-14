import { authErrorCodes, productErrorCodes } from '@velora/validation';

import type { CallerResolver } from '../auth/caller.js';
import type { AuthContext } from '../auth/context.js';
import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import { creatorAudience } from './policy.js';
import type { CreatorAccountRow } from './repository.js';
import type { CreatorsService } from './service.js';

/**
 * The server's own view of the acting creator.
 *
 * Every field is derived from stored state: the AUTH context comes from the
 * presented credential, and the creator capability is looked up by that
 * credential's account identifier. No part of a request body or query string
 * contributes to it, which is what makes it usable as an authorization input —
 * and what makes "creator status is not trusted from client input" a property
 * of the type rather than a rule somebody has to remember.
 */
export interface CreatorContext {
  readonly account: CreatorAccountRow;
  readonly auth: AuthContext;
  /** Convenience alias for the creator capability identifier. */
  readonly creatorId: string;
}

export type CreatorResolution =
  | { readonly kind: 'resolved'; readonly context: CreatorContext }
  | {
      readonly kind: 'authenticated-without-capability';
      readonly auth: AuthContext;
    }
  | { readonly kind: 'denied'; readonly result: RouteResult };

/**
 * Resolves the acting creator for a Studio request, or the exact refusal.
 *
 * The order matters. Transport credential first, then audience, then the
 * creator capability: an unauthenticated caller must never learn whether a
 * capability exists, and a Consumer or Platform Admin session must be refused
 * before any creator lookup happens on its behalf.
 *
 * Only `creator_studio` carries creator authority. That is enforced here rather
 * than per route, because a route that forgot the check would be a consumer
 * session acting as a creator — precisely the audience confusion `AGENTS.md`
 * and `docs/surfaces/03-creator-studio.md` both forbid.
 */
export class CreatorContextResolver {
  constructor(
    private readonly dependencies: {
      readonly caller: CallerResolver;
      readonly creators: CreatorsService;
    },
  ) {}

  async resolve(
    request: Request,
    correlationId: string,
  ): Promise<CreatorResolution> {
    const caller = await this.dependencies.caller.resolve(request);
    switch (caller.kind) {
      case 'csrf-rejected':
      case 'origin-rejected': {
        return {
          kind: 'denied',
          result: routeFailure(403, caller.code, correlationId),
        };
      }
      case 'stale-cookie': {
        return {
          kind: 'denied',
          result: routeFailure(
            401,
            authErrorCodes.required,
            correlationId,
            caller.cookies,
          ),
        };
      }
      case 'anonymous': {
        return {
          kind: 'denied',
          result: routeFailure(401, authErrorCodes.required, correlationId),
        };
      }
      default: {
        break;
      }
    }

    const auth = caller.context;
    if (auth.audience !== creatorAudience) {
      return {
        kind: 'denied',
        result: routeFailure(
          403,
          productErrorCodes.creatorSurfaceRequired,
          correlationId,
        ),
      };
    }

    const account = await this.dependencies.creators.findByAuthAccountId(
      auth.accountId,
    );
    if (account === undefined) {
      return { auth, kind: 'authenticated-without-capability' };
    }
    return {
      context: { account, auth, creatorId: account.id },
      kind: 'resolved',
    };
  }
}

/** Either the acting creator, or the exact refusal a handler should return. */
export type CreatorRouteContext =
  { readonly context: CreatorContext } | { readonly failure: RouteResult };

/**
 * The precondition every creator handler shares: a resolved caller that already
 * holds creator capability.
 *
 * A caller without one receives the same answer as a caller addressing a route
 * that does not exist, so probing a creator endpoint reveals nothing about
 * whether anybody is a creator.
 */
export async function requireCreator(
  resolver: CreatorContextResolver,
  input: RouteRequest,
): Promise<CreatorRouteContext> {
  const resolution = await resolver.resolve(input.request, input.correlationId);
  if (resolution.kind === 'denied') return { failure: resolution.result };
  if (resolution.kind === 'authenticated-without-capability') {
    return {
      failure: routeFailure(
        404,
        productErrorCodes.notFound,
        input.correlationId,
      ),
    };
  }
  return { context: resolution.context };
}
