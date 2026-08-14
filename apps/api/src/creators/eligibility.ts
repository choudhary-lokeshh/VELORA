import type { Executor } from '../database/executor.js';
import type { AdultAssuranceLevel } from '../users/onboarding-policy.js';

/**
 * The adult answer CREATORS needs and does not own.
 *
 * Whether somebody is an adult in good standing is a USERS decision resting on
 * assurance evidence and account lifecycle, neither of which CREATORS may read.
 * This declares the shape CREATORS needs — the dependency points from the
 * consumer to the contract — and USERS' published standing directory satisfies
 * it.
 *
 * The answer is facts, not a verdict. `docs/compliance/03-creator-content-gates.md`
 * requires each predicate to be decided independently, so the rule that turns
 * an assurance level into "may hold creator capability" stays here, in the
 * domain that owns creator eligibility.
 */
export interface CreatorAdultEligibilityPort {
  standingForAuthAccount(input: {
    readonly authAccountId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<
    | {
        readonly adultAssurance: AdultAssuranceLevel;
        readonly inGoodStanding: boolean;
        readonly userId: string;
      }
    | undefined
  >;
}
