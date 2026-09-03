import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, timestamptz } from '../database/columns.js';
import {
  liveEncounterStates,
  liveEndReasons,
  liveInvitationStates,
  liveMediums,
  liveMessageKinds,
  liveParticipationStates,
  livePreferredRegions,
  liveReactions,
  maximumLiveClientMessageIdCharacters,
  maximumLiveMessageBodyCharacters,
  minimumLiveClientMessageIdCharacters,
  type LiveEncounterState,
  type LiveEndReason,
  type LiveInvitationState,
  type LiveMedium,
  type LiveMessageKind,
  type LiveParticipationState,
  type LivePreferredRegion,
} from './policy.js';

/**
 * LIVE-owned persistence.
 *
 * LIVE owns who is waiting to meet somebody at random, which two people were
 * put together, and what they typed to each other while they were together. It
 * owns no principal, no account standing, no relationship, no block, no
 * enforcement decision, no call session, and no conversation: those belong to
 * AUTH, USERS, DISCOVERY, TRUST & SAFETY, REALTIME, and MESSAGING, and this
 * domain asks each of them at the moment of the action rather than storing its
 * own copy of any answer. There is deliberately no `eligible` column anywhere
 * below, for the same reason REALTIME has none.
 *
 * References to consumer accounts, to the RTC session carrying an encounter,
 * and to the introduction two people may have signalled are opaque identifiers
 * with no foreign key, on the rule Phase 1 recorded in
 * `docs/architecture/05-data-ownership.md`.
 *
 * **Nothing here is media.** No recording, transcript, frame, SDP, ICE
 * candidate, TURN credential, or participant address has a column, and a test
 * enumerates every column and asserts it. What is durable is who waited, who
 * met whom, when, and why it ended — plus the text they exchanged, which is
 * durable because moderating a report about it is impossible otherwise, and
 * which is deliberately not a conversation.
 *
 * **There is no outbox here, and that is deliberate.** Everything durable a
 * live encounter produces is somebody else's fact: an introduction is
 * DISCOVERY's and it publishes it, a conversation is MESSAGING's, a call is
 * REALTIME's. LIVE publishes nothing of its own, so a table for facts it does
 * not have would be a table that eventually acquired one.
 *
 * Retention is `DECISION REQUIRED / LEGAL REVIEW REQUIRED` for both encounters
 * and messages. Nothing expires, and no correctness rule depends on a row being
 * physically deleted.
 */

/**
 * Somebody's presence in the matching pool.
 *
 * One row per time a person entered it, rather than one row per person for
 * ever. A `left` participation stays, which is what makes "how long do people
 * wait, and how often do they leave without meeting anybody" answerable later
 * without a second table — and it keeps the guarantee that matters as a single
 * partial unique index rather than as a rule every writer has to remember.
 *
 * `seenAt` is the only presence signal this platform has. There is no presence
 * projection and no gateway: a client that is reading is present, and one that
 * has stopped reading is not. It decides when a stale searcher is dropped and
 * when an unattended encounter is closed, and it is never published as a count
 * of anybody.
 */
