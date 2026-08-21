import { lockPair } from '../database/pair-lock.js';
import type { ConnectionDirectoryPort } from '../discovery/connections.js';
import type { OnboardingService } from '../users/onboarding.js';
import type { UserAccountRow } from '../users/repository.js';
import type { OutboxAppendPort } from '../events/outbox.js';
import type { RtcCallEligibilityPort } from './eligibility.js';
import {
  callInvitedEventName,
  callInvitedEventVersion,
  callMissedEventName,
  callMissedEventVersion,
  callSubjectType,
} from './events.js';
import {
  isTerminalRtcSessionState,
  maximumConcurrentRtcCalls,
  maximumRtcInvitationsPerCaller,
  maximumRtcInvitationsPerPair,
  maximumRtcProviderSessionsPerCaller,
  rtcAbuseWindowMilliseconds,
  rtcInvitationTimeoutMilliseconds,
  rtcJoinTimeoutMilliseconds,
  rtcReconnectGraceMilliseconds,
  type RtcCallMedium,
  type RtcEndReason,
} from './policy.js';
import type { RtcSignalPublisherPort } from './signalling.js';
import {
  participantRoleOf,
  type RtcRepository,
  type RtcSessionRow,
  type RtcSessionWithParticipants,
} from './repository.js';

export interface CallView {
  readonly acceptedAt: Date | undefined;
  readonly connectedAt: Date | undefined;
  readonly counterpartId: string;
  readonly createdAt: Date;
  readonly endReason: RtcEndReason | undefined;
  readonly endedAt: Date | undefined;
  readonly id: string;
  readonly invitationExpiresAt: Date;
  readonly medium: RtcCallMedium;
  /** Which side the caller of this API is on. Derived, never claimed. */
  readonly role: 'caller' | 'recipient';
  readonly state: string;
}

export type CallOutcome =
  | { readonly kind: 'call'; readonly view: CallView }
  /**
   * A bound was reached. Deliberately says only that, and never which bound or
   * how much of it is left: a refusal that reported its own counter would be a
   * way to measure somebody else's calling.
   */
  | { readonly kind: 'rate_limited' }
  /** The actor's own account does not currently permit calling. */
  | { readonly kind: 'not_eligible' }
  /** Deliberately indistinguishable from a call that does not exist. */
  | { readonly kind: 'not_found' }
  /** The pair may not talk, or the transition is not available now. */
  | { readonly kind: 'not_permitted' };

export interface RtcProviderOrchestration {
  bindProviderSession(input: {
    readonly medium: RtcCallMedium;
    readonly providerIdempotencyKey: string;
    readonly sessionId: string;
  }): Promise<
    | { readonly kind: 'bound'; readonly session: RtcSessionRow }
    | { readonly kind: 'unavailable' }
    | { readonly kind: 'unresolved' }
  >;
  readonly providerName: string;
}

export interface RtcServiceDependencies {
  readonly connections: ConnectionDirectoryPort;
  readonly eligibility: RtcCallEligibilityPort;
  readonly now: () => Date;
  readonly onboarding: OnboardingService;
  /** Absent until a provider adapter is composed. */
  readonly orchestrator?: RtcProviderOrchestration;
  /**
   * REALTIME's own transactional outbox. A published fact is written by the
   * same transaction that writes the call, so a process killed immediately
   * afterwards cannot leave somebody being called and nobody told.
   */
  readonly outbox: OutboxAppendPort;
  readonly repository: RtcRepository;
  /**
   * Best-effort fanout to connected clients. Published after the transition is
   * committed and never inside its transaction: a hint is worth nothing if
   * delivering it can fail the thing it describes.
   */
  readonly signals: RtcSignalPublisherPort;
}

/**
 * Call sessions.
 *
 * Four rules shape everything here.
 *
 * A call exists only because two people are already authorized to contact each
 * other, and REALTIME never decides that: it asks DISCOVERY's published
 * connection contract and the composed eligibility answer. There is no other
 * route into calling somebody, and no request body can assert one.
 *
 * Authorization is taken at the moment of the action and never from the state a
 * client is holding. Membership, the session's own state, the relationship, and
 * current eligibility are all re-read when somebody invites or accepts — inside
 * the transaction that writes, under the pair lock, so a block landing
 * mid-request either precedes the call or follows it and never straddles it.
 *
 * A transition is decided by the database, not by a prior read. Every mutation
 * restates the state it expects in its `where` clause, so two people hanging up
 * at the same instant produce one ending and the loser observes it.
 *
 * Ending is idempotent and terminal. A call that has finished answers the same
 * way however many times it is asked, because a retried hang-up is the ordinary
 * case rather than an error.
 */
