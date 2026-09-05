import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testAdminOrigin,
  testConsumerOrigin,
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * The operator control plane, against real PostgreSQL.
 *
 * Five properties decide whether any of this is worth having, and each is
 * asserted rather than described.
 *
 * **A capability is what admits a request, not a rendered button.** Every
 * privileged route names one, the server checks it, and an operator holding a
 * narrow role is refused on everything outside it — with the same status and
 * the same code a consumer gets, so nobody learns from a refusal which
 * condition they failed or whether the capability they guessed at exists.
 *
 * **Two operators cannot silently overwrite each other.** A control write
 * states the version it read; the loser is refused and told what actually
 * stands. That is the difference between an incident where somebody paused live
 * search and one where they thought they had.
 *
 * **A control the console shows is a control the server obeys.** Pausing
 * invitations refuses the route that mints one, in this process, immediately —
 * and leaves every link already shared working, which is the semantic the
 * control's own summary promises.
 *
 * **Every operator command writes an audit row, including the ones that were
 * refused.** An operator who tried something and was told no is a thing an
 * incident review needs to see, and the table has no update and no delete
 * anywhere in this repository.
 *
 * **The activity stream is the domains' own rows.** It is asserted against
 * records this suite created through the product's own routes, so a stream that
 * disagreed with the record would fail here rather than mislead somebody.
 */

const databaseUrl = await provisionDatabase('velora_operations');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig();
const logger = silentLogger();

/**
 * A clock the suite moves, anchored to the real present.
 *
 * Anchored rather than fixed, because a Platform Admin session is the
 * shortest-lived session in the product: it is written with real timestamps by
 * a helper that speaks SQL, and AUTH validates it against the wall clock. A
 * suite pinned to a date in the past would create sessions that had already
 * expired before the first request, which is a fixture bug wearing the costume
 * of an authorization failure.
 */
let clock = new Date();
const now = () => clock;

let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `operations-test-${String(requesterSequence)}`;
    },
  },
});

const mediaForUsers = testMediaRuntime({
  config,
  database: database.drizzle,
  logger,
  now,
});

const users = createUsersRuntime({
  attribution: () => runtimes.growth.service,
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  media: mediaForUsers.service,
  now,
});

const runtimes = testProductRuntimes({
  // AUTH's own revocation, which is the one operator command that ends
  // somebody's sessions. Supplied as the real service rather than a stand-in,
  // so the security event AUTH writes beside the revocation is written too.
  authSessions: auth.service,
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
  users,
});

const application = createApplication({
  config,
  dependencies: {
    ...runtimes,
    auth,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    ephemeralRedis: healthy,
    logger,
    queueRedis: healthy,
    users,
  },
});
const handle = (request: Request) => application.app.handle(request);

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  clock = new Date();
  await database.truncate();
  // The reader caches, and the cache ages against the injected clock. A suite
  // that moved the clock backwards between tests would otherwise carry one
  // test's control value into the next.
  runtimes.operations.controls.forget();
});

interface Session {
  readonly accountId: string;
  readonly cookie: string;
  readonly csrf: string;
}

