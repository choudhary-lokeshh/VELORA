import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { rtcCallMediums, type RtcCallMedium } from './policy.js';
import type {
  CreateRtcSessionRequest,
  IssueRtcGrantRequest,
  RtcParticipantGrant,
  RtcProviderCapabilities,
  RtcProviderPort,
  RtcProviderSessionSnapshot,
  RtcProviderSessionState,
  VerifiedRtcProviderEvent,
} from './provider.js';

export const localTestRtcEventSecret = 'velora-local-test-rtc-event-secret';
export const localTestRtcSignatureHeader = 'x-velora-rtc-test-signature';

export type LocalTestRtcProviderBehaviour =
  | 'normal'
  /** Create appears to fail while actually having succeeded. */
  | 'ambiguous-create'
  /** Create and retrieval both refuse, as an outage would. */
  | 'outage'
  /** The room stays alive after the platform asks for it to end. */
  | 'ignores-termination';

interface LocalSession {
  readonly medium: RtcCallMedium;
  readonly platformSessionReference: string;
  readonly providerReference: string;
  revokedParticipants: Set<string>;
  state: RtcProviderSessionState;
}

/**
 * Deterministic, network-free provider fixture.
 *
 * It exists so the orchestration *around* a provider — the two-transaction
 * create, ambiguous outcomes recovered by idempotency key, participant
 * revocation, verified events, drift between what a provider believes and what
 * the platform decided — is exercisable before any provider is approved. It is
 * named `local-test` so no passing test can be read as evidence about a real
 * one, and configuration refuses it outside local and test, so there is no
 * route, header, request field, or environment string that reaches it in a
 * deployed environment.
 *
 * It carries no media and reaches no network. Its maps are process-local on
 * purpose: they are the provider's own test truth, not platform truth, and no
 * platform decision reads them.
 */
export class LocalTestRtcProvider implements RtcProviderPort {
  readonly account = 'default';
  /**
   * Nowhere, and never anywhere. This adapter reaches no network, so a surface
   * that received an address here would connect to nothing and report that it
   * had — the exact confusion `carriesMedia: false` exists to prevent.
   */
  readonly clientEndpoint = undefined;
  readonly capabilities: RtcProviderCapabilities = {
    // Never true. This adapter reaches no network and carries no packet, so a
    // surface reading it is told the truth rather than "a provider exists".
    carriesMedia: false,
    ephemeralRelayCredentials: true,
    mediums: rtcCallMediums,
    participantRevocation: true,
    participantScopedGrants: true,
    rawBodyAuthenticatedEvents: true,
    // Never true. A fixture that recorded would make a recording path
    // exercisable, and no consent, retention, or moderation decision exists.
    recordsByDefault: false,
    sessionIsolation: true,
    sessionTermination: true,
    stateRetrieval: true,
  };
  readonly environment = 'test';
  readonly provider = 'local-test';

  private behaviour: LocalTestRtcProviderBehaviour = 'normal';
  private createCalls = 0;
  private readonly byIdempotencyKey = new Map<string, LocalSession>();
  private readonly byReference = new Map<string, LocalSession>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Test-only failure injection. Never reachable from a request. */
  behaveAs(behaviour: LocalTestRtcProviderBehaviour): void {
    this.behaviour = behaviour;
  }

  /** Test-only observation proving orchestration sends one instruction. */
  createCallCount(): number {
    return this.createCalls;
  }

  /** Test-only view of what the provider still believes is live. */
  liveSessionCount(): number {
    return [...this.byReference.values()].filter(
      (session) => session.state === 'live' || session.state === 'pending',
    ).length;
  }

  /** Test-only view of who this provider has been told to remove. */
  isParticipantRevoked(input: {
    readonly participantReference: string;
    readonly providerReference: string;
  }): boolean {
    return (
      this.byReference
        .get(input.providerReference)
        ?.revokedParticipants.has(input.participantReference) ?? false
    );
  }

  createSession(
    request: CreateRtcSessionRequest,
  ): Promise<RtcProviderSessionSnapshot> {
    this.createCalls += 1;
    if (this.behaviour === 'outage') {
      return Promise.reject(
        new Error('local-test RTC provider is unavailable'),
      );
    }

    const existing = this.byIdempotencyKey.get(request.providerIdempotencyKey);
    if (existing !== undefined) return Promise.resolve(snapshotOf(existing));

    const session: LocalSession = {
      medium: request.medium,
      platformSessionReference: request.platformSessionReference,
      providerReference: `local-test-room-${randomUUID()}`,
      revokedParticipants: new Set<string>(),
      state: 'pending',
    };
    this.byIdempotencyKey.set(request.providerIdempotencyKey, session);
    this.byReference.set(session.providerReference, session);

    if (this.behaviour === 'ambiguous-create') {
      // The room exists and the caller never learns its reference. This is the
      // outcome the two-transaction create and the idempotency lookup exist
      // for, and the only honest way to exercise them.
      return Promise.reject(new Error('local-test RTC create timed out'));
    }
    return Promise.resolve(snapshotOf(session));
  }

