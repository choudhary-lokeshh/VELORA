import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
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
  maximumReportDetailCharacters,
  reportReasonCodes,
  reportSourceSurfaces,
  reportStates,
  reportTargetTypes,
  enforcementDispositions,
  enforcementObjectTypes,
  enforcementReasonCodes,
  enforcementScopes,
  objectScopedEnforcements,
  type CasePriority,
  type CaseQueue,
  type CaseState,
  type EnforcementDisposition,
  type EnforcementObjectType,
  type ReportSourceSurface,
  type ReportTargetType,
} from './policy.js';

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
      .where(sql`${table.state} <> 'closed'`),
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
    // A closed case has a moment and an open one has none.
    check(
      'safety_cases_closed_shape_check',
      sql`(${table.state} = 'closed') = (${table.closedAt} is not null)`,
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
    /** The report that led here, when there was one. */
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
      sql`(${table.scope} in (${sql.raw(objectScopedEnforcements.map((scope) => `'${scope}'`).join(', '))})) = (${table.targetObjectId} is not null)`,
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
