import type { DatabaseHandle, Executor } from '../database/executor.js';
import { RtcRepository } from './repository.js';
import {
  UnavailableRtcSignalPublisher,
  type RtcSignalPublisherPort,
} from './signalling.js';

/**
 * The call-state change REALTIME publishes for enforcement.
 *
 * A call's state is REALTIME's truth. TRUST & SAFETY decides that two people
 * may no longer talk, or that one account may not; it does not decide what
 * ending a call means, and it does not write to `realtime_`. This contract is
 * the whole of what a safety decision may do to a call: end it.
 *
 * It cannot start one, cannot answer one, cannot read who is in one, cannot
 * extend a credential, and cannot reopen anything — none of those is a decision
 * the enforcement scope covers, and a contract that allowed them would be a
 * second way into calling that nobody reviewed.
 *
 * **Ending advances the authorization generation**, which is what makes this
 * more than a state change. Every credential outstanding for the call dies at
 * the platform boundary immediately, so a participant holding one minted
 * seconds earlier cannot use it — before, and independently of, whatever the
 * provider still believes.
 *
 * Both methods take the caller's executor and are expected to be called under
 * the pair lock the caller already holds. That is the point: the block and the
 * ending of the call it invalidates commit together, so there is no instant in
 * which the block exists and the call it should have stopped is still running.
 */
export interface RtcCallEnforcementPort {
  /**
   * Ends the live call between two people, if there is one.
   *
   * Returns whether a call was ended, so a caller can tell "there was nothing
   * to end" from "something was ended". Neither is an error: most blocks are
   * not placed mid-call.
   */
  endLiveCallForPair(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;

  /**
   * Ends every live call one account is in.
   *
   * For a restriction, which is about a person rather than about a pair. The
   * count is returned rather than a boolean, because an account restricted
   * mid-abuse may be in more than one — the pair rule bounds calls per pair,
   * not per person.
   */
  endLiveCallsForSubject(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<number>;
}

/**
 * How many of one person's live calls a single enforcement will end.
 *
 * A person can hold at most one live call per pair, so reaching this bound
 * means an account is in a great many simultaneous calls — which is itself
 * abnormal. The bound exists so one enforcement cannot become an unbounded
 * write inside somebody else's transaction; anything left is ended by the next
 * decision or found by reconciliation, and the restriction itself has already
 * taken effect regardless.
 */
const maximumCallsEndedPerEnforcement = 25;

/**
 * Constructed from a database handle rather than from REALTIME's runtime, on
 * the same shape as MESSAGING's `ConversationEnforcement` — and for a reason
 * beyond symmetry.
 *
 * TRUST & SAFETY is composed before REALTIME, because REALTIME consumes
 * SAFETY's eligibility answer. Handing SAFETY a whole realtime runtime would
 * therefore be a cycle needing a late setter. There is no cycle to break: this
 * contract ends calls and authorizes nothing, so it depends on the call rows
 * and on nothing SAFETY owns.
 */
export class RtcCallEnforcement implements RtcCallEnforcementPort {
  private readonly repository: RtcRepository;

  /**
   * Best-effort fanout, so a device showing a call it is no longer in finds out
   * without waiting to ask. It defaults to carrying nothing, which is what a
   * composition with no realtime gateway has; the hint is never the reason a
   * call ended, because the row is committed either way.
   */
  private readonly signals: RtcSignalPublisherPort;

  constructor(
    private readonly database: DatabaseHandle,
    options?: { readonly signals?: RtcSignalPublisherPort },
  ) {
    this.repository = new RtcRepository(database);
    this.signals = options?.signals ?? new UnavailableRtcSignalPublisher();
  }

  /** Present so the class owns a handle of its own, as the other contracts do. */
  get transactionless(): DatabaseHandle {
    return this.database;
  }

  async endLiveCallForPair(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean> {
    // Locked, not merely read. The pair lock the caller holds keeps other
    // *pair* decisions out, but a call moves on its own too — binding a
    // provider, observing media, a stall sweep closing it — and none of those
    // take the pair lock. Without the row lock, one of them landing here would
    // leave the guarded terminate below matching nothing, and a block committed
    // over a call that kept running.
    const live = await this.repository.lockLiveForPair(input.executor, {
      first: input.first,
      second: input.second,
    });
    if (live === undefined) return false;
    return (
      (await this.end(input.executor, live.id, live.state, {
        now: input.now,
        reason: 'safety_block',
      })) !== undefined
    );
  }

  async endLiveCallsForSubject(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<number> {
    const live = await this.repository.lockLiveForUser(input.executor, {
      limit: maximumCallsEndedPerEnforcement,
      userId: input.userId,
    });
    let ended = 0;
    for (const session of live) {
      const settled = await this.end(
        input.executor,
        session.id,
        session.state,
        {
          now: input.now,
          reason: 'safety_enforcement',
        },
      );
      if (settled !== undefined) ended += 1;
    }
    return ended;
  }

  /**
   * Ends one call, whatever state it is in.
   *
   * The expected state is restated from the row that was just read, so this is
   * a guarded transition like every other ending: if the participants hung up
   * in the meantime, the call is already terminal and this changes nothing —
   * which is the correct outcome, not a failure.
   *
   * A ringing call ends here rather than being recorded as declined or
   * withdrawn. `invited -> ended` exists in the transition table for exactly
   * this path: routing a safety decision through `rejected` or `cancelled`
   * would record one of the two people as having decided, when neither did.
   */
  private async end(
    executor: Executor,
    id: string,
    expected: Parameters<RtcRepository['terminateSession']>[1]['expected'],
    input: {
      readonly now: Date;
      readonly reason: 'safety_block' | 'safety_enforcement';
    },
  ) {
    const settled = await this.repository.terminateSession(executor, {
      expected,
      id,
      now: input.now,
      reason: input.reason,
      terminal: 'ended',
    });
    if (settled !== undefined) {
      // Published after the row is written but while the transaction is still
      // open, and never awaited for correctness. The publisher swallows its own
      // failures; a hint that cannot be delivered must not roll back a safety
      // decision.
      void this.signals.publish({
        callId: settled.id,
        generation: settled.authorizationGeneration,
        recipientIds: [settled.pairLowId, settled.pairHighId],
        state: settled.state,
      });
    }
    return settled;
  }
}
