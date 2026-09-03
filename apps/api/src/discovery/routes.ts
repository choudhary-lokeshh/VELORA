import {
  apiQueryParameters,
  createIntroductionRequestSchema,
  cursorSchema,
  defaultPageSize,
  discoveryFeedResponseSchema,
  discoveryCandidateSchema,
  discoveryPassRequestSchema,
  discoveryPassResponseSchema,
  introductionListResponseSchema,
  introductionReferenceRequestSchema,
  introductionSchema,
  pageSizeSchema,
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
import { rankingVersion } from './policy.js';
import type {
  DiscoveryCandidate,
  DiscoveryService,
  IntroductionOutcome,
  IntroductionView,
} from './service.js';

export interface DiscoveryRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly discovery: DiscoveryService;
}

export class DiscoveryRoutes {
  constructor(private readonly dependencies: DiscoveryRoutesDependencies) {}

  async getCandidates(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;

    // Query input is validated against the published schemas before it reaches
    // the domain, so an out-of-range page size is a contract failure rather
    // than a query with surprising bounds.
    const paging = this.paging(input);
    if (paging === undefined) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.discovery.feed(
      resolved.context.account,
      paging,
    );
    if (outcome.kind === 'invalid_cursor') {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    if (outcome.kind === 'not_eligible') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return {
      body: discoveryFeedResponseSchema.parse({
        candidates: outcome.candidates.map(candidateBody),
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
        rankingVersion,
      }),
      status: 200,
    };
  }

  /**
   * One person, for a caller who holds a reason to look at them.
   *
   * A malformed identifier is answered as not-found rather than as invalid
   * input, because the two are the same fact to somebody standing here: this
   * endpoint is reached by following a link, and telling a caller their
   * identifier was well-formed but nobody's would say more than the answer
   * itself.
   */
  async getPerson(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;

    // Validated against the published parameter before it reaches the domain.
    // Anything else is not an identifier this platform ever issued, and handing
    // one to a query would turn a mistyped address into a server error.
    const raw = new URL(input.request.url).searchParams.get('personId');
    const personId =
      raw === null ? undefined : apiQueryParameters.personId.safeParse(raw);
    const outcome =
      personId?.success !== true
        ? ({ kind: 'not_found' } as const)
        : await this.dependencies.discovery.person(
            resolved.context.account,
            personId.data,
          );
    if (outcome.kind === 'not_eligible') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    if (outcome.kind !== 'person') {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: discoveryCandidateSchema.parse(candidateBody(outcome.person)),
      status: 200,
    };
  }

  async passCandidate(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(discoveryPassRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.discovery.pass(
      resolved.context.account,
      parsed.value.candidateId,
    );
    if (outcome.kind === 'invalid_target') {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    if (outcome.kind !== 'recorded') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return {
      body: discoveryPassResponseSchema.parse({
        suppressedUntil: outcome.suppressedUntil.toISOString(),
      }),
      status: 200,
    };
  }

  async listIntroductions(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const paging = this.paging(input);
    if (paging === undefined) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.discovery.listIntroductions(
      resolved.context.account,
      paging,
    );
    if (outcome.kind === 'invalid_cursor') {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    if (outcome.kind === 'not_eligible') {
      return routeFailure(
        409,
        productErrorCodes.accountNotEligible,
        input.correlationId,
      );
    }
    return {
      body: introductionListResponseSchema.parse({
        introductions: outcome.introductions.map(introductionBody),
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
      }),
      status: 200,
    };
  }

  async createIntroduction(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(createIntroductionRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    return this.renderIntroduction(
      await this.dependencies.discovery.signalIntroduction(
        resolved.context.account,
        parsed.value.candidateId,
      ),
      input.correlationId,
    );
  }

  async declineIntroduction(input: RouteRequest): Promise<RouteResult> {
    return this.closeIntroduction(input, 'decline');
  }

  async withdrawIntroduction(input: RouteRequest): Promise<RouteResult> {
    return this.closeIntroduction(input, 'withdraw');
  }

  private async closeIntroduction(
    input: RouteRequest,
    action: 'decline' | 'withdraw',
  ): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      introductionReferenceRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    const outcome =
      action === 'decline'
        ? await this.dependencies.discovery.declineIntroduction(
            resolved.context.account,
            parsed.value.introductionId,
          )
        : await this.dependencies.discovery.withdrawIntroduction(
            resolved.context.account,
            parsed.value.introductionId,
          );
    return this.renderIntroduction(outcome, input.correlationId);
  }

  private renderIntroduction(
    outcome: IntroductionOutcome,
    correlationId: string,
  ): RouteResult {
    switch (outcome.kind) {
      case 'introduction': {
        return {
          body: introductionSchema.parse(introductionBody(outcome.view)),
          status: 200,
        };
      }
      case 'not_found': {
        return routeFailure(404, productErrorCodes.notFound, correlationId);
      }
      case 'conflict': {
        return routeFailure(409, productErrorCodes.conflict, correlationId);
      }
      case 'rate_limited': {
        // The product convention for a bound reached. It says only that, never
        // which bound or how much remains, and nothing already open is closed.
        return routeFailure(409, productErrorCodes.rateLimited, correlationId);
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          correlationId,
        );
      }
    }
  }

  /** Shared query validation for the two paged reads. */
  private paging(
    input: RouteRequest,
  ):
    | { readonly cursor: string | undefined; readonly pageSize: number }
    | undefined {
    const parameters = new URL(input.request.url).searchParams;
    const rawCursor = parameters.get('cursor');
    const rawPageSize = parameters.get('pageSize');
    const cursor =
      rawCursor === null ? undefined : cursorSchema.safeParse(rawCursor);
    const pageSize =
      rawPageSize === null ? undefined : pageSizeSchema.safeParse(rawPageSize);
    if (cursor?.success === false || pageSize?.success === false) {
      return undefined;
    }
    return {
      cursor: cursor?.data,
      pageSize: pageSize?.data ?? defaultPageSize,
    };
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }
}

/**
 * A candidate as a peer may see it.
 *
 * Only the fields the approved policy allows. There is no availability window,
 * because publishing when somebody stops being available is presence; no
 * account status, because why a person is or is not visible is nobody else's
 * business; and no ranking inputs, because exposing what moved somebody up a
 * list is exactly how a list gets gamed.
 */
function candidateBody(candidate: DiscoveryCandidate) {
  return {
    ...(candidate.bio === undefined ? {} : { bio: candidate.bio }),
    displayName: candidate.displayName,
    id: candidate.id,
    media: candidate.media.map((item) => ({
      id: item.id,
      position: item.position,
    })),
    ...(candidate.region === undefined ? {} : { region: candidate.region }),
    sharedLanguages: [...candidate.sharedLanguages],
  };
}

/**
 * An introduction as one of its two people sees it.
 *
 * The counterpart is the same minimized shape discovery uses. The other
 * person's role, their reasons, and anything about their state beyond the pair
 * itself are absent.
 */
function introductionBody(view: IntroductionView) {
  return {
    counterpart: candidateBody(view.counterpart),
    createdAt: view.createdAt.toISOString(),
    id: view.id,
    ...(view.mutualAt === undefined
      ? {}
      : { mutualAt: view.mutualAt.toISOString() }),
    role: view.role,
    state: view.state,
  };
}
