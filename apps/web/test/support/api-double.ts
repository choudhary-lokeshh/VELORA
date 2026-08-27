/**
 * A stand-in for the VELORA API.
 *
 * It answers the real contract paths with real contract shapes, and it holds
 * state, so a test can drive the whole consumer journey — sign in, admission,
 * discovery, a message, a block — and watch the surface react to answers a
 * server would actually give.
 *
 * It is deliberately not a mock inside a component. Nothing in `src/` knows
 * this file exists; it is installed as a `fetch` implementation, so the surface
 * under test goes through the generated client, the same request bodies, and
 * the same status codes it would in production. A component that only worked
 * against a hand-written stub would prove nothing.
 */

export interface ApiDoubleState {
  /**
   * What the server says this person is paying for, held as the wire shape so
   * a test asserts what the server said rather than what the double decided.
   */
  subscriptions: {
    amount: { amountMinor: string; currency: string };
    cancelledAt?: string;
    createdAt: string;
    currentPeriodEnd?: string;
    id: string;
    interval?: 'month' | 'year';
    offerId: string;
    resource?: { id: string; type: 'club' | 'gift' };
    state: string;
  }[];
  /** Charges and near-charges, as the payment history route publishes them. */
  payments: {
    amount: { amountMinor: string; currency: string };
    createdAt: string;
    failureReason?: string;
    id: string;
    offerId: string;
    resource?: { id: string; type: 'club' | 'gift' };
    state: string;
    updatedAt: string;
  }[];
  /**
   * What creators sell, keyed by handle, exactly as the two owning domains
   * publish it: PRIVATE CLUBS says what a club is, BILLING says what it costs
   * against the same opaque identifier, and the surface joins the two.
   */
  publicClubs: Record<
    string,
    {
      benefits: string[];
      description?: string;
      id: string;
      membership?: { grantedAt: string; source: string };
      name: string;
      slug: string;
    }[]
  >;
  membershipOffers: Record<
    string,
    {
      gates?: string[];
      offers: {
        id: string;
        mode: 'subscription' | 'one_time';
        prices: {
          amount: { amountMinor: string; currency: string };
          id: string;
          interval?: 'month' | 'year';
        }[];
        resource: { id: string; type: 'club' | 'gift' };
      }[];
      readiness: {
        currencies: string[];
        enabled: boolean;
        intervals: string[];
        modes: string[];
        source: string;
      };
    }
  >;
  account: {
    createdAt: string;
    id: string;
    status: string;
  } | null;
  availability: {
    availableUntil?: string;
    effectiveState: 'available' | 'unavailable';
    state: 'available' | 'unavailable';
    updatedAt: string;
  };
  blocks: { blockedId: string; createdAt: string }[];
  /**
   * What the media platform answers when a reference is exchanged for an
   * address.
   *
   * `granted` is the default because it is what a configured environment does,
   * and because a double that never served an image would leave every surface's
   * photograph path untested. `unavailable` is the deployed-environment answer —
   * no approved delivery provider — and `declined` is a platform that serves
   * nothing to this viewer without saying why.
   */
  mediaDelivery: 'granted' | 'declined' | 'unavailable';
  /** Published creator pages, as the public directory lists them. */
  creatorDirectory: {
    avatar?: { id: string };
    bio?: string;
    displayName: string;
    handle: string;
  }[];
  /** Private clubs the account may currently read, and the invitations it may use. */
  clubAccess: {
    clubId: string;
    clubName: string;
    clubSlug: string;
    creatorHandle: string;
    endedAt?: string;
    grantedAt: string;
    source: string;
    state: 'active' | 'revoked';
  }[];
  /** One club as its own destination, keyed by `handle/slug`. */
  clubDetails: Record<
    string,
    {
      club: {
        benefits: string[];
        description?: string;
        id: string;
        membership?: { grantedAt: string; source: string };
        name: string;
        slug: string;
      };
      content: {
        body?: string;
        id: string;
        media: { id: string; position: number }[];
        publishedAt: string;
        summary?: string;
        title: string;
      }[];
      creatorHandle: string;
    }
  >;
  /** Invitations the double will honour, each exactly once. */
  clubInvites: {
    clubId: string;
    clubName: string;
    clubSlug: string;
    creatorHandle: string;
    secret: string;
  }[];
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
   * Singular rather than a list, because the server enforces one live call per
   * pair: a second invitation while one is live returns the existing call
   * rather than opening a second. A double holding an array would let a test
   * pass against behaviour the server does not have.
   */
  call: {
    acceptedAt?: string;
    connectedAt?: string;
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
  /** Category and channel pairs the server says are settable. */
  notificationPreferences: {
    category: string;
    channel: string;
    enabled: boolean;
  }[];
  notifications: {
    callId?: string;
    conversationId?: string;
    createdAt: string;
    id: string;
    introductionId?: string;
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
    preferencesVersion?: number;
    version?: number;
  } | null;
  reports: {
    createdAt: string;
    id: string;
    reasonCode: string;
    state: string;
    subjectId: string;
  }[];
  /** Complaints the account has made about decisions. */
  appeals: {
    decisionId: string;
    id: string;
    state: string;
    submittedAt: string;
  }[];
  /** What the server says is currently in force against the account. */
  statements: {
    appealable: boolean;
    decidedAt: string;
    decisionId: string;
    reasonCode: string;
    scope: string;
  }[];
  session: {
    absoluteExpiresAt: string;
    accountId: string;
    assurance: string;
    assuranceEstablishedAt: string;
    audience: string;
    authenticatedAt: string;
    idleExpiresAt: string;
  } | null;
}

export interface ApiDouble {
  /** Every request the surface made, so a test can assert what it did not do. */
  readonly calls: { body: unknown; method: string; path: string }[];
  /** Forces the next matching request to fail as if the network were gone. */
  failNext(path: string, method: 'GET' | 'POST'): void;
  readonly fetch: typeof globalThis.fetch;
  /** Forces the next matching request to be refused with this product code. */
  refuseNext(
    path: string,
    method: 'GET' | 'POST',
    status: number,
    code: string,
  ): void;
  readonly state: ApiDoubleState;
}

const iso = (offsetMilliseconds = 0) =>
  new Date(Date.UTC(2026, 7, 14, 12, 0, 0) + offsetMilliseconds).toISOString();

export const otherPersonId = '22222222-2222-4222-8222-222222222222';
export const ownAccountId = '11111111-1111-4111-8111-111111111111';

export function emptyState(): ApiDoubleState {
  return {
    subscriptions: [],
    payments: [],
    publicClubs: {},
    membershipOffers: {},
    account: null,
    call: null,
    availability: {
      effectiveState: 'unavailable',
      state: 'unavailable',
      updatedAt: iso(),
    },
    blocks: [],
    creatorDirectory: [],
    mediaDelivery: 'granted',
    clubAccess: [],
    clubDetails: {},
    clubInvites: [],
    candidates: [],
    conversations: [],
    introductions: [],
    messages: [],
    notificationPreferences: [
      { category: 'direct_message', channel: 'push', enabled: true },
      { category: 'introduction', channel: 'push', enabled: true },
    ],
    notifications: [],
    onboarding: null,
    profile: null,
    appeals: [],
    reports: [],
    session: null,
    statements: [],
  };
}

/** A signed-in, fully admitted account with one candidate to look at. */
export function admittedState(): ApiDoubleState {
  return {
    ...emptyState(),
    account: { createdAt: iso(), id: ownAccountId, status: 'active' },
    candidates: [
      {
        bio: 'Likes long walks and short queues.',
        displayName: 'Robin',
        id: otherPersonId,
        media: [{ id: '33333333-3333-4333-8333-333333333333', position: 0 }],
        region: 'ES',
        sharedLanguages: ['es'],
      },
    ],
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
      preferencesVersion: 1,
      version: 1,
    },
    appeals: [],
    call: null,
    reports: [],
    statements: [],
    session: {
      absoluteExpiresAt: iso(86_400_000),
      accountId: ownAccountId,
      assurance: 'single_factor',
      assuranceEstablishedAt: iso(),
      audience: 'consumer_web',
      authenticatedAt: iso(),
      idleExpiresAt: iso(3_600_000),
    },
  };
}

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
 * Role and origin state are both enforced, because they are what the server
 * enforces: only a recipient answers or declines, only a caller withdraws, and
 * nothing at all moves a call that has already finished.
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

