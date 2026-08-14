import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  DatabaseService,
  databasePoolMaxConnections,
} from '../../src/database/database.service.js';
import { databaseAdmissionLimit } from '../../src/database/admission.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { createNotificationsApiRuntime } from '../../src/notifications/composition.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { LocalTestProfileMediaStorage } from '../../src/users/media.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testConsumerOrigin,
  testServerConfig,
} from '../support/harness.js';

/**
 * The connection pool under the load that used to break it.
 *
 * The failure this file guards against is not a lock and not a query. A
 * Bun.SQL pool that has to queue a caller for a connection while it is also
 * serving `begin()` transactions and autocommit queries can lose a connection
 * permanently: the backend stays `idle in transaction` server-side and never
 * comes back, so an instance degrades toward zero connections and stops
 * answering. Measured on Bun 1.3.14, reproduced with no VELORA code and no
 * advisory lock involved.
 *
 * The mitigation is arithmetic rather than cleverness: open every connection
 * before serving, never reap one, and keep in-flight work below the pool so
 * there is nothing to queue. These tests run the real services over the real
 * `DatabaseService` at production sizes — pool ten, admission eight — because a
 * harness with a bigger pool would prove nothing about the deployed one.
 *
 * Every load below deliberately exceeds the admission bound, so the queueing
 * path is exercised rather than merely present.
 */

const databaseUrl = await provisionDatabase('velora_pool_hardening');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

interface Credentials {
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
}

interface Instance {
  close(): Promise<void>;
  handle(request: Request): Promise<Response>;
  readonly service: DatabaseService;
  readonly storage: LocalTestProfileMediaStorage;
}

let requesterSequence = 0;

/**
 * One modelled API instance: its own pool, its own bound, its own runtimes.
 *
 * Built the way `createApplication` builds them for production, with the real
 * `DatabaseService` injected rather than a health stub, so what is under test
 * is the pool the deployed process would have.
 */
function createInstance(name: string): Instance {
  const config = testServerConfig({
    DATABASE_URL: databaseUrl,
    MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
    USERS_PROFILE_MEDIA_STORAGE: 'local-test',
  });
  const logger = silentLogger();
  const service = new DatabaseService(config);
  const auth = createAuthRuntime({
    config,
    database: service.database,
    logger,
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      requesterReference: () => {
        requesterSequence += 1;
        return `${name}-${String(requesterSequence)}`;
      },
    },
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: service.database,
    logger,
  });
  const safety = createSafetyRuntime({
    accounts: users.enforcement,
    consumerContext: users.consumerContext,
    conversations: new ConversationEnforcement(service.database),
    database: service.database,
    users: users.service,
  });
  const discovery = createDiscoveryRuntime({
    consumerContext: users.consumerContext,
    database: service.database,
    directory: users.directory,
    logger,
    onboarding: users.onboarding,
    safety: safety.directory,
  });
  const messaging = createMessagingRuntime({
    config,
    connections: discovery.connections,
    consumerContext: users.consumerContext,
    database: service.database,
    directory: users.directory,
    onboarding: users.onboarding,
    safety: safety.directory,
  });
  const application = createApplication({
    config,
    dependencies: {
      auth,
      database: service,
      databaseAdmission: service.admission,
      discovery,
      ephemeralRedis: healthy,
      logger,
      messaging,
      notifications: createNotificationsApiRuntime({
        consumerContext: users.consumerContext,
        database: service.database,
        safety: safety.directory,
      }),
      queueRedis: healthy,
      safety,
      users,
    },
  });
  const storage = users.profileMediaStorage;
  if (!(storage instanceof LocalTestProfileMediaStorage)) {
    throw new Error('Pool hardening tests expect the development storage');
  }
  return {
    async close() {
      await application.close();
      await service.close();
    },
    handle: (request) => application.app.handle(request),
    service,
    storage,
  };
}

const primary = createInstance('pool-primary');
await primary.service.warm();