export class RtcService {
  constructor(private readonly dependencies: RtcServiceDependencies) {}

  /**
   * Invites somebody to a call, or returns the live call the pair already has.
   *
   * The target is named through the relationship rather than through a
   * participant field: the caller supplies an introduction they are part of,
   * and the server derives who the other person is. A request cannot name a
   * participant, a session, a provider, a scope, or a state.
   */
  async invite(
    actor: UserAccountRow,
    input: {
      readonly introductionId: string;
      readonly medium: RtcCallMedium;
    },
  ): Promise<CallOutcome> {
    if (!(await this.mayUseRtc(actor))) return { kind: 'not_eligible' };

    const now = this.dependencies.now();
    // One transaction, one pooled connection, for the whole decision. Reading
    // the relationship on a separate handle first would make every invitation
    // want two connections in sequence, and a burst of them against one pair
    // would then queue for a connection while holding none — which is how a
    // busy pool becomes a stalled one. It also makes the relationship the write
    // is authorized against the one that is true when the write happens.
    const outcome = await this.dependencies.repository.transaction(
      async (
        executor,
      ): Promise<
        | { readonly counterpartId: string; readonly session: RtcSessionRow }
        | 'denied'
        | 'limited'
        | 'unknown'
      > => {
        const connection =
          await this.dependencies.connections.mutualConnectionFor({
            actorId: actor.id,
            executor,
            introductionId: input.introductionId,
          });
        // A pending, expired, closed, or someone else's introduction answers
        // exactly as one that does not exist, so probing discloses nothing.
        if (connection === undefined) return 'unknown';

        await lockPair(executor, actor.id, connection.counterpartId);
        if (
          !(await this.dependencies.eligibility.mayCall({
            executor,
            first: actor.id,
            now,
            second: connection.counterpartId,
          }))
        ) {
          return 'denied';
        }

        // Counted under the pair lock and inside the writing transaction, on
        // the same rule as every other check here: a count taken outside would
        // be a number that was true a moment ago, and two invitations racing
        // would both read the same one and both write.
        const recent = await this.dependencies.repository.countRecentActivity(
          executor,
          {
            callerId: actor.id,
            first: actor.id,
            second: connection.counterpartId,
            since: new Date(now.getTime() - rtcAbuseWindowMilliseconds),
          },
        );
        if (
          recent.invitations >= maximumRtcInvitationsPerCaller ||
          recent.pairInvitations >= maximumRtcInvitationsPerPair ||
          recent.liveCalls >= maximumConcurrentRtcCalls ||
          recent.providerSessions >= maximumRtcProviderSessionsPerCaller
        ) {
          return 'limited';
        }

        const created = await this.dependencies.repository.insertSession(
          executor,
          {
            id: crypto.randomUUID(),
            initiatorId: actor.id,
            invitationExpiresAt: new Date(
              now.getTime() + rtcInvitationTimeoutMilliseconds,
            ),
            medium: input.medium,
            now,
            originIntroductionId: connection.introductionId,
            recipientId: connection.counterpartId,
          },
        );
        if (created !== undefined) {
          await this.dependencies.outbox.append(executor, {
            correlationId: created.id,
            eventName: callInvitedEventName,
            eventVersion: callInvitedEventVersion,
            id: crypto.randomUUID(),
            now,
            occurredAt: now,
            payload: {
              callId: created.id,
              callerId: actor.id,
              recipientId: connection.counterpartId,
            },
            subjectId: created.id,
            subjectType: callSubjectType,
          });
          return { counterpartId: connection.counterpartId, session: created };
        }

        // The pair already holds a live call. The loser of the unique index
        // reads the winner's rather than creating a second one, which is what
        // makes two people calling each other at the same instant produce one
        // call.
        const existing = await this.dependencies.repository.findLiveForPair(
          executor,
          { first: actor.id, second: connection.counterpartId },
        );
        if (existing === undefined) {
          throw new Error('Live call vanished between insert and read');
        }
        return { counterpartId: connection.counterpartId, session: existing };
      },
    );
    if (outcome === 'unknown') return { kind: 'not_found' };
    if (outcome === 'denied') return { kind: 'not_permitted' };
    if (outcome === 'limited') return { kind: 'rate_limited' };
    return this.viewOf(actor.id, outcome.session, outcome.counterpartId);
  }

