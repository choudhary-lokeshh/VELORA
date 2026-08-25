import { and, eq, gt, inArray, sql } from 'drizzle-orm';

import type { TransactionHandle } from '../database/executor.js';
import type { UsersDatabase, UsersExecutor } from '../users/repository.js';
import { discoveryPasses, discoveryPresentations } from './schema.js';

type AnyExecutor = UsersDatabase | UsersExecutor;

/**
 * DISCOVERY-owned reads and writes.
 *
 * Nothing here touches another domain's tables. Candidate data comes from the
 * consumer directory USERS publishes; what this domain stores is its own record
 * of what it showed and what pairs its users have declined.
 */
export class DiscoveryRepository {
  constructor(private readonly database: UsersDatabase) {}

  get transactionless(): UsersDatabase {
    return this.database;
  }

  transaction<T>(
    work: (executor: TransactionHandle) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Which of these candidates the viewer has declined, with the suppression
   * still running.
   *
   * Asked in this direction on purpose. "Which people has this viewer declined"
   * has an answer that grows for as long as the account is active, and carrying
   * that answer into the candidate query made the number of relationships an
   * account has into a correctness question: either an unbounded query parameter
   * or an arbitrary cap that silently reintroduces somebody a person declined.
   * "Which of these particular candidates are suppressed" is bounded by the
   * batch, and the batch is bounded by page size, so no relationship count
   * participates in the plan at all.
   *
   * The unique index on (viewer, candidate) answers it as one lookup per
   * candidate in the batch.
   */
  async suppressedAmong(input: {
    readonly candidateIds: readonly string[];
    readonly now: Date;
    readonly viewerId: string;
  }): Promise<ReadonlySet<string>> {
    if (input.candidateIds.length === 0) return new Set();
    const rows = await this.database
      .select({ candidateId: discoveryPasses.candidateId })
      .from(discoveryPasses)
      .where(
        and(
          eq(discoveryPasses.viewerId, input.viewerId),
          gt(discoveryPasses.expiresAt, input.now),
          inArray(discoveryPasses.candidateId, [...input.candidateIds]),
        ),
      );
    return new Set(rows.map((row) => row.candidateId));
  }

  /**
   * Records that a page was shown.
   *
   * One statement per page, not one per candidate, and one row per pair rather
   * than one per impression, so a feed page costs a bounded amount of write no
   * matter how often it is refreshed.
   *
   * First and last are taken as the earliest and the latest of what is known
   * rather than as "whatever this request carried". Two pages for one viewer
   * can be in flight at once, and the one that reaches this statement second
   * is not necessarily the one with the later clock: a request that started
   * earlier can commit later. Assigning `last_shown_at` unconditionally then
   * writes a moment before the row's own `first_shown_at`, which the table
   * refuses — correctly, because that pair of values would be a lie — and the
   * refusal fails a feed page that had already been computed and authorised.
   * `least` and `greatest` make the row order-independent, so it says what it
   * claims to say however the two writes interleave.
   */
  async recordPresentations(
    executor: AnyExecutor,
    input: {
      readonly candidateIds: readonly string[];
      readonly now: Date;
      readonly rankingVersion: string;
      readonly viewerId: string;
    },
  ): Promise<void> {
    if (input.candidateIds.length === 0) return;
    await executor
      .insert(discoveryPresentations)
      .values(
        input.candidateIds.map((candidateId) => ({
          candidateId,
          firstShownAt: input.now,
          lastShownAt: input.now,
          rankingVersion: input.rankingVersion,
          showCount: 1,
          viewerId: input.viewerId,
        })),
      )
      .onConflictDoUpdate({
        set: {
          firstShownAt: sql`least(${discoveryPresentations.firstShownAt}, excluded.first_shown_at)`,
          lastShownAt: sql`greatest(${discoveryPresentations.lastShownAt}, excluded.last_shown_at)`,
          rankingVersion: input.rankingVersion,
          showCount: sql`${discoveryPresentations.showCount} + 1`,
        },
        target: [
          discoveryPresentations.viewerId,
          discoveryPresentations.candidateId,
        ],
      });
  }

  /**
   * Records a pass, or renews the window on one that already exists.
   *
   * Renewing rather than conflicting keeps the operation safe to retry: a client
   * that loses a response and repeats it gets the same outcome instead of an
   * error about a decision the person already made.
   */
  async recordPass(
    executor: AnyExecutor,
    input: {
      readonly candidateId: string;
      readonly expiresAt: Date;
      readonly now: Date;
      readonly viewerId: string;
    },
  ): Promise<Date> {
    const rows = await executor
      .insert(discoveryPasses)
      .values({
        candidateId: input.candidateId,
        expiresAt: input.expiresAt,
        passedAt: input.now,
        viewerId: input.viewerId,
      })
      .onConflictDoUpdate({
        set: { expiresAt: input.expiresAt, passedAt: input.now },
        target: [discoveryPasses.viewerId, discoveryPasses.candidateId],
      })
      .returning({ expiresAt: discoveryPasses.expiresAt });
    const row = rows[0];
    if (row === undefined) throw new Error('Pass upsert returned no row');
    return row.expiresAt;
  }
}
