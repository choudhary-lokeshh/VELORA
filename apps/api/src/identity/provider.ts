import {
  identityCodePattern,
  identityEvidenceClasses,
  identityEvidenceResults,
  maximumIdentityProviderEvidenceFacts,
  maximumIdentityProviderEventIdLength,
  maximumIdentityProviderEventTypeLength,
  maximumIdentityProviderReferenceLength,
  maximumIdentityIdempotencyKeyLength,
  type IdentityEvidenceClass,
  type IdentityEvidenceResult,
  type IdentityPurpose,
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

export function isIdentityHostedSession(
  value: unknown,
): value is IdentityHostedSession {
  if (typeof value !== 'object' || value === null) return false;
  const session = value as Readonly<Record<string, unknown>>;
  return (
    finiteDate(session.expiresAt) &&
    typeof session.hostedUrl === 'string' &&
    isIdentityProviderSnapshot(session.snapshot)
  );
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

/** Runtime guard at the provider trust boundary. Types do not validate SDKs. */
export function isIdentityProviderSnapshot(
  value: unknown,
): value is IdentityProviderSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Readonly<Record<string, unknown>>;
  if (
    !Array.isArray(snapshot.evidence) ||
    snapshot.evidence.length > maximumIdentityProviderEvidenceFacts ||
    !boundedString(snapshot.platformSubjectReference, 36) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      snapshot.platformSubjectReference,
    ) ||
    !boundedString(
      snapshot.providerIdempotencyKey,
      maximumIdentityIdempotencyKeyLength,
    ) ||
    !boundedString(
      snapshot.providerReference,
      maximumIdentityProviderReferenceLength,
    ) ||
    !identityProviderSnapshotStates.includes(
      snapshot.state as IdentityProviderSnapshotState,
    )
  ) {
    return false;
  }
  return snapshot.evidence.every(isIdentityProviderEvidenceFact);
}

export function isVerifiedIdentityProviderEvent(
  value: unknown,
): value is VerifiedIdentityProviderEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Readonly<Record<string, unknown>>;
  return (
    boundedString(event.eventId, maximumIdentityProviderEventIdLength) &&
    boundedString(event.eventType, maximumIdentityProviderEventTypeLength) &&
    finiteDate(event.occurredAt) &&
    isIdentityProviderSnapshot(event.snapshot)
  );
}

function isIdentityProviderEvidenceFact(
  value: unknown,
): value is IdentityProviderEvidenceFact {
  if (typeof value !== 'object' || value === null) return false;
  const fact = value as Readonly<Record<string, unknown>>;
  return (
    finiteDate(fact.effectiveAt) &&
    (fact.expiresAt === undefined ||
      (finiteDate(fact.expiresAt) && fact.expiresAt >= fact.effectiveAt)) &&
    identityEvidenceClasses.includes(
      fact.evidenceClass as IdentityEvidenceClass,
    ) &&
    identityEvidenceResults.includes(
      fact.normalizedResult as IdentityEvidenceResult,
    ) &&
    boundedString(
      fact.providerFactReference,
      maximumIdentityProviderReferenceLength,
    ) &&
    typeof fact.thresholdContext === 'string' &&
    new RegExp(identityCodePattern, 'u').test(fact.thresholdContext)
  );
}

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' && value.length >= 1 && value.length <= maximum
  );
}

function finiteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
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
