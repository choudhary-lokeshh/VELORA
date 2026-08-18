import type {
  IdentityEvidenceClass,
  IdentityEvidenceResult,
  IdentityPurpose,
} from './policy.js';

export const identityProviderSnapshotStates = [
  'pending',
  'processing',
  'succeeded',
  'refused',
  'failed',
  'expired',
  'cancelled',
  'revoked',
] as const;
export type IdentityProviderSnapshotState =
  (typeof identityProviderSnapshotStates)[number];

export interface IdentityProviderCapabilities {
  readonly cancellation: boolean;
  readonly evidenceClasses: readonly IdentityEvidenceClass[];
  readonly hostedSession: boolean;
  readonly lookupByIdempotencyKey: boolean;
  readonly purposes: readonly IdentityPurpose[];
}

export interface IdentityProviderEvidenceFact {
  readonly effectiveAt: Date;
  readonly evidenceClass: IdentityEvidenceClass;
  readonly expiresAt?: Date;
  readonly normalizedResult: IdentityEvidenceResult;
  readonly providerFactReference: string;
  readonly thresholdContext: string;
}

/** Provider truth normalized into IDENTITY vocabulary. Never authorization. */
export interface IdentityProviderSnapshot {
  readonly evidence: readonly IdentityProviderEvidenceFact[];
  readonly platformSubjectReference: string;
  readonly providerIdempotencyKey: string;
  readonly providerReference: string;
  readonly state: IdentityProviderSnapshotState;
}

/**
 * Ephemeral handoff returned by a provider.
 *
 * `hostedUrl` may be returned to one already-authorized actor. IDENTITY never
 * persists it, emits it, logs it, or treats visiting it as evidence.
 */
export interface IdentityHostedSession {
  readonly expiresAt: Date;
  readonly hostedUrl: string;
  readonly snapshot: IdentityProviderSnapshot;
}

export interface CreateIdentityHostedSessionRequest {
  readonly attemptReference: string;
  readonly correlationId: string;
  readonly evidenceClass: IdentityEvidenceClass;
  readonly jurisdiction: string;
  readonly platformSubjectReference: string;
  readonly policyVersion: string;
  readonly providerIdempotencyKey: string;
  readonly purpose: IdentityPurpose;
  readonly thresholdContext: string;
}

export interface VerifiedIdentityProviderEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly snapshot: IdentityProviderSnapshot;
}

/**
 * Provider/model-neutral verification port.
 *
 * Account and environment are adapter-owned configuration, never request
 * fields. Raw callbacks are verified over bytes before parsing. No method here
 * grants access or writes another domain.
 */
export interface IdentityVerificationProviderPort {
  readonly account: string;
  readonly capabilities: IdentityProviderCapabilities;
  readonly environment: string;
  readonly provider: string;
  cancel(providerReference: string): Promise<IdentityProviderSnapshot>;
  createHostedSession(
    request: CreateIdentityHostedSessionRequest,
  ): Promise<IdentityHostedSession>;
  retrieveByIdempotencyKey(
    providerIdempotencyKey: string,
  ): Promise<IdentityHostedSession | undefined>;
  retrieveCurrentState(
    providerReference: string,
  ): Promise<IdentityProviderSnapshot>;
  verifyCallback(input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<VerifiedIdentityProviderEvent>;
}

export class IdentityProviderUnavailableError extends Error {
  constructor() {
    super('No approved identity verification provider is configured');
    this.name = 'IdentityProviderUnavailableError';
  }
}

/** Default adapter. Every external operation refuses. */
export class UnavailableIdentityVerificationProvider implements IdentityVerificationProviderPort {
  readonly account = 'unavailable';
  readonly capabilities: IdentityProviderCapabilities = {
    cancellation: false,
    evidenceClasses: [],
    hostedSession: false,
    lookupByIdempotencyKey: false,
    purposes: [],
  };
  readonly environment = 'unavailable';
  readonly provider = 'unavailable';

  cancel(): Promise<IdentityProviderSnapshot> {
    return Promise.reject(this.refusal());
  }

  createHostedSession(): Promise<IdentityHostedSession> {
    return Promise.reject(this.refusal());
  }

  retrieveByIdempotencyKey(): Promise<IdentityHostedSession | undefined> {
    return Promise.reject(this.refusal());
  }

  retrieveCurrentState(): Promise<IdentityProviderSnapshot> {
    return Promise.reject(this.refusal());
  }

  verifyCallback(): Promise<VerifiedIdentityProviderEvent> {
    return Promise.reject(this.refusal());
  }

  private refusal(): IdentityProviderUnavailableError {
    return new IdentityProviderUnavailableError();
  }
}
