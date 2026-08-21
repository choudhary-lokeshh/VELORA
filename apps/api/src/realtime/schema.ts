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

import { inList, nullablePairing, timestamptz } from '../database/columns.js';
import { outboxTable } from '../events/outbox-table.js';
import {
  maximumRtcIdempotencyKeyLength,
  maximumRtcProviderReferenceLength,
  rtcCallMediums,
  rtcEndReasons,
  rtcParticipantRoles,
  rtcProviderObligationStates,
  rtcProviderObligations,
  rtcSessionStates,
  terminalRtcSessionStates,
  type RtcCallMedium,
  type RtcEndReason,
  type RtcParticipantRole,
  type RtcProviderObligation,
  type RtcProviderObligationState,
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
    /** Adapter carrying this call. Configuration, never a request field. */
    provider: text('provider'),
    providerBoundAt: timestamptz('provider_bound_at'),
    /**
     * Committed before the provider is ever contacted, which is what makes an
     * ambiguous create answerable: the platform asks what the provider did
     * with this key rather than creating a second room.
     */
    providerIdempotencyKey: text('provider_idempotency_key'),
    /** The provider's own handle for the session. Opaque, and never public. */
    providerReference: text('provider_reference'),
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
    // One provider room per key. The key is committed before the provider is
    // contacted, so this is what stops a retry creating a second room.
    uniqueIndex('realtime_sessions_provider_key_uk').on(
      table.providerIdempotencyKey,
    ),
    // One session per provider room. A provider reference arriving for a
    // session that already holds a different one is a binding error, not a
    // second attempt.
    uniqueIndex('realtime_sessions_provider_reference_uk').on(
      table.provider,
      table.providerReference,
    ),
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
    // A provider reference and the moment it was bound arrive together.
    check(
      'realtime_sessions_provider_binding_shape_check',
      nullablePairing(table.providerReference, table.providerBoundAt),
    ),
    // A bound reference belongs to a named adapter. A reference with no
    // provider could not be acted on later.
    check(
      'realtime_sessions_provider_named_check',
      sql`${table.providerReference} is null or ${table.provider} is not null`,
    ),
    check(
      'realtime_sessions_provider_reference_length_check',
      sql`${table.providerReference} is null or char_length(${table.providerReference}) between 1 and ${sql.raw(
        String(maximumRtcProviderReferenceLength),
      )}`,
    ),
    check(
      'realtime_sessions_provider_key_length_check',
      sql`${table.providerIdempotencyKey} is null or char_length(${table.providerIdempotencyKey}) between 1 and ${sql.raw(
        String(maximumRtcIdempotencyKeyLength),
      )}`,
    ),
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

/**
 * What the platform owes a provider and has not yet managed to do.
 *
 * A call ends on the platform the moment its terminal state commits. Whether
 * the provider has torn anything down is a separate question with a separate
 * answer, and the gap between them is where rooms leak and revoked
 * participants keep talking. This table is that gap made durable.
 *
 * An obligation is written by the same transaction as the decision that
 * created it, so a process killed immediately afterwards leaves the obligation
 * rather than losing it. It is claimed by lease, attempted outside every
 * transaction, and settled by a state transition — the same shape the outbox
 * relay uses, for the same reason: a claim that lives in memory does not
 * survive the worker that took it.
 *
 * Rows are never deleted. A discharged obligation is evidence the provider was
 * told; an abandoned one is evidence it was not, and that is exactly what an
 * operator investigating a room that outlived its call needs to see.
 */
export const realtimeProviderObligations = pgTable(
  'realtime_provider_obligations',
  {
    attempts: integer('attempts').notNull().default(0),
    /** Not claimable before this instant. Retry backoff is written here. */
    availableAt: timestamptz('available_at').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    dischargedAt: timestamptz('discharged_at'),
    /** A redacted code, never a provider message. */
    failureReason: text('failure_reason'),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull().$type<RtcProviderObligation>(),
    leaseExpiresAt: timestamptz('lease_expires_at'),
    leaseOwner: text('lease_owner'),
    /** Present only for an obligation about one participant. */
    participantReference: text('participant_reference'),
    provider: text('provider').notNull(),
    providerReference: text('provider_reference').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => realtimeSessions.id, { onDelete: 'cascade' }),
    state: text('state').notNull().$type<RtcProviderObligationState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // The worker's only hot query: the oldest claimable obligations. Partial,
    // so a table holding a year of discharged history still answers it from an
    // index the size of the backlog.
    index('realtime_provider_obligations_claimable_idx')
      .on(table.id)
      .where(sql`${table.state} = 'pending'`),
    index('realtime_provider_obligations_session_idx').on(table.sessionId),
    check(
      'realtime_provider_obligations_kind_check',
      inList(table.kind, rtcProviderObligations),
    ),
    check(
      'realtime_provider_obligations_state_check',
      inList(table.state, rtcProviderObligationStates),
    ),
    check(
      'realtime_provider_obligations_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
    check(
      'realtime_provider_obligations_lease_shape_check',
      nullablePairing(table.leaseOwner, table.leaseExpiresAt),
    ),
    // A lease belongs to a row somebody may still be working on. A settled row
    // holding one would be indistinguishable from a live claim.
    check(
      'realtime_provider_obligations_lease_state_check',
      sql`${table.leaseOwner} is null or ${table.state} = 'pending'`,
    ),
    check(
      'realtime_provider_obligations_discharged_shape_check',
      sql`(${table.state} = 'discharged') = (${table.dischargedAt} is not null)`,
    ),
    // Only a participant obligation names a participant.
    check(
      'realtime_provider_obligations_participant_shape_check',
      sql`(${table.kind} = 'revoke_participant') = (${table.participantReference} is not null)`,
    ),
    check(
      'realtime_provider_obligations_reference_length_check',
      sql`char_length(${table.providerReference}) between 1 and ${sql.raw(
        String(maximumRtcProviderReferenceLength),
      )}`,
    ),
  ],
);

/**
 * That a join credential was issued, and to whom.
 *
 * Append-only evidence, and deliberately not the credential. What a later
 * question needs — was anybody admitted to this call, when, under which
 * authorization generation, and when did it stop working — is answerable from
 * these columns, and none of them is a secret. The credential itself exists for
 * the length of one response and is written nowhere.
 *
 * It is what the abuse limits count and what an operator reads when asking
 * whether a call somebody reported was ever actually joined.
 */
export const realtimeJoinIssuances = pgTable(
  'realtime_join_issuances',
  {
    /** The generation in force when this was minted. */
    authorizationGeneration: integer('authorization_generation').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    issuedAt: timestamptz('issued_at').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => realtimeSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
  },
  (table) => [
    index('realtime_join_issuances_session_idx').on(table.sessionId),
    // "How many credentials has this person been issued lately", which is the
    // question the abuse limits ask.
    index('realtime_join_issuances_user_idx').on(table.userId, table.issuedAt),
    check(
      'realtime_join_issuances_generation_check',
      sql`${table.authorizationGeneration} >= 1`,
    ),
    // A credential that never expires is not a short-lived credential.
    check(
      'realtime_join_issuances_expiry_check',
      sql`${table.expiresAt} > ${table.issuedAt}`,
    ),
  ],
);

/**
 * REALTIME's transactional outbox.
 *
 * Inside `realtime_` because the fact and the call it describes have to commit
 * together, and only this domain's transaction can do that. A fact written
 * anywhere else — a queue, another domain's table, a second connection — would
 * be a second commit, and a process killed between the two would leave somebody
 * being called and nobody told about it.
 *
 * NOTIFICATIONS never reads it. The relay drains it and hands each fact to
 * whichever consumer registered for that event name.
 */
export const realtimeOutbox = outboxTable('realtime_outbox');