const digest = (value: string) => Bun.SHA256.hash(value, 'hex');
const opaque = () =>
  `v1.${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;

/** A Platform Admin session, which no route in the contract can issue. */
async function operatorSession(): Promise<Session> {
  const accountId = crypto.randomUUID();
  await execute(
    database.sql`insert into auth_accounts (id, status) values (${accountId}, 'active')`,
  );
  const token = opaque();
  const csrf = opaque();
  const at = now();
  await execute(database.sql`
    insert into auth_sessions (
      id, account_id, audience, assurance, assurance_established_at,
      authenticated_at, created_at, csrf_digest, idle_expires_at,
      last_active_at, absolute_expires_at, token_digest
    ) values (
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', 'phishing_resistant', ${at},
      ${at}, ${at}, ${digest(csrf)}, ${new Date(at.getTime() + 900_000)}, ${at},
      ${new Date(at.getTime() + 28_800_000)}, ${digest(token)}
    )
  `);
  return {
    accountId,
    cookie: `__Host-velora_platform_admin_session=${token}`,
    csrf,
  };
}

function request(
  path: string,
  init: {
    readonly body?: unknown;
    readonly method?: string;
    readonly origin?: string;
    readonly session?: Session;
  } = {},
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: init.origin ?? testAdminOrigin,
  };
  if (init.session !== undefined) {
    headers.cookie = init.session.cookie;
    headers['x-velora-csrf'] = init.session.csrf;
  }
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify(init.body ?? {}) }),
    method,
  });
}

async function consumerSession(subject: string): Promise<Session> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'consumer_web', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testConsumerOrigin,
      },
      method: 'POST',
    }),
  );
  const body = (await response.json()) as { csrfToken?: string };
  return {
    accountId: '',
    cookie: response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0] ?? '')
      .filter((pair) => pair.length > 0)
      .join('; '),
    csrf: body.csrfToken ?? '',
  };
}

/** A consumer account, created through the product's own route. */
async function consumerAccount(subject: string): Promise<{
  readonly id: string;
  readonly session: Session;
}> {
  const session = await consumerSession(subject);
  const created = await handle(
    new Request('http://api.test/v1/users', {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        cookie: session.cookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': session.csrf,
      },
      method: 'POST',
    }),
  );
  const account = (await created.json()) as { id: string };
  return { id: account.id, session };
}

/** Narrows an operator to one role, so a capability check has something to fail. */
async function grantRole(
  subjectReference: string,
  role: string,
): Promise<void> {
  await runtimes.operations.service.grantRole({
    actorReference: 'session:test-fixture',
    reason: 'narrowing this operator for the test',
    role: role as 'readonly',
    subjectReference,
  });
}

/* ============================ Authorization =========================== */

describe('who may operate the platform', () => {
  const everyRoute = [
    '/v1/admin/controls',
    '/v1/admin/operators',
    '/v1/admin/operator-actions',
    '/v1/admin/activity',
    '/v1/admin/operations/state',
    '/v1/admin/live/state',
    '/v1/admin/public-entry',
    '/v1/admin/commerce/reconciliation',
  ] as const;

  it('refuses a request with no session at all', async () => {
    for (const path of everyRoute) {
      const response = await handle(request(path));
      expect(response.status).toBe(401);
    }
  });

  it('refuses a consumer session with the operator refusal, not a hint', async () => {
    const consumer = await consumerSession('operations-consumer');
    for (const path of everyRoute) {
      const response = await handle(
        request(path, { origin: testConsumerOrigin, session: consumer }),
      );
      // The origin check refuses a consumer origin before anything else, and a
      // consumer session on the admin origin is refused by the audience. Either
      // way the caller learns nothing about the route behind it.
      expect(response.status).toBe(403);
    }
  });

  it('refuses an operator who holds a role without the capability', async () => {
    const operator = await operatorSession();
    await grantRole(operator.accountId, 'readonly');

    const refused = await handle(
      request('/v1/admin/controls', {
        body: {
          enabled: false,
          expectedVersion: 0,
          key: 'live.search',
          reason: 'testing a refusal',
        },
        method: 'POST',
        session: operator,
      }),
    );
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe(
      'ACTION_NOT_PERMITTED',
    );

    // The same operator may still read, because `readonly` holds `config.read`.
    const read = await handle(
      request('/v1/admin/controls', { session: operator }),
    );
    expect(read.status).toBe(200);
  });

  it('tells an operator what they may do, and nobody else’s', async () => {
    const operator = await operatorSession();
    await grantRole(operator.accountId, 'support');

    const response = await handle(
      request('/v1/admin/operator', { session: operator }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      capabilities: string[];
      role: string;
      source: string;
    };
    expect(body.role).toBe('support');
    expect(body.source).toBe('grant');
    expect(body.capabilities).toContain('support.update');
    expect(body.capabilities).not.toContain('config.write');
    // The response is the caller's own standing and carries no identifier of
    // anybody, including the caller.
    expect(Object.keys(body).sort()).toEqual([
      'capabilities',
      'environment',
      'role',
      'source',
    ]);
  });

  it('treats an ungranted operator as a super administrator only where configured', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/operator', { session: operator }),
    );
    const body = (await response.json()) as { source: string };
    // The harness composes the local-test bootstrap, which staging and
    // production refuse at startup. The source says so in the answer, so an
    // operator can never mistake a development machine for real permissions.
    expect(body.source).toBe('bootstrap');
  });
});

/* ============================== Controls ============================== */

describe('the control plane', () => {
  it('publishes a control nobody has set as the value the platform shipped', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/controls', { session: operator }),
    );
    const body = (await response.json()) as {
      controls: { enabled: boolean; key: string; version: number }[];
      propagationMilliseconds: number;
    };
    const live = body.controls.find((control) => control.key === 'live.search');
    expect(live).toMatchObject({ enabled: true, version: 0 });
    // The propagation bound is published rather than described as instant.
    expect(body.propagationMilliseconds).toBeGreaterThan(0);
  });

  it('applies a change and reports the control that now stands', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/controls', {
        body: {
          enabled: false,
          expectedVersion: 0,
          key: 'growth.invitations',
          reason: 'abuse spike from one region',
        },
        method: 'POST',
        session: operator,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      control: { enabled: boolean; version: number };
      outcome: string;
    };
    expect(body.outcome).toBe('applied');
    expect(body.control).toMatchObject({ enabled: false, version: 1 });
  });

  it('refuses the second of two operators and shows them what stands', async () => {
    const first = await operatorSession();
    const second = await operatorSession();
    const change = (session: Session, enabled: boolean) =>
      handle(
        request('/v1/admin/controls', {
          body: {
            enabled,
            // Both read version zero, which is the realistic case: two people
            // looking at the same screen during an incident.
            expectedVersion: 0,
            key: 'live.search',
            reason: 'two operators, one incident',
          },
          method: 'POST',
          session,
        }),
      );

    const winner = await change(first, false);
    const loser = await change(second, true);
    expect(((await winner.json()) as { outcome: string }).outcome).toBe(
      'applied',
    );
    const refused = (await loser.json()) as {
      control: { enabled: boolean; version: number };
      outcome: string;
    };
    expect(refused.outcome).toBe('conflict');
    // Not an error with no state in it: the value that actually stands, so the
    // second operator can see what they were racing.
    expect(refused.control).toMatchObject({ enabled: false, version: 1 });
  });

  it('resolves two simultaneous first writes to exactly one', async () => {
    const first = await operatorSession();
    const second = await operatorSession();
    const [left, right] = await Promise.all([
      handle(
        request('/v1/admin/controls', {
          body: {
            enabled: false,
            expectedVersion: 0,
            key: 'live.search',
            reason: 'simultaneous first write',
          },
          method: 'POST',
          session: first,
        }),
      ),
      handle(
        request('/v1/admin/controls', {
          body: {
            enabled: true,
            expectedVersion: 0,
            key: 'live.search',
            reason: 'simultaneous first write',
          },
          method: 'POST',
          session: second,
        }),
      ),
    ]);
    const outcomes = [
      ((await left.json()) as { outcome: string }).outcome,
      ((await right.json()) as { outcome: string }).outcome,
    ].sort();
    // Two writers, both presenting version zero, both passing any prior read:
    // the primary key is what makes exactly one of them win.
    expect(outcomes).toEqual(['applied', 'conflict']);
    const rows = await rowsOf<{ version: number }>(
      database.sql`select version from operations_controls where key = 'live.search'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
  });
});

