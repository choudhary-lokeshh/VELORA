import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, nullablePairing, timestamptz } from '../database/columns.js';
import {
  attemptOutcomes,
  notificationChannels,
  notificationKinds,
  notificationPurposes,
  notificationStates,
  suppressionReasons,
} from './policy.js';

/**
 * NOTIFICATIONS-owned persistence.
 *
 * These tables are the authoritative record of what the platform owes a
 * person and what it did about it. `docs/domains/notifications.md` is explicit
 * that "queue completion does not define notification truth", and that is the
 * rule the schema is built around: BullMQ holds a wake-up, PostgreSQL holds the
 * intent. A queue that loses everything costs latency; it cannot cost a notice.
 *
 * References to consumer accounts and to the source event are opaque
 * identifiers with no foreign key, on the Phase 1 rule in
 * `docs/architecture/05-data-ownership.md`. This domain reads no other domain's
 * tables; whether a recipient may still be told about a subject is asked
 * through TRUST & SAFETY's and USERS' published contracts at delivery time.
 */

/**
 * One notice the platform owes one person.
 *
 * The row is created inside the relay's dispatch of a source event, which is
 * the handoff that makes durability continuous: the source fact was committed
 * with the business write, and it is not marked dispatched until this row
 * exists. There is no instant at which the obligation is only in memory.
 *
 * `sourceEventId` plus recipient and template is unique. That is the consumer
 * inbox `docs/architecture/04-contracts-events.md` requires — the relay is
 * at-least-once, so the same event arrives again whenever a worker dies after
 * this insert and before the dispatch is recorded, and the index is what makes
 * the second arrival a no-op rather than a second notification.
 *
 * `subjectId` is the other person the notice is about. It is immutable and it
 * is what the safety recheck is taken against immediately before delivery.
 */
