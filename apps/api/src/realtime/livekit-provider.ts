import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
  type Room,
} from 'livekit-server-sdk';

import {
  rtcCallMediums,
  maximumRtcProviderReferenceLength,
  type RtcCallMedium,
} from './policy.js';
import { RtcProviderCredentialsRefusedError } from './provider.js';
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

/**
 * How long an empty room survives before LiveKit removes it.
 *
 * Long enough that the second person can arrive after the first, short enough
 * that an abandoned room does not outlive the encounter that created it by more
 * than a minute. The platform's own end-of-encounter path deletes the room
 * explicitly; this is what closes one nobody ever joined.
 */
const emptyRoomTimeoutSeconds = 60;

/**
 * How long a room survives after the last participant leaves.
 *
 * A phone changing networks must not cost somebody the person they were talking
 * to, and REALTIME's own reconnect grace already allows for that. This is the
 * provider-side equivalent and is deliberately the shorter of the two, so the
 * platform's decision to end an encounter is never blocked on a room that the
 * provider is still holding open.
 */
const departureTimeoutSeconds = 20;

/**
 * Exactly two people, enforced by the provider rather than by this platform.
 *
 * A random live encounter is two strangers and never a third. Setting it here
 * means a stolen or replayed credential cannot add anybody to a conversation
 * already in progress even if every check on this side were bypassed — the
 * provider refuses the third connection itself.
 */
const maximumRoomParticipants = 2;

/**
 * The LiveKit webhook header, spelled as LiveKit sends it.
 *
 * Read case-insensitively through `Headers`, because a proxy is free to
 * normalize it and a lookup that depended on the case would fail in production
 * and pass in every test that constructed the header by hand.
 */
const livekitAuthorizationHeader = 'authorization';

/**
 * What LiveKit calls things, mapped into REALTIME's own vocabulary.
 *
 * The mapping lives here and nowhere else, which is the whole point of the
 * port: a new LiveKit event type is a line in this table rather than a change
 * to anything that reads a session state. An event this table does not know is
 * `unknown` rather than being passed through — a vendor's string reaching a
 * platform column is exactly what the adapter boundary exists to prevent.
 *
 * `participant_left` maps to `live` deliberately. One person leaving a room does
 * not end it: the other may still be there, and the room survives its
 * `departureTimeout`. What ends a session is `room_finished`, or the platform
 * deciding, and those are the only two things that may.
 */
const livekitEventStates: Readonly<Record<string, RtcProviderSessionState>> = {
  participant_connection_aborted: 'live',
  participant_joined: 'live',
  participant_left: 'live',
  room_finished: 'ended',
  room_started: 'pending',
  track_published: 'live',
  track_unpublished: 'live',
};

export interface LiveKitRtcProviderOptions {
  readonly apiKey: string;
  readonly apiSecret: string;
  /** Where clients present the credential. `wss://…` for a LiveKit project. */
  readonly url: string;
}

/**
 * LiveKit as a transport, and nothing more than a transport.
 *
 * This adapter can create a room, mint one participant's short-lived means of
 * joining it, remove that participant, delete the room, read back what LiveKit
 * believes, and authenticate LiveKit's callbacks. It cannot decide who meets
 * whom, who may join, or when a credential stops working: those are VELORA's,
 * decided by {@link ../live/service.js} and
 * {@link ./authorization.js} before this file is ever reached.
 *
 * Four properties are worth stating because each is a decision rather than a
 * default.
 *
 * **The room name is opaque and derived, never supplied.** It is an HMAC of the
 * platform's own idempotency key under the project's API secret, so it is
 * deterministic — which is what makes an ambiguous create recoverable — and
 * unguessable without the secret. No request field, header, or client value
 * contributes to it. It deliberately is not the platform session identifier:
 * a provider, and anything a provider logs or exports, never holds one.
 *
 * **The platform's session reference travels in room metadata, and nothing else
 * does.** The orchestrator refuses a snapshot that names a different session,
 * so the reference has to survive a round trip. It is an opaque UUID with no
 * personal data attached to it, and it is the only VELORA value this adapter
 * sends anywhere. No display name, no handle, no region, no language, and no
 * account identifier is ever given to LiveKit.
 *
 * **A grant is one participant, one room, one issuance.** `roomJoin` scoped to
 * exactly one room, publish and subscribe, and nothing else: no `roomCreate`,
 * no `roomAdmin`, no `roomList`, no `roomRecord`, no data channel, and no
 * metadata write. The token's `nbf` is its issuance instant, which is what
 * makes {@link revokeParticipant}'s `revokeTokenTs` kill every credential
 * minted before a person was removed — provider-side revocation of a bearer
 * token this platform has already handed out.
 *
 * **Nothing is recorded.** No egress is requested on any room, `roomRecord` is
 * never granted, and `recordsByDefault` is asserted false by a test. VELORA's
 * recording posture is that no live encounter is recorded, and an adapter that
 * could quietly change that would make the posture a comment.
 */
