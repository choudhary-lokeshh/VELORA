import type { Executor } from '../database/executor.js';

/**
 * The safety answer MESSAGING needs and does not own.
 *
 * "May these two people still interact" is a TRUST & SAFETY decision. MESSAGING
 * declares the port it needs here — the dependency points from the consumer to
 * the contract, not the other way round — so the domain that owns blocks and
 * enforcement can supply an implementation without messaging being redesigned
 * around it.
 *
 * It is asked at the moment of the action, never cached and never inferred from
 * a conversation the caller is already holding. The flow document is explicit
 * about the reason: an in-flight send has to be re-checked before durable
 * acceptance, so a block that lands mid-request wins.
 */
export interface SafetyEligibilityPort {
  /**
   * The executor is supplied by the caller so the answer can be taken inside
   * the transaction that is about to write. A recheck that commits separately
   * from the write it authorizes is not a recheck.
   */
  mayInteract(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;
}

/**
 * Denies every pair.
 *
 * The behaviour a deployed environment has while message retention duration and
 * post-block history visibility are undecided. TRUST & SAFETY now owns a real
 * block store, so this is no longer a stand-in for a missing capability: it is
 * the switch that keeps messaging off until the open legal decisions are made,
 * and it fails closed rather than open.
 */
export class UnavailableSafetyEligibility implements SafetyEligibilityPort {
  mayInteract(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
