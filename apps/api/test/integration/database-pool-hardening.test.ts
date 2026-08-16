import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import type { MediaRuntime } from '../../src/media/composition.js';
import type { UsersRuntime } from '../../src/users/composition.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  DatabaseService,
  databasePoolMaxConnections,
} from '../../src/database/database.service.js';
import { databaseAdmissionLimit } from '../../src/database/admission.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createNotificationsApiRuntime } from '../../src/notifications/composition.js';
import {
  createSafetyRuntime,
  type SafetyRuntime,
} from '../../src/safety/composition.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
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
  testServerConfig,
  testCreatorsRuntime,
  testClubsRuntime,
  testAdminRuntime,
  testBillingRuntime,
  testPayoutsRuntime,
  testMediaRuntime,
} from '../support/harness.js';
import {
  mediaEnvironment,
  readyProfileImage,
} from '../support/profile-media.js';

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

/**
 * The name the pools under test report in `pg_stat_activity`.
 *
 * Counting every backend on the database and comparing before with after does
 * not measure what this file is about. A migration subprocess that has exited,
 * an administrative connection that has been closed, and the harness's own
 * lazily-opened diagnostic connection all appear and disappear on their own
 * schedule, and under load the sampling window is wide enough to catch one —
 * which reads exactly like a connection the service leaked or lost.
 *
 * Naming the instance's own connections makes the assertion say what it means:
 * the pool under test holds the connections it opened, and neither more nor
 * fewer, whatever else is happening on the server.
 */
const instanceApplicationName = 'velora-pool-instance';
const instanceDatabaseUrl = (() => {
  const tagged = new URL(databaseUrl);
  tagged.searchParams.set('application_name', instanceApplicationName);
  return tagged.toString();
})();

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

interface Credentials {
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
}

