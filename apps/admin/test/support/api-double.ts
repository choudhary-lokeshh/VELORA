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
  /** Consumer accounts, and the whole population by standing beside them. */
  accounts: {
    createdAt: string;
    deletionRequestedAt?: string;
    id: string;
    region?: string;
    status:
      | 'pending_profile'
      | 'active'
      | 'restricted'
      | 'deletion_pending'
      | 'deactivated'
      | 'erased';
    statusChangedAt: string;
    statusReason?: string;
  }[];
  /** Both audit records, in the one flat shape the contract publishes. */
  audit: {
    actorReference?: string;
    audience?: string;
    correlationId?: string;
    id: string;
    occurredAt: string;
    outcome?: string;
    stream: 'security' | 'decision';
    subjectType?: string;
    what: string;
  }[];
  clubs: {
    closedAt?: string;
    createdAt: string;
    creatorId: string;
    handle?: string;
    id: string;
    lifecycle: string;
    memberships: { count: number; state: string }[];
    name: string;
    publishedAt?: string;
    slug: string;
  }[];
  /** Keyed by club, because they are published only for one club at a time. */
  clubMemberships: Record<
    string,
    {
      grantedAt: string;
      id: string;
      revokedAt?: string;
      source: string;
      state: string;
    }[]
  >;
  /** What the platform says is waiting, counted over whole tables. */
  overview: {
    attention: {
      accountsRestricted: number;
      appealsAwaiting: number;
      casesOpen: number;
      casesUnclaimed: number;
      creatorsSuspended: number;
      disputesOpen: number;
      financialRecordsNeedingPerson: number;
      payoutsAwaitingConfirmation: number;
    };
    casesByPriority: { count: number; state: string }[];
    casesByQueue: { count: number; state: string }[];
    observedAt: string;
    oldestOpenCaseAt?: string;
  };
  payments: {
    amountMinor: string;
    createdAt: string;
    currency: string;
    failureReason?: string;
    id: string;
    lastProviderSyncAt?: string;
    provider: string;
    providerReference?: string;
    resourceType?: string;
    state: string;
    taxMinor?: string;
    updatedAt: string;
  }[];
  /** Reversals, keyed by the payment they are against. */
  paymentRefunds: Record<
    string,
    {
      amountMinor: string;
      createdAt: string;
      currency: string;
      failureReason?: string;
      id: string;
      paymentId: string;
      provider: string;
      providerReference?: string;
      reasonCode: string;
      state: string;
      updatedAt: string;
    }[]
  >;
  payouts: {
    amountMinor: string;
    createdAt: string;
    creatorId: string;
    currency: string;
    failureReason?: string;
    id: string;
    lastProviderSyncAt?: string;
    provider: string;
    providerReference?: string;
    requestedBy: string;
    state: string;
    updatedAt: string;
  }[];
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
  /**
   * The cardholder claims an operator has to answer, in the wire shape.
   *
   * Nothing in the product originates one; these rows exist only because a
   * verified provider event created them, which is why the double holds them
   * rather than offering any way to make one.
   */
  disputeQueue: {
    amount: { amountMinor: string; currency: string };
    createdAt: string;
    evidenceDueAt?: string;
    id: string;
    openedAt: string;
    paymentId: string;
    providerReference: string;
    reasonCode: string;
    resolvedAt?: string;
    state: string;
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
   * The operator's own standing, and everything the control plane holds.
   *
   * Kept as state rather than as a fixed answer so a suite can drive the two
   * cases that matter: an operator who holds a capability and one who does not.
   * The console renders from this and the server refuses from it, which is what
   * makes "hiding a button is not authorization" testable rather than asserted.
   */
  operator: {
    capabilities: string[];
    environment: 'local' | 'test' | 'staging' | 'production';
    role?: string;
    source: 'grant' | 'bootstrap' | 'none';
  };
  controls: {
    changedBy?: string;
    enabled: boolean;
    key: string;
    reason?: string;
    summary: string;
    updatedAt?: string;
    version: number;
  }[];
  operatorActions: {
    action: string;
    actorReference: string;
    capability: string;
    failureCode?: string;
    id: string;
    occurredAt: string;
    outcome: string;
    previousState?: string;
    reason: string;
    requestedState?: string;
    subjectId?: string;
    subjectType: string;
  }[];
  operatorGrants: {
    grantedAt: string;
    grantedBy?: string;
    id: string;
    reason: string;
    revokedAt?: string;
    role: string;
    subjectReference: string;
  }[];
  activity: {
    actorId?: string;
    detail?: string;
    domain: string;
    id: string;
    occurredAt: string;
    resourceId?: string;
    resourceType?: string;
    subjectId?: string;
    type: string;
  }[];
  accountDetail: Record<string, unknown> | undefined;
  operations: {
    dependencies: { adapter?: string; name: string; state: string }[];
    failures: {
      category: string;
      domain: string;
      latestAt: string;
      total: number;
    }[];
    outboxes: {
      deadLettered: number;
      domain: string;
      oldestPendingAt?: string;
      pending: number;
    }[];
    queues: {
      active?: number;
      completed?: number;
      delayed?: number;
      failed?: number;
      name: string;
      reachable: boolean;
      waiting?: number;
    }[];
  };
  live: {
    encounterStarts: { label: string; total: number }[];
    endReasons: { label: string; total: number }[];
    liveEncounters: number;
    oldestSearchSince?: string;
    participations: { label: string; total: number }[];
    premiumWindows: { label: string; total: number }[];
    searchAdmitted: boolean;
  };
  publicEntry: {
    canonicalOrigin?: string;
    environment: 'local' | 'test' | 'staging' | 'production';
    indexable: boolean;
    liveWindows: { active: number; cancelled: number; upcoming: number };
    publishedClubs: number;
    publishedCreators: number;
  };
  reconciliation: {
    definition: string;
    examples: string[];
    key: string;
    total: number;
  }[];
  wallet:
    | {
        available: string;
        entries: {
          amount: string;
          businessType: string;
          direction: string;
          occurredAt: string;
          reason: string;
          transactionId: string;
        }[];
        entriesTotal: string;
        reserved: string;
        userId: string;
      }
    | undefined;
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
    accounts: [],
    appeals: [],
    audit: [],
    cases: [],
    clubMemberships: {},
    clubs: [],
    creators: [],
    disputeQueue: [],
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
    overview: {
      attention: {
        accountsRestricted: 0,
        appealsAwaiting: 0,
        casesOpen: 0,
        casesUnclaimed: 0,
        creatorsSuspended: 0,
        disputesOpen: 0,
        financialRecordsNeedingPerson: 0,
        payoutsAwaitingConfirmation: 0,
      },
      casesByPriority: [],
      casesByQueue: [],
      observedAt: iso(),
    },
    paymentRefunds: {},
    payments: [],
    payouts: [],
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
    // Everything an ungranted operator holds: nothing. A suite that wants
    // capabilities grants them explicitly, which is what makes a test about a
    // refusal impossible to write by accident.
    operator: { capabilities: [], environment: 'test', source: 'none' },
    controls: [
      {
        enabled: true,
        key: 'live.search',
        summary:
          'Admits new live searches. Encounters already running continue.',
        version: 0,
      },
      {
        enabled: true,
        key: 'growth.invitations',
        summary:
          'Mints new invitation links. Links already shared keep working.',
        version: 0,
      },
      {
        enabled: true,
        key: 'growth.scheduled_windows',
        summary: 'Publishes scheduled live windows on public surfaces.',
        version: 0,
      },
    ],
    operatorActions: [],
    operatorGrants: [],
    activity: [],
    accountDetail: undefined,
    operations: {
      dependencies: [
        { name: 'database', state: 'healthy' },
        {
          adapter: 'unavailable',
          name: 'payment provider',
          state: 'unconfigured',
        },
      ],
      failures: [],
      outboxes: [{ deadLettered: 0, domain: 'billing', pending: 0 }],
      queues: [],
    },
    live: {
      encounterStarts: [],
      endReasons: [],
      liveEncounters: 0,
      participations: [],
      premiumWindows: [],
      searchAdmitted: true,
    },
    publicEntry: {
      environment: 'test',
      indexable: false,
      liveWindows: { active: 0, cancelled: 0, upcoming: 0 },
      publishedClubs: 0,
      publishedCreators: 0,
    },
    reconciliation: [],
    wallet: undefined,
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
    if (state.session === null) return error(401, 'AUTH_REQUIRED');
    if (!privileged()) return error(403, 'ACTION_NOT_PERMITTED');

    if (path === '/v1/ai/suggestions' && method === 'POST') {
      const input = body as {
        capability: string;
        context?: string;
        draft: string;
        runId: string;
      };
      const suggestedText = `AI-generated record summary: ${input.context ?? 'No metadata supplied.'}`;
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

    if (!path.startsWith('/v1/admin/')) return error(404, 'HTTP_404');

    if (path === '/v1/admin/operator') {
      // The one operator route that needs no capability, because it is how the
      // console learns what to draw. It reports only the caller's own standing.
      return json(200, {
        capabilities: state.operator.capabilities,
        environment: state.operator.environment,
        ...(state.operator.role === undefined
          ? {}
          : { role: state.operator.role }),
        source: state.operator.source,
      });
    }

    /**
     * Every route below this line authorizes against a capability, exactly as
     * the server does — and answers the same `403` for a missing capability as
     * for a wrong audience, because which condition failed is not a caller's
     * business.
     *
     * This is what makes "hiding a button is not authorization" testable: a
     * suite can render a console whose operator holds nothing, press whatever
     * it can reach, and watch the platform refuse.
     */
    const holds = (capability: string) =>
      state.operator.capabilities.includes(capability);

    if (path === '/v1/admin/controls') {
      if (method === 'GET') {
        if (!holds('config.read')) return error(403, 'ACTION_NOT_PERMITTED');
        return json(200, {
          controls: state.controls,
          propagationMilliseconds: 5000,
        });
      }
      if (!holds('config.write')) return error(403, 'ACTION_NOT_PERMITTED');
      const requested = body as {
        enabled: boolean;
        expectedVersion: number;
        key: string;
        reason: string;
      };
      const current = state.controls.find(
        (control) => control.key === requested.key,
      );
      if (current === undefined) return error(422, 'VALIDATION_FAILED');
      if (current.version !== requested.expectedVersion) {
        // A conflict is answered with the value that actually stands, so the
        // console can show the operator what they were racing.
        state.operatorActions = [
          {
            action: 'control.set',
            actorReference: 'session:test',
            capability: 'config.write',
            failureCode: 'STATE_CONFLICT',
            id: `action-${String(state.operatorActions.length + 1)}`,
            occurredAt: iso(),
            outcome: 'refused',
            previousState: current.enabled ? 'enabled' : 'disabled',
            reason: requested.reason,
            requestedState: requested.enabled ? 'enabled' : 'disabled',
            subjectId: requested.key,
            subjectType: 'control',
          },
          ...state.operatorActions,
        ];
        return json(200, {
          control: current,
          outcome: 'conflict',
          propagationMilliseconds: 5000,
        });
      }
      const updated = {
        ...current,
        changedBy: 'session:test',
        enabled: requested.enabled,
        reason: requested.reason,
        updatedAt: iso(),
        version: current.version + 1,
      };
      state.controls = state.controls.map((control) =>
        control.key === updated.key ? updated : control,
      );
      state.operatorActions = [
        {
          action: 'control.set',
          actorReference: 'session:test',
          capability: 'config.write',
          id: `action-${String(state.operatorActions.length + 1)}`,
          occurredAt: iso(),
          outcome: 'applied',
          previousState: current.enabled ? 'enabled' : 'disabled',
          reason: requested.reason,
          requestedState: requested.enabled ? 'enabled' : 'disabled',
          subjectId: requested.key,
          subjectType: 'control',
        },
        ...state.operatorActions,
      ];
      return json(200, {
        control: updated,
        outcome: 'applied',
        propagationMilliseconds: 5000,
      });
    }

    if (path === '/v1/admin/operator-actions') {
      if (!holds('audit.read')) return error(403, 'ACTION_NOT_PERMITTED');
      const outcome = url.searchParams.get('outcome');
      const action = url.searchParams.get('action');
      return json(200, {
        actions: state.operatorActions.filter(
          (entry) =>
            (outcome === null || entry.outcome === outcome) &&
            (action === null || entry.action === action),
        ),
        since: iso(-604_800_000),
      });
    }

    if (path === '/v1/admin/operators') {
      if (!holds('operators.manage')) return error(403, 'ACTION_NOT_PERMITTED');
      return json(200, {
        catalogue: [
          { capabilities: ['users.read'], role: 'readonly' },
          {
            capabilities: ['users.read', 'config.write'],
            role: 'operations',
          },
        ],
        grants: state.operatorGrants,
      });
    }

    if (path === '/v1/admin/operators/role' && method === 'POST') {
      if (!holds('operators.manage')) return error(403, 'ACTION_NOT_PERMITTED');
      const requested = body as {
        reason: string;
        role?: string;
        subjectReference: string;
      };
      state.operatorGrants = state.operatorGrants.map((grant) =>
        grant.subjectReference === requested.subjectReference &&
        grant.revokedAt === undefined
          ? { ...grant, revokedAt: iso() }
          : grant,
      );
      if (requested.role === undefined) {
        return json(200, { outcome: 'revoked' });
      }
      const grant = {
        grantedAt: iso(),
        grantedBy: 'session:test',
        id: `grant-${String(state.operatorGrants.length + 1)}`,
        reason: requested.reason,
        role: requested.role,
        subjectReference: requested.subjectReference,
      };
      state.operatorGrants = [grant, ...state.operatorGrants];
      return json(200, { grant, outcome: 'granted' });
    }

    if (path === '/v1/admin/activity') {
      if (!holds('operations.read')) return error(403, 'ACTION_NOT_PERMITTED');
      const domain = url.searchParams.get('domain');
      return json(200, {
        entries: state.activity.filter(
          (entry) => domain === null || entry.domain === domain,
        ),
        since: iso(-86_400_000),
        until: iso(),
      });
    }

    if (path === '/v1/admin/search') {
      if (!holds('operations.read')) return error(403, 'ACTION_NOT_PERMITTED');
      const term = url.searchParams.get('term') ?? '';
      const account = state.accounts.find((entry) => entry.id === term);
      return json(200, {
        matches:
          account === undefined
            ? []
            : [{ context: account.status, id: account.id, kind: 'account' }],
      });
    }

    if (path === '/v1/admin/accounts/detail') {
      if (!holds('users.read')) return error(403, 'ACTION_NOT_PERMITTED');
      if (state.accountDetail === undefined) {
        return error(404, 'RESOURCE_NOT_FOUND');
      }
      return json(200, state.accountDetail);
    }

    if (path === '/v1/admin/accounts/timeline') {
      if (!holds('users.read')) return error(403, 'ACTION_NOT_PERMITTED');
      return json(200, {
        entries: state.activity,
        since: iso(-86_400_000),
        until: iso(),
      });
    }

    if (path === '/v1/admin/accounts/session-revocation' && method === 'POST') {
      if (!holds('sessions.revoke')) return error(403, 'ACTION_NOT_PERMITTED');
      const requested = body as { accountId: string; reason: string };
      state.operatorActions = [
        {
          action: 'sessions.revoked',
          actorReference: 'session:test',
          capability: 'sessions.revoke',
          id: `action-${String(state.operatorActions.length + 1)}`,
          occurredAt: iso(),
          outcome: 'applied',
          reason: requested.reason,
          requestedState: 'sessions:2',
          subjectId: requested.accountId,
          subjectType: 'account',
        },
        ...state.operatorActions,
      ];
      return json(200, { families: 1, sessions: 2 });
    }

    if (path === '/v1/admin/operations/state') {
      if (!holds('operations.read')) return error(403, 'ACTION_NOT_PERMITTED');
      return json(200, {
        dependencies: state.operations.dependencies,
        failures: state.operations.failures,
        observedAt: iso(),
        outboxes: state.operations.outboxes,
        queues: state.operations.queues,
        since: iso(-86_400_000),
      });
    }

    if (path === '/v1/admin/live/state') {
      if (!holds('live.read')) return error(403, 'ACTION_NOT_PERMITTED');
      return json(200, {
        encounterStarts: state.live.encounterStarts,
        endReasons: state.live.endReasons,
        liveEncounters: state.live.liveEncounters,
        observedAt: iso(),
        ...(state.live.oldestSearchSince === undefined
          ? {}
          : { oldestSearchSince: state.live.oldestSearchSince }),
        participations: state.live.participations,
        premiumWindows: state.live.premiumWindows,
        searchAdmitted: state.live.searchAdmitted,
        since: iso(-86_400_000),
      });
    }

    if (path === '/v1/admin/public-entry') {
      if (!holds('growth.read')) return error(403, 'ACTION_NOT_PERMITTED');
      return json(200, { ...state.publicEntry, observedAt: iso() });
    }

    if (path === '/v1/admin/commerce/reconciliation') {
      if (!holds('billing.read')) return error(403, 'ACTION_NOT_PERMITTED');
      return json(200, {
        findings: state.reconciliation,
        observedAt: iso(),
      });
    }

    if (path === '/v1/admin/wallet') {
      if (!holds('wallet.read')) return error(403, 'ACTION_NOT_PERMITTED');
      if (state.wallet === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      return json(200, state.wallet);
    }

    if (path === '/v1/admin/overview') {
      return json(200, state.overview);
    }

    if (path === '/v1/admin/accounts') {
      const asked = url.searchParams.get('status');
      const attention = new Set([
        'restricted',
        'deletion_pending',
        'deactivated',
        'erased',
      ]);
      const counts = new Map<string, number>();
      for (const account of state.accounts) {
        counts.set(account.status, (counts.get(account.status) ?? 0) + 1);
      }
      return json(200, {
        // With no status asked for, only what the platform has decided about:
        // the same bound the server applies, so a test that passes here is a
        // test about the screen rather than about the double.
        accounts: state.accounts.filter((account) =>
          asked === null
            ? attention.has(account.status)
            : account.status === asked,
        ),
        statusCounts: [...counts]
          .map(([entry, count]) => ({ count, state: entry }))
          .sort((first, second) => first.state.localeCompare(second.state)),
      });
    }

    if (path === '/v1/admin/clubs') {
      const clubId = url.searchParams.get('clubId');
      const clubs =
        clubId === null
          ? state.clubs
          : state.clubs.filter((club) => club.id === clubId);
      return json(200, {
        clubs,
        ...(clubId === null
          ? {}
          : { memberships: state.clubMemberships[clubId] ?? [] }),
      });
    }

    if (path === '/v1/admin/audit') {
      const stream = url.searchParams.get('stream') ?? 'security';
      return json(200, {
        entries: state.audit.filter((entry) => entry.stream === stream),
        stream,
      });
    }

    if (path === '/v1/admin/billing/payments') {
      const asked = url.searchParams.get('state');
      return json(200, {
        payments: state.payments.filter(
          (payment) => asked === null || payment.state === asked,
        ),
      });
    }

    if (path === '/v1/admin/billing/payment') {
      const paymentId = url.searchParams.get('paymentId') ?? '';
      const payment = state.payments.find((row) => row.id === paymentId);
      if (payment === undefined) return error(404, 'RESOURCE_NOT_FOUND');
      return json(200, {
        disputes: state.disputeQueue.filter(
          (dispute) => dispute.paymentId === paymentId,
        ),
        payment,
        refunds: state.paymentRefunds[paymentId] ?? [],
      });
    }

    if (path === '/v1/admin/payouts') {
      const asked = url.searchParams.get('state');
      return json(200, {
        payouts: state.payouts.filter(
          (payout) => asked === null || payout.state === asked,
        ),
      });
    }

    if (path === '/v1/admin/billing/disputes') {
      const openOnly = url.searchParams.get('open') === 'true';
      const openStates = new Set(['opened', 'under_review']);
      return json(200, {
        disputes: state.disputeQueue.filter(
          (dispute) => !openOnly || openStates.has(dispute.state),
        ),
        readiness: {
          currencies: [],
          enabled: false,
          intervals: [],
          modes: [],
          source: 'unpublished',
        },
      });
    }
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
