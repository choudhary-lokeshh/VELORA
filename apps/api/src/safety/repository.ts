import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import type { CaseCursor } from './cursor.js';
import {
  maximumConsentRecordsPerContent,
  openAppealStates,
  maximumDepictedPersonPageSize,
  openCaseStates,
  openReportStates,
  openTakedownStates,
  resolvedCaseStates,
  type AppealState,
  type AppellantKind,
  type CasePriority,
  type CaseQueue,
  type CaseState,
  type ConsentDisposition,
  type ConsentScope,
  type ContentClassification,
  type DecisionAction,
  type DecisionSubjectState,
  type DepictedPersonEvidenceState,
  type DepictionDeclaration,
  type EnforcementDisposition,
  type EnforcementObjectType,
  type EnforcementScope,
  type EvidenceKind,
  type EvidenceReferenceType,
  type ReportSourceSurface,
  type ReportTargetType,
  type TakedownClaimantKind,
  type TakedownReasonCode,
  type TakedownState,
  type TakedownUrgency,
} from './policy.js';
import {
  safetyAppeals,
  safetyBlocks,
  safetyCases,
  safetyConsentRecords,
  safetyContentClassifications,
  safetyContentDepictions,
  safetyDecisionEvidence,
  safetyDecisions,
  safetyDepictedParticipants,
  safetyEnforcements,
  safetyEvidence,
  safetyReports,
  safetyTakedownClaims,
} from './schema.js';

export type BlockRow = typeof safetyBlocks.$inferSelect;
export type CaseRow = typeof safetyCases.$inferSelect;
export type ReportRow = typeof safetyReports.$inferSelect;
export type EnforcementRow = typeof safetyEnforcements.$inferSelect;
export type EvidenceRow = typeof safetyEvidence.$inferSelect;
export type DecisionRow = typeof safetyDecisions.$inferSelect;
export type DepictionRow = typeof safetyContentDepictions.$inferSelect;
export type DepictedParticipantRow =
  typeof safetyDepictedParticipants.$inferSelect;
export type ConsentRecordRow = typeof safetyConsentRecords.$inferSelect;
export type ClassificationRow =
  typeof safetyContentClassifications.$inferSelect;
export type TakedownClaimRow = typeof safetyTakedownClaims.$inferSelect;
export type AppealRow = typeof safetyAppeals.$inferSelect;

/**
 * Every TRUST & SAFETY read and write.
 *
 * Nothing here touches another domain's tables. What a block means for
 * discovery, messaging, or notifications is decided by those domains asking
 * this one through its published contract.
 */
