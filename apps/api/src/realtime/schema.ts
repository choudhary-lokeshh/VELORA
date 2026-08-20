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

import { inList, timestamptz } from '../database/columns.js';
import {
  rtcCallMediums,
  rtcEndReasons,
  rtcParticipantRoles,
  rtcSessionStates,
  terminalRtcSessionStates,
  type RtcCallMedium,
  type RtcEndReason,
  type RtcParticipantRole,
  type RtcSessionState,
} from './policy.js';

/**
 * REALTIME-owned persistence.
 *
 * REALTIME owns call sessions and the participation in them. It owns no
 * principal, no account standing, no communication relationship, no block, and
 * no enforcement decision: those belong to AUTH, USERS, DISCOVERY, and
 * TRUST & SAFETY, and this domain asks each of them at the moment of the action
 * rather than storing its own copy of any answer. There is deliberately no
 * `eligible` column anywhere below, because a column would be a decision taken
 * at some earlier time being applied at this one.
 *
 * References to consumer accounts and to the introduction that authorized a
 * call are opaque identifiers with no foreign key, on the rule Phase 1 recorded
 * in `docs/architecture/05-data-ownership.md`.
 *
 * **Nothing here is a call.** No media, recording, transcript, SDP, ICE
 * candidate, TURN credential, reusable join credential, or participant IP
 * address has a column, and a test enumerates every column and asserts it. What
 * is durable is the lifecycle: who invited whom, under which relationship, at
 * which times, in which state, and why it ended. See
 * [ADR-0025](../../../../docs/decisions/ADR-0025-rtc-live-communications-architecture.md).
 *
 * Retention is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. Nothing expires,
 * and no correctness rule depends on a row being physically deleted.
 */

/**
 * One one-to-one call, from invitation to whatever ended it.
 *
 * The pair is normalized to an ordered low and high identifier, the same
 * convention DISCOVERY and MESSAGING use, so the same two people are the same
 * pair whichever of them is calling. Unlike a conversation there may be many
 * sessions per pair over time — a call is an event, not a relationship — so the
 * uniqueness below is scoped to the live ones.
 *
 * `authorizationGeneration` is what makes a previously issued join credential
 * dead the instant a call is rejected, cancelled, ended, or revoked. It is on
 * the session rather than on a participant because every terminal transition
 * invalidates both sides at once, and a generation held per participant could
 * be advanced for one of them and not the other.
 */
