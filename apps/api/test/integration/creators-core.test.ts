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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * CREATORS against real PostgreSQL.
 *
 * The gate this suite exists to prove is not "does a row appear". It is that a
 * creator capability can only be held by a principal USERS says is an adult in
 * good standing, that only Creator Studio may act as a creator, that the
 * capability is exactly one per principal however many callers race, and that
 * none of those facts can be asserted by a client.
 */

const databaseUrl = await provisionDatabase('velora_creators_core');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logs: unknown[] = [];
const logger = silentLogger(logs);
const config = testServerConfig();
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'creators-test',
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
});
const runtimes = testProductRuntimes({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  users,
});
const application = createApplication({
  config,
  dependencies: {
    auth,
    ...runtimes,
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
  await database.truncate();
  logs.length = 0;
});

interface SessionCredentials {
  readonly accountId: string;
  readonly cookie: string;
  readonly csrf: string;
}

async function webSession(
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<SessionCredentials> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience, subject }),
      headers: {
        'content-type': 'application/json',
        origin:
          audience === 'consumer_web' ? testConsumerOrigin : testCreatorOrigin,
        // AUTH counts attempts per requester. Every session in this suite is a
        // different person on a different device, and sharing one bucket would
        // measure the limiter rather than CREATORS.
        'x-velora-device': `${subject}-${audience}`,
      },
      method: 'POST',
    }),
  );
  if (response.status !== 201) {
    throw new Error(`sign-in failed with ${String(response.status)}`);
  }
  const body = (await response.json()) as {
    accountId: string;
    csrfToken: string;
  };
  return {
    accountId: body.accountId,
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0] ?? '')
      .filter((pair) => pair.length > 0)
      .join('; '),
    csrf: body.csrfToken,
  };
}

async function mobileSession(
  subject: string,
): Promise<{ readonly accessToken: string }> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/mobile-sessions', {
      body: JSON.stringify({
        installationId: `install-${subject.replaceAll(/[^A-Za-z0-9]/gu, '')}`,
        subject,
      }),
      headers: {
        'content-type': 'application/json',
        'x-velora-device': `${subject}-mobile`,
      },
      method: 'POST',
    }),
  );
  if (response.status !== 201) {
    throw new Error(`mobile sign-in failed with ${String(response.status)}`);
  }
  const body = (await response.json()) as { accessToken: string };
  return { accessToken: body.accessToken };
}

function creatorRequest(
  path: string,
  credentials: SessionCredentials,
  init: { readonly body?: unknown; readonly method?: string } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: credentials.cookie,
      origin: testCreatorOrigin,
      'x-velora-csrf': credentials.csrf,
    },
  });
}

/** A consumer account that has declared adult status, as USERS records it. */
async function adultConsumer(subject: string): Promise<SessionCredentials> {
  const consumer = await webSession(subject, 'consumer_web');
  const created = await handle(
    new Request('http://api.test/v1/users', {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        cookie: consumer.cookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': consumer.csrf,
      },
      method: 'POST',
    }),
  );
  if (created.status !== 201) {
    throw new Error(`account creation failed with ${String(created.status)}`);
  }
  const declared = await handle(
    new Request('http://api.test/v1/users/me/onboarding/adult-declaration', {
      body: JSON.stringify({ declaresAdult: true, region: 'ES' }),
      headers: {
        'content-type': 'application/json',
        cookie: consumer.cookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': consumer.csrf,
      },
      method: 'POST',
    }),
  );
  if (declared.status !== 200) {
    throw new Error(`declaration failed with ${String(declared.status)}`);
  }
  return consumer;
}

/** The same principal, holding a Creator Studio session. */
async function creatorSession(subject: string): Promise<SessionCredentials> {
  return webSession(subject, 'creator_studio');
}

const requiredAcknowledgements = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

async function creatorRows(): Promise<{ id: string; status: string }[]> {
  return rowsOf<{ id: string; status: string }>(
    database.sql`select id, status from creators_accounts`,
  );
}

