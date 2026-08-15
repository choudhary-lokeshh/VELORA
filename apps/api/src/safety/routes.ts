import {
  blockListResponseSchema,
  blockRequestSchema,
  blockSchema,
  createReportRequestSchema,
  cursorSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
  reportListResponseSchema,
  reportSchema,
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
import type { ReportSourceSurface } from './policy.js';
import type { BlockView, ReportView, SafetyService } from './service.js';

export interface SafetyRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly safety: SafetyService;
}

/**
 * Consumer-facing safety routes.
 *
 * There is deliberately no moderation route here, and no admin route anywhere
 * in this application. The moderation seam is a service with no HTTP surface,
 * so there is no endpoint for a consumer credential to reach, mis-scope, or
 * escalate into. See `src/safety/moderation.ts`.
 */
export class SafetyRoutes {
  constructor(private readonly dependencies: SafetyRoutesDependencies) {}

  async createBlock(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(blockRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.safety.block(
      resolved.context.account,
      parsed.value.targetId,
    );
    if (outcome.kind === 'blocked') {
      return { body: blockSchema.parse(blockBody(outcome.view)), status: 200 };
    }
    // A target that does not exist and a target that may not be blocked answer
    // identically, so this endpoint cannot be used to test whether an account
    // is real.
    return outcome.kind === 'invalid_target'
      ? this.invalid(input)
      : routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
  }

  async removeBlock(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(blockRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.safety.removeBlock(
      resolved.context.account,
      parsed.value.targetId,
    );
    if (outcome.kind === 'removed') {
      // The withdrawn block as it was, rather than an invented shape. What is
      // returned is a record of what existed, not a claim that it still does.
      return { body: blockSchema.parse(blockBody(outcome.view)), status: 200 };
    }
    return outcome.kind === 'not_found'
      ? routeFailure(404, productErrorCodes.notFound, input.correlationId)
      : routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
  }

  async listBlocks(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const paging = paginationOf(input);
    if (paging === undefined) return this.invalid(input);

    const outcome = await this.dependencies.safety.listBlocks(
      resolved.context.account,
      paging,
    );
    if (outcome.kind !== 'page') return this.invalid(input);
    return {
      body: blockListResponseSchema.parse({
        blocks: outcome.blocks.map(blockBody),
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
      }),
      status: 200,
    };
  }

  async createReport(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(createReportRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    // The surface comes from the credential's audience, never from the body. A
    // client-declared surface would be a client-authoritative fact about
    // policy, and surface is the axis mature-content eligibility turns on.
    const sourceSurface = surfaceOf(resolved.context.auth.audience);
    if (sourceSurface === undefined) return this.invalid(input);

    const outcome = await this.dependencies.safety.report(
      resolved.context.account,
      { ...parsed.value, sourceSurface },
    );
    switch (outcome.kind) {
      case 'report': {
        return {
          body: reportSchema.parse(reportBody(outcome.view)),
          status: 200,
        };
      }
      case 'rate_limited': {
        return routeFailure(
          409,
          productErrorCodes.rateLimited,
          input.correlationId,
        );
      }
      case 'invalid_target': {
        return this.invalid(input);
      }
      default: {
        return routeFailure(
          409,
          productErrorCodes.accountNotEligible,
          input.correlationId,
        );
      }
    }
  }

  async listReports(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const paging = paginationOf(input);
    if (paging === undefined) return this.invalid(input);

    const outcome = await this.dependencies.safety.listReports(
      resolved.context.account,
      paging,
    );
    if (outcome.kind !== 'page') return this.invalid(input);
    return {
      body: reportListResponseSchema.parse({
        ...(outcome.nextCursor === undefined
          ? {}
          : { nextCursor: outcome.nextCursor }),
        reports: outcome.reports.map(reportBody),
      }),
      status: 200,
    };
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }

  private requireConsumer(input: RouteRequest): Promise<ConsumerRouteContext> {
    return requireConsumerAccount(this.dependencies.consumerContext, input);
  }
}

function paginationOf(
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
  if (cursor?.success === false || pageSize?.success === false)
    return undefined;
  return { cursor: cursor?.data, pageSize: pageSize?.data ?? defaultPageSize };
}

function blockBody(view: BlockView) {
  return {
    blockedId: view.blockedId,
    createdAt: view.createdAt.toISOString(),
  };
}

/**
 * A report as its own reporter sees it. There is no reporter field, no
 * narrative, and no internal state beyond the lifecycle position, because this
 * shape is the only one the API can produce for a report.
 */
function reportBody(view: ReportView) {
  return {
    createdAt: view.createdAt.toISOString(),
    id: view.id,
    reasonCode: view.reasonCode,
    state: view.state,
    targetType: view.targetType,
  };
}

/**
 * The reporting surface a credential speaks for.
 *
 * Platform Admin is deliberately absent: an operator does not file consumer
 * reports, and the consumer context refuses that audience before this is
 * reached anyway. Mapping it to anything would be a second, weaker opinion
 * about who may report.
 */
function surfaceOf(audience: string): ReportSourceSurface | undefined {
  switch (audience) {
    case 'consumer_web': {
      return 'consumer_web';
    }
    case 'consumer_mobile': {
      return 'consumer_mobile';
    }
    case 'creator_studio': {
      return 'creator_studio';
    }
    default: {
      return undefined;
    }
  }
}
