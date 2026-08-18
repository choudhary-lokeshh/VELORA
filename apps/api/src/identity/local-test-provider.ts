import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { identityEvidenceClasses, identityPurposes } from './policy.js';
import type {
  CreateIdentityHostedSessionRequest,
  IdentityHostedSession,
  IdentityProviderCapabilities,
  IdentityProviderEvidenceFact,
  IdentityProviderSnapshot,
  IdentityProviderSnapshotState,
  IdentityVerificationProviderPort,
  VerifiedIdentityProviderEvent,
} from './provider.js';

export const localTestIdentityCallbackSecret =
  'velora-local-test-identity-callback-secret';
export const localTestIdentitySignatureHeader =
  'x-velora-identity-test-signature';

export type LocalTestIdentityProviderBehaviour = 'normal' | 'ambiguous';

/**
 * Deterministic, network-free provider fixture.
 *
 * Maps represent the provider's own test truth, not platform truth. They are
 * intentionally process-local because configuration refuses this adapter in
 * staging/production and no owner decision reads them directly.
 */
export class LocalTestIdentityVerificationProvider implements IdentityVerificationProviderPort {
  readonly account = 'default';
  readonly capabilities: IdentityProviderCapabilities = {
    cancellation: true,
    evidenceClasses: identityEvidenceClasses,
    hostedSession: true,
    lookupByIdempotencyKey: true,
    purposes: identityPurposes,
  };
  readonly environment = 'test';
  readonly provider = 'local-test';

  private behaviour: LocalTestIdentityProviderBehaviour = 'normal';
  private createCalls = 0;
  private readonly byIdempotencyKey = new Map<string, IdentityHostedSession>();
  private readonly byReference = new Map<string, IdentityHostedSession>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Test-only failure injection. Never reachable from a request. */
  behaveAs(behaviour: LocalTestIdentityProviderBehaviour): void {
    this.behaviour = behaviour;
  }

  /** Test-only observation proving orchestration sends one instruction. */
  createCallCount(): number {
    return this.createCalls;
  }

  createHostedSession(
    request: CreateIdentityHostedSessionRequest,
  ): Promise<IdentityHostedSession> {
    this.createCalls += 1;
    const existing = this.byIdempotencyKey.get(request.providerIdempotencyKey);
    if (existing !== undefined) return Promise.resolve(existing);

    const providerReference = this.reference(request.providerIdempotencyKey);
    const session: IdentityHostedSession = {
      expiresAt: new Date(this.now().getTime() + 10 * 60 * 1_000),
      hostedUrl: `https://identity.velora.invalid/local-test/${providerReference}`,
      snapshot: {
        evidence: [],
        platformSubjectReference: request.platformSubjectReference,
        providerIdempotencyKey: request.providerIdempotencyKey,
        providerReference,
        state: 'pending',
      },
    };
    this.byIdempotencyKey.set(request.providerIdempotencyKey, session);
    this.byReference.set(providerReference, session);

    if (this.behaviour === 'ambiguous') {
      return Promise.reject(
        new Error('local-test: ambiguous identity provider outcome'),
      );
    }
    return Promise.resolve(session);
  }

  retrieveByIdempotencyKey(
    providerIdempotencyKey: string,
  ): Promise<IdentityHostedSession | undefined> {
    return Promise.resolve(this.byIdempotencyKey.get(providerIdempotencyKey));
  }

  retrieveCurrentState(
    providerReference: string,
  ): Promise<IdentityProviderSnapshot> {
    const session = this.byReference.get(providerReference);
    if (session === undefined) {
      return Promise.reject(new Error('local-test: unknown identity session'));
    }
    return Promise.resolve(session.snapshot);
  }

  cancel(providerReference: string): Promise<IdentityProviderSnapshot> {
    const session = this.byReference.get(providerReference);
    if (session === undefined) {
      return Promise.reject(new Error('local-test: unknown identity session'));
    }
    const snapshot = { ...session.snapshot, state: 'cancelled' as const };
    const updated = { ...session, snapshot };
    this.byReference.set(providerReference, updated);
    this.byIdempotencyKey.set(snapshot.providerIdempotencyKey, updated);
    return Promise.resolve(snapshot);
  }

  /** Test-only provider state change used by callback/reconciliation tests. */
  setResult(input: {
    readonly evidence?: readonly IdentityProviderEvidenceFact[];
    readonly providerReference: string;
    readonly state: IdentityProviderSnapshotState;
  }): void {
    const session = this.byReference.get(input.providerReference);
    if (session === undefined) {
      throw new Error('local-test: unknown identity session');
    }
    const snapshot: IdentityProviderSnapshot = {
      ...session.snapshot,
      evidence: input.evidence ?? session.snapshot.evidence,
      state: input.state,
    };
    const updated = { ...session, snapshot };
    this.byReference.set(input.providerReference, updated);
    this.byIdempotencyKey.set(snapshot.providerIdempotencyKey, updated);
  }

  verifyCallback(input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<VerifiedIdentityProviderEvent> {
    const supplied = input.headers.get(localTestIdentitySignatureHeader);
    if (supplied === null || !/^[0-9a-f]{64}$/u.test(supplied)) {
      return Promise.reject(new Error('local-test: callback refused'));
    }
    const expected = createHmac('sha256', localTestIdentityCallbackSecret)
      .update(input.rawBody)
      .digest();
    const received = Buffer.from(supplied, 'hex');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return Promise.reject(new Error('local-test: callback refused'));
    }

    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(input.rawBody));
    } catch {
      return Promise.reject(new Error('local-test: callback refused'));
    }
    if (typeof value !== 'object' || value === null) {
      return Promise.reject(new Error('local-test: callback refused'));
    }
    const body = value as Readonly<Record<string, unknown>>;
    if (
      typeof body.eventId !== 'string' ||
      body.eventId.length < 1 ||
      body.eventId.length > 256 ||
      typeof body.eventType !== 'string' ||
      body.eventType.length < 1 ||
      body.eventType.length > 128 ||
      typeof body.occurredAt !== 'string' ||
      typeof body.providerReference !== 'string'
    ) {
      return Promise.reject(new Error('local-test: callback refused'));
    }
    const occurredAt = new Date(body.occurredAt);
    const session = this.byReference.get(body.providerReference);
    if (!Number.isFinite(occurredAt.getTime()) || session === undefined) {
      return Promise.reject(new Error('local-test: callback refused'));
    }
    return Promise.resolve({
      eventId: body.eventId,
      eventType: body.eventType,
      occurredAt,
      snapshot: session.snapshot,
    });
  }

  private reference(providerIdempotencyKey: string): string {
    const digest = createHash('sha256')
      .update(providerIdempotencyKey, 'utf8')
      .digest('hex')
      .slice(0, 32);
    return `identity-test-${digest}`;
  }
}
