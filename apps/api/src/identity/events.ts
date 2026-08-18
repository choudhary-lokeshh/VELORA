/** Minimized assurance fact. Owner domains still re-authorize every effect. */
export const identityEvidenceRecordedEvent =
  'identity.assurance.evidence.recorded.v1';

export interface IdentityEvidenceRecordedPayload {
  readonly effectiveAt: string;
  readonly evidenceClass: string;
  readonly evidenceId: string;
  readonly expiresAt?: string;
  readonly normalizedResult: string;
  readonly policyVersion: string;
  readonly subjectId: string;
  readonly thresholdContext: string;
  readonly [key: string]: unknown;
}
