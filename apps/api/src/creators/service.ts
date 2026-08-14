import type { CreatorAdultGateReasonValue } from '@velora/validation';

import type { Executor } from '../database/executor.js';
import { assuranceAtLeast } from '../users/onboarding-policy.js';
import type { CreatorAdultEligibilityPort } from './eligibility.js';
import {
  creatorAudience,
  creatorRequiredAssurance,
  requiredCreatorPolicyDocuments,
  type CreatorPolicyDocumentRequirement,
} from './policy.js';
import type { CreatorAccountRow, CreatorsRepository } from './repository.js';

/**
 * The adult gate, decided by CREATORS from the facts USERS publishes.
 *
 * Two states rather than a boolean plus a message: a caller needs to know what
 * to do next, and `docs/compliance/03-creator-content-gates.md` requires the
 * reason to stay coarse enough that nothing about another domain's internals
 * travels with it.
 */
export type CreatorAdultGate =
  | { readonly satisfied: true; readonly userId: string }
  | {
      readonly satisfied: false;
      readonly reason: CreatorAdultGateReasonValue;
    };

export type CreatorOnboardingStep =
  'adult_eligibility' | 'policy_acknowledgement' | 'completed';

export interface CreatorAdmission {
  readonly adultGate: CreatorAdultGate;
  readonly outstandingPolicies: readonly CreatorPolicyDocumentRequirement[];
  readonly step: CreatorOnboardingStep;
}

/** A capability and the admission state derived for it together. */
export interface CreatorAdmissionState {
  readonly account: CreatorAccountRow;
  readonly admission: CreatorAdmission;
}

export type CreatorProvisionOutcome =
  | {
      readonly kind: 'provisioned';
      readonly account: CreatorAccountRow;
      readonly created: boolean;
    }
  | {
      readonly kind: 'not_eligible';
      readonly reason: CreatorAdultGateReasonValue;
    };

export type CreatorAcknowledgementOutcome =
  | { readonly kind: 'advanced'; readonly state: CreatorAdmissionState }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'out_of_order' };

export interface CreatorsServiceDependencies {
  readonly eligibility: CreatorAdultEligibilityPort;
  readonly now: () => Date;
  readonly repository: CreatorsRepository;
}

/**
 * Creator capability, its admission ladder, and its lifecycle.
 *
 * The admission step is derived from stored evidence on every read rather than
 * cached in a column, for the same reason USERS derives its own: a stored step
 * would be a second source of truth about facts that already exist — an
 * acknowledgement row, an assurance USERS holds, a capability status — and it
 * would be the one that drifts.
 *
 * Nothing here consults the request. A client cannot assert that it is an
 * adult, that it acknowledged something, or that it is active; every input is
 * read from the database or from USERS' published contract.
 */
export class CreatorsService {
  constructor(private readonly dependencies: CreatorsServiceDependencies) {}

  findByAuthAccountId(
    authAccountId: string,
  ): Promise<CreatorAccountRow | undefined> {
    return this.dependencies.repository.findByAuthAccountId(
      this.dependencies.repository.transactionless,
      authAccountId,
    );
  }

  /** The adult gate for a principal, as CREATORS decides it. */
  async adultGate(
    authAccountId: string,
    executor?: Executor,
  ): Promise<CreatorAdultGate> {
    const standing = await this.dependencies.eligibility.standingForAuthAccount(
      {
        authAccountId,
        executor: executor ?? this.dependencies.repository.transactionless,
        now: this.dependencies.now(),
      },
    );
    if (standing === undefined) {
      return { reason: 'no_consumer_account', satisfied: false };
    }
    // Standing first. An account that is restricted must not be told that its
    // adult declaration is what is missing, because that would be a way to
    // learn an enforcement decision by fixing the wrong thing and watching the
    // answer stay the same.
    if (!standing.inGoodStanding) {
      return { reason: 'not_in_good_standing', satisfied: false };
    }
    if (!assuranceAtLeast(standing.adultAssurance, creatorRequiredAssurance)) {
      return { reason: 'adult_declaration_missing', satisfied: false };
    }
    return { satisfied: true, userId: standing.userId };
  }

  /**
   * Establishes creator capability for an authenticated principal.
   *
   * Explicit by construction: nothing calls this except a request that asked
   * for it, so no consumer becomes a creator by using the product. The adult
   * gate is checked before the insert rather than after, so a principal who may
   * not hold the capability never has a row created and then reversed.
   *
   * Idempotent under concurrency without a lock. Every racing caller that gets
   * past the gate attempts the insert; the unique index on `auth_account_id`
   * admits exactly one, and the losers re-read the winner's row and return it.
   * The gate check is outside the insert on purpose — it calls another domain's
   * contract, and `docs/engineering/03-jobs-idempotency-concurrency.md` forbids
   * holding a transaction open across work that is not this domain's.
   */
  async provisionCapability(
    authAccountId: string,
  ): Promise<CreatorProvisionOutcome> {
    const { repository } = this.dependencies;
    const existing = await repository.findByAuthAccountId(
      repository.transactionless,
      authAccountId,
    );
    if (existing !== undefined) {
      // An existing capability is returned whatever its state. A suspended or
      // closed creator asking again learns nothing new and is not resurrected
      // by a repeated call.
      return { account: existing, created: false, kind: 'provisioned' };
    }

    const gate = await this.adultGate(authAccountId);
    if (!gate.satisfied) {
      return { kind: 'not_eligible', reason: gate.reason };
    }

    const now = this.dependencies.now();
    const inserted = await repository.insertIfAbsent(
      repository.transactionless,
      {
        authAccountId,
        now,
        // Always an applicant, never active. Activation requires the policy
        // acknowledgements this row does not yet have, and a capability that
        // arrived active would be one nobody agreed to anything for.
        status: 'applicant',
        statusReason: 'onboarding_incomplete',
      },
    );
    if (inserted !== undefined) {
      return { account: inserted, created: true, kind: 'provisioned' };
    }

    // Lost the insert race. The winner's row is the answer; a caller must never
    // receive an error for having been a microsecond late.
    const winner = await repository.findByAuthAccountId(
      repository.transactionless,
      authAccountId,
    );
    if (winner === undefined) {
      throw new Error('Creator capability insert conflicted with no winner');
    }
    return { account: winner, created: false, kind: 'provisioned' };
  }