export function createApiDouble(
  initial: ApiDoubleState = emptyState(),
): ApiDouble {
  const state: ApiDoubleState = { ...initial };
  const calls: { body: unknown; method: string; path: string }[] = [];
  const failures = new Map<string, number>();
  const refusals = new Map<string, { code: string; status: number }>();
  const requestKey = (path: string, method: string) => `${method} ${path}`;
  let sequence = state.messages.length;

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      status,
    });
  const error = (status: number, code: string) =>
    json(status, { code, correlationId: 'test', message: 'Request failed' });

  const handler: typeof globalThis.fetch = async (input, init) => {
    // The generated client hands `fetch` a fully built `Request` and no init,
    // so the method and body have to be read from the request itself. Reading
    // `init` instead would silently see every write as a GET with no body.
    const request =
      input instanceof Request
        ? input
        : new Request(input instanceof URL ? input.href : input, init);
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = url.pathname;
    const raw = await request.clone().text();
    const body = raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
    calls.push({ body, method, path });

    const key = requestKey(path, method);
    if ((failures.get(key) ?? 0) > 0) {
      failures.set(key, (failures.get(key) ?? 0) - 1);
      throw new TypeError('network error');
    }
    const refusal = refusals.get(key);
    if (refusal !== undefined) {
      refusals.delete(key);
      return error(refusal.status, refusal.code);
    }
    if (request.signal.aborted) throw new DOMException('aborted');

    // AUTH.
    if (path === '/v1/auth/local/web-sessions' && method === 'POST') {
      state.session = admittedState().session;
      return json(201, { ...state.session, csrfToken: 'csrf-token' });
    }
    if (path === '/v1/auth/session') {
      return state.session === null
        ? error(401, 'AUTH_REQUIRED')
        : json(200, state.session);
    }
    if (path === '/v1/auth/logout' || path === '/v1/auth/logout-all') {
      state.session = null;
      return json(200, { acknowledged: true });
    }

    // CREATORS. The public listing answers identically for everybody, so it is
    // reachable without a session exactly as the contract publishes it.
    if (path === '/v1/creators/directory' && method === 'GET') {
      return json(200, {
        creators: state.creatorDirectory.map((one) => ({ ...one })),
      });
    }

    // MEDIA. Reachable without a session, exactly as the contract publishes it.
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
                // Real time rather than the fixture clock. Every other value
                // a double produces is content a test asserts against; this
                // one is a deadline the client compares to its own clock, so a
                // fixed instant would arrive already expired.
                expiresAt: new Date(Date.now() + 300_000).toISOString(),
                url: `https://media.test/${assetId}`,
              })),
      });
    }

    if (state.session === null) return error(401, 'AUTH_REQUIRED');

    // USERS.
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
    if (path === '/v1/ai/suggestions' && method === 'POST') {
      const input = body as {
        capability: string;
        context?: string;
        draft: string;
        runId: string;
      };
      const suggestedText =
        input.draft.trim().length > 0
          ? `Refined: ${input.draft.trim()}`
          : 'What have you been looking forward to lately?';
      return json(200, {
        capability: input.capability,
        modelId: 'velora-local-deterministic-v1',
        outputSchemaVersion: 'suggestion.v1',
        promptVersion: '2026-08-26.1',
        providerId: 'local-test',
        runId: input.runId,
        suggestedText,
        usage: {
          estimatedCostMicrounits: 0,
          inputCharacters: input.draft.length + (input.context?.length ?? 0),
          outputCharacters: suggestedText.length,
        },
      });
    }
    if (path === '/v1/ai/runs/cancellation' && method === 'POST') {
      return json(200, {
        cancelled: true,
        runId: (body as { runId: string }).runId,
      });
    }
    if (path === '/v1/billing/payments' && method === 'GET') {
      return json(200, { payments: state.payments.map((row) => ({ ...row })) });
    }
    if (path === '/v1/billing/checkouts' && method === 'GET') {
      const wanted = url.searchParams.get('paymentId');
      const payment = state.payments.find((row) => row.id === wanted);
      return payment === undefined
        ? error(404, 'RESOURCE_NOT_FOUND')
        : json(200, { payment: { ...payment } });
    }
    if (
      path === '/v1/billing/subscriptions/cancellation' &&
      method === 'POST'
    ) {
      const input = body as { subscriptionId: string };
      const held = state.subscriptions.find(
        (row) => row.id === input.subscriptionId,
      );
      if (held === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      if (held.state !== 'active' && held.state !== 'past_due') {
        return error(409, 'ACTION_NOT_PERMITTED');
      }
      // Active schedules the end; a lapsed one has nothing left to honour.
      const next =
        held.state === 'active' ? 'cancel_at_period_end' : 'cancelled';
      state.subscriptions = state.subscriptions.map((row) =>
        row.id === input.subscriptionId ? { ...row, state: next } : row,
      );
      const moved = state.subscriptions.find(
        (row) => row.id === input.subscriptionId,
      );
      return json(200, { subscription: { ...moved } });
    }
    if (path === '/v1/billing/subscriptions' && method === 'GET') {
      return json(200, {
        subscriptions: state.subscriptions.map((row) => ({ ...row })),
      });
    }
    if (path === '/v1/users/me') return json(200, state.account);
    if (path === '/v1/users/me/onboarding' && method === 'GET') {
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
    if (path === '/v1/users/me/onboarding/acknowledgements') {
      state.onboarding = {
        adultAssurance: 'self_declared',
        adultAssuranceRefused: false,
        outstandingPolicies: [],
        outstandingProfile: ['display_name', 'ready_media'],
        step: 'profile',
      };
      return json(200, { account: state.account, ...state.onboarding });
    }
    if (path === '/v1/users/me/profile' && method === 'GET') {
      return state.profile === null
        ? json(200, {
            complete: false,
            discoverable: false,
            languages: [],
            media: [],
            outstandingRequirements: ['display_name', 'ready_media'],
          })
        : json(200, state.profile);
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
        preferencesVersion: state.profile?.preferencesVersion ?? 1,
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
    if (path === '/v1/users/me/preferences' && state.profile !== null) {
      const input = body as { discoverable: boolean };
      state.profile = {
        ...state.profile,
        discoverable: input.discoverable,
        preferencesVersion: (state.profile.preferencesVersion ?? 0) + 1,
      };
      return json(200, state.profile);
    }
    if (path === '/v1/users/me/profile/media' && method === 'POST') {
      // Every deployed environment refuses: no media provider is approved.
      return error(503, 'DEPENDENCY_UNAVAILABLE');
    }
    if (
      path === '/v1/users/me/profile/media/removal' &&
      method === 'POST' &&
      state.profile !== null
    ) {
      const input = body as { mediaId: string };
      state.profile = {
        ...state.profile,
        media: state.profile.media.filter((item) => item.id !== input.mediaId),
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

    // PRIVATE CLUBS.
    if (path === '/v1/clubs/access' && method === 'GET') {
      return json(200, { access: state.clubAccess });
    }
    if (path === '/v1/clubs' && method === 'GET') {
      const wanted = `${url.searchParams.get('handle') ?? ''}/${
        url.searchParams.get('slug') ?? ''
      }`;
      const detail = state.clubDetails[wanted];
      return detail === undefined
        ? error(404, 'RESOURCE_NOT_FOUND')
        : json(200, detail);
    }
    if (path === '/v1/clubs/departures' && method === 'POST') {
      const input = body as { clubId: string };
      const held = state.clubAccess.find(
        (entry) => entry.clubId === input.clubId && entry.state === 'active',
      );
      // A paid membership is refused here on purpose: ending it is a billing
      // decision with a period and a renewal attached.
      if (held === undefined || held.source === 'billing') {
        return error(409, 'ACTION_NOT_PERMITTED');
      }
      state.clubAccess = state.clubAccess.map((entry) =>
        entry.clubId === input.clubId
          ? { ...entry, endedAt: iso(), state: 'revoked' as const }
          : entry,
      );
      return json(200, { access: state.clubAccess });
    }
    if (path === '/v1/creators/clubs' && method === 'GET') {
      const wanted = url.searchParams.get('handle') ?? '';
      return json(200, {
        clubs: state.publicClubs[wanted] ?? [],
        handle: wanted,
      });
    }
    if (path === '/v1/creators/memberships' && method === 'GET') {
      const wanted = url.searchParams.get('handle') ?? '';
      const listing = state.membershipOffers[wanted];
      return json(200, {
        ...(listing?.gates === undefined ? {} : { gates: listing.gates }),
        handle: wanted,
        offers: listing?.offers ?? [],
        readiness: listing?.readiness ?? {
          currencies: [],
          enabled: false,
          intervals: [],
          modes: [],
          source: 'unpublished',
        },
        subscriptions: state.subscriptions,
      });
    }
    if (path === '/v1/clubs/redemptions' && method === 'POST') {
      const input = body as { secret: string };
      const invite = state.clubInvites.find(
        (entry) => entry.secret === input.secret,
      );
      // Single-use, and an unknown secret answers exactly as a spent one, so
      // presenting a guess discloses nothing about whether it ever existed.
      if (invite === undefined) return error(409, 'ACTION_NOT_PERMITTED');
      state.clubInvites = state.clubInvites.filter(
        (entry) => entry.secret !== input.secret,
      );
      state.clubAccess = [
        ...state.clubAccess,
        {
          clubId: invite.clubId,
          clubName: invite.clubName,
          clubSlug: invite.clubSlug,
          creatorHandle: invite.creatorHandle,
          grantedAt: iso(),
          source: 'creator_invite',
          state: 'active',
        },
      ];
      return json(200, { access: state.clubAccess });
    }

    // DISCOVERY.
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
    if (path === '/v1/discovery/introductions' && method === 'POST') {
      const input = body as { candidateId: string };
      // Signalling somebody who already signalled you is what makes an
      // introduction mutual, exactly as it is on the server.
      const waiting = state.introductions.find(
        (entry) =>
          entry.counterpart.id === input.candidateId &&
          entry.state === 'pending' &&
          entry.role === 'recipient',
      );
      if (waiting !== undefined) {
        const mutual = {
          ...waiting,
          mutualAt: iso(),
          state: 'mutual' as const,
        };
        state.introductions = state.introductions.map((entry) =>
          entry.id === waiting.id ? mutual : entry,
        );
        return json(200, mutual);
      }
      const candidate = state.candidates.find(
        (entry) => entry.id === input.candidateId,
      );
      if (candidate === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      const introduction = {
        counterpart: {
          ...candidate,
          sharedLanguages: candidate.sharedLanguages,
        },
        createdAt: iso(),
        id: '55555555-5555-4555-8555-555555555555',
        role: 'initiator' as const,
        state: 'pending' as const,
      };
      state.introductions = [...state.introductions, introduction];
      state.candidates = state.candidates.filter(
        (entry) => entry.id !== input.candidateId,
      );
      return json(200, introduction);
    }
    if (
      (path === '/v1/discovery/introductions/decline' ||
        path === '/v1/discovery/introductions/withdrawal') &&
      method === 'POST'
    ) {
      const input = body as { introductionId: string };
      const target = state.introductions.find(
        (entry) => entry.id === input.introductionId,
      );
      if (target === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      // A closed introduction stops being listed, which is the same thing
      // somebody sees when the other person was never there.
      state.introductions = state.introductions.filter(
        (entry) => entry.id !== input.introductionId,
      );
      return json(200, { ...target, state: 'closed' as const });
    }

    // REALTIME. Terminal states are terminal here too: a double that let an
    // ended call be answered would prove the surface handles a case the server
    // makes unreachable.
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
      // A pending, closed, or absent introduction answers exactly as one that
      // does not exist, so probing this route discloses nothing.
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
        id: '66666666-6666-4666-8666-666666666666',
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
          // Short-lived and per-issuance. A double returning a fixed string
          // would let a surface that cached one still pass.
          credential: `join-${String(calls.length)}`,
          expiresAt: iso(120_000),
          medium: state.call.medium,
        });
      }
      const transition = callTransitions[path];
      if (transition === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      // A finished call answers with itself however many times it is asked,
      // because a retried hang-up is the ordinary case rather than an error.
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

    // MESSAGING.
    if (path === '/v1/messaging/conversations' && method === 'GET') {
      return json(200, { conversations: state.conversations });
    }
    if (path === '/v1/messaging/conversations' && method === 'POST') {
      const conversation = state.conversations[0];
      return conversation === undefined
        ? error(404, 'RESOURCE_NOT_FOUND')
        : json(200, conversation);
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
      const conversationId = url.searchParams.get('conversationId');
      return json(200, {
        conversationId,
        messages: state.messages
          .filter((message) => message.conversationId === conversationId)
          .toReversed(),
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
        id: `66666666-6666-4666-8666-${String(sequence).padStart(12, '0')}`,
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

    // NOTIFICATIONS.
    if (path === '/v1/notifications' && method === 'GET') {
      return json(200, { notifications: state.notifications });
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

    // SAFETY.
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
      state.conversations = state.conversations.map((conversation) =>
        conversation.counterpart.id === input.targetId
          ? { ...conversation, state: 'closed' as const }
          : conversation,
      );
      state.notifications = state.notifications.filter(
        (entry) => entry.subjectId !== input.targetId,
      );
      return json(200, { blockedId: input.targetId, createdAt: iso() });
    }
    if (path === '/v1/safety/blocks/removal') {
      const input = body as { targetId: string };
      state.blocks = state.blocks.filter(
        (block) => block.blockedId !== input.targetId,
      );
      return json(200, { blockedId: input.targetId, createdAt: iso() });
    }
    if (path === '/v1/safety/reports' && method === 'GET') {
      return json(200, { reports: state.reports });
    }
    if (path === '/v1/safety/reports' && method === 'POST') {
      const input = body as { reasonCode: string; subjectId: string };
      const report = {
        createdAt: iso(),
        id: '77777777-7777-4777-8777-777777777777',
        reasonCode: input.reasonCode,
        state: 'received',
        subjectId: input.subjectId,
      };
      state.reports = [...state.reports, report];
      return json(200, report);
    }

    if (path === '/v1/safety/standing' && method === 'GET') {
      return json(200, { statements: state.statements });
    }
    if (path === '/v1/safety/appeals' && method === 'GET') {
      return json(200, { appeals: state.appeals });
    }
    if (path === '/v1/safety/appeals' && method === 'POST') {
      const input = body as { decisionId: string };
      const appeal = {
        decisionId: input.decisionId,
        id: '88888888-8888-4888-8888-888888888888',
        state: 'received',
        submittedAt: iso(),
      };
      state.appeals = [...state.appeals, appeal];
      return json(200, appeal);
    }
    if (path === '/v1/safety/appeals/withdrawal' && method === 'POST') {
      const input = body as { appealId: string };
      state.appeals = state.appeals.map((appeal) =>
        appeal.id === input.appealId
          ? { ...appeal, state: 'withdrawn' }
          : appeal,
      );
      const withdrawn = state.appeals.find(
        (appeal) => appeal.id === input.appealId,
      );
      return withdrawn === undefined
        ? error(404, 'HTTP_404')
        : json(200, withdrawn);
    }

    return error(404, 'HTTP_404');
  };

  return {
    calls,
    failNext(path, method) {
      const key = requestKey(path, method);
      failures.set(key, (failures.get(key) ?? 0) + 1);
    },
    fetch: handler,
    refuseNext(path, method, status, code) {
      refusals.set(requestKey(path, method), { code, status });
    },
    state,
  };
}