afterAll(async () => {
  await primary.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

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

/** A fully onboarded, discoverable consumer, created through the real routes. */
async function consumer(
  instance: Instance,
  subject: string,
): Promise<Credentials> {
  const signIn = await instance.handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'consumer_web', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testConsumerOrigin,
      },
      method: 'POST',
    }),
  );
  const session = (await signIn.json()) as { csrfToken: string };
  const cookie = signIn.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
  const created = await instance.handle(
    new Request('http://api.test/v1/users', {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        cookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': session.csrfToken,
      },
      method: 'POST',
    }),
  );
  const account = (await created.json()) as { id: string };
  const caller: Credentials = {
    cookie,
    csrf: session.csrfToken,
    id: account.id,
  };

  await instance.handle(
    post('/v1/users/me/onboarding/adult-declaration', caller, {
      declaresAdult: true,
      region: 'ES',
    }),
  );
  await instance.handle(
    post('/v1/users/me/onboarding/acknowledgements', caller, {
      acknowledgements: requiredPolicyDocuments.map((document) => ({
        key: document.key,
        version: document.version,
      })),
    }),
  );
  await instance.handle(
    post('/v1/users/me/profile', caller, {
      displayName: subject.split('@')[0] ?? 'Consumer',
      languages: ['es'],
    }),
  );
  const upload = await instance.handle(
    post('/v1/users/me/profile/media', caller, {}),
  );
  const media = (await upload.json()) as { mediaId: string };
  const rows = await rowsOf<{ storage_key: string }>(
    database.sql`select storage_key from users_profile_media where id = ${media.mediaId}`,
  );
  instance.storage.put(rows[0]?.storage_key ?? '', jpegBytes);
  await instance.handle(
    post('/v1/users/me/profile/media/completion', caller, {
      mediaId: media.mediaId,
    }),
  );
  await instance.handle(
    post('/v1/users/me/preferences', caller, { discoverable: true }),
  );
  await instance.handle(
    post('/v1/users/me/availability', caller, {
      availableUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      state: 'available',
    }),
  );
  return caller;
}

async function signal(
  instance: Instance,
  actor: Credentials,
  target: Credentials,
): Promise<Response> {
  return instance.handle(
    post('/v1/discovery/introductions', actor, { candidateId: target.id }),
  );
}

async function mutualConversation(
  first: Credentials,
  second: Credentials,
): Promise<string> {
  await signal(primary, first, second);
  const mutual = await signal(primary, second, first);
  const introduction = (await mutual.json()) as { id: string; state: string };
  expect(introduction.state).toBe('mutual');
  const opened = await primary.handle(
    post('/v1/messaging/conversations', first, {
      introductionId: introduction.id,
    }),
  );
  expect(opened.status).toBe(200);
  return ((await opened.json()) as { id: string }).id;
}

/**
 * Sends one request, retrying a capacity refusal the way the contract says to.
 *
 * A 503 here is a real answer rather than a failure: it means the instance
 * declined to begin the work, which is exactly what makes retrying safe. The
 * mutations these tests retry are idempotent — a repeated signal is the same
 * introduction, a repeated `clientMessageId` is the same message — so the counts
 * asserted afterwards hold whether a wave was refused or not.
 */
async function attempt(perform: () => Promise<Response>): Promise<Response> {
  for (let remaining = 10; remaining > 0; remaining -= 1) {
    const response = await perform();
    if (response.status !== 503) return response;
  }
  throw new Error('The instance stayed saturated across every retry');
}

async function countOf(query: unknown): Promise<number> {
  const rows = await rowsOf<{ count: number }>(query);
  return rows[0]?.count ?? 0;
}

/** Backends this database currently has, whoever opened them. */
async function backendCount(): Promise<number> {
  return countOf(
    database.sql`select count(*)::int as count from pg_stat_activity where datname = current_database()`,
  );
}

async function deadlockCount(): Promise<number> {
  return countOf(
    database.sql`select deadlocks::int as count from pg_stat_database where datname = current_database()`,
  );
}

/**
 * The three things a lost connection would show up as, checked together.
 *
 * A defect-lost connection is permanent, so "still zero afterwards" is the
 * assertion that matters: a transient spike during the load would have been
 * recovered, and one that is not recovered never leaves this state.
 */
async function expectPoolIntact(
  instance: Instance,
  backendsBefore: number,
  deadlocksBefore: number,
): Promise<void> {
  expect(await instance.service.stalledTransactionCount(0)).toBe(0);
  expect(await deadlockCount()).toBe(deadlocksBefore);
  expect(await backendCount()).toBe(backendsBefore);
  expect(instance.service.snapshot().inFlight).toBe(0);
  // The pool still answers, which a pool that had lost its connections to the
  // driver defect would eventually stop doing.
  expect(await instance.service.isReady()).toBe(true);
}

