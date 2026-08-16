import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import {
  inList,
  lengthBetween,
  nullablePairing,
  timestamptz,
} from '../database/columns.js';
import {
  casePriorities,
  caseQueues,
  caseStates,
  decisionActions,
  decisionReasonCodes,
  decisionSubjectStates,
  evidenceExternalReferencePattern,
  evidenceKinds,
  evidenceReferenceTypes,
  evidenceStateLabelPattern,
  enforcingDecisionActions,
  maximumOperatorNoteCharacters,
  maximumReportDetailCharacters,
  referencedEvidenceKinds,
  reportReasonCodes,
  reportSourceSurfaces,
  reportStates,
  reportTargetTypes,
  resolvedCaseStates,
  resolvingDecisionActions,
  snapshotEvidenceKinds,
  enforcementDispositions,
  enforcementObjectTypes,
  enforcementReasonCodes,
  enforcementScopes,
  objectScopedEnforcements,
  type CasePriority,
  type CaseQueue,
  type CaseState,
  type DecisionAction,
  type DecisionSubjectState,
  type EnforcementDisposition,
  type EnforcementObjectType,
  type EnforcementScope,
  type EvidenceKind,
  type EvidenceReferenceType,
  type ReportSourceSurface,
  type ReportTargetType,
} from './policy.js';

/** A closed vocabulary rendered as SQL literals for a CHECK or an index. */
function literals(values: readonly string[]): string {
  return values
    .map((value) => {
      if (!/^[a-z0-9][a-z0-9_]*$/u.test(value)) {
        throw new Error(`Unsafe enumerated constraint value: ${value}`);
      }
      return `'${value}'`;
    })
    .join(', ');
}

/**
 * TRUST & SAFETY-owned persistence.
 *
 * SAFETY owns reports, user-to-user blocks, enforcement records, and the safety
 * eligibility answer every other domain asks for. It owns no profile, no
 * message, no introduction, and no moderator queue: those belong to USERS,
 * MESSAGING, DISCOVERY, and MODERATION, and this domain references them by
 * opaque identifier rather than by shared schema.
 *
 * Access to what is stored here is not uniform. A block is the blocker's own
 * record and they may read and revoke it. A report is evidence: the reporter
 * may see that they filed it, and nothing in this domain ever discloses a
 * reporter, a narrative, or an internal rationale to the person reported.
 */

/**
 * One person's block of another.
 *
 * The record is directional — who blocked whom is a fact worth keeping — while
 * the *effect* is symmetric: a live block in either direction ends interaction
 * for the pair. Storing it directionally and evaluating it symmetrically is what
 * lets both people hold independent records, which the domain document requires.
 *
 * Revoking sets `revoked_at` rather than deleting the row. A block and its
 * withdrawal are both safety-relevant history, and a partial unique index over
 * the live pair means the same person can be blocked again afterwards without
 * the earlier record being rewritten.
 */
