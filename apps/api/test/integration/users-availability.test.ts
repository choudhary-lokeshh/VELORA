import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { maximumAvailabilityWindowMilliseconds } from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
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
  testDatabaseAdmission,
  testServerConfig,
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_users_availability');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

// Availability is independent of media, so this runs on the default adapter
// that refuses everything: nothing here should need a storage provider.
const config = testServerConfig();

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

const logger = silentLogger([]);
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'availability-test',
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
});
const application = createApplication({
  config,
  dependencies: {
    auth,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    ...testProductRuntimes({
      caller: auth.caller,
      config,
      database: database.drizzle,
      logger,
      now,
      users,
    }),
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
  clockOffsetMilliseconds = 0;
  await database.truncate();
});

interface Credentials {
  readonly cookie: string;
  readonly csrf: string;
}

async function signIn(subject: string): Promise<Credentials> {
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
  const session = (await response.json()) as { csrfToken: string };
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
  return { cookie, csrf: session.csrfToken };
}

function post(path: string, credentials: Credentials, body: unknown): Request {
  return new Request(`http://api.test${path}`, {
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

function get(path: string, credentials: Credentials): Request {
  return new Request(`http://api.test${path}`, {
    headers: { cookie: credentials.cookie, origin: testConsumerOrigin },
  });
}

interface AvailabilityBody {
  readonly availableUntil?: string;
  readonly effectiveState: string;
  readonly state: string;
  readonly updatedAt: string;
}

async function admittedConsumer(subject: string): Promise<Credentials> {
  const caller = await signIn(subject);
  await handle(post('/v1/users', caller, {}));
  await handle(
    post('/v1/users/me/onboarding/adult-declaration', caller, {
      declaresAdult: true,
      region: 'PT',
    }),
  );
  await handle(
    post('/v1/users/me/onboarding/acknowledgements', caller, {
      acknowledgements: requiredPolicyDocuments.map((document) => ({
        key: document.key,
        version: document.version,
      })),
    }),
  );
  return caller;
}

function inMinutes(minutes: number): string {
  return new Date(now().getTime() + minutes * 60 * 1000).toISOString();
}

async function readAvailability(
  credentials: Credentials,
): Promise<AvailabilityBody> {
  const response = await handle(get('/v1/users/me/availability', credentials));
  expect(response.status).toBe(200);
  return (await response.json()) as AvailabilityBody;
}

describe('availability is a bounded user preference', () => {
  it('starts unavailable for an account that never set it', async () => {
    const caller = await admittedConsumer('availability-default@velora.test');
    const initial = await readAvailability(caller);
    expect(initial.state).toBe('unavailable');
    expect(initial.effectiveState).toBe('unavailable');
    expect(initial.availableUntil).toBeUndefined();

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_availability`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('records an availability window and reports it as open', async () => {
    const caller = await admittedConsumer('availability-open@velora.test');
    const until = inMinutes(90);

    const saved = await handle(
      post('/v1/users/me/availability', caller, {
        availableUntil: until,
        state: 'available',
      }),
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as AvailabilityBody;
    expect(body.state).toBe('available');
    expect(body.effectiveState).toBe('available');
    expect(body.availableUntil).toBe(until);
  });

  it('reads an expired window as unavailable without rewriting the row', async () => {
    const caller = await admittedConsumer('availability-expiry@velora.test');
    await handle(
      post('/v1/users/me/availability', caller, {
        availableUntil: inMinutes(30),
        state: 'available',
      }),
    );

    clockOffsetMilliseconds = 31 * 60 * 1000;
    const expired = await readAvailability(caller);
    expect(expired.state).toBe('available');
    // What the platform acts on is the resolved value, not the stored one.
    expect(expired.effectiveState).toBe('unavailable');

    const rows = await rowsOf<{ revision: number; state: string }>(
      database.sql`select revision, state from users_availability`,
    );
    // Time passing is not an event, so nothing was written back.
    expect(rows[0]?.state).toBe('available');
    expect(rows[0]?.revision).toBe(1);
  });

  it('refuses a window that has already closed or runs longer than policy allows', async () => {
    const caller = await admittedConsumer('availability-window@velora.test');
    const cases: Record<string, unknown>[] = [
      { availableUntil: inMinutes(-1), state: 'available' },
      {
        availableUntil: new Date(
          now().getTime() + maximumAvailabilityWindowMilliseconds + 60_000,
        ).toISOString(),
        state: 'available',
      },
      // Availability with no end would be a presence claim.
      { state: 'available' },
      // An end with no availability describes nothing.
      { availableUntil: inMinutes(30), state: 'unavailable' },
      { state: 'maybe' },
      { availableUntil: 'soon', state: 'available' },
    ];
    for (const body of cases) {
      const response = await handle(
        post('/v1/users/me/availability', caller, body),
      );
      expect(response.status, JSON.stringify(body)).toBe(422);
    }

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_availability`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('resolves simultaneous changes from many devices to one agreed state', async () => {
    const caller = await admittedConsumer('availability-devices@velora.test');
    const until = inMinutes(60);

    const responses = await Promise.all(
      Array.from({ length: 16 }, (_value, index) =>
        handle(
          post(
            '/v1/users/me/availability',
            caller,
            index % 2 === 0
              ? { availableUntil: until, state: 'available' }
              : { state: 'unavailable' },
          ),
        ),
      ),
    );
    // A switch has no losing writer to report: every device is told what the
    // state now is, and they all agree afterwards.
    expect(responses.every((response) => response.status === 200)).toBe(true);

    const rows = await rowsOf<{ revision: number; state: string }>(
      database.sql`select revision, state from users_availability`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revision).toBe(16);
    const settled = await readAvailability(caller);
    expect(settled.state).toBe(rows[0]?.state ?? '');
  });

  it('refuses availability before the adult gate and the notices are passed', async () => {
    const caller = await signIn('availability-early@velora.test');
    await handle(post('/v1/users', caller, {}));

    const refusedChange = await handle(
      post('/v1/users/me/availability', caller, {
        availableUntil: inMinutes(30),
        state: 'available',
      }),
    );
    expect(refusedChange.status).toBe(409);
    expect(((await refusedChange.json()) as { code: string }).code).toBe(
      'ACCOUNT_NOT_ELIGIBLE',
    );
  });

  it('refuses an unauthenticated caller on both operations', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const response = await handle(
        new Request('http://api.test/v1/users/me/availability', {
          ...(method === 'POST'
            ? { body: '{}', method: 'POST' }
            : { method: 'GET' }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(response.status, method).toBe(401);
    }
  });
});

describe('database constraints protect availability invariants', () => {
  async function seedAccount(): Promise<string> {
    const id = crypto.randomUUID();
    await execute(
      database.sql`insert into users_accounts (auth_account_id, created_at, id, region, status, status_changed_at, updated_at)
        values (${crypto.randomUUID()}, now(), ${id}, 'PT', 'pending_profile', now(), now())`,
    );
    return id;
  }

  it('refuses availability with no end and an end with no availability', async () => {
    const userId = await seedAccount();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_availability (state, user_id) values ('available', ${userId})`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_availability (available_until, state, user_id) values (now(), 'unavailable', ${userId})`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses an unknown state and a revision below one', async () => {
    const userId = await seedAccount();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_availability (state, user_id) values ('maybe', ${userId})`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_availability (revision, state, user_id) values (0, 'unavailable', ${userId})`,
        ),
      ),
    ).toBe(true);
  });
});