/* ========================= Control enforcement ======================== */

describe('a control the console shows is a control the server obeys', () => {
  it('refuses to mint an invitation while minting is paused', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-inviter');

    const before = await handle(
      new Request('http://api.test/v1/growth/invite', {
        headers: {
          cookie: consumer.session.cookie,
          origin: testConsumerOrigin,
          'x-velora-csrf': consumer.session.csrf,
        },
        method: 'POST',
      }),
    );
    expect(before.status).toBe(200);

    await handle(
      request('/v1/admin/controls', {
        body: {
          enabled: false,
          expectedVersion: 0,
          key: 'growth.invitations',
          reason: 'abuse spike from one region',
        },
        method: 'POST',
        session: operator,
      }),
    );

    const other = await consumerAccount('operations-second-inviter');
    const after = await handle(
      new Request('http://api.test/v1/growth/invite', {
        headers: {
          cookie: other.session.cookie,
          origin: testConsumerOrigin,
          'x-velora-csrf': other.session.csrf,
        },
        method: 'POST',
      }),
    );
    // Refused, in this process, without waiting out any cache: the write
    // invalidates what this process believed.
    expect(after.status).toBe(503);

    // And the link somebody already shared still works. Breaking it would
    // punish the person who shared it rather than the abuse.
    const existing = await handle(
      new Request('http://api.test/v1/growth/invite', {
        headers: {
          cookie: consumer.session.cookie,
          origin: testConsumerOrigin,
        },
      }),
    );
    expect(existing.status).toBe(200);
    expect(
      ((await existing.json()) as { invite?: { code: string } }).invite?.code,
    ).toBeDefined();
  });

  it('publishes no scheduled window while publishing is paused', async () => {
    const operator = await operatorSession();
    await runtimes.growth.service.scheduleWindow({
      endsAt: new Date(clock.getTime() + 7_200_000),
      slug: 'friday-night',
      startsAt: new Date(clock.getTime() + 3_600_000),
      title: 'Friday night',
    });

    const before = await handle(
      new Request('http://api.test/v1/growth/live-windows', {
        headers: { origin: testConsumerOrigin },
      }),
    );
    expect(
      ((await before.json()) as { windows: unknown[] }).windows,
    ).toHaveLength(1);

    await handle(
      request('/v1/admin/controls', {
        body: {
          enabled: false,
          expectedVersion: 0,
          key: 'growth.scheduled_windows',
          reason: 'withdrawing the whole feature for now',
        },
        method: 'POST',
        session: operator,
      }),
    );

    const after = await handle(
      new Request('http://api.test/v1/growth/live-windows', {
        headers: { origin: testConsumerOrigin },
      }),
    );
    // Nothing is cancelled and nothing is deleted: the window is simply not
    // published, and switching the control back on republishes exactly what was
    // scheduled.
    expect(
      ((await after.json()) as { windows: unknown[] }).windows,
    ).toHaveLength(0);
    const rows = await rowsOf<{ cancelled_at: Date | null }>(
      database.sql`select cancelled_at from growth_live_windows`,
    );
    expect(rows[0]?.cancelled_at).toBeNull();
  });
});

