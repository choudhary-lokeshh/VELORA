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

/**
 * The four facts a call is composed from, each declared as the narrowest
 * question REALTIME needs answered.
 *
 * They are declared here rather than imported from the domains that implement
 * them, on the rule `docs/architecture/03-domain-boundaries.md` sets: a
 * consumer declares the contract it needs and the owner supplies it at the
 * composition root. That is also what keeps this domain from acquiring an
 * import of another domain's internals in order to borrow a type.
 *
 * Every one of them takes the caller's executor, because every one of them is
 * asked as part of deciding whether to durably accept a write.
 */
export interface RtcRelationshipPort {
  isMutuallyIntroduced(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly second: string;
  }): Promise<boolean>;
}

export interface RtcPairSafetyPort {
  mayInteract(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean>;
}

export interface RtcEnforcementPort {
  decide(input: {
    readonly capability: 'consumer_interaction';
    readonly executor: Executor;
    readonly now: Date;
    readonly subjectId: string;
  }): Promise<{ readonly allowed: boolean }>;
}

export interface RtcStandingPort {
  isDeliverable(input: {
    readonly executor: Executor;
    readonly userId: string;
  }): Promise<boolean>;
}

/**
 * The real answer: every owner asked, at the moment of the action.
 *
 * Order matters only for cost, not for correctness — every predicate has to
 * pass — so the cheapest and most decisive are asked first and the composition
 * stops at the first refusal. What matters for correctness is that all four are
 * asked on the caller's executor, inside the transaction that is about to
 * write, under the pair lock the caller already holds.
 *
 * Both people are checked, not just the one acting. A call has a person on the
 * other end of it, and an account that has been restricted is not made
 * contactable by somebody else being in good standing — which is the asymmetry
 * a check on the actor alone would miss.
 *
 * The answer is a boolean and nothing more. A caller learns that a call is not
 * permitted; it never learns which predicate refused, because "blocked" and
 * "restricted" and "no longer introduced" are three different disclosures about
 * another person and none of them is this caller's to receive.
 */
export class ComposedRtcCallEligibility implements RtcCallEligibilityPort {
  constructor(
    private readonly dependencies: {
      readonly enforcement: RtcEnforcementPort;
      readonly relationship: RtcRelationshipPort;
      readonly safety: RtcPairSafetyPort;
      readonly standing: RtcStandingPort;
    },
  ) {}

  async mayCall(input: {
    readonly executor: Executor;
    readonly first: string;
    readonly now: Date;
    readonly second: string;
  }): Promise<boolean> {
    // Nobody calls themselves, and no pair lock or relationship makes that
    // sensible. Refused before anything is read.
    if (input.first === input.second) return false;

    // A block is the most common refusal and the cheapest to establish.
    if (
      !(await this.dependencies.safety.mayInteract({
        executor: input.executor,
        first: input.first,
        now: input.now,
        second: input.second,
      }))
    ) {
      return false;
    }

    // Both accounts have to be in a standing that permits contact. Asked
    // through USERS' published answer rather than by reading a status column,
    // so a future standing that is active-but-uncontactable is decided once,
    // by its owner, rather than in every domain that contacts somebody.
    for (const userId of [input.first, input.second]) {
      if (
        !(await this.dependencies.standing.isDeliverable({
          executor: input.executor,
          userId,
        }))
      ) {
        return false;
      }
    }

    // A live enforcement denying consumer interaction denies a call, for either
    // party. TRUST & SAFETY composes that answer; this domain does not
    // re-derive which scopes deny which capability.
    for (const subjectId of [input.first, input.second]) {
      const decision = await this.dependencies.enforcement.decide({
        capability: 'consumer_interaction',
        executor: input.executor,
        now: input.now,
        subjectId,
      });
      if (!decision.allowed) return false;
    }

    // Last, because it is the fact most likely to still hold: the relationship
    // that authorized contact in the first place is still current. A mutual
    // introduction that has since closed is not a standing permission to call.
    return this.dependencies.relationship.isMutuallyIntroduced({
      executor: input.executor,
      first: input.first,
      second: input.second,
    });
  }
}