export const liveParticipations = pgTable(
  'live_participations',
  {
    /**
     * The encounter this person was allocated to.
     *
     * Kept after the encounter ends, until the person searches again or leaves,
     * so a surface can say who they were talking to and what became of it.
     */
    encounterId: uuid('encounter_id'),
    id: uuid('id').primaryKey(),
    joinedAt: timestamptz('joined_at').notNull(),
    /** What this person entered the pool for. Never changed by a match. */
    medium: text('medium').notNull().$type<LiveMedium>(),
    /**
     * How wide a net to cast for this person, as they asked for it.
     *
     * A preference the matcher applies, kept on the participation rather than
     * on the account, because it is a property of *this* search: somebody who
     * narrowed to one language yesterday should not silently still be narrowed
     * tomorrow. It is re-declared every time the pool is entered, and entering
     * without one means `any`.
     *
     * Only the preference is stored. Which country somebody is in and what
     * they speak stay in USERS and are asked of it per batch of candidates —
     * a copy here would be this domain holding a fact it does not own, and one
     * that would go stale the moment somebody moved or learned a language.
     */
    preferredLanguage: text('preferred_language'),
    preferredRegion: text('preferred_region')
      .notNull()
      .$type<LivePreferredRegion>()
      .default('any'),
    /** Last time this person's client was heard from. Presence, not a lease. */
    seenAt: timestamptz('seen_at').notNull(),
    /** Durable total order; timestamps and random UUIDs can tie. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    state: text('state').notNull().$type<LiveParticipationState>(),
    /**
     * When the current state began.
     *
     * Separate from `updated_at`, which moves for any write — a heartbeat moves
     * `updated_at` and `seen_at` several times a minute, and "how long has this
     * person been searching" must not be reset by one.
     */
    stateEnteredAt: timestamptz('state_entered_at').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    userId: uuid('user_id').notNull(),
  },
  (table) => [
    // One live participation per person, ever. This is what makes entering the
    // pool idempotent without a client key, and what makes "one account cannot
    // hold two random matches" a property of the database rather than of
    // whichever code path happened to check first.
    uniqueIndex('live_participations_live_user_uk')
      .on(table.userId)
      .where(sql`${table.state} <> 'left'`),
    // The matcher's only hot query: who has been waiting longest. Partial, so a
    // history of finished participations never enters the plan.
    index('live_participations_waiting_idx')
      .on(table.stateEnteredAt)
      .where(sql`${table.state} = 'searching'`),
    // The sweep's query: live participations whose client has gone quiet.
    index('live_participations_presence_idx')
      .on(table.seenAt)
      .where(sql`${table.state} <> 'left'`),
    uniqueIndex('live_participations_sequence_uk').on(table.sequence),
    index('live_participations_encounter_idx')
      .on(table.encounterId)
      .where(sql`${table.encounterId} is not null`),
    check(
      'live_participations_state_check',
      inList(table.state, liveParticipationStates),
    ),
    check(
      'live_participations_medium_check',
      inList(table.medium, liveMediums),
    ),
    check(
      'live_participations_preferred_region_check',
      inList(table.preferredRegion, livePreferredRegions),
    ),
    // Being in or just out of an encounter, and naming one, are the same fact.
    // A `searching` row holding an encounter identifier would be a person the
    // matcher could hand to somebody else while they were still on the previous
    // encounter's screen.
    check(
      'live_participations_encounter_shape_check',
      sql`(${table.state} in ('matched', 'ended')) = (${table.encounterId} is not null)`,
    ),
    check(
      'live_participations_seen_order_check',
      sql`${table.seenAt} >= ${table.joinedAt}`,
    ),
    check(
      'live_participations_state_order_check',
      sql`${table.stateEnteredAt} >= ${table.joinedAt}`,
    ),
  ],
);

/**
 * Two strangers, put together by the server.
 *
 * The pair is normalized to an ordered low and high identifier, the same
 * convention DISCOVERY, MESSAGING, and REALTIME use, so the same two people are
 * the same pair whichever of them the matcher happened to be serving. Unlike a
 * conversation there may be many encounters per pair over time — meeting is an
 * event, not a relationship — so the uniqueness below is scoped to the live one.
 *
 * `endedById` is what separates "you moved on" from "they moved on" without
 * either being inferred from a timestamp comparison. It is null for an
 * encounter the platform ended, which is exactly the case where neither person
 * decided anything and neither may be told the other did.
 *
 * `realtimeSessionId` is a reference and never an authority. REALTIME decides
 * what that session may do; this column only records which one was opened, so
 * ending the encounter can ask REALTIME to end it and a later question about a
 * reported encounter can find the call it happened in.
 */