  retrieveByIdempotencyKey(
    providerIdempotencyKey: string,
  ): Promise<RtcProviderSessionSnapshot | undefined> {
    if (this.behaviour === 'outage') {
      return Promise.reject(
        new Error('local-test RTC provider is unavailable'),
      );
    }
    const session = this.byIdempotencyKey.get(providerIdempotencyKey);
    return Promise.resolve(
      session === undefined ? undefined : snapshotOf(session),
    );
  }

  retrieveCurrentState(
    providerReference: string,
  ): Promise<RtcProviderSessionSnapshot> {
    if (this.behaviour === 'outage') {
      return Promise.reject(
        new Error('local-test RTC provider is unavailable'),
      );
    }
    const session = this.byReference.get(providerReference);
    if (session === undefined) {
      return Promise.resolve({
        platformSessionReference: '',
        providerReference,
        state: 'unknown',
      });
    }
    return Promise.resolve(snapshotOf(session));
  }

  issueParticipantGrant(
    request: IssueRtcGrantRequest,
  ): Promise<RtcParticipantGrant> {
    const session = this.byReference.get(request.providerReference);
    if (session === undefined) {
      return Promise.reject(new Error('local-test RTC session does not exist'));
    }
    if (session.state === 'ended' || session.state === 'failed') {
      return Promise.reject(new Error('local-test RTC session has ended'));
    }
    // The credential names one room, one participant, and one authorization
    // generation, and it is derived rather than stored, so this fixture never
    // holds a reusable secret either.
    const credential = createHmac('sha256', localTestRtcEventSecret)
      .update(
        `${request.providerReference}:${request.participantReference}:${String(
          request.authorizationGeneration,
        )}`,
      )
      .digest('hex');
    return Promise.resolve({
      credential,
      expiresAt: new Date(this.now().getTime() + request.ttlMilliseconds),
      participantReference: request.participantReference,
      providerReference: request.providerReference,
    });
  }

  revokeParticipant(input: {
    readonly participantReference: string;
    readonly providerReference: string;
  }): Promise<void> {
    const session = this.byReference.get(input.providerReference);
    if (session === undefined) {
      return Promise.reject(new Error('local-test RTC session does not exist'));
    }
    session.revokedParticipants.add(input.participantReference);
    return Promise.resolve();
  }

  endSession(providerReference: string): Promise<void> {
    if (this.behaviour === 'outage') {
      return Promise.reject(
        new Error('local-test RTC provider is unavailable'),
      );
    }
    const session = this.byReference.get(providerReference);
    if (session === undefined) {
      return Promise.reject(new Error('local-test RTC session does not exist'));
    }
    // Deliberately does nothing under this behaviour, so reconciliation has a
    // real divergence to find rather than a simulated one.
    if (this.behaviour !== 'ignores-termination') session.state = 'ended';
    return Promise.resolve();
  }

  /**
   * Verifies the exact bytes before anything parses them.
   *
   * Constant-time comparison, and the body is authenticated as it arrived
   * rather than after a round trip through JSON — a signature checked against
   * a re-serialized body authenticates a different document than the one that
   * was sent.
   */
  verifyEvent(input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<VerifiedRtcProviderEvent> {
    const presented = input.headers.get(localTestRtcSignatureHeader);
    if (presented === null) {
      return Promise.reject(new Error('local-test RTC event is unsigned'));
    }
    const expected = createHmac('sha256', localTestRtcEventSecret)
      .update(input.rawBody)
      .digest('hex');
    const presentedBytes = Buffer.from(presented, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    if (
      presentedBytes.length !== expectedBytes.length ||
      !timingSafeEqual(presentedBytes, expectedBytes)
    ) {
      return Promise.reject(new Error('local-test RTC event failed signature'));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(input.rawBody).toString('utf8'));
    } catch {
      return Promise.reject(new Error('local-test RTC event is not JSON'));
    }
    const event = parsed as Readonly<Record<string, unknown>>;
    const providerReference = event.providerReference;
    const eventId = event.eventId;
    const eventType = event.eventType;
    const state = event.state;
    if (
      typeof providerReference !== 'string' ||
      typeof eventId !== 'string' ||
      typeof eventType !== 'string' ||
      typeof state !== 'string'
    ) {
      return Promise.reject(new Error('local-test RTC event is malformed'));
    }

    const session = this.byReference.get(providerReference);
    return Promise.resolve({
      eventId,
      eventType,
      occurredAt: this.now(),
      participantReference:
        typeof event.participantReference === 'string'
          ? event.participantReference
          : undefined,
      snapshot: {
        platformSessionReference: session?.platformSessionReference ?? '',
        providerReference,
        state: state as RtcProviderSessionState,
      },
    });
  }

  /** Test-only helper: signs a body the way this fixture verifies one. */
  static sign(rawBody: Uint8Array): string {
    return createHmac('sha256', localTestRtcEventSecret)
      .update(rawBody)
      .digest('hex');
  }
}

function snapshotOf(session: LocalSession): RtcProviderSessionSnapshot {
  return {
    platformSessionReference: session.platformSessionReference,
    providerReference: session.providerReference,
    state: session.state,
  };
}