export const notificationIntents = pgTable(
  'notifications_intents',
  {
    /** Counted when a claim is taken, before any provider call. */
    attempts: integer('attempts').notNull().default(0),
    channel: text('channel').notNull().$type<string>(),
    correlationId: text('correlation_id'),
    createdAt: timestamptz('created_at').notNull(),
    deliveredAt: timestamptz('delivered_at'),
    /**
     * After this the notice is stale. Delivery suppresses rather than sends,
     * because a push about a message from last week is worse than silence.
     */
    expiresAt: timestamptz('expires_at').notNull(),
    /** Redacted code from the last failed attempt. Never a provider message. */
    failureReason: text('failure_reason'),
    id: uuid('id').primaryKey(),
    /**
     * A claim that outlives the process holding it. Expiry is the recovery
     * path: a worker killed between claiming and sending leaves this row
     * `attempted`, and the sweeper reclaims it once the lease lapses.
     */
    leaseExpiresAt: timestamptz('lease_expires_at'),
    leaseOwner: text('lease_owner'),
    /** Not claimable before this instant. Retry backoff is written here. */
    nextAttemptAt: timestamptz('next_attempt_at').notNull(),
    /**
     * Minimized template fields. No message body, no display name, no report or
     * enforcement detail — see `docs/flows/notification-delivery.md`.
     */
    payload: jsonb('payload').notNull(),
    purpose: text('purpose').notNull().$type<string>(),
    recipientId: uuid('recipient_id').notNull(),
    /** The immutable identity of the fact that asked for this notice. */
    sourceEventId: uuid('source_event_id').notNull(),
    sourceProducer: text('source_producer').notNull(),
    state: text('state').notNull().$type<string>(),
    /** The other person the notice is about, if it is about one. */
    subjectId: uuid('subject_id'),
    suppressionReason: text('suppression_reason'),
    templateKey: text('template_key').notNull(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** Optimistic version, so two claimants produce one winner. */
    version: integer('version').notNull().default(0),
  },
  (table) => [
    // The inbox. One source event produces one notice per recipient and
    // template, however many times the relay replays it.
    uniqueIndex('notifications_intents_source_uk').on(
      table.sourceEventId,
      table.recipientId,
      table.templateKey,
    ),
    // The delivery worker's only hot query: what is due now, oldest first.
    // Partial, so a table full of delivered history stays out of it.
    index('notifications_intents_due_idx')
      .on(table.nextAttemptAt, table.createdAt)
      .where(sql`${table.state} in ('queued', 'attempted')`),
    // "Everything owed to this person", for support and for deletion.
    index('notifications_intents_recipient_idx').on(
      table.recipientId,
      table.createdAt,
    ),
    check(
      'notifications_intents_state_check',
      inList(table.state, notificationStates),
    ),
    check(
      'notifications_intents_channel_check',
      inList(table.channel, notificationChannels),
    ),
    check(
      'notifications_intents_purpose_check',
      inList(table.purpose, notificationPurposes),
    ),
    check(
      'notifications_intents_suppression_check',
      sql`${table.suppressionReason} is null or ${inList(table.suppressionReason, suppressionReasons)}`,
    ),
    check('notifications_intents_attempts_check', sql`${table.attempts} >= 0`),
    check('notifications_intents_version_check', sql`${table.version} >= 0`),
    check(
      'notifications_intents_lease_shape_check',
      nullablePairing(table.leaseOwner, table.leaseExpiresAt),
    ),
    // Only a claim in progress holds a lease. A terminal row that held one
    // would be indistinguishable from work somebody is still doing.
    check(
      'notifications_intents_lease_state_check',
      sql`${table.leaseOwner} is null or ${table.state} = 'attempted'`,
    ),
    // A delivery has an instant; a suppression has a reason. Neither state can
    // be reached without its evidence.
    check(
      'notifications_intents_delivered_shape_check',
      sql`(${table.state} = 'delivered') = (${table.deliveredAt} is not null)`,
    ),
    check(
      'notifications_intents_suppressed_shape_check',
      sql`(${table.state} = 'suppressed') = (${table.suppressionReason} is not null)`,
    ),
    check(
      'notifications_intents_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    // A notice about somebody is never a notice about the person receiving it.
    check(
      'notifications_intents_subject_check',
      sql`${table.subjectId} is null or ${table.subjectId} <> ${table.recipientId}`,
    ),
  ],
);

/**
 * What was actually tried, and what came back.
 *
 * Append-only. The intent says what is owed now; these rows say what has been
 * done about it, including the suppressions, so "why did this person never get
 * told" is answerable without inference. Retries overwrite intent state and
 * never these.
 *
 * `providerReference` is the receipt a channel returns. It is unique per
 * channel so a receipt reconciled twice updates one attempt rather than
 * creating a second one. The idempotency key sent *to* the provider is the
 * intent identifier, which is stable across every attempt: a provider that
 * honours it will not send twice even when an ambiguous timeout makes this
 * side try again.
 */
export const notificationAttempts = pgTable(
  'notifications_attempts',
  {
    attemptNumber: integer('attempt_number').notNull(),
    channel: text('channel').notNull().$type<string>(),
    createdAt: timestamptz('created_at').notNull(),
    /** A redacted code. Never a provider message, address, or device token. */
    failureReason: text('failure_reason'),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => notificationIntents.id, { onDelete: 'cascade' }),
    outcome: text('outcome').notNull().$type<string>(),
    providerReference: text('provider_reference'),
  },
  (table) => [
    uniqueIndex('notifications_attempts_number_uk').on(
      table.intentId,
      table.attemptNumber,
    ),
    // No separate index over the intent: the unique index above already leads
    // with it, so "every attempt for this notice, in order" is served by it.
    uniqueIndex('notifications_attempts_provider_uk')
      .on(table.channel, table.providerReference)
      .where(sql`${table.providerReference} is not null`),
    check(
      'notifications_attempts_outcome_check',
      inList(table.outcome, attemptOutcomes),
    ),
    check(
      'notifications_attempts_channel_check',
      inList(table.channel, notificationChannels),
    ),
    check(
      'notifications_attempts_number_check',
      sql`${table.attemptNumber} >= 1`,
    ),
    // A delivered attempt carries its receipt; a failed one carries its reason.
    check(
      'notifications_attempts_delivered_shape_check',
      sql`${table.outcome} <> 'delivered' or ${table.providerReference} is not null`,
    ),
    check(
      'notifications_attempts_failed_shape_check',
      sql`${table.outcome} <> 'failed' or ${table.failureReason} is not null`,
    ),
  ],
);

/**
 * What a person sees when they open the app.
 *
 * Deliberately a separate table from the delivery intent, because they are
 * different obligations with different failure modes. An intent is a promise to
 * hand something to somebody else's network: it has a provider, a retry budget,
 * a lease, and a terminal suppression, and once the request leaves there is no
 * recalling it. A feed row is a promise to show something on a surface the
 * platform controls: it is read on demand, so eligibility is evaluated at read
 * time and there is no in-flight window to lose a safety decision in.
 *
 * Storing the two together would mean either exposing lease and attempt state
 * to consumers or filtering it on every read, and it would tie in-app
 * visibility to whether a push provider happens to be approved. It is not, in
 * any deployed environment; the in-app surface works regardless, which is
 * exactly the separation `docs/flows/notification-delivery.md` asks for.
 *
 * Written in the same transaction as the intent, keyed the same way, so a
 * relay redelivery produces neither a second notice nor a second feed line. A
 * row is never deleted to hide it: an entry about somebody the recipient may no
 * longer interact with is filtered by the read, so the filter follows the
 * current safety answer rather than a decision frozen at write time.
 */
export const notificationFeed = pgTable(
  'notifications_feed',
  {
    /** Deep-link target for a conversation notice. */
    conversationId: uuid('conversation_id'),
    createdAt: timestamptz('created_at').notNull(),
    id: uuid('id').primaryKey(),
    /** Deep-link target for an introduction notice. */
    introductionId: uuid('introduction_id'),
    kind: text('kind').notNull().$type<string>(),
    /** Set once when the recipient acknowledges it. Never cleared. */
    readAt: timestamptz('read_at'),
    recipientId: uuid('recipient_id').notNull(),
    /** The immutable identity of the fact that produced this line. */
    sourceEventId: uuid('source_event_id').notNull(),
    /** The other person the line is about. Never the recipient. */
    subjectId: uuid('subject_id').notNull(),
    templateKey: text('template_key').notNull(),
  },
  (table) => [
    // The same inbox key the intent uses. One source event produces one line.
    uniqueIndex('notifications_feed_source_uk').on(
      table.sourceEventId,
      table.recipientId,
      table.templateKey,
    ),
    // The only read this table serves: one person's newest notices. Keyset
    // paging is on these two immutable columns, so the index answers the whole
    // query and a page boundary cannot move underneath a reader.
    index('notifications_feed_recipient_idx').on(
      table.recipientId,
      table.createdAt,
      table.id,
    ),
    check(
      'notifications_feed_kind_check',
      inList(table.kind, notificationKinds),
    ),
    check(
      'notifications_feed_subject_check',
      sql`${table.subjectId} <> ${table.recipientId}`,
    ),
    // A line has to be openable. Which target it carries is decided by its
    // kind, so a client never has to guess which field to follow.
    check(
      'notifications_feed_target_check',
      sql`case ${table.kind}
        when 'message_received' then ${table.conversationId} is not null and ${table.introductionId} is null
        when 'introduction_mutual' then ${table.introductionId} is not null and ${table.conversationId} is null
        else false
      end`,
    ),
  ],
);
