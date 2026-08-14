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
import { outboxTable } from '../events/outbox-table.js';
import {
  maximumClientMessageIdCharacters,
  maximumMessageBodyCharacters,
  minimumClientMessageIdCharacters,
} from './policy.js';

/**
 * MESSAGING-owned persistence.
 *
 * MESSAGING owns conversations, participant membership, messages, and read
 * state. It owns no connection truth, no block, and no enforcement decision:
 * whether two people are introduced belongs to DISCOVERY and whether they may
 * still communicate belongs to TRUST & SAFETY, and this domain asks both of
 * them rather than storing its own copy of either answer.
 *
 * References to consumer accounts and to the introduction that authorized a
 * conversation are opaque identifiers with no foreign key, on the rule Phase 1
 * recorded in `docs/architecture/05-data-ownership.md`.
 *
 * **End-to-end encryption is not implemented.** A message body is stored in a
 * form the server can read. That is a deliberate V1 posture, not an oversight:
 * moderation, reporting, and lawful safety review need server-side product
 * authority over message content, and a hand-rolled encryption scheme would
 * trade a real safety capability for a claim nobody could verify. No surface
 * built on these tables may describe messaging as end-to-end encrypted.
 *
 * Retention duration is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. Nothing
 * here expires, and no correctness rule in this domain depends on a row being
 * physically deleted, so whatever duration is eventually approved can be
 * applied without changing how messaging behaves. See
 * `docs/domains/messaging.md` for exactly what this blocks in production.
 */

/**
 * `closed` is reachable only from enforcement or account lifecycle, neither of
 * which exists yet. It is in the vocabulary because a client has to be able to
 * render an ended conversation, and because adding the state later would mean
 * rewriting rows that already say `active`.
 */
export const conversationStates = ['active', 'closed'] as const;
export type ConversationState = (typeof conversationStates)[number];

/**
 * A direct conversation between two people.
 *
 * The pair is normalized to an ordered low and high identifier, the same
 * convention DISCOVERY uses, so the same two people are the same conversation
 * whichever of them opens it. One conversation per pair, for the life of the
 * pair: a pair that is introduced again resumes the conversation it already
 * had rather than acquiring a second thread beside it. Hiding or discarding the
 * earlier history instead would be a retention decision, and no retention
 * decision is approved.
 *
 * `messageSequence` is the allocator for message ordering. Holding it on the
 * conversation makes ordering a server fact decided under a row lock, rather
 * than a comparison of clocks nobody controls.
 */