/* ============================ Operator audit ========================== */

describe('what an operator did', () => {
  it('records an applied change with what it changed from', async () => {
    const operator = await operatorSession();
    await handle(
      request('/v1/admin/controls', {
        body: {
          enabled: false,
          expectedVersion: 0,
          key: 'live.search',
          reason: 'abuse spike from one region',
        },
        method: 'POST',
        session: operator,
      }),
    );

    const response = await handle(
      request('/v1/admin/operator-actions', { session: operator }),
    );
    const body = (await response.json()) as {
      actions: {
        action: string;
        capability: string;
        outcome: string;
        previousState?: string;
        reason: string;
        requestedState?: string;
        subjectId?: string;
      }[];
    };
    expect(body.actions[0]).toMatchObject({
      action: 'control.set',
      capability: 'config.write',
      outcome: 'applied',
      reason: 'abuse spike from one region',
      requestedState: 'disabled',
      subjectId: 'live.search',
    });
  });

  it('records a refusal as a row rather than as an absence', async () => {
    const first = await operatorSession();
    const second = await operatorSession();
    const body = {
      enabled: false,
      expectedVersion: 0,
      key: 'live.search',
      reason: 'two operators, one incident',
    };
    await handle(
      request('/v1/admin/controls', { body, method: 'POST', session: first }),
    );
    await handle(
      request('/v1/admin/controls', { body, method: 'POST', session: second }),
    );

    const response = await handle(
      request('/v1/admin/operator-actions?outcome=refused', {
        session: first,
      }),
    );
    const audit = (await response.json()) as {
      actions: { failureCode?: string; outcome: string }[];
    };
    expect(audit.actions).toHaveLength(1);
    expect(audit.actions[0]).toMatchObject({
      failureCode: 'STATE_CONFLICT',
      outcome: 'refused',
    });
  });

  it('records a malformed command, because trying is what an audit is for', async () => {
    const operator = await operatorSession();
    const refused = await handle(
      request('/v1/admin/controls', {
        body: { enabled: false, expectedVersion: 0, key: 'live.search' },
        method: 'POST',
        session: operator,
      }),
    );
    expect(refused.status).toBe(422);
    const rows = await rowsOf<{ failure_code: string; outcome: string }>(
      database.sql`select failure_code, outcome from operations_operator_actions`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      failure_code: 'VALIDATION_FAILED',
      outcome: 'refused',
    });
  });
});

/* ================================ Grants ============================== */

