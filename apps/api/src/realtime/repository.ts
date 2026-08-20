import { and, eq, sql } from 'drizzle-orm';

import type {
  DatabaseHandle,
  Executor,
  TransactionHandle,
} from '../database/executor.js';
import {
  isEndReasonValidFor,
  liveRtcSessionStates,
  mayTransitionRtcSession,
  type RtcCallMedium,
  type RtcEndReason,
  type RtcParticipantRole,
  type RtcSessionState,
} from './policy.js';
import { realtimeParticipants, realtimeSessions } from './schema.js';

export type RtcSessionRow = typeof realtimeSessions.$inferSelect;
export type RtcParticipantRow = typeof realtimeParticipants.$inferSelect;

export interface RtcSessionWithParticipants {
  readonly participants: readonly RtcParticipantRow[];
  readonly session: RtcSessionRow;
}

/** The ordered pair, so the same two people always key the same way. */
export function orderedPair(
  first: string,
  second: string,
): { readonly high: string; readonly low: string } {
  const left = first.toLowerCase();
  const right = second.toLowerCase();
  return left < right ? { high: right, low: left } : { high: left, low: right };
}

/**
 * REALTIME's storage.
 *
 * Two rules shape everything here. A transition is applied by a guarded
 * `update` whose `where` clause restates the state it expects, so two callers
 * racing to end the same call produce one transition and the loser observes it
 * rather than overwriting it. And a terminal state, its instant, and its reason
 * are always written by the same statement, because a row that says a call
 * ended without saying when or why is a record nobody can act on later.
 */
export class RtcRepository {
  constructor(private readonly database: DatabaseHandle) {}

  transaction<T>(run: (executor: TransactionHandle) => Promise<T>): Promise<T> {
    return this.database.transaction(run);
  }

  /** Present so the class owns a handle of its own, as the other domains do. */
  get transactionless(): DatabaseHandle {
    return this.database;
  }

