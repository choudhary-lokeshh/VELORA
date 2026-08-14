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
import { outboxTable } from '../events/outbox-table.js';

/**
 * DISCOVERY-owned persistence.
 *
 * DISCOVERY owns candidate eligibility evaluation, presentation records, and
 * pair state. It owns no profile, no message, no block, and no enforcement
 * decision: those belong to USERS, MESSAGING, and TRUST & SAFETY, and this
 * domain reads them through their owners rather than storing its own copy.
 *
 * References to consumer accounts are opaque identifiers with no foreign key,
 * on the same rule Phase 1 recorded in
 * `docs/architecture/05-data-ownership.md`: cross-domain references are stable
 * identifiers rather than shared schema, so one domain's deletion policy cannot
 * silently rewrite another's records.
 */

/**
 * Which candidates a viewer has been shown.
 *
 * One row per pair rather than one per impression. An impression log would grow
 * without bound in the hot path of every feed page; what the flow document
 * actually asks for is that presentation is recorded with the policy and
 * ranking version behind it, and a first-seen, last-seen, and count carries that
 * with bounded growth.
 */
export const discoveryPresentations = pgTable(
  'discovery_presentations',
  {
    candidateId: uuid('candidate_id').notNull(),
    firstShownAt: timestamptz('first_shown_at').notNull(),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    lastShownAt: timestamptz('last_shown_at').notNull(),
    /** Ranking rule in force when the candidate was shown. */
    rankingVersion: text('ranking_version').notNull(),
    showCount: integer('show_count').notNull(),
    viewerId: uuid('viewer_id').notNull(),
  },
  (table) => [
    uniqueIndex('discovery_presentations_pair_uk').on(
      table.viewerId,
      table.candidateId,
    ),
    check(
      'discovery_presentations_show_count_check',
      sql`${table.showCount} >= 1`,
    ),
    check(
      'discovery_presentations_not_self_check',
      sql`${table.viewerId} <> ${table.candidateId}`,
    ),
    check(
      'discovery_presentations_order_check',
      sql`${table.lastShownAt} >= ${table.firstShownAt}`,
    ),
  ],
);

/**
 * A private decline.
 *
 * A pass is not a block and not a judgement. Nobody is told, no score is derived
 * from it, and it expires: the pair returns to ordinary discovery after the one
 * suppression window the approved policy defines. A block is the stronger,
 * indefinite suppression and belongs to TRUST & SAFETY.
 */
export const discoveryPasses = pgTable(
  'discovery_passes',
  {
    candidateId: uuid('candidate_id').notNull(),
    /** When ordinary discovery may show this pair again. */
    expiresAt: timestamptz('expires_at').notNull(),
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    passedAt: timestamptz('passed_at').notNull(),
    viewerId: uuid('viewer_id').notNull(),
  },
  (table) => [
    uniqueIndex('discovery_passes_pair_uk').on(
      table.viewerId,
      table.candidateId,
    ),
    // The candidate query filters on live suppressions for one viewer.
    index('discovery_passes_active_idx').on(table.viewerId, table.expiresAt),
    check(
      'discovery_passes_not_self_check',
      sql`${table.viewerId} <> ${table.candidateId}`,
    ),
    check(
      'discovery_passes_expiry_check',
      sql`${table.expiresAt} > ${table.passedAt}`,
    ),
  ],
);

/**
 * Introduction state for an unordered pair.
 *
 * `pending` is one side having deliberately opted in. `mutual` is both sides
 * having done so, independently — that is the whole product rule, and it is why
 * the transition is a compare-and-set against the other person's own signal
 * rather than anything a caller can assert. `closed` is a withdrawal, a
 * decline, or an enforcement outcome.
 */
export const introductionStates = ['pending', 'mutual', 'closed'] as const;
export type IntroductionState = (typeof introductionStates)[number];

/**
 * Why an introduction is no longer live. Never disclosed to the other side.
 *
 * `expired` is the passage of time rather than anybody's decision: a positive
 * signal cannot outlive the availability that produced it, or the day. The row
 * is closed rather than deleted, so what was offered and when stays auditable
 * and the pair is free to be introduced again.
 */
export const introductionClosureReasons = [
  'withdrawn',
  'declined',
  'expired',
  'enforcement',
] as const;
export type IntroductionClosureReason =
  (typeof introductionClosureReasons)[number];

/**
 * One live introduction per pair.
 *
 * The pair is stored as an ordered low/high identifier rather than as actor and
 * target, so the same two people are the same row whichever of them acts first.
 * The partial unique index over that pair is what makes two simultaneous
 * reciprocal signals produce exactly one introduction: the second insert loses
 * to the index and is then read as the other side's pending signal, which is
 * precisely the mutual case.
 *
 * Closed rows are excluded from the index, so a pair that closed can be
 * introduced again later without the record of the earlier attempt being
 * rewritten or removed.
 */
