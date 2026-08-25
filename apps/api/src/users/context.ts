import {
  authErrorCodes,
  productErrorCodes,
  type AuthAudience,
} from '@velora/validation';

import type { CallerResolver } from '../auth/caller.js';
import type { AuthContext } from '../auth/context.js';
import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { UserAccountRow } from './repository.js';
import type { UsersService } from './service.js';

/**
 * Audiences that carry consumer product authority.
 *
 * Creator Studio and Platform Admin are excluded by construction, not by
 * convention: `AGENTS.md` forbids consumer functionality leaking into those
 * surfaces, and a privileged session must never become a consumer actor by
 * calling a consumer endpoint.
 */
export const consumerAudiences = [
  'consumer_web',
  'consumer_mobile',
] as const satisfies readonly AuthAudience[];

/**
 * The server's own view of the acting consumer. Every field is derived from
 * stored state: the AUTH context comes from the presented credential, and the
 * consumer account is looked up by that credential's account identifier. No
 * part of a request body or query string contributes to it, which is what makes
 * it usable as an authorization input.
 */
export interface ConsumerContext {
  readonly account: UserAccountRow;
  readonly auth: AuthContext;
  /** Convenience alias for the consumer account identifier. */
  readonly userId: string;
}

export type ConsumerResolution =
  | { readonly kind: 'resolved'; readonly context: ConsumerContext }
  | {
      readonly kind: 'authenticated-without-account';
      readonly auth: AuthContext;
    }
  | { readonly kind: 'denied'; readonly result: RouteResult };

/**
 * The same resolution for a route that serves callers who are not acting as a
 * consumer at all.
 *
 * Two outcomes are added rather than folded into `denied`, because a consumer
 * product route and a route open to everybody owe them different answers: the
 * first refuses both, the second serves both with whatever an absent consumer
 * identity entitles them to, which is usually only genuinely public material.
 */
export type OptionalConsumerResolution =
  | ConsumerResolution
  /** No credential was presented at all. */
  | { readonly kind: 'anonymous' }
  /** A valid session that is not a consumer one, so it acts as no consumer. */
  | { readonly kind: 'other-audience'; readonly auth: AuthContext };

/**
 * Resolves the acting consumer for a product request, or the exact refusal.
 *
 * The order matters. Transport credential first, then audience, then the
 * consumer account: an unauthenticated caller must never learn whether an
 * account exists, and a Platform Admin session must be refused before any
 * consumer lookup happens on its behalf.
 */
export class ConsumerContextResolver {
  constructor(
    private readonly dependencies: {
      readonly caller: CallerResolver;
      readonly users: UsersService;
    },
  ) {}

  async resolve(
    request: Request,
    correlationId: string,
  ): Promise<ConsumerResolution> {
    const resolution = await this.resolveOptional(request, correlationId);
    switch (resolution.kind) {
      case 'anonymous': {
        return {
          kind: 'denied',
          result: routeFailure(401, authErrorCodes.required, correlationId),
        };
      }
      case 'other-audience': {
        return {
          kind: 'denied',
          result: routeFailure(
            403,
            productErrorCodes.consumerSurfaceRequired,
            correlationId,
          ),
        };
      }
      default: {
        return resolution;
      }
    }
  }

  /**
   * The same resolution, for a route that legitimately serves a caller with no
   * credential at all.
   *
   * Only the genuinely credential-free case becomes `anonymous`, and a valid
   * session belonging to another surface becomes `other-audience` rather than
   * acquiring consumer authority. A rejected origin, a failed CSRF echo, and a
   * cookie that is no longer usable stay refusals: each of those is a browser
   * doing something wrong, and quietly downgrading it to "no session" would
   * answer a misconfigured or hostile request as though it had been made
   * correctly, and would leave a stale cookie in place instead of clearing it.
   */
  async resolveOptional(
    request: Request,
    correlationId: string,
  ): Promise<OptionalConsumerResolution> {
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
        return { kind: 'anonymous' };
      }
      default: {
        break;
      }
    }

    const auth = caller.context;
    if (!(consumerAudiences as readonly string[]).includes(auth.audience)) {
      return { auth, kind: 'other-audience' };
    }

    const account = await this.dependencies.users.findAccount(auth.accountId);
    if (account === undefined) {
      return { auth, kind: 'authenticated-without-account' };
    }
    return {
      context: { account, auth, userId: account.id },
      kind: 'resolved',
    };
  }
}

/** Either the acting consumer, or the exact refusal a handler should return. */
export type ConsumerRouteContext =
  { readonly context: ConsumerContext } | { readonly failure: RouteResult };

/**
 * The precondition every consumer product handler shares: a resolved caller
 * that already has a consumer account.
 *
 * A caller without one receives the same answer as a caller addressing a route
 * that does not exist, so probing a product endpoint reveals nothing.
 */
export async function requireConsumerAccount(
  resolver: ConsumerContextResolver,
  input: RouteRequest,
): Promise<ConsumerRouteContext> {
  const resolution = await resolver.resolve(input.request, input.correlationId);
  if (resolution.kind === 'denied') return { failure: resolution.result };
  if (resolution.kind === 'authenticated-without-account') {
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