interface Instance {
  close(): Promise<void>;
  handle(request: Request): Promise<Response>;
  /** The review seam, which has no HTTP surface to drive load through. */
  readonly safety: SafetyRuntime;
  /** The media platform this instance composed, for driving byte work. */
  readonly media: MediaRuntime;
  readonly service: DatabaseService;
  readonly users: UsersRuntime;
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
    DATABASE_URL: instanceDatabaseUrl,
    MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
    ...mediaEnvironment,
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
  const mediaRuntime = testMediaRuntime({
    config,
    database: service.database,
    logger,
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: service.database,
    logger,
    media: mediaRuntime.service,
  });
  const safety = createSafetyRuntime({
    accounts: users.enforcement,
    catalog: new ClubSafetyDirectory(),
    config,
    consumerContext: users.consumerContext,
    consumers: users.existence,
    conversationTargets: new ConversationParticipation(),
    conversations: new ConversationEnforcement(service.database),
    creators: new CreatorDirectory(),
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
  const creators = testCreatorsRuntime({
    caller: auth.caller,
    database: service.database,
    users,
  });
  const clubsRuntime = testClubsRuntime({
    config,
    creators,
    database: service.database,
    users,
  });
  // BILLING before ADMIN, exactly as the application composes them: an operator
  // reversal is BILLING's decision taken with an operator's authority.
  const billingRuntime = testBillingRuntime({
    clubs: clubsRuntime,
    config,
    creators,
    database: database.drizzle,
    users,
  });
  const application = createApplication({
    config,
    dependencies: {
      auth,
      billing: billingRuntime,
      payouts: testPayoutsRuntime({
        config,
        creators,
        database: database.drizzle,
      }),
      admin: testAdminRuntime({
        billing: billingRuntime,
        caller: auth.caller,
        config,
        clubs: clubsRuntime,
        creators,
        safety,
      }),
      clubs: clubsRuntime,
      creators,
      database: service,
      databaseAdmission: service.admission,
      discovery,
      ephemeralRedis: healthy,
      logger,
      media: testMediaRuntime({ config, database: service.database }),
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
  return {
    async close() {
      await application.close();
      await service.close();
    },
    handle: (request) => application.app.handle(request),
    safety,
    service,
    media: mediaRuntime,
    users,
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
  await readyProfileImage({
    database,
    media: instance.media,
    slotId: media.mediaId,
    users: instance.users,
  });
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

/** Backends belonging to the pools under test, and to nothing else. */
async function backendCount(): Promise<number> {
  return countOf(
    database.sql`select count(*)::int as count from pg_stat_activity
      where datname = current_database()
        and application_name = ${instanceApplicationName}`,
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
      testServerConfig({ DATABASE_URL: instanceDatabaseUrl }),
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

    const send = async (
      pair: (typeof pairs)[number],
      pairIndex: number,
      index: number,
    ) =>
      primary.handle(
        post('/v1/messaging/messages', pair.first, {
          body: `multi ${String(index)}`,
          clientMessageId: `pool-multi-${String(pairIndex)}-${String(index)}`,
          conversationId: pair.conversationId,
        }),
      );

    // Exactly the admission bound, spread one-per-pair-and-round, and strictly
    // not retried. This is the assertion that the bound does not refuse work
    // the pool can serve, and it is true on any host: the instance admits
    // `databaseAdmissionLimit` units at once, so a refusal at that load would
    // mean the bound is smaller than it claims rather than that the machine is
    // busy. Sizing it against the published constant is the point — a fixed
    // number here would be a guess about capacity rather than a statement of it.
    const withinBound = await Promise.all(
      Array.from({ length: databaseAdmissionLimit }, async (_unused, index) => {
        const pairIndex = index % pairs.length;
        const pair = pairs[pairIndex];
        if (pair === undefined) throw new Error('pair fixture is missing');
        return send(pair, pairIndex, index);
      }),
    );
    expect(withinBound).toHaveLength(databaseAdmissionLimit);
    expect(withinBound.every((response) => response.status === 200)).toBe(true);

    // Then the load the pool used to lose connections to: fifty at once, more
    // than six times the bound. A capacity refusal here is a truthful answer
    // rather than a defect — the instance declined to begin work it had no room
    // for — so it is retried exactly as the same load is on one conversation
    // above. What this proves is that five unrelated pairs settle without
    // serializing behind each other and without costing the pool a connection.
    const responses = await Promise.all(
      pairs.flatMap((pair, pairIndex) =>
        Array.from({ length: 10 }, async (_unused, index) =>
          attempt(async () =>
            send(pair, pairIndex, databaseAdmissionLimit + index),
          ),
        ),
      ),
    );

    expect(responses).toHaveLength(50);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    // Every send landed exactly once. Retrying a capacity refusal cannot
    // duplicate a message, because the client identifier is what makes a send
    // idempotent, and this is where that is checked rather than assumed.
    expect(
      await countOf(
        database.sql`select count(*)::int as count from messaging_messages`,
      ),
    ).toBe(50 + databaseAdmissionLimit);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });
});

describe('creator load runs on the same pool as everything else', () => {
  /**
   * Creator capabilities seeded directly, with Studio sessions to match.
   *
   * The onboarding ladder is exercised elsewhere; what this file is about is
   * the pool, so the rows are written and the load is driven through the real
   * `DatabaseService` at production sizes.
   */
  async function studioCreators(count: number): Promise<
    {
      readonly cookie: string;
      readonly creatorId: string;
      readonly csrf: string;
    }[]
  > {
    const opaque = () =>
      `v1.${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
    const digest = (value: string) => Bun.SHA256.hash(value, 'hex');
    const now = new Date();
    const built: {
      cookie: string;
      creatorId: string;
      csrf: string;
    }[] = [];
    for (let index = 0; index < count; index += 1) {
      const accountId = crypto.randomUUID();
      const creatorId = crypto.randomUUID();
      const token = opaque();
      const csrf = opaque();
      await execute(
        database.sql`insert into auth_accounts (id, status) values (${accountId}, 'active')`,
      );
      await execute(database.sql`
        insert into auth_sessions (
          id, account_id, audience, assurance, assurance_established_at,
          authenticated_at, created_at, csrf_digest, idle_expires_at,
          last_active_at, absolute_expires_at, token_digest
        ) values (
          ${crypto.randomUUID()}, ${accountId}, 'creator_studio', 'single_factor', ${now},
          ${now}, ${now}, ${digest(csrf)}, ${new Date(now.getTime() + 900_000)}, ${now},
          ${new Date(now.getTime() + 28_800_000)}, ${digest(token)}
        )
      `);
      await execute(database.sql`
        insert into creators_accounts
          (activated_at, auth_account_id, created_at, id, status, status_changed_at, status_reason, updated_at)
        values (${now}, ${accountId}, ${now}, ${creatorId}, 'active', ${now}, null, ${now})
      `);
      built.push({
        cookie: `__Host-velora_creator_studio_session=${token}`,
        creatorId,
        csrf,
      });
    }
    return built;
  }

  function studioPost(
    path: string,
    credentials: { readonly cookie: string; readonly csrf: string },
    body: unknown,
  ): Request {
    return new Request(`http://api.test${path}`, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        cookie: credentials.cookie,
        origin: testCreatorOrigin,
        'x-velora-csrf': credentials.csrf,
      },
      method: 'POST',
    });
  }

  it('settles fifty simultaneous claims of one handle without costing a connection', async () => {
    const creators = await studioCreators(50);
    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    const responses = await Promise.all(
      creators.map(async (creator) =>
        attempt(async () =>
          primary.handle(
            studioPost('/v1/creator/profile', creator, {
              displayName: 'Contested',
              handle: 'pool-contested',
            }),
          ),
        ),
      ),
    );

    // Exactly one owner, and the rest told the name is unavailable. The unique
    // index decides it; the pool is untouched either way.
    expect(responses.filter((entry) => entry.status === 201)).toHaveLength(1);
    expect(responses.filter((entry) => entry.status === 409)).toHaveLength(49);
    expect(
      await countOf(
        database.sql`select count(*)::int as count from creators_profiles where handle = 'pool-contested'`,
      ),
    ).toBe(1);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });

  it('settles concurrent catalog writes across many creators', async () => {
    const creators = await studioCreators(10);
    await Promise.all(
      creators.map(async (creator, index) =>
        attempt(async () =>
          primary.handle(
            studioPost('/v1/creator/profile', creator, {
              displayName: 'Writer',
              handle: `pool-writer-${String(index)}`,
            }),
          ),
        ),
      ),
    );
    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    const responses = await Promise.all(
      creators.flatMap((creator, creatorIndex) =>
        Array.from({ length: 5 }, async (_unused, item) =>
          attempt(async () =>
            primary.handle(
              studioPost('/v1/creator/content', creator, {
                title: `Item ${String(creatorIndex)}-${String(item)}`,
                visibility: 'public',
              }),
            ),
          ),
        ),
      ),
    );

    expect(responses).toHaveLength(50);
    expect(responses.every((entry) => entry.status === 201)).toBe(true);
    expect(
      await countOf(
        database.sql`select count(*)::int as count from clubs_content`,
      ),
    ).toBe(50);
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

/**
 * The review seam holds a subject advisory lock for the whole of a decision.
 *
 * That is the same shape as the pair lock the driver defect used to lose
 * connections to: a lock taken inside a transaction, held across several
 * statements, released only by the commit. It is proven not to deadlock in
 * `safety-decisions.test.ts`, but that suite runs on the harness connection
 * rather than on a pool, so nothing until now showed what contention on it
 * costs the pool a deployed process would actually have.
 */
describe('moderation load runs on the same pool as everything else', () => {
  it('settles concurrent contended decisions without costing a connection', async () => {
    const caseCount = 4;
    const reporter = await consumer(primary, 'pool-reporter@velora.test');
    const subjects: Credentials[] = [];
    for (let index = 0; index < caseCount; index += 1) {
      subjects.push(
        // Sequentially: onboarding is several dependent writes per account and
        // what is under test is the decision wave, not account creation.
        await consumer(primary, `pool-subject-${String(index)}@velora.test`),
      );
    }
    for (const [index, subject] of subjects.entries()) {
      const filed = await primary.handle(
        post('/v1/safety/reports', reporter, {
          clientReportId: `pool-decide-${String(index).padStart(4, '0')}`,
          reasonCode: 'harassment',
          target: { accountId: subject.id, type: 'consumer_account' },
        }),
      );
      expect(filed.status).toBe(200);
    }

    const cases = await Promise.all(
      subjects.map(async (subject) => {
        const [row] = await rowsOf<{ id: string; version: number }>(
          database.sql`select id, version from safety_cases
            where target_id = ${subject.id}`,
        );
        if (row === undefined) throw new Error('no case opened');
        const evidence = await primary.safety.moderation.caseEvidence(row.id);
        return {
          evidenceIds: evidence.map((entry) => entry.id),
          id: row.id,
          subjectId: subject.id,
          version: row.version,
        };
      }),
    );

    const backendsBefore = await backendCount();
    const deadlocksBefore = await deadlockCount();

    // Every case decided three times at once, and all four waves at once: the
    // subject lock is contended within each case and uncontended between them,
    // which is the arrangement a lock-ordering defect shows up under.
    const outcomes = await Promise.all(
      cases.flatMap((open) =>
        Array.from({ length: 3 }, async (_, attemptIndex) =>
          primary.safety.moderation.decideCase({
            action: 'restrict_capability',
            actorReference: `session:pool-reviewer-${String(attemptIndex)}`,
            caseId: open.id,
            evidenceIds: open.evidenceIds,
            expectedVersion: open.version,
            reasonCode: 'harassment',
            scope: 'account_restriction',
          }),
        ),
      ),
    );

    // One reviewer settles each case however many were looking at it.
    expect(
      outcomes.filter((outcome) => outcome.kind === 'recorded'),
    ).toHaveLength(caseCount);
    expect(
      await countOf(
        database.sql`select count(*)::int as count from safety_decisions`,
      ),
    ).toBe(caseCount);
    expect(
      await countOf(
        database.sql`select count(*)::int as count from users_accounts
          where status = 'restricted'`,
      ),
    ).toBe(caseCount);
    await expectPoolIntact(primary, backendsBefore, deadlocksBefore);
  });
});