  /**
   * Answers an invitation.
   *
   * Eligibility is composed again rather than inherited from the invitation. A
   * block that commits between the invitation and this moment means the call is
   * refused and the invitation is ended, which is the whole reason acceptance
   * is not simply a state change.
   */
  async accept(actor: UserAccountRow, sessionId: string): Promise<CallOutcome> {
    if (!(await this.mayUseRtc(actor))) return { kind: 'not_eligible' };
    return this.actOnCall(actor, sessionId, async (context) => {
      const { executor, held, role } = context;
      if (role !== 'recipient') return { kind: 'not_permitted' };
      if (held.state !== 'invited') return { kind: 'not_permitted' };
      const now = this.dependencies.now();
      if (held.invitationExpiresAt <= now) {
        // The deadline passed while this request was in flight. It expires
        // rather than being answered, so a late acceptance can never revive an
        // invitation the other person has already stopped waiting on.
        await this.dependencies.repository.terminateSession(executor, {
          expected: 'invited',
          id: held.id,
          now,
          reason: 'invitation_expired',
          terminal: 'expired',
        });
        return { kind: 'not_permitted' };
      }

      if (
        !(await this.dependencies.eligibility.mayCall({
          executor,
          first: held.pairLowId,
          now,
          second: held.pairHighId,
        }))
      ) {
        await this.dependencies.repository.terminateSession(executor, {
          expected: 'invited',
          id: held.id,
          now,
          reason: 'safety_block',
          terminal: 'ended',
        });
        return { kind: 'not_permitted' };
      }

      const accepted = await this.dependencies.repository.transitionSession(
        executor,
        {
          acceptedAt: now,
          expected: 'invited',
          id: held.id,
          next: 'accepted',
          now,
        },
      );
      if (accepted === undefined) return { kind: 'not_permitted' };
      await this.dependencies.repository.markParticipantAccepted(executor, {
        now,
        sessionId: held.id,
        userId: actor.id,
      });
      return { kind: 'session', session: accepted };
    });
  }

  /** Declines an invitation. Only the recipient may. */
  async reject(actor: UserAccountRow, sessionId: string): Promise<CallOutcome> {
    return this.finish(actor, sessionId, {
      allowedRole: 'recipient',
      from: ['invited'],
      reason: 'declined',
      terminal: 'rejected',
    });
  }

  /** Withdraws an invitation before it is answered. Only the caller may. */
  async cancel(actor: UserAccountRow, sessionId: string): Promise<CallOutcome> {
    return this.finish(actor, sessionId, {
      allowedRole: 'caller',
      from: ['invited'],
      reason: 'withdrawn',
      terminal: 'cancelled',
    });
  }

  /** Hangs up. Either participant may, from any state after acceptance. */
  async end(actor: UserAccountRow, sessionId: string): Promise<CallOutcome> {
    return this.finish(actor, sessionId, {
      allowedRole: undefined,
      from: ['accepted', 'connecting', 'active', 'reconnecting', 'ending'],
      reason: 'hung_up',
      terminal: 'ended',
    });
  }

  /** One call the actor is a participant of. */
  async read(actor: UserAccountRow, sessionId: string): Promise<CallOutcome> {
    const found = await this.dependencies.repository.findById(
      this.dependencies.repository.transactionless,
      sessionId,
    );
    if (found === undefined) return { kind: 'not_found' };
    const role = participantRoleOf(found.participants, actor.id);
    // A call somebody is not in is reported exactly as one that does not
    // exist, so an identifier cannot be used to learn that two other people
    // are talking.
    if (role === undefined) return { kind: 'not_found' };
    return this.viewOf(actor.id, found.session, counterpartOf(found, actor.id));
  }