export const messagingConversations = pgTable(
  'messaging_conversations',
  {
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    /** Creation instant until the first message, so a list never sorts nulls. */
    lastActivityAt: timestamptz('last_activity_at').notNull(),
    /** Highest sequence handed out so far. Never decreases. */
    messageSequence: bigint('message_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    /** The mutual introduction that authorized this conversation to exist. */
    originIntroductionId: uuid('origin_introduction_id').notNull(),
    pairHighId: uuid('pair_high_id').notNull(),
    pairLowId: uuid('pair_low_id').notNull(),
    state: text('state').notNull().$type<ConversationState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // One conversation per pair, ever. This is also what makes creation
    // idempotent without a client key: a second attempt loses to the index and
    // then reads the conversation that already exists.
    uniqueIndex('messaging_conversations_pair_uk').on(
      table.pairLowId,
      table.pairHighId,
    ),
    // Listing one person's conversations, most recently active first, from
    // either side of the ordered pair.
    index('messaging_conversations_low_activity_idx').on(
      table.pairLowId,
      table.lastActivityAt,
    ),
    index('messaging_conversations_high_activity_idx').on(
      table.pairHighId,
      table.lastActivityAt,
    ),
    check(
      'messaging_conversations_state_check',
      inList(table.state, conversationStates),
    ),
    check(
      'messaging_conversations_pair_order_check',
      sql`${table.pairLowId} < ${table.pairHighId}`,
    ),
    check(
      'messaging_conversations_sequence_check',
      sql`${table.messageSequence} >= 0`,
    ),
    check(
      'messaging_conversations_activity_check',
      sql`${table.lastActivityAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * Membership, and the one piece of per-person state a conversation carries.
 *
 * Membership is a row rather than a column pair on the conversation because
 * every authorization decision in this domain is "is this person in this
 * conversation", and that question should be an index lookup rather than a
 * comparison against two columns whose meaning depends on identifier ordering.
 *
 * `lastReadSequence` is monotonic. A client that acknowledges an older position
 * than the one already stored changes nothing, so a retry or an out-of-order
 * delivery can never un-read a conversation.
 */
export const messagingParticipants = pgTable(
  'messaging_participants',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => messagingConversations.id, { onDelete: 'cascade' }),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    joinedAt: timestamptz('joined_at').notNull(),
    lastReadAt: timestamptz('last_read_at'),
    lastReadSequence: bigint('last_read_sequence', { mode: 'number' })
      .notNull()
      .default(0),
    userId: uuid('user_id').notNull(),
  },
  (table) => [
    uniqueIndex('messaging_participants_membership_uk').on(
      table.conversationId,
      table.userId,
    ),
    // "Which conversations is this person in", the other direction of the same
    // question.
    index('messaging_participants_user_idx').on(table.userId),
    check(
      'messaging_participants_read_sequence_check',
      sql`${table.lastReadSequence} >= 0`,
    ),
    // A read position and the moment it was recorded arrive together.
    check(
      'messaging_participants_read_shape_check',
      sql`(${table.lastReadSequence} = 0) or (${table.lastReadAt} is not null)`,
    ),
  ],
);

/**
 * One message.
 *
 * `sequence` is the total order within a conversation. It is assigned by the
 * server from the conversation's allocator under a row lock, so two people
 * sending at the same instant receive distinct adjacent positions and neither
 * client's clock participates. It is unique but not contiguous: a position is
 * consumed when a message is written, and nothing renumbers.
 *
 * `clientMessageId` is the caller's idempotency key, scoped to the conversation
 * and the sender. The unique index is what makes a send idempotent — not a
 * prior read, which two concurrent retries would both pass.
 */
export const messagingMessages = pgTable(
  'messaging_messages',
  {
    body: text('body').notNull(),
    clientMessageId: text('client_message_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => messagingConversations.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    senderId: uuid('sender_id').notNull(),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    // The server's total order, enforced rather than assumed.
    uniqueIndex('messaging_messages_order_uk').on(
      table.conversationId,
      table.sequence,
    ),
    // Idempotency, decided by the database.
    uniqueIndex('messaging_messages_client_id_uk').on(
      table.conversationId,
      table.senderId,
      table.clientMessageId,
    ),
    index('messaging_messages_sender_idx').on(table.senderId),
    check('messaging_messages_sequence_check', sql`${table.sequence} >= 1`),
    // The wire contract bounds a body; so does the database, because a bound
    // enforced in one place is a bound that can be bypassed from another.
    check(
      'messaging_messages_body_check',
      sql`char_length(${table.body}) between 1 and ${sql.raw(String(maximumMessageBodyCharacters))} and btrim(${table.body}) <> ''`,
    ),
    check(
      'messaging_messages_client_id_check',
      sql`char_length(${table.clientMessageId}) between ${sql.raw(String(minimumClientMessageIdCharacters))} and ${sql.raw(String(maximumClientMessageIdCharacters))}`,
    ),
  ],
);

/**
 * MESSAGING's transactional outbox.
 *
 * It is inside `messaging_` because the fact and the message it describes have
 * to commit together, and only this domain's transaction can do that. A fact
 * written anywhere else — a queue, another domain's table, a second connection —
 * would be a second commit, and a process killed between the two would leave a
 * message somebody was never told about. That is the exact failure this table
 * exists to make impossible.
 *
 * NOTIFICATIONS never reads it. The relay in `src/events/relay.ts` drains it
 * and hands each fact to whichever consumer registered for that event name.
 */
export const messagingOutbox = outboxTable('messaging_outbox');
