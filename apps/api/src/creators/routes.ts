import {
  createCreatorAccountRequestSchema,
  creatorAccountResponseSchema,
  creatorOnboardingStateResponseSchema,
  creatorPolicyAcknowledgementRequestSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import { requireCreator, type CreatorContextResolver } from './context.js';
import type { CreatorAccountRow } from './repository.js';
import type { CreatorAdmission, CreatorsService } from './service.js';

/**
 * The public view of a creator capability.
 *
 * It is the owner's own capability, so the coarse status reason is included;
 * nothing here is ever rendered for a visitor. It carries no AUTH account
 * identifier, no consumer user identifier, and no verification, moderation, or
 * enforcement detail — a Studio client has no use for any of those and a leak
 * of the first two would join identities across domain boundaries.
 */
export function creatorAccountBody(
  account: CreatorAccountRow,
): ReturnType<typeof creatorAccountResponseSchema.parse> {
  return creatorAccountResponseSchema.parse({
    ...(account.activatedAt === null
      ? {}
      : { activatedAt: account.activatedAt.toISOString() }),
    createdAt: account.createdAt.toISOString(),
    id: account.id,
    status: account.status,
    ...(account.statusReason === null
      ? {}
      : { statusReason: account.statusReason }),
  });
}

function creatorOnboardingBody(
  account: CreatorAccountRow,
  admission: CreatorAdmission,
): ReturnType<typeof creatorOnboardingStateResponseSchema.parse> {
  return creatorOnboardingStateResponseSchema.parse({
    account: creatorAccountBody(account),
    ...(admission.adultGate.satisfied
      ? {}
      : { adultGateReason: admission.adultGate.reason }),
    adultGateSatisfied: admission.adultGate.satisfied,
    outstandingPolicies: admission.outstandingPolicies.map((document) => ({
      key: document.key,
      version: document.version,
    })),
    step: admission.step,
  });
}

export interface CreatorRoutesDependencies {
  readonly creatorContext: CreatorContextResolver;
  readonly service: CreatorsService;
}

/**
 * CREATORS HTTP handlers.
 *
 * No handler reads a creator identifier from the request. The acting capability
 * is always the one the presented credential resolves to, so there is no
 * identifier a caller could substitute and no cross-creator access to prevent
 * at this layer — it is impossible to express.
 */
export class CreatorRoutes {
  constructor(private readonly dependencies: CreatorRoutesDependencies) {}

  async createAccount(input: RouteRequest): Promise<RouteResult> {
    const resolution = await this.dependencies.creatorContext.resolve(
      input.request,
      input.correlationId,
    );
    if (resolution.kind === 'denied') return resolution.result;

    const parsed = parseRouteBody(
      createCreatorAccountRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const authAccountId =
      resolution.kind === 'resolved'
        ? resolution.context.auth.accountId
        : resolution.auth.accountId;
    const outcome =
      await this.dependencies.service.provisionCapability(authAccountId);
    if (outcome.kind === 'not_eligible') {
      // One code for every unmet gate. Which condition failed is the caller's
      // own business, and they read it from the onboarding state once a
      // capability exists; a refusal that named the condition would let the
      // same answer be probed from a route that needs no capability at all.
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return {
      body: creatorAccountBody(outcome.account),
      status: outcome.created ? 201 : 200,
    };
  }

  async getAccount(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    return { body: creatorAccountBody(resolved.context.account), status: 200 };
  }

  async getOnboarding(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    // Reconciled rather than merely evaluated, so a capability whose evidence
    // changed since its last write reports — and is — the state that evidence
    // now supports.
    const state = await this.dependencies.service.reconcileActivation(
      resolved.context.account,
    );
    return {
      body: creatorOnboardingBody(state.account, state.admission),
      status: 200,
    };
  }

  async acknowledgePolicies(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;

    const parsed = parseRouteBody(
      creatorPolicyAcknowledgementRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.service.acknowledgePolicies({
      account: resolved.context.account,
      documents: parsed.value.acknowledgements,
    });
    if (outcome.kind !== 'advanced') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return {
      body: creatorOnboardingBody(
        outcome.state.account,
        outcome.state.admission,
      ),
      status: 200,
    };
  }
}
