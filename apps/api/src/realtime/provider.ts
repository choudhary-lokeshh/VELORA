import {
  maximumRtcProviderEventIdLength,
  maximumRtcProviderEventTypeLength,
  maximumRtcProviderReferenceLength,
  rtcCallMediums,
  type RtcCallMedium,
} from './policy.js';

/**
 * What a provider says a session is doing.
 *
 * Normalized into REALTIME's vocabulary at the adapter boundary, because a
 * vendor's own state names would otherwise reach the domain and a second
 * provider would then require either a translation table nobody owns or a
 * change to every caller.
 *
 * None of these is a platform state. They describe what a provider observes
 * about media; the platform's own lifecycle lives in `RtcSessionState` and is
 * decided by authenticated requests, never by anything here.
 */
export const rtcProviderSessionStates = [
  'pending',
  'live',
  'ended',
  'failed',
  'unknown',
] as const;
export type RtcProviderSessionState = (typeof rtcProviderSessionStates)[number];

/**
 * What a candidate provider must be able to do, declared once rather than
 * grown one method at a time.
 *
 * The interface is what a provider is assessed against — the requirement list
 * in `docs/compliance/10-rtc-provider-eligibility.md` is this shape written as
 * questions — so declaring the whole of it up front is what makes an
 * assessment possible before an integration exists. Callers arrive per phase
 * and the unimplemented ones refuse.
 */
export interface RtcProviderCapabilities {
  /** Whether the provider isolates one session's media from every other. */
  readonly sessionIsolation: boolean;
  /** Whether a grant can name one participant rather than a whole room. */
  readonly participantScopedGrants: boolean;
  /** Whether a participant can be removed by a server call. */
  readonly participantRevocation: boolean;
  /** Whether a session can be terminated by a server call. */
  readonly sessionTermination: boolean;
  /** Whether current state can be read back independently of events. */
  readonly stateRetrieval: boolean;
  /** Whether events authenticate the exact raw bytes they arrive as. */
  readonly rawBodyAuthenticatedEvents: boolean;
  /** Whether relay credentials are ephemeral rather than static. */
  readonly ephemeralRelayCredentials: boolean;
  /**
   * Whether this adapter actually carries audio and video between two people.
   *
   * The one capability that is about the *medium* rather than about control of
   * it, and the one a product surface has to be able to read. `local-test`
   * answers every control operation faithfully and reaches no network at all,
   * so a surface that inferred "a provider is configured, therefore people can
   * see each other" would be wrong about the only thing a person on a live
   * screen cares about. Asked here rather than by comparing adapter names, so
   * the day a real provider is approved there is one place that changes.
   */
  readonly carriesMedia: boolean;
  readonly mediums: readonly RtcCallMedium[];
  /**
   * Always false, and asserted to be. A provider that can record is not
   * disqualified; a provider that would record *by default* is, because no
   * consent, indication, retention, or moderation decision exists. See
   * `callRecordingImplemented` in `./policy.ts`.
   */
  readonly recordsByDefault: boolean;
}

/**
 * A provider's view of one session. Never authorization.
 */
export interface RtcProviderSessionSnapshot {
  /** The platform's own session identifier, echoed back for binding. */
  readonly platformSessionReference: string;
  readonly providerReference: string;
  readonly state: RtcProviderSessionState;
}

/**
 * One participant's short-lived means of joining.
 *
 * `credential` is a secret and is handled as one: it is returned to exactly one
 * already-authorized principal, it is never persisted, never logged, never
 * emitted, and never placed in a metric or a trace. What is stored is that an
 * issuance happened and under which authorization generation.
 */
export interface RtcParticipantGrant {
  readonly credential: string;
  readonly expiresAt: Date;
  readonly participantReference: string;
  readonly providerReference: string;
}

export interface CreateRtcSessionRequest {
  readonly correlationId: string;
  readonly medium: RtcCallMedium;
  /** Committed before this call is made, and the key ambiguity recovers by. */
  readonly platformSessionReference: string;
  readonly providerIdempotencyKey: string;
}

export interface IssueRtcGrantRequest {
  /** Advanced by every terminal transition; carried so a stale one is dead. */
  readonly authorizationGeneration: number;
  readonly medium: RtcCallMedium;
  readonly participantReference: string;
  readonly providerReference: string;
  readonly ttlMilliseconds: number;
}

export interface VerifiedRtcProviderEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly participantReference: string | undefined;
  readonly snapshot: RtcProviderSessionSnapshot;
}

function boundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' && value.length >= 1 && value.length <= maximum
  );
}

function finiteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/** Runtime guard at the provider trust boundary. Types do not validate SDKs. */
export function isRtcProviderSessionSnapshot(
  value: unknown,
): value is RtcProviderSessionSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Readonly<Record<string, unknown>>;
  return (
    boundedString(snapshot.platformSessionReference, 36) &&
    boundedString(
      snapshot.providerReference,
      maximumRtcProviderReferenceLength,
    ) &&
    rtcProviderSessionStates.includes(snapshot.state as RtcProviderSessionState)
  );
}

