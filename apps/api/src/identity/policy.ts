/**
 * Closed, provider-neutral vocabulary for Identity Assurance persistence.
 *
 * These values describe evidence and execution state. They never grant product
 * access, authenticate a principal, or select a provider from client input.
 */

export const identityOwnerDomains = ['auth', 'creators', 'safety'] as const;
export type IdentityOwnerDomain = (typeof identityOwnerDomains)[number];

export const identityPurposes = [
  'adult_assurance',
  'creator_identity',
  'depicted_person_identity',
  'depicted_person_adult_assurance',
  'commercial_kyc',
] as const;
export type IdentityPurpose = (typeof identityPurposes)[number];

export const identityEvidenceClasses = [
  'adult_threshold',
  'identity',
  'creator_identity',
  'commercial_kyc',
  'depicted_person_identity',
  'depicted_person_adult_threshold',
] as const;
export type IdentityEvidenceClass = (typeof identityEvidenceClasses)[number];

export const identityAttemptStates = [
  'created',
  'provider_starting',
  'provider_pending',
  'processing',
  'succeeded',
  'refused',
  'failed',
  'expired',
  'cancelled',
  'unavailable',
] as const;
export type IdentityAttemptState = (typeof identityAttemptStates)[number];

export const activeIdentityAttemptStates: readonly IdentityAttemptState[] = [
  'created',
  'provider_starting',
  'provider_pending',
  'processing',
];

export const terminalIdentityAttemptStates: readonly IdentityAttemptState[] = [
  'succeeded',
  'refused',
  'failed',
  'expired',
  'cancelled',
  'unavailable',
];

export const identityEvidenceResults = [
  'granted',
  'refused',
  'revoked',
  'expired',
] as const;
export type IdentityEvidenceResult = (typeof identityEvidenceResults)[number];

export const identityProviderEventStates = [
  'received',
  'retry_wait',
  'processed',
  'ignored',
  'dead_letter',
] as const;
export type IdentityProviderEventState =
  (typeof identityProviderEventStates)[number];

export const identityReconciliationKinds = [
  'missing_provider_reference',
  'provider_state_drift',
  'stuck_attempt',
  'evidence_expiry',
  'callback_gap',
  'deletion_obligation',
  'retention_obligation',
] as const;
export type IdentityReconciliationKind =
  (typeof identityReconciliationKinds)[number];

export const identityReconciliationStates = [
  'open',
  'resolved',
  'dead_letter',
] as const;
export type IdentityReconciliationState =
  (typeof identityReconciliationStates)[number];

/** Identifier-shaped bounded codes. No field using this pattern may hold prose. */
export const identityCodePattern = '^[a-z0-9][a-z0-9_.:/+-]{0,127}$';
export const jurisdictionCodePattern = '^[A-Z]{2}(-[A-Z0-9]{1,8})?$';
export const maximumIdentityIdempotencyKeyLength = 128;
export const maximumIdentityProviderReferenceLength = 256;
export const maximumIdentityProviderEventIdLength = 256;
export const maximumIdentityProviderEventTypeLength = 128;
export const maximumIdentityLeaseOwnerLength = 128;
export const maximumIdentityFailureCodeLength = 128;