  /**
   * Gives an accepted call somewhere to happen.
   *
   * Deliberately not part of the acceptance transaction. Acceptance is a
   * platform fact and commits on its own; reaching a provider is a network call
   * that must not run inside a transaction, and a provider that is slow, absent,
   * or ambiguous must not be able to un-accept a call somebody answered.
   *
   * So the states are separate too. A call that cannot reach a provider fails
   * with a reason that says so, rather than looking like somebody hung up.
   */
  async establishProviderSession(sessionId: string): Promise<CallOutcome> {
    const found = await this.dependencies.repository.findById(
      this.dependencies.repository.transactionless,
      sessionId,
    );
    if (found === undefined) return { kind: 'not_found' };
    if (found.session.state !== 'accepted') return { kind: 'not_permitted' };

    const orchestrator = this.dependencies.orchestrator;
    if (orchestrator === undefined) return { kind: 'not_permitted' };

    const now = this.dependencies.now();
    // The key is reserved and committed before the provider is contacted. That
    // ordering is what makes an ambiguous create answerable rather than lost.
    const reserved = await this.dependencies.repository.transaction(
      (executor) =>
        this.dependencies.repository.reserveProviderIdentity(executor, {
          now,
          provider: orchestrator.providerName,
          providerIdempotencyKey: `rtc-${sessionId}`,
          sessionId,
        }),
    );
    const key =
      reserved?.providerIdempotencyKey ??
      found.session.providerIdempotencyKey ??
      `rtc-${sessionId}`;

    const outcome = await orchestrator.bindProviderSession({
      medium: found.session.medium,
      providerIdempotencyKey: key,
      sessionId,
    });

    if (outcome.kind === 'unavailable') {
      // No approved provider. The call fails for that reason rather than
      // pretending somebody ended it.
      const failed = await this.dependencies.repository.transaction(
        (executor) =>
          this.dependencies.repository.terminateSession(executor, {
            expected: 'accepted',
            id: sessionId,
            now: this.dependencies.now(),
            reason: 'provider_unavailable',
            terminal: 'failed',
          }),
      );
      if (failed === undefined) return { kind: 'not_permitted' };
      return this.viewOf(
        found.session.initiatorId,
        failed,
        counterpartOf(found, found.session.initiatorId),
      );
    }

    if (outcome.kind === 'unresolved') {
      // Recoverable: the reservation stands, the call is still accepted, and
      // reconciliation owns it. Nothing infers success from silence.
      return { kind: 'not_permitted' };
    }

    const connecting = await this.dependencies.repository.transaction(
      async (executor) => {
        const moved = await this.dependencies.repository.transitionSession(
          executor,
          {
            expected: 'accepted',
            id: sessionId,
            next: 'connecting',
            now: this.dependencies.now(),
          },
        );
        if (moved === undefined) return undefined;
        // The obligation to tear this room down is recorded now, while the
        // reference is in hand, rather than when the call ends — a crash
        // between ending and recording would otherwise leak the room.
        return moved;
      },
    );
    if (connecting === undefined) return { kind: 'not_permitted' };
    return this.viewOf(
      connecting.initiatorId,
      connecting,
      counterpartOf(found, connecting.initiatorId),
    );
  }

  /**
   * Records that media is flowing.
   *
   * An operational observation, taken from a verified provider event rather
   * than from either endpoint: only the endpoints can see media, and they are
   * the least trustworthy participants in the call. Reaching `active` grants
   * nothing that acceptance did not already grant.
   */
  async markConnected(sessionId: string): Promise<boolean> {
    const now = this.dependencies.now();
    const moved = await this.dependencies.repository.transaction(
      async (executor) => {
        const held = await this.dependencies.repository.lockById(
          executor,
          sessionId,
        );
        if (held === undefined) return undefined;
        if (held.state !== 'connecting' && held.state !== 'reconnecting') {
          return undefined;
        }
        return this.dependencies.repository.transitionSession(executor, {
          ...(held.connectedAt === null ? { connectedAt: now } : {}),
          expected: held.state,
          id: sessionId,
          next: 'active',
          now,
        });
      },
    );
    if (moved !== undefined) this.announce(moved);
    return moved !== undefined;
  }

  /**
   * Records that transport was interrupted.
   *
   * A network drop is not a hang-up, and treating it as one would end calls
   * every time somebody walked between two cell towers. The call keeps its
   * participants, its provider room, and its authorization generation; what
   * starts is a bounded wait.
   */
  async markInterrupted(sessionId: string): Promise<boolean> {
    const now = this.dependencies.now();
    const moved = await this.dependencies.repository.transaction(
      async (executor) => {
        const held = await this.dependencies.repository.lockById(
          executor,
          sessionId,
        );
        if (held?.state !== 'active') return undefined;
        return this.dependencies.repository.transitionSession(executor, {
          expected: 'active',
          id: sessionId,
          next: 'reconnecting',
          now,
        });
      },
    );
    if (moved !== undefined) this.announce(moved);
    return moved !== undefined;
  }

