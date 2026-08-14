import type { ProfileRequirement } from '@velora/validation';

import type { AdultAssuranceVerifier } from './adult-assurance.js';
import {
  adultEligibilityPolicyVersion,
  requiredPolicyDocuments,
  selfDeclarationMethod,
  type AdultAssuranceLevel,
  type OnboardingStep,
  type PolicyDocumentRequirement,
} from './onboarding-policy.js';
import {
  isProfileComplete,
  outstandingProfileRequirements,
  type ProfileCompletenessReader,
} from './profile-repository.js';
import type {
  UserAccountRow,
  UserAdultAssuranceRow,
  UsersRepository,
} from './repository.js';

export interface ConsumerEligibility {
  /** Assurance the account currently holds, never what it once held. */
  readonly adultAssurance: AdultAssuranceLevel;
  /**
   * True when the most recent assessment refused the account. It is separate
   * from a low assurance level: "not yet declared" and "declared not an adult"
   * must never collapse into one state.
   */
  readonly adultAssuranceRefused: boolean;
  readonly outstandingPolicies: readonly PolicyDocumentRequirement[];
  /** What the minimum discoverable profile still lacks. Owner-only detail. */
  readonly outstandingProfile: readonly ProfileRequirement[];
  readonly step: OnboardingStep;
}

/** An account and the admission state that was derived for it together. */
export interface AdmissionState {
  readonly account: UserAccountRow;
  readonly eligibility: ConsumerEligibility;
}

export type OnboardingOutcome =
  | { readonly kind: 'advanced'; readonly eligibility: ConsumerEligibility }
  | { readonly kind: 'out_of_order'; readonly expected: OnboardingStep }
  | { readonly kind: 'refused' }
  | { readonly kind: 'assurance_unavailable' };

export interface OnboardingServiceDependencies {
  readonly adultAssuranceVerifier: AdultAssuranceVerifier;
  readonly now: () => Date;
  readonly profiles: ProfileCompletenessReader;
  readonly repository: UsersRepository;
}

/**
 * Adult admission and eligibility.
 *
 * The onboarding step is derived from stored evidence on every read rather than
 * cached in a column. A stored step would be a second source of truth about
 * facts that already exist — an acknowledgement row, an assurance row, an
 * account status — and it would be the one that drifts. Deriving it also makes
 * the impossible states impossible rather than merely unreachable: there is no
 * way to be at `completed` with an outstanding policy, because nothing records
 * `completed` at all.
 */
export class OnboardingService {
  constructor(private readonly dependencies: OnboardingServiceDependencies) {}

  /**
   * Current admission state for an account.
   *
   * Nothing is passed in. Every input is read from stored evidence, so two
   * callers can never disagree about where an account stands, and no caller can
   * assert a step it has not earned.
   */
  async evaluate(account: UserAccountRow): Promise<ConsumerEligibility> {
    const { repository } = this.dependencies;
    const latest = await repository.findLatestAdultAssurance(
      repository.transactionless,
      account.id,
    );
    const acknowledgements = await repository.findPolicyAcknowledgements(
      repository.transactionless,
      {
        keys: requiredPolicyDocuments.map((document) => document.key),
        userId: account.id,
      },
    );
    const held = new Set(
      acknowledgements.map((row) => `${row.policyKey}@${row.policyVersion}`),
    );
    const outstandingPolicies = requiredPolicyDocuments.filter(
      (document) => !held.has(`${document.key}@${document.version}`),
    );

    const adultAssurance = assuranceLevelOf(latest, this.dependencies.now());
    const adultAssuranceRefused =
      latest?.outcome === 'failed' || latest?.outcome === 'revoked';
    const completeness =
      await this.dependencies.profiles.readCompleteness(account);
    const outstandingProfile = outstandingProfileRequirements(completeness);

    return {
      adultAssurance,
      adultAssuranceRefused,
      outstandingPolicies,
      outstandingProfile,
      step: stepFor({
        adultAssurance,
        outstandingPolicies,
        profileComplete: isProfileComplete(completeness),
      }),
    };
  }

