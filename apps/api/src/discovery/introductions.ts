import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { UsersDatabase, UsersExecutor } from '../users/repository.js';
import {
  discoveryIntroductions,
  type IntroductionClosureReason,
} from './schema.js';

type AnyExecutor = UsersDatabase | UsersExecutor;

export type IntroductionRow = typeof discoveryIntroductions.$inferSelect;

/**
 * Whether a row still counts as a live relationship between two people.
 *
 * A mutual introduction is live regardless of the expiry that governed the
 * signal which produced it — the offer expires, the relationship it created does
 * not. A pending signal is live only until its expiry, and after that it is a
 * historical record rather than something the pair is waiting on.
 */
function liveAt(now: Date): SQL {
  return sql`${discoveryIntroductions.state} <> 'closed'
    and (${discoveryIntroductions.state} <> 'pending' or ${discoveryIntroductions.expiresAt} > ${now})`;
}

/** A pending signal whose window has closed, judged from an already-read row. */
export function hasExpired(row: IntroductionRow, now: Date): boolean {
  return (
    row.state === 'pending' &&
    (row.expiresAt === null || row.expiresAt.getTime() <= now.getTime())
  );
}

/**
 * An unordered pair, stored in a fixed order.
 *
 * The same two people must be the same row whichever of them acts first, so the
 * pair is normalized rather than stored as actor and target. Everything that
 * depends on "these two people" — the live-pair index, the reciprocal
 * transition, the block check later — then works without knowing who moved
 * first.
 */
export function orderedPair(
  first: string,
  second: string,
): { readonly high: string; readonly low: string } {
  return first < second
    ? { high: second, low: first }
    : { high: first, low: second };
}

export class IntroductionRepository {
  constructor(private readonly database: UsersDatabase) {}

  get transactionless(): UsersDatabase {
    return this.database;
  }