export const discoveryIntroductions = pgTable(
  'discovery_introductions',
  {
    closedAt: timestamptz('closed_at'),
    closedReason: text('closed_reason').$type<IntroductionClosureReason>(),
    createdAt: timestamptz('created_at').notNull(),
    /**
     * When a pending signal stops being able to complete an introduction.
     *
     * `min(originating availability window, creation + 24h)`. Enforced in the
     * predicate of the mutual transition rather than by a job, so there is no
     * window in which a sweep has not yet run and an expired signal still
     * completes. Carried on mutual and closed rows as the historical record of
     * what the offer was, and never rewritten.
     */
    expiresAt: timestamptz('expires_at'),
    id: uuid('id').primaryKey(),
    /** Who signalled first. The other side is the one whose answer is awaited. */
    initiatorId: uuid('initiator_id').notNull(),
    mutualAt: timestamptz('mutual_at'),
    pairHighId: uuid('pair_high_id').notNull(),
    pairLowId: uuid('pair_low_id').notNull(),
    state: text('state').notNull().$type<IntroductionState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** Optimistic concurrency for the state machine. */
    version: integer('version').notNull().default(1),
  },
  (table) => [
    uniqueIndex('discovery_introductions_live_pair_uk')
      .on(table.pairLowId, table.pairHighId)
      .where(sql`${table.state} <> 'closed'`),
    index('discovery_introductions_low_idx').on(table.pairLowId, table.state),
    index('discovery_introductions_high_idx').on(table.pairHighId, table.state),
    // The live-pair unique index answers a batch lookup from the low side. This
    // is its mirror, so asking "which of these candidates does the caller
    // already have a live pair with" is an index lookup per candidate whichever
    // side of the ordered pair the caller happens to be on.
    uniqueIndex('discovery_introductions_live_pair_high_uk')
      .on(table.pairHighId, table.pairLowId)
      .where(sql`${table.state} <> 'closed'`),
    check(
      'discovery_introductions_state_check',
      inList(table.state, introductionStates),
    ),
    check(
      'discovery_introductions_pair_order_check',
      sql`${table.pairLowId} < ${table.pairHighId}`,
    ),
    // The initiator is one of the two people. Anything else is not a pair.
    check(
      'discovery_introductions_initiator_check',
      sql`${table.initiatorId} in (${table.pairLowId}, ${table.pairHighId})`,
    ),
    // A closure has a time and a reason, or it is not a closure.
    check(
      'discovery_introductions_closure_shape_check',
      sql`(${table.state} = 'closed') = (${table.closedAt} is not null) and (${table.closedAt} is null) = (${table.closedReason} is null)`,
    ),
    check(
      'discovery_introductions_closed_reason_check',
      sql`${table.closedReason} is null or ${inList(table.closedReason, introductionClosureReasons)}`,
    ),
    // Every pending signal carries the moment it stops being able to complete.
    // A pending row without one would be an offer with no end, which is the
    // thing this rule exists to make impossible.
    check(
      'discovery_introductions_pending_expiry_check',
      sql`(${table.state} = 'pending') <= (${table.expiresAt} is not null)`,
    ),
    // Mutual means both sides opted in at a recorded moment, and a pending
    // signal has no such moment yet. A closed row may carry one or not, because
    // both a closure of a mutual introduction and a closure of a signal that
    // never became one are closures. Requiring the moment to be absent unless
    // the row is currently mutual would mean an enforcement closure had to
    // erase when two people connected, which is exactly the silent mutation of
    // historical evidence this schema exists to prevent.
    check(
      'discovery_introductions_mutual_shape_check',
      sql`(${table.state} = 'mutual') <= (${table.mutualAt} is not null)
        and (${table.state} = 'pending') <= (${table.mutualAt} is null)`,
    ),
    check('discovery_introductions_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * DISCOVERY's transactional outbox.
 *
 * Same rule as MESSAGING's, and the same reason it lives under this domain's
 * prefix rather than in a shared table: the fact that an introduction became
 * mutual and the row that records it must commit together, and only this
 * domain's transaction can do that. A fact written on a second connection is a
 * second commit, and a process killed between the two leaves a person who
 * signalled first never learning that somebody signalled back.
 *
 * NOTIFICATIONS never reads it. The relay in `src/events/relay.ts` drains it.
 */
export const discoveryOutbox = outboxTable('discovery_outbox');