  /**
   * Aligns account status with the admission ladder, in both directions.
   *
   * An account that has finished every step becomes `active`; an account that
   * stops meeting the minimum profile — the last image removed, say — returns to
   * `pending_profile`. The downward transition matters more than the upward one:
   * without it an account could stay `active`, and therefore discoverable, on a
   * profile it no longer has.
   *
   * Restricted and deletion states are left exactly where they are. They were
   * set by decisions this method does not own.
   */
  async reconcileActivation(account: UserAccountRow): Promise<AdmissionState> {
    const eligibility = await this.evaluate(account);
    const { repository } = this.dependencies;
    const transition =
      eligibility.step === 'completed' && account.status === 'pending_profile'
        ? ({
            expectedStatus: 'pending_profile',
            status: 'active',
            statusReason: null,
          } as const)
        : eligibility.step !== 'completed' && account.status === 'active'
          ? ({
              expectedStatus: 'active',
              status: 'pending_profile',
              statusReason: 'onboarding_incomplete',
            } as const)
          : undefined;
    if (transition === undefined) return { account, eligibility };
    const moved = await repository.transitionAccountStatus(
      repository.transactionless,
      {
        expectedStatus: transition.expectedStatus,
        now: this.dependencies.now(),
        status: transition.status,
        statusReason: transition.statusReason,
        userId: account.id,
      },
    );
    return { account: moved ?? account, eligibility };
  }

  /**
   * Records a self-declaration of adult status and the declared region.
   *
   * A negative declaration is recorded as a refusal, not ignored. An
   * adults-only platform that quietly discards "no" would be relying on the
   * client to enforce its central product rule.
   */
  async declareAdult(input: {
    readonly account: UserAccountRow;
    readonly declaresAdult: boolean;
    readonly region: string;
  }): Promise<OnboardingOutcome> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();

    await repository.transaction(async (executor) => {
      await repository.recordAdultAssurance(executor, {
        assuranceClass: 'self_declared',
        decidedAt: now,
        method: selfDeclarationMethod,
        outcome: input.declaresAdult ? 'passed' : 'failed',
        policyVersion: adultEligibilityPolicyVersion,
        region: input.region,
        userId: input.account.id,
      });
      await repository.updateRegion(executor, {
        now,
        region: input.region,
        userId: input.account.id,
      });
    });

