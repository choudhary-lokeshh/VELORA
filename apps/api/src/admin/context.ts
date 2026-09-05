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
import type { OperatorCapability, OperatorRole } from '../operations/policy.js';
import type { OperatorStanding } from '../operations/service.js';

/**
 * The acting operator, or the exact refusal.
 *
 * Three independent conditions, checked in order and never collapsed.
 *
 * The audience must be Platform Admin — a consumer session and a Creator Studio
 * session are refused before any lookup happens on their behalf, because
 * `AGENTS.md` forbids Admin capability reaching either surface and route
 * visibility is not permission.
 *
 * The assurance must be phishing-resistant and recent, which ADR-0017 requires
 * for privileged access. This is what makes these routes unreachable in a
 * deployed environment today: no phishing-resistant verifier is approved, so no
 * session can hold that assurance.
 *
 * And the operator must hold the capability the route needs. Being an operator
 * is not a capability; holding one is. `docs/decisions/ADR-0048-…` states the
 * rule this makes concrete — every route names the capability it requires, the
 * server checks it before doing anything, and hiding a button in the console
 * has never been and can never become the thing that stops a request.
 *
 * All three refuse with the same status and the same code. Which condition
 * failed is not a caller's business: an operator knows whether they are an
 * operator, the console asks what it may do through its own route, and anybody
 * else learns nothing at all — including whether the capability they guessed at
 * exists.
 */
export interface AdminContext {
  readonly auth: AuthContext;
  /** Opaque reference recorded on the audit trail. Never an operator's name. */
  readonly actorReference: string;
  /** Everything this operator may do, resolved once per request. */
  readonly capabilities: readonly OperatorCapability[];
  readonly role: OperatorRole | undefined;
  /** Where the capabilities came from. `bootstrap` exists only in local/test. */
  readonly standingSource: OperatorStanding['source'];
  /** The operator's AUTH account, which is what a grant is written against. */
  readonly subjectReference: string;
}

export type AdminRouteContext =
  { readonly context: AdminContext } | { readonly failure: RouteResult };

/**
 * Where an operator's capabilities come from.
 *
 * A port rather than the OPERATIONS service itself, so ADMIN depends on one
 * question instead of on a domain — and so a composition with no control plane
 * still assembles, answering that nobody may do anything, which is the correct
 * fail-closed reading of "there is no grant store".
 */
export interface OperatorStandingPort {
  standingOf(subjectReference: string): Promise<OperatorStanding>;
}

/** The standing of an operator on a platform with no grant store at all. */
export class UngrantedOperatorStanding implements OperatorStandingPort {
  standingOf(): Promise<OperatorStanding> {
    return Promise.resolve({
      capabilities: [],
      role: undefined,
      source: 'none',
    });
  }
}

export class AdminContextResolver {
  constructor(
    private readonly dependencies: {
      readonly caller: CallerResolver;
      readonly now: () => Date;
      readonly standing: OperatorStandingPort;
    },
  ) {}

  /**
   * @param capability The one thing this route needs. Required at every call
   * site, so a new operator route cannot be written without deciding what
   * authorises it — the mistake this parameter exists to make impossible.
   */
  async resolve(
    input: RouteRequest,
    capability: OperatorCapability,
  ): Promise<AdminRouteContext> {
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

    let context: AuthContext;
    try {
      context = requireAudience(caller.context, ['platform_admin']);
      // Freshness, not merely strength. ADR-0017 fixes the maximum age a
      // privileged assurance may have, and it is read from AUTH's policy rather
      // than restated here.
      requireFreshAssurance(
        context,
        'phishing_resistant',
        this.dependencies.now(),
      );
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      return this.refused(input);
    }

    // The grant is looked up only after the audience and the assurance passed,
    // so a consumer session never causes a read on an operator's behalf and
    // never learns from timing that a grant store is consulted at all.
    const subjectReference = context.accountId;
    const standing =
      await this.dependencies.standing.standingOf(subjectReference);
    if (!standing.capabilities.includes(capability)) return this.refused(input);

    return {
      context: {
        // The session, not the person. An audit needs to identify the actor
        // deterministically; it does not need their name, and storing one
        // would put operator identity in a table every operation writes.
        actorReference: `session:${context.sessionId ?? context.accountId}`,
        auth: context,
        capabilities: standing.capabilities,
        role: standing.role,
        standingSource: standing.source,
        subjectReference,
      },
    };
  }

  /**
   * The operator's own standing, with no capability required.
   *
   * The one operator route that asks for nothing, because it is how the console
   * learns what to render. Answering it to any authenticated operator discloses
   * nothing they could not discover by pressing every button: what *they* may
   * do. It never reports anybody else's.
   */
  async resolveStanding(input: RouteRequest): Promise<AdminRouteContext> {
    const caller = await this.dependencies.caller.resolve(input.request);
    if (caller.kind === 'csrf-rejected' || caller.kind === 'origin-rejected') {
      return { failure: routeFailure(403, caller.code, input.correlationId) };
    }
    if (caller.kind === 'stale-cookie') {
      return {
        failure: routeFailure(
          401,
          authErrorCodes.required,
          input.correlationId,
          caller.cookies,
        ),
      };
    }
    if (caller.kind === 'anonymous') {
      return {
        failure: routeFailure(
          401,
          authErrorCodes.required,
          input.correlationId,
        ),
      };
    }
    try {
      const context = requireAudience(caller.context, ['platform_admin']);
      requireFreshAssurance(
        context,
        'phishing_resistant',
        this.dependencies.now(),
      );
      const subjectReference = context.accountId;
      const standing =
        await this.dependencies.standing.standingOf(subjectReference);
      return {
        context: {
          actorReference: `session:${context.sessionId ?? context.accountId}`,
          auth: context,
          capabilities: standing.capabilities,
          role: standing.role,
          standingSource: standing.source,
          subjectReference,
        },
      };
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      return this.refused(input);
    }
  }

  private refused(input: RouteRequest): AdminRouteContext {
    return {
      failure: routeFailure(
        403,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      ),
    };
  }
}
