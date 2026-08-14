import { sql } from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { inList, nullablePairing, timestamptz } from '../database/columns.js';

/**
 * The transactional outbox, declared once and owned per domain.
 *
 * `docs/architecture/04-contracts-events.md` requires that owner state and the
 * fact describing it commit together: "within owner transaction, persist state
 * plus outbox record". That is the only construction under which a business
 * transition and the notification it owes cannot disagree after a crash. A
 * queue enqueue placed after the commit can be lost by a process that dies in
 * the microsecond between them; a row written by the same transaction cannot.
 *
 * The table is a factory rather than one shared table because ADR-0007 says the
 * row is *domain-owned*. MESSAGING's outbox is `messaging_outbox`, sits inside
 * `messaging_`, and is truncated, migrated, and reasoned about with the rest of
 * that domain's storage. What is shared is the shape and the relay that drains
 * it, so a second producer inherits the lease, retry, and dead-letter behaviour
 * instead of inventing a slightly different one.
 *
 * Rows are never deleted by the relay. A dispatched row is evidence that the
 * fact was published, and a dead-lettered row is evidence that it was not;
 * both are needed to answer "was this ever sent" months later. Retention is
 * `DECISION REQUIRED` and no correctness rule here depends on a row being
 * physically removed.
 */

/**
 * `pending` is claimable. `dispatched` is terminal success: every registered
 * consumer accepted the event. `dead_letter` is terminal failure, retained and
 * alerted rather than dropped, because an event that silently disappears is
 * exactly the failure this table exists to prevent.
 */
export const outboxStates = ['pending', 'dispatched', 'dead_letter'] as const;
export type OutboxState = (typeof outboxStates)[number];

export type OutboxTable = ReturnType<typeof outboxTable>;

export function outboxTable(name: string) {
  return pgTable(
    name,
    {
      /** Delivery attempts already made. Bounds the retry budget. */
      attempts: integer('attempts').notNull().default(0),
      /** Not claimable before this instant. Retry backoff is written here. */
      availableAt: timestamptz('available_at').notNull(),
      correlationId: text('correlation_id'),
      createdAt: timestamptz('created_at').notNull(),
      dispatchedAt: timestamptz('dispatched_at'),
      /** Past-tense fact name, versioned: `messaging.message.sent.v1`. */
      eventName: text('event_name').notNull(),
      eventVersion: integer('event_version').notNull(),
      /** A redacted code, never a provider message or a payload fragment. */
      failureReason: text('failure_reason'),
      /**
       * Immutable event identity. Consumers deduplicate on it, so it is the
       * caller's to generate inside the owning transaction and nobody's to
       * reassign afterwards.
       */
      id: uuid('id').primaryKey(),
      /**
       * A claim survives the process that took it. Expiry is what lets another
       * relay recover work from a worker that died mid-dispatch, which is the
       * whole reason a claim is a database fact and not a memory one.
       */
      leaseExpiresAt: timestamptz('lease_expires_at'),
      leaseOwner: text('lease_owner'),
      occurredAt: timestamptz('occurred_at').notNull(),
      /** Minimized fact. No body text, no credential, no raw identity data. */
      payload: jsonb('payload').notNull(),
      /**
       * Publication order within this producer. A monotonic allocator rather
       * than a timestamp, because two rows committed in the same millisecond
       * still have to drain in a defined order.
       */
      sequence: bigserial('sequence', { mode: 'number' }).notNull(),
      state: text('state').notNull().$type<OutboxState>(),
      /** The aggregate the fact is about, for ordering and investigation. */
      subjectId: uuid('subject_id'),
      subjectType: text('subject_type').notNull(),
      updatedAt: timestamptz('updated_at').notNull(),
    },
    (table) => [
      uniqueIndex(`${name}_sequence_uk`).on(table.sequence),
      // The relay's only hot query: the oldest claimable rows, in publication
      // order. Partial, so a table that has drained a year of dispatched
      // history still answers it from an index the size of the backlog.
      //
      // It leads with `sequence` because the query orders by it and stops at
      // the batch size. An index leading with `available_at` cannot supply that
      // order, so the planner abandons it: measured against 200,000 pending
      // rows deferred by backoff and 80 claimable ones, it walked the sequence
      // unique index instead and discarded 49,951 rows to find 50 — 1,360
      // buffers and 3.7 ms, against 150 buffers and 0.11 ms here. The deferral
      // instant stays a filter, which is cheap because a healthy backlog is
      // mostly available and a deferred one is bounded by the retry budget.
      index(`${name}_claimable_idx`)
        .on(table.sequence)
        .where(sql`${table.state} = 'pending'`),
      index(`${name}_state_idx`).on(table.state, table.createdAt),
      check(`${name}_state_check`, inList(table.state, outboxStates)),
      check(`${name}_attempts_check`, sql`${table.attempts} >= 0`),
      check(
        `${name}_lease_shape_check`,
        nullablePairing(table.leaseOwner, table.leaseExpiresAt),
      ),
      // A lease belongs to a row somebody may still be working on. A terminal
      // row holding one would be indistinguishable from a live claim.
      check(
        `${name}_lease_state_check`,
        sql`${table.leaseOwner} is null or ${table.state} = 'pending'`,
      ),
      check(
        `${name}_dispatched_shape_check`,
        sql`(${table.state} = 'dispatched') = (${table.dispatchedAt} is not null)`,
      ),
      check(`${name}_version_check`, sql`${table.eventVersion} >= 1`),
    ],
  );
}

/**
 * The row shape every outbox has. Derived from the factory rather than written
 * out again, so the relay is written once against one type and a column added
 * to the factory cannot drift away from what the relay believes it reads.
 */
export type OutboxRow = OutboxTable['$inferSelect'];
