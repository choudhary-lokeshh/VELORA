import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { UsersRepository } from '../../src/users/repository.js';
import { UsersService } from '../../src/users/service.js';
import { userAccounts } from '../../src/users/schema.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testConsumerOrigin,
  testProductRuntimes,
  testCreatorOrigin,
  testDatabaseAdmission,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_users_core');
const database: TestDatabase = connectDatabase(databaseUrl);
const repository = new UsersRepository(database.drizzle);
const service = new UsersService({ now: () => new Date(), repository });

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

interface Harness {
  close(): Promise<void>;
  handle(request: Request): Promise<Response>;
  readonly logs: unknown[];
}

function harness(): Harness {
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
        request.headers.get('x-velora-device') ?? 'users-test',
    },
  });
  const mediaRuntime = testMediaRuntime({
    config,
    database: database.drizzle,
    logger,
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: database.drizzle,
    logger,
    media: mediaRuntime.service,
  });
  const application = createApplication({
    config,
    dependencies: {
      auth,
      ...testProductRuntimes({
        caller: auth.caller,
        config,
        database: database.drizzle,
        logger,
        users,
      }),
      database: healthy,
      databaseAdmission: testDatabaseAdmission(),
      ephemeralRedis: healthy,
      logger,
      queueRedis: healthy,
      users,
    },
  });
  return {
    close: () => application.close(),
    handle: (request) => application.app.handle(request),
    logs,
  };
}

const api = harness();

