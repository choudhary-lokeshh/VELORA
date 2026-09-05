import {
  defaultPageSize,
  moderationAppealListResponseSchema,
  moderationAppealOutcomeRequestSchema,
  moderationAppealResponseSchema,
  moderationCaseDetailResponseSchema,
  moderationCaseListResponseSchema,
  moderationCaseRequestSchema,
  moderationCaseResponseSchema,
  moderationDecisionRequestSchema,
  moderationDecisionResponseSchema,
  moderationNoteRequestSchema,
  moderationQueueSchema,
  moderationTriageRequestSchema,
  pageSizeSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { AppealService, AppealView } from '../safety/appeals.js';
import type {
  CaseOutcome,
  ModerationCaseView,
  ModerationDecisionView,
  ModerationEvidenceView,
  ModerationReportView,
  ModerationService,
} from '../safety/moderation.js';
import type { AdminContextResolver } from './context.js';

/**
 * Platform Admin moderation operations.
 *
 * Every route here is an **explicit command**. There is no generic patch
 * endpoint for a safety record anywhere in this API: a shape that could set an
 * arbitrary field on a case, an evidence row, or a decision would be a shape
 * that could rewrite an audit, and [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * forbids exactly that.
 *
 * They are reachable by nobody today, and that is not an accident of
 * configuration. `AdminContextResolver` requires the Platform Admin audience
 * *and* a fresh phishing-resistant assurance, no approved verifier can produce
 * that assurance, and every route therefore fails closed rather than degrading
 * to something weaker. Publishing them now is what lets the operator surface be
 * built and tested against the contract it will actually call.
 *
 * Two things are absent from every shape here and their absence is the design.
 * **Reporter identity**, because a case is about a target and an operator view
 * that could group people by who complained about them is a view somebody will
 * eventually work that way. And **report volume**, for the same reason: a
 * number that decides nothing decides something the moment an operator sees it.
 */
export interface AdminModerationRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly appeals: AppealService;
  readonly moderation: ModerationService;
}

export class AdminModerationRoutes {
  constructor(
    private readonly dependencies: AdminModerationRoutesDependencies,
  ) {}

  async listCases(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const rawSize = query.get('pageSize');
    const size =
      rawSize === null ? defaultPageSize : pageSizeSchema.safeParse(rawSize);
    if (typeof size !== 'number' && !size.success) return this.invalid(input);
    const rawQueue = query.get('moderationQueue');
    const queue =
      rawQueue === null ? undefined : moderationQueueSchema.safeParse(rawQueue);
    if (queue !== undefined && !queue.success) return this.invalid(input);

    const page = await this.dependencies.moderation.openCases({
      cursor: query.get('cursor') ?? undefined,
      pageSize: typeof size === 'number' ? size : size.data,
      ...(queue === undefined ? {} : { queue: queue.data }),
    });
    // An unreadable cursor is a malformed request rather than an empty page:
    // answering with nothing would let a caller believe the queue was empty.
    if (page.kind !== 'page') return this.invalid(input);
    return {
      body: moderationCaseListResponseSchema.parse({
        cases: page.cases.map(caseBody),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      }),
      status: 200,
    };
  }

  async getCase(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const caseId = new URL(input.request.url).searchParams.get('caseId');
    if (caseId === null) return this.invalid(input);
    const detail = await this.dependencies.moderation.caseDetail(caseId);
    // A case that does not exist and one this caller may not see are the same
    // answer, as they are everywhere else in this API.
    if (detail === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: moderationCaseDetailResponseSchema.parse({
        case: caseBody(detail.case),
        decisions: detail.decisions.map(decisionBody),
        evidence: detail.evidence.map(evidenceBody),
        reports: detail.reports.map(reportBody),
        truncated: detail.truncated,
      }),
      status: 200,
    };
  }

