/**
 * A stand-in for the VELORA API, for the mobile surface.
 *
 * It answers the real contract paths with real contract shapes and holds state,
 * so a test can drive a launch, a foreground, an offline period, and a retry,
 * and watch the app react to answers a server would actually give. It is
 * installed as a `fetch` implementation, so everything under test goes through
 * the generated client exactly as it would on a device.
 *
 * It is deliberately not the web double. These are different surfaces with
 * different transports — a bearer token here, a cookie there — and a fixture
 * shared between them would quietly stop proving that.
 */

export interface MobileApiState {
  account: { createdAt: string; id: string; status: string } | null;
  availability: {
    availableUntil?: string;
    effectiveState: 'available' | 'unavailable';
    state: 'available' | 'unavailable';
    updatedAt: string;
  };
  appeals: {
    id: string;
    decisionId: string;
    state: string;
    submittedAt: string;
  }[];
  blocks: { blockedId: string; createdAt: string }[];
  /**
   * What the media platform answers when a reference is exchanged for an
   * address.
   *
   * `granted` is the default because it is what a configured environment does,
   * and because a double that never served an image would leave the photograph
   * path on every screen untested. `unavailable` is the deployed-environment
   * answer — no approved delivery provider — and `declined` is a platform that
   * serves this device nothing without saying why.
   */
  mediaDelivery: 'granted' | 'declined' | 'unavailable';
  candidates: {
    bio?: string;
    displayName: string;
    id: string;
    media: { id: string; position: number }[];
    region?: string;
    sharedLanguages: string[];
  }[];
  conversations: {
    counterpart: {
      displayName: string;
      id: string;
      media: { id: string; position: number }[];
    };
    createdAt: string;
    id: string;
    lastActivityAt: string;
    lastMessage?: {
      bodyPreview: string;
      createdAt: string;
      sender: 'caller' | 'counterpart';
      sequence: number;
    };
    lastMessageSequence: number;
    lastReadSequence: number;
    relationship: {
      introductionId: string;
      kind: 'mutual_introduction';
    };
    state: 'active' | 'closed';
  }[];
  messages: {
    body: string;
    clientMessageId: string;
    conversationId: string;
    createdAt: string;
    id: string;
    senderId: string;
    sequence: number;
  }[];
  /**
   * The pair's call, if there is one.
   *
   * Singular, because the server allows one live call per pair: a second
   * invitation while one is live returns that one rather than opening another.
   */
  call: {
    acceptedAt?: string;
    counterpart: { displayName: string; id: string };
    createdAt: string;
    endReason?: string;
    endedAt?: string;
    id: string;
    invitationExpiresAt: string;
    medium: 'voice' | 'video';
    role: 'caller' | 'recipient';
    state: string;
  } | null;
  introductions: {
    counterpart: {
      displayName: string;
      id: string;
      media: { id: string; position: number }[];
      sharedLanguages: string[];
    };
    createdAt: string;
    id: string;
    mutualAt?: string;
    role: 'initiator' | 'recipient';
    state: 'pending' | 'mutual' | 'closed';
  }[];
  notifications: {
    callId?: string;
    conversationId?: string;
    createdAt: string;
    id: string;
    kind: string;
    readAt?: string;
    subjectId: string;
  }[];
  onboarding: {
    adultAssurance: string;
    adultAssuranceRefused: boolean;
    outstandingPolicies: { key: string; version: string }[];
    outstandingProfile: string[];
    step: string;
  } | null;
  /** When true every request fails as if the device were offline. */
  offline: boolean;
  profile: {
    complete: boolean;
    discoverable: boolean;
    displayName?: string;
    languages: string[];
    media: {
      id: string;
      position: number;
      state: string;
      uploadExpiresAt: string;
    }[];
    outstandingRequirements: string[];
    version?: number;
  } | null;
  /**
   * Every push registration the server currently holds, keyed by installation.
   * The real endpoint treats a repeat registration of the same token as a
   * heartbeat rather than a second device, and this does the same.
   */
  pushDevices: Map<string, { platform: string; token: string }>;
  /**
   * When false, asking for an upload capability refuses the way an environment
   * with no approved storage provider refuses.
   */
  storageAvailable: boolean;
  /** When false the API refuses every credential, as an ended session does. */
  notificationPreferences: {
    category: string;
    channel: string;
    enabled: boolean;
  }[];
  reports: { createdAt: string; id: string; state: string }[];
  sessionLive: boolean;
  standing: {
    appealWindowClosesAt?: string;
    appealable: boolean;
    decisionId: string;
    reasonCode: string;
    scope: string;
  }[];
}