export class LiveKitRtcProvider implements RtcProviderPort {
  readonly capabilities: RtcProviderCapabilities = {
    // The first adapter for which this is true. It is what a live surface reads
    // to decide whether to say two people can see each other.
    carriesMedia: true,
    ephemeralRelayCredentials: true,
    mediums: rtcCallMediums,
    participantRevocation: true,
    participantScopedGrants: true,
    rawBodyAuthenticatedEvents: true,
    // Never true, and asserted. No egress is requested anywhere in this file.
    recordsByDefault: false,
    sessionIsolation: true,
    sessionTermination: true,
    stateRetrieval: true,
  };

  readonly provider = 'livekit';

  /**
   * Which project this adapter is bound to, and which environment it belongs
   * to, recorded on every provider event so two accounts can never be confused
   * for one.
   *
   * Both are derived from the configured URL rather than from a second variable
   * nobody would remember to change: the host *is* the account, and inventing a
   * `REALTIME_LIVEKIT_ACCOUNT` that could disagree with it would be a way for
   * an event from one project to be filed under another.
   */
  readonly account: string;

  readonly environment: string;

  /**
   * The SDK clients, also in real private fields.
   *
   * Not only the credentials: both of these hold the API key and the secret in
   * ordinary enumerable properties of their own, so a `private readonly` here
   * would have put the secret back into any serialization of this adapter
   * through them. `#` is what actually keeps it out.
   */
  readonly #rooms: RoomServiceClient;

  readonly #webhooks: WebhookReceiver;

  /**
   * The project's credentials, in real private fields rather than
   * TypeScript-private ones.
   *
   * `#` is enforced by the runtime and, decisively, is not enumerable: a
   * `JSON.stringify` of this adapter — in a log line, an error report, a
   * diagnostic dump — cannot contain the API secret, because there is no
   * property there to serialize. A `private readonly` field is a compile-time
   * annotation and would have been in every one of those. A unit test asserts
   * the serialization is clean.
   */
  readonly #apiKey: string;

  readonly #apiSecret: string;

  readonly #url: string;

