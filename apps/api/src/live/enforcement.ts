import type { DatabaseHandle, Executor } from '../database/executor.js';
import { LiveRepository } from './repository.js';

/**
 * The encounter-state change LIVE publishes for enforcement.
 *
 * An encounter's state is LIVE's truth. TRUST & SAFETY decides that two people
 * may no longer interact, or that one account may not; it does not decide what
 * ending an encounter means, and it does not write to `live_`. This contract is
 * the whole of what a safety decision may do to a live encounter: end it.
 *
 * It cannot allocate one, cannot read who is in one, cannot rematch anybody,
 * and cannot reopen anything. It is the exact shape REALTIME's call-enforcement
 * contract has, for the exact reason: a block landing while two strangers are
 * on camera together has to stop *that*, not merely refuse the next thing they
 * try to do.
 *
 * Ending the encounter is only half of it, and the half this contract owns. The
 * live RTC session carrying the encounter is ended by REALTIME's own
 * enforcement contract in the same transaction, because the session is
 * REALTIME's row — so a block ends both, together, under one pair lock, and
 * neither domain writes the other's table.
 *
 * Both methods take the caller's executor and are expected to be called under
 * the pair lock the caller already holds. That is the point: the block and the
 * ending of the encounter it invalidates commit together, so there is no
 * instant in which the block exists and the encounter it should have stopped is
 * still running.
 */
export interface LiveEncounterEnforcementPort {
  /**
   * Ends the live encounter between two people, if there is one.
   *
   * Returns whether one was ended, so a caller can tell "there was nothing to
   * end" from "something was ended". Neither is an error: most blocks are not
   * placed mid-encounter.
   */
  endLiveEncounterForPair(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;

  /**
   * Ends every live encounter one account is in, and takes it out of the pool.
   *
   * For a restriction, which is about a person rather than about a pair. It
   * also leaves the pool, which the pair method deliberately does not:
   * a restricted account must not be handed to the next person waiting, and a
   * block between two people says nothing about either of them meeting anybody
   * else.
   */
  endLiveEncountersForSubject(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<number>;
}

/**
 * How many of one person's live encounters a single enforcement will end.
 *
 * A person can hold at most one, guaranteed by the partial unique index over
 * their participation, so this bound is never reached in a healthy system. It
 * exists so one enforcement cannot become an unbounded write inside somebody
 * else's transaction if that guarantee is ever weakened.
 */
const maximumEncountersEndedPerEnforcement = 5;

/**
 * Constructed from a database handle rather than from LIVE's runtime, on the
 * same shape as REALTIME's `RtcCallEnforcement` and MESSAGING's
 * `ConversationEnforcement`, and for the same reason: TRUST & SAFETY is
 * composed before LIVE, because LIVE consumes SAFETY's eligibility answer.
 * Handing SAFETY a whole live runtime would be a cycle needing a late setter,
 * and there is no cycle to break — this contract ends encounters and authorizes
 * nothing.
 */
export class LiveEncounterEnforcement implements LiveEncounterEnforcementPort {
  private readonly repository: LiveRepository;

  constructor(private readonly database: DatabaseHandle) {
    this.repository = new LiveRepository(database);
  }

  /** Present so the class owns a handle of its own, as the other contracts do. */
  get transactionless(): DatabaseHandle {
    return this.database;
  }

  async endLiveEncounterForPair(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean> {
    // Locked, not merely read. The pair lock the caller holds keeps other pair
    // decisions out, but an encounter also ends on its own — either person
    // pressing Next, a presence sweep closing it — and neither of those takes
    // the pair lock. Without the row lock, one of them landing here would leave
    // the guarded end below matching nothing and a block committed over an
    // encounter that kept running.
    const live = await this.repository.lockLiveEncounterForPair(
      asTransaction(input.executor),
      { first: input.first, second: input.second },
    );
    if (live === undefined) return false;
    const ended = await this.repository.endEncounter(input.executor, {
      id: live.id,
      now: input.now,
      reason: 'safety_block',
    });
    if (ended === undefined) return false;
    await this.releaseParticipations(input.executor, ended.id, input.now);
    return true;
  }

  async endLiveEncountersForSubject(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<number> {
    const live = await this.repository.lockLiveEncountersForUser(
      asTransaction(input.executor),
      { limit: maximumEncountersEndedPerEnforcement, userId: input.userId },
    );
    let ended = 0;
    for (const encounter of live) {
      const settled = await this.repository.endEncounter(input.executor, {
        id: encounter.id,
        now: input.now,
        reason: 'safety_enforcement',
      });
      if (settled === undefined) continue;
      await this.releaseParticipations(input.executor, settled.id, input.now);
      ended += 1;
    }
    // A restricted account leaves the pool as well, so the next person waiting
    // is never handed somebody the platform has just restricted.
    await this.repository.leavePool(input.executor, {
      now: input.now,
      userId: input.userId,
    });
    return ended;
  }

  /**
   * Takes both people off the encounter once it is gone.
   *
   * They are moved to `ended` rather than straight back to searching, which is
   * the same thing a Next does to the person who was left — and for the same
   * reason: a surface that silently replaced the person somebody was talking to
   * with a spinner would leave them to work out what happened. What each of them
   * is then told is the disclosable end reason, which for a safety decision says
   * only that the platform ended it.
   *
   * Neither is ejected from the pool. They were both looking to meet somebody,
   * that has not changed, and taking the blocked person out of it would be a
   * visible consequence of another person's private safety decision.
   */
  private async releaseParticipations(
    executor: Executor,
    encounterId: string,
    now: Date,
  ): Promise<void> {
    const encounter = await this.repository.findEncounter(
      executor,
      encounterId,
    );
    if (encounter === undefined) return;
    for (const userId of [encounter.pairLowId, encounter.pairHighId]) {
      const participation = await this.repository.findLiveParticipation(
        executor,
        { userId },
      );
      if (participation?.encounterId !== encounterId) continue;
      await this.repository.markEncounterEnded(executor, {
        id: participation.id,
        now,
      });
    }
  }
}

/**
 * The executor a locking read needs.
 *
 * Every caller of this contract is already inside a transaction — that is the
 * contract's own precondition and the reason it takes an executor at all — but
 * the shared `Executor` type admits a bare handle, and `for update` outside a
 * transaction is a statement-scoped lock that releases immediately. Narrowing
 * here keeps the requirement in one place rather than in each call site.
 */
function asTransaction(
  executor: Executor,
): Parameters<LiveRepository['lockLiveEncounterForPair']>[0] {
  return executor as Parameters<LiveRepository['lockLiveEncounterForPair']>[0];
}