export const realtimeSessions = pgTable(
  'realtime_sessions',
  {
    acceptedAt: timestamptz('accepted_at'),
    /**
     * Advanced by every transition that invalidates outstanding authorization.
     * A credential naming an older generation is refused at the platform
     * boundary regardless of what a provider still believes.
     */
    authorizationGeneration: integer('authorization_generation')
      .notNull()
      .default(1),
    /** First moment a provider observed media, where that is authoritative. */
    connectedAt: timestamptz('connected_at'),
    createdAt: timestamptz('created_at').notNull(),
    endReason: text('end_reason').$type<RtcEndReason>(),
    endedAt: timestamptz('ended_at'),
    id: uuid('id').primaryKey(),
    /** Who placed the call. Also a participant; this is the fast answer. */
    initiatorId: uuid('initiator_id').notNull(),
    /** The invitation's own deadline. Expiry is decided against this column. */
    invitationExpiresAt: timestamptz('invitation_expires_at').notNull(),
    medium: text('medium').notNull().$type<RtcCallMedium>(),
    /** The mutual introduction that authorized this call to exist at all. */
    originIntroductionId: uuid('origin_introduction_id').notNull(),
    pairHighId: uuid('pair_high_id').notNull(),
    pairLowId: uuid('pair_low_id').notNull(),
    /** Durable total order; timestamps and random UUIDs can tie. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    state: text('state').notNull().$type<RtcSessionState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // One live call per pair, ever. This is also what makes invitation
    // idempotent without a client key: a second attempt loses to the index and
    // then reads the call that already exists, and two people calling each
    // other at the same instant produce one call rather than two.
    uniqueIndex('realtime_sessions_live_pair_uk')
      .on(table.pairLowId, table.pairHighId)
      .where(
        sql`${table.state} <> all (array[${sql.raw(
          terminalRtcSessionStates.map((state) => `'${state}'`).join(', '),
        )}]::text[])`,
      ),
    // "What is happening to this person right now", from either side of the
    // ordered pair. Partial, so a person's call history never enters the plan
    // for a question about their live call.
    index('realtime_sessions_live_low_idx')
      .on(table.pairLowId)
      .where(
        sql`${table.state} <> all (array[${sql.raw(
          terminalRtcSessionStates.map((state) => `'${state}'`).join(', '),
        )}]::text[])`,
      ),
    index('realtime_sessions_live_high_idx')
      .on(table.pairHighId)
      .where(
        sql`${table.state} <> all (array[${sql.raw(
          terminalRtcSessionStates.map((state) => `'${state}'`).join(', '),
        )}]::text[])`,
      ),
    // Invitations whose deadline has passed, for the sweep that expires them.
    index('realtime_sessions_invitation_deadline_idx')
      .on(table.invitationExpiresAt)
      .where(sql`${table.state} = 'invited'`),
    uniqueIndex('realtime_sessions_sequence_uk').on(table.sequence),
    check(
      'realtime_sessions_state_check',
      inList(table.state, rtcSessionStates),
    ),
    check(
      'realtime_sessions_medium_check',
      inList(table.medium, rtcCallMediums),
    ),
    check(
      'realtime_sessions_end_reason_check',
      sql`${table.endReason} is null or ${table.endReason} in (${sql.raw(
        rtcEndReasons.map((reason) => `'${reason}'`).join(', '),
      )})`,
    ),
    check(
      'realtime_sessions_pair_order_check',
      sql`${table.pairLowId} < ${table.pairHighId}`,
    ),
    // The initiator is one of the two people, not a third party.
    check(
      'realtime_sessions_initiator_check',
      sql`${table.initiatorId} in (${table.pairLowId}, ${table.pairHighId})`,
    ),
    check(
      'realtime_sessions_generation_check',
      sql`${table.authorizationGeneration} >= 1`,
    ),
    // A terminal state and the reason it ended are written together. A live
    // call has neither; a finished one has both.
    check(
      'realtime_sessions_terminal_shape_check',
      sql`(${table.state} = any (array[${sql.raw(
        terminalRtcSessionStates.map((state) => `'${state}'`).join(', '),
      )}]::text[])) = (${table.endedAt} is not null)`,
    ),
    check(
      'realtime_sessions_end_reason_shape_check',
      sql`(${table.endedAt} is null) = (${table.endReason} is null)`,
    ),
    // Acceptance precedes connection, and connection precedes the end. A row
    // that says otherwise is a record of something that did not happen.
    check(
      'realtime_sessions_accepted_order_check',
      sql`${table.acceptedAt} is null or ${table.acceptedAt} >= ${table.createdAt}`,
    ),
    check(
      'realtime_sessions_connected_order_check',
      sql`${table.connectedAt} is null or ${table.acceptedAt} is not null`,
    ),
    check(
      'realtime_sessions_ended_order_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.createdAt}`,
    ),
    // Media cannot have been observed before the call was answered, and a call
    // that was never answered cannot hold a connection instant.
    check(
      'realtime_sessions_connected_after_accepted_check',
      sql`${table.connectedAt} is null or ${table.connectedAt} >= ${table.acceptedAt}`,
    ),
  ],
);

/**
 * Exactly who is authorized to take part, and on which side.
 *
 * Two rows per session, distinct people, one of each role — enforced by the two
 * unique indexes below, by the ordered pair on the session, and by both rows
 * being written by the same statement that writes the session. A call with one
 * participant, three participants, or the same person twice cannot be recorded.
 *
 * Membership is a row rather than a column pair on the session because every
 * authorization decision in this domain is "is this person a participant of
 * this call, and on which side", and that should be an index lookup rather than
 * a comparison against two columns whose meaning depends on identifier
 * ordering.
 *
 * The timestamps here are operational observations, not permissions.
 * `acceptedAt` is the one platform fact among them and is written by the
 * transition that accepts; `joinedAt` and `leftAt` record what a provider
 * observed and decide nothing.
 */
export const realtimeParticipants = pgTable(
  'realtime_participants',
  {
    /** Platform fact: this person answered. Never taken from a provider. */
    acceptedAt: timestamptz('accepted_at'),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invitedAt: timestamptz('invited_at').notNull(),
    /** Operational observation of media, where a provider is authoritative. */
    joinedAt: timestamptz('joined_at'),
    leftAt: timestamptz('left_at'),
    role: text('role').notNull().$type<RtcParticipantRole>(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => realtimeSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
  },
  (table) => [
    uniqueIndex('realtime_participants_membership_uk').on(
      table.sessionId,
      table.userId,
    ),
    // One caller and one recipient. This is what stops a third row appearing on
    // a session, whatever a caller supplies.
    uniqueIndex('realtime_participants_role_uk').on(
      table.sessionId,
      table.role,
    ),
    // "Which calls is this person in", the other direction of the same
    // question, and the read a person's own call list uses.
    index('realtime_participants_user_idx').on(table.userId),
    check(
      'realtime_participants_role_check',
      inList(table.role, rtcParticipantRoles),
    ),
    check(
      'realtime_participants_accepted_order_check',
      sql`${table.acceptedAt} is null or ${table.acceptedAt} >= ${table.invitedAt}`,
    ),
    check(
      'realtime_participants_joined_order_check',
      sql`${table.joinedAt} is null or ${table.joinedAt} >= ${table.invitedAt}`,
    ),
    // Somebody cannot have left a call they never joined.
    check(
      'realtime_participants_left_shape_check',
      sql`${table.leftAt} is null or ${table.joinedAt} is not null`,
    ),
    check(
      'realtime_participants_left_order_check',
      sql`${table.leftAt} is null or ${table.leftAt} >= ${table.joinedAt}`,
    ),
  ],
);
