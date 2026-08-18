import type {
  IdentityEvidenceClass,
  IdentityOwnerDomain,
  IdentityPurpose,
} from './policy.js';

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
  readonly version = 'local-test-v1';

  evaluate(input: {
    readonly jurisdiction: string;
    readonly ownerDomain: IdentityOwnerDomain;
    readonly purpose: IdentityPurpose;
  }): IdentityJurisdictionDecision {
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
