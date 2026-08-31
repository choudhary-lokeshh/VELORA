import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  gte,
  inArray,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import { orderedPair } from '../realtime/repository.js';
import {
  liveInvitationOpenStates,
  liveParticipationLiveStates,
  type LiveEndReason,
  type LiveInvitationState,
  type LiveMedium,
  type LiveMessageKind,
  type LivePreferredRegion,
} from './policy.js';
import {
  liveEncounters,
  liveInvitations,
  liveMessages,
  liveParticipations,
} from './schema.js';

export type LiveParticipationRow = typeof liveParticipations.$inferSelect;
export type LiveEncounterRow = typeof liveEncounters.$inferSelect;
export type LiveInvitationRow = typeof liveInvitations.$inferSelect;
export type LiveMessageRow = typeof liveMessages.$inferSelect;

/** How wide a net a search casts, as the caller asked for it. */
export interface LivePreferences {
  readonly language: string | undefined;
  readonly region: LivePreferredRegion;
}

export { orderedPair };

/**
 * LIVE's storage.
 *
 * Two rules shape everything here, and they are the same two REALTIME's storage
 * follows. A transition is applied by a guarded `update` whose `where` clause
 * restates the state it expects, so two callers racing to end the same
 * encounter produce one transition and the loser observes it rather than
 * overwriting it. And an ended encounter, its instant, and its reason are
 * always written by the same statement, because a row that says an encounter
 * ended without saying when or why is a record nobody can act on later.
 */
export class LiveRepository {
  constructor(private readonly database: DatabaseHandle) {}

  transaction<T>(run: (executor: TransactionHandle) => Promise<T>): Promise<T> {
    return this.database.transaction(run);
  }

  get transactionless(): DatabaseHandle {
    return this.database;
  }