export const safetyBlocks = pgTable(
  'safety_blocks',
  {
    blockedId: uuid('blocked_id').notNull(),
    blockerId: uuid('blocker_id').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    revokedAt: timestamptz('revoked_at'),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('safety_blocks_live_pair_uk')
      .on(table.blockerId, table.blockedId)
      .where(sql`${table.revokedAt} is null`),
    // "Who has blocked me" is asked as often as "who have I blocked", because
    // the effect is symmetric. Both directions are an index lookup.
    index('safety_blocks_blocked_idx').on(table.blockedId, table.blockerId),
    check(
      'safety_blocks_not_self_check',
      sql`${table.blockerId} <> ${table.blockedId}`,
    ),
    check(
      'safety_blocks_revocation_check',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * A moderation case.
 *
 * The unit of review, and deliberately not the unit of intake. A report is
 * evidence somebody filed; a case is the platform's decision to look at
 * something. Keeping them apart is what lets several reports about one target
 * be reviewed once without any of them being discarded, and what stops "how
 * many people complained" from being a fact the workflow acts on.
 *
 * A case names what it is about rather than who reported it. There is no
 * reporter column here at all, so no query over this table can group people by
 * who they complained about.
 *
 * At most one case is open per target at a time, enforced by a partial unique
 * index rather than by a read: two reports arriving together must converge on
 * one case, and the database is what decides which.
 */
export const safetyCases = pgTable(
  'safety_cases',
  {
    /** Opaque reference to the reviewer holding the claim, when one does. */
    assignedActorReference: text('assigned_actor_reference'),
    assignedAt: timestamptz('assigned_at'),
    /** A claim lapses so a reviewer who disappears does not hold a case. */
    assignmentExpiresAt: timestamptz('assignment_expires_at'),
    /** When the case left the queue, however it left: decided or closed. */
    closedAt: timestamptz('closed_at'),
    id: uuid('id').primaryKey(),
    openedAt: timestamptz('opened_at').notNull(),
    policyVersion: text('policy_version').notNull(),
    /** A reviewer's judgement. Never derived from how many reports there are. */
    priority: text('priority').notNull().$type<CasePriority>(),
    queue: text('queue').notNull().$type<CaseQueue>(),
    state: text('state').notNull().$type<CaseState>(),
    targetId: uuid('target_id').notNull(),
    targetType: text('target_type').notNull().$type<ReportTargetType>(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** Optimistic concurrency. Two reviewers acting at once produce one move. */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('safety_cases_open_target_uk')
      .on(table.targetType, table.targetId)
      .where(
        sql`${table.state} not in (${sql.raw(literals(resolvedCaseStates))})`,
      ),
    // The queue, ordered exactly as the cursor pages it, so a page is an index
    // walk that stops rather than a scan of every case ever opened.
    index('safety_cases_queue_idx').on(
      table.queue,
      table.state,
      table.openedAt,
      table.id,
    ),
    // Reclaiming lapsed assignments, which a worker asks for by deadline.
    index('safety_cases_assignment_idx')
      .on(table.assignmentExpiresAt)
      .where(sql`${table.assignmentExpiresAt} is not null`),
    index('safety_cases_target_idx').on(table.targetType, table.targetId),
    check('safety_cases_state_check', inList(table.state, caseStates)),
    check(
      'safety_cases_priority_check',
      inList(table.priority, casePriorities),
    ),
    check('safety_cases_queue_check', inList(table.queue, caseQueues)),
    check(
      'safety_cases_target_type_check',
      inList(table.targetType, reportTargetTypes),
    ),
    // A case that has left the queue has a moment and an open one has none.
    check(
      'safety_cases_closed_shape_check',
      sql`(${table.state} in (${sql.raw(literals(resolvedCaseStates))})) = (${table.closedAt} is not null)`,
    ),
    // A claim is a reviewer, a moment, and a deadline, or it is nothing. Two of
    // the three would be a case somebody holds with no way to release it.
    check(
      'safety_cases_assignment_shape_check',
      sql`(${table.assignedActorReference} is null) = (${table.assignedAt} is null)
        and (${table.assignedActorReference} is null) = (${table.assignmentExpiresAt} is null)`,
    ),
    check(
      'safety_cases_assignment_expiry_check',
      sql`${table.assignmentExpiresAt} is null or ${table.assignmentExpiresAt} > ${table.assignedAt}`,
    ),
    check('safety_cases_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * A report.
 *
 * The reporter identifier is stored because a report without a reporter cannot
 * be rate-limited, de-duplicated, or followed up. It is never published to the
 * subject, never included in an eligibility answer, and never leaves this
 * domain through a consumer-facing shape.
 *
 * `clientReportId` makes submission retry-safe without collapsing genuinely
 * separate reports: the same reporter repeating a lost request gets the same
 * report back, while a second report about the same person under a new key is a
 * second report. The domain document requires exactly that — duplicates are
 * linked under moderation policy rather than refused at the door.
 */
export const safetyReports = pgTable(
  'safety_reports',
  {
    /**
     * The case this report is evidence in. Every report gets one, and several
     * reports about one target share it — which is what lets a duplicate be
     * reviewed once without any of them being discarded.
     */
    caseId: uuid('case_id').references(() => safetyCases.id),
    clientReportId: text('client_report_id').notNull(),
    /** Opaque MESSAGING reference, when the report came from a conversation. */
    conversationId: uuid('conversation_id'),
    createdAt: timestamptz('created_at').notNull(),
    /** The reporter's own narrative. Evidence, not analytics. */
    detail: text('detail'),
    id: uuid('id').primaryKey(),
    /** Opaque MESSAGING reference to the message being reported, if any. */
    messageId: uuid('message_id'),
    /** Which reporting vocabulary was in force. */
    policyVersion: text('policy_version').notNull(),
    reasonCode: text('reason_code').notNull(),
    reporterId: uuid('reporter_id').notNull(),
    resolvedAt: timestamptz('resolved_at'),
    /**
     * Which surface it was filed from, taken from the credential's audience.
     *
     * Nullable only for reports filed before Velora recorded a surface at all.
     * Absent means exactly that and is a real state rather than a gap: the old
     * API accepted both consumer surfaces and kept nothing that distinguishes
     * them, so inventing one would be a fact nobody observed. Every report
     * written from here on carries it.
     */
    sourceSurface: text('source_surface').$type<ReportSourceSurface>(),
    state: text('state').notNull(),
    /**
     * What is being reported. The identifier's meaning is qualified by
     * `targetType`: a consumer account, a creator, a content item, a club, or a
     * conversation. It is always resolved server-side through the owning
     * domain's contract before this row is written.
     */
    subjectId: uuid('subject_id').notNull(),
    targetType: text('target_type').notNull().$type<ReportTargetType>(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** Optimistic concurrency for the review transition. */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('safety_reports_client_id_uk').on(
      table.reporterId,
      table.clientReportId,
    ),
    // The moderation queue: open reports, oldest first.
    index('safety_reports_state_idx').on(table.state, table.createdAt),
    index('safety_reports_subject_idx').on(table.targetType, table.subjectId),
    index('safety_reports_reporter_idx').on(table.reporterId, table.createdAt),
    // Every report a case carries, which is what a reviewer reads.
    index('safety_reports_case_idx').on(table.caseId, table.createdAt),
    // Reporting yourself is refused where "yourself" is a thing this domain can
    // compare. A creator reporting their own item is a different question,
    // decided by the domain that owns the item rather than by an identifier
    // equality that would be comparing two different identifier spaces.
    check(
      'safety_reports_not_self_check',
      sql`${table.targetType} <> 'consumer_account' or ${table.reporterId} <> ${table.subjectId}`,
    ),
    check(
      'safety_reports_target_type_check',
      inList(table.targetType, reportTargetTypes),
    ),
    check(
      'safety_reports_source_surface_check',
      sql`${table.sourceSurface} is null or ${inList(table.sourceSurface, reportSourceSurfaces)}`,
    ),
    check('safety_reports_state_check', inList(table.state, reportStates)),
    check(
      'safety_reports_reason_check',
      inList(table.reasonCode, reportReasonCodes),
    ),
    check(
      'safety_reports_detail_check',
      sql`${table.detail} is null or ${lengthBetween(table.detail, 1, maximumReportDetailCharacters)}`,
    ),
    // A resolution has a moment, and an unresolved report has none.
    check(
      'safety_reports_resolution_check',
      sql`(${table.state} in ('actioned', 'dismissed')) = (${table.resolvedAt} is not null)`,
    ),
    // Evidence about a message is evidence about the conversation it is in.
    check(
      'safety_reports_evidence_check',
      sql`${table.messageId} is null or ${table.conversationId} is not null`,
    ),
    check('safety_reports_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * An enforcement decision, append-only.
 *
 * Nothing updates a row here. An enforcement that is lifted is a second record
 * that names the first, because the question an audit asks is not only "what is
 * in force" but "what was done, by whom, when, and under which policy".
 *
 * What *is* in force is derivable from this table alone, which it was not
 * before: `disposition` says whether a record imposes or lifts, `expiresAt`
 * says when a time-bounded restriction stops on its own, and `supersedesId`
 * links a lift or a correction to exactly the record it replaces. A live
 * restriction is one that restricts, has taken effect, has not expired, and has
 * nothing superseding it.
 *
 * The applied state still lives with the domain that owns it — an account's
 * status is USERS' truth, a conversation's state is MESSAGING's — and this
 * table remains the record of the decision that changed it rather than a second
 * opinion about the result.
 */
export const safetyEnforcements = pgTable(
  'safety_enforcements',
  {
    /** Opaque reference to the actor. No moderator identity is stored here. */
    actorReference: text('actor_reference').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    /** Whether this record imposes a restriction or takes one away. */
    disposition: text('disposition').notNull().$type<EnforcementDisposition>(),
    effectiveAt: timestamptz('effective_at').notNull(),
    /**
     * When a time-bounded restriction stops of its own accord. Null is
     * indefinite, which is not the same as permanent: a lift is still a record.
     */
    expiresAt: timestamptz('expires_at'),
    id: uuid('id').primaryKey(),
    policyVersion: text('policy_version').notNull(),
    reasonCode: text('reason_code').notNull(),
    /**
     * The report a decision named, where the decision named one.
     *
     * Null for anything a *case* produced, which is what a moderation decision
     * now is: a case is the unit of review, several reports can be evidence in
     * one decision, and which those were is answerable through
     * `safety_decisions` — the decision names its case and the evidence it
     * cited. Null too for a Platform Admin operation, which is nobody's queue.
     */
    reportId: uuid('report_id'),
    scope: text('scope').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /**
     * The record this one replaces. A lift always names what it lifts, so a
     * reversal can never be mistaken for a second restriction and history
     * reads as a chain rather than as a pile.
     *
     * The foreign key is to this same table, which is the one place a foreign
     * key is right in this domain: it is not a cross-domain reference, and a
     * supersession pointing at an enforcement that does not exist would be a
     * chain with a missing link. There is no cascade — nothing deletes an
     * enforcement, and a rule that would delete history on a parent's removal
     * is a rule for a table this is not.
     */
    supersedesId: uuid('supersedes_id').references(
      (): AnyPgColumn => safetyEnforcements.id,
    ),
    /** The conversation a closure applies to, for that scope only. */
    targetConversationId: uuid('target_conversation_id'),
    /**
     * What a creator-scoped enforcement acted on, when it acted on something.
     * The type comes from a closed vocabulary and the identifier is validated
     * by its owning domain before this row is written, so nothing here is a
     * reference nobody checked.
     */
    targetObjectId: uuid('target_object_id'),
    targetObjectType: text('target_object_type').$type<EnforcementObjectType>(),
  },
  (table) => [
    index('safety_enforcements_subject_idx').on(
      table.subjectId,
      table.effectiveAt,
    ),
    // The authorization query: what restricts this subject in this scope right
    // now. Ordered as the reader walks it, so "the live one" is an index seek
    // rather than a scan of everything ever decided about the subject.
    index('safety_enforcements_live_idx').on(
      table.subjectId,
      table.scope,
      table.effectiveAt,
    ),
    index('safety_enforcements_report_idx').on(table.reportId),
    // One record may supersede a given record, and only one. Without this two
    // reviewers could each lift the same restriction and the chain would fork
    // into two equally valid histories.
    uniqueIndex('safety_enforcements_supersedes_uk')
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} is not null`),
    check(
      'safety_enforcements_scope_check',
      inList(table.scope, enforcementScopes),
    ),
    check(
      'safety_enforcements_disposition_check',
      inList(table.disposition, enforcementDispositions),
    ),
    // A lift names what it lifts. A record that took something away without
    // saying what would be an assertion an audit could not follow.
    check(
      'safety_enforcements_lift_shape_check',
      sql`${table.disposition} = 'restrict' or ${table.supersedesId} is not null`,
    ),
    check(
      'safety_enforcements_supersedes_self_check',
      sql`${table.supersedesId} is null or ${table.supersedesId} <> ${table.id}`,
    ),
    // An expiry that is not after the moment the record took effect would be a
    // restriction that was never in force, recorded as though it had been.
    check(
      'safety_enforcements_expiry_check',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveAt}`,
    ),
    // Nothing that lifts a restriction carries an expiry: a lift is an event,
    // not a state, and one that stopped applying would silently reinstate.
    check(
      'safety_enforcements_lift_expiry_check',
      sql`${table.disposition} = 'restrict' or ${table.expiresAt} is null`,
    ),
    check(
      'safety_enforcements_reason_check',
      inList(table.reasonCode, enforcementReasonCodes),
    ),
    // A conversation closure names a conversation; nothing else does.
    check(
      'safety_enforcements_target_check',
      sql`(${table.scope} = 'conversation_closure') = (${table.targetConversationId} is not null)`,
    ),
    // An object-scoped enforcement names an object, and nothing else may.
    check(
      'safety_enforcements_object_shape_check',
      sql`(${table.scope} in (${sql.raw(literals(objectScopedEnforcements))})) = (${table.targetObjectId} is not null)`,
    ),
    check(
      'safety_enforcements_object_pairing_check',
      nullablePairing(table.targetObjectId, table.targetObjectType),
    ),
    check(
      'safety_enforcements_object_type_check',
      sql`${table.targetObjectType} is null or ${inList(table.targetObjectType, enforcementObjectTypes)}`,
    ),
  ],
);

/**
 * Evidence in a case, append-only.
 *
 * What makes a decision explainable later. Every row is a **reference or a
 * minimal snapshot** rather than a copy: the narrative stays on the report, the
 * message body stays in MESSAGING, and the creator's page stays with CREATORS.
 * Copying any of them here would build a second, less protected store of
 * exactly the material this domain exists to protect, and it would be wrong the
 * moment the original changed.
 *
 * The column layout is what enforces that rather than a convention. A reference
 * kind carries an identifier and no text at all. A snapshot kind carries a
 * state *label* — lowercase, no spaces, sixty-four characters — so a field
 * meant for `published` cannot quietly become the place a private message ends
 * up. Exactly one kind, an operator note, carries prose, and it is the one kind
 * that requires an actor.
 *
 * Nothing here is ever updated or deleted; a trigger refuses both. Evidence
 * that could be edited after a decision cited it would make the decision
 * unexplainable in the one direction that matters.
 */
export const safetyEvidence = pgTable(
  'safety_evidence',
  {
    /** Opaque reference to the operator who added it. Absent means Velora did. */
    actorReference: text('actor_reference'),
    caseId: uuid('case_id')
      .notNull()
      .references(() => safetyCases.id),
    /**
     * An approved verifier's outcome handle. Opaque, never a document.
     *
     * Shaped narrowly on purpose: no whitespace and two hundred characters, so
     * the column cannot hold a name, an address, or a line of a passport.
     */
    externalReference: text('external_reference'),
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull().$type<EvidenceKind>(),
    /** A reviewer's own words. The only free text in this table. */
    note: text('note'),
    /** When the snapshot was true. Meaningless without one, so paired with it. */
    observedAt: timestamptz('observed_at'),
    policyVersion: text('policy_version').notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
    /** Opaque identifier of the thing this evidence names. */
    referenceId: uuid('reference_id'),
    referenceType: text('reference_type').$type<EvidenceReferenceType>(),
    /** A code, not a sentence. See the pattern check below. */
    stateLabel: text('state_label'),
  },
  (table) => [
    // The case timeline, ordered exactly as a reviewer reads it.
    index('safety_evidence_case_idx').on(
      table.caseId,
      table.recordedAt,
      table.id,
    ),
    // The target of the composite foreign key from `safety_decision_evidence`,
    // which is what makes "a decision cites evidence from its own case" a rule
    // PostgreSQL keeps rather than one the application remembers.
    uniqueIndex('safety_evidence_case_identity_uk').on(table.id, table.caseId),
    index('safety_evidence_reference_idx')
      .on(table.referenceType, table.referenceId)
      .where(sql`${table.referenceId} is not null`),
    check('safety_evidence_kind_check', inList(table.kind, evidenceKinds)),
    check(
      'safety_evidence_reference_type_check',
      sql`${table.referenceType} is null or ${inList(table.referenceType, evidenceReferenceTypes)}`,
    ),
    check(
      'safety_evidence_reference_pairing_check',
      nullablePairing(table.referenceId, table.referenceType),
    ),
    // A kind that names something names it, and a kind that does not may not.
    check(
      'safety_evidence_reference_shape_check',
      sql`(${table.kind} in (${sql.raw(literals(referencedEvidenceKinds))})) = (${table.referenceId} is not null)`,
    ),
    check(
      'safety_evidence_snapshot_shape_check',
      sql`(${table.stateLabel} is null) = (${table.observedAt} is null)`,
    ),
    check(
      'safety_evidence_snapshot_kind_check',
      sql`${table.stateLabel} is null or ${table.kind} in (${sql.raw(literals(snapshotEvidenceKinds))})`,
    ),
    // A snapshot label is an identifier-shaped code. Without this the column is
    // a free text field wearing another name, and free text is how a reporter's
    // narrative ends up somewhere nobody expected to find one.
    check(
      'safety_evidence_state_label_check',
      sql`${table.stateLabel} is null or ${table.stateLabel} ~ ${sql.raw(`'${evidenceStateLabelPattern}'`)}`,
    ),
    check(
      'safety_evidence_note_shape_check',
      sql`(${table.kind} = 'operator_note') = (${table.note} is not null)`,
    ),
    check(
      'safety_evidence_note_length_check',
      sql`${table.note} is null or ${lengthBetween(table.note, 1, maximumOperatorNoteCharacters)}`,
    ),
    // A note is somebody's words, so a note with no author is a claim nobody
    // made. Everything else may be Velora's own observation.
    check(
      'safety_evidence_note_actor_check',
      sql`${table.kind} <> 'operator_note' or ${table.actorReference} is not null`,
    ),
    check(
      'safety_evidence_external_shape_check',
      sql`(${table.kind} = 'external_verification_reference') = (${table.externalReference} is not null)`,
    ),
    check(
      'safety_evidence_external_reference_check',
      sql`${table.externalReference} is null or ${table.externalReference} ~ ${sql.raw(`'${evidenceExternalReferencePattern}'`)}`,
    ),
  ],
);

/**
 * A moderation decision, append-only.
 *
 * The record of what a reviewer did about a case: which action, on what, under
 * which policy, citing which evidence, and what changed as a result. Nothing
 * here is ever edited — a trigger refuses an update and a delete — because a
 * decision that could be rewritten afterwards is not a record of a decision, it
 * is a record of somebody's current opinion about one.
 *
 * A correction is therefore a **second decision that names the first**. The
 * chain cannot fork, because at most one record may supersede a given one, and
 * a case has at most one chain, because at most one resolving decision may
 * start one. Together those two partial unique indexes are what make "exactly
 * one final decision per case" a fact PostgreSQL keeps rather than a race two
 * reviewers can both win.
 *
 * Escalation is outside that rule and deliberately so: handing a case on is not
 * settling it, and a case may be handed on more than once.
 */
export const safetyDecisions = pgTable(
  'safety_decisions',
  {
    action: text('action').notNull().$type<DecisionAction>(),
    /** Opaque reference to the reviewer. No moderator identity is stored. */
    actorReference: text('actor_reference').notNull(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => safetyCases.id),
    decidedAt: timestamptz('decided_at').notNull(),
    /**
     * The enforcement this decision produced, where it produced one.
     *
     * A foreign key rather than a loose identifier because both rows are this
     * domain's, and a decision claiming an enforcement that does not exist
     * would be the one kind of unexplainable record this table exists to make
     * impossible.
     */
    enforcementId: uuid('enforcement_id').references(
      () => safetyEnforcements.id,
    ),
    /** When a temporary hold stops of its own accord. Holds only. */
    expiresAt: timestamptz('expires_at'),
    id: uuid('id').primaryKey(),
    policyVersion: text('policy_version').notNull(),
    /** What SAFETY saw before it acted, read under the subject lock. */
    priorState: text('prior_state').$type<DecisionSubjectState>(),
    reasonCode: text('reason_code').notNull(),
    /** And after. The pair is one instant, not two. */
    resultingState: text('resulting_state').$type<DecisionSubjectState>(),
    scope: text('scope').$type<EnforcementScope>(),
    subjectId: uuid('subject_id').notNull(),
    supersedesId: uuid('supersedes_id').references(
      (): AnyPgColumn => safetyDecisions.id,
    ),
    targetType: text('target_type').notNull().$type<ReportTargetType>(),
  },
  (table) => [
    index('safety_decisions_case_idx').on(
      table.caseId,
      table.decidedAt,
      table.id,
    ),
    uniqueIndex('safety_decisions_case_identity_uk').on(table.id, table.caseId),
    index('safety_decisions_subject_idx').on(table.subjectId, table.decidedAt),
    index('safety_decisions_enforcement_idx')
      .on(table.enforcementId)
      .where(sql`${table.enforcementId} is not null`),
    // One settlement per case. Two reviewers deciding at once produce one
    // decision and one refusal, whatever their transactions did in between.
    uniqueIndex('safety_decisions_case_resolution_uk')
      .on(table.caseId)
      .where(
        sql`${table.action} in (${sql.raw(literals(resolvingDecisionActions))}) and ${table.supersedesId} is null`,
      ),
    // And the chain does not fork: a correction of an already-corrected
    // decision is refused rather than becoming a second valid history.
    uniqueIndex('safety_decisions_supersedes_uk')
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} is not null`),
    check(
      'safety_decisions_action_check',
      inList(table.action, decisionActions),
    ),
    check(
      'safety_decisions_reason_check',
      inList(table.reasonCode, decisionReasonCodes),
    ),
    // A restriction imposed for "no violation found" would be a record that
    // contradicts itself, so an enforcing action may only carry a finding.
    check(
      'safety_decisions_enforcing_reason_check',
      sql`${table.action} not in (${sql.raw(literals(enforcingDecisionActions))})
        or ${inList(table.reasonCode, enforcementReasonCodes)}`,
    ),
    check(
      'safety_decisions_target_type_check',
      inList(table.targetType, reportTargetTypes),
    ),
    check(
      'safety_decisions_scope_check',
      sql`${table.scope} is null or ${inList(table.scope, enforcementScopes)}`,
    ),
    // An action that enforces names a scope and produces a record; one that
    // does not may claim neither.
    check(
      'safety_decisions_enforcing_shape_check',
      sql`(${table.action} in (${sql.raw(literals(enforcingDecisionActions))})) = (${table.scope} is not null)
        and (${table.action} in (${sql.raw(literals(enforcingDecisionActions))})) = (${table.enforcementId} is not null)
        and (${table.action} in (${sql.raw(literals(enforcingDecisionActions))})) = (${table.priorState} is not null)`,
    ),
    check(
      'safety_decisions_state_pairing_check',
      nullablePairing(table.priorState, table.resultingState),
    ),
    check(
      'safety_decisions_state_vocabulary_check',
      sql`(${table.priorState} is null or ${inList(table.priorState, decisionSubjectStates)})
        and (${table.resultingState} is null or ${inList(table.resultingState, decisionSubjectStates)})`,
    ),
    // A hold has an end, and nothing else does. A final finding that quietly
    // stopped applying would be a restriction nobody decided to lift.
    check(
      'safety_decisions_hold_shape_check',
      sql`(${table.action} = 'temporary_hold') = (${table.expiresAt} is not null)`,
    ),
    check(
      'safety_decisions_hold_expiry_check',
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.decidedAt}`,
    ),
    check(
      'safety_decisions_supersedes_self_check',
      sql`${table.supersedesId} is null or ${table.supersedesId} <> ${table.id}`,
    ),
  ],
);

/**
 * Which evidence a decision cited.
 *
 * A decision names the evidence it rests on, and the composite foreign keys
 * make that citation impossible to get wrong: both sides carry the case, so a
 * decision cannot cite evidence from a different case and neither row can be
 * re-pointed afterwards. Append-only like both tables it joins.
 */
export const safetyDecisionEvidence = pgTable(
  'safety_decision_evidence',
  {
    caseId: uuid('case_id').notNull(),
    decisionId: uuid('decision_id').notNull(),
    evidenceId: uuid('evidence_id').notNull(),
    recordedAt: timestamptz('recorded_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.decisionId, table.evidenceId] }),
    index('safety_decision_evidence_evidence_idx').on(table.evidenceId),
    foreignKey({
      columns: [table.decisionId, table.caseId],
      foreignColumns: [safetyDecisions.id, safetyDecisions.caseId],
      name: 'safety_decision_evidence_decision_fk',
    }),
    foreignKey({
      columns: [table.evidenceId, table.caseId],
      foreignColumns: [safetyEvidence.id, safetyEvidence.caseId],
      name: 'safety_decision_evidence_evidence_fk',
    }),
  ],
);