  /**
   * Opens an invitation, or returns nothing when the pair already has a live
   * call.
   *
   * Idempotency is decided by the partial unique index over the live pair
   * rather than by a prior read, which two concurrent invitations would both
   * pass. The caller reads the winner's session when this returns `undefined`.
   */
  async insertSession(
    executor: Executor,
    input: {
      readonly id: string;
      readonly initiatorId: string;
      readonly invitationExpiresAt: Date;
      readonly medium: RtcCallMedium;
      readonly now: Date;
      readonly originIntroductionId: string;
      readonly recipientId: string;
    },
  ): Promise<RtcSessionRow | undefined> {
    const pair = orderedPair(input.initiatorId, input.recipientId);
    const inserted = await executor
      .insert(realtimeSessions)
      .values({
        authorizationGeneration: 1,
        createdAt: input.now,
        id: input.id,
        initiatorId: input.initiatorId,
        invitationExpiresAt: input.invitationExpiresAt,
        medium: input.medium,
        originIntroductionId: input.originIntroductionId,
        pairHighId: pair.high,
        pairLowId: pair.low,
        state: 'invited',
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    const session = inserted.at(0);
    if (session === undefined) return undefined;

    // Both participants are written by the same statement as each other and
    // inside the same transaction as the session, so a session can never exist
    // with one side missing or with a third party attached.
    await executor.insert(realtimeParticipants).values([
      {
        invitedAt: input.now,
        role: 'caller',
        sessionId: session.id,
        userId: input.initiatorId,
      },
      {
        invitedAt: input.now,
        role: 'recipient',
        sessionId: session.id,
        userId: input.recipientId,
      },
    ]);
    return session;
  }

  /** The live call for a pair, if there is one. */
  async findLiveForPair(
    executor: Executor,
    input: { readonly first: string; readonly second: string },
  ): Promise<RtcSessionRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select()
      .from(realtimeSessions)
      .where(
        and(
          eq(realtimeSessions.pairLowId, pair.low),
          eq(realtimeSessions.pairHighId, pair.high),
          inLiveStates(),
        ),
      )
      .limit(1);
    return rows.at(0);
  }

  /**
   * One session and its participants, for a caller who has already been
   * established as one of them.
   *
   * Authorization is not performed here. The service decides whether the actor
   * is a participant, because a repository that refused would answer a
   * different question — "does this exist" — in a way a caller could use to
   * learn that somebody else's call does.
   */
  async findById(
    executor: Executor,
    id: string,
  ): Promise<RtcSessionWithParticipants | undefined> {
    const sessions = await executor
      .select()
      .from(realtimeSessions)
      .where(eq(realtimeSessions.id, id))
      .limit(1);
    const session = sessions.at(0);
    if (session === undefined) return undefined;
    const participants = await executor
      .select()
      .from(realtimeParticipants)
      .where(eq(realtimeParticipants.sessionId, id));
    return { participants, session };
  }

  /** Locks one session row, so a transition is decided against current state. */
  async lockById(
    executor: TransactionHandle,
    id: string,
  ): Promise<RtcSessionRow | undefined> {
    const rows = await executor
      .select()
      .from(realtimeSessions)
      .where(eq(realtimeSessions.id, id))
      .limit(1)
      .for('update');
    return rows.at(0);
  }

  /**
   * Moves a session to a non-terminal state.
   *
   * The expected state is restated in the `where` clause rather than merely
   * checked beforehand, so a concurrent transition loses rather than being
   * overwritten. Returns the new row, or nothing when somebody else moved it
   * first.
   */
  async transitionSession(
    executor: Executor,
    input: {
      readonly acceptedAt?: Date;
      readonly connectedAt?: Date;
      readonly expected: RtcSessionState;
      readonly id: string;
      readonly next: RtcSessionState;
      readonly now: Date;
    },
  ): Promise<RtcSessionRow | undefined> {
    if (!mayTransitionRtcSession(input.expected, input.next)) {
      throw new Error(
        `Refusing an unmodelled RTC transition: ${input.expected} -> ${input.next}`,
      );
    }
    const updated = await executor
      .update(realtimeSessions)
      .set({
        ...(input.acceptedAt === undefined
          ? {}
          : { acceptedAt: input.acceptedAt }),
        ...(input.connectedAt === undefined
          ? {}
          : { connectedAt: input.connectedAt }),
        state: input.next,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeSessions.id, input.id),
          eq(realtimeSessions.state, input.expected),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * Ends a session, recording when and why, and advancing the authorization
   * generation so every credential issued under the previous one is dead.
   *
   * The generation is advanced by the same statement that writes the terminal
   * state. Doing it in a second statement would leave a window in which a call
   * is over and its credentials are still current, which is the one window this
   * column exists to close.
   */
  async terminateSession(
    executor: Executor,
    input: {
      readonly expected: RtcSessionState;
      readonly id: string;
      readonly now: Date;
      readonly reason: RtcEndReason;
      readonly terminal: RtcSessionState;
    },
  ): Promise<RtcSessionRow | undefined> {
    if (!mayTransitionRtcSession(input.expected, input.terminal)) {
      throw new Error(
        `Refusing an unmodelled RTC transition: ${input.expected} -> ${input.terminal}`,
      );
    }
    if (!isEndReasonValidFor(input.terminal, input.reason)) {
      throw new Error(
        `Refusing to record ${input.terminal} for reason ${input.reason}`,
      );
    }
    const updated = await executor
      .update(realtimeSessions)
      .set({
        authorizationGeneration: sql`${realtimeSessions.authorizationGeneration} + 1`,
        endReason: input.reason,
        endedAt: input.now,
        state: input.terminal,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeSessions.id, input.id),
          eq(realtimeSessions.state, input.expected),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /** Records that one side answered. Never taken from a provider. */
  async markParticipantAccepted(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly sessionId: string;
      readonly userId: string;
    },
  ): Promise<void> {
    await executor
      .update(realtimeParticipants)
      .set({ acceptedAt: input.now })
      .where(
        and(
          eq(realtimeParticipants.sessionId, input.sessionId),
          eq(realtimeParticipants.userId, input.userId),
        ),
      );
  }

  /** Invitations whose own deadline has passed, oldest first. */
  async claimExpiredInvitations(
    executor: Executor,
    input: { readonly limit: number; readonly now: Date },
  ): Promise<readonly RtcSessionRow[]> {
    return executor
      .select()
      .from(realtimeSessions)
      .where(
        and(
          eq(realtimeSessions.state, 'invited'),
          sql`${realtimeSessions.invitationExpiresAt} <= ${input.now}`,
        ),
      )
      .orderBy(realtimeSessions.sequence)
      .limit(input.limit);
  }

  /** The participant row for one person on one session, or nothing. */
  async findParticipant(
    executor: Executor,
    input: { readonly sessionId: string; readonly userId: string },
  ): Promise<RtcParticipantRow | undefined> {
    const rows = await executor
      .select()
      .from(realtimeParticipants)
      .where(
        and(
          eq(realtimeParticipants.sessionId, input.sessionId),
          eq(realtimeParticipants.userId, input.userId),
        ),
      )
      .limit(1);
    return rows.at(0);
  }
}

export function participantRoleOf(
  participants: readonly RtcParticipantRow[],
  userId: string,
): RtcParticipantRole | undefined {
  return participants.find((row) => row.userId === userId)?.role;
}

function inLiveStates() {
  return sql`${realtimeSessions.state} in (${sql.raw(
    liveRtcSessionStates.map((state) => `'${state}'`).join(', '),
  )})`;
}