export class SafetyRepository {
  constructor(private readonly database: DatabaseHandle) {}

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Records a block, or reports that the same one is already live.
   *
   * The partial unique index decides, not a prior read, so two simultaneous
   * blocks of the same person produce one live record and the caller of the
   * loser still gets a successful, idempotent answer.
   */
  async insertBlock(
    executor: Executor,
    input: {
      readonly blockedId: string;
      readonly blockerId: string;
      readonly now: Date;
    },
  ): Promise<BlockRow | undefined> {
    const inserted = await executor
      .insert(safetyBlocks)
      .values({
        blockedId: input.blockedId,
        blockerId: input.blockerId,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findLiveBlock(
    executor: Executor,
    input: { readonly blockedId: string; readonly blockerId: string },
  ): Promise<BlockRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyBlocks)
      .where(
        and(
          eq(safetyBlocks.blockerId, input.blockerId),
          eq(safetyBlocks.blockedId, input.blockedId),
          isNull(safetyBlocks.revokedAt),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** Withdraws the caller's own block. The record of it stays. */
  async revokeBlock(
    executor: Executor,
    input: {
      readonly blockedId: string;
      readonly blockerId: string;
      readonly now: Date;
    },
  ): Promise<BlockRow | undefined> {
    const updated = await executor
      .update(safetyBlocks)
      .set({ revokedAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(safetyBlocks.blockerId, input.blockerId),
          eq(safetyBlocks.blockedId, input.blockedId),
          isNull(safetyBlocks.revokedAt),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Whether a live block stands between two people, in either direction.
   *
   * The record is directional and the effect is not: if either person has
   * blocked the other, neither may interact with the other. Asking in one
   * statement rather than twice keeps the answer atomic with respect to the
   * transaction it is asked in.
   */
  async isPairBlocked(
    executor: Executor,
    input: { readonly first: string; readonly second: string },
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: safetyBlocks.id })
      .from(safetyBlocks)
      .where(
        and(
          or(
            and(
              eq(safetyBlocks.blockerId, input.first),
              eq(safetyBlocks.blockedId, input.second),
            ),
            and(
              eq(safetyBlocks.blockerId, input.second),
              eq(safetyBlocks.blockedId, input.first),
            ),
          ),
          isNull(safetyBlocks.revokedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Which of these candidates the viewer may not interact with.
   *
   * Asked about a bounded batch for the same reason discovery's suppression is:
   * "everybody this account has ever blocked or been blocked by" grows for the
   * life of the account, and making that an input to a feed query would make the
   * number of a person's safety relationships a correctness question.
   */
  async blockedAmong(
    executor: Executor,
    input: {
      readonly candidateIds: readonly string[];
      readonly viewerId: string;
    },
  ): Promise<ReadonlySet<string>> {
    if (input.candidateIds.length === 0) return new Set();
    const others = [...input.candidateIds];
    const rows = await executor
      .select({
        blockedId: safetyBlocks.blockedId,
        blockerId: safetyBlocks.blockerId,
      })
      .from(safetyBlocks)
      .where(
        and(
          or(
            and(
              eq(safetyBlocks.blockerId, input.viewerId),
              inArray(safetyBlocks.blockedId, others),
            ),
            and(
              eq(safetyBlocks.blockedId, input.viewerId),
              inArray(safetyBlocks.blockerId, others),
            ),
          ),
          isNull(safetyBlocks.revokedAt),
        ),
      );
    return new Set(
      rows.map((row) =>
        row.blockerId === input.viewerId ? row.blockedId : row.blockerId,
      ),
    );
  }

  /** The caller's own live blocks, newest first. */
  async listBlocks(
    executor: Executor,
    input: {
      readonly before:
        { readonly createdAt: Date; readonly id: number } | undefined;
      readonly blockerId: string;
      readonly limit: number;
    },
  ): Promise<BlockRow[]> {
    const position =
      input.before === undefined
        ? undefined
        : or(
            lt(safetyBlocks.createdAt, input.before.createdAt),
            and(
              eq(safetyBlocks.createdAt, input.before.createdAt),
              lt(safetyBlocks.id, input.before.id),
            ),
          );
    return executor
      .select()
      .from(safetyBlocks)
      .where(
        and(
          eq(safetyBlocks.blockerId, input.blockerId),
          isNull(safetyBlocks.revokedAt),
          position,
        ),
      )
      .orderBy(desc(safetyBlocks.createdAt), desc(safetyBlocks.id))
      .limit(input.limit);
  }

  /**
   * Records a report, or returns nothing when this reporter already used that
   * client identifier. The unique index decides, so a retry cannot become a
   * second report.
   */
  async insertReport(
    executor: Executor,
    input: {
      readonly caseId: string;
      readonly clientReportId: string;
      readonly conversationId: string | null;
      readonly detail: string | null;
      readonly messageId: string | null;
      readonly now: Date;
      readonly policyVersion: string;
      readonly reasonCode: string;
      readonly reporterId: string;
      readonly sourceSurface: ReportSourceSurface;
      readonly subjectId: string;
      readonly targetType: ReportTargetType;
    },
  ): Promise<ReportRow | undefined> {
    const inserted = await executor
      .insert(safetyReports)
      .values({
        caseId: input.caseId,
        clientReportId: input.clientReportId,
        conversationId: input.conversationId,
        createdAt: input.now,
        detail: input.detail,
        id: crypto.randomUUID(),
        messageId: input.messageId,
        policyVersion: input.policyVersion,
        reasonCode: input.reasonCode,
        reporterId: input.reporterId,
        sourceSurface: input.sourceSurface,
        state: 'received',
        subjectId: input.subjectId,
        targetType: input.targetType,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /**
   * The open case for a target, if there is one.
   *
   * A new report joins it rather than opening a second case beside it, which is
   * what makes several reports about one thing a single review without any of
   * them being discarded.
   */
  async findOpenCaseForTarget(
    executor: Executor,
    input: {
      readonly targetId: string;
      readonly targetType: ReportTargetType;
    },
  ): Promise<CaseRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyCases)
      .where(
        and(
          eq(safetyCases.targetType, input.targetType),
          eq(safetyCases.targetId, input.targetId),
          inArray(safetyCases.state, [...openCaseStates]),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Opens a case, or reports that one is already open for the target.
   *
   * The partial unique index decides rather than a prior read, so two reports
   * arriving together produce one case and the loser is handed the winner's.
   */
  async insertCase(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly policyVersion: string;
      readonly priority: CasePriority;
      readonly queue: CaseQueue;
      readonly targetId: string;
      readonly targetType: ReportTargetType;
    },
  ): Promise<CaseRow | undefined> {
    const inserted = await executor
      .insert(safetyCases)
      .values({
        id: crypto.randomUUID(),
        openedAt: input.now,
        policyVersion: input.policyVersion,
        priority: input.priority,
        queue: input.queue,
        state: 'new',
        targetId: input.targetId,
        targetType: input.targetType,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findCase(executor: Executor, id: string): Promise<CaseRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyCases)
      .where(eq(safetyCases.id, id))
      .limit(1);
    return rows[0];
  }

  /** The queue: open cases, oldest first, bounded and keyset paged. */
  async listCases(
    executor: Executor,
    input: {
      readonly after: CaseCursor | undefined;
      readonly limit: number;
      readonly queue: CaseQueue | undefined;
      readonly states: readonly CaseState[];
    },
  ): Promise<CaseRow[]> {
    const position =
      input.after === undefined
        ? undefined
        : or(
            gt(safetyCases.openedAt, input.after.openedAt),
            and(
              eq(safetyCases.openedAt, input.after.openedAt),
              gt(safetyCases.id, input.after.id),
            ),
          );
    return executor
      .select()
      .from(safetyCases)
      .where(
        and(
          inArray(safetyCases.state, [...input.states]),
          input.queue === undefined
            ? undefined
            : eq(safetyCases.queue, input.queue),
          position,
        ),
      )
      .orderBy(asc(safetyCases.openedAt), asc(safetyCases.id))
      .limit(input.limit);
  }

  /**
   * Claims a case for a reviewer, against the version they read.
   *
   * The predicate also refuses a case somebody else currently holds, so a claim
   * is not a way to take a review out from under whoever is doing it. A lapsed
   * lease is claimable again, which is what stops a reviewer who disappeared
   * from holding a case for ever.
   */
  async claimCase(
    executor: Executor,
    input: {
      readonly actorReference: string;
      readonly caseId: string;
      readonly expectedVersion: number;
      readonly expiresAt: Date;
      readonly now: Date;
    },
  ): Promise<CaseRow | undefined> {
    const updated = await executor
      .update(safetyCases)
      .set({
        assignedActorReference: input.actorReference,
        assignedAt: input.now,
        assignmentExpiresAt: input.expiresAt,
        updatedAt: input.now,
        version: sql`${safetyCases.version} + 1`,
      })
      .where(
        and(
          eq(safetyCases.id, input.caseId),
          eq(safetyCases.version, input.expectedVersion),
          inArray(safetyCases.state, [...openCaseStates]),
          or(
            isNull(safetyCases.assignmentExpiresAt),
            lte(safetyCases.assignmentExpiresAt, input.now),
            eq(safetyCases.assignedActorReference, input.actorReference),
          ),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Moves a case, and optionally its priority, against the version read.
   *
   * Only ever from an open state. A case that has already left the queue —
   * decided or closed — is not moved again, so a reviewer working from a stale
   * read loses to whoever resolved it rather than reopening their decision.
   *
   * Leaving the queue releases the claim and stamps the moment. A case somebody
   * still held could not be worked on and could not be reclaimed, and a
   * resolved case with no moment would be a review with no end.
   */
  async transitionCase(
    executor: Executor,
    input: {
      readonly caseId: string;
      readonly expectedVersion: number;
      readonly now: Date;
      readonly priority?: CasePriority | undefined;
      readonly state: CaseState;
    },
  ): Promise<CaseRow | undefined> {
    const resolving = resolvedCaseStates.includes(input.state);
    const updated = await executor
      .update(safetyCases)
      .set({
        ...(resolving
          ? {
              assignedActorReference: null,
              assignedAt: null,
              assignmentExpiresAt: null,
              closedAt: input.now,
            }
          : {}),
        ...(input.priority === undefined ? {} : { priority: input.priority }),
        state: input.state,
        updatedAt: input.now,
        version: sql`${safetyCases.version} + 1`,
      })
      .where(
        and(
          eq(safetyCases.id, input.caseId),
          eq(safetyCases.version, input.expectedVersion),
          inArray(safetyCases.state, [...openCaseStates]),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Every report a case carries, oldest first. Evidence, never a count. */
  async listReportsForCase(
    executor: Executor,
    input: { readonly caseId: string; readonly limit: number },
  ): Promise<ReportRow[]> {
    return executor
      .select()
      .from(safetyReports)
      .where(eq(safetyReports.caseId, input.caseId))
      .orderBy(asc(safetyReports.createdAt), asc(safetyReports.id))
      .limit(input.limit);
  }

  async findReportByClientId(
    executor: Executor,
    input: { readonly clientReportId: string; readonly reporterId: string },
  ): Promise<ReportRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.reporterId, input.reporterId),
          eq(safetyReports.clientReportId, input.clientReportId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * How many reports this account has filed since a moment.
   *
   * Used to bound submission volume. It never removes or refuses to store a
   * report already made: a discarded report is destroyed evidence.
   */
  async countReportsSince(
    executor: Executor,
    input: { readonly reporterId: string; readonly since: Date },
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.reporterId, input.reporterId),
          gt(safetyReports.createdAt, input.since),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /** The caller's own reports, newest first. Never anybody else's. */
  async listReportsBy(
    executor: Executor,
    input: {
      readonly before:
        { readonly createdAt: Date; readonly id: string } | undefined;
      readonly limit: number;
      readonly reporterId: string;
    },
  ): Promise<ReportRow[]> {
    const position =
      input.before === undefined
        ? undefined
        : or(
            lt(safetyReports.createdAt, input.before.createdAt),
            and(
              eq(safetyReports.createdAt, input.before.createdAt),
              lt(safetyReports.id, input.before.id),
            ),
          );
    return executor
      .select()
      .from(safetyReports)
      .where(and(eq(safetyReports.reporterId, input.reporterId), position))
      .orderBy(desc(safetyReports.createdAt), desc(safetyReports.id))
      .limit(input.limit);
  }

  /** The moderation queue: unresolved reports, oldest first. */
  async listOpenReports(
    executor: Executor,
    limit: number,
  ): Promise<ReportRow[]> {
    return executor
      .select()
      .from(safetyReports)
      .where(inArray(safetyReports.state, [...openReportStates]))
      .orderBy(asc(safetyReports.createdAt), asc(safetyReports.id))
      .limit(limit);
  }

  async findReport(
    executor: Executor,
    id: string,
  ): Promise<ReportRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyReports)
      .where(eq(safetyReports.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Moves a report along its lifecycle. Compare-and-set on the version, so two
   * reviewers acting at once produce one transition and the loser is told.
   */
  async transitionReport(
    executor: Executor,
    input: {
      readonly expectedVersion: number;
      readonly id: string;
      readonly now: Date;
      readonly resolved: boolean;
      readonly state: string;
    },
  ): Promise<ReportRow | undefined> {
    const updated = await executor
      .update(safetyReports)
      .set({
        resolvedAt: input.resolved ? input.now : null,
        state: input.state,
        updatedAt: input.now,
        version: sql`${safetyReports.version} + 1`,
      })
      .where(
        and(
          eq(safetyReports.id, input.id),
          eq(safetyReports.version, input.expectedVersion),
          inArray(safetyReports.state, [...openReportStates]),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Resolves every still-open report a case carries, in one statement.
   *
   * Called only from inside a decision, which holds the subject lock and has
   * already won the case's compare-and-set, so there is no second writer to
   * lose a version race against. Reports that were already resolved are left
   * exactly as they were: a report decided under an earlier case is not
   * re-decided because a later one reached a different conclusion.
   */
  async resolveOpenReportsForCase(
    executor: Executor,
    input: {
      readonly caseId: string;
      readonly now: Date;
      readonly state: 'actioned' | 'dismissed';
    },
  ): Promise<ReportRow[]> {
    return executor
      .update(safetyReports)
      .set({
        resolvedAt: input.now,
        state: input.state,
        updatedAt: input.now,
        version: sql`${safetyReports.version} + 1`,
      })
      .where(
        and(
          eq(safetyReports.caseId, input.caseId),
          inArray(safetyReports.state, [...openReportStates]),
        ),
      )
      .returning();
  }

  /** One report, but only if it is evidence in the case named. */
  async findReportInCase(
    executor: Executor,
    input: { readonly caseId: string; readonly reportId: string },
  ): Promise<ReportRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.id, input.reportId),
          eq(safetyReports.caseId, input.caseId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Whether a report in this case named this conversation or message.
   *
   * The question a piece of message evidence has to answer before it may be
   * recorded. SAFETY cannot ask MESSAGING whether a message exists without
   * being handed a way to probe for other people's messages, and it does not
   * need to: what makes a message citable is that somebody reported it, and
   * that fact is already in this domain.
   */
  async caseNamesConversation(
    executor: Executor,
    input: { readonly caseId: string; readonly conversationId: string },
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: safetyReports.id })
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.caseId, input.caseId),
          eq(safetyReports.conversationId, input.conversationId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async caseNamesMessage(
    executor: Executor,
    input: { readonly caseId: string; readonly messageId: string },
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: safetyReports.id })
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.caseId, input.caseId),
          eq(safetyReports.messageId, input.messageId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Appends evidence to a case. Nothing here is ever updated or removed. */
  async insertEvidence(
    executor: Executor,
    input: {
      readonly actorReference: string | null;
      readonly caseId: string;
      readonly externalReference: string | null;
      readonly kind: EvidenceKind;
      readonly note: string | null;
      readonly now: Date;
      readonly observedAt: Date | null;
      readonly policyVersion: string;
      readonly referenceId: string | null;
      readonly referenceType: EvidenceReferenceType | null;
      readonly stateLabel: string | null;
    },
  ): Promise<EvidenceRow> {
    const rows = await executor
      .insert(safetyEvidence)
      .values({
        actorReference: input.actorReference,
        caseId: input.caseId,
        externalReference: input.externalReference,
        id: crypto.randomUUID(),
        kind: input.kind,
        note: input.note,
        observedAt: input.observedAt,
        policyVersion: input.policyVersion,
        recordedAt: input.now,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
        stateLabel: input.stateLabel,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error('Evidence insert returned no row');
    return row;
  }

  /** A case's evidence, oldest first. Bounded, like every read here. */
  async listEvidenceForCase(
    executor: Executor,
    input: { readonly caseId: string; readonly limit: number },
  ): Promise<EvidenceRow[]> {
    return executor
      .select()
      .from(safetyEvidence)
      .where(eq(safetyEvidence.caseId, input.caseId))
      .orderBy(asc(safetyEvidence.recordedAt), asc(safetyEvidence.id))
      .limit(input.limit);
  }

  /**
   * The named evidence, and only what genuinely belongs to the case.
   *
   * A decision cites evidence by identifier, and a citation of something from
   * another case is refused rather than silently dropped: the caller compares
   * what it asked for against what came back.
   */
  async listEvidenceInCase(
    executor: Executor,
    input: {
      readonly caseId: string;
      readonly evidenceIds: readonly string[];
    },
  ): Promise<EvidenceRow[]> {
    if (input.evidenceIds.length === 0) return [];
    return executor
      .select()
      .from(safetyEvidence)
      .where(
        and(
          eq(safetyEvidence.caseId, input.caseId),
          inArray(safetyEvidence.id, [...input.evidenceIds]),
        ),
      );
  }

  /**
   * Appends a decision, or reports that the database refused it.
   *
   * Nothing is returned when a partial unique index rejected the write: either
   * this case already has a resolving decision, or the record this one claims
   * to correct has already been corrected. Both are somebody else having
   * decided first, and both are the caller's `conflict`.
   */
  async insertDecision(
    executor: Executor,
    input: {
      readonly action: DecisionAction;
      readonly actorReference: string;
      readonly caseId: string;
      readonly enforcementId: string | null;
      readonly expiresAt: Date | null;
      readonly now: Date;
      readonly policyVersion: string;
      readonly priorState: DecisionSubjectState | null;
      readonly reasonCode: string;
      readonly resultingState: DecisionSubjectState | null;
      readonly scope: EnforcementScope | null;
      readonly subjectId: string;
      readonly supersedesId: string | null;
      readonly targetType: ReportTargetType;
    },
  ): Promise<DecisionRow | undefined> {
    const rows = await executor
      .insert(safetyDecisions)
      .values({
        action: input.action,
        actorReference: input.actorReference,
        caseId: input.caseId,
        decidedAt: input.now,
        enforcementId: input.enforcementId,
        expiresAt: input.expiresAt,
        id: crypto.randomUUID(),
        policyVersion: input.policyVersion,
        priorState: input.priorState,
        reasonCode: input.reasonCode,
        resultingState: input.resultingState,
        scope: input.scope,
        subjectId: input.subjectId,
        supersedesId: input.supersedesId,
        targetType: input.targetType,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0];
  }

  /** Records which evidence a decision rested on. */
  async linkDecisionEvidence(
    executor: Executor,
    input: {
      readonly caseId: string;
      readonly decisionId: string;
      readonly evidenceIds: readonly string[];
      readonly now: Date;
    },
  ): Promise<void> {
    if (input.evidenceIds.length === 0) return;
    await executor.insert(safetyDecisionEvidence).values(
      input.evidenceIds.map((evidenceId) => ({
        caseId: input.caseId,
        decisionId: input.decisionId,
        evidenceId,
        recordedAt: input.now,
      })),
    );
  }

  async findDecision(
    executor: Executor,
    id: string,
  ): Promise<DecisionRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyDecisions)
      .where(eq(safetyDecisions.id, id))
      .limit(1);
    return rows[0];
  }

  /** A case's decisions, oldest first. History, never a single answer. */
  async listDecisionsForCase(
    executor: Executor,
    input: { readonly caseId: string; readonly limit: number },
  ): Promise<DecisionRow[]> {
    return executor
      .select()
      .from(safetyDecisions)
      .where(eq(safetyDecisions.caseId, input.caseId))
      .orderBy(asc(safetyDecisions.decidedAt), asc(safetyDecisions.id))
      .limit(input.limit);
  }

  /**
   * The evidence each of these decisions cited.
   *
   * Asked about the whole page at once rather than per decision, because a case
   * with a long history would otherwise cost one query per record — the shape
   * that turns a reviewer opening a case into a query storm.
   */
  async listEvidenceIdsForDecisions(
    executor: Executor,
    decisionIds: readonly string[],
  ): Promise<ReadonlyMap<string, string[]>> {
    const cited = new Map<string, string[]>();
    if (decisionIds.length === 0) return cited;
    const rows = await executor
      .select({
        decisionId: safetyDecisionEvidence.decisionId,
        evidenceId: safetyDecisionEvidence.evidenceId,
      })
      .from(safetyDecisionEvidence)
      .where(inArray(safetyDecisionEvidence.decisionId, [...decisionIds]))
      .orderBy(
        asc(safetyDecisionEvidence.decisionId),
        asc(safetyDecisionEvidence.evidenceId),
      );
    for (const row of rows) {
      const existing = cited.get(row.decisionId);
      if (existing === undefined) cited.set(row.decisionId, [row.evidenceId]);
      else existing.push(row.evidenceId);
    }
    return cited;
  }

  /** Appends an enforcement record. Nothing here is ever updated. */
  async insertEnforcement(
    executor: Executor,
    input: {
      readonly actorReference: string;
      readonly disposition: EnforcementDisposition;
      readonly effectiveAt: Date;
      /** When a time-bounded restriction stops on its own. */
      readonly expiresAt?: Date | null;
      readonly now: Date;
      readonly policyVersion: string;
      readonly reasonCode: string;
      /** The report a decision named, where a decision named one. */
      readonly reportId: string | null;
      readonly scope: string;
      readonly subjectId: string;
      /** The record this one replaces. Required of every lift. */
      readonly supersedesId?: string | null;
      readonly targetConversationId: string | null;
      /** What a creator-scoped enforcement acted on, when it acted on one. */
      readonly targetObjectId?: string | null;
      readonly targetObjectType?: EnforcementObjectType | null;
    },
  ): Promise<EnforcementRow> {
    const rows = await executor
      .insert(safetyEnforcements)
      .values({
        actorReference: input.actorReference,
        createdAt: input.now,
        disposition: input.disposition,
        effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt ?? null,
        id: crypto.randomUUID(),
        policyVersion: input.policyVersion,
        reasonCode: input.reasonCode,
        reportId: input.reportId,
        scope: input.scope,
        subjectId: input.subjectId,
        supersedesId: input.supersedesId ?? null,
        targetConversationId: input.targetConversationId,
        targetObjectId: input.targetObjectId ?? null,
        targetObjectType: input.targetObjectType ?? null,
      })
      .returning();
    const row = rows[0];
    if (row === undefined)
      throw new Error('Enforcement insert returned no row');
    return row;
  }

  /**
   * Restrictions that are in force for this subject right now, in the scopes
   * asked about.
   *
   * "In force" is four conditions and every one of them matters: the record
   * restricts rather than lifts, it has taken effect, it has not expired, and
   * nothing supersedes it. A reader that dropped any one of them would
   * authorize against history rather than against the present.
   *
   * The anti-join is what makes a lift take effect without ever editing the
   * record it lifts, which is the property the whole table is built around.
   */
  async listLiveEnforcements(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly scopes: readonly string[];
      readonly subjectId: string;
    },
  ): Promise<EnforcementRow[]> {
    if (input.scopes.length === 0) return [];
    return executor
      .select()
      .from(safetyEnforcements)
      .where(
        and(
          eq(safetyEnforcements.subjectId, input.subjectId),
          inArray(safetyEnforcements.scope, [...input.scopes]),
          this.liveAt(input.now),
        ),
      )
      .orderBy(desc(safetyEnforcements.effectiveAt));
  }

  /** Whether one named object is currently restricted. */
  async findLiveObjectEnforcement(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly objectId: string;
      readonly objectType: EnforcementObjectType;
      readonly subjectId: string;
    },
  ): Promise<EnforcementRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyEnforcements)
      .where(
        and(
          eq(safetyEnforcements.subjectId, input.subjectId),
          eq(safetyEnforcements.targetObjectId, input.objectId),
          eq(safetyEnforcements.targetObjectType, input.objectType),
          this.liveAt(input.now),
        ),
      )
      .orderBy(desc(safetyEnforcements.effectiveAt))
      .limit(1);
    return rows[0];
  }

  async findEnforcement(
    executor: Executor,
    id: string,
  ): Promise<EnforcementRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyEnforcements)
      .where(eq(safetyEnforcements.id, id))
      .limit(1);
    return rows[0];
  }

  async listEnforcementsFor(
    executor: Executor,
    subjectId: string,
  ): Promise<EnforcementRow[]> {
    return executor
      .select()
      .from(safetyEnforcements)
      .where(eq(safetyEnforcements.subjectId, subjectId))
      .orderBy(desc(safetyEnforcements.effectiveAt));
  }

  /**
   * What a content item was declared to be, if anybody declared it.
   *
   * A missing row is not `general`. It is an item nobody has classified, and
   * the gate refuses a mature capability on one rather than inferring a class
   * from silence.
   */
  async findClassification(
    executor: Executor,
    contentId: string,
  ): Promise<ClassificationRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyContentClassifications)
      .where(eq(safetyContentClassifications.contentId, contentId))
      .limit(1);
    return rows[0];
  }

  /** Records a first classification, or nothing when somebody declared first. */
  async insertClassification(
    executor: Executor,
    input: {
      readonly classification: ContentClassification;
      readonly contentId: string;
      readonly creatorId: string;
      readonly now: Date;
      readonly policyVersion: string;
    },
  ): Promise<ClassificationRow | undefined> {
    const inserted = await executor
      .insert(safetyContentClassifications)
      .values({
        classification: input.classification,
        contentId: input.contentId,
        creatorId: input.creatorId,
        declaredAt: input.now,
        policyVersion: input.policyVersion,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /** Reclassifies, against the version the caller read. */
  async updateClassification(
    executor: Executor,
    input: {
      readonly classification: ContentClassification;
      readonly contentId: string;
      readonly expectedVersion: number;
      readonly now: Date;
    },
  ): Promise<ClassificationRow | undefined> {
    const updated = await executor
      .update(safetyContentClassifications)
      .set({
        classification: input.classification,
        updatedAt: input.now,
        version: sql`${safetyContentClassifications.version} + 1`,
      })
      .where(
        and(
          eq(safetyContentClassifications.contentId, input.contentId),
          eq(safetyContentClassifications.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * The creator's answer about who appears in a content item.
   *
   * There is no default. A missing row means nobody has been asked or nobody
   * has replied, and the gate treats that as an unanswered question rather than
   * as "nobody is depicted here".
   */
  async findDepiction(
    executor: Executor,
    contentId: string,
  ): Promise<DepictionRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyContentDepictions)
      .where(eq(safetyContentDepictions.contentId, contentId))
      .limit(1);
    return rows[0];
  }

  /** Records a first answer, or nothing when somebody answered first. */
  async insertDepiction(
    executor: Executor,
    input: {
      readonly contentId: string;
      readonly creatorId: string;
      readonly declaration: DepictionDeclaration;
      readonly now: Date;
      readonly policyVersion: string;
    },
  ): Promise<DepictionRow | undefined> {
    const inserted = await executor
      .insert(safetyContentDepictions)
      .values({
        contentId: input.contentId,
        creatorId: input.creatorId,
        declaration: input.declaration,
        declaredAt: input.now,
        policyVersion: input.policyVersion,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /** Changes the answer, against the version the caller read. */
  async updateDepiction(
    executor: Executor,
    input: {
      readonly contentId: string;
      readonly declaration: DepictionDeclaration;
      readonly expectedVersion: number;
      readonly now: Date;
    },
  ): Promise<DepictionRow | undefined> {
    const updated = await executor
      .update(safetyContentDepictions)
      .set({
        declaration: input.declaration,
        updatedAt: input.now,
        version: sql`${safetyContentDepictions.version} + 1`,
      })
      .where(
        and(
          eq(safetyContentDepictions.contentId, input.contentId),
          eq(safetyContentDepictions.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Appends a depicted-person record. Nothing here is ever updated. */
  async insertParticipant(
    executor: Executor,
    input: {
      readonly adultAssuranceEvidenceReference: string | null;
      readonly contentId: string;
      readonly creatorId: string;
      readonly evidenceState: DepictedPersonEvidenceState;
      readonly expiresAt: Date | null;
      readonly identityEvidenceReference: string | null;
      readonly now: Date;
      readonly policyVersion: string;
      readonly supersedesId: string | null;
      readonly verifiedAt: Date | null;
      readonly verifier: string | null;
      readonly verifierSubjectReference: string | null;
    },
  ): Promise<DepictedParticipantRow> {
    const rows = await executor
      .insert(safetyDepictedParticipants)
      .values({
        adultAssuranceEvidenceReference: input.adultAssuranceEvidenceReference,
        contentId: input.contentId,
        creatorId: input.creatorId,
        declaredAt: input.now,
        evidenceState: input.evidenceState,
        expiresAt: input.expiresAt,
        id: crypto.randomUUID(),
        identityEvidenceReference: input.identityEvidenceReference,
        policyVersion: input.policyVersion,
        supersedesId: input.supersedesId,
        verifiedAt: input.verifiedAt,
        verifier: input.verifier,
        verifierSubjectReference: input.verifierSubjectReference,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Depicted participant insert returned no row');
    }
    return row;
  }

  async findParticipant(
    executor: Executor,
    id: string,
  ): Promise<DepictedParticipantRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyDepictedParticipants)
      .where(eq(safetyDepictedParticipants.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Every participant record for an item, including superseded ones.
   *
   * The whole chain rather than only its tail, because the caller derives which
   * record describes a person now by seeing what nothing else replaces — a
   * property of the set, not of a row.
   */
  async listParticipants(
    executor: Executor,
    contentId: string,
  ): Promise<DepictedParticipantRow[]> {
    return executor
      .select()
      .from(safetyDepictedParticipants)
      .where(eq(safetyDepictedParticipants.contentId, contentId))
      .orderBy(
        asc(safetyDepictedParticipants.declaredAt),
        asc(safetyDepictedParticipants.id),
      )
      .limit(maximumDepictedPersonPageSize);
  }

  /**
   * How many participant records an item carries, superseded ones included.
   *
   * The cap is on what the read has to fetch rather than on how many people are
   * currently declared, because it exists to keep the gate query complete.
   */
  async countParticipants(
    executor: Executor,
    contentId: string,
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(safetyDepictedParticipants)
      .where(eq(safetyDepictedParticipants.contentId, contentId));
    return rows[0]?.total ?? 0;
  }

  async countConsentRecords(
    executor: Executor,
    contentId: string,
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(safetyConsentRecords)
      .where(eq(safetyConsentRecords.contentId, contentId));
    return rows[0]?.total ?? 0;
  }

  /** Appends a consent record. Nothing here is ever updated or removed. */
  async insertConsentRecord(
    executor: Executor,
    input: {
      readonly actorReference: string;
      readonly consentEvidenceReference: string | null;
      readonly contentId: string;
      readonly copyVersion: string;
      readonly disposition: ConsentDisposition;
      readonly expiresAt: Date | null;
      readonly now: Date;
      readonly participantId: string;
      readonly policyVersion: string;
      readonly scope: ConsentScope;
      readonly supersedesId: string | null;
    },
  ): Promise<ConsentRecordRow> {
    const rows = await executor
      .insert(safetyConsentRecords)
      .values({
        actorReference: input.actorReference,
        consentEvidenceReference: input.consentEvidenceReference,
        contentId: input.contentId,
        copyVersion: input.copyVersion,
        disposition: input.disposition,
        expiresAt: input.expiresAt,
        id: crypto.randomUUID(),
        participantId: input.participantId,
        policyVersion: input.policyVersion,
        recordedAt: input.now,
        scope: input.scope,
        supersedesId: input.supersedesId,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Consent record insert returned no row');
    }
    return row;
  }

  async findConsentRecord(
    executor: Executor,
    id: string,
  ): Promise<ConsentRecordRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyConsentRecords)
      .where(eq(safetyConsentRecords.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * Consent records for an item, optionally narrowed to one scope.
   *
   * Grants and withdrawals together, because which is live is decided by what
   * supersedes what and a query that returned only grants would report a
   * withdrawn permission as standing.
   */
  async listConsentRecords(
    executor: Executor,
    input: { readonly contentId: string; readonly scope?: ConsentScope },
  ): Promise<ConsentRecordRow[]> {
    return executor
      .select()
      .from(safetyConsentRecords)
      .where(
        and(
          eq(safetyConsentRecords.contentId, input.contentId),
          input.scope === undefined
            ? undefined
            : eq(safetyConsentRecords.scope, input.scope),
        ),
      )
      .orderBy(
        asc(safetyConsentRecords.recordedAt),
        asc(safetyConsentRecords.id),
      )
      .limit(maximumConsentRecordsPerContent);
  }

  /** Whether this account filed a report that is evidence in this case. */
  async isReporterOnCase(
    executor: Executor,
    input: { readonly caseId: string; readonly reporterId: string },
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: safetyReports.id })
      .from(safetyReports)
      .where(
        and(
          eq(safetyReports.caseId, input.caseId),
          eq(safetyReports.reporterId, input.reporterId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** Decisions about one subject, newest first. */
  async listDecisionsForSubject(
    executor: Executor,
    input: { readonly limit: number; readonly subjectId: string },
  ): Promise<DecisionRow[]> {
    return executor
      .select()
      .from(safetyDecisions)
      .where(eq(safetyDecisions.subjectId, input.subjectId))
      .orderBy(desc(safetyDecisions.decidedAt), desc(safetyDecisions.id))
      .limit(input.limit);
  }

  /**
   * Records a complaint, or nothing when this person already has a live one
   * about the same decision. The partial unique index decides.
   */
  async insertAppeal(
    executor: Executor,
    input: {
      readonly appealPolicyVersion: string | null;
      readonly appellantKind: AppellantKind;
      readonly appellantReference: string;
      readonly caseId: string;
      readonly decisionId: string;
      readonly now: Date;
      readonly policyVersion: string;
      readonly statement: string | null;
      readonly windowClosesAt: Date | null;
    },
  ): Promise<AppealRow | undefined> {
    const inserted = await executor
      .insert(safetyAppeals)
      .values({
        appealPolicyVersion: input.appealPolicyVersion,
        appellantKind: input.appellantKind,
        appellantReference: input.appellantReference,
        caseId: input.caseId,
        decisionId: input.decisionId,
        id: crypto.randomUUID(),
        policyVersion: input.policyVersion,
        state: 'received',
        statement: input.statement,
        submittedAt: input.now,
        updatedAt: input.now,
        windowClosesAt: input.windowClosesAt,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async findAppeal(
    executor: Executor,
    id: string,
  ): Promise<AppealRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyAppeals)
      .where(eq(safetyAppeals.id, id))
      .limit(1);
    return rows[0];
  }

  /** Complaints still owed an answer, oldest first. */
  async listOpenAppeals(
    executor: Executor,
    limit: number,
  ): Promise<AppealRow[]> {
    return executor
      .select()
      .from(safetyAppeals)
      .where(inArray(safetyAppeals.state, [...openAppealStates]))
      .orderBy(asc(safetyAppeals.submittedAt), asc(safetyAppeals.id))
      .limit(limit);
  }

  /** The caller's own complaints, newest first. Never anybody else's. */
  async listAppealsByAppellant(
    executor: Executor,
    input: { readonly appellantReference: string; readonly limit: number },
  ): Promise<AppealRow[]> {
    return executor
      .select()
      .from(safetyAppeals)
      .where(eq(safetyAppeals.appellantReference, input.appellantReference))
      .orderBy(desc(safetyAppeals.submittedAt), desc(safetyAppeals.id))
      .limit(input.limit);
  }

  /**
   * Moves a complaint, against the version the caller read and only from a
   * state the transition is defined for.
   */
  async transitionAppeal(
    executor: Executor,
    input: {
      readonly appealId: string;
      readonly expectedVersion: number;
      readonly from: readonly AppealState[];
      readonly now: Date;
      readonly outcomeDecisionId: string | null;
      readonly reviewerActorReference: string | null;
      readonly state: AppealState;
    },
  ): Promise<AppealRow | undefined> {
    const decided = input.state === 'upheld' || input.state === 'refused';
    const updated = await executor
      .update(safetyAppeals)
      .set({
        decidedAt: decided ? input.now : null,
        outcomeDecisionId: input.outcomeDecisionId,
        reviewerActorReference: decided ? input.reviewerActorReference : null,
        state: input.state,
        updatedAt: input.now,
        version: sql`${safetyAppeals.version} + 1`,
      })
      .where(
        and(
          eq(safetyAppeals.id, input.appealId),
          eq(safetyAppeals.version, input.expectedVersion),
          inArray(safetyAppeals.state, [...input.from]),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Stamps a claim as having had its passed deadline recorded.
   *
   * Written in the same transaction as the evidence it describes, and only
   * while the caller still holds the lease, so two workers cannot both record
   * a breach for one claim.
   */
  async recordTakedownBreach(
    executor: Executor,
    input: {
      readonly actorReference: string;
      readonly claimId: string;
      readonly now: Date;
    },
  ): Promise<TakedownClaimRow | undefined> {
    const updated = await executor
      .update(safetyTakedownClaims)
      .set({
        breachRecordedAt: input.now,
        leaseActorReference: null,
        leaseExpiresAt: null,
        updatedAt: input.now,
        version: sql`${safetyTakedownClaims.version} + 1`,
      })
      .where(
        and(
          eq(safetyTakedownClaims.id, input.claimId),
          eq(safetyTakedownClaims.leaseActorReference, input.actorReference),
          isNull(safetyTakedownClaims.breachRecordedAt),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Appends a takedown claim. */ /** Appends a takedown claim. */
  async insertTakedownClaim(
    executor: Executor,
    input: {
      readonly acknowledgementDueAt: Date | null;
      readonly actionDueAt: Date | null;
      readonly caseId: string;
      readonly claimantAccountId: string | null;
      readonly claimantKind: TakedownClaimantKind;
      readonly consentRecordId: string | null;
      readonly contentId: string;
      readonly creatorId: string;
      readonly deadlinePolicyVersion: string | null;
      readonly now: Date;
      readonly policyVersion: string;
      readonly reasonCode: TakedownReasonCode;
      readonly triageDueAt: Date | null;
      readonly urgency: TakedownUrgency;
    },
  ): Promise<TakedownClaimRow> {
    const rows = await executor
      .insert(safetyTakedownClaims)
      .values({
        acknowledgementDueAt: input.acknowledgementDueAt,
        actionDueAt: input.actionDueAt,
        caseId: input.caseId,
        claimantAccountId: input.claimantAccountId,
        claimantKind: input.claimantKind,
        consentRecordId: input.consentRecordId,
        contentId: input.contentId,
        creatorId: input.creatorId,
        deadlinePolicyVersion: input.deadlinePolicyVersion,
        id: crypto.randomUUID(),
        policyVersion: input.policyVersion,
        reasonCode: input.reasonCode,
        receivedAt: input.now,
        state: 'received',
        triageDueAt: input.triageDueAt,
        updatedAt: input.now,
        urgency: input.urgency,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Takedown claim insert returned no row');
    }
    return row;
  }

  async findTakedownClaim(
    executor: Executor,
    id: string,
  ): Promise<TakedownClaimRow | undefined> {
    const rows = await executor
      .select()
      .from(safetyTakedownClaims)
      .where(eq(safetyTakedownClaims.id, id))
      .limit(1);
    return rows[0];
  }

  /** Every claim about one item, oldest first. */
  async listTakedownClaims(
    executor: Executor,
    input: { readonly contentId: string; readonly limit: number },
  ): Promise<TakedownClaimRow[]> {
    return executor
      .select()
      .from(safetyTakedownClaims)
      .where(eq(safetyTakedownClaims.contentId, input.contentId))
      .orderBy(
        asc(safetyTakedownClaims.receivedAt),
        asc(safetyTakedownClaims.id),
      )
      .limit(input.limit);
  }

  /** How many claims this account has filed since a moment. */
  async countTakedownClaimsSince(
    executor: Executor,
    input: { readonly claimantAccountId: string; readonly since: Date },
  ): Promise<number> {
    const rows = await executor
      .select({ total: count() })
      .from(safetyTakedownClaims)
      .where(
        and(
          eq(safetyTakedownClaims.claimantAccountId, input.claimantAccountId),
          gt(safetyTakedownClaims.receivedAt, input.since),
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /**
   * Moves a claim, against the version the caller read and only from a state
   * the transition is defined for.
   */
  async transitionTakedownClaim(
    executor: Executor,
    input: {
      readonly claimId: string;
      readonly expectedVersion: number;
      readonly from: readonly TakedownState[];
      readonly now: Date;
      readonly state: TakedownState;
    },
  ): Promise<TakedownClaimRow | undefined> {
    const stamps = {
      acknowledged: { acknowledgedAt: input.now },
      completed: { completedAt: input.now },
      decided: { decidedAt: input.now },
      dismissed: { acknowledgedAt: input.now, decidedAt: input.now },
      received: {},
    } as const;
    const updated = await executor
      .update(safetyTakedownClaims)
      .set({
        ...stamps[input.state],
        // Whoever moves a claim releases the lease with it: the work the lease
        // was held for is the work that just happened.
        leaseActorReference: null,
        leaseExpiresAt: null,
        state: input.state,
        updatedAt: input.now,
        version: sql`${safetyTakedownClaims.version} + 1`,
      })
      .where(
        and(
          eq(safetyTakedownClaims.id, input.claimId),
          eq(safetyTakedownClaims.version, input.expectedVersion),
          inArray(safetyTakedownClaims.state, [...input.from]),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Leases the claims whose action deadline has passed, oldest first.
   *
   * One statement, so two workers asking at the same moment cannot both take
   * the same row: the predicate refuses a claim somebody else currently holds,
   * and a lapsed lease is takeable again. Empty when no deadline is published,
   * because a claim with no deadline is never overdue.
   */
  async claimOverdueTakedowns(
    executor: Executor,
    input: {
      readonly actorReference: string;
      readonly expiresAt: Date;
      readonly limit: number;
      readonly now: Date;
    },
  ): Promise<TakedownClaimRow[]> {
    const due = executor
      .select({ id: safetyTakedownClaims.id })
      .from(safetyTakedownClaims)
      .where(
        and(
          inArray(safetyTakedownClaims.state, [...openTakedownStates]),
          lte(safetyTakedownClaims.actionDueAt, input.now),
          // A breach already recorded is not offered again. The evidence is on
          // the case and the case is in the queue; offering it every cycle
          // would be a worker rediscovering the same fact for ever.
          isNull(safetyTakedownClaims.breachRecordedAt),
          or(
            isNull(safetyTakedownClaims.leaseExpiresAt),
            lte(safetyTakedownClaims.leaseExpiresAt, input.now),
          ),
        ),
      )
      .orderBy(
        asc(safetyTakedownClaims.actionDueAt),
        asc(safetyTakedownClaims.id),
      )
      .limit(input.limit)
      .for('update', { skipLocked: true });
    return executor
      .update(safetyTakedownClaims)
      .set({
        leaseActorReference: input.actorReference,
        leaseExpiresAt: input.expiresAt,
        updatedAt: input.now,
        version: sql`${safetyTakedownClaims.version} + 1`,
      })
      .where(inArray(safetyTakedownClaims.id, due))
      .returning();
  }

  /**
   * The four conditions that make a restricting record current.
   *
   * Written once so no caller can accidentally ask a weaker question. The
   * subquery aliases the same table, so the outer reference is the row being
   * tested and the inner one is any record claiming to replace it.
   */
  private liveAt(now: Date): SQL | undefined {
    return and(
      eq(safetyEnforcements.disposition, 'restrict'),
      lte(safetyEnforcements.effectiveAt, now),
      or(
        isNull(safetyEnforcements.expiresAt),
        gt(safetyEnforcements.expiresAt, now),
      ),
      sql`not exists (select 1 from ${safetyEnforcements} as superseding where superseding.supersedes_id = ${safetyEnforcements.id})`,
    );
  }
}
