import { lockSubject } from '../database/subject-lock.js';
import type { ConversationEnforcementPort } from '../messaging/enforcement.js';
import type { ConsumerEnforcementPort } from '../users/enforcement.js';
import { decodeCaseCursor, encodeCaseCursor } from './cursor.js';
import type { EnforcementAuthority } from './enforcement.js';
import {
  caseClaimLeaseMilliseconds,
  maximumCasePageSize,
  maximumSafetyPageSize,
  openCaseStates,
  type CasePriority,
  type CaseQueue,
  type CaseState,
  type EnforcementReasonCode,
  type EnforcementScope,
  type ReportTargetType,
} from './policy.js';
import type {
  CaseRow,
  EnforcementRow,
  ReportRow,
  SafetyRepository,
} from './repository.js';

/**
 * A report as a reviewer sees it.
 *
 * This shape exists only inside the moderation seam. It carries the reporter
 * and the narrative because a reviewer cannot judge a report without them, and
 * it is precisely why there is no HTTP route that returns it: the consumer API
 * has no shape that can carry a reporter identity, so no consumer request can
 * elicit one.
 */
export interface ModerationReportView {
  readonly caseId: string | null;
  readonly conversationId: string | null;
  readonly createdAt: Date;
  readonly detail: string | null;
  readonly id: string;
  readonly messageId: string | null;
  readonly policyVersion: string;
  readonly reasonCode: string;
  readonly reporterId: string;
  readonly sourceSurface: string | null;
  readonly state: string;
  readonly subjectId: string;
  readonly targetType: ReportTargetType;
  readonly version: number;
}

/**
 * A case as a reviewer sees it.
 *
 * There is no reporter here and no report count. A case is about a target, and
 * a reviewer who could see how many people complained would have a number that
 * `docs/flows/report-to-enforcement.md` says must decide nothing — which is a
 * number that decides something the moment somebody sees it.
 */
export interface ModerationCaseView {
  readonly assignedActorReference: string | null;
  readonly assignmentExpiresAt: Date | null;
  readonly id: string;
  readonly openedAt: Date;
  readonly policyVersion: string;
  readonly priority: CasePriority;
  readonly queue: CaseQueue;
  readonly state: CaseState;
  readonly targetId: string;
  readonly targetType: ReportTargetType;
  readonly version: number;
}

export interface CaseDetail {
  readonly case: ModerationCaseView;
  readonly reports: readonly ModerationReportView[];
}

export type CaseQueuePage =
  | {
      readonly kind: 'page';
      readonly cases: readonly ModerationCaseView[];
      readonly nextCursor: string | undefined;
    }
  | { readonly kind: 'invalid_cursor' };

export type CaseOutcome =
  | { readonly kind: 'recorded'; readonly case: ModerationCaseView }
  | { readonly kind: 'not_found' }
  /** Somebody else moved or holds it; re-read and decide again. */
  | { readonly kind: 'conflict' };

export type ModerationOutcome =
  | { readonly kind: 'recorded'; readonly report: ModerationReportView }
  | { readonly kind: 'not_found' }
  /** Somebody else moved the report first; re-read and decide again. */
  | { readonly kind: 'conflict' }
  /** The enforcement could not be applied to the subject's current state. */
  | { readonly kind: 'not_applicable' };

export interface ModerationDecision {
  /** Opaque reference to the acting operator, recorded on the enforcement. */
  readonly actorReference: string;
  readonly enforcement?:
    | {
        readonly reasonCode: EnforcementReasonCode;
        readonly scope: EnforcementScope;
        readonly targetConversationId?: string | undefined;
      }
    | undefined;
  readonly reportId: string;
}

export interface ModerationServiceDependencies {
  readonly accounts: ConsumerEnforcementPort;
  readonly authority: EnforcementAuthority;
  readonly conversations: ConversationEnforcementPort;
  readonly now: () => Date;
  readonly repository: SafetyRepository;
}

