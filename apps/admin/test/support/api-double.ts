/**
 * A stand-in for the VELORA API, from Platform Admin's side.
 *
 * It answers the real contract paths with real contract shapes and it holds
 * state, so a test can drive the whole operator journey — read a queue, open a
 * case, claim it, triage it, decide it, suspend a creator, issue a refund — and
 * watch the console react to answers a server would actually give.
 *
 * It is deliberately not a mock inside a component. Nothing in `src/` knows this
 * file exists; it is installed as a `fetch` implementation, so the console under
 * test goes through the generated client, the same request bodies, and the same
 * status codes it would in production.
 *
 * **Why this suite carries more weight here than on the other two surfaces.**
 * No route in the contract can issue a Platform Admin session:
 * `/v1/auth/local/web-sessions` admits only the consumer and Creator Studio
 * audiences, and the one privileged verifier the platform composes refuses every
 * assertion. A browser therefore cannot reach any screen behind the gate in any
 * environment, and this double is the only way the console's screens can be
 * exercised at all. It answers the contract rather than the console, so what it
 * proves is that the screens read the platform correctly — and the refusal every
 * real browser meets is proved separately, in a real browser.
 */

export interface AdminApiDoubleState {
  appeals: {
    appellantKind: 'subject' | 'notifier';
    decisionId: string;
    id: string;
    outcomeDecisionId?: string;
    state: 'received' | 'under_review' | 'upheld' | 'refused' | 'withdrawn';
    submittedAt: string;
    version: number;
    windowClosesAt?: string;
  }[];
  cases: {
    assigned: boolean;
    assignmentExpiresAt?: string;
    decisions: {
      action: string;
      decidedAt: string;
      evidenceIds: string[];
      id: string;
      policyVersion: string;
      reasonCode: string;
      scope?: string;
      supersedesId?: string;
    }[];
    evidence: {
      id: string;
      kind: string;
      recordedAt: string;
      referenceId?: string;
      referenceType?: string;
      stateLabel?: string;
    }[];
    id: string;
    openedAt: string;
    policyVersion: string;
    priority: 'untriaged' | 'low' | 'normal' | 'high' | 'urgent';
    queue: 'consumer_conduct' | 'creator_content' | 'creator_identity';
    reports: {
      createdAt: string;
      detail?: string;
      id: string;
      reasonCode: string;
      sourceSurface?: string;
      state: string;
      targetType: string;
    }[];
    state: 'new' | 'triaged' | 'investigating' | 'decided' | 'closed';
    targetId: string;
    targetType: string;
    version: number;
  }[];
  creators: {
    activatedAt?: string;
    createdAt: string;
    handle?: string;
    id: string;
    profilePublished: boolean;
    status: 'applicant' | 'active' | 'suspended' | 'closed';
    statusReason?: string;
    suspendedAt?: string;
  }[];
  /** Every financial figure, held as the wire shape the server publishes. */
  financial: {
    capabilities: Record<string, string>;
    disputes: { count: number; state: string }[];
    openDisputeTotals: { amountMinor: string; currency: string }[];
    payableTotals: { amountMinor: string; currency: string }[];
    payments: { count: number; state: string }[];
    payouts: { count: number; state: string }[];
    reconciliation: { count: number; state: string }[];
    refunds: { count: number; state: string }[];
    subscriptions: { count: number; state: string }[];
  };
  identity: {
    attempts: { count: number; purpose: string; state: string }[];
    expiredEvidence: { count: number; state: string }[];
    outbox: { count: number; state: string }[];
    provider: string;
    providerEventBacklog: {
      count: number;
      oldestAgeSeconds?: number;
      state: string;
    }[];
    providerEvents: { count: number; state: string }[];
  };
  media: {
    adapters: { scanner: string; storage: string };
    assets: { count: number; state: string }[];
    attention: { count: number; state: string }[];
    backlogs: {
      breached: boolean;
      count: number;
      oldestAgeSeconds?: number;
      state: string;
      thresholdSeconds: number;
    }[];
    drift: { count: number; state: string }[];
    liveMediaAvailable: boolean;
    objects: { count: number; state: string }[];
    obligations: { count: number; state: string }[];
  };
  notifications: {
    adapters: { deliveryChannel: string };
    attempts: { count: number; state: string }[];
    backlogs: {
      breached: boolean;
      count: number;
      oldestAgeSeconds?: number;
      state: string;
      thresholdSeconds: number;
    }[];
    devices: { count: number; state: string }[];
    failures: { count: number; state: string }[];
    intents: { count: number; state: string }[];
    providerEvents: { count: number; state: string }[];
    suppressions: { count: number; state: string }[];
  };
  /** Every refund the console has asked for, keyed by its idempotency key. */
  refunds: Record<
    string,
    { amountMinor: string; currency: string; id: string }
  >;
  rtc: {
    adapters: {
      eligibility: string;
      provider: string;
      signalTransport: string;
    };
    backlogs: {
      breached: boolean;
      count: number;
      oldestAgeSeconds?: number;
      state: string;
      thresholdSeconds: number;
    }[];
    calls: { count: number; state: string }[];
    endedWithUndischargedTeardown: number;
    liveCallingAvailable: boolean;
    providerEvents: { count: number; state: string }[];
    providerObligations: { count: number; state: string }[];
  };
  /**
   * What the session endpoint answers.
   *
   * `null` is a browser holding nothing. A session whose audience is not
   * `platform_admin`, or whose assurance is not `phishing_resistant`, is what
   * every real browser holds — and every admin route refuses it exactly as the
   * server does.
   */
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

export interface AdminApiDouble {
  /** Every request the console made, so a test can assert what it did not do. */
  readonly calls: {
    body: unknown;
    headers: Record<string, string>;
    method: string;
    path: string;
    query: Record<string, string>;
  }[];
  failNext(path: string): void;
  readonly fetch: typeof globalThis.fetch;
  refuseNext(path: string, status: number, code: string): void;
  readonly state: AdminApiDoubleState;
}

const iso = (offsetMilliseconds = 0) =>
  new Date(Date.UTC(2026, 7, 20, 9, 0, 0) + offsetMilliseconds).toISOString();

export const operatorAccountId = '99999999-9999-4999-8999-999999999999';

/** A browser holding nothing, which is what this origin normally sees. */
export function anonymousState(): AdminApiDoubleState {
  return {
    appeals: [],
    cases: [],
    creators: [],
    financial: {
      capabilities: {
        commerceEligibility: 'unavailable',
        commercePolicy: 'unpublished',
        paymentProvider: 'unavailable',
        payoutPolicy: 'unpublished',
        payoutProvider: 'unavailable',
        taxAuthority: 'unavailable',
      },
      disputes: [],
      openDisputeTotals: [],
      payableTotals: [],
      payments: [],
      payouts: [],
      reconciliation: [],
      refunds: [],
      subscriptions: [],
    },
    identity: {
      attempts: [],
      expiredEvidence: [],
      outbox: [],
      provider: 'unavailable',
      providerEventBacklog: [],
      providerEvents: [],
    },
    media: {
      adapters: { scanner: 'unavailable', storage: 'unavailable' },
      assets: [],
      attention: [],
      backlogs: [],
      drift: [],
      liveMediaAvailable: false,
      objects: [],
      obligations: [],
    },
    notifications: {
      adapters: { deliveryChannel: 'unavailable' },
      attempts: [],
      backlogs: [],
      devices: [],
      failures: [],
      intents: [],
      providerEvents: [],
      suppressions: [],
    },
    refunds: {},
    rtc: {
      adapters: {
        eligibility: 'composed',
        provider: 'unavailable',
        signalTransport: 'in-process',
      },
      backlogs: [],
      calls: [],
      endedWithUndischargedTeardown: 0,
      liveCallingAvailable: false,
      providerEvents: [],
      providerObligations: [],
    },
    session: null,
  };
}

/**
 * A browser holding a consumer session on this origin.
 *
 * The realistic wrong-audience case: somebody signed in to VELORA and then
 * opened the console. Every privileged route refuses it, and the access page
 * says which audience it is looking at.
 */
export function consumerSessionState(): AdminApiDoubleState {
  return {
    ...anonymousState(),
    session: {
      absoluteExpiresAt: iso(28_800_000),
      accountId: operatorAccountId,
      assurance: 'single_factor',
      assuranceEstablishedAt: iso(),
      audience: 'consumer_web',
      authenticatedAt: iso(),
      idleExpiresAt: iso(1_800_000),
    },
  };
}

/**
 * A session the platform cannot currently issue.
 *
 * Used only to drive the console's own screens. It is not a claim that such a
 * session is obtainable: no route in the contract creates one, which is exactly
 * why the console behind it has no browser coverage and this double exists.
 */
export function privilegedState(): AdminApiDoubleState {
  return {
    ...anonymousState(),
    session: {
      absoluteExpiresAt: iso(3_600_000),
      accountId: operatorAccountId,
      assurance: 'phishing_resistant',
      assuranceEstablishedAt: iso(),
      audience: 'platform_admin',
      authenticatedAt: iso(),
      idleExpiresAt: iso(900_000),
    },
  };
}

export function createAdminApiDouble(
  initial: AdminApiDoubleState = anonymousState(),
): AdminApiDouble {
  const state: AdminApiDoubleState = { ...initial };
  const calls: AdminApiDouble['calls'] = [];
  const failures = new Map<string, number>();
  const refusals = new Map<string, { code: string; status: number }>();

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
      status,
    });
  const error = (status: number, code: string) =>
    json(status, { code, correlationId: 'test', message: 'Request failed' });

  const privileged = () =>
    state.session?.audience === 'platform_admin' &&
    state.session.assurance === 'phishing_resistant';

  const caseBody = (entry: AdminApiDoubleState['cases'][number]) => ({
    assigned: entry.assigned,
    ...(entry.assignmentExpiresAt === undefined
      ? {}
      : { assignmentExpiresAt: entry.assignmentExpiresAt }),
    id: entry.id,
    openedAt: entry.openedAt,
    policyVersion: entry.policyVersion,
    priority: entry.priority,
    queue: entry.queue,
    state: entry.state,
    targetId: entry.targetId,
    targetType: entry.targetType,
    version: entry.version,
  });

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
    calls.push({
      body,
      headers: Object.fromEntries(request.headers.entries()),
      method,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
    });

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

    if (path === '/v1/auth/session') {
      return state.session === null
        ? error(401, 'AUTH_REQUIRED')
        : json(200, state.session);
    }
    if (path === '/v1/auth/logout') {
      state.session = null;
      return json(200, { acknowledged: true });
    }

    // Every privileged route checks the audience and the assurance in that
    // order and collapses both into one answer, exactly as the server does:
    // which condition failed is not a caller's business.
    if (!path.startsWith('/v1/admin/')) return error(404, 'HTTP_404');
    if (state.session === null) return error(401, 'AUTH_REQUIRED');
    if (!privileged()) return error(403, 'ACTION_NOT_PERMITTED');

    if (path === '/v1/admin/billing/state') {
      return json(200, state.financial);
    }
    if (path === '/v1/admin/billing/refunds' && method === 'POST') {
      const key = request.headers.get('x-velora-idempotency-key') ?? '';
      const requested = body as { amountMinor: string; currency: string };
      const existing = state.refunds[key];
      if (existing !== undefined) {
        return json(201, {
          refund: {
            amount: {
              amountMinor: existing.amountMinor,
              currency: existing.currency,
            },
            createdAt: iso(),
            id: existing.id,
            paymentId: 'payment',
            reasonCode: 'operator_correction',
            state: 'requested',
            updatedAt: iso(),
          },
        });
      }
      const created = {
        amountMinor: requested.amountMinor,
        currency: requested.currency,
        id: `refund-${String(Object.keys(state.refunds).length + 1)}`,
      };
      state.refunds = { ...state.refunds, [key]: created };
      return json(201, {
        refund: {
          amount: {
            amountMinor: created.amountMinor,
            currency: created.currency,
          },
          createdAt: iso(),
          id: created.id,
          paymentId: 'payment',
          reasonCode: 'operator_correction',
          state: 'requested',
          updatedAt: iso(),
        },
      });
    }

    if (path === '/v1/admin/media/state') return json(200, state.media);
    if (path === '/v1/admin/notifications/state') {
      return json(200, state.notifications);
    }
    if (path === '/v1/admin/rtc/state') return json(200, state.rtc);
    if (path === '/v1/admin/identity/state') return json(200, state.identity);

    if (path === '/v1/admin/creators' && method === 'GET') {
      const search = url.searchParams.get('adminSearch');
      // `adminSearch` matches the beginning of a public handle and nothing
      // else, exactly as the server does.
      const rows = state.creators.filter(
        (creator) =>
          search === null || (creator.handle?.startsWith(search) ?? false),
      );
      return json(200, { creators: rows });
    }
    if (path.startsWith('/v1/admin/creators/') && method === 'POST') {
      const requested = body as { creatorId: string; reasonCode: string };
      const current = state.creators.find(
        (creator) => creator.id === requested.creatorId,
      );
      if (current === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      const suspending = path.endsWith('/suspension');
      const reinstating = path.endsWith('/reinstatement');
      const moved =
        suspending || reinstating
          ? {
              ...current,
              ...(suspending ? { suspendedAt: iso() } : {}),
              status: suspending ? ('suspended' as const) : ('active' as const),
            }
          : current;
      state.creators = state.creators.map((creator) =>
        creator.id === moved.id ? moved : creator,
      );
      return json(200, {
        creator: moved,
        disposition: suspending ? 'restrict' : 'lift',
        enforcementId: `enforcement-${moved.id}`,
        reasonCode: requested.reasonCode,
        recordedAt: iso(),
        scope: suspending ? 'creator_suspension' : 'account_restriction',
      });
    }

    if (path === '/v1/admin/safety/cases' && method === 'GET') {
      const queue = url.searchParams.get('moderationQueue');
      const rows = state.cases.filter(
        (entry) => queue === null || entry.queue === queue,
      );
      return json(200, { cases: rows.map((entry) => caseBody(entry)) });
    }
    if (path === '/v1/admin/safety/case' && method === 'GET') {
      const caseId = url.searchParams.get('caseId');
      const entry = state.cases.find((row) => row.id === caseId);
      if (entry === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      return json(200, {
        case: caseBody(entry),
        decisions: entry.decisions,
        evidence: entry.evidence,
        reports: entry.reports,
        truncated: false,
      });
    }
    if (path === '/v1/admin/safety/cases/claim' && method === 'POST') {
      const requested = body as { caseId: string };
      const entry = state.cases.find((row) => row.id === requested.caseId);
      if (entry === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      if (entry.assigned) return error(409, 'STATE_CONFLICT');
      const claimed = {
        ...entry,
        assigned: true,
        assignmentExpiresAt: iso(1_800_000),
      };
      state.cases = state.cases.map((row) =>
        row.id === claimed.id ? claimed : row,
      );
      return json(200, { case: caseBody(claimed) });
    }
    if (path === '/v1/admin/safety/cases/triage' && method === 'POST') {
      const requested = body as {
        caseId: string;
        priority: AdminApiDoubleState['cases'][number]['priority'];
        state: 'triaged' | 'investigating';
      };
      const entry = state.cases.find((row) => row.id === requested.caseId);
      if (entry === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      const moved = {
        ...entry,
        priority: requested.priority,
        state: requested.state,
        version: entry.version + 1,
      };
      state.cases = state.cases.map((row) =>
        row.id === moved.id ? moved : row,
      );
      return json(200, { case: caseBody(moved) });
    }
    if (path === '/v1/admin/safety/cases/decisions' && method === 'POST') {
      const requested = body as {
        action: string;
        caseId: string;
        evidenceIds: string[];
        expectedVersion: number;
        reasonCode: string;
        scope?: string;
      };
      const entry = state.cases.find((row) => row.id === requested.caseId);
      if (entry === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      // The version predicate is what settles two moderators deciding at once.
      if (entry.version !== requested.expectedVersion) {
        return error(409, 'STATE_CONFLICT');
      }
      const decision = {
        action: requested.action,
        decidedAt: iso(),
        evidenceIds: requested.evidenceIds,
        id: `decision-${String(entry.decisions.length + 1)}`,
        policyVersion: entry.policyVersion,
        reasonCode: requested.reasonCode,
        ...(requested.scope === undefined ? {} : { scope: requested.scope }),
      };
      const decided = {
        ...entry,
        decisions: [...entry.decisions, decision],
        state: 'decided' as const,
        version: entry.version + 1,
      };
      state.cases = state.cases.map((row) =>
        row.id === decided.id ? decided : row,
      );
      return json(200, { decision });
    }

    if (path === '/v1/admin/safety/appeals' && method === 'GET') {
      return json(200, { appeals: state.appeals });
    }
    if (path === '/v1/admin/safety/appeals/outcome' && method === 'POST') {
      const requested = body as {
        appealId: string;
        expectedVersion: number;
        outcome: 'upheld' | 'refused';
      };
      const entry = state.appeals.find((row) => row.id === requested.appealId);
      if (entry === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      if (entry.version !== requested.expectedVersion) {
        return error(409, 'STATE_CONFLICT');
      }
      const resolved = {
        ...entry,
        state: requested.outcome,
        version: entry.version + 1,
      };
      state.appeals = state.appeals.map((row) =>
        row.id === resolved.id ? resolved : row,
      );
      return json(200, { appeal: resolved });
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