export interface MobileApiDouble {
  readonly authorizations: (string | null)[];
  readonly calls: { body: unknown; method: string; path: string }[];
  readonly fetch: typeof globalThis.fetch;
  failNext(path: string): void;
  refuseNext(path: string, status: number, code: string): void;
  readonly state: MobileApiState;
}

export const ownAccountId = '11111111-1111-4111-8111-111111111111';
export const otherPersonId = '22222222-2222-4222-8222-222222222222';
export const conversationId = '33333333-3333-4333-8333-333333333333';
export const introductionId = '55555555-5555-4555-8555-555555555555';
export const callId = '66666666-6666-4666-8666-666666666666';

const iso = (offset = 0) =>
  new Date(Date.UTC(2026, 7, 14, 12, 0, 0) + offset).toISOString();

/** Mirrors the server's own live-state set. */
const liveCallStates = new Set([
  'invited',
  'accepted',
  'connecting',
  'active',
  'reconnecting',
  'ending',
]);

/** Only an answered, still-live call admits anybody. */
const joinableCallStates = new Set([
  'accepted',
  'connecting',
  'active',
  'reconnecting',
]);

/**
 * Which action moves a call where, and who may take it.
 *
 * Both the role and the origin state are enforced, because both are what the
 * server enforces: only a recipient answers or declines, only a caller
 * withdraws, and nothing at all moves a call that has already finished.
 */
const callTransitions: Readonly<
  Record<
    string,
    {
      readonly from: ReadonlySet<string>;
      readonly next: string;
      readonly reason?: string;
      readonly role?: 'caller' | 'recipient';
    }
  >
> = {
  '/v1/rtc/calls/acceptance': {
    from: new Set(['invited']),
    next: 'accepted',
    role: 'recipient',
  },
  '/v1/rtc/calls/cancellation': {
    from: new Set(['invited']),
    next: 'cancelled',
    reason: 'withdrawn',
    role: 'caller',
  },
  '/v1/rtc/calls/rejection': {
    from: new Set(['invited']),
    next: 'rejected',
    reason: 'declined',
    role: 'recipient',
  },
  '/v1/rtc/calls/termination': {
    from: new Set([
      'accepted',
      'connecting',
      'active',
      'reconnecting',
      'ending',
    ]),
    next: 'ended',
    reason: 'hung_up',
  },
};

export function admittedState(): MobileApiState {
  return {
    account: { createdAt: iso(), id: ownAccountId, status: 'active' },
    availability: {
      effectiveState: 'unavailable',
      state: 'unavailable',
      updatedAt: iso(),
    },
    appeals: [],
    blocks: [],
    mediaDelivery: 'granted',
    candidates: [
      {
        displayName: 'Robin',
        id: otherPersonId,
        media: [],
        sharedLanguages: ['es'],
      },
    ],
    conversations: [
      {
        counterpart: { displayName: 'Robin', id: otherPersonId, media: [] },
        createdAt: iso(),
        id: conversationId,
        lastActivityAt: iso(),
        lastMessageSequence: 0,
        lastReadSequence: 0,
        relationship: {
          introductionId,
          kind: 'mutual_introduction',
        },
        state: 'active',
      },
    ],
    call: null,
    introductions: [],
    messages: [],
    notifications: [],
    offline: false,
    onboarding: {
      adultAssurance: 'self_declared',
      adultAssuranceRefused: false,
      outstandingPolicies: [],
      outstandingProfile: [],
      step: 'completed',
    },
    profile: {
      complete: true,
      discoverable: true,
      displayName: 'Alex',
      languages: ['es'],
      media: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          position: 0,
          state: 'ready',
          uploadExpiresAt: iso(3_600_000),
        },
      ],
      outstandingRequirements: [],
      version: 1,
    },
    notificationPreferences: [
      { category: 'direct_message', channel: 'push', enabled: true },
      { category: 'account_security', channel: 'email', enabled: true },
    ],
    pushDevices: new Map(),
    reports: [],
    sessionLive: true,
    standing: [],
    storageAvailable: true,
  };
}

