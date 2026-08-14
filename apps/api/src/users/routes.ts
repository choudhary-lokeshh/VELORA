import {
  adultDeclarationRequestSchema,
  consumerAccountResponseSchema,
  createConsumerAccountRequestSchema,
  onboardingStateResponseSchema,
  policyAcknowledgementRequestSchema,
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
  type ConsumerContext,
  type ConsumerContextResolver,
  type ConsumerRouteContext,
} from './context.js';
import type { ConsumerEligibility, OnboardingService } from './onboarding.js';
import type { UserAccountRow } from './repository.js';
import type { UsersService } from './service.js';

export interface UsersRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly onboarding: OnboardingService;
  readonly service: UsersService;
}

/**
 * The public view of a consumer account. It is the owner's own account, so the
 * coarse status reason is included; nothing here is ever rendered for a peer.
 */
export function consumerAccountBody(
  account: UserAccountRow,
): ReturnType<typeof consumerAccountResponseSchema.parse> {
  return consumerAccountResponseSchema.parse({
    createdAt: account.createdAt.toISOString(),
    id: account.id,
    ...(account.locale === null ? {} : { locale: account.locale }),
    ...(account.region === null ? {} : { region: account.region }),
    status: account.status,
    ...(account.statusReason === null
      ? {}
      : { statusReason: account.statusReason }),
  });
}

/**
 * USERS HTTP handlers.
 *
 * Neither handler reads an account identifier from the request. The acting
 * account is always the one the presented credential resolves to, so there is
 * no identifier a caller could substitute.
 */
export class UsersRoutes {
  constructor(private readonly dependencies: UsersRoutesDependencies) {}

  async createAccount(input: RouteRequest): Promise<RouteResult> {
    const resolution = await this.dependencies.consumerContext.resolve(
      input.request,
      input.correlationId,
    );
    if (resolution.kind === 'denied') return resolution.result;

    const parsed = parseRouteBody(
      createConsumerAccountRequestSchema,
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
    const outcome = await this.dependencies.service.provisionAccount({
      authAccountId,
      locale: parsed.value.locale,
    });
    return {
      body: consumerAccountBody(outcome.account),
      status: outcome.created ? 201 : 200,
    };
  }

  async getAccount(input: RouteRequest): Promise<RouteResult> {
    const resolution = await this.dependencies.consumerContext.resolve(
      input.request,
      input.correlationId,
    );
    if (resolution.kind === 'denied') return resolution.result;
    if (resolution.kind === 'authenticated-without-account') {
      // Indistinguishable from an unknown route by design, so probing this
      // endpoint tells a caller nothing it did not already know about itself.
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: consumerAccountBody(resolution.context.account),
      status: 200,
    };
  }

  async getOnboarding(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const eligibility = await this.dependencies.onboarding.evaluate(
      resolved.context.account,
    );
    return {
      body: onboardingBody(resolved.context.account, eligibility),
      status: 200,
    };
  }

  async declareAdult(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(adultDeclarationRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.onboarding.declareAdult({
      account: resolved.context.account,
      declaresAdult: parsed.value.declaresAdult,
      region: parsed.value.region,
    });
    if (outcome.kind !== 'advanced') {
      // A refusal is recorded, not hidden; the caller is told it may not
      // continue without learning any policy internals.
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return this.onboardingResult(resolved.context, outcome.eligibility);
  }

  async acknowledgePolicies(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      policyAcknowledgementRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.onboarding.acknowledgePolicies({
      account: resolved.context.account,
      audience:
        resolved.context.auth.audience === 'consumer_mobile'
          ? 'consumer_mobile'
          : 'consumer_web',
      documents: parsed.value.acknowledgements,
    });
    if (outcome.kind !== 'advanced') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return this.onboardingResult(resolved.context, outcome.eligibility);
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }

  /** Re-reads the account so the response carries the post-transition state. */
  private async onboardingResult(
    context: ConsumerContext,
    eligibility: ConsumerEligibility,
  ): Promise<RouteResult> {
    const account =
      (await this.dependencies.service.findAccountById(context.userId)) ??
      context.account;
    return { body: onboardingBody(account, eligibility), status: 200 };
  }
}

function onboardingBody(
  account: UserAccountRow,
  eligibility: ConsumerEligibility,
): ReturnType<typeof onboardingStateResponseSchema.parse> {
  return onboardingStateResponseSchema.parse({
    account: consumerAccountBody(account),
    adultAssurance: eligibility.adultAssurance,
    adultAssuranceRefused: eligibility.adultAssuranceRefused,
    outstandingPolicies: eligibility.outstandingPolicies.map((document) => ({
      key: document.key,
      version: document.version,
    })),
    outstandingProfile: [...eligibility.outstandingProfile],
    step: eligibility.step,
  });
}
