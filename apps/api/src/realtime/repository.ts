import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

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
  type RtcProviderObligation,
  type RtcSessionState,
} from './policy.js';
import {
  realtimeJoinIssuances,
  realtimeParticipants,
  realtimeProviderEvents,
  realtimeProviderObligations,
  realtimeSessions,
} from './schema.js';

export type RtcSessionRow = typeof realtimeSessions.$inferSelect;
export type RtcParticipantRow = typeof realtimeParticipants.$inferSelect;
export type RtcProviderObligationRow =
  typeof realtimeProviderObligations.$inferSelect;
export type RtcProviderEventRow = typeof realtimeProviderEvents.$inferSelect;

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
        purpose: 'introduced',
        state: 'invited',
        stateEnteredAt: input.now,
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

  /**
   * Opens the session that carries a random live encounter, already answered.
   *
   * Deliberately not an invitation. Neither person was invited: both entered
   * the matching pool, which is a stronger and earlier consent than answering a
   * ring, and modelling it as `invited` would produce a session that one of
   * them had to accept before the other could be heard — plus an
   * `invitationExpiresAt` deadline that means nothing and a `rejected` path
   * neither of them can reach. So it is created in `accepted`, with both
   * participants already marked as having accepted, at the instant the server
   * put them together.
   *
   * `initiatorId` is one of the two, because a session's own check constraint
   * requires it and the participant roles are a fixed pair. It carries no
   * product meaning here — nobody called anybody — and the surfaces built on
   * this never render a caller or a recipient for a live encounter.
   *
   * Idempotency is decided by the unique index over the encounter rather than
   * by a prior read, which two clients reaching for media at the same instant
   * would both pass. The caller reads the winner's session when this returns
   * `undefined`.
   */
  async insertLiveSession(
    executor: Executor,
    input: {
      readonly first: string;
      readonly id: string;
      readonly liveEncounterId: string;
      readonly medium: RtcCallMedium;
      readonly now: Date;
      readonly second: string;
    },
  ): Promise<RtcSessionRow | undefined> {
    const pair = orderedPair(input.first, input.second);
    const inserted = await executor
      .insert(realtimeSessions)
      .values({
        acceptedAt: input.now,
        authorizationGeneration: 1,
        createdAt: input.now,
        id: input.id,
        initiatorId: pair.low,
        // A live session has no invitation, so nothing is ever answered against
        // this deadline. It is written as the creation instant rather than as a
        // future time so that no sweep, no query, and no reader can mistake a
        // live session for an invitation that is still standing.
        invitationExpiresAt: input.now,
        liveEncounterId: input.liveEncounterId,
        medium: input.medium,
        pairHighId: pair.high,
        pairLowId: pair.low,
        purpose: 'live_discovery',
        state: 'accepted',
        stateEnteredAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    const session = inserted.at(0);
    if (session === undefined) return undefined;

    await executor.insert(realtimeParticipants).values([
      {
        acceptedAt: input.now,
        invitedAt: input.now,
        role: 'caller',
        sessionId: session.id,
        userId: pair.low,
      },
      {
        acceptedAt: input.now,
        invitedAt: input.now,
        role: 'recipient',
        sessionId: session.id,
        userId: pair.high,
      },
    ]);
    return session;
  }

  /** The session opened for one live encounter, if one has been. */
  async findByLiveEncounter(
    executor: Executor,
    liveEncounterId: string,
  ): Promise<RtcSessionRow | undefined> {
    const rows = await executor
      .select()
      .from(realtimeSessions)
      .where(eq(realtimeSessions.liveEncounterId, liveEncounterId))
      .limit(1);
    return rows.at(0);
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
   * The live call between two people, locked.
   *
   * Distinct from `findLiveForPair` because the caller is about to end it. A
   * plain read would be a check-then-act: the pair lock alone does not close
   * this, because the transitions a call makes on its own — reaching a provider,
   * observing media, a stall sweep closing it — deliberately do not take the
   * pair lock, and one of those landing between the read and the write would
   * leave a guarded terminate matching nothing and the call still running.
   */
  async lockLiveForPair(
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
      .limit(1)
      .for('update');
    return rows.at(0);
  }

  /**
   * Every live call one person is in.
   *
   * For enforcement against an account rather than against a pair. Both sides
   * of the ordered pair are searched, because which side somebody is on is an
   * artefact of identifier ordering and says nothing about who they are.
   *
   * Rows are locked as they are read. A safety decision that found a call and
   * then lost a race to end it would leave the call running, which is the one
   * outcome this whole path exists to prevent.
   */
  async lockLiveForUser(
    executor: Executor,
    input: { readonly limit: number; readonly userId: string },
  ): Promise<readonly RtcSessionRow[]> {
    return executor
      .select()
      .from(realtimeSessions)
      .where(
        and(
          or(
            eq(realtimeSessions.pairLowId, input.userId),
            eq(realtimeSessions.pairHighId, input.userId),
          ),
          inLiveStates(),
        ),
      )
      .orderBy(realtimeSessions.sequence)
      .limit(input.limit)
      .for('update');
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
        stateEnteredAt: input.now,
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
        stateEnteredAt: input.now,
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

  /**
   * Reserves the provider identity a session will be created under.
   *
   * Written and committed before the provider is contacted. That ordering is
   * the whole mechanism: an ambiguous create is answered by asking the provider
   * what it did with this key, and a key generated after the call would be a
   * key the provider never saw.
   */
  async reserveProviderIdentity(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly provider: string;
      readonly providerIdempotencyKey: string;
      readonly sessionId: string;
    },
  ): Promise<RtcSessionRow | undefined> {
    const updated = await executor
      .update(realtimeSessions)
      .set({
        provider: input.provider,
        providerIdempotencyKey: input.providerIdempotencyKey,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeSessions.id, input.sessionId),
          // Only once. A session that already carries a key keeps it, so a
          // retry reuses the identity the provider may already have seen.
          isNull(realtimeSessions.providerIdempotencyKey),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * Binds the provider's own handle to the session.
   *
   * Guarded on the reference still being absent, so two recoveries racing to
   * bind the same ambiguous create settle on one and the loser observes it.
   */
  async bindProviderSession(
    executor: Executor,
    input: {
      readonly now: Date;
      readonly providerReference: string;
      readonly sessionId: string;
    },
  ): Promise<RtcSessionRow | undefined> {
    const updated = await executor
      .update(realtimeSessions)
      .set({
        providerBoundAt: input.now,
        providerReference: input.providerReference,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeSessions.id, input.sessionId),
          isNull(realtimeSessions.providerReference),
        ),
      )
      .returning();
    return updated.at(0);
  }

  /**
   * Records what the platform owes a provider, in the transaction that decided
   * it. An obligation written afterwards is an obligation a crash can lose.
   */
  async recordObligation(
    executor: Executor,
    input: {
      readonly kind: RtcProviderObligation;
      readonly now: Date;
      readonly participantReference?: string;
      readonly provider: string;
      readonly providerReference: string;
      readonly sessionId: string;
    },
  ): Promise<void> {
    await executor.insert(realtimeProviderObligations).values({
      availableAt: input.now,
      createdAt: input.now,
      kind: input.kind,
      participantReference: input.participantReference ?? null,
      provider: input.provider,
      providerReference: input.providerReference,
      sessionId: input.sessionId,
      state: 'pending',
      updatedAt: input.now,
    });
  }

  /** Obligations that are due, oldest first. */
  async listDueObligations(
    executor: Executor,
    input: { readonly limit: number; readonly now: Date },
  ): Promise<readonly RtcProviderObligationRow[]> {
    return executor
      .select()
      .from(realtimeProviderObligations)
      .where(
        and(
          eq(realtimeProviderObligations.state, 'pending'),
          sql`${realtimeProviderObligations.availableAt} <= ${input.now}`,
        ),
      )
      .orderBy(realtimeProviderObligations.id)
      .limit(input.limit);
  }

  /**
   * Claims due obligations under a lease.
   *
   * `skip locked` rather than a plain read, so two workers draining at once
   * take disjoint work instead of both discharging the same teardown against a
   * provider. The lease is what makes a worker dying mid-discharge recoverable:
   * the row stays `pending`, its lease expires, and the next cycle picks it up
   * — which is why the claim also takes rows whose lease has run out.
   */
  async claimDueObligations(
    executor: Executor,
    input: {
      readonly leaseMilliseconds: number;
      readonly limit: number;
      readonly now: Date;
      readonly owner: string;
    },
  ): Promise<readonly RtcProviderObligationRow[]> {
    const due = await executor
      .select({ id: realtimeProviderObligations.id })
      .from(realtimeProviderObligations)
      .where(
        and(
          eq(realtimeProviderObligations.state, 'pending'),
          sql`${realtimeProviderObligations.availableAt} <= ${input.now}`,
          sql`(${realtimeProviderObligations.leaseExpiresAt} is null
               or ${realtimeProviderObligations.leaseExpiresAt} <= ${input.now})`,
        ),
      )
      .orderBy(realtimeProviderObligations.id)
      .limit(input.limit)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];

    return executor
      .update(realtimeProviderObligations)
      .set({
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseMilliseconds),
        leaseOwner: input.owner,
        updatedAt: input.now,
      })
      .where(
        inArray(
          realtimeProviderObligations.id,
          due.map((row) => row.id),
        ),
      )
      .returning();
  }

  /**
   * Defers an obligation that did not discharge, or abandons it loudly.
   *
   * Abandoning is a state rather than a deletion: a room this platform could
   * not tear down is exactly the thing an operator has to know about, and a row
   * quietly removed after eight tries would be a leak nobody could see.
   */
  async deferObligation(
    executor: Executor,
    input: {
      readonly availableAt: Date;
      readonly id: number;
      readonly now: Date;
      readonly reason: string;
      readonly terminal: boolean;
    },
  ): Promise<void> {
    await executor
      .update(realtimeProviderObligations)
      .set({
        attempts: sql`${realtimeProviderObligations.attempts} + 1`,
        availableAt: input.availableAt,
        failureReason: input.reason,
        leaseExpiresAt: null,
        leaseOwner: null,
        ...(input.terminal ? { state: 'abandoned' as const } : {}),
        updatedAt: input.now,
      })
      .where(eq(realtimeProviderObligations.id, input.id));
  }

  /**
   * Puts an obligation back without spending an attempt.
   *
   * The difference between "this failed" and "this is not owed yet" matters,
   * and collapsing them is what would abandon a perfectly good obligation
   * after eight cycles of a call that is simply still running. A postponement
   * records no failure reason, because nothing failed.
   */
  async postponeObligation(
    executor: Executor,
    input: {
      readonly availableAt: Date;
      readonly id: number;
      readonly now: Date;
    },
  ): Promise<void> {
    await executor
      .update(realtimeProviderObligations)
      .set({
        availableAt: input.availableAt,
        leaseExpiresAt: null,
        leaseOwner: null,
        updatedAt: input.now,
      })
      .where(eq(realtimeProviderObligations.id, input.id));
  }

  /** Settles one obligation. Retained either way; nothing is deleted. */
  async settleObligation(
    executor: Executor,
    input: {
      readonly discharged: boolean;
      readonly id: number;
      readonly now: Date;
      readonly reason?: string;
    },
  ): Promise<void> {
    await executor
      .update(realtimeProviderObligations)
      .set({
        attempts: sql`${realtimeProviderObligations.attempts} + 1`,
        ...(input.discharged
          ? {
              dischargedAt: input.now,
              leaseExpiresAt: null,
              leaseOwner: null,
              state: 'discharged' as const,
            }
          : {}),
        ...(input.reason === undefined ? {} : { failureReason: input.reason }),
        updatedAt: input.now,
      })
      .where(eq(realtimeProviderObligations.id, input.id));
  }

  /**
   * Records that a credential was minted, without the credential.
   *
   * Deliberately a separate write from the minting itself: the secret exists
   * only in the response, and nothing that touches storage ever holds it.
   */
  async recordIssuance(
    executor: Executor,
    input: {
      readonly authorizationGeneration: number;
      readonly expiresAt: Date;
      readonly now: Date;
      readonly sessionId: string;
      readonly userId: string;
    },
  ): Promise<void> {
    await executor.insert(realtimeJoinIssuances).values({
      authorizationGeneration: input.authorizationGeneration,
      expiresAt: input.expiresAt,
      issuedAt: input.now,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }

  /** How many credentials this person has been issued since an instant. */
  async countIssuancesSince(
    executor: Executor,
    input: { readonly since: Date; readonly userId: string },
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<string>`count(*)::text` })
      .from(realtimeJoinIssuances)
      .where(
        and(
          eq(realtimeJoinIssuances.userId, input.userId),
          sql`${realtimeJoinIssuances.issuedAt} >= ${input.since}`,
        ),
      );
    return Number(rows.at(0)?.total ?? '0');
  }

  /**
   * Records a verified callback, or reports that it is already recorded.
   *
   * `onConflictDoNothing` against the composite identity is what makes the
   * fiftieth delivery of one event cost a single refused insert. It returns
   * nothing on a duplicate, and the caller treats that as success — because it
   * is: the platform already holds the fact.
   */
  async recordProviderEvent(
    executor: Executor,
    input: {
      readonly normalizedEventType: string;
      readonly now: Date;
      readonly occurredAt: Date;
      readonly payloadDigest: string;
      readonly provider: string;
      readonly providerAccount: string;
      readonly providerEnvironment: string;
      readonly providerEventId: string;
      readonly providerReference: string | null;
    },
  ): Promise<RtcProviderEventRow | undefined> {
    const inserted = await executor
      .insert(realtimeProviderEvents)
      .values({
        availableAt: input.now,
        id: crypto.randomUUID(),
        normalizedEventType: input.normalizedEventType,
        occurredAt: input.occurredAt,
        payloadDigest: input.payloadDigest,
        provider: input.provider,
        providerAccount: input.providerAccount,
        providerEnvironment: input.providerEnvironment,
        providerEventId: input.providerEventId,
        providerReference: input.providerReference,
        receivedAt: input.now,
        state: 'received',
      })
      .onConflictDoNothing()
      .returning();
    return inserted.at(0);
  }

  /** Verified events waiting to be applied, oldest first. */
  async claimableProviderEvents(
    executor: Executor,
    input: { readonly limit: number; readonly now: Date },
  ): Promise<readonly RtcProviderEventRow[]> {
    return executor
      .select()
      .from(realtimeProviderEvents)
      .where(
        and(
          inArray(realtimeProviderEvents.state, ['received', 'retry_wait']),
          sql`${realtimeProviderEvents.availableAt} <= ${input.now}`,
        ),
      )
      .orderBy(realtimeProviderEvents.availableAt, realtimeProviderEvents.id)
      .limit(input.limit);
  }

  /** Settles one verified event. Retained either way; nothing is deleted. */
  async settleProviderEvent(
    executor: Executor,
    input: {
      readonly id: string;
      readonly now: Date;
      readonly reason?: string;
      readonly state: 'processed' | 'ignored' | 'dead_letter' | 'retry_wait';
    },
  ): Promise<void> {
    await executor
      .update(realtimeProviderEvents)
      .set({
        attempts: sql`${realtimeProviderEvents.attempts} + 1`,
        ...(input.state === 'processed' || input.state === 'ignored'
          ? { processedAt: input.now }
          : {}),
        ...(input.reason === undefined ? {} : { failureReason: input.reason }),
        state: input.state,
      })
      .where(eq(realtimeProviderEvents.id, input.id));
  }

  /** The call a provider room belongs to, if this platform still holds one. */
  async findByProviderReference(
    executor: Executor,
    input: { readonly provider: string; readonly providerReference: string },
  ): Promise<RtcSessionRow | undefined> {
    const rows = await executor
      .select()
      .from(realtimeSessions)
      .where(
        and(
          eq(realtimeSessions.provider, input.provider),
          eq(realtimeSessions.providerReference, input.providerReference),
        ),
      )
      .limit(1);
    return rows.at(0);
  }

  /**
   * Calls stuck in a state that has a deadline.
   *
   * One query for both bounded waits, because they are the same question asked
   * of two states: has this call been here longer than it is allowed to be.
   */
  /**
   * Sessions waiting to be observed as connected, oldest first.
   *
   * `connecting` with a provider reference: the platform has done everything it
   * can and is waiting to learn whether media actually started. A session with
   * no reference has nothing to ask about, and is left to the join timeout.
   *
   * Bounded and unlocked, because the caller takes each one to a provider
   * outside every transaction and the transition it then applies is guarded.
   */
  async findAwaitingConnection(
    executor: Executor,
    input: { readonly limit: number },
  ): Promise<readonly RtcSessionRow[]> {
    return executor
      .select()
      .from(realtimeSessions)
      .where(
        and(
          eq(realtimeSessions.state, 'connecting'),
          isNotNull(realtimeSessions.providerReference),
        ),
      )
      .orderBy(realtimeSessions.stateEnteredAt)
      .limit(input.limit);
  }

  async findExpiredByState(
    executor: Executor,
    input: {
      readonly deadline: Date;
      readonly limit: number;
      readonly state: 'connecting' | 'reconnecting';
    },
  ): Promise<readonly RtcSessionRow[]> {
    return executor
      .select()
      .from(realtimeSessions)
      .where(
        and(
          eq(realtimeSessions.state, input.state),
          sql`${realtimeSessions.stateEnteredAt} <= ${input.deadline}`,
        ),
      )
      .orderBy(realtimeSessions.stateEnteredAt)
      .limit(input.limit);
  }

  /**
   * Everything the abuse limits need, in one query.
   *
   * Four counts over rows this domain already holds, rather than a counter in
   * an ephemeral store. That matters beyond tidiness: a limit kept only in
   * Redis is reset by a flush or a restart, so somebody who wanted to get past
   * one would only have to wait for an operational event. These counts are
   * whatever the durable record says, always.
   *
   * One statement rather than four, because all four are asked at the same
   * instant in the same transaction, and four round trips inside a transaction
   * holding a pooled connection is four times the connection this decision
   * needs to occupy.
   */
  async countRecentActivity(
    executor: Executor,
    input: {
      readonly callerId: string;
      readonly first: string;
      readonly second: string;
      readonly since: Date;
    },
  ): Promise<{
    readonly invitations: number;
    readonly liveCalls: number;
    readonly pairInvitations: number;
    readonly providerSessions: number;
  }> {
    const pair = orderedPair(input.first, input.second);
    const rows = await executor
      .select({
        invitations: sql<string>`count(*) filter (
          where ${realtimeSessions.initiatorId} = ${input.callerId}
            and ${realtimeSessions.createdAt} >= ${input.since}
        )::text`,
        liveCalls: sql<string>`count(*) filter (
          where (${realtimeSessions.pairLowId} = ${input.callerId}
                 or ${realtimeSessions.pairHighId} = ${input.callerId})
            and ${realtimeSessions.state} in (${sql.raw(
              liveRtcSessionStates.map((state) => `'${state}'`).join(', '),
            )})
        )::text`,
        pairInvitations: sql<string>`count(*) filter (
          where ${realtimeSessions.pairLowId} = ${pair.low}
            and ${realtimeSessions.pairHighId} = ${pair.high}
            and ${realtimeSessions.initiatorId} = ${input.callerId}
            and ${realtimeSessions.createdAt} >= ${input.since}
        )::text`,
        providerSessions: sql<string>`count(*) filter (
          where ${realtimeSessions.initiatorId} = ${input.callerId}
            and ${realtimeSessions.providerBoundAt} >= ${input.since}
        )::text`,
      })
      .from(realtimeSessions);
    const row = rows.at(0);
    return {
      invitations: Number(row?.invitations ?? '0'),
      liveCalls: Number(row?.liveCalls ?? '0'),
      pairInvitations: Number(row?.pairInvitations ?? '0'),
      providerSessions: Number(row?.providerSessions ?? '0'),
    };
  }

  /** How many credentials have been minted for one call, by anybody. */
  async countIssuancesForCall(
    executor: Executor,
    sessionId: string,
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<string>`count(*)::text` })
      .from(realtimeJoinIssuances)
      .where(eq(realtimeJoinIssuances.sessionId, sessionId));
    return Number(rows.at(0)?.total ?? '0');
  }

  /**
   * How many credentials one person has been issued for one call.
   *
   * The reconnect-churn count: a reconnect obtains a fresh credential, so this
   * counts reconnect attempts without keeping a second ledger of them.
   */
  async countIssuancesForSessionSince(
    executor: Executor,
    input: {
      readonly sessionId: string;
      readonly since: Date;
      readonly userId: string;
    },
  ): Promise<number> {
    const rows = await executor
      .select({ total: sql<string>`count(*)::text` })
      .from(realtimeJoinIssuances)
      .where(
        and(
          eq(realtimeJoinIssuances.sessionId, input.sessionId),
          eq(realtimeJoinIssuances.userId, input.userId),
          sql`${realtimeJoinIssuances.issuedAt} >= ${input.since}`,
        ),
      );
    return Number(rows.at(0)?.total ?? '0');
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
