import {
  aiRunCancellationRequestSchema,
  aiRunCancellationResponseSchema,
  aiSuggestionRequestSchema,
  authErrorCodes,
  productErrorCodes,
} from '@velora/validation';

import type { CallerResolver } from '../auth/caller.js';
import {
  AuthorizationError,
  requireFreshAssurance,
  type AuthContext,
} from '../auth/context.js';
import type { CreatorsService } from '../creators/service.js';
import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { UsersService } from '../users/service.js';
import { AiGatewayError, type AiGateway } from './gateway.js';
import { AiInputRejectedError } from './privacy.js';
import { aiAudienceAllowed } from './policy.js';

export class AiRoutes {
  constructor(
    private readonly dependencies: {
      readonly caller: CallerResolver;
      readonly creators: CreatorsService;
      readonly gateway: AiGateway;
      readonly now: () => Date;
      readonly users: UsersService;
    },
  ) {}

  async suggest(input: RouteRequest): Promise<RouteResult> {
    const authenticated = await this.authenticate(input);
    if ('failure' in authenticated) return authenticated.failure;
    const parsed = parseRouteBody(aiSuggestionRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    const auth = authenticated.context;
    if (!aiAudienceAllowed(parsed.value.capability, auth.audience)) {
      return routeFailure(
        403,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }
    const ownerFailure = await this.requireSurfaceOwner(
      auth,
      parsed.value.capability,
    );
    if (ownerFailure !== undefined) return ownerFailure(input.correlationId);

    try {
      return {
        body: await this.dependencies.gateway.suggest({
          actorId: auth.accountId,
          audience: auth.audience,
          correlationId: input.correlationId,
          request: parsed.value,
        }),
        status: 200,
      };
    } catch (error) {
      if (error instanceof AiInputRejectedError) {
        return routeFailure(
          422,
          productErrorCodes.validationFailed,
          input.correlationId,
        );
      }
      if (!(error instanceof AiGatewayError)) throw error;
      if (error.kind === 'rate_limited') {
        return routeFailure(
          429,
          productErrorCodes.rateLimited,
          input.correlationId,
        );
      }
      if (
        error.kind === 'kill_switch' ||
        error.kind === 'capability_disabled'
      ) {
        return routeFailure(
          403,
          productErrorCodes.actionNotPermitted,
          input.correlationId,
        );
      }
      if (error.kind === 'cancelled' || error.kind === 'run_conflict') {
        return routeFailure(
          409,
          productErrorCodes.conflict,
          input.correlationId,
        );
      }
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
  }

  async cancel(input: RouteRequest): Promise<RouteResult> {
    const authenticated = await this.authenticate(input);
    if ('failure' in authenticated) return authenticated.failure;
    const parsed = parseRouteBody(aiRunCancellationRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    return {
      body: aiRunCancellationResponseSchema.parse({
        cancelled: await this.dependencies.gateway.cancel({
          actorId: authenticated.context.accountId,
          audience: authenticated.context.audience,
          runId: parsed.value.runId,
        }),
        runId: parsed.value.runId,
      }),
      status: 200,
    };
  }

  private async authenticate(
    input: RouteRequest,
  ): Promise<
    { readonly context: AuthContext } | { readonly failure: RouteResult }
  > {
    const caller = await this.dependencies.caller.resolve(input.request);
    switch (caller.kind) {
      case 'authenticated':
        return { context: caller.context };
      case 'csrf-rejected':
      case 'origin-rejected':
        return { failure: routeFailure(403, caller.code, input.correlationId) };
      case 'stale-cookie':
        return {
          failure: routeFailure(
            401,
            authErrorCodes.required,
            input.correlationId,
            caller.cookies,
          ),
        };
      case 'anonymous':
        return {
          failure: routeFailure(
            401,
            authErrorCodes.required,
            input.correlationId,
          ),
        };
    }
  }

  private async requireSurfaceOwner(
    auth: AuthContext,
    capability: string,
  ): Promise<((correlationId: string) => RouteResult) | undefined> {
    if (capability.startsWith('consumer_')) {
      return (await this.dependencies.users.findAccount(auth.accountId)) ===
        undefined
        ? (correlationId) =>
            routeFailure(404, productErrorCodes.notFound, correlationId)
        : undefined;
    }
    if (capability.startsWith('creator_')) {
      const creator = await this.dependencies.creators.findByAuthAccountId(
        auth.accountId,
      );
      return creator?.status === 'active'
        ? undefined
        : (correlationId) =>
            routeFailure(
              403,
              productErrorCodes.accountNotEligible,
              correlationId,
            );
    }
    try {
      requireFreshAssurance(
        auth,
        'phishing_resistant',
        this.dependencies.now(),
      );
      return undefined;
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      return (correlationId) =>
        routeFailure(403, productErrorCodes.actionNotPermitted, correlationId);
    }
  }
}