  constructor(
    options: LiveKitRtcProviderOptions,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#apiKey = options.apiKey;
    this.#apiSecret = options.apiSecret;
    this.#url = options.url;
    const host = httpOriginOf(options.url);
    this.account = new URL(options.url).host;
    this.environment = host.startsWith('https://') ? 'cloud' : 'self-hosted';
    this.#rooms = new RoomServiceClient(
      host,
      options.apiKey,
      options.apiSecret,
    );
    this.#webhooks = new WebhookReceiver(options.apiKey, options.apiSecret);
  }

  /**
   * Where a client presents the credential this adapter mints.
   *
   * Published because a browser cannot connect without it and it is not a
   * secret — it is the project's public WebSocket address. The API key and the
   * secret are never exposed by this or any other member.
   */
  get clientEndpoint(): string {
    return this.#url;
  }

  async createSession(
    request: CreateRtcSessionRequest,
  ): Promise<RtcProviderSessionSnapshot> {
    const name = this.roomNameFor(request.providerIdempotencyKey);
    // Creating a room that already exists returns the existing one, so a retry
    // after an ambiguous outcome is one room rather than two. The idempotency
    // key deciding the name is what makes that true rather than hoped for.
    const room = await this.call(() =>
      this.#rooms.createRoom({
        departureTimeout: departureTimeoutSeconds,
        emptyTimeout: emptyRoomTimeoutSeconds,
        maxParticipants: maximumRoomParticipants,
        metadata: JSON.stringify({
          platformSessionReference: request.platformSessionReference,
        }),
        name,
      }),
    );
    return snapshotOf(room, request.platformSessionReference);
  }

  async retrieveByIdempotencyKey(
    providerIdempotencyKey: string,
  ): Promise<RtcProviderSessionSnapshot | undefined> {
    const name = this.roomNameFor(providerIdempotencyKey);
    const [room] = await this.call(() => this.#rooms.listRooms([name]));
    return room === undefined ? undefined : snapshotOf(room);
  }

  async retrieveCurrentState(
    providerReference: string,
  ): Promise<RtcProviderSessionSnapshot> {
    const [room] = await this.call(() =>
      this.#rooms.listRooms([providerReference]),
    );
    if (room === undefined) {
      // LiveKit removes a room once it is empty past its timeout, so "not
      // listed" is the normal end state and not an error. It is reported as
      // `unknown` rather than as `ended`, because this adapter cannot tell a
      // room that finished from one that never existed, and inventing the
      // difference would let a typo read as a completed call.
      return {
        platformSessionReference: '',
        providerReference,
        state: 'unknown',
      };
    }
    return snapshotOf(room);
  }

  async issueParticipantGrant(
    request: IssueRtcGrantRequest,
  ): Promise<RtcParticipantGrant> {
    const issuedAt = this.now();
    const token = new AccessToken(this.#apiKey, this.#apiSecret, {
      identity: request.participantReference,
      // No `name`. A display name would put a person's chosen name at a vendor
      // for no operational gain; the surface already knows who it is rendering.
      ttl: Math.max(1, Math.floor(request.ttlMilliseconds / 1000)),
    });
    token.addGrant({
      // Everything a participant may do, stated in full and positively, so a
      // future SDK default cannot quietly widen it.
      canPublish: true,
      // Voice-only sessions may publish a microphone and nothing else. The
      // provider enforces it, which is what stops a client that ignores the
      // product's own medium from sending video into a voice encounter.
      canPublishSources: publishableSourcesFor(request.medium),
      // The encounter's text and reactions are VELORA's, ordered by VELORA,
      // idempotent, bounded, and answerable when somebody reports them. A
      // provider data channel would be a second, unmoderated message path.
      canPublishData: false,
      canSubscribe: true,
      canUpdateOwnMetadata: false,
      hidden: false,
      recorder: false,
      room: request.providerReference,
      roomAdmin: false,
      roomCreate: false,
      roomJoin: true,
      roomList: false,
      roomRecord: false,
    });
    return {
      credential: await token.toJwt(),
      expiresAt: new Date(issuedAt.getTime() + request.ttlMilliseconds),
      participantReference: request.participantReference,
      providerReference: request.providerReference,
    };
  }

  async revokeParticipant(input: {
    readonly participantReference: string;
    readonly providerReference: string;
  }): Promise<void> {
    try {
      await this.call(() =>
        this.#rooms.removeParticipant(
          input.providerReference,
          input.participantReference,
          {
            // Kills every credential minted before this instant, not just the
            // connection. Without it a removed participant could rejoin with
            // the token they already held, and this platform's own
            // authorization generation would be the only thing stopping them —
            // which it is, but a bearer token the provider still honours is a
            // second door.
            revokeTokenTs: BigInt(Math.floor(this.now().getTime() / 1000)),
          },
        ),
      );
    } catch (error) {
      // A participant who has already disconnected, or a room LiveKit has
      // already collected, is the outcome this call was asking for. Treating it
      // as a failure would make an obligation that can never discharge.
      if (!isNotFound(error)) throw error;
    }
  }

  async endSession(providerReference: string): Promise<void> {
    try {
      await this.call(() => this.#rooms.deleteRoom(providerReference));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  /**
   * Authenticates a LiveKit callback over the exact bytes it arrived as.
   *
   * LiveKit signs a JWT carrying a SHA-256 of the body and sends it in the
   * `Authorization` header, so the receiver is handed the raw octets decoded
   * once as UTF-8 and never a re-serialized object — a signature checked
   * against a re-serialized body authenticates a different document than the
   * one that was sent.
   */
  async verifyEvent(input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
  }): Promise<VerifiedRtcProviderEvent> {
    const presented = input.headers.get(livekitAuthorizationHeader);
    if (presented === null) {
      throw new Error('livekit event is unsigned');
    }
    const event = await this.#webhooks.receive(
      new TextDecoder().decode(input.rawBody),
      presented,
    );

    const providerReference = event.room?.name;
    if (
      providerReference === undefined ||
      providerReference.length === 0 ||
      providerReference.length > maximumRtcProviderReferenceLength
    ) {
      throw new Error('livekit event names no usable room');
    }
    return {
      eventId: event.id,
      eventType: event.event,
      // LiveKit reports seconds. A provider's own clock, kept as the provider's
      // own clock: this is when the provider says the thing happened, and it is
      // never used as the platform's clock for anything.
      occurredAt: new Date(Number(event.createdAt) * 1000),
      participantReference: event.participant?.identity,
      snapshot: {
        platformSessionReference:
          platformReferenceOf(event.room?.metadata) ?? '',
        providerReference,
        state: livekitEventStates[event.event] ?? 'unknown',
      },
    };
  }

  /**
   * The opaque, deterministic name of the room carrying one session.
   *
   * An HMAC under the project's own API secret rather than a hash: a plain hash
   * of a UUID is reproducible by anybody who learns the UUID, and this must not
   * be. Truncated to 32 hexadecimal characters, which is 128 bits — the same
   * strength as the identifier it is derived from, and short enough to stay
   * well inside the provider-reference bound.
   */
  /**
   * Runs one server-API call and names a refused credential for what it is.
   *
   * Every operation here goes through it so that exactly one place in this
   * adapter knows what a LiveKit refusal looks like on the wire. The transport
   * status is the signal rather than the message text, because the message is a
   * vendor's prose and is the string somebody eventually matches on: LiveKit
   * answers `401 invalid token` when a key it recognises carries a signature it
   * cannot verify, and `401 invalid API key` when it does not recognise the key
   * at all. Both mean the same thing to this platform — the project will not
   * accept us — and neither is a state to reconcile.
   *
   * Nothing else is translated. A timeout, a 5xx, or a dropped connection stays
   * exactly what it was, because those genuinely leave the outcome unknown and
   * the orchestrator's recovery is the correct answer to them.
   */
  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isCredentialRefusal(error)) {
        throw new RtcProviderCredentialsRefusedError(this.account);
      }
      throw error;
    }
  }

  private roomNameFor(providerIdempotencyKey: string): string {
    const digest = createHmac('sha256', this.#apiSecret)
      .update(`velora:rtc-room:${providerIdempotencyKey}`)
      .digest('hex');
    return `v${digest.slice(0, 32)}`;
  }
}

