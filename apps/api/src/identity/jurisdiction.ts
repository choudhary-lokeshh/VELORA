import type {
  IdentityEvidenceClass,
  IdentityEvidenceResult,
  IdentityOwnerDomain,
  IdentityPurpose,
} from './policy.js';
import { identityPurposeBelongsToOwner } from './policy.js';

export type IdentityJurisdictionDecision =
  | { readonly kind: 'UNKNOWN'; readonly policyVersion: string }
  | {
      readonly kind: 'BLOCKED';
      readonly policyVersion: string;
      readonly reasonCode: string;
    }
  | {
      readonly kind: 'ALLOWED_WITH_REQUIREMENTS';
      readonly policyVersion: string;
      readonly requiredEvidenceClass: IdentityEvidenceClass;
      readonly requiredThreshold: string;
    };

export interface IdentityJurisdictionPolicyPort {
  readonly source: string;
  evaluate(input: {
    readonly jurisdiction: string;
    readonly ownerDomain: IdentityOwnerDomain;
    readonly purpose: IdentityPurpose;
  }): IdentityJurisdictionDecision;
}

/**
 * A privacy-minimized current-evidence shape. It deliberately contains no
 * subject, provider, hosted-link, or provider-fact reference.
 */
export interface IdentityEvidenceForReverification {
  readonly evidenceClass: IdentityEvidenceClass;
  readonly expiresAt: Date | null;
  readonly normalizedResult: IdentityEvidenceResult;
  readonly policyVersion: string;
  readonly thresholdContext: string;
}

/**
 * A technical comparison with the *currently evaluated* policy. It is not a
 * product authorization, does not start a provider flow, and does not create
 * or revoke evidence. Owning domains must separately authorize and decide
 * whether an approved surface may act on this answer.
 */
export type IdentityReverificationAssessment =
  | { readonly kind: 'current'; readonly policyVersion: string }
  | {
      readonly kind: 'no_current_grant';
      readonly policyVersion: string;
    }
  | {
      readonly kind: 'policy_blocked';
      readonly policyVersion: string;
      readonly reasonCode: string;
    }
  | { readonly kind: 'policy_unknown'; readonly policyVersion: string }
  | {
      readonly kind: 'reverification_due';
      readonly policyVersion: string;
      readonly reason:
        'evidence_expired' | 'policy_version_changed' | 'requirements_changed';
    };

export class IdentityReverificationPolicy {
  constructor(
    private readonly jurisdictionPolicy: IdentityJurisdictionPolicyPort,
  ) {}

  assess(input: {
    readonly currentEvidence: IdentityEvidenceForReverification | undefined;
    readonly jurisdiction: string;
    readonly now: Date;
    readonly ownerDomain: IdentityOwnerDomain;
    readonly purpose: IdentityPurpose;
  }): IdentityReverificationAssessment {
    const policy = this.jurisdictionPolicy.evaluate(input);
    if (policy.kind === 'UNKNOWN') {
      return { kind: 'policy_unknown', policyVersion: policy.policyVersion };
    }
    if (policy.kind === 'BLOCKED') {
      return {
        kind: 'policy_blocked',
        policyVersion: policy.policyVersion,
        reasonCode: policy.reasonCode,
      };
    }

    const evidence = input.currentEvidence;
    if (evidence?.normalizedResult !== 'granted') {
      return { kind: 'no_current_grant', policyVersion: policy.policyVersion };
    }
    if (
      evidence.expiresAt !== null &&
      (!Number.isFinite(evidence.expiresAt.getTime()) ||
        evidence.expiresAt <= input.now)
    ) {
      return {
        kind: 'reverification_due',
        policyVersion: policy.policyVersion,
        reason: 'evidence_expired',
      };
    }
    if (evidence.policyVersion !== policy.policyVersion) {
      return {
        kind: 'reverification_due',
        policyVersion: policy.policyVersion,
        reason: 'policy_version_changed',
      };
    }
    if (
      evidence.evidenceClass !== policy.requiredEvidenceClass ||
      evidence.thresholdContext !== policy.requiredThreshold
    ) {
      return {
        kind: 'reverification_due',
        policyVersion: policy.policyVersion,
        reason: 'requirements_changed',
      };
    }
    return { kind: 'current', policyVersion: policy.policyVersion };
  }
}

/** Production default. Absence of published policy is an explicit refusal. */
export class UnpublishedIdentityJurisdictionPolicy implements IdentityJurisdictionPolicyPort {
  readonly source = 'unpublished';

  evaluate(): IdentityJurisdictionDecision {
    return { kind: 'UNKNOWN', policyVersion: 'unpublished' };
  }
}

/**
 * Deterministic fixture. Values exercise policy versioning; they are not legal
 * claims and configuration rejects this policy outside local/test.
 */
export class LocalTestIdentityJurisdictionPolicy implements IdentityJurisdictionPolicyPort {
  readonly source = 'local-test';
  readonly version: string;

  constructor(input: { readonly version?: string } = {}) {
    this.version = input.version ?? 'local-test-v1';
  }

  evaluate(input: {
    readonly jurisdiction: string;
    readonly ownerDomain: IdentityOwnerDomain;
    readonly purpose: IdentityPurpose;
  }): IdentityJurisdictionDecision {
    if (!identityPurposeBelongsToOwner(input.ownerDomain, input.purpose)) {
      return { kind: 'UNKNOWN', policyVersion: this.version };
    }
    if (input.jurisdiction === 'AQ') {
      return {
        kind: 'BLOCKED',
        policyVersion: this.version,
        reasonCode: 'local-test-blocked',
      };
    }
    if (input.jurisdiction !== 'ES' && input.jurisdiction !== 'US-CA') {
      return { kind: 'UNKNOWN', policyVersion: this.version };
    }

    const requirement = localTestRequirement(input.purpose);
    return {
      kind: 'ALLOWED_WITH_REQUIREMENTS',
      policyVersion: this.version,
      ...requirement,
    };
  }
}

function localTestRequirement(purpose: IdentityPurpose): {
  readonly requiredEvidenceClass: IdentityEvidenceClass;
  readonly requiredThreshold: string;
} {
  switch (purpose) {
    case 'adult_assurance':
      return {
        requiredEvidenceClass: 'adult_threshold',
        requiredThreshold: 'adult-18-plus',
      };
    case 'creator_identity':
      return {
        requiredEvidenceClass: 'creator_identity',
        requiredThreshold: 'identity-match',
      };
    case 'depicted_person_identity':
      return {
        requiredEvidenceClass: 'depicted_person_identity',
        requiredThreshold: 'identity-match',
      };
    case 'depicted_person_adult_assurance':
      return {
        requiredEvidenceClass: 'depicted_person_adult_threshold',
        requiredThreshold: 'adult-18-plus',
      };
    case 'commercial_kyc':
      return {
        requiredEvidenceClass: 'commercial_kyc',
        requiredThreshold: 'commercial-kyc',
      };
  }
}