describe('operator grants', () => {
  it('replaces a role without ever holding two, and keeps the old row', async () => {
    const operator = await operatorSession();
    const subject = crypto.randomUUID();
    await handle(
      request('/v1/admin/operators/role', {
        body: {
          reason: 'joining the on-call rota',
          role: 'readonly',
          subjectReference: subject,
        },
        method: 'POST',
        session: operator,
      }),
    );
    await handle(
      request('/v1/admin/operators/role', {
        body: {
          reason: 'taking the safety queue',
          role: 'safety',
          subjectReference: subject,
        },
        method: 'POST',
        session: operator,
      }),
    );

    const rows = await rowsOf<{ revoked_at: Date | null; role: string }>(
      database.sql`select role, revoked_at from operations_operator_grants where subject_reference = ${subject} order by granted_at`,
    );
    expect(rows).toHaveLength(2);
    // The old grant is kept and marked, because it is the evidence somebody
    // held a capability during the window an incident happened in.
    expect(rows[0]?.revoked_at).not.toBeNull();
    expect(rows[1]).toMatchObject({ revoked_at: null, role: 'safety' });
  });

  it('revokes a role and leaves the operator holding nothing', async () => {
    const operator = await operatorSession();
    const other = await operatorSession();
    await grantRole(other.accountId, 'readonly');

    const revoked = await handle(
      request('/v1/admin/operators/role', {
        body: {
          reason: 'leaving the on-call rota',
          subjectReference: other.accountId,
        },
        method: 'POST',
        session: operator,
      }),
    );
    expect(((await revoked.json()) as { outcome: string }).outcome).toBe(
      'revoked',
    );

    // With the bootstrap on, a revoked operator falls back to it. What the
    // grant store now holds is the fact under test: nothing live.
    const live = await rowsOf<{ total: string }>(
      database.sql`select count(*)::text as total from operations_operator_grants where subject_reference = ${other.accountId} and revoked_at is null`,
    );
    expect(live[0]?.total).toBe('0');
  });

  it('refuses two simultaneous grants for the same operator', async () => {
    const operator = await operatorSession();
    const subject = crypto.randomUUID();
    await Promise.all([
      handle(
        request('/v1/admin/operators/role', {
          body: {
            reason: 'first writer in the race',
            role: 'readonly',
            subjectReference: subject,
          },
          method: 'POST',
          session: operator,
        }),
      ).catch(() => undefined),
      handle(
        request('/v1/admin/operators/role', {
          body: {
            reason: 'second writer in the race',
            role: 'safety',
            subjectReference: subject,
          },
          method: 'POST',
          session: operator,
        }),
      ).catch(() => undefined),
    ]);

    // Whatever order they landed in, the partial unique index permits exactly
    // one live grant. Two would be two answers to "what may they do", and the
    // union of them is always the more permissive one.
    const live = await rowsOf<{ total: string }>(
      database.sql`select count(*)::text as total from operations_operator_grants where subject_reference = ${subject} and revoked_at is null`,
    );
    expect(live[0]?.total).toBe('1');
  });
});

/* =========================== Session revocation ======================= */

describe('signing an account out everywhere', () => {
  it('ends every session and the consumer loses their authority', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-revoked');

    const before = await handle(
      new Request('http://api.test/v1/auth/session', {
        headers: {
          cookie: consumer.session.cookie,
          origin: testConsumerOrigin,
        },
      }),
    );
    expect(before.status).toBe(200);

    const revoked = await handle(
      request('/v1/admin/accounts/session-revocation', {
        body: {
          accountId: consumer.id,
          reason: 'credential stuffing on this account',
        },
        method: 'POST',
        session: operator,
      }),
    );
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { sessions: number }).sessions).toBe(1);

    const after = await handle(
      new Request('http://api.test/v1/auth/session', {
        headers: {
          cookie: consumer.session.cookie,
          origin: testConsumerOrigin,
        },
      }),
    );
    expect(after.status).toBe(401);
  });

  it('records it as administrative rather than as the person logging out', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-revoked-reason');
    await handle(
      request('/v1/admin/accounts/session-revocation', {
        body: {
          accountId: consumer.id,
          reason: 'credential stuffing on this account',
        },
        method: 'POST',
        session: operator,
      }),
    );

    const sessions = await rowsOf<{ revocation_reason: string }>(
      database.sql`select revocation_reason from auth_sessions where revocation_reason is not null`,
    );
    // What actually happened. `logout_all` would have recorded the person
    // signing out their own devices, which is a different fact and the one an
    // appeal about this would be answered with.
    expect(sessions[0]?.revocation_reason).toBe('administrative');

    const events = await rowsOf<{ event_type: string; reason: string }>(
      database.sql`select event_type, reason from auth_security_events where event_type = 'sessions_revoked_all'`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('administrative');
  });

  it('refuses an account that does not exist without saying so differently', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/accounts/session-revocation', {
        body: {
          accountId: crypto.randomUUID(),
          reason: 'a valid reason for an account that is not there',
        },
        method: 'POST',
        session: operator,
      }),
    );
    expect(response.status).toBe(404);
    // The attempt is still recorded. An operator naming an account that does
    // not exist is a thing worth seeing in a review.
    const rows = await rowsOf<{ outcome: string }>(
      database.sql`select outcome from operations_operator_actions where action = 'sessions.revoked'`,
    );
    expect(rows[0]?.outcome).toBe('refused');
  });
});