export function isVerifiedRtcProviderEvent(
  value: unknown,
): value is VerifiedRtcProviderEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Readonly<Record<string, unknown>>;
  return (
    boundedString(event.eventId, maximumRtcProviderEventIdLength) &&
    boundedString(event.eventType, maximumRtcProviderEventTypeLength) &&
    finiteDate(event.occurredAt) &&
    (event.participantReference === undefined ||
      boundedString(
        event.participantReference,
        maximumRtcProviderReferenceLength,
      )) &&
    isRtcProviderSessionSnapshot(event.snapshot)
  );
}

/**
 * The provider-neutral RTC transport port.
 *
 * Account and environment are adapter-owned configuration, never request
 * fields: no route, header, query parameter, or client field selects a
 * provider, an account, or an environment. Raw callbacks are verified over
 * bytes before parsing. No method here grants product permission, and nothing
 * it returns is treated as one.
 */
export interface RtcProviderPort {
  readonly account: string;
  readonly capabilities: RtcProviderCapabilities;
  /**
   * Where a client presents a credential this adapter mints, when there is
   * such a place.
   *
   * Adapter configuration rather than a per-grant value, because it is a
   * property of the account this process composed and never of the person
   * asking: two participants in one session are told the same address, and no
   * request field, header, or client value contributes to it.
   *
   * `undefined` for every adapter that carries no media, which is the honest
   * answer for one — there is nowhere to present anything. It is not a secret:
   * it is the public address of a media project, and a browser cannot connect
   * without it. The credential that goes with it is the secret, and it is
   * minted per participant, per session, per issuance.
   */
  readonly clientEndpoint: string | undefined;
  readonly environment: string;
  readonly provider: string;
  createSession(
    request: CreateRtcSessionRequest,
  ): Promise<RtcProviderSessionSnapshot>;
  /** Recovers an ambiguous create by the key committed before it was made. */
  retrieveByIdempotencyKey(
    providerIdempotencyKey: string,
  ): Promise<RtcProviderSessionSnapshot | undefined>;
  retrieveCurrentState(
    providerReference: string,
  ): Promise<RtcProviderSessionSnapshot>;
  issueParticipantGrant(
    request: IssueRtcGrantRequest,
  ): Promise<RtcParticipantGrant>;
  revokeParticipant(input: {
    readonly participantReference: string;
    readonly providerReference: string;
  }): Promise<void>;
  endSession(providerReference: string): Promise<void>;
  verifyEvent(input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<VerifiedRtcProviderEvent>;
}

export class RtcProviderUnavailableError extends Error {
  constructor() {
    super('No approved RTC provider is configured');
    this.name = 'RtcProviderUnavailableError';
  }
}

/**
 * Default adapter. Every external operation refuses.
 *
 * The only value staging and production accept, and the reason is recorded
 * rather than implied: `docs/compliance/10-rtc-provider-eligibility.md`,
 * researched from official sources on 2026-08-20, approves nobody. One
 * candidate prohibits what Velora is on its own published terms, one documents
 * that every track is retrievable from any session in its app and so offers a
 * one-to-one call no provider-enforced boundary, two published terms that could
 * not be retrieved at all, and the rest carry unresolved written-approval gaps.
 *
 * Its capabilities are all `false`, which is the accurate description of a
 * provider that cannot do anything rather than a placeholder to be filled in.
 */
export class UnavailableRtcProvider implements RtcProviderPort {
  readonly account = 'unavailable';
  /** Nowhere to present anything, because nothing is carried. */
  readonly clientEndpoint = undefined;
  readonly capabilities: RtcProviderCapabilities = {
    carriesMedia: false,
    ephemeralRelayCredentials: false,
    mediums: [],
    participantRevocation: false,
    participantScopedGrants: false,
    rawBodyAuthenticatedEvents: false,
    recordsByDefault: false,
    sessionIsolation: false,
    sessionTermination: false,
    stateRetrieval: false,
  };
  readonly environment = 'unavailable';
  readonly provider = 'unavailable';

  createSession(): Promise<RtcProviderSessionSnapshot> {
    return Promise.reject(this.refusal());
  }

  endSession(): Promise<void> {
    return Promise.reject(this.refusal());
  }

  issueParticipantGrant(): Promise<RtcParticipantGrant> {
    return Promise.reject(this.refusal());
  }

  retrieveByIdempotencyKey(): Promise<RtcProviderSessionSnapshot | undefined> {
    return Promise.reject(this.refusal());
  }

  retrieveCurrentState(): Promise<RtcProviderSessionSnapshot> {
    return Promise.reject(this.refusal());
  }

  revokeParticipant(): Promise<void> {
    return Promise.reject(this.refusal());
  }

  verifyEvent(): Promise<VerifiedRtcProviderEvent> {
    return Promise.reject(this.refusal());
  }

  private refusal(): RtcProviderUnavailableError {
    return new RtcProviderUnavailableError();
  }
}

/** The mediums any real adapter must at least declare. */
export const requiredRtcProviderMediums: readonly RtcCallMedium[] =
  rtcCallMediums;