  /**
   * Serializes the whole matcher.
   *
   * Matching is the one decision in this product that is not about a pair until
   * after it has been taken: it reads everybody who is waiting and then chooses
   * two of them, and two matchers reading the same waiting person would both
   * choose them. A pair lock cannot close that, because neither matcher knows
   * the pair yet.
   *
   * So the matcher runs one at a time. It is a transaction-scoped advisory lock
   * on a single constant key, taken *before* any pair lock, which is what keeps
   * the lock graph acyclic: every other transaction in this domain takes a pair
   * lock and nothing else, and this one takes the global lock and then a pair
   * lock, never the reverse.
   *
   * The cost is that concurrent searches queue behind each other for the length
   * of one short transaction. That is a throughput property and never a
   * correctness one, and it buys a guarantee no amount of retry logic would:
   * nobody is ever handed to two people.
   */
  async lockMatchmaking(executor: TransactionHandle): Promise<void> {
    await executor.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('velora:live:matchmaking', 0))`,
    );
  }

  /**
   * This person's live participation, if they have one.
   *
   * `forUpdate` is taken by every caller that is about to write, because the
   * partial unique index guarantees there is at most one and says nothing about
   * two transactions both reading it before either writes.
   */
  async findLiveParticipation(
    executor: Executor,
    input: { readonly forUpdate?: boolean; readonly userId: string },
  ): Promise<LiveParticipationRow | undefined> {
    const query = executor
      .select()
      .from(liveParticipations)
      .where(
        and(
          eq(liveParticipations.userId, input.userId),
          ne(liveParticipations.state, 'left'),
        ),
      )
      .limit(1);
    const rows = await (input.forUpdate === true ? query.for('update') : query);
    return rows.at(0);
  }

  /**
   * Enters the pool, or returns nothing when this person is already in it.
   *
   * Idempotency is decided by the partial unique index over the live user
   * rather than by a prior read, which two concurrent taps would both pass.
   */
  async insertParticipation(
    executor: Executor,
    input: {
      readonly id: string;
      readonly medium: LiveMedium;
      readonly now: Date;
      readonly preferences: LivePreferences;
      readonly userId: string;
    },
  ): Promise<LiveParticipationRow | undefined> {
    const inserted = await executor
      .insert(liveParticipations)
      .values({
        id: input.id,
        joinedAt: input.now,
        medium: input.medium,
        preferredLanguage: input.preferences.language ?? null,
        preferredRegion: input.preferences.region,
        seenAt: input.now,
        state: 'searching',
        stateEnteredAt: input.now,
        updatedAt: input.now,
        userId: input.userId,
      })
      .onConflictDoNothing()
      .returning();
    return inserted.at(0);
  }

  /**
   * Records the preferences this search is being made under.
   *
   * Separate from the heartbeat, and deliberately does not move
   * `stateEnteredAt` either: broadening a search is not restarting it, and
   * somebody who has waited two minutes and then widened their net should keep
   * their place rather than going to the back of the queue for it.
   */
  async setPreferences(
    executor: Executor,
    input: {
      readonly id: string;
      readonly now: Date;
      readonly preferences: LivePreferences;
    },
  ): Promise<LiveParticipationRow | undefined> {
    const updated = await executor
      .update(liveParticipations)
      .set({
        preferredLanguage: input.preferences.language ?? null,
        preferredRegion: input.preferences.region,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(liveParticipations.id, input.id),
          ne(liveParticipations.state, 'left'),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * Records that this person's client is still reading.
   *
   * Deliberately does not move `stateEnteredAt`: "how long have they been
   * waiting" is what the matcher orders by, and a heartbeat that reset it would
   * send everybody to the back of the queue several times a minute.
   */
  async touchParticipation(
    executor: Executor,
    input: { readonly id: string; readonly now: Date },
  ): Promise<void> {
    await executor
      .update(liveParticipations)
      .set({ seenAt: input.now, updatedAt: input.now })
      .where(
        and(
          eq(liveParticipations.id, input.id),
          ne(liveParticipations.state, 'left'),
        ),
      );
  }

  /**
   * Puts somebody back into the pool after an encounter, and lets go of it.
   *
   * Only from `ended`, never from `matched`. Going straight from an encounter
   * to searching would mean the person never held the state in which their
   * surface could say what happened, and the guard is what makes that a
   * property of the storage rather than of the caller that remembered.
   */
  async resumeSearching(
    executor: Executor,
    input: { readonly id: string; readonly now: Date },
  ): Promise<LiveParticipationRow | undefined> {
    const updated = await executor
      .update(liveParticipations)
      .set({
        encounterId: null,
        seenAt: input.now,
        state: 'searching',
        stateEnteredAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(liveParticipations.id, input.id),
          eq(liveParticipations.state, 'ended'),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * Moves somebody out of a matched encounter and holds them on it.
   *
   * The encounter identifier is deliberately kept, which is the whole point of
   * this state: the surface reads it to say who the person was talking to and
   * what became of it, and the matcher's partial index does not see them, so
   * nobody is handed them until they ask again.
   */
  async markEncounterEnded(
    executor: Executor,
    input: { readonly id: string; readonly now: Date },
  ): Promise<LiveParticipationRow | undefined> {
    const updated = await executor
      .update(liveParticipations)
      .set({
        state: 'ended',
        stateEnteredAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(liveParticipations.id, input.id),
          eq(liveParticipations.state, 'matched'),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /** Binds a searching participation to the encounter it was allocated. */
  async markMatched(
    executor: Executor,
    input: {
      readonly encounterId: string;
      readonly id: string;
      readonly now: Date;
    },
  ): Promise<LiveParticipationRow | undefined> {
    const updated = await executor
      .update(liveParticipations)
      .set({
        encounterId: input.encounterId,
        seenAt: input.now,
        state: 'matched',
        stateEnteredAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(liveParticipations.id, input.id),
          eq(liveParticipations.state, 'searching'),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /** Leaves the pool. Terminal for this participation. */
  async leavePool(
    executor: Executor,
    input: { readonly now: Date; readonly userId: string },
  ): Promise<LiveParticipationRow | undefined> {
    const updated = await executor
      .update(liveParticipations)
      .set({
        encounterId: null,
        state: 'left',
        stateEnteredAt: input.now,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(liveParticipations.userId, input.userId),
          ne(liveParticipations.state, 'left'),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * The people this person could be handed, longest wait first.
   *
   * Bounded by the caller's scan limit, so one search is one bounded query
   * rather than a scan of everybody in the pool. Self is excluded here rather
   * than filtered afterwards, so a pool of one never returns a row at all.
   *
   * Rows are locked with `skip locked`, so a second matcher — which the global
   * matchmaking lock already prevents from running concurrently, but which a
   * future sharded matcher would not — never waits on a row the first is about
   * to take, and never takes a person the first has already chosen.
   */
  async findWaitingCandidates(
    executor: TransactionHandle,
    input: {
      readonly limit: number;
      readonly medium: LiveMedium;
      readonly seenSince: Date;
      readonly userId: string;
    },
  ): Promise<readonly LiveParticipationRow[]> {
    return executor
      .select()
      .from(liveParticipations)
      .where(
        and(
          eq(liveParticipations.state, 'searching'),
          eq(liveParticipations.medium, input.medium),
          ne(liveParticipations.userId, input.userId),
          gte(liveParticipations.seenAt, input.seenSince),
        ),
      )
      .orderBy(asc(liveParticipations.stateEnteredAt))
      .limit(input.limit)
      .for('update', { skipLocked: true });
  }

  /**
   * Which of these people this person has met too recently to meet again.
   *
   * One query for the whole candidate batch, so rematch suppression costs one
   * index scan rather than one per candidate.
   */
  async recentlyMetAmong(
    executor: Executor,
    input: {
      readonly candidateIds: readonly string[];
      readonly since: Date;
      readonly userId: string;
    },
  ): Promise<ReadonlySet<string>> {
    if (input.candidateIds.length === 0) return new Set<string>();
    const rows = await executor
      .select({
        high: liveEncounters.pairHighId,
        low: liveEncounters.pairLowId,
      })
      .from(liveEncounters)
      .where(
        and(
          gte(liveEncounters.createdAt, input.since),
          or(
            and(
              eq(liveEncounters.pairLowId, input.userId),
              inArray(liveEncounters.pairHighId, [...input.candidateIds]),
            ),
            and(
              eq(liveEncounters.pairHighId, input.userId),
              inArray(liveEncounters.pairLowId, [...input.candidateIds]),
            ),
          ),
        ),
      );
    return new Set(
      rows.map((row) => (row.low === input.userId ? row.high : row.low)),
    );
  }

  /** How many encounters this person has been allocated in the window. */
  async countRecentEncounters(
    executor: Executor,
    input: { readonly since: Date; readonly userId: string },
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(liveEncounters)
      .where(
        and(
          gte(liveEncounters.createdAt, input.since),
          or(
            eq(liveEncounters.pairLowId, input.userId),
            eq(liveEncounters.pairHighId, input.userId),
          ),
        ),
      );
    return rows.at(0)?.total ?? 0;
  }

  /**
   * Allocates the encounter, or returns nothing when the pair already has a
   * live one.
   *
   * Decided by the partial unique index over the live pair rather than by a
   * prior read.
   */
  async insertEncounter(
    executor: Executor,
    input: {
      readonly first: string;
      readonly id: string;
      readonly medium: LiveMedium;
      readonly now: Date;
      readonly second: string;
    },
  ): Promise<LiveEncounterRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const inserted = await executor
      .insert(liveEncounters)
      .values({
        createdAt: input.now,
        id: input.id,
        medium: input.medium,
        pairHighId: pair.high,
        pairLowId: pair.low,
        state: 'live',
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted.at(0);
  }

  async findEncounter(
    executor: Executor,
    id: string,
  ): Promise<LiveEncounterRow | undefined> {
    const rows = await executor
      .select()
      .from(liveEncounters)
      .where(eq(liveEncounters.id, id))
      .limit(1);
    return rows.at(0);
  }

  /**
   * The encounter, locked.
   *
   * Distinct from `findEncounter` because the caller is about to write. A plain
   * read would be a check-then-act, and the writes that race here — two people
   * both pressing Next, a sweep closing a stale encounter, a block landing —
   * are exactly the ones that must not both apply.
   */
  async lockEncounter(
    executor: TransactionHandle,
    id: string,
  ): Promise<LiveEncounterRow | undefined> {
    const rows = await executor
      .select()
      .from(liveEncounters)
      .where(eq(liveEncounters.id, id))
      .limit(1)
      .for('update');
    return rows.at(0);
  }

  /** The live encounter this person is in, locked, whichever side they are on. */
  async lockLiveEncounterForUser(
    executor: TransactionHandle,
    userId: string,
  ): Promise<LiveEncounterRow | undefined> {
    const rows = await executor
      .select()
      .from(liveEncounters)
      .where(
        and(
          eq(liveEncounters.state, 'live'),
          or(
            eq(liveEncounters.pairLowId, userId),
            eq(liveEncounters.pairHighId, userId),
          ),
        ),
      )
      .limit(1)
      .for('update');
    return rows.at(0);
  }

  /**
   * Ends an encounter, once.
   *
   * The guard restates `live`, so the second of two racing Next requests
   * changes nothing and reads what the first wrote. The reason and the instant
   * are written by the same statement as the state, so no row can say an
   * encounter ended without saying why.
   */
  async endEncounter(
    executor: Executor,
    input: {
      readonly endedById?: string;
      readonly id: string;
      readonly now: Date;
      readonly reason: LiveEndReason;
    },
  ): Promise<LiveEncounterRow | undefined> {
    const updated = await executor
      .update(liveEncounters)
      .set({
        endReason: input.reason,
        endedAt: input.now,
        endedById: input.endedById ?? null,
        state: 'ended',
        updatedAt: input.now,
      })
      .where(
        and(eq(liveEncounters.id, input.id), eq(liveEncounters.state, 'live')),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * Binds the RTC session that carries this encounter.
   *
   * Guarded on the column still being empty, so a retry after an ambiguous
   * open cannot replace a reference that is already bound — which would leave
   * a session nobody owes anything about.
   */
  async bindRealtimeSession(
    executor: Executor,
    input: {
      readonly id: string;
      readonly now: Date;
      readonly realtimeSessionId: string;
    },
  ): Promise<LiveEncounterRow | undefined> {
    const updated = await executor
      .update(liveEncounters)
      .set({
        realtimeSessionId: input.realtimeSessionId,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(liveEncounters.id, input.id),
          eq(liveEncounters.state, 'live'),
          sql`${liveEncounters.realtimeSessionId} is null`,
        ),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * Writes a message and allocates its position in one statement.
   *
   * The position comes from the encounter's own allocator, taken under the row
   * lock the caller already holds, so two people typing at the same instant
   * receive distinct adjacent positions and neither client's clock
   * participates. A repeated client identifier loses to the unique index and
   * writes nothing, which is what makes a retry safe.
   */
  async insertMessage(
    executor: Executor,
    input: {
      readonly body: string;
      readonly clientMessageId: string;
      readonly encounterId: string;
      readonly id: string;
      readonly kind: LiveMessageKind;
      readonly now: Date;
      readonly senderId: string;
      readonly sequence: number;
    },
  ): Promise<LiveMessageRow | undefined> {
    const inserted = await executor
      .insert(liveMessages)
      .values({
        body: input.body,
        clientMessageId: input.clientMessageId,
        createdAt: input.now,
        encounterId: input.encounterId,
        id: input.id,
        kind: input.kind,
        senderId: input.senderId,
        sequence: input.sequence,
      })
      .onConflictDoNothing()
      .returning();
    return inserted.at(0);
  }

  /** Hands out the next position, under the caller's row lock. */
  async allocateMessageSequence(
    executor: Executor,
    input: { readonly id: string; readonly now: Date },
  ): Promise<number | undefined> {
    const updated = await executor
      .update(liveEncounters)
      .set({
        messageSequence: sql`${liveEncounters.messageSequence} + 1`,
        updatedAt: input.now,
      })
      .where(eq(liveEncounters.id, input.id))
      .returning({ sequence: liveEncounters.messageSequence });
    return updated.at(0)?.sequence;
  }

  async countMessagesFrom(
    executor: Executor,
    input: { readonly encounterId: string; readonly senderId: string },
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(liveMessages)
      .where(
        and(
          eq(liveMessages.encounterId, input.encounterId),
          eq(liveMessages.senderId, input.senderId),
        ),
      );
    return rows.at(0)?.total ?? 0;
  }

  /**
   * The encounter's messages, oldest first.
   *
   * Bounded, and bounded from the newest end when the bound bites: a client
   * that has been away wants the last of a conversation rather than the first
   * of it, and an encounter cannot hold more than the per-sender bound allows
   * anyway.
   */
  async listMessages(
    executor: Executor,
    input: { readonly encounterId: string; readonly limit: number },
  ): Promise<readonly LiveMessageRow[]> {
    const rows = await executor
      .select()
      .from(liveMessages)
      .where(eq(liveMessages.encounterId, input.encounterId))
      .orderBy(desc(liveMessages.sequence))
      .limit(input.limit);
    return [...rows].reverse();
  }

  /**
   * Live participations whose client has stopped reading.
   *
   * The sweep's only query. Ordered and bounded so a backlog is worked through
   * rather than loaded.
   */
  async findLapsedParticipations(
    executor: Executor,
    input: {
      readonly encounterSeenBefore: Date;
      readonly limit: number;
      readonly searchSeenBefore: Date;
    },
  ): Promise<readonly LiveParticipationRow[]> {
    return executor
      .select()
      .from(liveParticipations)
      .where(
        and(
          inArray(liveParticipations.state, [...liveParticipationLiveStates]),
          or(
            // Somebody waiting who stopped reading. Dropped soonest, because a
            // stale searcher is what a real person gets matched with.
            and(
              eq(liveParticipations.state, 'searching'),
              lt(liveParticipations.seenAt, input.searchSeenBefore),
            ),
            // Somebody in an encounter who stopped reading. This is the only
            // way "they closed the tab" ever becomes visible: a closed tab
            // sends nothing, so absence is measured rather than announced.
            and(
              eq(liveParticipations.state, 'matched'),
              lt(liveParticipations.seenAt, input.encounterSeenBefore),
            ),
            // Somebody left on a finished encounter's screen who never came
            // back. Nobody is waiting on them, so they are dropped on the
            // searcher's timer rather than the encounter's.
            and(
              eq(liveParticipations.state, 'ended'),
              lt(liveParticipations.seenAt, input.searchSeenBefore),
            ),
          ),
        ),
      )
      .orderBy(asc(liveParticipations.seenAt))
      .limit(input.limit);
  }

  /** Every live encounter one person is in, locked. For a safety decision. */
  async lockLiveEncountersForUser(
    executor: TransactionHandle,
    input: { readonly limit: number; readonly userId: string },
  ): Promise<readonly LiveEncounterRow[]> {
    return executor
      .select()
      .from(liveEncounters)
      .where(
        and(
          eq(liveEncounters.state, 'live'),
          or(
            eq(liveEncounters.pairLowId, input.userId),
            eq(liveEncounters.pairHighId, input.userId),
          ),
        ),
      )
      .limit(input.limit)
      .for('update');
  }

  /** The live encounter between two people, locked. For a block landing. */
  async lockLiveEncounterForPair(
    executor: TransactionHandle,
    input: { readonly first: string; readonly second: string },
  ): Promise<LiveEncounterRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select()
      .from(liveEncounters)
      .where(
        and(
          eq(liveEncounters.state, 'live'),
          eq(liveEncounters.pairLowId, pair.low),
          eq(liveEncounters.pairHighId, pair.high),
        ),
      )
      .limit(1)
      .for('update');
    return rows.at(0);
  }

  /** Whether these two hold a live encounter. REALTIME's eligibility arm. */
  async hasLiveEncounter(
    executor: Executor,
    input: { readonly first: string; readonly second: string },
  ): Promise<boolean> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select({ id: liveEncounters.id })
      .from(liveEncounters)
      .where(
        and(
          eq(liveEncounters.state, 'live'),
          eq(liveEncounters.pairLowId, pair.low),
          eq(liveEncounters.pairHighId, pair.high),
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  /**
   * Whether these two have met live recently enough for one of them to be able
   * to signal an introduction to the other.
   *
   * DISCOVERY's second arm. Deliberately not restricted to a *live* encounter:
   * pressing Connect and the encounter ending race, and somebody whose Connect
   * lost that race by a few milliseconds has still met the person.
   */
  async metRecently(
    executor: Executor,
    input: {
      readonly first: string;
      readonly second: string;
      readonly since: Date;
    },
  ): Promise<boolean> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select({ id: liveEncounters.id })
      .from(liveEncounters)
      .where(
        and(
          eq(liveEncounters.pairLowId, pair.low),
          eq(liveEncounters.pairHighId, pair.high),
          gt(liveEncounters.createdAt, input.since),
        ),
      )
      .limit(1);
    return rows.length === 1;
  }

  /**
   * The people this person has agreed to meet and has not met yet.
   *
   * The matcher's first question, asked before the general pool scan. It
   * returns pool rows rather than identifiers, so a counterpart who agreed and
   * then closed the tab simply is not here — which is the truthful outcome and
   * needs no special case.
   *
   * Only `accepted` counts. A request nobody has answered is not an agreement,
   * and pairing on one would mean a tap on somebody's name put them into a live
   * session with whoever tapped it.
   */
  async findAgreedCandidates(
    executor: TransactionHandle,
    input: {
      readonly limit: number;
      readonly medium: LiveMedium;
      readonly now: Date;
      readonly seenSince: Date;
      readonly userId: string;
    },
  ): Promise<readonly LiveParticipationRow[]> {
    const agreed = executor
      .select({ id: liveInvitations.id })
      .from(liveInvitations)
      .where(
        and(
          eq(liveInvitations.state, 'accepted'),
          gt(liveInvitations.expiresAt, input.now),
          or(
            and(
              eq(liveInvitations.pairLowId, input.userId),
              eq(liveInvitations.pairHighId, liveParticipations.userId),
            ),
            and(
              eq(liveInvitations.pairHighId, input.userId),
              eq(liveInvitations.pairLowId, liveParticipations.userId),
            ),
          ),
        ),
      );
    return executor
      .select()
      .from(liveParticipations)
      .where(
        and(
          eq(liveParticipations.state, 'searching'),
          eq(liveParticipations.medium, input.medium),
          ne(liveParticipations.userId, input.userId),
          gte(liveParticipations.seenAt, input.seenSince),
          exists(agreed),
        ),
      )
      .orderBy(asc(liveParticipations.stateEnteredAt))
      .limit(input.limit)
      .for('update', { skipLocked: true });
  }

  /**
   * Records a request to meet, or returns nothing when one is already open.
   *
   * Idempotency is the partial unique index over the open pair, not a prior
   * read: two taps a few milliseconds apart both pass a read and only one
   * passes the index.
   */
  async insertInvitation(
    executor: Executor,
    input: {
      readonly expiresAt: Date;
      readonly id: string;
      readonly inviterId: string;
      readonly medium: LiveMedium;
      readonly now: Date;
      readonly subjectId: string;
    },
  ): Promise<LiveInvitationRow | undefined> {
    const pair = orderedPair(input.inviterId, input.subjectId);
    const inserted = await executor
      .insert(liveInvitations)
      .values({
        createdAt: input.now,
        expiresAt: input.expiresAt,
        id: input.id,
        inviterId: input.inviterId,
        medium: input.medium,
        pairHighId: pair.high,
        pairLowId: pair.low,
        state: 'pending',
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted.at(0);
  }

  /** The open request between these two, if there is one. */
  async findOpenInvitationForPair(
    executor: Executor,
    input: {
      readonly first: string;
      readonly forUpdate?: boolean;
      readonly second: string;
    },
  ): Promise<LiveInvitationRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const query = executor
      .select()
      .from(liveInvitations)
      .where(
        and(
          eq(liveInvitations.pairLowId, pair.low),
          eq(liveInvitations.pairHighId, pair.high),
          inArray(liveInvitations.state, [...liveInvitationOpenStates]),
        ),
      )
      .limit(1);
    const rows = await (input.forUpdate === true ? query.for('update') : query);
    return rows.at(0);
  }

  async findInvitation(
    executor: Executor,
    input: { readonly forUpdate?: boolean; readonly id: string },
  ): Promise<LiveInvitationRow | undefined> {
    const query = executor
      .select()
      .from(liveInvitations)
      .where(eq(liveInvitations.id, input.id))
      .limit(1);
    const rows = await (input.forUpdate === true ? query.for('update') : query);
    return rows.at(0);
  }

  /**
   * Every request to meet that is still open for this person, either way round.
   *
   * Expiry is applied by the caller on read rather than by a sweep, so a
   * request is never answerable past its bound even in an environment where
   * nothing has run.
   */
  async listOpenInvitations(
    executor: Executor,
    input: { readonly limit: number; readonly userId: string },
  ): Promise<readonly LiveInvitationRow[]> {
    return executor
      .select()
      .from(liveInvitations)
      .where(
        and(
          inArray(liveInvitations.state, [...liveInvitationOpenStates]),
          or(
            eq(liveInvitations.pairLowId, input.userId),
            eq(liveInvitations.pairHighId, input.userId),
          ),
        ),
      )
      .orderBy(desc(liveInvitations.createdAt))
      .limit(input.limit);
  }

  /**
   * Moves a request to a state it can only reach from the one named.
   *
   * Guarded on the state expected, like every other transition here, so two
   * people racing an accept and a cancel produce one outcome and the loser
   * observes it.
   */
  async transitionInvitation(
    executor: Executor,
    input: {
      readonly from: readonly LiveInvitationState[];
      readonly id: string;
      readonly now: Date;
      readonly to: LiveInvitationState;
    },
  ): Promise<LiveInvitationRow | undefined> {
    const resolved = input.to === 'pending' || input.to === 'accepted';
    const updated = await executor
      .update(liveInvitations)
      .set({
        resolvedAt: resolved ? null : input.now,
        state: input.to,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(liveInvitations.id, input.id),
          inArray(liveInvitations.state, [...input.from]),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /** Spends the open request between two people who have just been paired. */
  async markInvitationMet(
    executor: Executor,
    input: {
      readonly first: string;
      readonly now: Date;
      readonly second: string;
    },
  ): Promise<void> {
    const pair = orderedPair(input.first, input.second);
    await executor
      .update(liveInvitations)
      .set({ resolvedAt: input.now, state: 'met', updatedAt: input.now })
      .where(
        and(
          eq(liveInvitations.pairLowId, pair.low),
          eq(liveInvitations.pairHighId, pair.high),
          inArray(liveInvitations.state, [...liveInvitationOpenStates]),
        ),
      );
  }

  /** How many requests to meet this person has sent in the window. */
  async countInvitationsSince(
    executor: Executor,
    input: { readonly since: Date; readonly userId: string },
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(liveInvitations)
      .where(
        and(
          eq(liveInvitations.inviterId, input.userId),
          gte(liveInvitations.createdAt, input.since),
        ),
      );
    return rows.at(0)?.total ?? 0;
  }

  /** How many of this person's requests are still open. */
  async countOpenInvitations(
    executor: Executor,
    input: { readonly userId: string },
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(liveInvitations)
      .where(
        and(
          eq(liveInvitations.inviterId, input.userId),
          inArray(liveInvitations.state, [...liveInvitationOpenStates]),
        ),
      );
    return rows.at(0)?.total ?? 0;
  }
}