describe('the connection pool is opened before it is used', () => {
  it('establishes every connection during warm-up and keeps them', async () => {
    const before = await backendCount();
    const service = new DatabaseService(
      testServerConfig({ DATABASE_URL: databaseUrl }),
    );
    try {
      await service.warm();
      // Exactly the configured pool, not one connection serving a warm-up loop.
      expect((await backendCount()) - before).toBe(databasePoolMaxConnections);
      expect(service.poolMax).toBe(databasePoolMaxConnections);
      expect(service.snapshot().limit).toBe(databaseAdmissionLimit);
      // The gap between the two is the margin readiness and migrations use.
      expect(service.snapshot().limit).toBeLessThan(service.poolMax);
    } finally {
      await service.close();
    }
  });

  it('fails a startup that cannot reach the database', async () => {
    const unreachable = new DatabaseService(
      testServerConfig({
        DATABASE_URL: 'postgresql://velora:velora@127.0.0.1:1/velora',
      }),
    );
    let startupError: unknown;
    try {
      await unreachable.warm();
    } catch (error) {
      startupError = error;
    } finally {
      await unreachable.close();
    }
    expect(startupError).toBeDefined();
    // The failure carries the driver's message, and the URL is never
    // interpolated into it, so a startup log cannot leak a password.
    expect(JSON.stringify(String(startupError))).not.toContain('velora:velora');
  });
});

describe('the pair lock under load the pool used to lose connections to', () => {
  it('settles fifty simultaneous signals on one pair and introduces once', async () => {
    const alice = await consumer(primary, 'pool-alice@velora.test');
    const bob = await consumer(primary, 'pool-bob@velora.test');
    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    const responses = await Promise.all(
      Array.from({ length: 50 }, async () =>
        attempt(async () => signal(primary, alice, bob)),
      ),
    );

    // Every request answered. The failure this file exists for is a request
    // that never settles at all, so this is the primary assertion.
    expect(responses).toHaveLength(50);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(
      await countOf(
        database.sql`select count(*)::int as count from discovery_introductions`,
      ),
    ).toBe(1);
    // Fifty against a bound of eight cannot have run without queueing.
    expect(primary.service.snapshot().maxWaiting).toBeGreaterThan(0);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });

  it('settles fifty simultaneous sends in one conversation', async () => {
    const first = await consumer(primary, 'pool-send-first@velora.test');
    const second = await consumer(primary, 'pool-send-second@velora.test');
    const conversationId = await mutualConversation(first, second);
    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    const responses = await Promise.all(
      Array.from({ length: 50 }, async (_unused, index) =>
        attempt(async () =>
          primary.handle(
            post('/v1/messaging/messages', first, {
              body: `message ${String(index)}`,
              clientMessageId: `pool-send-${String(index)}`,
              conversationId,
            }),
          ),
        ),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(
      await countOf(
        database.sql`select count(*)::int as count from messaging_messages where conversation_id = ${conversationId}`,
      ),
    ).toBe(50);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });

  it('settles a block racing sends and signals on the same pair', async () => {
    const first = await consumer(primary, 'pool-mixed-first@velora.test');
    const second = await consumer(primary, 'pool-mixed-second@velora.test');
    const third = await consumer(primary, 'pool-mixed-third@velora.test');
    const conversationId = await mutualConversation(first, second);
    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    const responses = await Promise.all([
      attempt(async () =>
        primary.handle(
          post('/v1/safety/blocks', second, { targetId: first.id }),
        ),
      ),
      ...Array.from({ length: 12 }, async (_unused, index) =>
        attempt(async () =>
          primary.handle(
            post('/v1/messaging/messages', first, {
              body: `racing ${String(index)}`,
              clientMessageId: `pool-mixed-${String(index)}`,
              conversationId,
            }),
          ),
        ),
      ),
      ...Array.from({ length: 12 }, async () =>
        attempt(async () => signal(primary, first, third)),
      ),
    ]);

    expect(responses).toHaveLength(25);
    // Every one answered, and none of them with a capacity refusal after retry.
    // What each send was allowed to do was decided by the block, in PostgreSQL;
    // the admission bound never sees a business rule and decides nothing.
    expect(responses.every((response) => response.status !== 503)).toBe(true);
    expect(responses[0].status).toBe(200);
    expect(
      await countOf(
        database.sql`select count(*)::int as count from safety_blocks where revoked_at is null`,
      ),
    ).toBe(1);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });

  it('settles unrelated pairs concurrently', async () => {
    const pairs = await Promise.all(
      Array.from({ length: 5 }, async (_unused, index) => {
        const first = await consumer(
          primary,
          `pool-multi-${String(index)}-first@velora.test`,
        );
        const second = await consumer(
          primary,
          `pool-multi-${String(index)}-second@velora.test`,
        );
        return {
          conversationId: await mutualConversation(first, second),
          first,
        };
      }),
    );
    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    const responses = await Promise.all(
      pairs.flatMap((pair, pairIndex) =>
        Array.from({ length: 10 }, async (_unused, index) =>
          primary.handle(
            post('/v1/messaging/messages', pair.first, {
              body: `multi ${String(index)}`,
              clientMessageId: `pool-multi-${String(pairIndex)}-${String(index)}`,
              conversationId: pair.conversationId,
            }),
          ),
        ),
      ),
    );

    expect(responses).toHaveLength(50);
    // Strict, and deliberately not retried. Work spread over five pairs clears
    // well inside the bounded wait, so a capacity refusal here would mean the
    // bound is refusing ordinary traffic rather than protecting the pool.
    expect(responses.every((response) => response.status === 200)).toBe(true);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });
});

describe('an instance with no capacity says so instead of hanging', () => {
  it('refuses without starting the work, and succeeds once capacity returns', async () => {
    const alice = await consumer(primary, 'pool-full-alice@velora.test');
    const bob = await consumer(primary, 'pool-full-bob@velora.test');
    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    let releaseHolders!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseHolders = resolve;
    });
    const holders = Array.from({ length: databaseAdmissionLimit }, async () =>
      primary.service.admission.run(() => held),
    );
    // Every permit is taken, so the next request has nowhere to go.
    while (primary.service.snapshot().inFlight < databaseAdmissionLimit) {
      await Promise.resolve();
    }
    expect(primary.service.snapshot().inFlight).toBe(databaseAdmissionLimit);

    const refused = await signal(primary, alice, bob);

    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe('1');
    const body = (await refused.json()) as { code: string; message: string };
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    // Nothing about the pool, the bound, or the driver reaches a caller.
    expect(JSON.stringify(body)).not.toContain('pool');
    expect(JSON.stringify(body)).not.toContain('connection');
    // The business action never began: no row, and nothing to reconcile.
    expect(
      await countOf(
        database.sql`select count(*)::int as count from discovery_introductions`,
      ),
    ).toBe(0);

    releaseHolders();
    await Promise.all(holders);

    const retried = await signal(primary, alice, bob);
    expect(retried.status).toBe(200);
    const again = await signal(primary, alice, bob);
    expect(again.status).toBe(200);
    // The refusal cost nothing and the retry duplicated nothing: signalling is
    // idempotent, so one pair still holds exactly one introduction.
    expect(
      await countOf(
        database.sql`select count(*)::int as count from discovery_introductions`,
      ),
    ).toBe(1);
    expect(primary.service.snapshot().saturated).toBeGreaterThan(0);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });
});

