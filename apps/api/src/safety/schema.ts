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
} from 'drizzle-orm/pg-core';

import {
  inList,
  lengthBetween,
  nullablePairing,
  timestamptz,
} from '../database/columns.js';
import {
  maximumReportDetailCharacters,
  reportReasonCodes,
  reportStates,
  enforcementObjectTypes,
  enforcementReasonCodes,
  enforcementScopes,
  objectScopedEnforcements,
  type EnforcementObjectType,
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
    state: text('state').notNull(),
    subjectId: uuid('subject_id').notNull(),
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
    index('safety_reports_subject_idx').on(table.subjectId),
    index('safety_reports_reporter_idx').on(table.reporterId, table.createdAt),
    check(
      'safety_reports_not_self_check',
      sql`${table.reporterId} <> ${table.subjectId}`,
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
 * An enforcement action, append-only.
 *
 * Nothing updates a row here. An enforcement that is lifted is a second record
 * rather than an edit of the first, because the question an audit asks is not
 * "what is in force" but "what was done, by whom, when, and under which policy".
 * The current state lives with the domain that owns it — an account's status is
 * USERS' truth, a conversation's state is MESSAGING's — and this table is the
 * record of the decision that changed it.
 */
export const safetyEnforcements = pgTable(
  'safety_enforcements',
  {
    /** Opaque reference to the actor. No moderator identity is stored here. */
    actorReference: text('actor_reference').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    effectiveAt: timestamptz('effective_at').notNull(),
    id: uuid('id').primaryKey(),
    policyVersion: text('policy_version').notNull(),
    reasonCode: text('reason_code').notNull(),
    /** The report that led here, when there was one. */
    reportId: uuid('report_id'),
    scope: text('scope').notNull(),
    subjectId: uuid('subject_id').notNull(),
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
    index('safety_enforcements_report_idx').on(table.reportId),
    check(
      'safety_enforcements_scope_check',
      inList(table.scope, enforcementScopes),
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
