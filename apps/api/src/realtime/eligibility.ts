import type { Executor } from '../database/executor.js';

/**
 * The answer REALTIME needs and does not own.
 *
 * "May these two people have a call right now" composes facts from four
 * domains — AUTH's principal, USERS' account standing, DISCOVERY's mutual
 * introduction, and TRUST & SAFETY's blocks and enforcement — and REALTIME owns
 * none of them. It declares the port it needs here, so the dependency points
 * from the consumer to the contract, and the domains that own those facts
 * supply an implementation without this one being redesigned around them.
 *
 * RTC introduces no new social relationship. Inventing one would create a
 * second, weaker answer to a question DISCOVERY and TRUST & SAFETY already
 * decide, and the weaker answer would eventually be the one somebody called.
 *
 * It is asked at the moment of the action and never cached: on invitation, on
 * acceptance, on every join-authorization issuance, and on every reconnect. A
 * result is never stored on a session, because a stored answer is a decision
 * taken at some earlier time being applied at this one.
 */
export interface RtcCallEligibilityPort {
  /**
   * The executor is supplied by the caller so the answer can be taken inside
   * the transaction that is about to write. A recheck that commits separately
   * from the write it authorizes is not a recheck, and callers take the pair
   * lock first — see `src/database/pair-lock.ts` for why that is what removes
   * the check-then-act gap.
   */
  mayCall(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;
}

/**
 * Refuses every pair.
 *
 * The behaviour a deployed environment has, and the default everywhere. Calling
 * is blocked on decisions nobody has made rather than on a missing
 * implementation — no RTC provider is approved, no regional availability is
 * decided, no retention schedule exists, and nobody is on call for it — so the
 * runtime refuses rather than merely documenting the block. It fails closed.
 *
 * See `productionBlockers` in `./policy.ts` for the list, and
 * `docs/compliance/10-rtc-provider-eligibility.md` for why no provider is
 * approved.
 */
export class UnavailableRtcCallEligibility implements RtcCallEligibilityPort {
  mayCall(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
