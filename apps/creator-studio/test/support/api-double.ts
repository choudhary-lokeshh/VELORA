/**
 * A stand-in for the VELORA API, from Creator Studio's side.
 *
 * It answers the real contract paths with real contract shapes and it holds
 * state, so a test can drive the whole creator journey — sign in, become a
 * creator, accept the policies, claim a handle, publish — and watch the surface
 * react to answers a server would actually give.
 *
 * It is deliberately not a mock inside a component. Nothing in `src/` knows
 * this file exists; it is installed as a `fetch` implementation, so the surface
 * under test goes through the generated client, the same request bodies, and
 * the same status codes it would in production.
 */

export interface CreatorApiDoubleState {
  account: {
    activatedAt?: string;
    createdAt: string;
    id: string;
    status: 'applicant' | 'active' | 'suspended' | 'closed';
    statusReason?: string;
  } | null;
  adultGateReason: string | undefined;
  adultGateSatisfied: boolean;
  outstandingPolicies: { key: string; version: string }[];
  profile: {
    bio?: string;
    displayName: string;
    handle: string;
    links: { label?: string; url: string }[];
    /** The page images, as the creator sees them. Empty unless a test adds one. */
    media?: {
      id: string;
      rejectionReason?: string;
      slot: 'avatar' | 'cover';
      state: string;
      uploadExpiresAt?: string;
    }[];
    publication: 'draft' | 'published';
    publishedAt?: string;
    version: number;
  } | null;
  clubs: {
    description?: string;
    id: string;
    lifecycle: 'draft' | 'published' | 'closed';
    memberCount: number;
    name: string;
    slug: string;
    version: number;
  }[];
  invites: {
    clubId: string;
    createdAt: string;
    expiresAt: string;
    id: string;
    redeemedAt?: string;
    revokedAt?: string;
  }[];
  memberships: {
    clubId: string;
    grantedAt: string;
    id: string;
    revokedAt?: string;
    source: 'creator_invite' | 'admin_grant' | 'billing';
    state: 'active' | 'revoked';
  }[];
  /**
   * Currency-separated earnings, exactly as the server would report them.
   *
   * Held as the wire shape rather than as inputs the double computes from, so
   * a test asserting what a creator sees is asserting what the server said and
   * not what the double decided.
   */
  earnings: {
    currency: string;
    disputed: string;
    gross: string;
    payable: string;
    platform: string;
    reversed: string;
    tax: string;
  }[];
  /** What the server says about payout readiness, held as the wire shape. */
  payoutReadiness: {
    balances: {
      available: string;
      currency: string;
      held: string;
      releasable: string;
      reserved: string;
    }[];
    enabled: boolean;
    policySource: string;
    providerSource: string;
    recipientStatus: 'absent' | 'onboarding' | 'ready' | 'restricted';
  };
  offers: {
    activatedAt?: string;
    createdAt: string;
    id: string;
    mode: 'subscription' | 'one_time';
    prices: {
      amount: { amountMinor: string; currency: string };
      createdAt: string;
      effectiveFrom: string;
      id: string;
      interval?: 'month' | 'year';
      state: 'active' | 'retired';
    }[];
    resourceId: string;
    resourceType: 'club';
    state: 'draft' | 'active' | 'retired';
    updatedAt: string;
    version: number;
  }[];
  payouts: {
    amount: { amountMinor: string; currency: string };
    createdAt: string;
    failureReason?: string;
    id: string;
    state: string;
    updatedAt: string;
  }[];
  earningsHistory: {
    amount: { amountMinor: string; currency: string };
    id: string;
    kind: 'capture' | 'dispute' | 'refund';
    occurredAt: string;
    offerId: string;
    state: string;
  }[];
  content: {
    body?: string;
    clubId?: string;
    id: string;
    lifecycle: 'draft' | 'published' | 'archived';
    summary?: string;
    title: string;
    version: number;
    visibility: 'public' | 'members_only';
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
  /** Handles already held by somebody else, so a claim can be contested. */
  takenHandles: string[];
}

export interface CreatorApiDouble {
  /** Every request the surface made, so a test can assert what it did not do. */
  readonly calls: { body: unknown; method: string; path: string }[];
  failNext(path: string): void;
  readonly fetch: typeof globalThis.fetch;
  refuseNext(path: string, status: number, code: string): void;
  readonly state: CreatorApiDoubleState;
}

const iso = (offsetMilliseconds = 0) =>
  new Date(Date.UTC(2026, 7, 15, 12, 0, 0) + offsetMilliseconds).toISOString();

export const creatorAccountId = '55555555-5555-4555-8555-555555555555';

export const requiredCreatorPolicies = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

function signedInSession(): NonNullable<CreatorApiDoubleState['session']> {
  return {
    absoluteExpiresAt: iso(28_800_000),
    accountId: creatorAccountId,
    assurance: 'single_factor',
    assuranceEstablishedAt: iso(),
    audience: 'creator_studio',
    authenticatedAt: iso(),
    idleExpiresAt: iso(1_800_000),
  };
}

export function emptyCreatorState(): CreatorApiDoubleState {
  return {
    account: null,
    adultGateReason: undefined,
    clubs: [],
    content: [],
    earnings: [],
    earningsHistory: [],
    offers: [],
    payoutReadiness: {
      balances: [],
      enabled: false,
      policySource: 'unpublished',
      providerSource: 'unavailable',
      recipientStatus: 'absent',
    },
    payouts: [],
    invites: [],
    memberships: [],
    adultGateSatisfied: true,
    outstandingPolicies: [],
    profile: null,
    session: null,
    takenHandles: [],
  };
}

/** Signed in, creator access active, no public profile yet. */
export function activeCreatorState(): CreatorApiDoubleState {
  return {
    ...emptyCreatorState(),
    account: {
      activatedAt: iso(),
      createdAt: iso(),
      id: creatorAccountId,
      status: 'active',
    },
    session: signedInSession(),
  };
}

function stepFor(state: CreatorApiDoubleState): string {
  if (!state.adultGateSatisfied) return 'adult_eligibility';
  return state.outstandingPolicies.length > 0
    ? 'policy_acknowledgement'
    : 'completed';
}

export function createCreatorApiDouble(
  initial: CreatorApiDoubleState = emptyCreatorState(),
): CreatorApiDouble {
  const state: CreatorApiDoubleState = { ...initial };
  const calls: { body: unknown; method: string; path: string }[] = [];
  const failures = new Map<string, number>();
  const refusals = new Map<string, { code: string; status: number }>();

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      status,
    });
  const error = (status: number, code: string) =>
    json(status, { code, correlationId: 'test', message: 'Request failed' });

  const accountBody = () => state.account;
  const onboardingBody = () => ({
    account: state.account,
    ...(state.adultGateReason === undefined
      ? {}
      : { adultGateReason: state.adultGateReason }),
    adultGateSatisfied: state.adultGateSatisfied,
    outstandingPolicies: state.outstandingPolicies,
    step: stepFor(state),
  });
  const profileBody = () =>
    state.profile === null
      ? undefined
      : {
          ...(state.profile.bio === undefined
            ? {}
            : { bio: state.profile.bio }),
          displayName: state.profile.displayName,
          handle: state.profile.handle,
          links: state.profile.links,
          media: state.profile.media ?? [],
          publicPath: `/c/${state.profile.handle}`,
          publication: state.profile.publication,
          ...(state.profile.publishedAt === undefined
            ? {}
            : { publishedAt: state.profile.publishedAt }),
          updatedAt: iso(),
          version: state.profile.version,
        };

  const clubBody = (club: CreatorApiDoubleState['clubs'][number]) => ({
    createdAt: iso(),
    ...(club.description === undefined
      ? {}
      : { description: club.description }),
    id: club.id,
    lifecycle: club.lifecycle,
    memberCount: club.memberCount,
    name: club.name,
    ...(club.lifecycle === 'published' ? { publishedAt: iso() } : {}),
    slug: club.slug,
    updatedAt: iso(),
    version: club.version,
  });

  const entryBody = (entry: CreatorApiDoubleState['content'][number]) => ({
    ...(entry.body === undefined ? {} : { body: entry.body }),
    ...(entry.clubId === undefined ? {} : { clubId: entry.clubId }),
    createdAt: iso(),
    id: entry.id,
    lifecycle: entry.lifecycle,
    ...(entry.lifecycle === 'published' ? { publishedAt: iso() } : {}),
    ...(entry.summary === undefined ? {} : { summary: entry.summary }),
    title: entry.title,
    updatedAt: iso(),
    version: entry.version,
    visibility: entry.visibility,
  });
  const contentBody = () => state.content.map((entry) => entryBody(entry));

  const handler: typeof globalThis.fetch = async (input, init) => {
    // The generated client hands `fetch` a fully built `Request` and no init,
    // so the method and body have to be read from the request itself.
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

    /**
     * Keyset paging, the way the server does it: a cursor names the row after
     * which the next page starts, and it is only present when there is one. A
     * double that always returned everything would let a surface that ignores
     * paging pass its own tests.
     */
    const page = <T extends { id: string }>(
      rows: readonly T[],
    ): { readonly next: string | undefined; readonly rows: readonly T[] } => {
      const cursor = url.searchParams.get('cursor');
      const size = Number(url.searchParams.get('pageSize') ?? '25');
      const from =
        cursor === null ? 0 : rows.findIndex((row) => row.id === cursor) + 1;
      const slice = rows.slice(from, from + size);
      const last = slice.at(-1);
      const more = from + slice.length < rows.length;
      return {
        next: more && last !== undefined ? last.id : undefined,
        rows: slice,
      };
    };

    if ((failures.get(path) ?? 0) > 0) {
      failures.set(path, (failures.get(path) ?? 0) - 1);
      throw new TypeError('network error');
    }
    const refusal = refusals.get(path);
    if (refusal !== undefined) {
      refusals.delete(path);
      return error(refusal.status, refusal.code);
    }
    if (request.signal.aborted) throw new DOMException('aborted');

    // The public creator page needs no session at all, so it is answered
    // before the credential check below.
    if (path === '/v1/creators' && method === 'GET') {
      const handle = url.searchParams.get('handle');
      if (
        state.profile?.publication !== 'published' ||
        state.account?.status !== 'active' ||
        handle !== state.profile.handle
      ) {
        return error(404, 'RESOURCE_NOT_FOUND');
      }
      return json(200, {
        ...(state.profile.bio === undefined ? {} : { bio: state.profile.bio }),
        displayName: state.profile.displayName,
        handle: state.profile.handle,
        links: state.profile.links,
        publishedAt: state.profile.publishedAt ?? iso(),
      });
    }

    if (path === '/v1/creators/catalog' && method === 'GET') {
      const handle = url.searchParams.get('handle');
      if (
        state.profile?.publication !== 'published' ||
        state.account?.status !== 'active' ||
        handle !== state.profile.handle
      ) {
        return error(404, 'RESOURCE_NOT_FOUND');
      }
      // Only published, public items reach a visitor. A draft or a
      // members-only item is absent rather than redacted.
      return json(200, {
        content: state.content
          .filter(
            (entry) =>
              entry.lifecycle === 'published' && entry.visibility === 'public',
          )
          .map((entry) => ({
            ...(entry.body === undefined ? {} : { body: entry.body }),
            id: entry.id,
            publishedAt: iso(),
            ...(entry.summary === undefined ? {} : { summary: entry.summary }),
            title: entry.title,
          })),
        handle: state.profile.handle,
      });
    }

    if (path === '/v1/creators/clubs' && method === 'GET') {
      const handle = url.searchParams.get('handle');
      if (
        state.profile?.publication !== 'published' ||
        state.account?.status !== 'active' ||
        handle !== state.profile.handle
      ) {
        return error(404, 'RESOURCE_NOT_FOUND');
      }
      return json(200, {
        clubs: state.clubs
          .filter((club) => club.lifecycle === 'published')
          .map((club) => ({
            ...(club.description === undefined
              ? {}
              : { description: club.description }),
            name: club.name,
            slug: club.slug,
          })),
        handle: state.profile.handle,
      });
    }

    if (path === '/v1/auth/local/web-sessions' && method === 'POST') {
      state.session = signedInSession();
      return json(201, { ...state.session, csrfToken: 'csrf-token' });
    }
    if (path === '/v1/auth/session') {
      return state.session === null
        ? error(401, 'AUTH_REQUIRED')
        : json(200, state.session);
    }
    if (path === '/v1/auth/logout') {
      state.session = null;
      return json(200, { acknowledged: true });
    }

    if (state.session === null) return error(401, 'AUTH_REQUIRED');

    if (path === '/v1/creator' && method === 'POST') {
      if (!state.adultGateSatisfied) return error(409, 'ACCOUNT_NOT_ELIGIBLE');
      if (state.account !== null) return json(200, accountBody());
      state.account = {
        createdAt: iso(),
        id: creatorAccountId,
        status: 'applicant',
        statusReason: 'onboarding_incomplete',
      };
      state.outstandingPolicies = [...requiredCreatorPolicies];
      return json(201, accountBody());
    }

    if (state.account === null) return error(404, 'RESOURCE_NOT_FOUND');
    if (path === '/v1/creator/me') return json(200, accountBody());
    if (path === '/v1/creator/onboarding' && method === 'GET') {
      return json(200, onboardingBody());
    }
    if (path === '/v1/creator/onboarding/acknowledgements') {
      if (!state.adultGateSatisfied) return error(409, 'ACCOUNT_NOT_ELIGIBLE');
      state.outstandingPolicies = [];
      const withoutReason = { ...state.account };
      delete withoutReason.statusReason;
      state.account = {
        ...withoutReason,
        activatedAt: iso(),
        status: 'active',
      };
      return json(200, onboardingBody());
    }

    if (path === '/v1/creator/earnings' && method === 'GET') {
      return json(200, {
        currencies: state.earnings.map((row) => ({ ...row })),
        readiness: {
          currencies: [],
          enabled: false,
          intervals: [],
          modes: [],
          source: 'unpublished',
        },
      });
    }
    if (path === '/v1/creator/earnings/history' && method === 'GET') {
      const currency = url.searchParams.get('currency') ?? '';
      const { next, rows } = page(
        state.earningsHistory.filter(
          (entry) => entry.amount.currency === currency,
        ),
      );
      return json(200, {
        currency,
        entries: rows.map((entry) => ({ ...entry })),
        ...(next === undefined ? {} : { nextCursor: next }),
      });
    }

    if (path === '/v1/creator/offers' && method === 'GET') {
      const { next, rows } = page(state.offers);
      return json(200, {
        offers: rows.map((offer) => ({ ...offer })),
        ...(next === undefined ? {} : { nextCursor: next }),
        readiness: {
          currencies: [],
          enabled: false,
          intervals: [],
          modes: [],
          source: 'unpublished',
        },
      });
    }
    if (path === '/v1/creator/safety/readiness' && method === 'GET') {
      // The only answer this endpoint has, in every environment.
      return json(200, {
        blockers: [
          'mature_content_capability_disabled',
          'depicted_person_verifier_unavailable',
          'consent_wording_unpublished',
          'content_taxonomy_undecided',
        ],
        consentPolicySource: 'unpublished',
        enabled: false,
        matureContentSource: 'disabled',
        surfaces: [
          { eligible: true, surface: 'web' },
          { eligible: false, surface: 'mobile_ios' },
          { eligible: false, surface: 'mobile_android' },
          { eligible: true, surface: 'creator_studio' },
          { eligible: true, surface: 'platform_admin' },
        ],
        verifierSource: 'unavailable',
      });
    }
    if (path === '/v1/creator/payouts/readiness' && method === 'GET') {
      return json(200, {
        balances: state.payoutReadiness.balances.map((row) => ({ ...row })),
        enabled: state.payoutReadiness.enabled,
        policySource: state.payoutReadiness.policySource,
        providerSource: state.payoutReadiness.providerSource,
        recipientStatus: state.payoutReadiness.recipientStatus,
      });
    }
    if (path === '/v1/creator/payouts/onboarding' && method === 'POST') {
      if (state.payoutReadiness.providerSource === 'unavailable') {
        return error(409, 'DEPENDENCY_UNAVAILABLE');
      }
      state.payoutReadiness = {
        ...state.payoutReadiness,
        recipientStatus: 'onboarding',
      };
      return json(201, {
        onboardingUrl: 'https://provider.test/onboarding',
        recipientStatus: 'onboarding',
      });
    }
    if (path === '/v1/creator/payouts' && method === 'POST') {
      if (!state.payoutReadiness.enabled) {
        return error(409, 'DEPENDENCY_UNAVAILABLE');
      }
      const requested = body as { amountMinor: string; currency: string };
      const key = request.headers.get('x-velora-idempotency-key') ?? '';
      const existing = state.payouts.find((payout) => payout.id === key);
      if (existing !== undefined) return json(201, { payout: existing });
      const created = {
        amount: {
          amountMinor: requested.amountMinor,
          currency: requested.currency,
        },
        createdAt: iso(),
        id: key,
        state: 'requested',
        updatedAt: iso(),
      };
      state.payouts = [created, ...state.payouts];
      return json(201, { payout: created });
    }
    if (path === '/v1/creator/payouts' && method === 'GET') {
      return json(200, {
        payouts: state.payouts.map((payout) => ({ ...payout })),
      });
    }

    if (path === '/v1/creator/clubs' && method === 'GET') {
      const { next, rows } = page(state.clubs);
      return json(200, {
        clubs: rows.map((club) => clubBody(club)),
        ...(next === undefined ? {} : { nextCursor: next }),
      });
    }
    if (path === '/v1/creator/clubs' && method === 'POST') {
      if (state.account.status !== 'active')
        return error(409, 'STATE_CONFLICT');
      const requested = body as {
        clubId?: string;
        description?: string;
        name: string;
        slug: string;
        version?: number;
      };
      const slug = requested.slug.toLowerCase();
      if (requested.clubId !== undefined) {
        const current = state.clubs.find(
          (club) => club.id === requested.clubId,
        );
        if (current === undefined || current.version !== requested.version) {
          return error(409, 'STATE_CONFLICT');
        }
        const edited = {
          ...current,
          ...(requested.description === undefined
            ? {}
            : { description: requested.description }),
          name: requested.name,
          version: current.version + 1,
        };
        state.clubs = state.clubs.map((club) =>
          club.id === edited.id ? edited : club,
        );
        return json(200, { clubs: [clubBody(edited)] });
      }
      if (state.clubs.some((club) => club.slug === slug)) {
        return error(409, 'STATE_CONFLICT');
      }
      const created = {
        ...(requested.description === undefined
          ? {}
          : { description: requested.description }),
        id: `club-${String(state.clubs.length + 1)}`,
        lifecycle: 'draft' as const,
        memberCount: 0,
        name: requested.name,
        slug,
        version: 1,
      };
      state.clubs = [created, ...state.clubs];
      return json(201, { clubs: [clubBody(created)] });
    }
    if (path === '/v1/creator/clubs/lifecycle' && method === 'POST') {
      if (state.account.status !== 'active')
        return error(409, 'STATE_CONFLICT');
      const requested = body as {
        clubId: string;
        lifecycle: 'draft' | 'published' | 'closed';
        version: number;
      };
      const current = state.clubs.find((club) => club.id === requested.clubId);
      if (current?.version !== requested.version) {
        return error(409, 'STATE_CONFLICT');
      }
      if (current.lifecycle === 'closed') return error(409, 'STATE_CONFLICT');
      const moved = {
        ...current,
        lifecycle: requested.lifecycle,
        version: current.version + 1,
      };
      state.clubs = state.clubs.map((club) =>
        club.id === moved.id ? moved : club,
      );
      return json(200, { clubs: [clubBody(moved)] });
    }
    if (path === '/v1/creator/clubs/invites' && method === 'GET') {
      const clubId = url.searchParams.get('clubId');
      return json(200, {
        invites: state.invites.filter(
          (entry) => clubId === null || entry.clubId === clubId,
        ),
      });
    }
    if (path === '/v1/creator/clubs/members' && method === 'GET') {
      const clubId = url.searchParams.get('clubId');
      const owned = state.memberships.filter(
        (entry) => clubId === null || entry.clubId === clubId,
      );
      const { next, rows } = page(owned);
      return json(200, {
        memberships: rows,
        ...(next === undefined ? {} : { nextCursor: next }),
      });
    }
    if (path === '/v1/creator/clubs/members/revocation' && method === 'POST') {
      if (state.account.status !== 'active')
        return error(409, 'STATE_CONFLICT');
      const requested = body as { membershipId: string };
      state.memberships = state.memberships.map((entry) =>
        entry.id === requested.membershipId
          ? { ...entry, revokedAt: iso(), state: 'revoked' as const }
          : entry,
      );
      return json(200, { memberships: state.memberships });
    }
    if (path === '/v1/creator/clubs/invites/revocation' && method === 'POST') {
      if (state.account.status !== 'active')
        return error(409, 'STATE_CONFLICT');
      const requested = body as { inviteId: string };
      state.invites = state.invites.map((entry) =>
        entry.id === requested.inviteId
          ? { ...entry, revokedAt: iso() }
          : entry,
      );
      return json(200, { invites: state.invites });
    }
    if (path === '/v1/creator/clubs/invites' && method === 'POST') {
      if (state.account.status !== 'active')
        return error(409, 'STATE_CONFLICT');
      const requested = body as { clubId: string };
      const club = state.clubs.find((entry) => entry.id === requested.clubId);
      if (club?.lifecycle !== 'published') return error(409, 'STATE_CONFLICT');
      return json(201, {
        invite: {
          clubId: club.id,
          createdAt: iso(),
          expiresAt: iso(604_800_000),
          id: `invite-${club.id}`,
        },
        secret: 'invitation-secret-value-shown-once-0001',
      });
    }
    if (path === '/v1/creator/content' && method === 'GET') {
      const { next, rows } = page(state.content);
      return json(200, {
        content: rows.map((entry) => entryBody(entry)),
        ...(next === undefined ? {} : { nextCursor: next }),
      });
    }
    if (path === '/v1/creator/content' && method === 'POST') {
      if (state.account.status !== 'active')
        return error(409, 'STATE_CONFLICT');
      const requested = body as {
        body?: string;
        clubId?: string;
        contentId?: string;
        summary?: string;
        title: string;
        version?: number;
        visibility: 'public' | 'members_only';
      };
      if (requested.clubId !== undefined) {
        const club = state.clubs.find((entry) => entry.id === requested.clubId);
        if (club === undefined) return error(422, 'VALIDATION_FAILED');
      }
      if (requested.contentId !== undefined) {
        const current = state.content.find(
          (entry) => entry.id === requested.contentId,
        );
        if (current === undefined || current.version !== requested.version) {
          return error(409, 'STATE_CONFLICT');
        }
        const edited = {
          ...current,
          ...(requested.body === undefined ? {} : { body: requested.body }),
          ...(requested.clubId === undefined
            ? {}
            : { clubId: requested.clubId }),
          ...(requested.summary === undefined
            ? {}
            : { summary: requested.summary }),
          title: requested.title,
          version: current.version + 1,
          visibility: requested.visibility,
        };
        state.content = state.content.map((entry) =>
          entry.id === edited.id ? edited : entry,
        );
        return json(200, { content: [entryBody(edited)] });
      }
      const created = {
        ...(requested.body === undefined ? {} : { body: requested.body }),
        ...(requested.clubId === undefined ? {} : { clubId: requested.clubId }),
        id: `content-${String(state.content.length + 1)}`,
        lifecycle: 'draft' as const,
        ...(requested.summary === undefined
          ? {}
          : { summary: requested.summary }),
        title: requested.title,
        version: 1,
        visibility: requested.visibility,
      };
      state.content = [created, ...state.content];
      return json(201, { content: contentBody() });
    }
    if (path === '/v1/creator/content/lifecycle' && method === 'POST') {
      if (state.account.status !== 'active')
        return error(409, 'STATE_CONFLICT');
      const requested = body as {
        contentId: string;
        lifecycle: 'draft' | 'published' | 'archived';
        version: number;
      };
      const current = state.content.find(
        (entry) => entry.id === requested.contentId,
      );
      if (current?.version !== requested.version) {
        return error(409, 'STATE_CONFLICT');
      }
      const moved = {
        ...current,
        lifecycle: requested.lifecycle,
        version: current.version + 1,
      };
      state.content = state.content.map((entry) =>
        entry.id === moved.id ? moved : entry,
      );
      return json(200, { content: [entryBody(moved)] });
    }
    if (path === '/v1/creator/profile' && method === 'GET') {
      const current = profileBody();
      return current === undefined
        ? error(404, 'RESOURCE_NOT_FOUND')
        : json(200, current);
    }
    if (path === '/v1/creator/profile' && method === 'POST') {
      const requested = body as {
        bio?: string;
        displayName: string;
        handle: string;
        links?: { label?: string; url: string }[];
        version?: number;
      };
      const canonical = requested.handle.toLowerCase();
      if (state.profile === null) {
        if (state.takenHandles.includes(canonical)) {
          return error(409, 'STATE_CONFLICT');
        }
        state.profile = {
          ...(requested.bio === undefined ? {} : { bio: requested.bio }),
          displayName: requested.displayName,
          handle: canonical,
          links: requested.links ?? [],
          publication: 'draft',
          version: 1,
        };
        return json(201, profileBody());
      }
      if (
        requested.version !== state.profile.version ||
        canonical !== state.profile.handle
      ) {
        return error(409, 'STATE_CONFLICT');
      }
      state.profile = {
        ...state.profile,
        ...(requested.bio === undefined ? {} : { bio: requested.bio }),
        displayName: requested.displayName,
        links: requested.links ?? [],
        version: state.profile.version + 1,
      };
      return json(200, profileBody());
    }
    if (path === '/v1/creator/profile/publication' && method === 'POST') {
      const requested = body as {
        publication: 'draft' | 'published';
        version: number;
      };
      if (state.profile === null) return error(404, 'RESOURCE_NOT_FOUND');
      if (requested.version !== state.profile.version) {
        return error(409, 'STATE_CONFLICT');
      }
      if (
        requested.publication === 'published' &&
        state.account.status !== 'active'
      ) {
        return error(409, 'STATE_CONFLICT');
      }
      const withoutInstant = { ...state.profile };
      delete withoutInstant.publishedAt;
      state.profile = {
        ...withoutInstant,
        publication: requested.publication,
        ...(requested.publication === 'published'
          ? { publishedAt: iso() }
          : {}),
        version: state.profile.version + 1,
      };
      return json(200, profileBody());
    }

    return error(404, 'HTTP_404');
  };

  return {
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
