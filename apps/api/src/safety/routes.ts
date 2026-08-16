import {
  appealListResponseSchema,
  appealSchema,
  blockListResponseSchema,
  blockRequestSchema,
  blockSchema,
  createAppealRequestSchema,
  createReportRequestSchema,
  cursorSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
  reportListResponseSchema,
  reportSchema,
  safetyStandingResponseSchema,
  withdrawAppealRequestSchema,
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
import type {
  AppealService,
  AppealView,
  StatementOfReasons,
} from './appeals.js';
import type { ReportSourceSurface } from './policy.js';
import type { BlockView, ReportView, SafetyService } from './service.js';

export interface SafetyRoutesDependencies {
  readonly appeals: AppealService;
  readonly consumerContext: ConsumerContextResolver;
  readonly safety: SafetyService;
}

/**
 * Consumer-facing safety routes.
 *
 * There is deliberately no moderation route here. The operator surface lives
 * under `/v1/admin/safety/` behind the Platform Admin audience and a fresh
 * phishing-resistant assurance, so there is no endpoint on this surface for a
 * consumer credential to reach, mis-scope, or escalate into.
 *
 * What a consumer *can* reach is what was done to them and how to contest it.
 * That answer carries the category and the scope and nothing else: the review's
 * finding, the evidence, the reviewer, and anything that could identify a
 * reporter have no field in any shape this file produces.
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

  /**
   * What is currently in force against the caller, and why.
   *
   * Only decisions that imposed something and that nothing has replaced. A
   * restriction that was lifted is not something somebody is under, and telling
   * them otherwise would be worse than telling them nothing.
   */
  async getStanding(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;

    const statements = await this.dependencies.appeals.statementsFor(
      resolved.context.account.id,
    );
    return {
      body: safetyStandingResponseSchema.parse({
        statements: statements.map(statementBody),
      }),
      status: 200,
    };
  }

  async createAppeal(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(createAppealRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.appeals.submitForAccount({
      accountId: resolved.context.account.id,
      decisionId: parsed.value.decisionId,
      ...(parsed.value.statement === undefined
        ? {}
        : { statement: parsed.value.statement }),
    });
    switch (outcome.kind) {
      case 'received': {
        return {
          body: appealSchema.parse(appealBody(outcome.appeal)),
          status: 200,
        };
      }
      case 'already_appealed':
      case 'out_of_time': {
        return routeFailure(
          409,
          productErrorCodes.conflict,
          input.correlationId,
        );
      }
      default: {
        // A decision that does not exist, one about somebody else, a dismissal
        // of somebody else's report, and a kind nobody may contest answer
        // identically, so probing this path enumerates nothing.
        return this.invalid(input);
      }
    }
  }

  async listAppeals(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;

    const appeals = await this.dependencies.appeals.appealsFor(
      resolved.context.account.id,
    );
    return {
      body: appealListResponseSchema.parse({
        appeals: appeals.map(appealBody),
      }),
      status: 200,
    };
  }

  async withdrawAppeal(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.requireConsumer(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(withdrawAppealRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const found = await this.dependencies.appeals.appealsFor(
      resolved.context.account.id,
    );
    const mine = found.find((appeal) => appeal.id === parsed.value.appealId);
    // Somebody else's complaint is answered exactly as one that does not exist.
    if (mine === undefined) return this.invalid(input);

    const outcome = await this.dependencies.appeals.withdraw({
      appealId: mine.id,
      appellantReference: resolved.context.account.id,
      expectedVersion: mine.version,
    });
    if (outcome.kind === 'recorded') {
      return {
        body: appealSchema.parse(appealBody(outcome.appeal)),
        status: 200,
      };
    }
    return outcome.kind === 'not_found'
      ? this.invalid(input)
      : routeFailure(409, productErrorCodes.conflict, input.correlationId);
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

/**
 * A statement of reasons on the wire.
 *
 * The disclosable category, the scope, when, and the redress. There is no field
 * here for the finding, the evidence, the reviewer, or the report.
 */
function statementBody(statement: StatementOfReasons) {
  return {
    appealable: statement.appealable,
    ...(statement.appealWindowClosesAt === undefined
      ? {}
      : { appealWindowClosesAt: statement.appealWindowClosesAt.toISOString() }),
    decidedAt: statement.decidedAt.toISOString(),
    decisionId: statement.decisionId,
    reasonCode: statement.reasonCode,
    scope: statement.scope,
  };
}

/**
 * A complaint as its own appellant sees it.
 *
 * The state and the dates. Not the reviewer who answered it, not the decision
 * that replaced the original, and not the statement they wrote: they already
 * know what they wrote, and echoing stored text back turns a record into a
 * readable store.
 */
function appealBody(appeal: AppealView) {
  return {
    decisionId: appeal.decisionId,
    id: appeal.id,
    state: appeal.state,
    submittedAt: appeal.submittedAt.toISOString(),
    ...(appeal.windowClosesAt === null
      ? {}
      : { windowClosesAt: appeal.windowClosesAt.toISOString() }),
  };
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