  /**
   * Creates a pending introduction, or returns nothing when the pair already
   * has a live one. The partial unique index decides, not a prior read, so two
   * simultaneous first signals cannot both succeed.
   */
  async insertPending(
    executor: AnyExecutor,
    input: {
      readonly expiresAt: Date;
      readonly initiatorId: string;
      readonly now: Date;
      readonly targetId: string;
    },
  ): Promise<IntroductionRow | undefined> {
    const pair = orderedPair(input.initiatorId, input.targetId);
    const inserted = await executor
      .insert(discoveryIntroductions)
      .values({
        createdAt: input.now,
        expiresAt: input.expiresAt,
        id: crypto.randomUUID(),
        initiatorId: input.initiatorId,
        pairHighId: pair.high,
        pairLowId: pair.low,
        state: 'pending',
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /**
   * How many introductions this account has opened since the given instant.
   *
   * From the initiator, because a signal somebody received is not something
   * they did. Counted inside the caller's transaction, so a bound checked on a
   * separate connection cannot be walked through by a burst.
   */
  async countSignalsSince(
    executor: AnyExecutor,
    input: { readonly initiatorId: string; readonly since: Date },
  ): Promise<number> {
    const rows = await executor
      .select({ count: sql<string>`count(*)::text` })
      .from(discoveryIntroductions)
      .where(
        and(
          eq(discoveryIntroductions.initiatorId, input.initiatorId),
          gt(discoveryIntroductions.createdAt, input.since),
        ),
      );
    return Number(rows.at(0)?.count ?? '0');
  }

  /**
   * The pair's row that the unique index considers to exist, expired or not.
   *
   * Expiry is not filtered here on purpose. A pending signal whose window has
   * closed still occupies the live-pair index, so a caller wanting to signal
   * again has to see it in order to close it first; hiding it would produce a
   * unique-violation the caller could not explain.
   */
  async findUnclosedPair(
    executor: AnyExecutor,
    input: { readonly first: string; readonly second: string },
  ): Promise<IntroductionRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select()
      .from(discoveryIntroductions)
      .where(
        and(
          eq(discoveryIntroductions.pairLowId, pair.low),
          eq(discoveryIntroductions.pairHighId, pair.high),
          ne(discoveryIntroductions.state, 'closed'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The pair's mutual introduction, if they have one.
   *
   * Only ever asked through the published connection contract. Expiry is not
   * part of the predicate because it governs a pending signal: the offer
   * expires, the relationship both people opted into does not.
   */
  async findMutualPair(
    executor: AnyExecutor,
    input: { readonly first: string; readonly second: string },
  ): Promise<IntroductionRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select()
      .from(discoveryIntroductions)
      .where(
        and(
          eq(discoveryIntroductions.pairLowId, pair.low),
          eq(discoveryIntroductions.pairHighId, pair.high),
          eq(discoveryIntroductions.state, 'mutual'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Promotes a pending introduction the other person started.
   *
   * The initiator is part of the predicate, so this can only ever complete
   * somebody else's signal: an account cannot make an introduction mutual by
   * signalling twice, whatever a client sends.
   *
   * Expiry is part of the same predicate rather than a check the caller performs
   * first. A signal that expires between the read and the write must not
   * complete, and only the database can decide that without a window in which
   * both answers are true.
   */
  async makeMutual(
    executor: AnyExecutor,
    input: {
      readonly expectedVersion: number;
      readonly id: string;
      readonly now: Date;
      readonly respondingActorId: string;
    },
  ): Promise<IntroductionRow | undefined> {
    const updated = await executor
      .update(discoveryIntroductions)
      .set({
        mutualAt: input.now,
        state: 'mutual',
        updatedAt: input.now,
        version: sql`${discoveryIntroductions.version} + 1`,
      })
      .where(
        and(
          eq(discoveryIntroductions.id, input.id),
          eq(discoveryIntroductions.state, 'pending'),
          gt(discoveryIntroductions.expiresAt, input.now),
          eq(discoveryIntroductions.version, input.expectedVersion),
          ne(discoveryIntroductions.initiatorId, input.respondingActorId),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Closes a pending introduction. Compare-and-set, so a race has one winner. */
  async close(
    executor: AnyExecutor,
    input: {
      readonly expectedVersion: number;
      readonly id: string;
      readonly now: Date;
      readonly reason: IntroductionClosureReason;
    },
  ): Promise<IntroductionRow | undefined> {
    const updated = await executor
      .update(discoveryIntroductions)
      .set({
        closedAt: input.now,
        closedReason: input.reason,
        state: 'closed',
        updatedAt: input.now,
        version: sql`${discoveryIntroductions.version} + 1`,
      })
      .where(
        and(
          eq(discoveryIntroductions.id, input.id),
          eq(discoveryIntroductions.state, 'pending'),
          eq(discoveryIntroductions.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  async findForActor(
    executor: AnyExecutor,
    input: { readonly actorId: string; readonly id: string },
  ): Promise<IntroductionRow | undefined> {
    const rows = await executor
      .select()
      .from(discoveryIntroductions)
      .where(
        and(
          eq(discoveryIntroductions.id, input.id),
          // Membership is part of the predicate, so an identifier belonging to
          // a pair the caller is not in is simply not found.
          or(
            eq(discoveryIntroductions.pairLowId, input.actorId),
            eq(discoveryIntroductions.pairHighId, input.actorId),
          ),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * The caller's live introductions, newest first.
   *
   * Paging is keyset on the creation instant and identifier, which are both
   * immutable, so a page boundary cannot move underneath a reader.
   */
  async listLive(
    executor: AnyExecutor,
    input: {
      readonly actorId: string;
      readonly before:
        { readonly createdAt: Date; readonly id: string } | undefined;
      readonly limit: number;
      readonly now: Date;
    },
  ): Promise<IntroductionRow[]> {
    const membership = or(
      eq(discoveryIntroductions.pairLowId, input.actorId),
      eq(discoveryIntroductions.pairHighId, input.actorId),
    );
    const position =
      input.before === undefined
        ? undefined
        : or(
            lt(discoveryIntroductions.createdAt, input.before.createdAt),
            and(
              eq(discoveryIntroductions.createdAt, input.before.createdAt),
              lt(discoveryIntroductions.id, input.before.id),
            ),
          );
    return executor
      .select()
      .from(discoveryIntroductions)
      .where(and(membership, liveAt(input.now), position))
      .orderBy(
        desc(discoveryIntroductions.createdAt),
        desc(discoveryIntroductions.id),
      )
      .limit(input.limit);
  }

  /**
   * Which of these candidates the caller already has a live introduction with.
   *
   * Discovery excludes them: a person already introduced, or still awaiting an
   * answer, is not a candidate. A person whose signal has since expired is,
   * which is why the predicate is expiry-aware rather than merely unclosed.
   *
   * Asked about a bounded batch for the same reason suppression is. How many
   * introductions an account has accumulated over its life is not allowed to
   * become an input to whether discovery works.
   */
  async livePairsAmong(
    executor: AnyExecutor,
    input: {
      readonly actorId: string;
      readonly candidateIds: readonly string[];
      readonly now: Date;
    },
  ): Promise<ReadonlySet<string>> {
    if (input.candidateIds.length === 0) return new Set();
    const counterparts = [...input.candidateIds];
    const rows = await executor
      .select({
        high: discoveryIntroductions.pairHighId,
        low: discoveryIntroductions.pairLowId,
      })
      .from(discoveryIntroductions)
      .where(
        and(
          // One of the two branches matches whichever side of the ordered pair
          // the caller sorts to, and each is served by a partial index over the
          // pair, so the batch decides the cost rather than the history.
          or(
            and(
              eq(discoveryIntroductions.pairLowId, input.actorId),
              inArray(discoveryIntroductions.pairHighId, counterparts),
            ),
            and(
              eq(discoveryIntroductions.pairHighId, input.actorId),
              inArray(discoveryIntroductions.pairLowId, counterparts),
            ),
          ),
          liveAt(input.now),
          isNull(discoveryIntroductions.closedAt),
        ),
      );
    return new Set(
      rows.map((row) => (row.low === input.actorId ? row.high : row.low)),
    );
  }
}