describe('the bound is per process and PostgreSQL is still the authority', () => {
  it('keeps two replicas independent and still introduces once', async () => {
    const replica = createInstance('pool-replica');
    await replica.service.warm();
    try {
      const alice = await consumer(primary, 'pool-replica-alice@velora.test');
      const bob = await consumer(primary, 'pool-replica-bob@velora.test');
      const backendsBefore = await backendCount();
      const deadlocksBefore = await deadlockCount();

      const responses = await Promise.all([
        ...Array.from({ length: 8 }, async () => signal(primary, alice, bob)),
        ...Array.from({ length: 8 }, async () => signal(replica, alice, bob)),
      ]);

      expect(responses.every((response) => response.status === 200)).toBe(true);
      // Sixteen simultaneous requests, two independent bounds of eight, and one
      // introduction. The semaphore serialized nothing across processes and was
      // never asked to: the pair advisory lock did that, in the database.
      expect(
        await countOf(
          database.sql`select count(*)::int as count from discovery_introductions`,
        ),
      ).toBe(1);
      expect(primary.service.snapshot().limit).toBe(databaseAdmissionLimit);
      expect(replica.service.snapshot().limit).toBe(databaseAdmissionLimit);
      expect(replica.service.snapshot().granted).toBeGreaterThan(0);
      await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
      expect(await replica.service.stalledTransactionCount(0)).toBe(0);
    } finally {
      await replica.close();
    }
  });
});