/**
 * The moderation and enforcement seam.
 *
 * **This service has no HTTP surface, and that is the design.** Platform Admin
 * sign-in has no approved implementation — the configured privileged
 * authenticator verifier refuses every assertion and no adapter can mint Admin
 * authority — so publishing a moderation route would mean publishing an
 * endpoint that either nobody can reach or, worse, that somebody eventually
 * reaches with a consumer credential. What Phase 8 owes the product is the
 * contract ADMIN and MODERATION will call once privileged authentication
 * exists, wired to real enforcement, with no path from a consumer request to
 * any of it.
 *
 * The seam is exercised directly in tests, which is the only caller it has.
 *
 * Enforcement and the report transition are one transaction. A report marked
 * actioned with no enforcement recorded, or an enforcement applied against a
 * report that a concurrent reviewer already dismissed, are both states an audit
 * cannot explain, so neither is reachable.
 */
export class ModerationService {
  constructor(private readonly dependencies: ModerationServiceDependencies) {}

  /**
   * The case queue: open cases, oldest first, keyset paged.
   *
   * Ordered by when a case was opened rather than by how many reports it
   * carries. Volume orders nothing here, because a queue sorted by complaint
   * count is a queue anybody with several accounts can steer.
   */
  async openCases(
    input: {
      readonly cursor?: string | undefined;
      readonly pageSize?: number | undefined;
      readonly queue?: CaseQueue | undefined;
    } = {},
  ): Promise<CaseQueuePage> {
    const decoded =
      input.cursor === undefined ? undefined : decodeCaseCursor(input.cursor);
    if (input.cursor !== undefined && decoded === undefined) {
      return { kind: 'invalid_cursor' };
    }
    const pageSize = Math.max(
      1,
      Math.min(input.pageSize ?? maximumCasePageSize, maximumCasePageSize),
    );
    const rows = await this.dependencies.repository.listCases(
      this.dependencies.repository.transactionless,
      {
        after: decoded,
        limit: pageSize + 1,
        queue: input.queue,
        states: [...openCaseStates],
      },
    );
    const page = rows.slice(0, pageSize);
    const last = page.at(-1);
    return {
      cases: page.map(caseView),
      kind: 'page',
      nextCursor:
        rows.length > pageSize && last !== undefined
          ? encodeCaseCursor({ id: last.id, openedAt: last.openedAt })
          : undefined,
    };
  }

  /** One case and the reports that are evidence in it. */
  async caseDetail(caseId: string): Promise<CaseDetail | undefined> {
    const { repository } = this.dependencies;
    const found = await repository.findCase(repository.transactionless, caseId);
    if (found === undefined) return undefined;
    const reports = await repository.listReportsForCase(
      repository.transactionless,
      { caseId, limit: maximumCasePageSize },
    );
    return { case: caseView(found), reports: reports.map(moderationView) };
  }