export function createMobileApiDouble(
  initial: MobileApiState = admittedState(),
): MobileApiDouble {
  const state = initial;
  const calls: { body: unknown; method: string; path: string }[] = [];
  const authorizations: (string | null)[] = [];
  const failures = new Map<string, number>();
  const refusals = new Map<string, { code: string; status: number }>();
  let sequence = 0;
  let generation = 0;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      status,
    });
  const error = (status: number, code: string) =>
    json(status, { code, correlationId: 'test', message: 'Request failed' });

  /**
   * Never the token and never the installation. The contract publishes neither,
   * and echoing a token back would put a bearer credential into a response
   * body, a log, and a proxy cache.
   */
  const pushDeviceList = () =>
    [...state.pushDevices.values()].map((device, index) => ({
      deviceId: `7777777${String(index)}-7777-4777-8777-777777777777`,
      lastSeenAt: iso(),
      platform: device.platform,
      registeredAt: iso(),
    }));

  const tokens = () => {
    generation += 1;
    return {
      accessToken: `access-${String(generation)}`,
      // Long enough that no test rotates by accident.
      accessTokenExpiresAt: iso(3_600_000),
      accountId: ownAccountId,
      assurance: 'single_factor',
      audience: 'consumer_mobile',
      refreshToken: `refresh-${String(generation)}`,
      refreshTokenAbsoluteExpiresAt: iso(90 * 86_400_000),
      refreshTokenIdleExpiresAt: iso(30 * 86_400_000),
    };
  };

  const handler: typeof globalThis.fetch = async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(input instanceof URL ? input.href : input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const raw = await request.clone().text();
    const body = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
    calls.push({ body, method, path });
    authorizations.push(request.headers.get('authorization'));

    if (state.offline) throw new TypeError('network request failed');
    if ((failures.get(path) ?? 0) > 0) {
      failures.set(path, (failures.get(path) ?? 0) - 1);
      throw new TypeError('network request failed');
    }
    const refusal = refusals.get(path);
    if (refusal !== undefined) {
      refusals.delete(path);
      return error(refusal.status, refusal.code);
    }
    if (request.signal.aborted) throw new DOMException('aborted');

    if (path === '/v1/auth/local/mobile-sessions') {
      state.sessionLive = true;
      return json(201, tokens());
    }
    if (path === '/v1/auth/mobile/refresh') {
      return state.sessionLive
        ? json(200, tokens())
        : error(401, 'AUTH_REFRESH_INVALID');
    }
    if (path === '/v1/auth/logout' || path === '/v1/auth/logout-all') {
      state.sessionLive = false;
      return json(200, { acknowledged: true });
    }

    // MEDIA. Reachable without a credential, exactly as the contract publishes
    // it; what an absent one changes is which assets come back, not whether the
    // call is answered.
    if (path === '/v1/media/deliveries' && method === 'POST') {
      if (state.mediaDelivery === 'unavailable') {
        return error(503, 'DEPENDENCY_UNAVAILABLE');
      }
      const asked = (body as { assetIds?: string[] } | undefined)?.assetIds;
      return json(200, {
        deliveries:
          state.mediaDelivery === 'declined'
            ? []
            : (asked ?? []).map((assetId) => ({
                assetId,
                // Real time rather than the fixture clock. Every other value a
                // double produces is content a test asserts against; this one
                // is a deadline the client compares to its own clock, so a
                // fixed instant would arrive already expired.
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                url: `https://media.test/${assetId}`,
              })),
      });
    }

    // Every product route is bearer-authenticated. A request with no token, or
    // one made after the session ended, is refused exactly as the server does.
    const authorization = request.headers.get('authorization');
    if (authorization === null || !state.sessionLive) {
      return error(401, 'AUTH_REQUIRED');
    }

    if (path === '/v1/auth/session') {
      return json(200, {
        absoluteExpiresAt: iso(86_400_000),
        accountId: ownAccountId,
        assurance: 'single_factor',
        assuranceEstablishedAt: iso(),
        audience: 'consumer_mobile',
        authenticatedAt: iso(),
        idleExpiresAt: iso(3_600_000),
      });
    }
    if (path === '/v1/users' && method === 'POST') {
      state.account = {
        createdAt: iso(),
        id: ownAccountId,
        status: 'pending_profile',
      };
      state.onboarding = {
        adultAssurance: 'none',
        adultAssuranceRefused: false,
        outstandingPolicies: [],
        outstandingProfile: [],
        step: 'adult_declaration',
      };
      return json(201, state.account);
    }
    if (state.account === null) return error(404, 'RESOURCE_NOT_FOUND');
    if (path === '/v1/users/me') return json(200, state.account);
    if (path === '/v1/users/me/onboarding') {
      return json(200, { account: state.account, ...state.onboarding });
    }
    if (path === '/v1/users/me/onboarding/adult-declaration') {
      state.onboarding = {
        adultAssurance: 'self_declared',
        adultAssuranceRefused: false,
        outstandingPolicies: [
          { key: 'terms_of_service', version: '2026-01-01' },
        ],
        outstandingProfile: [],
        step: 'policy_acknowledgement',
      };
      return json(200, { account: state.account, ...state.onboarding });
    }
    if (path === '/v1/users/me/profile' && method === 'GET') {
      return json(
        200,
        state.profile ?? {
          complete: false,
          discoverable: false,
          languages: [],
          media: [],
          outstandingRequirements: ['display_name', 'ready_media'],
        },
      );
    }
    if (path === '/v1/users/me/profile' && method === 'POST') {
      const input = body as {
        bio?: string;
        displayName: string;
        expectedVersion?: number;
        languages: string[];
      };
      if (
        state.profile !== null &&
        (input.expectedVersion === undefined ||
          input.expectedVersion !== state.profile.version)
      ) {
        return error(409, 'STATE_CONFLICT');
      }
      if (state.profile === null && input.expectedVersion !== undefined) {
        return error(409, 'STATE_CONFLICT');
      }
      state.profile = {
        complete: true,
        discoverable: state.profile?.discoverable ?? false,
        displayName: input.displayName,
        ...(input.bio === undefined ? {} : { bio: input.bio }),
        languages: input.languages,
        media: state.profile?.media ?? [],
        outstandingRequirements: [],
        version: (state.profile?.version ?? 0) + 1,
      };
      state.account = { ...state.account, status: 'active' };
      state.onboarding = {
        adultAssurance: 'self_declared',
        adultAssuranceRefused: false,
        outstandingPolicies: [],
        outstandingProfile: [],
        step: 'completed',
      };
      return json(200, state.profile);
    }
    if (path === '/v1/users/me/availability' && method === 'GET') {
      return json(200, state.availability);
    }
    if (path === '/v1/users/me/availability' && method === 'POST') {
      const input = body as {
        availableUntil?: string;
        state: 'available' | 'unavailable';
      };
      state.availability = {
        ...(input.availableUntil === undefined
          ? {}
          : { availableUntil: input.availableUntil }),
        effectiveState: input.state,
        state: input.state,
        updatedAt: iso(),
      };
      return json(200, state.availability);
    }
    if (path === '/v1/discovery/people' && method === 'GET') {
      const wanted = url.searchParams.get('personId');
      const found = state.candidates.find((one) => one.id === wanted);
      return found === undefined
        ? error(404, 'RESOURCE_NOT_FOUND')
        : json(200, { ...found });
    }
    if (path === '/v1/discovery/candidates') {
      return json(200, {
        candidates: state.candidates,
        rankingVersion: 'test',
      });
    }
    if (path === '/v1/discovery/passes') {
      const input = body as { candidateId: string };
      state.candidates = state.candidates.filter(
        (candidate) => candidate.id !== input.candidateId,
      );
      return json(200, { suppressedUntil: iso(86_400_000) });
    }
    if (path === '/v1/discovery/introductions' && method === 'GET') {
      return json(200, { introductions: state.introductions });
    }
    /*
     * Signalling interest. The server records one signal per pair and only
     * publishes a mutual introduction when both sides have signalled, so the
     * answer here is `pending` for a first signal and `mutual` for a second —
     * and the candidate leaves the feed either way, because a decision has been
     * made about them.
     */
    if (path === '/v1/discovery/introductions' && method === 'POST') {
      const input = body as { candidateId: string };
      const existing = state.introductions.find(
        (row) => row.counterpart.id === input.candidateId,
      );
      const introduction =
        existing === undefined
          ? {
              counterpart: {
                displayName:
                  state.candidates.find(
                    (candidate) => candidate.id === input.candidateId,
                  )?.displayName ?? 'Somebody',
                id: input.candidateId,
                media: [],
                sharedLanguages: [],
              },
              createdAt: iso(),
              id: introductionId,
              role: 'initiator' as const,
              state: 'pending' as const,
            }
          : { ...existing, state: 'mutual' as const };
      state.introductions = [
        ...state.introductions.filter(
          (row) => row.counterpart.id !== input.candidateId,
        ),
        introduction,
      ];
      state.candidates = state.candidates.filter(
        (candidate) => candidate.id !== input.candidateId,
      );
      return json(200, introduction);
    }
    if (path === '/v1/discovery/introductions/decline' && method === 'POST') {
      const input = body as { introductionId: string };
      const existing = state.introductions.find(
        (row) => row.id === input.introductionId,
      );
      if (existing === undefined) return error(404, 'HTTP_404');
      const withdrawn = { ...existing, state: 'withdrawn' as const };
      state.introductions = state.introductions.filter(
        (row) => row.id !== input.introductionId,
      );
      return json(200, withdrawn);
    }

    // REALTIME. Role, origin state, and one-live-call-per-pair are all
    // enforced, because they are what the server enforces; a double that let a
    // caller answer their own call would prove the surface handles a case that
    // cannot happen.
    if (path === '/v1/rtc/calls' && method === 'GET') {
      const callId = url.searchParams.get('callId');
      return state.call?.id === callId
        ? json(200, state.call)
        : error(404, 'RESOURCE_NOT_FOUND');
    }
    if (path === '/v1/rtc/calls' && method === 'POST') {
      const input = body as {
        introductionId: string;
        medium: 'voice' | 'video';
      };
      const introduction = state.introductions.find(
        (entry) =>
          entry.id === input.introductionId && entry.state === 'mutual',
      );
      if (introduction === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      if (state.call !== null && liveCallStates.has(state.call.state)) {
        return json(200, state.call);
      }
      state.call = {
        counterpart: {
          displayName: introduction.counterpart.displayName,
          id: introduction.counterpart.id,
        },
        createdAt: iso(),
        id: callId,
        invitationExpiresAt: iso(45_000),
        medium: input.medium,
        role: 'caller',
        state: 'invited',
      };
      return json(200, state.call);
    }
    if (path.startsWith('/v1/rtc/calls/') && method === 'POST') {
      const input = body as { callId: string };
      if (state.call?.id !== input.callId) {
        return error(404, 'RESOURCE_NOT_FOUND');
      }
      if (path === '/v1/rtc/calls/join-authorization') {
        if (!joinableCallStates.has(state.call.state)) {
          return error(409, 'CONFLICT');
        }
        return json(200, {
          callId: state.call.id,
          // Per-issuance. A fixed string would let a surface that cached one
          // still pass.
          credential: `join-${String(calls.length)}`,
          expiresAt: iso(120_000),
          medium: state.call.medium,
        });
      }
      const transition = callTransitions[path];
      if (transition === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      // A finished call answers with itself however many times it is asked.
      if (!liveCallStates.has(state.call.state)) return json(200, state.call);
      if (!transition.from.has(state.call.state)) return error(409, 'CONFLICT');
      if (
        transition.role !== undefined &&
        state.call.role !== transition.role
      ) {
        return error(409, 'CONFLICT');
      }
      state.call = {
        ...state.call,
        ...(transition.next === 'accepted' ? { acceptedAt: iso() } : {}),
        ...(transition.reason === undefined
          ? {}
          : { endReason: transition.reason, endedAt: iso() }),
        state: transition.next,
      };
      return json(200, state.call);
    }
    if (path === '/v1/messaging/conversations' && method === 'GET') {
      return json(200, { conversations: state.conversations });
    }
    if (path === '/v1/messaging/conversations/read') {
      const input = body as { conversationId: string; sequence: number };
      state.conversations = state.conversations.map((conversation) =>
        conversation.id === input.conversationId
          ? {
              ...conversation,
              lastReadSequence: Math.max(
                conversation.lastReadSequence,
                input.sequence,
              ),
            }
          : conversation,
      );
      return json(200, {
        conversationId: input.conversationId,
        lastReadSequence: input.sequence,
      });
    }
    if (path === '/v1/messaging/messages' && method === 'GET') {
      return json(200, {
        conversationId: url.searchParams.get('conversationId'),
        messages: [...state.messages].reverse(),
      });
    }
    if (path === '/v1/messaging/messages' && method === 'POST') {
      const input = body as {
        body: string;
        clientMessageId: string;
        conversationId: string;
      };
      // Idempotent by client message identifier, exactly as the server is: a
      // retry after a lost response produces the message that already exists.
      const existing = state.messages.find(
        (message) => message.clientMessageId === input.clientMessageId,
      );
      if (existing !== undefined) return json(200, existing);
      sequence += 1;
      const message = {
        ...input,
        createdAt: iso(sequence * 1_000),
        id: `55555555-5555-4555-8555-${String(sequence).padStart(12, '0')}`,
        senderId: ownAccountId,
        sequence,
      };
      state.messages = [...state.messages, message];
      state.conversations = state.conversations.map((conversation) =>
        conversation.id === input.conversationId
          ? {
              ...conversation,
              lastActivityAt: message.createdAt,
              lastMessage: {
                bodyPreview: input.body
                  .replace(/\s+/gu, ' ')
                  .trim()
                  .slice(0, 160),
                createdAt: message.createdAt,
                sender: 'caller' as const,
                sequence: message.sequence,
              },
              lastMessageSequence: message.sequence,
            }
          : conversation,
      );
      return json(200, message);
    }
    if (path === '/v1/notifications' && method === 'GET') {
      const requestedPageSize = Number(url.searchParams.get('pageSize') ?? 20);
      const rawCursor = url.searchParams.get('cursor');
      const offset = rawCursor?.startsWith('offset-')
        ? Number(rawCursor.slice('offset-'.length))
        : 0;
      const end = offset + requestedPageSize;
      return json(200, {
        ...(end < state.notifications.length
          ? { nextCursor: `offset-${String(end)}` }
          : {}),
        notifications: state.notifications.slice(offset, end),
      });
    }
    if (path === '/v1/notifications/read') {
      const input = body as { notificationIds: string[] };
      const readIds: string[] = [];
      state.notifications = state.notifications.map((entry) => {
        if (!input.notificationIds.includes(entry.id)) return entry;
        if (entry.readAt !== undefined) return entry;
        readIds.push(entry.id);
        return { ...entry, readAt: iso() };
      });
      return json(200, { readIds });
    }
    if (path === '/v1/safety/blocks' && method === 'GET') {
      return json(200, { blocks: state.blocks });
    }
    if (path === '/v1/safety/blocks' && method === 'POST') {
      const input = body as { targetId: string };
      state.blocks = [
        ...state.blocks,
        { blockedId: input.targetId, createdAt: iso() },
      ];
      state.candidates = state.candidates.filter(
        (candidate) => candidate.id !== input.targetId,
      );
      return json(200, { blockedId: input.targetId, createdAt: iso() });
    }
    if (path === '/v1/safety/blocks/removal' && method === 'POST') {
      const input = body as { targetId: string };
      const removed = state.blocks.find(
        (block) => block.blockedId === input.targetId,
      );
      state.blocks = state.blocks.filter(
        (block) => block.blockedId !== input.targetId,
      );
      return json(
        200,
        removed ?? { blockedId: input.targetId, createdAt: iso() },
      );
    }
    if (path === '/v1/safety/standing' && method === 'GET') {
      return json(200, { statements: state.standing });
    }
    if (path === '/v1/safety/appeals' && method === 'GET') {
      return json(200, { appeals: state.appeals });
    }
    if (path === '/v1/safety/reports' && method === 'GET') {
      return json(200, { nextCursor: undefined, reports: state.reports });
    }
    if (path === '/v1/notifications/preferences' && method === 'GET') {
      return json(200, { preferences: state.notificationPreferences });
    }
    if (path === '/v1/notifications/preferences' && method === 'POST') {
      const input = body as {
        category: string;
        channel: string;
        enabled: boolean;
      };
      state.notificationPreferences = state.notificationPreferences.map(
        (preference) =>
          preference.category === input.category &&
          preference.channel === input.channel
            ? { ...preference, enabled: input.enabled }
            : preference,
      );
      return json(200, { preferences: state.notificationPreferences });
    }
    if (path === '/v1/safety/reports' && method === 'POST') {
      const input = body as {
        reasonCode: string;
        target: { readonly type: string };
      };
      return json(200, {
        createdAt: iso(),
        id: '66666666-6666-4666-8666-666666666666',
        reasonCode: input.reasonCode,
        state: 'received',
        targetType: input.target.type,
      });
    }

    if (path === '/v1/users/me/profile/media' && method === 'POST') {
      if (!state.storageAvailable) {
        return error(503, 'DEPENDENCY_UNAVAILABLE');
      }
      state.profile ??= {
        complete: false,
        discoverable: false,
        languages: [],
        media: [],
        outstandingRequirements: [],
      };
      const slot = state.profile.media.length;
      const mediaId = `5555555${String(slot)}-5555-4555-8555-555555555555`;
      state.profile.media.push({
        id: mediaId,
        position: slot,
        state: 'pending_upload',
        uploadExpiresAt: iso(600_000),
      });
      return json(201, {
        expiresAt: iso(600_000),
        maximumBytes: 8_388_608,
        mediaId,
        method: 'PUT',
        // A stand-in address. No test inspects it, which is the point: a
        // storage address is provider detail and never product state.
        uploadHeaders: { 'content-type': 'application/octet-stream' },
        uploadUrl: 'http://storage.test/upload/object',
      });
    }
    if (path === '/v1/users/me/profile/media/completion' && method === 'POST') {
      const input = body as { readonly mediaId: string };
      const slot = state.profile?.media.find(
        (item) => item.id === input.mediaId,
      );
      // The platform inspects the object; the client never declares anything.
      if (slot !== undefined) slot.state = 'checking';
      return json(200, state.profile);
    }
    if (path === '/v1/users/me/profile/media/removal' && method === 'POST') {
      const input = body as { readonly mediaId: string };
      const slot = state.profile?.media.find(
        (item) => item.id === input.mediaId,
      );
      if (slot !== undefined) slot.state = 'removed';
      return json(200, state.profile);
    }

    if (path === '/v1/notifications/devices' && method === 'POST') {
      const input = body as {
        readonly installationId: string;
        readonly platform: string;
        readonly token: string;
      };
      state.pushDevices.set(input.installationId, {
        platform: input.platform,
        token: input.token,
      });
      return json(200, { devices: pushDeviceList() });
    }
    if (path === '/v1/notifications/devices/revocations' && method === 'POST') {
      const input = body as { readonly installationId: string };
      state.pushDevices.delete(input.installationId);
      return json(200, { devices: pushDeviceList() });
    }

    return error(404, 'HTTP_404');
  };

  return {
    authorizations,
    calls,
    failNext(path) {
      failures.set(path, (failures.get(path) ?? 0) + 1);
    },
    fetch: handler,
    refuseNext(path, status, code) {
      refusals.set(path, { code, status });
    },
    state,
  };
}