describe('CREATORS capability establishment', () => {
  it('creates exactly one capability per principal and returns it again', async () => {
    const subject = 'creator-one@velora.test';
    await adultConsumer(subject);
    const studio = await creatorSession(subject);

    const first = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );
    const second = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const created = (await first.json()) as { id: string; status: string };
    const repeated = (await second.json()) as { id: string };
    expect(created.status).toBe('applicant');
    expect(repeated.id).toBe(created.id);
    expect(await creatorRows()).toHaveLength(1);
  });

  it('never returns an AUTH or consumer identifier to the Studio', async () => {
    const subject = 'creator-shape@velora.test';
    const consumer = await adultConsumer(subject);
    const studio = await creatorSession(subject);

    const response = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body).toSorted()).toEqual([
      'createdAt',
      'id',
      'status',
      'statusReason',
    ]);
    expect(JSON.stringify(body)).not.toContain(consumer.accountId);
  });

  it('refuses a principal with no consumer account', async () => {
    const studio = await creatorSession('creator-nobody@velora.test');

    const response = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'ACCOUNT_NOT_ELIGIBLE',
    });
    expect(await creatorRows()).toHaveLength(0);
  });

  it('refuses a principal who has not declared adult status', async () => {
    const subject = 'creator-undeclared@velora.test';
    const consumer = await webSession(subject, 'consumer_web');
    await handle(
      new Request('http://api.test/v1/users', {
        body: '{}',
        headers: {
          'content-type': 'application/json',
          cookie: consumer.cookie,
          origin: testConsumerOrigin,
          'x-velora-csrf': consumer.csrf,
        },
        method: 'POST',
      }),
    );
    const studio = await creatorSession(subject);

    const response = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );

    expect(response.status).toBe(409);
    expect(await creatorRows()).toHaveLength(0);
  });

  it('refuses a principal whose consumer account is restricted', async () => {
    const subject = 'creator-restricted@velora.test';
    await adultConsumer(subject);
    await execute(
      database.sql`update users_accounts set status = 'restricted', status_reason = 'safety_enforcement'`,
    );
    const studio = await creatorSession(subject);

    const response = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );

    expect(response.status).toBe(409);
    expect(await creatorRows()).toHaveLength(0);
  });

  it('settles concurrent first calls on exactly one capability', async () => {
    const subject = 'creator-race@velora.test';
    await adultConsumer(subject);
    const studio = await creatorSession(subject);

    const responses = await Promise.all(
      Array.from({ length: 25 }, async () =>
        handle(creatorRequest('/v1/creator', studio, { method: 'POST' })),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.every((status) => status === 200 || status === 201)).toBe(
      true,
    );
    const bodies = await Promise.all(
      responses.map(async (response) => response.json()),
    );
    const identifiers = new Set(
      (bodies as { id: string }[]).map((body) => body.id),
    );
    expect(identifiers.size).toBe(1);
    expect(await creatorRows()).toHaveLength(1);
  });
});