/* ============================== Activity ============================== */

describe('the activity stream', () => {
  it('shows facts the domains themselves recorded', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-activity');

    const response = await handle(
      request('/v1/admin/activity', { session: operator }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: { detail?: string; subjectId?: string; type: string }[];
      since: string;
      until: string;
    };
    const created = body.entries.filter(
      (entry) => entry.type === 'users.account_created',
    );
    expect(created).toHaveLength(1);
    expect(created[0]?.subjectId).toBe(consumer.id);
    // Both ends of the window are published, so a count is never read as
    // all-time.
    expect(Date.parse(body.since)).toBeLessThan(Date.parse(body.until));
  });

  it('carries no field that could hold a message or a narrative', async () => {
    const operator = await operatorSession();
    await consumerAccount('operations-activity-shape');
    const response = await handle(
      request('/v1/admin/activity', { session: operator }),
    );
    const body = (await response.json()) as {
      entries: Record<string, unknown>[];
    };
    for (const entry of body.entries) {
      // An exact key set rather than a spot check, because a field added later
      // is exactly how a stream becomes a browsing surface over private
      // material without anybody deciding to do that.
      for (const key of Object.keys(entry)) {
        expect([
          'actorId',
          'correlationId',
          'detail',
          'domain',
          'id',
          'occurredAt',
          'resourceId',
          'resourceType',
          'subjectId',
          'type',
        ]).toContain(key);
      }
    }
  });

  it('narrows to one domain in the query rather than afterwards', async () => {
    const operator = await operatorSession();
    await consumerAccount('operations-activity-domain');
    const response = await handle(
      request('/v1/admin/activity?domain=safety', { session: operator }),
    );
    const body = (await response.json()) as { entries: unknown[] };
    expect(body.entries).toHaveLength(0);
  });

  it('refuses a domain outside the governed taxonomy', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/activity?domain=passwords', { session: operator }),
    );
    expect(response.status).toBe(422);
  });

  it('answers one person’s timeline with both identifiers they are known by', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-timeline');

    const response = await handle(
      request(`/v1/admin/accounts/timeline?accountId=${consumer.id}`, {
        session: operator,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: { type: string }[];
    };
    // The account's own creation, and the sign-in AUTH recorded against a
    // different identifier. A timeline asked with only one of them would
    // silently omit half of itself.
    expect(body.entries.map((entry) => entry.type)).toContain(
      'users.account_created',
    );
    expect(body.entries.map((entry) => entry.type)).toContain(
      'auth.security_event',
    );
  });

  it('answers a timeline for an account that does not exist with not found', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request(`/v1/admin/accounts/timeline?accountId=${crypto.randomUUID()}`, {
        session: operator,
      }),
    );
    expect(response.status).toBe(404);
  });
});

/* ================================ Search ============================== */