  /**
   * Claims a case for review.
   *
   * A lease rather than an assignment: a reviewer whose session ends mid-review
   * releases the case when the lease lapses, rather than holding it out of the
   * queue for ever. Re-claiming a case one already holds renews the lease,
   * which is what makes a long review possible without a second mechanism.
   */
  async claimCase(input: {
    readonly actorReference: string;
    readonly caseId: string;
  }): Promise<CaseOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const found = await repository.findCase(
      repository.transactionless,
      input.caseId,
    );
    if (found === undefined) return { kind: 'not_found' };
    const claimed = await repository.claimCase(repository.transactionless, {
      actorReference: input.actorReference,
      caseId: input.caseId,
      expectedVersion: found.version,
      expiresAt: new Date(now.getTime() + caseClaimLeaseMilliseconds),
      now,
    });
    return claimed === undefined
      ? { kind: 'conflict' }
      : { case: caseView(claimed), kind: 'recorded' };
  }

  /**
   * Records a reviewer's judgement of how urgent a case is, and moves it.
   *
   * Priority is an input here and nowhere else. Nothing computes it, nothing
   * raises it because a second report arrived, and no default other than
   * `untriaged` exists — which is the honest state for a case nobody has looked
   * at rather than a quiet claim that it is ordinary.
   */
  async triageCase(input: {
    readonly caseId: string;
    readonly priority: CasePriority;
    readonly state: 'triaged' | 'investigating';
  }): Promise<CaseOutcome> {
    return this.moveCase({
      caseId: input.caseId,
      priority: input.priority,
      state: input.state,
    });
  }

  /** Closes a case without a decision. A decision is a separate record. */
  async closeCase(input: { readonly caseId: string }): Promise<CaseOutcome> {
    return this.moveCase({ caseId: input.caseId, state: 'closed' });
  }

  private async moveCase(input: {
    readonly caseId: string;
    readonly priority?: CasePriority | undefined;
    readonly state: CaseState;
  }): Promise<CaseOutcome> {
    const { repository } = this.dependencies;
    const found = await repository.findCase(
      repository.transactionless,
      input.caseId,
    );
    if (found === undefined) return { kind: 'not_found' };
    const moved = await repository.transitionCase(repository.transactionless, {
      caseId: input.caseId,
      expectedVersion: found.version,
      now: this.dependencies.now(),
      priority: input.priority,
      state: input.state,
    });
    return moved === undefined
      ? { kind: 'conflict' }
      : { case: caseView(moved), kind: 'recorded' };
  }

  /** The queue: unresolved reports, oldest first. */
  async openReports(
    limit = maximumSafetyPageSize,
  ): Promise<readonly ModerationReportView[]> {
    const rows = await this.dependencies.repository.listOpenReports(
      this.dependencies.repository.transactionless,
      Math.max(1, Math.min(limit, maximumSafetyPageSize)),
    );
    return rows.map(moderationView);
  }

  /** Marks a report as being looked at. Reversible only by a decision. */
  async beginReview(input: {
    readonly reportId: string;
  }): Promise<ModerationOutcome> {
    const now = this.dependencies.now();
    const report = await this.dependencies.repository.findReport(
      this.dependencies.repository.transactionless,
      input.reportId,
    );
    if (report === undefined) return { kind: 'not_found' };
    const moved = await this.dependencies.repository.transitionReport(
      this.dependencies.repository.transactionless,
      {
        expectedVersion: report.version,
        id: report.id,
        now,
        resolved: false,
        state: 'under_review',
      },
    );
    return moved === undefined
      ? { kind: 'conflict' }
      : { kind: 'recorded', report: moderationView(moved) };
  }

  /**
   * Resolves a report, applying an enforcement when the decision calls for one.
   *
   * A decision with no enforcement dismisses. A decision with one actions the
   * report and appends an immutable enforcement record alongside the state
   * change it causes in the owning domain — USERS for an account, MESSAGING for
   * a conversation — all in one transaction.
   */
  async decide(decision: ModerationDecision): Promise<ModerationOutcome> {
    const now = this.dependencies.now();
    const report = await this.dependencies.repository.findReport(
      this.dependencies.repository.transactionless,
      decision.reportId,
    );
    if (report === undefined) return { kind: 'not_found' };

    return this.dependencies.repository
      .transaction(async (executor): Promise<ModerationOutcome> => {
        // The subject lock before any row lock, which is the ordering rule in
        // `src/database/subject-lock.ts`. Taking it after the report row lock
        // would put the only pair of orderings in the system that could form a
        // cycle into the one transaction that holds both.
        await lockSubject(executor, report.subjectId);
        const moved = await this.dependencies.repository.transitionReport(
          executor,
          {
            expectedVersion: report.version,
            id: report.id,
            now,
            resolved: true,
            state:
              decision.enforcement === undefined ? 'dismissed' : 'actioned',
          },
        );
        if (moved === undefined) return { kind: 'conflict' };
        if (decision.enforcement === undefined) {
          return { kind: 'recorded', report: moderationView(moved) };
        }

        const applied = await this.apply({
          actorReference: decision.actorReference,
          executor,
          now,
          reasonCode: decision.enforcement.reasonCode,
          reportId: report.id,
          scope: decision.enforcement.scope,
          subjectId: report.subjectId,
          targetConversationId:
            decision.enforcement.targetConversationId ?? undefined,
        });
        if (!applied) {
          // Rolling back is the only honest answer: an enforcement that did not
          // take effect must not leave a report marked actioned behind it.
          throw new EnforcementNotApplicable();
        }
        return { kind: 'recorded', report: moderationView(moved) };
      })
      .catch((error: unknown) => {
        if (error instanceof EnforcementNotApplicable) {
          return { kind: 'not_applicable' } as const;
        }
        throw error;
      });
  }

  /**
   * Reverses an account restriction after review.
   *
   * The reversal is a second record that names the restriction it lifts, never
   * an edit of it. It used to be a second `account_restriction` row, which made
   * a restriction and its reversal indistinguishable in the table they both
   * lived in; the disposition and the supersession link are what let a reader
   * now derive what is actually in force.
   *
   * A restore with nothing in force to lift is refused rather than recorded.
   */
  async restoreAccount(input: {
    readonly actorReference: string;
    readonly subjectId: string;
  }): Promise<boolean> {
    const now = this.dependencies.now();
    return this.dependencies.repository
      .transaction(async (executor) => {
        const lifted = await this.dependencies.authority.lift(executor, {
          actorReference: input.actorReference,
          reasonCode: 'platform_integrity',
          scope: 'account_restriction',
          subjectId: input.subjectId,
        });
        if (lifted.kind !== 'recorded') return false;
        const restored = await this.dependencies.accounts.restore({
          executor,
          now,
          userId: input.subjectId,
        });
        // A lift recorded against an account the owning domain will not restore
        // would be a reversal that never happened, so the whole decision goes.
        if (restored === undefined) throw new EnforcementNotApplicable();
        return true;
      })
      .catch((error: unknown) => {
        if (error instanceof EnforcementNotApplicable) return false;
        throw error;
      });
  }

  async enforcementsFor(subjectId: string): Promise<readonly EnforcementRow[]> {
    return this.dependencies.repository.listEnforcementsFor(
      this.dependencies.repository.transactionless,
      subjectId,
    );
  }

  /**
   * Records the decision, then applies it through the owning domain.
   *
   * The record is taken first because the authority takes the subject lock, and
   * the ordering rule in `src/database/subject-lock.ts` is that the advisory
   * lock precedes every row lock. Applying first would take a row lock on
   * `users_accounts` before the subject lock and put a cycle in the lock graph.
   */
  private async apply(input: {
    readonly actorReference: string;
    readonly executor: Parameters<
      Parameters<SafetyRepository['transaction']>[0]
    >[0];
    readonly now: Date;
    readonly reasonCode: EnforcementReasonCode;
    readonly reportId: string;
    readonly scope: EnforcementScope;
    readonly subjectId: string;
    readonly targetConversationId: string | undefined;
  }): Promise<boolean> {
    const conversationId = input.targetConversationId;
    if (input.scope === 'account_restriction') {
      if (conversationId !== undefined) return false;
    } else if (input.scope === 'conversation_closure') {
      if (conversationId === undefined) return false;
    } else {
      // The remaining scopes act on creator objects, which this seam has no
      // contract to change. ADMIN owns those operations.
      return false;
    }

    const imposed = await this.dependencies.authority.impose(input.executor, {
      actorReference: input.actorReference,
      reasonCode: input.reasonCode,
      reportId: input.reportId,
      scope: input.scope,
      subjectId: input.subjectId,
      targetConversationId: conversationId,
    });
    if (imposed.kind !== 'recorded' && imposed.kind !== 'already_in_force') {
      return false;
    }

    if (conversationId === undefined) {
      const restricted = await this.dependencies.accounts.restrict({
        executor: input.executor,
        now: input.now,
        userId: input.subjectId,
      });
      return restricted !== undefined;
    }

    return this.dependencies.conversations.close({
      conversationId,
      executor: input.executor,
      now: input.now,
    });
  }
}

/** Rolls the decision back when the enforcement could not take effect. */
class EnforcementNotApplicable extends Error {
  constructor() {
    super('Enforcement was not applicable to the subject');
    this.name = 'EnforcementNotApplicable';
  }
}

function moderationView(row: ReportRow): ModerationReportView {
  return {
    caseId: row.caseId,
    conversationId: row.conversationId,
    createdAt: row.createdAt,
    detail: row.detail,
    id: row.id,
    messageId: row.messageId,
    policyVersion: row.policyVersion,
    reasonCode: row.reasonCode,
    reporterId: row.reporterId,
    sourceSurface: row.sourceSurface,
    state: row.state,
    subjectId: row.subjectId,
    targetType: row.targetType,
    version: row.version,
  };
}

function caseView(row: CaseRow): ModerationCaseView {
  return {
    assignedActorReference: row.assignedActorReference,
    assignmentExpiresAt: row.assignmentExpiresAt,
    id: row.id,
    openedAt: row.openedAt,
    policyVersion: row.policyVersion,
    priority: row.priority,
    queue: row.queue,
    state: row.state,
    targetId: row.targetId,
    targetType: row.targetType,
    version: row.version,
  };
}
