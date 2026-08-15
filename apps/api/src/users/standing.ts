import type { Executor } from '../database/executor.js';
import { adultAssuranceLevelOf } from './onboarding.js';
import type { AdultAssuranceLevel } from './onboarding-policy.js';
import type { UsersRepository } from './repository.js';

/**
 * Whether an account is currently in a state that may be contacted.
 *
 * USERS owns account lifecycle, so it owns this answer. NOTIFICATIONS needs it
 * immediately before an external send — an account restricted after a notice
 * was queued must not receive it — and must not learn anything else about the
 * account in order to get it. So the contract answers with a boolean: no
 * status, no reason, no timestamps. A caller that could read the status could
 * infer an enforcement decision from a delivery path, which is not a place
 * enforcement should ever be visible.
 *
 * The executor is the caller's, so the answer can be taken inside the
 * transaction that claims the notice for delivery. A standing check that
 * commits separately from the claim it authorizes is not a check.
 */
export interface ConsumerStandingPort {
  isDeliverable(input: {
    readonly executor: Executor;
    readonly userId: string;
  }): Promise<boolean>;
}

export class ConsumerStanding implements ConsumerStandingPort {
  constructor(private readonly repository: UsersRepository) {}

  async isDeliverable(input: {
    readonly executor: Executor;
    readonly userId: string;
  }): Promise<boolean> {
    const account = await this.repository.findById(
      input.executor,
      input.userId,
    );
    // An account that does not exist, is restricted, or is in any other
    // non-active state is not contacted. Fail closed: an unknown identifier is
    // not a reason to send somebody a push.
    return account?.status === 'active';
  }
}

/**
 * The adult standing USERS holds for an AUTH principal.
 *
 * Facts only. Whether they are enough is the asking domain's policy, because
 * different capabilities require different assurance:
 * `docs/compliance/03-creator-content-gates.md` is explicit that passing one
 * predicate never implies another, and USERS deciding "may operate as a
 * creator" would be USERS owning a rule CREATORS owns.
 */
export interface ConsumerAdultStanding {
  /** What the account currently holds. Never what it once held. */
  readonly adultAssurance: AdultAssuranceLevel;
  /**
   * False when the account is restricted, deleting, deactivated, or erased.
   * Deliberately coarse: which of those, and why, stays with USERS and TRUST &
   * SAFETY. `pending_profile` is good standing — a person who has not finished
   * a discoverable consumer profile has done nothing wrong.
   */
  readonly inGoodStanding: boolean;
  /**
   * Where this person told Velora they are, or nothing when they have not.
   *
   * The account's own region rather than an inferred one: no geolocation, no
   * address, no card country. It crosses this boundary because commerce
   * eligibility is a question about countries and USERS owns the only answer
   * Velora holds — and it is optional because an absent region is a real state
   * that has to refuse rather than default.
   */
  readonly region: string | undefined;
  /** The consumer account identifier, for a caller that needs to reference it. */
  readonly userId: string;
}

/**
 * The adult-eligibility answer USERS publishes to CREATORS.
 *
 * `docs/domains/creators.md` requires creator activation to consult the
 * platform's adult authority rather than deciding age itself, and
 * `docs/architecture/03-domain-boundaries.md` forbids CREATORS from reading
 * `users_` tables to do it. This is the whole of what crosses that boundary.
 */
export interface ConsumerAdultStandingPort {
  /**
   * Standing for an AUTH principal, or nothing when that principal has no
   * consumer account at all. The key is the AUTH account identifier because a
   * caller establishing creator capability holds a credential, not a consumer
   * account identifier it could have obtained some other way.
   */
  standingForAuthAccount(input: {
    readonly authAccountId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<ConsumerAdultStanding | undefined>;

  /**
   * The same standing, keyed by the consumer account identifier.
   *
   * A domain that already holds a consumer identifier — because that person
   * acted on one of its surfaces — needs the same facts without being handed a
   * way to look up an AUTH principal.
   */
  standingForUser(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<ConsumerAdultStanding | undefined>;
}

/** Account states in which a person may still operate a capability. */
const operableStatuses = new Set(['pending_profile', 'active']);

export class ConsumerAdultStandingDirectory implements ConsumerAdultStandingPort {
  constructor(private readonly repository: UsersRepository) {}

  async standingForUser(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<ConsumerAdultStanding | undefined> {
    return this.standingOf(
      await this.repository.findById(input.executor, input.userId),
      input.executor,
      input.now,
    );
  }

  async standingForAuthAccount(input: {
    readonly authAccountId: string;
    readonly executor: Executor;
    readonly now: Date;
  }): Promise<ConsumerAdultStanding | undefined> {
    return this.standingOf(
      await this.repository.findByAuthAccountId(
        input.executor,
        input.authAccountId,
      ),
      input.executor,
      input.now,
    );
  }

  private async standingOf(
    account: Awaited<ReturnType<UsersRepository['findById']>>,
    executor: Executor,
    now: Date,
  ): Promise<ConsumerAdultStanding | undefined> {
    if (account === undefined) return undefined;
    // Read from the assurance evidence rather than inferred from account
    // status, which can be stale relative to an assurance that expired without
    // any write happening.
    const latest = await this.repository.findLatestAdultAssurance(
      executor,
      account.id,
    );
    return {
      adultAssurance: adultAssuranceLevelOf(latest, now),
      inGoodStanding: operableStatuses.has(account.status),
      region: account.region ?? undefined,
      userId: account.id,
    };
  }
}