  async claimCase(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.resolve',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(moderationCaseRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    return this.settleCase(
      input,
      await this.dependencies.moderation.claimCase({
        actorReference: resolved.context.actorReference,
        caseId: parsed.value.caseId,
      }),
    );
  }

  async triageCase(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.resolve',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(moderationTriageRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    return this.settleCase(
      input,
      await this.dependencies.moderation.triageCase({
        caseId: parsed.value.caseId,
        priority: parsed.value.priority,
        state: parsed.value.state,
      }),
    );
  }

  /**
   * Records a reviewer's note as evidence.
   *
   * The note travels in one direction. An operator writes it and only an
   * operator reads it back through the case detail; there is no consumer or
   * creator response anywhere in this API with a field it could reach, and
   * nothing logs it.
   */
  async addNote(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.resolve',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(moderationNoteRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const recorded = await this.dependencies.moderation.recordEvidence({
      actorReference: resolved.context.actorReference,
      caseId: parsed.value.caseId,
      evidence: { kind: 'operator_note', note: parsed.value.note },
    });
    if (recorded.kind === 'not_found') {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    if (recorded.kind !== 'recorded') return this.invalid(input);

    const detail = await this.dependencies.moderation.caseDetail(
      parsed.value.caseId,
    );
    if (detail === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: moderationCaseResponseSchema.parse({ case: caseBody(detail.case) }),
      status: 200,
    };
  }

  async decideCase(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.enforce',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(moderationDecisionRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.moderation.decideCase({
      action: parsed.value.action,
      actorReference: resolved.context.actorReference,
      caseId: parsed.value.caseId,
      evidenceIds: parsed.value.evidenceIds,
      expectedVersion: parsed.value.expectedVersion,
      ...(parsed.value.expiresAt === undefined
        ? {}
        : { expiresAt: new Date(parsed.value.expiresAt) }),
      ...(parsed.value.priority === undefined
        ? {}
        : { priority: parsed.value.priority }),
      reasonCode: parsed.value.reasonCode,
      ...(parsed.value.scope === undefined
        ? {}
        : { scope: parsed.value.scope }),
      ...(parsed.value.supersedesDecisionId === undefined
        ? {}
        : { supersedesDecisionId: parsed.value.supersedesDecisionId }),
      ...(parsed.value.targetConversationId === undefined
        ? {}
        : { targetConversationId: parsed.value.targetConversationId }),
    });
    switch (outcome.kind) {
      case 'not_found': {
        return routeFailure(
          404,
          productErrorCodes.notFound,
          input.correlationId,
        );
      }
      case 'invalid_decision': {
        return this.invalid(input);
      }
      case 'conflict':
      case 'not_applicable': {
        // A decision somebody else already made and one the platform cannot
        // carry out are one code on purpose: both mean re-read and decide
        // again, and which applied tells a caller about state they were not
        // shown.
        return routeFailure(
          409,
          productErrorCodes.conflict,
          input.correlationId,
        );
      }
      default: {
        return {
          body: moderationDecisionResponseSchema.parse({
            decision: decisionBody(outcome.decision),
          }),
          status: 200,
        };
      }
    }
  }

  async listAppeals(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const rawSize = new URL(input.request.url).searchParams.get('pageSize');
    const size =
      rawSize === null ? defaultPageSize : pageSizeSchema.safeParse(rawSize);
    if (typeof size !== 'number' && !size.success) return this.invalid(input);

    const appeals = await this.dependencies.appeals.openAppeals(
      typeof size === 'number' ? size : size.data,
    );
    return {
      body: moderationAppealListResponseSchema.parse({
        appeals: appeals.map(appealBody),
      }),
      status: 200,
    };
  }

  async answerAppeal(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'safety.resolve',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      moderationAppealOutcomeRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    const outcome =
      parsed.value.outcome === 'upheld'
        ? parsed.value.outcomeDecisionId === undefined
          ? undefined
          : await this.dependencies.appeals.uphold({
              appealId: parsed.value.appealId,
              expectedVersion: parsed.value.expectedVersion,
              outcomeDecisionId: parsed.value.outcomeDecisionId,
              reviewerActorReference: resolved.context.actorReference,
            })
        : await this.dependencies.appeals.refuse({
            appealId: parsed.value.appealId,
            expectedVersion: parsed.value.expectedVersion,
            reviewerActorReference: resolved.context.actorReference,
          });
    // Upholding without naming what replaced the original is not an outcome,
    // it is an assertion that something was put right.
    if (outcome === undefined) return this.invalid(input);
    switch (outcome.kind) {
      case 'not_found': {
        return routeFailure(
          404,
          productErrorCodes.notFound,
          input.correlationId,
        );
      }
      case 'invalid_outcome': {
        return this.invalid(input);
      }
      case 'conflict': {
        return routeFailure(
          409,
          productErrorCodes.conflict,
          input.correlationId,
        );
      }
      default: {
        return {
          body: moderationAppealResponseSchema.parse({
            appeal: appealBody(outcome.appeal),
          }),
          status: 200,
        };
      }
    }
  }

  private settleCase(input: RouteRequest, outcome: CaseOutcome): RouteResult {
    if (outcome.kind === 'not_found') {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    if (outcome.kind !== 'recorded') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    return {
      body: moderationCaseResponseSchema.parse({
        case: caseBody(outcome.case),
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
}

/**
 * One case on the wire.
 *
 * `assigned` rather than the holder's reference: an operator needs to know
 * whether somebody has it, and which colleague is a fact the queue does not owe
 * them and the audit records elsewhere.
 */
function caseBody(view: ModerationCaseView) {
  return {
    assigned: view.assignedActorReference !== null,
    ...(view.assignmentExpiresAt === null
      ? {}
      : { assignmentExpiresAt: view.assignmentExpiresAt.toISOString() }),
    id: view.id,
    openedAt: view.openedAt.toISOString(),
    policyVersion: view.policyVersion,
    priority: view.priority,
    queue: view.queue,
    state: view.state,
    targetId: view.targetId,
    targetType: view.targetType,
    version: view.version,
  };
}

/** A report as a reviewer reads it. There is no reporter field at all. */
function reportBody(view: ModerationReportView) {
  return {
    createdAt: view.createdAt.toISOString(),
    ...(view.detail === null ? {} : { detail: view.detail }),
    id: view.id,
    reasonCode: view.reasonCode,
    ...(view.sourceSurface === null
      ? {}
      : { sourceSurface: view.sourceSurface }),
    state: view.state,
    targetType: view.targetType,
  };
}

function evidenceBody(view: ModerationEvidenceView) {
  return {
    id: view.id,
    kind: view.kind,
    ...(view.note === null ? {} : { note: view.note }),
    ...(view.observedAt === null
      ? {}
      : { observedAt: view.observedAt.toISOString() }),
    recordedAt: view.recordedAt.toISOString(),
    ...(view.referenceId === null ? {} : { referenceId: view.referenceId }),
    ...(view.referenceType === null
      ? {}
      : { referenceType: view.referenceType }),
    ...(view.stateLabel === null ? {} : { stateLabel: view.stateLabel }),
  };
}

function decisionBody(view: ModerationDecisionView) {
  return {
    action: view.action,
    decidedAt: view.decidedAt.toISOString(),
    ...(view.enforcementId === null
      ? {}
      : { enforcementId: view.enforcementId }),
    evidenceIds: [...view.evidenceIds],
    ...(view.expiresAt === null
      ? {}
      : { expiresAt: view.expiresAt.toISOString() }),
    id: view.id,
    policyVersion: view.policyVersion,
    ...(view.priorState === null ? {} : { priorState: view.priorState }),
    reasonCode: view.reasonCode,
    ...(view.resultingState === null
      ? {}
      : { resultingState: view.resultingState }),
    ...(view.scope === null ? {} : { scope: view.scope }),
    ...(view.supersedesId === null ? {} : { supersedesId: view.supersedesId }),
  };
}

/** A complaint on the wire. The appellant's own words are deliberately absent. */
function appealBody(view: AppealView) {
  return {
    appellantKind: view.appellantKind,
    decisionId: view.decisionId,
    id: view.id,
    ...(view.outcomeDecisionId === null
      ? {}
      : { outcomeDecisionId: view.outcomeDecisionId }),
    state: view.state,
    submittedAt: view.submittedAt.toISOString(),
    version: view.version,
    ...(view.windowClosesAt === null
      ? {}
      : { windowClosesAt: view.windowClosesAt.toISOString() }),
  };
}