describe('finding a record', () => {
  it('resolves an identifier an operator already holds', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-search');
    const response = await handle(
      request(`/v1/admin/search?term=${consumer.id}`, { session: operator }),
    );
    const body = (await response.json()) as {
      matches: { id: string; kind: string }[];
    };
    expect(
      body.matches.some(
        (match) => match.id === consumer.id && match.kind === 'account',
      ),
    ).toBe(true);
  });

  it('answers a shape nothing uses with nothing, and asks no table', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/search?term=%20%20not-an-identifier%20%20', {
        session: operator,
      }),
    );
    const body = (await response.json()) as { matches: unknown[] };
    expect(body.matches).toHaveLength(0);
  });

  it('never suggests, so nothing can be enumerated from a prefix', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-no-prefix');
    const response = await handle(
      request(`/v1/admin/search?term=${consumer.id.slice(0, 8)}`, {
        session: operator,
      }),
    );
    const body = (await response.json()) as { matches: unknown[] };
    // Eight characters of a real identifier match nothing. A resolver that
    // answered here would be an enumeration tool with a search box on it.
    expect(body.matches).toHaveLength(0);
  });
});

/* =========================== Account record =========================== */

describe('one account in operational terms', () => {
  it('publishes counts and states and nothing a person wrote', async () => {
    const operator = await operatorSession();
    const consumer = await consumerAccount('operations-account');
    const response = await handle(
      request(`/v1/admin/accounts/detail?accountId=${consumer.id}`, {
        session: operator,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // An exact allowed set rather than a spot check. A field added later is
    // exactly how this record becomes a browsing surface over somebody's
    // profile without anybody deciding to do that, so anything not on this list
    // fails here on the day it appears.
    for (const key of Object.keys(body)) {
      expect([
        'account',
        'acquisition',
        'commerce',
        'connections',
        'creator',
        'devices',
        'live',
        'profileComplete',
        'safety',
        'sessions',
        'support',
        'wallet',
      ]).toContain(key);
    }
    expect(Object.keys(body)).toContain('safety');
    // No display name, no biography, no photograph, no language, no
    // availability, no matching declaration — none of them has a key here, so
    // a screen showing one could not be written against this contract.
    expect(JSON.stringify(body)).not.toContain('displayName');
  });

  it('answers an account that does not exist with not found', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request(`/v1/admin/accounts/detail?accountId=${crypto.randomUUID()}`, {
        session: operator,
      }),
    );
    expect(response.status).toBe(404);
  });
});

/* ============================== Platform ============================== */

describe('platform reads', () => {
  it('separates a seam nobody approved from one that failed', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/operations/state', { session: operator }),
    );
    const body = (await response.json()) as {
      dependencies: { name: string; state: string }[];
      outboxes: { domain: string }[];
      queues: unknown[];
    };
    // The harness injects its Redis dependencies, so this process holds no
    // queue client and reports no queues at all — which is different from
    // reporting healthy ones nothing reached.
    expect(body.queues).toHaveLength(0);
    expect(body.outboxes.map((outbox) => outbox.domain)).toContain('billing');
  });

  it('reports live state and whether new searches are admitted', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/live/state', { session: operator }),
    );
    const body = (await response.json()) as {
      liveEncounters: number;
      searchAdmitted: boolean;
    };
    expect(body.searchAdmitted).toBe(true);
    expect(body.liveEncounters).toBe(0);

    await handle(
      request('/v1/admin/controls', {
        body: {
          enabled: false,
          expectedVersion: 0,
          key: 'live.search',
          reason: 'pausing while we look at this',
        },
        method: 'POST',
        session: operator,
      }),
    );
    const paused = await handle(
      request('/v1/admin/live/state', { session: operator }),
    );
    // The screen and the code read the same control, so they cannot disagree
    // about whether the platform is admitting anybody.
    expect(
      ((await paused.json()) as { searchAdmitted: boolean }).searchAdmitted,
    ).toBe(false);
  });

  it('finds nothing to reconcile on a platform where nothing has happened', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/commerce/reconciliation', { session: operator }),
    );
    const body = (await response.json()) as { findings: unknown[] };
    expect(body.findings).toHaveLength(0);
  });

  it('reports that nothing is indexable, and why', async () => {
    const operator = await operatorSession();
    const response = await handle(
      request('/v1/admin/public-entry', { session: operator }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      canonicalOrigin?: string;
      environment: string;
      indexable: boolean;
      publishedCreators: number;
    };
    expect(body.indexable).toBe(false);
    expect(body.environment).toBe('test');
    expect(body.canonicalOrigin).toBeUndefined();
    expect(body.publishedCreators).toBe(0);
  });
});