  /**
   * Closes calls that have waited longer than they are allowed to.
   *
   * Two deadlines, one mechanism. A call that never established media is a
   * failure to connect rather than a call somebody ended, and an interruption
   * that outlives its grace is an ending — a call nobody is connected to cannot
   * be told apart from a call everybody has left.
   *
   * Recovery rather than a timer: both deadlines are already true in the
   * database, so a missed sweep delays a record and changes no decision. Every
   * closure is a guarded transition, so two sweeps racing produce one ending.
   */
  async closeStalledCalls(limit = 100): Promise<{
    readonly failedToConnect: number;
    readonly reconnectExpired: number;
  }> {
    const now = this.dependencies.now();
    const failedToConnect = await this.closeExpired({
      deadline: new Date(now.getTime() - rtcJoinTimeoutMilliseconds),
      limit,
      now,
      reason: 'join_timeout',
      state: 'connecting',
      terminal: 'failed',
    });
    const reconnectExpired = await this.closeExpired({
      deadline: new Date(now.getTime() - rtcReconnectGraceMilliseconds),
      limit,
      now,
      reason: 'reconnect_expired',
      state: 'reconnecting',
      terminal: 'ended',
    });
    return { failedToConnect, reconnectExpired };
  }

  private async closeExpired(input: {
    readonly deadline: Date;
    readonly limit: number;
    readonly now: Date;
    readonly reason: RtcEndReason;
    readonly state: 'connecting' | 'reconnecting';
    readonly terminal: 'failed' | 'ended';
  }): Promise<number> {
    const due = await this.dependencies.repository.findExpiredByState(
      this.dependencies.repository.transactionless,
      { deadline: input.deadline, limit: input.limit, state: input.state },
    );
    let closed = 0;
    for (const session of due) {
      const settled = await this.dependencies.repository.transaction(
        (executor) =>
          this.dependencies.repository.terminateSession(executor, {
            expected: input.state,
            id: session.id,
            now: input.now,
            reason: input.reason,
            terminal: input.terminal,
          }),
      );
      if (settled !== undefined) {
        closed += 1;
        this.announce(settled);
      }
    }
    return closed;
  }

  /**
   * Expires invitations whose deadline has passed.
   *
   * Recovery rather than a timer: the deadline is already stored on the row, so
   * this discovers facts that are true rather than firing an alarm at the
   * instant one becomes true. A missed sweep delays the record and changes no
   * decision, because acceptance independently refuses a passed deadline.
   */
  async expireDueInvitations(limit = 100): Promise<number> {
    const now = this.dependencies.now();
    const due = await this.dependencies.repository.claimExpiredInvitations(
      this.dependencies.repository.transactionless,
      { limit, now },
    );
    let expired = 0;
    for (const session of due) {
      const settled = await this.dependencies.repository.transaction(
        async (executor) => {
          const closed = await this.dependencies.repository.terminateSession(
            executor,
            {
              expected: 'invited',
              id: session.id,
              now,
              reason: 'invitation_expired',
              terminal: 'expired',
            },
          );
          if (closed === undefined) return undefined;
          // Written by the transaction that closed it, and only when that
          // transition actually won. Two sweeps racing produce one expiry and
          // therefore one missed-call fact.
          await this.dependencies.outbox.append(executor, {
            correlationId: closed.id,
            eventName: callMissedEventName,
            eventVersion: callMissedEventVersion,
            id: crypto.randomUUID(),
            now,
            occurredAt: now,
            payload: {
              callId: closed.id,
              callerId: closed.initiatorId,
              recipientId:
                closed.initiatorId === closed.pairLowId
                  ? closed.pairHighId
                  : closed.pairLowId,
            },
            subjectId: closed.id,
            subjectType: callSubjectType,
          });
          return closed;
        },
      );
      if (settled !== undefined) expired += 1;
    }
    return expired;
  }

  private async finish(
    actor: UserAccountRow,
    sessionId: string,
    rule: {
      readonly allowedRole: 'caller' | 'recipient' | undefined;
      readonly from: readonly string[];
      readonly reason: RtcEndReason;
      readonly terminal: 'rejected' | 'cancelled' | 'ended';
    },
  ): Promise<CallOutcome> {
    return this.actOnCall(actor, sessionId, async (context) => {
      const { executor, held, role } = context;
      if (rule.allowedRole !== undefined && role !== rule.allowedRole) {
        return { kind: 'not_permitted' };
      }
      // Already finished. Answering with the call rather than an error is what
      // makes a retried hang-up harmless.
      if (isTerminalRtcSessionState(held.state)) {
        return { kind: 'session', session: held };
      }
      if (!rule.from.includes(held.state)) return { kind: 'not_permitted' };

      const now = this.dependencies.now();
      const settled = await this.dependencies.repository.terminateSession(
        executor,
        {
          expected: held.state,
          id: held.id,
          now,
          reason: rule.reason,
          terminal: rule.terminal,
        },
      );
      if (settled === undefined) return { kind: 'not_permitted' };
      return { kind: 'session', session: settled };
    });
  }

