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
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: database.drizzle,
    logger,
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
