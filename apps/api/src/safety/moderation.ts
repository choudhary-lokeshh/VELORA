import type { TransactionHandle } from '../database/executor.js';
import { lockSubject } from '../database/subject-lock.js';
import type { ConversationEnforcementPort } from '../messaging/enforcement.js';
import type { ConsumerEnforcementPort } from '../users/enforcement.js';
import { decodeCaseCursor, encodeCaseCursor } from './cursor.js';
import type { EnforcementAuthority } from './enforcement.js';
import {
  caseClaimLeaseMilliseconds,
  decisionPolicyVersion,
  enforcementReasonCodes,
  enforcingDecisionActions,
  evidencePolicyVersion,
  evidenceStateLabelPattern,
  maximumCasePageSize,
  maximumCaseRecordPageSize,
  maximumOperatorNoteCharacters,
  maximumSafetyPageSize,
  openCaseStates,
  resolvedCaseStates,
  resolvingDecisionActions,
  scopesForDecision,
  unavailableEvidenceKinds,
  type CasePriority,
  type CaseQueue,
  type CaseState,
  type DecisionAction,
  type DecisionReasonCode,
  type DecisionSubjectState,
  type EnforcementReasonCode,
  type EnforcementScope,
  type EvidenceKind,
  type EvidenceReferenceType,
  type ReportTargetType,
} from './policy.js';
import type {
  CaseRow,
  DecisionRow,
  EnforcementRow,
  EvidenceRow,
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

/**
 * Evidence as a reviewer sees it.
 *
 * The one shape in this domain that carries an operator's note, and another
 * reason the seam publishes no route: a note is written for a colleague
 * reviewing a case and for nobody else, and there is no consumer or creator
 * response anywhere in Velora with a field it could travel in.
 */
export interface ModerationEvidenceView {
  readonly actorReference: string | null;
  readonly caseId: string;
  readonly externalReference: string | null;
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly note: string | null;
  readonly observedAt: Date | null;
  readonly policyVersion: string;
  readonly recordedAt: Date;
  readonly referenceId: string | null;
  readonly referenceType: EvidenceReferenceType | null;
  readonly stateLabel: string | null;
}

/** A decision, and the evidence it rested on. */
export interface ModerationDecisionView {
  readonly action: DecisionAction;
  readonly actorReference: string;
  readonly caseId: string;
  readonly decidedAt: Date;
  readonly enforcementId: string | null;
  readonly evidenceIds: readonly string[];
  readonly expiresAt: Date | null;
  readonly id: string;
  readonly policyVersion: string;
  readonly priorState: DecisionSubjectState | null;
  readonly reasonCode: string;
  readonly resultingState: DecisionSubjectState | null;
  readonly scope: EnforcementScope | null;
  readonly subjectId: string;
  readonly supersedesId: string | null;
  readonly targetType: ReportTargetType;
}

export interface CaseDetail {
  readonly case: ModerationCaseView;
  readonly decisions: readonly ModerationDecisionView[];
  readonly evidence: readonly ModerationEvidenceView[];
  readonly reports: readonly ModerationReportView[];
  /**
   * Whether any of the three lists stopped at its bound.
   *
   * Said out loud, because a reviewer looking at a partial case that looks
   * complete is a reviewer deciding on less than they think they have. Every
   * read here is bounded and always will be; what was missing was telling
   * somebody when a bound was reached.
   */
  readonly truncated: boolean;
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
  | { readonly kind: 'conflict' };

/**
 * What a reviewer may add to a case.
 *
 * Every variant names the thing it is about, and every one of those names is
 * checked against what the case already contains rather than against another
 * domain. SAFETY does not ask MESSAGING whether a message exists, because a
 * contract that answered would be a way to probe for other people's messages;
 * what makes a message citable is that somebody reported it, and that fact is
 * already here.
 */
export type EvidenceRequest =
  | { readonly kind: 'report'; readonly reportId: string }
  | { readonly kind: 'message_reference'; readonly messageId: string }
  | { readonly kind: 'creator_content_reference'; readonly contentId: string }
  | { readonly kind: 'club_reference'; readonly clubId: string }
  | {
      readonly kind: 'creator_profile_state';
      readonly creatorId: string;
      readonly observedAt: Date;
      readonly stateLabel: string;
    }
  | { readonly kind: 'operator_note'; readonly note: string }
  | {
      readonly kind: 'system_fact';
      readonly observedAt: Date;
      readonly stateLabel: string;
    }
  | {
      readonly kind: 'consent_evidence_reference';
      readonly consentRecordId: string;
    }
  | {
      readonly kind: 'external_verification_reference';
      readonly externalReference: string;
    };

export interface RecordEvidenceInput {
  /** Opaque reference to the operator. Required of a note, which is theirs. */
  readonly actorReference?: string | undefined;
  readonly caseId: string;
  readonly evidence: EvidenceRequest;
}

export type EvidenceOutcome =
  | { readonly kind: 'recorded'; readonly evidence: ModerationEvidenceView }
  | { readonly kind: 'not_found' }
  /** It names something this case is not about. */
  | { readonly kind: 'invalid_reference' }
  /** No approved authority publishes this evidence, so none may be recorded. */
  | { readonly kind: 'unavailable' };

/**
 * A decision on a case.
 *
 * The version is the one the reviewer read. A decision taken against a stale
 * read is refused rather than applied to a case that has moved underneath it,
 * which is the difference between two reviewers disagreeing and two reviewers
 * both believing they settled the same case.
 */
export interface CaseDecisionRequest {
  readonly action: DecisionAction;
  readonly actorReference: string;
  readonly caseId: string;
  /** What the decision rests on. Required of anything that enforces. */
  readonly evidenceIds: readonly string[];
  readonly expectedVersion: number;
  /** When a temporary hold stops on its own. Holds only. */
  readonly expiresAt?: Date | undefined;
  /** The urgency an escalation records. Escalations only. */
  readonly priority?: CasePriority | undefined;
  readonly reasonCode: DecisionReasonCode;
  readonly scope?: EnforcementScope | undefined;
  /** The decision this one corrects. A correction never edits the original. */
  readonly supersedesDecisionId?: string | undefined;
  /** The conversation a closure names. It must be one a report in the case named. */
  readonly targetConversationId?: string | undefined;
}

export type DecisionOutcome =
  | { readonly kind: 'recorded'; readonly decision: ModerationDecisionView }
  | { readonly kind: 'not_found' }
  /** Somebody decided first, or the read was stale. Re-read and decide again. */
  | { readonly kind: 'conflict' }
  /** The request is not a decision this vocabulary can express. */
  | { readonly kind: 'invalid_decision' }
  /** The platform publishes no way to carry the decision out. */
  | { readonly kind: 'not_applicable' };

export interface ModerationServiceDependencies {
  readonly accounts: ConsumerEnforcementPort;
  readonly authority: EnforcementAuthority;
  readonly conversations: ConversationEnforcementPort;
  readonly now: () => Date;
  readonly repository: SafetyRepository;
}

/** What an enforcement changed, as this domain is entitled to describe it. */
interface EnforcementEffect {
  readonly enforcementId: string;
  readonly priorState: DecisionSubjectState;
  readonly resultingState: DecisionSubjectState;
}

/**
 * The moderation and enforcement seam.
 *
 * **This service has no HTTP surface, and that is the design.** Platform Admin
 * sign-in has no approved implementation — the configured privileged
 * authenticator verifier refuses every assertion and no adapter can mint Admin
 * authority — so publishing a moderation route would mean publishing an
 * endpoint that either nobody can reach or, worse, that somebody eventually
 * reaches with a consumer credential. What this owes the product is the
 * contract ADMIN and MODERATION will call once privileged authentication
 * exists, wired to real enforcement, with no path from a consumer request to
 * any of it. Evidence, notes, and decisions are readable only through here,
 * which is what "operator access requires Admin authority" means while no Admin
 * authority can be minted at all.
 *
 * The seam is exercised directly in tests, which is the only caller it has.
 *
 * A decision, the enforcement it produces, the state change in the domain that
 * owns what changed, and the reports it resolves are one transaction. A case
 * marked decided with no decision recorded, a decision naming an enforcement
 * that did not take effect, or a report left open under a settled case are all
 * states an audit cannot explain, so none of them is reachable.
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

  /** One case: its reports, its evidence, and every decision taken on it. */
  async caseDetail(caseId: string): Promise<CaseDetail | undefined> {
    const { repository } = this.dependencies;
    const executor = repository.transactionless;
    const found = await repository.findCase(executor, caseId);
    if (found === undefined) return undefined;
    // One more than the bound from each, so reaching it is observable rather
    // than indistinguishable from a case that happens to be exactly that size.
    const overFetch = maximumCaseRecordPageSize + 1;
    const [reports, evidence, decisions] = await Promise.all([
      repository.listReportsForCase(executor, { caseId, limit: overFetch }),
      repository.listEvidenceForCase(executor, { caseId, limit: overFetch }),
      repository.listDecisionsForCase(executor, { caseId, limit: overFetch }),
    ]);
    const truncated = [reports, evidence, decisions].some(
      (rows) => rows.length > maximumCaseRecordPageSize,
    );
    return {
      case: caseView(found),
      decisions: await this.decisionViews(
        decisions.slice(0, maximumCaseRecordPageSize),
      ),
      evidence: evidence.slice(0, maximumCaseRecordPageSize).map(evidenceView),
      reports: reports.slice(0, maximumCaseRecordPageSize).map(moderationView),
      truncated,
    };
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

  /**
   * Closes a case without deciding it.
   *
   * Distinct from a decision on purpose: a closed case is one nobody is going
   * to look at further, and a decided one is one somebody judged. Recording
   * both as the same state would let a case that was quietly dropped read
   * exactly like a case that was considered.
   */
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

  /** A case's evidence, oldest first. Operator-only, like everything here. */
  async caseEvidence(
    caseId: string,
  ): Promise<readonly ModerationEvidenceView[]> {
    const rows = await this.dependencies.repository.listEvidenceForCase(
      this.dependencies.repository.transactionless,
      { caseId, limit: maximumCaseRecordPageSize },
    );
    return rows.map(evidenceView);
  }

  /** Every decision taken on a case, oldest first. Never only the latest. */
  async caseDecisions(
    caseId: string,
  ): Promise<readonly ModerationDecisionView[]> {
    const rows = await this.dependencies.repository.listDecisionsForCase(
      this.dependencies.repository.transactionless,
      { caseId, limit: maximumCaseRecordPageSize },
    );
    return this.decisionViews(rows);
  }

  /**
   * Adds evidence to a case.
   *
   * Evidence is added, never edited and never removed — a trigger refuses both
   * — so a case's record only ever grows. Adding evidence to a decided case is
   * allowed and is not a way to change the decision: the decision names the
   * evidence it cited, and anything added afterwards is material for the
   * correction or the appeal that would supersede it.
   */
  async recordEvidence(input: RecordEvidenceInput): Promise<EvidenceOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    if (unavailableEvidenceKinds.includes(input.evidence.kind)) {
      // Consent and external verification are references to an approved
      // verifier's outcome, and Velora has no approved verifier. Recording one
      // would be an assertion dressed as evidence.
      return { kind: 'unavailable' };
    }
    if (
      input.evidence.kind === 'operator_note' &&
      input.actorReference === undefined
    ) {
      return { kind: 'invalid_reference' };
    }

    const found = await repository.findCase(
      repository.transactionless,
      input.caseId,
    );
    if (found === undefined) return { kind: 'not_found' };

    const values = await this.evidenceValues(found, input.evidence);
    if (values === undefined) return { kind: 'invalid_reference' };

    const recorded = await repository.insertEvidence(
      repository.transactionless,
      {
        actorReference: input.actorReference ?? null,
        caseId: found.id,
        now,
        policyVersion: evidencePolicyVersion,
        ...values,
      },
    );
    return { evidence: evidenceView(recorded), kind: 'recorded' };
  }

  /**
   * Decides a case.
   *
   * One transaction: the case leaves the queue, the decision is appended, the
   * evidence it cited is linked to it, any enforcement is recorded and applied
   * through the domain that owns what changes, and every still-open report in
   * the case is resolved. Anything that cannot be carried out rolls all of it
   * back, because a decision recorded without its effect and an effect with no
   * decision are equally unexplainable.
   *
   * A correction names the decision it replaces and is a second record. The
   * original stays byte-for-byte what was written; the database refuses to edit
   * it and refuses to let two corrections fork the chain.
   */
  async decideCase(request: CaseDecisionRequest): Promise<DecisionOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    if (!this.isExpressible(request, now)) return { kind: 'invalid_decision' };

    const found = await repository.findCase(
      repository.transactionless,
      request.caseId,
    );
    if (found === undefined) return { kind: 'not_found' };

    const superseded =
      request.supersedesDecisionId === undefined
        ? undefined
        : await repository.findDecision(
            repository.transactionless,
            request.supersedesDecisionId,
          );
    if (
      request.supersedesDecisionId !== undefined &&
      superseded?.caseId !== found.id
    ) {
      // A correction of a decision from another case is not a correction.
      return { kind: 'not_found' };
    }

    const resolving = resolvingDecisionActions.includes(request.action);
    const enforcing = enforcingDecisionActions.includes(request.action);

    return repository
      .transaction(async (executor): Promise<DecisionOutcome> => {
        // The subject lock before any row lock, which is the ordering rule in
        // `src/database/subject-lock.ts`. Every other decision about this
        // subject — an imposition, a lift, a report joining a case — takes the
        // same lock, so this either completes before them or sees them.
        await lockSubject(executor, found.targetId);

        const cited = await repository.listEvidenceInCase(executor, {
          caseId: found.id,
          evidenceIds: request.evidenceIds,
        });
        // A citation of evidence from another case, or of evidence that does
        // not exist, is refused rather than dropped: a decision that cited
        // fewer things than the reviewer believed is worse than no decision.
        if (cited.length !== new Set(request.evidenceIds).size) {
          throw new DecisionRefused('invalid_decision');
        }

        const moved = await this.positionCase(executor, {
          correcting: superseded !== undefined,
          expectedVersion: request.expectedVersion,
          found,
          now,
          priority: request.priority,
          resolving,
        });
        if (moved === undefined) throw new DecisionRefused('conflict');

        const effect = enforcing
          ? await this.enforce(executor, { found, now, request })
          : undefined;

        const decision = await repository.insertDecision(executor, {
          action: request.action,
          actorReference: request.actorReference,
          caseId: found.id,
          enforcementId: effect?.enforcementId ?? null,
          expiresAt: request.expiresAt ?? null,
          now,
          policyVersion: decisionPolicyVersion,
          priorState: effect?.priorState ?? null,
          reasonCode: request.reasonCode,
          resultingState: effect?.resultingState ?? null,
          scope: request.scope ?? null,
          subjectId: found.targetId,
          supersedesId: superseded?.id ?? null,
          targetType: found.targetType,
        });
        // The partial unique indexes decide: this case already has a
        // settlement, or the record being corrected has already been corrected.
        // Refusing here rolls the case transition and the enforcement back with
        // it — a restriction applied with no decision recorded would be exactly
        // the unexplainable state this whole transaction exists to prevent.
        if (decision === undefined) throw new DecisionRefused('conflict');

        await repository.linkDecisionEvidence(executor, {
          caseId: found.id,
          decisionId: decision.id,
          evidenceIds: [...new Set(request.evidenceIds)],
          now,
        });
        if (resolving) {
          await repository.resolveOpenReportsForCase(executor, {
            caseId: found.id,
            now,
            state: enforcing ? 'actioned' : 'dismissed',
          });
        }
        return {
          decision: {
            ...decisionRecord(decision),
            evidenceIds: cited.map((row) => row.id).sort(),
          },
          kind: 'recorded',
        };
      })
      .catch((error: unknown) => {
        if (error instanceof EnforcementNotApplicable) {
          return { kind: 'not_applicable' } as const;
        }
        if (error instanceof DecisionRefused) return { kind: error.outcome };
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
   * Whether the request is a decision this vocabulary can express at all.
   *
   * Checked before anything is written, and checked against the same maps the
   * schema's constraints are built from, so a request that the database would
   * refuse is refused here with a reason rather than as a constraint violation.
   */
  private isExpressible(request: CaseDecisionRequest, now: Date): boolean {
    const permitted = scopesForDecision(request.action);
    if (request.scope === undefined) {
      if (permitted.length > 0) return false;
    } else if (!permitted.includes(request.scope)) {
      return false;
    }
    if (
      (request.action === 'temporary_hold') !==
      (request.expiresAt !== undefined)
    ) {
      return false;
    }
    if (request.expiresAt !== undefined && request.expiresAt <= now) {
      return false;
    }
    if ((request.action === 'escalate') !== (request.priority !== undefined)) {
      return false;
    }
    if (
      (request.scope === 'conversation_closure') !==
      (request.targetConversationId !== undefined)
    ) {
      return false;
    }
    if (!enforcingDecisionActions.includes(request.action)) return true;
    // Anything consequential cites something. A restriction imposed on nobody's
    // stated grounds is exactly the decision this table exists to prevent. And
    // it carries a finding rather than one of the reasons a review has when it
    // found nothing, because a restriction imposed for `no_violation_found`
    // would be a record that contradicts itself.
    return request.evidenceIds.length > 0 && isFinding(request.reasonCode);
  }

  /**
   * Moves the case to where this decision leaves it, against the version read.
   *
   * A settlement takes an open case out of the queue. An escalation leaves it
   * where it is and records the reviewer's urgency. A correction touches
   * nothing, because the case has already left the queue and its version is
   * therefore stable — but the version is still compared, so a correction
   * written against a stale read is refused rather than applied.
   */
  private async positionCase(
    executor: TransactionHandle,
    input: {
      readonly correcting: boolean;
      readonly expectedVersion: number;
      readonly found: CaseRow;
      readonly now: Date;
      readonly priority: CasePriority | undefined;
      readonly resolving: boolean;
    },
  ): Promise<CaseRow | undefined> {
    const { repository } = this.dependencies;
    const current = await repository.findCase(executor, input.found.id);
    if (current?.version !== input.expectedVersion) return undefined;
    if (resolvedCaseStates.includes(current.state)) {
      // A case that has left the queue is decided again only by correcting the
      // decision that took it out. A fresh decision on one is a reviewer acting
      // on a case somebody else already finished.
      return input.correcting ? current : undefined;
    }
    return repository.transitionCase(executor, {
      caseId: current.id,
      expectedVersion: input.expectedVersion,
      now: input.now,
      priority: input.priority,
      state: input.resolving ? 'decided' : current.state,
    });
  }

  /**
   * Records the enforcement, then applies it through the owning domain.
   *
   * The record is taken first because the authority takes the subject lock, and
   * the ordering rule in `src/database/subject-lock.ts` is that the advisory
   * lock precedes every row lock. Applying first would take a row lock on
   * `users_accounts` before the subject lock and put a cycle in the lock graph.
   *
   * What the platform cannot carry out, it does not record. Creator scopes are
   * absent because this seam holds no contract that changes a creator's state —
   * those are Platform Admin's operations — and a lift of a conversation
   * closure is absent because MESSAGING publishes no way to reopen one.
   */
  private async enforce(
    executor: TransactionHandle,
    input: {
      readonly found: CaseRow;
      readonly now: Date;
      readonly request: CaseDecisionRequest;
    },
  ): Promise<EnforcementEffect> {
    const { request } = input;
    const scope = request.scope;
    if (scope === undefined) throw new EnforcementNotApplicable();
    // The subject of an account or conversation restriction is a consumer
    // account, and the only case whose target is one is a case about one.
    // Deriving the subject rather than accepting it is what stops a decision on
    // one case restricting somebody the case was never about.
    if (input.found.targetType !== 'consumer_account') {
      throw new EnforcementNotApplicable();
    }
    if (scope !== 'account_restriction' && scope !== 'conversation_closure') {
      throw new EnforcementNotApplicable();
    }
    if (scope === 'conversation_closure') {
      const named = await this.dependencies.repository.caseNamesConversation(
        executor,
        {
          caseId: input.found.id,
          conversationId: request.targetConversationId ?? '',
        },
      );
      // A closure of a conversation no report in this case named would be a
      // decision about two people nobody complained about.
      if (!named) throw new EnforcementNotApplicable();
    }

    // Narrowed rather than asserted: `isExpressible` already refused an
    // enforcing action carrying a reason that is not a finding.
    if (!isFinding(request.reasonCode)) throw new EnforcementNotApplicable();
    const identity = {
      actorReference: request.actorReference,
      reasonCode: request.reasonCode,
      scope,
      subjectId: input.found.targetId,
      targetConversationId: request.targetConversationId,
    };

    if (request.action === 'revoke_restriction') {
      const lifted = await this.dependencies.authority.lift(executor, identity);
      if (lifted.kind !== 'recorded') throw new EnforcementNotApplicable();
      const restored = await this.dependencies.accounts.restore({
        executor,
        now: input.now,
        userId: input.found.targetId,
      });
      // A reversal the owning domain will not apply is a reversal that never
      // happened, so the whole decision goes.
      if (restored === undefined) throw new EnforcementNotApplicable();
      return {
        enforcementId: lifted.enforcement.id,
        priorState: 'restricted',
        resultingState: 'unrestricted',
      };
    }

    const imposed = await this.dependencies.authority.impose(executor, {
      ...identity,
      expiresAt: request.expiresAt,
    });
    if (imposed.kind !== 'recorded' && imposed.kind !== 'already_in_force') {
      throw new EnforcementNotApplicable();
    }
    const applied =
      scope === 'account_restriction'
        ? (await this.dependencies.accounts.restrict({
            executor,
            now: input.now,
            userId: input.found.targetId,
          })) !== undefined
        : await this.dependencies.conversations.close({
            conversationId: request.targetConversationId ?? '',
            executor,
            now: input.now,
          });
    if (!applied) throw new EnforcementNotApplicable();
    return {
      enforcementId: imposed.enforcement.id,
      // Imposing what already stands is the same decision, and saying the
      // subject was unrestricted beforehand would be a claim about a state
      // nobody observed.
      priorState: imposed.kind === 'recorded' ? 'unrestricted' : 'restricted',
      resultingState: 'restricted',
    };
  }

  /**
   * The columns an evidence row takes, or nothing when the reference is not
   * something this case is about.
   */
  private async evidenceValues(
    found: CaseRow,
    evidence: EvidenceRequest,
  ): Promise<
    | {
        readonly externalReference: string | null;
        readonly kind: EvidenceKind;
        readonly note: string | null;
        readonly observedAt: Date | null;
        readonly referenceId: string | null;
        readonly referenceType: EvidenceReferenceType | null;
        readonly stateLabel: string | null;
      }
    | undefined
  > {
    const { repository } = this.dependencies;
    const executor = repository.transactionless;
    const blank = {
      externalReference: null,
      note: null,
      observedAt: null,
      referenceId: null,
      referenceType: null,
      stateLabel: null,
    };
    switch (evidence.kind) {
      case 'report': {
        const report = await repository.findReportInCase(executor, {
          caseId: found.id,
          reportId: evidence.reportId,
        });
        if (report === undefined) return undefined;
        return {
          ...blank,
          kind: 'report',
          referenceId: report.id,
          referenceType: 'safety_report',
        };
      }
      case 'message_reference': {
        const named = await repository.caseNamesMessage(executor, {
          caseId: found.id,
          messageId: evidence.messageId,
        });
        if (!named) return undefined;
        return {
          ...blank,
          kind: 'message_reference',
          referenceId: evidence.messageId,
          referenceType: 'message',
        };
      }
      case 'creator_content_reference': {
        if (
          found.targetType !== 'creator_content' ||
          found.targetId !== evidence.contentId
        ) {
          return undefined;
        }
        return {
          ...blank,
          kind: 'creator_content_reference',
          referenceId: evidence.contentId,
          referenceType: 'creator_content',
        };
      }
      case 'club_reference': {
        if (found.targetType !== 'club' || found.targetId !== evidence.clubId) {
          return undefined;
        }
        return {
          ...blank,
          kind: 'club_reference',
          referenceId: evidence.clubId,
          referenceType: 'club',
        };
      }
      case 'creator_profile_state': {
        if (
          found.targetType !== 'creator_profile' ||
          found.targetId !== evidence.creatorId ||
          !isStateLabel(evidence.stateLabel)
        ) {
          return undefined;
        }
        return {
          ...blank,
          kind: 'creator_profile_state',
          observedAt: evidence.observedAt,
          referenceId: evidence.creatorId,
          referenceType: 'creator_profile',
          stateLabel: evidence.stateLabel,
        };
      }
      case 'operator_note': {
        if (
          evidence.note.length === 0 ||
          evidence.note.length > maximumOperatorNoteCharacters
        ) {
          return undefined;
        }
        return { ...blank, kind: 'operator_note', note: evidence.note };
      }
      case 'system_fact': {
        if (!isStateLabel(evidence.stateLabel)) return undefined;
        return {
          ...blank,
          kind: 'system_fact',
          observedAt: evidence.observedAt,
          stateLabel: evidence.stateLabel,
        };
      }
      case 'consent_evidence_reference': {
        // Citable only when it exists, and it can only exist if an approved
        // verifier captured it under approved wording. No flag guards this:
        // in a deployed environment there is simply nothing to name.
        if (found.targetType !== 'creator_content') return undefined;
        const record = await repository.findConsentRecord(
          executor,
          evidence.consentRecordId,
        );
        if (record?.contentId !== found.targetId) return undefined;
        return {
          ...blank,
          kind: 'consent_evidence_reference',
          referenceId: record.id,
          referenceType: 'consent_record',
        };
      }
      default: {
        // Consent and external verification are refused above, before a case is
        // even read. Reaching here would mean the unavailable set and this
        // switch disagreed, which a unit assertion keeps from happening.
        return undefined;
      }
    }
  }

  /**
   * Decisions with the evidence each cited, in one query for the whole page.
   *
   * A read per decision would turn a reviewer opening a long case history into
   * a query storm, which is the shape `docs/architecture` keeps out of every
   * other list in this domain.
   */
  private async decisionViews(
    rows: readonly DecisionRow[],
  ): Promise<readonly ModerationDecisionView[]> {
    const cited =
      await this.dependencies.repository.listEvidenceIdsForDecisions(
        this.dependencies.repository.transactionless,
        rows.map((row) => row.id),
      );
    return rows.map((row) => ({
      ...decisionRecord(row),
      evidenceIds: cited.get(row.id) ?? [],
    }));
  }
}

/** Rolls the decision back when the enforcement could not take effect. */
class EnforcementNotApplicable extends Error {
  constructor() {
    super('Enforcement was not applicable to the subject');
    this.name = 'EnforcementNotApplicable';
  }
}

/**
 * Refusal as a rollback.
 *
 * Every refusal a decision can reach is discovered after something has been
 * written — the case moved, or an enforcement was recorded and applied — so
 * returning it from inside the transaction would commit exactly the half-done
 * state the transaction exists to prevent. Throwing is how the refusal reaches
 * the boundary.
 */
class DecisionRefused extends Error {
  constructor(readonly outcome: 'conflict' | 'invalid_decision') {
    super(`Decision refused: ${outcome}`);
    this.name = 'DecisionRefused';
  }
}

const stateLabel = new RegExp(evidenceStateLabelPattern, 'u');

function isStateLabel(value: string): boolean {
  return stateLabel.test(value);
}

/** Whether a decision's reason is one of the findings an enforcement records. */
function isFinding(
  reasonCode: DecisionReasonCode,
): reasonCode is EnforcementReasonCode {
  return (enforcementReasonCodes as readonly string[]).includes(reasonCode);
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

function evidenceView(row: EvidenceRow): ModerationEvidenceView {
  return {
    actorReference: row.actorReference,
    caseId: row.caseId,
    externalReference: row.externalReference,
    id: row.id,
    kind: row.kind,
    note: row.note,
    observedAt: row.observedAt,
    policyVersion: row.policyVersion,
    recordedAt: row.recordedAt,
    referenceId: row.referenceId,
    referenceType: row.referenceType,
    stateLabel: row.stateLabel,
  };
}

function decisionRecord(
  row: DecisionRow,
): Omit<ModerationDecisionView, 'evidenceIds'> {
  return {
    action: row.action,
    actorReference: row.actorReference,
    caseId: row.caseId,
    decidedAt: row.decidedAt,
    enforcementId: row.enforcementId,
    expiresAt: row.expiresAt,
    id: row.id,
    policyVersion: row.policyVersion,
    priorState: row.priorState,
    reasonCode: row.reasonCode,
    resultingState: row.resultingState,
    scope: row.scope,
    subjectId: row.subjectId,
    supersedesId: row.supersedesId,
    targetType: row.targetType,
  };
}