  /**
   * Resolves the actor against the call, locks it, and runs one guarded
   * transition inside that transaction.
   *
   * The participant check happens after the row lock rather than before it, so
   * the membership a decision is taken against is the membership that is true
   * when the write happens.
   */
  private async actOnCall(
    actor: UserAccountRow,
    sessionId: string,
    run: (context: {
      readonly executor: Parameters<
        Parameters<RtcRepository['transaction']>[0]
      >[0];
      readonly held: RtcSessionRow;
      readonly role: 'caller' | 'recipient';
    }) => Promise<
      | { readonly kind: 'session'; readonly session: RtcSessionRow }
      | { readonly kind: 'not_permitted' }
    >,
  ): Promise<CallOutcome> {
    const outcome = await this.dependencies.repository.transaction(
      async (executor) => {
        const found = await this.dependencies.repository.findById(
          executor,
          sessionId,
        );
        if (found === undefined) return { kind: 'not_found' } as const;
        const role = participantRoleOf(found.participants, actor.id);
        if (role === undefined) return { kind: 'not_found' } as const;

        // Pair lock before the row lock, in the order `pair-lock.ts` requires,
        // so a concurrent safety decision about these two people either
        // precedes this transition or waits for it.
        await lockPair(
          executor,
          found.session.pairLowId,
          found.session.pairHighId,
        );
        const held = await this.dependencies.repository.lockById(
          executor,
          sessionId,
        );
        if (held === undefined) return { kind: 'not_found' } as const;

        const result = await run({ executor, held, role });
        if (result.kind === 'not_permitted') {
          return { kind: 'not_permitted' } as const;
        }
        return {
          counterpartId: counterpartOf(found, actor.id),
          kind: 'session',
          session: result.session,
        } as const;
      },
    );
    if (outcome.kind === 'not_found') return { kind: 'not_found' };
    if (outcome.kind === 'not_permitted') return { kind: 'not_permitted' };
    return this.viewOf(actor.id, outcome.session, outcome.counterpartId);
  }

  /**
   * Whether this account may take part in RTC at all, before any pair check.
   *
   * The same admission standard MESSAGING applies, taken from the same derived
   * eligibility rather than from a second copy of the rule. An account that may
   * not send a message may not place a call either.
   */
  private async mayUseRtc(actor: UserAccountRow): Promise<boolean> {
    if (actor.status !== 'active') return false;
    const eligibility = await this.dependencies.onboarding.evaluate(actor);
    return eligibility.step === 'completed';
  }

  /**
   * Tells whoever is connected that a call moved.
   *
   * After the commit, outside the transaction, and never awaited for
   * correctness: the publisher swallows its own failures, and a client that
   * hears nothing reads authoritative state instead. Both participants are
   * named, because either may have a device waiting on it.
   */
  private announce(session: RtcSessionRow): void {
    void this.dependencies.signals.publish({
      callId: session.id,
      generation: session.authorizationGeneration,
      recipientIds: [session.pairLowId, session.pairHighId],
      state: session.state,
    });
  }

  private viewOf(
    actorId: string,
    session: RtcSessionRow,
    counterpartId: string,
  ): CallOutcome {
    this.announce(session);
    return {
      kind: 'call',
      view: {
        acceptedAt: session.acceptedAt ?? undefined,
        connectedAt: session.connectedAt ?? undefined,
        counterpartId,
        createdAt: session.createdAt,
        endReason: session.endReason ?? undefined,
        endedAt: session.endedAt ?? undefined,
        id: session.id,
        invitationExpiresAt: session.invitationExpiresAt,
        medium: session.medium,
        role: session.initiatorId === actorId ? 'caller' : 'recipient',
        state: session.state,
      },
    };
  }
}

function counterpartOf(
  found: RtcSessionWithParticipants,
  actorId: string,
): string {
  const other = found.participants.find((row) => row.userId !== actorId);
  if (other === undefined) {
    throw new Error('A call is missing its second participant');
  }
  return other.userId;
}