  /** Current admission state for a capability, entirely from stored evidence. */
  async evaluate(account: CreatorAccountRow): Promise<CreatorAdmission> {
    const { repository } = this.dependencies;
    const gate = await this.adultGate(account.authAccountId);
    const held = await repository.findPolicyAcknowledgements(
      repository.transactionless,
      {
        creatorId: account.id,
        keys: requiredCreatorPolicyDocuments.map((document) => document.key),
      },
    );
    const acknowledged = new Set(
      held.map((row) => `${row.policyKey}@${row.policyVersion}`),
    );
    const outstandingPolicies = requiredCreatorPolicyDocuments.filter(
      (document) => !acknowledged.has(`${document.key}@${document.version}`),
    );
    return {
      adultGate: gate,
      outstandingPolicies,
      step: !gate.satisfied
        ? 'adult_eligibility'
        : outstandingPolicies.length > 0
          ? 'policy_acknowledgement'
          : 'completed',
    };
  }

  /**
   * Aligns capability status with the admission ladder, in both directions.
   *
   * The downward transition matters more than the upward one. An adult
   * assurance that expires, a consumer account that becomes restricted, or a
   * newly required policy version all mean a creator no longer meets the bar,
   * and without this they would stay `active` — and therefore able to operate —
   * on evidence they no longer have.
   *
   * Suspended and closed capabilities are left exactly where they are. They
   * were set by decisions this method does not own, and a passing gate is not a
   * reason to lift an enforcement.
   *
   * A transition that does not match is not an error. Another caller moved the
   * row first — two Studio tabs, or a suspension landing mid-request — and the
   * answer is that caller's row rather than the stale one this call started
   * from, so the response never reports a state the database has already left.
   */
  async reconcileActivation(
    account: CreatorAccountRow,
  ): Promise<CreatorAdmissionState> {
    const admission = await this.evaluate(account);
    const { repository } = this.dependencies;
    const now = this.dependencies.now();

    const transition =
      admission.step === 'completed' && account.status === 'applicant'
        ? ({
            activatedAt: account.activatedAt ?? now,
            expectedStatus: 'applicant',
            status: 'active',
            statusReason: null,
          } as const)
        : admission.step !== 'completed' && account.status === 'active'
          ? ({
              expectedStatus: 'active',
              status: 'applicant',
              statusReason: admission.adultGate.satisfied
                ? 'onboarding_incomplete'
                : 'eligibility_failed',
            } as const)
          : undefined;
    if (transition === undefined) return { account, admission };

    const moved = await repository.transitionStatus(
      repository.transactionless,
      { ...transition, creatorId: account.id, now },
    );
    if (moved !== undefined) return { account: moved, admission };
    const current = await repository.findById(
      repository.transactionless,
      account.id,
    );
    return { account: current ?? account, admission };
  }

  /**
   * Records acknowledgement of the current required creator policy versions.
   *
   * The gate check is what makes the ladder deterministic: creator policies
   * cannot be acknowledged by a principal who has not passed the adult gate,
   * whatever order a client chooses to call the endpoints in. A suspended or
   * closed capability is refused outright — acknowledging a document is not a
   * route back from an enforcement decision.
   */
  async acknowledgePolicies(input: {
    readonly account: CreatorAccountRow;
    readonly documents: readonly CreatorPolicyDocumentRequirement[];
  }): Promise<CreatorAcknowledgementOutcome> {
    if (
      input.account.status !== 'applicant' &&
      input.account.status !== 'active'
    ) {
      return { kind: 'not_eligible' };
    }
    const before = await this.evaluate(input.account);
    if (!before.adultGate.satisfied) return { kind: 'not_eligible' };

    // Only the versions currently required are accepted. An acknowledgement of
    // a version the platform no longer asks for is not evidence of agreeing to
    // the one it does.
    const accepted = input.documents.filter((document) =>
      requiredCreatorPolicyDocuments.some(
        (required) =>
          required.key === document.key &&
          required.version === document.version,
      ),
    );
    if (accepted.length !== input.documents.length) {
      return { kind: 'out_of_order' };
    }

    const { repository } = this.dependencies;
    await repository.recordPolicyAcknowledgements(repository.transactionless, {
      acknowledgedAt: this.dependencies.now(),
      audience: creatorAudience,
      creatorId: input.account.id,
      documents: accepted,
    });
    return {
      kind: 'advanced',
      state: await this.reconcileActivation(input.account),
    };
  }
}
