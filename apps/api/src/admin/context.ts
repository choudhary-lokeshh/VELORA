import { authErrorCodes, productErrorCodes } from '@velora/validation';

import type { CallerResolver } from '../auth/caller.js';
import type { AuthContext } from '../auth/context.js';
import {
  AuthorizationError,
  requireAudience,
  requireFreshAssurance,
} from '../auth/context.js';
import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';

/**
 * The acting operator, or the exact refusal.
 *
 * Two independent conditions, checked in order and never collapsed. The
 * audience must be Platform Admin — a consumer session and a Creator Studio
 * session are refused before any lookup happens on their behalf, because
 * `AGENTS.md` forbids Admin capability reaching either surface and route
 * visibility is not permission. And the assurance must be phishing-resistant
 * and recent, which ADR-0017 requires for privileged access.
 *
 * The second condition is what makes these routes unreachable in a deployed
 * environment today: no phishing-resistant verifier is approved, so no session
 * can hold that assurance, and every operation here fails closed rather than
 * degrading to something weaker.
 */
export interface AdminContext {
  readonly auth: AuthContext;
  /** Opaque reference recorded on the audit trail. Never an operator's name. */
  readonly actorReference: string;
}

export type AdminRouteContext =
  { readonly context: AdminContext } | { readonly failure: RouteResult };

export class AdminContextResolver {
  constructor(
    private readonly dependencies: {
      readonly caller: CallerResolver;
      readonly now: () => Date;
    },
  ) {}

  async resolve(input: RouteRequest): Promise<AdminRouteContext> {
    const caller = await this.dependencies.caller.resolve(input.request);
    switch (caller.kind) {
      case 'csrf-rejected':
      case 'origin-rejected': {
        return {
          failure: routeFailure(403, caller.code, input.correlationId),
        };
      }
      case 'stale-cookie': {
        return {
          failure: routeFailure(
            401,
            authErrorCodes.required,
            input.correlationId,
            caller.cookies,
          ),
        };
      }
      case 'anonymous': {
        return {
          failure: routeFailure(
            401,
            authErrorCodes.required,
            input.correlationId,
          ),
        };
      }
      default: {
        break;
      }
    }

    try {
      const context = requireAudience(caller.context, ['platform_admin']);
      // Freshness, not merely strength. ADR-0017 fixes the maximum age a
      // privileged assurance may have, and it is read from AUTH's policy rather
      // than restated here.
      requireFreshAssurance(
        context,
        'phishing_resistant',
        this.dependencies.now(),
      );
      return {
        context: {
          // The session, not the person. An audit needs to identify the actor
          // deterministically; it does not need their name, and storing one
          // would put operator identity in a table every operation writes.
          actorReference: `session:${context.sessionId ?? context.accountId}`,
          auth: context,
        },
      };
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      // One code for a wrong audience and for insufficient or stale assurance.
      // Which condition failed is not a caller's business: an operator knows
      // whether they are an operator, and anybody else learns nothing.
      return {
        failure: routeFailure(
          403,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        ),
      };
    }
  }
}