describe('CREATORS audience isolation', () => {
  it('rejects an unauthenticated caller', async () => {
    const response = await handle(
      new Request('http://api.test/v1/creator', {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects a Consumer Web session', async () => {
    const subject = 'creator-consumer-web@velora.test';
    const consumer = await adultConsumer(subject);

    const response = await handle(
      new Request('http://api.test/v1/creator', {
        body: '{}',
        headers: {
          'content-type': 'application/json',
          cookie: consumer.cookie,
          origin: testConsumerOrigin,
          'x-velora-csrf': consumer.csrf,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'CREATOR_SURFACE_REQUIRED',
    });
    expect(await creatorRows()).toHaveLength(0);
  });

  it('rejects a Consumer Mobile access token', async () => {
    const subject = 'creator-mobile@velora.test';
    await adultConsumer(subject);
    const mobile = await mobileSession(subject);

    const response = await handle(
      new Request('http://api.test/v1/creator', {
        body: '{}',
        headers: {
          authorization: `Bearer ${mobile.accessToken}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'CREATOR_SURFACE_REQUIRED',
    });
  });

  it('refuses a state-changing Studio request with no CSRF evidence', async () => {
    const subject = 'creator-csrf@velora.test';
    await adultConsumer(subject);
    const studio = await creatorSession(subject);

    const response = await handle(
      new Request('http://api.test/v1/creator', {
        body: '{}',
        headers: {
          'content-type': 'application/json',
          cookie: studio.cookie,
          origin: testCreatorOrigin,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'AUTH_CSRF_REQUIRED' });
    expect(await creatorRows()).toHaveLength(0);
  });

  it('answers a caller without creator capability as if the route did not exist', async () => {
    const subject = 'creator-absent@velora.test';
    await adultConsumer(subject);
    const studio = await creatorSession(subject);

    const account = await handle(creatorRequest('/v1/creator/me', studio));
    const onboarding = await handle(
      creatorRequest('/v1/creator/onboarding', studio),
    );

    expect(account.status).toBe(404);
    expect(await account.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(onboarding.status).toBe(404);
  });
});

describe('CREATORS activation ladder', () => {
  async function applicant(subject: string): Promise<SessionCredentials> {
    await adultConsumer(subject);
    const studio = await creatorSession(subject);
    const created = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );
    if (created.status !== 201) {
      throw new Error(`provisioning failed with ${String(created.status)}`);
    }
    return studio;
  }

  it('reports the outstanding creator policies and activates once both are held', async () => {
    const studio = await applicant('creator-ladder@velora.test');

    const before = await handle(
      creatorRequest('/v1/creator/onboarding', studio),
    );
    const beforeBody = (await before.json()) as {
      adultGateSatisfied: boolean;
      outstandingPolicies: { key: string }[];
      step: string;
    };
    expect(beforeBody.adultGateSatisfied).toBe(true);
    expect(beforeBody.step).toBe('policy_acknowledgement');
    expect(beforeBody.outstandingPolicies.map((policy) => policy.key)).toEqual([
      'creator_terms',
      'creator_content_policy',
    ]);

    const acknowledged = await handle(
      creatorRequest('/v1/creator/onboarding/acknowledgements', studio, {
        body: { acknowledgements: requiredAcknowledgements },
        method: 'POST',
      }),
    );
    const afterBody = (await acknowledged.json()) as {
      account: { activatedAt?: string; status: string };
      outstandingPolicies: unknown[];
      step: string;
    };

    expect(acknowledged.status).toBe(200);
    expect(afterBody.step).toBe('completed');
    expect(afterBody.outstandingPolicies).toHaveLength(0);
    expect(afterBody.account.status).toBe('active');
    expect(afterBody.account.activatedAt).toBeDefined();
  });

  it('records acknowledgement evidence once and never rewrites when it was given', async () => {
    const studio = await applicant('creator-evidence@velora.test');
    await handle(
      creatorRequest('/v1/creator/onboarding/acknowledgements', studio, {
        body: { acknowledgements: requiredAcknowledgements },
        method: 'POST',
      }),
    );
    const first = await rowsOf<{ acknowledged_at: Date }>(
      database.sql`select acknowledged_at from creators_policy_acknowledgements order by policy_key`,
    );

    await handle(
      creatorRequest('/v1/creator/onboarding/acknowledgements', studio, {
        body: { acknowledgements: requiredAcknowledgements },
        method: 'POST',
      }),
    );
    const second = await rowsOf<{ acknowledged_at: Date }>(
      database.sql`select acknowledged_at from creators_policy_acknowledgements order by policy_key`,
    );

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second.map((row) => row.acknowledged_at.getTime())).toEqual(
      first.map((row) => row.acknowledged_at.getTime()),
    );
  });

  it('refuses an acknowledgement of a version that is not the one required', async () => {
    const studio = await applicant('creator-wrong-version@velora.test');

    const response = await handle(
      creatorRequest('/v1/creator/onboarding/acknowledgements', studio, {
        body: {
          acknowledgements: [{ key: 'creator_terms', version: '1-invented' }],
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(409);
    expect(
      await rowsOf(
        database.sql`select 1 from creators_policy_acknowledgements`,
      ),
    ).toHaveLength(0);
  });

  it('returns an active capability to applicant when adult standing is lost', async () => {
    const studio = await applicant('creator-lost-standing@velora.test');
    await handle(
      creatorRequest('/v1/creator/onboarding/acknowledgements', studio, {
        body: { acknowledgements: requiredAcknowledgements },
        method: 'POST',
      }),
    );
    await execute(
      database.sql`update users_accounts set status = 'restricted', status_reason = 'safety_enforcement'`,
    );

    const response = await handle(
      creatorRequest('/v1/creator/onboarding', studio),
    );
    const body = (await response.json()) as {
      account: { status: string; statusReason?: string };
      adultGateReason?: string;
      step: string;
    };

    expect(body.step).toBe('adult_eligibility');
    expect(body.adultGateReason).toBe('not_in_good_standing');
    expect(body.account.status).toBe('applicant');
    expect(body.account.statusReason).toBe('eligibility_failed');
  });

  it('leaves a suspended capability suspended and refuses to advance it', async () => {
    const studio = await applicant('creator-suspended@velora.test');
    await execute(
      database.sql`update creators_accounts set status = 'suspended', status_reason = 'safety_enforcement', suspended_at = now()`,
    );

    const acknowledged = await handle(
      creatorRequest('/v1/creator/onboarding/acknowledgements', studio, {
        body: { acknowledgements: requiredAcknowledgements },
        method: 'POST',
      }),
    );
    const account = await handle(creatorRequest('/v1/creator/me', studio));

    expect(acknowledged.status).toBe(409);
    expect(await account.json()).toMatchObject({
      status: 'suspended',
      statusReason: 'safety_enforcement',
    });
    expect(
      await rowsOf(
        database.sql`select 1 from creators_policy_acknowledgements`,
      ),
    ).toHaveLength(0);
  });

  it('does not resurrect a closed capability when the principal asks again', async () => {
    const studio = await applicant('creator-closed@velora.test');
    await execute(
      database.sql`update creators_accounts set status = 'closed', status_reason = 'creator_requested', closed_at = now()`,
    );

    const response = await handle(
      creatorRequest('/v1/creator', studio, { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'closed' });
    expect(await creatorRows()).toHaveLength(1);
  });
});

describe('the database enforces the creator invariants', () => {
  it('owns exactly the two creator tables and nothing else', async () => {
    const rows = await rowsOf<{ table_name: string }>(
      database.sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'creators_%'
        order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'creators_accounts',
      'creators_policy_acknowledgements',
    ]);
  });

  it('refuses a second capability for the same principal', async () => {
    const principal = crypto.randomUUID();
    await execute(
      database.sql`insert into creators_accounts
        (auth_account_id, created_at, id, status, status_changed_at, status_reason, updated_at)
        values (${principal}, now(), ${crypto.randomUUID()}, 'applicant', now(), 'onboarding_incomplete', now())`,
    );
    let refused = false;
    try {
      await execute(
        database.sql`insert into creators_accounts
          (auth_account_id, created_at, id, status, status_changed_at, status_reason, updated_at)
          values (${principal}, now(), ${crypto.randomUUID()}, 'applicant', now(), 'onboarding_incomplete', now())`,
      );
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it('refuses an active capability with an unexplained reason or no activation', async () => {
    const unexplained = await refusedInsert({
      activatedAt: 'now()',
      status: 'active',
      statusReason: `'onboarding_incomplete'`,
    });
    const unactivated = await refusedInsert({
      activatedAt: 'null',
      status: 'active',
      statusReason: 'null',
    });

    expect(unexplained).toBe(true);
    expect(unactivated).toBe(true);
  });

  it('refuses a status this ladder cannot reach and an unknown reason', async () => {
    // `verified` is deliberately not a creator lifecycle state. See ADR-0020:
    // identity verification is a separate predicate with no approved provider.
    const badStatus = await refusedInsert({
      activatedAt: 'null',
      status: 'verified',
      statusReason: `'onboarding_incomplete'`,
    });
    const badReason = await refusedInsert({
      activatedAt: 'null',
      status: 'applicant',
      statusReason: `'because'`,
    });

    expect(badStatus).toBe(true);
    expect(badReason).toBe(true);
  });
});

/** Runs one raw insert and reports whether the database refused it. */
async function refusedInsert(input: {
  readonly activatedAt: string;
  readonly status: string;
  readonly statusReason: string;
}): Promise<boolean> {
  try {
    await execute(
      database.sql.unsafe(
        `insert into creators_accounts
          (activated_at, auth_account_id, created_at, id, status, status_changed_at, status_reason, updated_at)
          values (${input.activatedAt}, '${crypto.randomUUID()}', now(), '${crypto.randomUUID()}',
                  '${input.status}', now(), ${input.statusReason}, now())`,
      ),
    );
    return false;
  } catch {
    return true;
  }
}

describe('CREATORS client input is never authority', () => {
  it('refuses a body that tries to assert a status', async () => {
    const subject = 'creator-assert@velora.test';
    await adultConsumer(subject);
    const studio = await creatorSession(subject);

    const response = await handle(
      creatorRequest('/v1/creator', studio, {
        body: { status: 'active' },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await creatorRows()).toHaveLength(0);
  });

  it('gives each principal only its own capability', async () => {
    const firstSubject = 'creator-isolation-a@velora.test';
    const secondSubject = 'creator-isolation-b@velora.test';
    await adultConsumer(firstSubject);
    await adultConsumer(secondSubject);
    const first = await creatorSession(firstSubject);
    const second = await creatorSession(secondSubject);
    const firstCreated = (await (
      await handle(creatorRequest('/v1/creator', first, { method: 'POST' }))
    ).json()) as { id: string };
    const secondCreated = (await (
      await handle(creatorRequest('/v1/creator', second, { method: 'POST' }))
    ).json()) as { id: string };

    const firstRead = (await (
      await handle(creatorRequest('/v1/creator/me', first))
    ).json()) as { id: string };
    const secondRead = (await (
      await handle(creatorRequest('/v1/creator/me', second))
    ).json()) as { id: string };

    expect(firstCreated.id).not.toBe(secondCreated.id);
    expect(firstRead.id).toBe(firstCreated.id);
    expect(secondRead.id).toBe(secondCreated.id);
    expect(await creatorRows()).toHaveLength(2);
  });
});