/**
 * What a participant may send, decided by the encounter's medium.
 *
 * Screen sharing is absent from both, deliberately. Random live discovery is
 * two strangers looking at each other; a screen share is a way to put arbitrary
 * content in front of somebody who agreed to meet a person, and no moderation
 * position covers it.
 */
function publishableSourcesFor(medium: RtcCallMedium): number[] {
  // Numeric `TrackSource` values, from the LiveKit protocol enumeration:
  // 1 = camera, 2 = microphone. Written as literals rather than imported so a
  // protocol package bump cannot silently change what a grant permits without
  // this line changing too; `test/unit/rtc-livekit-provider.test.ts` asserts
  // each against the enumeration it mirrors.
  return medium === 'voice' ? [2] : [1, 2];
}

function snapshotOf(
  room: Room,
  fallbackPlatformReference?: string,
): RtcProviderSessionSnapshot {
  return {
    platformSessionReference:
      platformReferenceOf(room.metadata) ?? fallbackPlatformReference ?? '',
    providerReference: room.name,
    // A room LiveKit is prepared to list is one that exists. Whether anybody is
    // in it is a different question and is not what this field means: the
    // platform's own lifecycle decides when a call is live, and a provider
    // saying otherwise is a divergence to reconcile rather than a state to
    // adopt.
    state: room.numParticipants > 0 ? 'live' : 'pending',
  };
}

/**
 * The platform session reference carried in room metadata, or nothing.
 *
 * Everything about this is defensive on purpose: metadata is a string LiveKit
 * stores and returns, this platform is not the only thing that could ever write
 * one, and a malformed value must produce an absent reference rather than an
 * exception on a callback path. The orchestrator refuses a snapshot whose
 * reference does not match the session it asked about, so an absent one fails
 * closed.
 */
function platformReferenceOf(metadata: string | undefined): string | undefined {
  if (metadata === undefined || metadata.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const reference = (parsed as Record<string, unknown>)
    .platformSessionReference;
  return typeof reference === 'string' && reference.length > 0
    ? reference
    : undefined;
}

/**
 * The HTTP origin of a LiveKit project, from the WebSocket address it publishes.
 *
 * LiveKit publishes one address and its server API is reached over HTTP at the
 * same host. Deriving one from the other means there is a single configured
 * value that cannot disagree with itself, rather than two that can.
 */
function httpOriginOf(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'ws:' ? 'http:' : 'https:';
  return parsed.origin;
}

/**
 * Whether a provider refusal was about this platform's credentials.
 *
 * `401` is the project declining to authenticate us and `403` is it declining
 * to authorize what an authenticated key asked for; both are definite answers
 * about the credential rather than about the call, and both are worth telling
 * an operator apart from a transport that simply did not answer.
 */
function isCredentialRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { readonly status?: unknown }).status;
  return status === 401 || status === 403;
}

/**
 * Whether a provider refusal means "it is already not there".
 *
 * Matched on the transported status rather than on a message, because a message
 * is a vendor's prose and is exactly the string somebody eventually matched on.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { readonly status?: unknown }).status;
  const code = (error as { readonly code?: unknown }).code;
  return status === 404 || code === 'not_found';
}

/**
 * Constant-time equality for two credentials, exported for the contract test
 * that proves a minted token is bound to exactly one room.
 *
 * Kept here rather than written inline in the test so the comparison a test
 * makes about a secret is the same shape as every other comparison this
 * repository makes about one.
 */
export function credentialsEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