export const liveEncounters = pgTable(
  'live_encounters',
  {
    createdAt: timestamptz('created_at').notNull(),
    endReason: text('end_reason').$type<LiveEndReason>(),
    /** Which of the two ended it, when one of them did. */
    endedById: uuid('ended_by_id'),
    endedAt: timestamptz('ended_at'),
    id: uuid('id').primaryKey(),
    /** What both people entered the pool for. Agreed at allocation. */
    medium: text('medium').notNull().$type<LiveMedium>(),
    /** Highest message position handed out so far. Never decreases. */
    messageSequence: bigint('message_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    pairHighId: uuid('pair_high_id').notNull(),
    pairLowId: uuid('pair_low_id').notNull(),
    /** The RTC session opened for this encounter, once one has been. */
    realtimeSessionId: uuid('realtime_session_id'),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    state: text('state').notNull().$type<LiveEncounterState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // One live encounter per pair. Two matchers racing on the same two people
    // produce one encounter and the loser reads it, exactly as the live-call
    // and conversation indexes do for their domains.
    uniqueIndex('live_encounters_live_pair_uk')
      .on(table.pairLowId, table.pairHighId)
      .where(sql`${table.state} = 'live'`),
    // "Has this pair met recently", which is the rematch-suppression question.
    index('live_encounters_pair_recency_idx').on(
      table.pairLowId,
      table.pairHighId,
      table.createdAt,
    ),
    // "How many encounters has this person had lately", which is what the abuse
    // bound asks, from either side of the ordered pair.
    index('live_encounters_low_recency_idx').on(
      table.pairLowId,
      table.createdAt,
    ),
    index('live_encounters_high_recency_idx').on(
      table.pairHighId,
      table.createdAt,
    ),
    // "Who did this person just finish meeting", from either side of the
    // ordered pair. Keyed on when it *ended* rather than when it started,
    // because that is what "just met" means to somebody reaching for a report,
    // and partial on the finished state so live encounters never enter the
    // plan. Two indexes rather than one because the pair is ordered and a
    // caller is on whichever side of it they happen to be.
    index('live_encounters_low_ended_idx')
      .on(table.pairLowId, table.endedAt)
      .where(sql`${table.state} = 'ended'`),
    index('live_encounters_high_ended_idx')
      .on(table.pairHighId, table.endedAt)
      .where(sql`${table.state} = 'ended'`),
    uniqueIndex('live_encounters_sequence_uk').on(table.sequence),
    // One encounter per RTC session. A session reference arriving for a second
    // encounter is a binding error rather than a second attempt.
    uniqueIndex('live_encounters_session_uk').on(table.realtimeSessionId),
    check(
      'live_encounters_state_check',
      inList(table.state, liveEncounterStates),
    ),
    check('live_encounters_medium_check', inList(table.medium, liveMediums)),
    check(
      'live_encounters_pair_order_check',
      sql`${table.pairLowId} < ${table.pairHighId}`,
    ),
    // An ended encounter and the reason it ended are written together. A live
    // one has neither; a finished one has both.
    check(
      'live_encounters_terminal_shape_check',
      sql`(${table.state} = 'ended') = (${table.endedAt} is not null)`,
    ),
    check(
      'live_encounters_end_reason_shape_check',
      sql`(${table.endedAt} is null) = (${table.endReason} is null)`,
    ),
    check(
      'live_encounters_end_reason_check',
      sql`${table.endReason} is null or ${sql.raw(
        `end_reason in (${liveEndReasons.map((reason) => `'${reason}'`).join(', ')})`,
      )}`,
    ),
    // Only somebody who was in it can have ended it, and only a departure names
    // anybody: a presence lapse, a failed session, and a safety decision are
    // all the platform acting, and recording one of the two people as the actor
    // would be a record of a decision they did not take.
    check(
      'live_encounters_ended_by_check',
      sql`${table.endedById} is null or (${table.endReason} = 'departed' and ${table.endedById} in (${table.pairLowId}, ${table.pairHighId}))`,
    ),
    check(
      'live_encounters_ended_order_check',
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.createdAt}`,
    ),
    check('live_encounters_sequence_check', sql`${table.messageSequence} >= 0`),
  ],
);

/**
 * What two strangers typed to each other while they were together.
 *
 * **This is not a conversation and must never become one.** It belongs to the
 * encounter, it is read through LIVE's own contract, and no code path copies it
 * into `messaging_messages`. Durable messaging begins when two people are
 * mutually connected, and a pair that ends an encounter without connecting
 * leaves nothing in either Inbox — which is the product rule the brief is
 * built on and the reason this table exists rather than a `conversationId`
 * being borrowed for a few minutes.
 *
 * It is durable anyway, because a report about what somebody said in a live
 * encounter is unanswerable if the platform threw the words away, and because
 * a message that vanished when the encounter ended would be a message a person
 * could not screenshot but a platform could not review. Retention is
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.
 *
 * `sequence` is the total order within an encounter, assigned by the server
 * from the encounter's allocator under a row lock, so two people typing at the
 * same instant get distinct adjacent positions and neither client's clock
 * participates. `clientMessageId` is the caller's idempotency key, scoped to
 * the encounter and the sender; the unique index is what makes a send
 * idempotent, not a prior read that two concurrent retries would both pass.
 */
export const liveMessages = pgTable(
  'live_messages',
  {
    body: text('body').notNull(),
    clientMessageId: text('client_message_id').notNull(),
    createdAt: timestamptz('created_at').notNull(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => liveEncounters.id, { onDelete: 'cascade' }),
    id: uuid('id').primaryKey(),
    /**
     * Whether this line was typed or tapped.
     *
     * One table for both, because both are things one of these two people sent
     * the other during this encounter and both have to be ordered, idempotent,
     * and answerable when somebody reports the conversation. What separates
     * them is rendering, not storage: a reaction is a moment on the video, not
     * a line of transcript.
     */
    kind: text('kind').notNull().$type<LiveMessageKind>().default('text'),
    senderId: uuid('sender_id').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('live_messages_order_uk').on(table.encounterId, table.sequence),
    uniqueIndex('live_messages_client_id_uk').on(
      table.encounterId,
      table.senderId,
      table.clientMessageId,
    ),
    index('live_messages_sender_idx').on(table.senderId),
    check('live_messages_sequence_check', sql`${table.sequence} >= 1`),
    // The wire contract bounds a body; so does the database, because a bound
    // enforced in one place is a bound that can be bypassed from another.
    check(
      'live_messages_body_check',
      sql`char_length(${table.body}) between 1 and ${sql.raw(String(maximumLiveMessageBodyCharacters))} and btrim(${table.body}) <> ''`,
    ),
    check(
      'live_messages_client_id_check',
      sql`char_length(${table.clientMessageId}) between ${sql.raw(String(minimumLiveClientMessageIdCharacters))} and ${sql.raw(String(maximumLiveClientMessageIdCharacters))}`,
    ),
    check('live_messages_kind_check', inList(table.kind, liveMessageKinds)),
    // A reaction's body is one of the closed set and never anything else. The
    // route refuses everything else first; this is what makes "a reaction is
    // not a text channel" a property of the database rather than of whichever
    // handler happened to be called.
    check(
      'live_messages_reaction_body_check',
      sql`${table.kind} <> 'reaction' or ${sql.raw(
        `body in (${liveReactions.map((reaction) => `'${reaction}'`).join(', ')})`,
      )}`,
    ),
  ],
);

/**
 * One person asking one other person to meet live.
 *
 * The counterpart to the pool: the pool is the server choosing, and this is a
 * person choosing. It is a *request*, and every state below is a truthful
 * position in the life of one — including `accepted`, which means both people
 * agreed and are not both here yet. Accepting cannot conjure a live session out
 * of somebody who has closed the tab, so the model says so rather than
 * pretending.
 *
 * The pair is normalized to an ordered low and high identifier like every other
 * pair in this repository, and `inviterId` records which of the two asked. The
 * partial unique index is what makes asking twice idempotent and what stops two
 * people asking each other producing two competing requests: whoever writes
 * first owns the open one, and the other side answers it rather than opening a
 * second.
 *
 * **It authorizes nothing.** An accepted request is a reason to pair these two
 * *first*; every eligibility, standing, block, enforcement, and RTC predicate
 * the random matcher asks is asked again, in the same order, when the encounter
 * is allocated. There is deliberately no column here that could be read as a
 * grant.
 */
export const liveInvitations = pgTable(
  'live_invitations',
  {
    createdAt: timestamptz('created_at').notNull(),
    /** When this stops being answerable. Evaluated on read, never swept. */
    expiresAt: timestamptz('expires_at').notNull(),
    id: uuid('id').primaryKey(),
    /** Which of the two asked. Always one of the pair. */
    inviterId: uuid('inviter_id').notNull(),
    /** What the asker offered. The answerer accepts that or nothing. */
    medium: text('medium').notNull().$type<LiveMedium>(),
    pairHighId: uuid('pair_high_id').notNull(),
    pairLowId: uuid('pair_low_id').notNull(),
    /** When it stopped being open, whichever way it stopped. */
    resolvedAt: timestamptz('resolved_at'),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    state: text('state').notNull().$type<LiveInvitationState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // One open request per pair, in either direction. Two people asking each
    // other at the same instant produce one request that one of them then
    // accepts, rather than two neither can resolve.
    uniqueIndex('live_invitations_open_pair_uk')
      .on(table.pairLowId, table.pairHighId)
      .where(sql`${table.state} in ('pending', 'accepted')`),
    // The read behind the surface: what is open for this person, either way.
    index('live_invitations_low_open_idx')
      .on(table.pairLowId, table.updatedAt)
      .where(sql`${table.state} in ('pending', 'accepted')`),
    index('live_invitations_high_open_idx')
      .on(table.pairHighId, table.updatedAt)
      .where(sql`${table.state} in ('pending', 'accepted')`),
    // "How many has this person sent lately", which is what the bound asks.
    index('live_invitations_inviter_recency_idx').on(
      table.inviterId,
      table.createdAt,
    ),
    uniqueIndex('live_invitations_sequence_uk').on(table.sequence),
    check(
      'live_invitations_state_check',
      inList(table.state, liveInvitationStates),
    ),
    check('live_invitations_medium_check', inList(table.medium, liveMediums)),
    check(
      'live_invitations_pair_order_check',
      sql`${table.pairLowId} < ${table.pairHighId}`,
    ),
    check(
      'live_invitations_inviter_check',
      sql`${table.inviterId} in (${table.pairLowId}, ${table.pairHighId})`,
    ),
    // Open and resolved are the two shapes, and a row is exactly one of them.
    check(
      'live_invitations_resolved_shape_check',
      sql`(${table.state} in ('pending', 'accepted')) = (${table.resolvedAt} is null)`,
    ),
    check(
      'live_invitations_expiry_order_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);
