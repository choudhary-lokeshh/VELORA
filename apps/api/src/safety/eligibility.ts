import type { Executor } from '../database/executor.js';
import {
  blockingScopesFor,
  denialReasonFor,
  eligibilityPolicyVersion,
  enforcementPrecedence,
  type EnforcementObjectType,
  type EnforcementScope,
  type SafetyCapability,
  type SafetyDenialReason,
} from './policy.js';
import type { SafetyRepository } from './repository.js';

/**
 * One safety answer, composed rather than looked up.
 *
 * A caller asks whether a subject may do something and receives a decision it
 * can act on and record: allowed or not, the coarse reason if not, the scope
 * that produced it, and the version of the rule that composed it. It never
 * receives the enforcement's finding, the report behind it, the reviewer, or
 * anything that could identify a reporter — those stay inside TRUST & SAFETY,
 * which is what makes this shape safe to hand to another domain and, through
 * it, to a subject.
 */
export interface SafetyDecision {
  readonly allowed: boolean;
  readonly policyVersion: string;
  /** Disclosable and coarse. Absent when allowed. */
  readonly reasonCode: SafetyDenialReason | undefined;
  /** Which restriction decided it. Absent when allowed. */
  readonly scope: EnforcementScope | undefined;
}

/**
 * The safety eligibility contract TRUST & SAFETY publishes.
 *
 * `docs/architecture/03-domain-boundaries.md` forbids another domain reading
 * `safety_` tables, and [ADR-0022](../../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * makes this the one authority that decides. CREATORS, PRIVATE CLUBS, BILLING,
 * and ADMIN ask it; none of them re-derives the answer, and none learns how it
 * was reached.
 *
 * Every method takes the caller's executor, on the same rule
 * `SafetyDirectoryPort` already follows: a safety check that commits separately
 * from the write it authorizes is not a check. A caller authorizing a mutation
 * takes the subject lock first — see `src/database/subject-lock.ts` for why
 * that is what removes the check-then-act gap — and then asks inside the same
 * transaction that performs the write.
 */
export interface SafetyEligibilityPort {
  /** Whether a live safety enforcement denies this capability to this subject. */
  decide(input: {
    readonly capability: SafetyCapability;
    readonly executor: Executor;
    readonly now: Date;
    readonly subjectId: string;
  }): Promise<SafetyDecision>;

  /** Whether one named object is currently held out of view by safety. */
  isObjectRestricted(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly objectId: string;
    readonly objectType: EnforcementObjectType;
    readonly subjectId: string;
  }): Promise<boolean>;
}

const allowed: SafetyDecision = {
  allowed: true,
  policyVersion: eligibilityPolicyVersion,
  reasonCode: undefined,
  scope: undefined,
};

export class SafetyEligibility implements SafetyEligibilityPort {
  constructor(private readonly repository: SafetyRepository) {}

  async decide(input: {
    readonly capability: SafetyCapability;
    readonly executor: Executor;
    readonly now: Date;
    readonly subjectId: string;
  }): Promise<SafetyDecision> {
    const scopes = blockingScopesFor(input.capability);
    const live = await this.repository.listLiveEnforcements(input.executor, {
      now: input.now,
      scopes,
      subjectId: input.subjectId,
    });
    if (live.length === 0) return allowed;

    // The strongest live restriction decides, not whichever row the planner
    // returned first. Two replicas asking the same question at the same moment
    // must give the subject the same reason, and an ordering that depended on
    // insertion order would not.
    const held = new Set(live.map((row) => row.scope));
    const strongest = enforcementPrecedence.find((scope) => held.has(scope));
    if (strongest === undefined) return allowed;
    return {
      allowed: false,
      policyVersion: eligibilityPolicyVersion,
      reasonCode: denialReasonFor(strongest),
      scope: strongest,
    };
  }

  async isObjectRestricted(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly objectId: string;
    readonly objectType: EnforcementObjectType;
    readonly subjectId: string;
  }): Promise<boolean> {
    const found = await this.repository.findLiveObjectEnforcement(
      input.executor,
      {
        now: input.now,
        objectId: input.objectId,
        objectType: input.objectType,
        subjectId: input.subjectId,
      },
    );
    return found !== undefined;
  }
}