    if (!input.declaresAdult) {
      await this.restrict(input.account, 'eligibility_failed');
      return { kind: 'refused' };
    }
    // A previously refused account that now declares adult status returns to
    // the ordinary pending path; the refusal itself stays on the record.
    await this.clearEligibilityRestriction(input.account);
    return {
      eligibility: await this.evaluate({
        ...input.account,
        region: input.region,
      }),
      kind: 'advanced',
    };
  }

  /**
   * Records acknowledgement of the current required policy versions.
   *
   * The step check is what makes the ladder deterministic: notices cannot be
   * acknowledged by an account that has not passed the adult gate, whatever
   * order a client chooses to call the endpoints in.
   */
  async acknowledgePolicies(input: {
    readonly account: UserAccountRow;
    readonly audience: 'consumer_web' | 'consumer_mobile';
    readonly documents: readonly PolicyDocumentRequirement[];
  }): Promise<OnboardingOutcome> {
    const before = await this.evaluate(input.account);
    if (before.step === 'adult_declaration') {
      return { expected: 'adult_declaration', kind: 'out_of_order' };
    }

    // Only the versions currently required are accepted. An acknowledgement of
    // a version the platform no longer asks for is not evidence of agreeing to
    // the one it does.
    const accepted = input.documents.filter((document) =>
      requiredPolicyDocuments.some(
        (required) =>
          required.key === document.key &&
          required.version === document.version,
      ),
    );
    if (accepted.length !== input.documents.length) {
      return { expected: 'policy_acknowledgement', kind: 'out_of_order' };
    }

    const { repository } = this.dependencies;
    await repository.recordPolicyAcknowledgements(repository.transactionless, {
      acknowledgedAt: this.dependencies.now(),
      audience: input.audience,
      documents: accepted,
      userId: input.account.id,
    });
    // Acknowledging a newly required version can be the last outstanding step
    // for an account whose profile is already complete, so status is reconciled
    // here rather than waiting for some later write to notice.
    const reconciled = await this.reconcileActivation(input.account);
    return { eligibility: reconciled.eligibility, kind: 'advanced' };
  }

  /**
   * Requests stronger assurance through the configured provider adapter.
   *
   * No provider is approved, so the configured verifier refuses in every
   * environment and this reports that honestly instead of recording a pass.
   */
  async requestVerifiedAssurance(input: {
    readonly account: UserAccountRow;
    readonly correlationId: string;
  }): Promise<OnboardingOutcome> {
    const region = input.account.region;
    if (region === null) {
      return { expected: 'adult_declaration', kind: 'out_of_order' };
    }

    let result;
    try {
      result = await this.dependencies.adultAssuranceVerifier.verify({
        correlationId: input.correlationId,
        region,
        userId: input.account.id,
      });
    } catch {
      return { kind: 'assurance_unavailable' };
    }

    const { repository } = this.dependencies;
    await repository.recordAdultAssurance(repository.transactionless, {
      assuranceClass: result.assuranceClass,
      decidedAt: this.dependencies.now(),
      evidenceReference: result.evidenceReference,
      expiresAt: result.expiresAt,
      method: this.dependencies.adultAssuranceVerifier.method,
      outcome: result.outcome,
      policyVersion: adultEligibilityPolicyVersion,
      region,
      userId: input.account.id,
    });
    if (result.outcome === 'failed' || result.outcome === 'revoked') {
      await this.restrict(input.account, 'eligibility_failed');
      return { kind: 'refused' };
    }
    return {
      eligibility: await this.evaluate(input.account),
      kind: 'advanced',
    };
  }

  private async restrict(
    account: UserAccountRow,
    reason: 'eligibility_failed',
  ): Promise<void> {
    if (account.status === 'restricted') return;
    // Deletion states are terminal for admission purposes; a refusal must not
    // resurrect an account out of one.
    if (account.status !== 'pending_profile' && account.status !== 'active') {
      return;
    }
    await this.dependencies.repository.transitionAccountStatus(
      this.dependencies.repository.transactionless,
      {
        expectedStatus: account.status,
        now: this.dependencies.now(),
        status: 'restricted',
        statusReason: reason,
        userId: account.id,
      },
    );
  }

  /**
   * Lifts only a restriction this domain applied for failed eligibility. A
   * safety enforcement restriction is Trust & Safety's to lift, so it is left
   * exactly where it is.
   */
  private async clearEligibilityRestriction(
    account: UserAccountRow,
  ): Promise<void> {
    if (
      account.status !== 'restricted' ||
      account.statusReason !== 'eligibility_failed'
    ) {
      return;
    }
    await this.dependencies.repository.transitionAccountStatus(
      this.dependencies.repository.transactionless,
      {
        expectedStatus: 'restricted',
        now: this.dependencies.now(),
        status: 'pending_profile',
        statusReason: 'onboarding_incomplete',
        userId: account.id,
      },
    );
  }
}

function assuranceLevelOf(
  latest: UserAdultAssuranceRow | undefined,
  now: Date,
): AdultAssuranceLevel {
  if (latest?.outcome !== 'passed') return 'none';
  if ((latest.expiresAt?.getTime() ?? Infinity) <= now.getTime()) {
    // An expired pass is not a pass. It is deliberately not rewritten in the
    // database either: expiry is a property of the record, not an event.
    return 'none';
  }
  return latest.assuranceClass === 'verified_adult'
    ? 'verified_adult'
    : 'self_declared';
}

function stepFor(input: {
  readonly adultAssurance: AdultAssuranceLevel;
  readonly outstandingPolicies: readonly PolicyDocumentRequirement[];
  readonly profileComplete: boolean;
}): OnboardingStep {
  if (input.adultAssurance === 'none') return 'adult_declaration';
  if (input.outstandingPolicies.length > 0) return 'policy_acknowledgement';
  if (!input.profileComplete) return 'profile';
  return 'completed';
}