afterAll(async () => {
  await api.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

/** Creates an AUTH account row directly, standing in for a prior sign-up. */
async function authAccount(): Promise<string> {
  const id = crypto.randomUUID();
  await execute(
    database.sql`insert into auth_accounts (id, status) values (${id}, 'active')`,
  );
  return id;
}

interface SessionCredentials {
  readonly accountId: string;
  readonly cookie: string;
  readonly csrf: string;
}

async function webSession(
  subject: string,
  audience: 'consumer_web' | 'creator_studio' = 'consumer_web',
): Promise<SessionCredentials> {
  const response = await api.handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience, subject }),
      headers: {
        'content-type': 'application/json',
        origin:
          audience === 'consumer_web' ? testConsumerOrigin : testCreatorOrigin,
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
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
  return { accountId: body.accountId, cookie: cookies, csrf: body.csrfToken };
}

async function mobileSession(
  subject: string,
): Promise<{ readonly accessToken: string; readonly accountId: string }> {
  const response = await api.handle(
    new Request('http://api.test/v1/auth/local/mobile-sessions', {
      body: JSON.stringify({
        installationId: `install-${subject.replaceAll(/[^A-Za-z0-9]/gu, '')}`,
        subject,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }),
  );
  if (response.status !== 201) {
    throw new Error(`mobile sign-in failed with ${String(response.status)}`);
  }
  const body = (await response.json()) as {
    accessToken: string;
    accountId: string;
  };
  return { accessToken: body.accessToken, accountId: body.accountId };
}

function createAccountRequest(
  credentials: SessionCredentials,
  body: unknown = {},
): Request {
  return new Request('http://api.test/v1/users', {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: credentials.cookie,
      origin: testConsumerOrigin,
      'x-velora-csrf': credentials.csrf,
    },
    method: 'POST',
  });
}

describe('USERS consumer account persistence', () => {
  it('creates exactly one account per AUTH account and returns it again', async () => {
    const authAccountId = await authAccount();

    const first = await service.provisionAccount({ authAccountId });
    const second = await service.provisionAccount({ authAccountId });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.account.id).toBe(first.account.id);
    expect(first.account.status).toBe('pending_profile');

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_accounts`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('converges on one account under concurrent first provisioning', async () => {
    const authAccountId = await authAccount();
    const attempts = 25;

    const outcomes = await Promise.all(
      Array.from({ length: attempts }, async () =>
        service.provisionAccount({ authAccountId }),
      ),
    );

    const identifiers = new Set(outcomes.map((outcome) => outcome.account.id));
    expect(identifiers.size).toBe(1);
    expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_accounts`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('refuses a second consumer account for the same AUTH account', async () => {
    const authAccountId = await authAccount();
    await service.provisionAccount({ authAccountId });

    let rejected = false;
    try {
      await database.drizzle.insert(userAccounts).values({
        authAccountId,
        id: crypto.randomUUID(),
        status: 'active',
        statusChangedAt: new Date(),
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('refuses impossible lifecycle combinations at the database', async () => {
    const cases: readonly {
      readonly label: string;
      readonly run: () => Promise<unknown>;
    }[] = [
      {
        label: 'unknown status',
        run: async () =>
          execute(
            database.sql`insert into users_accounts (id, auth_account_id, status, status_changed_at)
              values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'banned', now())`,
          ),
      },
      {
        label: 'restricted without a reason',
        run: async () =>
          execute(
            database.sql`insert into users_accounts (id, auth_account_id, status, status_changed_at)
              values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'restricted', now())`,
          ),
      },
      {
        label: 'deletion state without a request',
        run: async () =>
          execute(
            database.sql`insert into users_accounts (id, auth_account_id, status, status_changed_at)
              values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'deletion_pending', now())`,
          ),
      },
      {
        label: 'lowercase region',
        run: async () =>
          execute(
            database.sql`insert into users_accounts (id, auth_account_id, status, status_changed_at, region)
              values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'active', now(), 'de')`,
          ),
      },
      {
        label: 'malformed locale',
        run: async () =>
          execute(
            database.sql`insert into users_accounts (id, auth_account_id, status, status_changed_at, locale)
              values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'active', now(), 'english')`,
          ),
      },
      {
        label: 'status changed before creation',
        run: async () =>
          execute(
            database.sql`insert into users_accounts (id, auth_account_id, status, created_at, status_changed_at)
              values (${crypto.randomUUID()}, ${crypto.randomUUID()}, 'active', now(), now() - interval '1 hour')`,
          ),
      },
    ];

    for (const scenario of cases) {
      let rejected = false;
      try {
        await scenario.run();
      } catch {
        rejected = true;
      }
      expect(rejected, scenario.label).toBe(true);
    }
  });

  /**
   * Clock skew, simulated rather than caused.
   *
   * `users_accounts_status_changed_after_creation_check` compares two columns
   * the application writes, so it holds only while both come from one clock.
   * The tests below offset the application clock from PostgreSQL's own `now()`
   * by an hour in each direction — which is what a drifted container looks like
   * from inside the API process — without touching a host clock, a container
   * clock, or the session `TimeZone`. Nothing sleeps and nothing races: the
   * offset is read from the database and applied, so a run either proves the
   * property or fails every time.
   */
  async function databaseClock(): Promise<Date> {
    const rows = await rowsOf<{ at: Date }>(database.sql`select now() as at`);
    const at = rows[0]?.at;
    if (at === undefined) throw new Error('the database returned no clock');
    return at;
  }

  const skews = [
    { label: 'an hour ahead of the database', offsetMilliseconds: 3_600_000 },
    { label: 'an hour behind the database', offsetMilliseconds: -3_600_000 },
  ] as const;

  for (const skew of skews) {
    it(`keeps a lifecycle coherent with the application clock ${skew.label}`, async () => {
      const authAccountId = await authAccount();
      const createdAt = new Date(
        (await databaseClock()).getTime() + skew.offsetMilliseconds,
      );
      const changedAt = new Date(createdAt.getTime() + 1_000);

      const account = await repository.insertIfAbsent(
        repository.transactionless,
        {
          authAccountId,
          now: createdAt,
          status: 'pending_profile',
          statusReason: 'onboarding_incomplete',
        },
      );

      // Exact equality is the contract here rather than a precision accident:
      // one read of the clock stamps both columns, so the row records a single
      // instant. A JS millisecond survives a PostgreSQL microsecond column
      // unchanged, which is why this is safe to assert on the nose.
      expect(account?.createdAt.getTime()).toBe(createdAt.getTime());
      expect(account?.statusChangedAt.getTime()).toBe(createdAt.getTime());

      const moved = await repository.transitionAccountStatus(
        repository.transactionless,
        {
          expectedStatus: 'pending_profile',
          now: changedAt,
          status: 'active',
          statusReason: null,
          userId: account?.id ?? '',
        },
      );

      expect(moved?.status).toBe('active');
      expect(moved?.statusChangedAt.getTime()).toBe(changedAt.getTime());
      expect(moved?.createdAt.getTime()).toBe(createdAt.getTime());
      // The invariant the constraint exists for, stated as an ordering rather
      // than as an equality, because that is all it claims.
      expect(moved?.statusChangedAt.getTime()).toBeGreaterThanOrEqual(
        moved?.createdAt.getTime() ?? Number.POSITIVE_INFINITY,
      );
    });
  }

  it('refuses a status change stamped from the database clock on a row the application clock created', async () => {
    const authAccountId = await authAccount();
    const createdAt = new Date((await databaseClock()).getTime() + 3_600_000);
    const account = await repository.insertIfAbsent(
      repository.transactionless,
      {
        authAccountId,
        now: createdAt,
        status: 'pending_profile',
        statusReason: 'onboarding_incomplete',
      },
    );

    // The defect this file guards against, reproduced without moving a clock:
    // a writer that stamps `status_changed_at` from PostgreSQL while the row
    // was created from the application clock is writing across two clocks, and
    // the database refuses it the moment they disagree by more than the gap
    // between the two statements. A production writer cannot reach this — every
    // one of them takes both timestamps from the injected clock — which is why
    // the fix belonged in the fixture that did.
    expect(
      await refused(() =>
        execute(
          database.sql`update users_accounts
            set status_changed_at = now()
            where id = ${account?.id ?? ''}`,
        ),
      ),
    ).toBe(true);

    const rows = await rowsOf<{ status_changed_at: Date }>(
      database.sql`select status_changed_at from users_accounts where id = ${account?.id ?? ''}`,
    );
    expect(rows[0]?.status_changed_at.getTime()).toBe(createdAt.getTime());
  });
});

describe('USERS consumer account API', () => {
  it('creates the account for the authenticated caller and returns it thereafter', async () => {
    const credentials = await webSession('phase1-owner@velora.test');

    const created = await api.handle(createAccountRequest(credentials));
    expect(created.status).toBe(201);
    const account = (await created.json()) as { id: string; status: string };
    expect(account.status).toBe('pending_profile');

    const repeated = await api.handle(createAccountRequest(credentials));
    expect(repeated.status).toBe(200);
    expect(((await repeated.json()) as { id: string }).id).toBe(account.id);

    const read = await api.handle(
      new Request('http://api.test/v1/users/me', {
        headers: { cookie: credentials.cookie, origin: testConsumerOrigin },
      }),
    );
    expect(read.status).toBe(200);
    expect(((await read.json()) as { id: string }).id).toBe(account.id);
  });

  it('never lets a request body choose which account it becomes', async () => {
    const victim = await webSession('phase1-victim@velora.test');
    const victimAccount = (await (
      await api.handle(createAccountRequest(victim))
    ).json()) as { id: string };

    const attacker = await webSession('phase1-attacker@velora.test');
    const forged = await api.handle(
      createAccountRequest(attacker, {
        authAccountId: victim.accountId,
        id: victimAccount.id,
        userId: victimAccount.id,
      }),
    );
    // The contract is strict, so an unknown field is a validation failure
    // rather than an ignored one.
    expect(forged.status).toBe(422);

    const attackerAccount = (await (
      await api.handle(createAccountRequest(attacker))
    ).json()) as { id: string };
    expect(attackerAccount.id).not.toBe(victimAccount.id);
  });

  it('serves the same consumer account to Web and Mobile for one identity', async () => {
    const subject = 'phase1-crossdevice@velora.test';
    const web = await webSession(subject);
    const created = (await (
      await api.handle(createAccountRequest(web))
    ).json()) as { id: string };

    const mobile = await mobileSession(subject);
    expect(mobile.accountId).toBe(web.accountId);

    const read = await api.handle(
      new Request('http://api.test/v1/users/me', {
        headers: { authorization: `Bearer ${mobile.accessToken}` },
      }),
    );
    expect(read.status).toBe(200);
    expect(((await read.json()) as { id: string }).id).toBe(created.id);
  });

  it('refuses an unauthenticated caller before it can learn anything', async () => {
    const response = await api.handle(
      new Request('http://api.test/v1/users/me'),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe(
      'AUTH_REQUIRED',
    );
  });

  it('refuses a Creator Studio session on a consumer endpoint', async () => {
    const creator = await webSession(
      'phase1-creator@velora.test',
      'creator_studio',
    );
    const response = await api.handle(
      new Request('http://api.test/v1/users/me', {
        headers: { cookie: creator.cookie, origin: testCreatorOrigin },
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      'CONSUMER_SURFACE_REQUIRED',
    );

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_accounts`,
    );
    // The refusal happened before any consumer lookup or write.
    expect(rows[0]?.count).toBe('0');
  });

  it('answers a missing consumer account exactly like a missing route', async () => {
    const credentials = await webSession('phase1-noaccount@velora.test');
    const response = await api.handle(
      new Request('http://api.test/v1/users/me', {
        headers: { cookie: credentials.cookie, origin: testConsumerOrigin },
      }),
    );
    expect(response.status).toBe(404);
  });

  it('requires CSRF evidence on the cookie-authenticated mutation', async () => {
    const credentials = await webSession('phase1-csrf@velora.test');
    const response = await api.handle(
      new Request('http://api.test/v1/users', {
        body: '{}',
        headers: {
          'content-type': 'application/json',
          cookie: credentials.cookie,
          origin: testConsumerOrigin,
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      'AUTH_CSRF_REQUIRED',
    );
  });

  it('refuses a foreign origin carrying a valid cookie', async () => {
    const credentials = await webSession('phase1-origin@velora.test');
    const response = await api.handle(
      new Request('http://api.test/v1/users', {
        body: '{}',
        headers: {
          'content-type': 'application/json',
          cookie: credentials.cookie,
          origin: 'https://evil.test',
          'x-velora-csrf': credentials.csrf,
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      'AUTH_ORIGIN_REJECTED',
    );
  });

  it('exposes no AUTH identifier or internal field in the consumer account', async () => {
    const credentials = await webSession('phase1-privacy@velora.test');
    const body = (await (
      await api.handle(createAccountRequest(credentials))
    ).json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['createdAt', 'id', 'status']);
    expect(JSON.stringify(body)).not.toContain(credentials.accountId);
  });

  it('keeps request logs free of credentials', async () => {
    const credentials = await webSession('phase1-logs@velora.test');
    await api.handle(createAccountRequest(credentials));
    const serialised = JSON.stringify(api.logs);
    expect(serialised).not.toContain(credentials.csrf);
    expect(serialised).not.toContain(credentials.cookie);
  });
});
