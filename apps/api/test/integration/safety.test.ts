import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { reportRateLimitCount } from '../../src/safety/policy.js';
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
  testAdminOrigin,
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testNotificationsApiRuntime,
  testServerConfig,
  testCreatorsRuntime,
  testClubsRuntime,
  testAdminRuntime,
  testBillingRuntime,
  testPayoutsRuntime,
  testMediaRuntime,
  testIdentityRuntime,
} from '../support/harness.js';
import {
  mediaEnvironment,
  readyProfileImage,
} from '../support/profile-media.js';

const databaseUrl = await provisionDatabase('velora_safety');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
  ...mediaEnvironment,
});

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

const logs: unknown[] = [];
const logger = silentLogger(logs);

let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `safety-test-${String(requesterSequence)}`;
    },
  },
});
const mediaRuntime = testMediaRuntime({
  config,
  database: database.drizzle,
  logger,
  now,
});

const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
  media: mediaRuntime.service,
});
const safety = createSafetyRuntime({
  accounts: users.enforcement,
  catalog: new ClubSafetyDirectory(),
  config,
  consumerContext: users.consumerContext,
  consumers: users.existence,
  conversationTargets: new ConversationParticipation(),
  conversations: new ConversationEnforcement(database.drizzle),
  creators: new CreatorDirectory(),
  database: database.drizzle,
  now,
  users: users.service,
});
const discovery = createDiscoveryRuntime({
  consumerContext: users.consumerContext,
  database: database.drizzle,
  directory: users.directory,
  logger,
  now,
  onboarding: users.onboarding,
  safety: safety.directory,
});
const messaging = createMessagingRuntime({
  config,
  connections: discovery.connections,
  consumerContext: users.consumerContext,
  database: database.drizzle,
  directory: users.directory,
  now,
  onboarding: users.onboarding,
  safety: safety.directory,
});
const creators = testCreatorsRuntime({
  caller: auth.caller,
  database: database.drizzle,
  now,
  users,
});
const clubsRuntime = testClubsRuntime({
  config,
  creators,
  database: database.drizzle,
  now,
  users,
});
// BILLING before ADMIN, exactly as the application composes them: an operator
// reversal is BILLING's decision taken with an operator's authority, so ADMIN
// receives the service rather than reaching into a financial table.
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
      media: mediaRuntime,
      safety,
    }),
    clubs: clubsRuntime,
    creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery,
    ephemeralRedis: healthy,
    logger,
    identity: testIdentityRuntime({
      config,
      database: database.drizzle,
      logger,
      now,
    }),
    media: mediaRuntime,
    messaging,
    notifications: testNotificationsApiRuntime({
      database: database.drizzle,
      now,
      safety,
      users,
    }),
    queueRedis: healthy,
    safety,
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
  logs.length = 0;
  await database.truncate();
});

interface Credentials {
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
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

async function signIn(
  subject: string,
  audience: 'consumer_web' | 'creator_studio' = 'consumer_web',
): Promise<{ readonly cookie: string; readonly csrf: string }> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience, subject }),
      headers: {
        'content-type': 'application/json',
        origin:
          audience === 'creator_studio'
            ? testCreatorOrigin
            : testConsumerOrigin,
      },
      method: 'POST',
    }),
  );
  const session = (await response.json()) as { csrfToken?: string };
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
  return { cookie, csrf: session.csrfToken ?? '' };
}

async function consumer(subject: string): Promise<Credentials> {
  const session = await signIn(subject);
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
  const caller: Credentials = {
    cookie: session.cookie,
    csrf: session.csrf,
    id: account.id,
  };

  await handle(
    post('/v1/users/me/onboarding/adult-declaration', caller, {
      declaresAdult: true,
      region: 'ES',
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
  await handle(
    post('/v1/users/me/profile', caller, {
      displayName: subject.split('@')[0] ?? 'Consumer',
      languages: ['es'],
    }),
  );
  const upload = await handle(post('/v1/users/me/profile/media', caller, {}));
  const media = (await upload.json()) as { mediaId: string };
  await readyProfileImage({
    database,
    media: mediaRuntime,
    assetId: media.mediaId,
    users,
  });
  await handle(
    post('/v1/users/me/preferences', caller, { discoverable: true }),
  );
  await handle(
    post('/v1/users/me/availability', caller, {
      availableUntil: new Date(now().getTime() + 60 * 60 * 1000).toISOString(),
      state: 'available',
    }),
  );
  return caller;
}

async function blockOf(
  actor: Credentials,
  targetId: string,
): Promise<{ body: { code?: string }; status: number }> {
  const response = await handle(post('/v1/safety/blocks', actor, { targetId }));
  return {
    body: (await response.json()) as { code?: string },
    status: response.status,
  };
}

async function signal(
  actor: Credentials,
  targetId: string,
): Promise<{ body: { id?: string; state?: string }; status: number }> {
  const response = await handle(
    post('/v1/discovery/introductions', actor, { candidateId: targetId }),
  );
  return {
    body: (await response.json()) as { id?: string; state?: string },
    status: response.status,
  };
}

async function mutualIntroduction(
  first: Credentials,
  second: Credentials,
): Promise<string> {
  await signal(first, second.id);
  const mutual = await signal(second, first.id);
  expect(mutual.body.state).toBe('mutual');
  return mutual.body.id ?? '';
}

async function openConversation(
  actor: Credentials,
  introductionId: string,
): Promise<string> {
  const response = await handle(
    post('/v1/messaging/conversations', actor, { introductionId }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { id: string }).id;
}

async function send(
  actor: Credentials,
  input: {
    readonly body: string;
    readonly clientMessageId: string;
    readonly conversationId: string;
  },
): Promise<{ body: { code?: string }; status: number }> {
  const response = await handle(post('/v1/messaging/messages', actor, input));
  return {
    body: (await response.json()) as { code?: string },
    status: response.status,
  };
}

async function candidateIds(caller: Credentials): Promise<string[]> {
  const response = await handle(get('/v1/discovery/candidates', caller));
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    candidates: readonly { id: string }[];
  };
  return body.candidates.map((candidate) => candidate.id);
}

async function countOf(table: string, where = 'true'): Promise<number> {
  const rows = await rowsOf<{ count: string }>(
    database.sql.unsafe(
      `select count(*)::text as count from ${table} where ${where}`,
    ),
  );
  return Number(rows[0]?.count ?? '0');
}

/** The advisory key `lockPair` derives, so a test can hold the same lock. */
function pairLockKey(first: string, second: string): string {
  const low = first < second ? first : second;
  const high = first < second ? second : first;
  return `${low}:${high}`;
}

/** How many deadlocks PostgreSQL has resolved in this database so far. */
async function deadlockCount(): Promise<number> {
  const rows = await rowsOf<{ deadlocks: string }>(
    database.sql`select deadlocks::text as deadlocks from pg_stat_database where datname = current_database()`,
  );
  return Number(rows[0]?.deadlocks ?? '0');
}

async function connectedPair(prefix: string): Promise<{
  readonly conversationId: string;
  readonly first: Credentials;
  readonly introductionId: string;
  readonly second: Credentials;
}> {
  const first = await consumer(`${prefix}-first@velora.test`);
  const second = await consumer(`${prefix}-second@velora.test`);
  const introductionId = await mutualIntroduction(first, second);
  return {
    conversationId: await openConversation(first, introductionId),
    first,
    introductionId,
    second,
  };
}

describe('a block is one person’s own decision', () => {
  it('is idempotent, private, and never a claim about the other person', async () => {
    const first = await consumer('block-first@velora.test');
    const second = await consumer('block-second@velora.test');

    const initial = await blockOf(first, second.id);
    const repeated = await blockOf(first, second.id);
    expect([initial.status, repeated.status]).toEqual([200, 200]);
    expect(await countOf('safety_blocks')).toBe(1);

    // The blocked person is told nothing, and their own list stays empty.
    const theirs = await handle(get('/v1/safety/blocks', second));
    expect(theirs.status).toBe(200);
    expect(await theirs.json()).toEqual({ blocks: [] });
  });

  it('refuses blocking oneself and blocking an account that is not there', async () => {
    const first = await consumer('block-self@velora.test');
    expect((await blockOf(first, first.id)).status).toBe(422);
    expect((await blockOf(first, crypto.randomUUID())).status).toBe(422);
    expect(await countOf('safety_blocks')).toBe(0);
  });

  it('takes effect in both directions from one directional record', async () => {
    const pair = await connectedPair('block-symmetry');
    await blockOf(pair.first, pair.second.id);

    const fromBlocker = await send(pair.first, {
      body: 'from the person who blocked',
      clientMessageId: 'symmetry-0001',
      conversationId: pair.conversationId,
    });
    const fromBlocked = await send(pair.second, {
      body: 'from the person who was blocked',
      clientMessageId: 'symmetry-0002',
      conversationId: pair.conversationId,
    });
    expect([fromBlocker.status, fromBlocked.status]).toEqual([409, 409]);
    expect(await countOf('messaging_messages')).toBe(0);
  });

  it('restores interaction when the blocker withdraws it, keeping the record', async () => {
    const pair = await connectedPair('block-withdrawal');
    await blockOf(pair.first, pair.second.id);
    const removal = await handle(
      post('/v1/safety/blocks/removal', pair.first, {
        targetId: pair.second.id,
      }),
    );
    expect(removal.status).toBe(200);

    const accepted = await send(pair.first, {
      body: 'talking again',
      clientMessageId: 'withdrawal-0001',
      conversationId: pair.conversationId,
    });
    expect(accepted.status).toBe(200);
    // The withdrawal is recorded, not erased.
    expect(await countOf('safety_blocks')).toBe(1);
    expect(await countOf('safety_blocks', 'revoked_at is not null')).toBe(1);
  });

  it('refuses withdrawing a block the caller never made', async () => {
    const first = await consumer('block-nothing-first@velora.test');
    const second = await consumer('block-nothing-second@velora.test');
    const response = await handle(
      post('/v1/safety/blocks/removal', first, { targetId: second.id }),
    );
    expect(response.status).toBe(404);
  });

  it('stays available to an account that is itself restricted', async () => {
    const first = await consumer('block-restricted-first@velora.test');
    const second = await consumer('block-restricted-second@velora.test');
    await execute(
      database.sql`update users_accounts
        set status = 'restricted', status_reason = 'safety_enforcement'
        where id = ${first.id}`,
    );

    // Somebody under enforcement must still be able to stop being contacted.
    expect((await blockOf(first, second.id)).status).toBe(200);
  });
});

describe('a block wins every race it is in', () => {
  it('excludes a message the instant it is recorded', async () => {
    const pair = await connectedPair('race-message-sequential');
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await blockOf(pair.first, pair.second.id);
      const refusedSend = await send(pair.first, {
        body: 'after the block',
        clientMessageId: `seq-${String(attempt).padStart(4, '0')}`,
        conversationId: pair.conversationId,
      });
      expect(refusedSend.status).toBe(409);
      await handle(
        post('/v1/safety/blocks/removal', pair.first, {
          targetId: pair.second.id,
        }),
      );
    }
    expect(await countOf('messaging_messages')).toBe(0);
  });

  it('serializes a send against the pair lock rather than racing it', async () => {
    const pair = await connectedPair('race-message-lock');
    // Holding the pair's advisory lock from outside proves the send takes it:
    // if the send could reach its safety check without it, this would complete.
    const holder = new Bun.SQL(database.url, { max: 1 });
    await holder.unsafe('begin');
    await holder.unsafe(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [pairLockKey(pair.first.id, pair.second.id)],
    );

    let settled = false;
    const sending = send(pair.first, {
      body: 'waiting on the lock',
      clientMessageId: 'lock-proof-0001',
      conversationId: pair.conversationId,
    }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await Bun.sleep(250);
    // Deterministic rather than timing-dependent: the lock is held, so the send
    // cannot have proceeded, however long or short the wait.
    expect(settled).toBe(false);

    await holder.unsafe('commit');
    await holder.close();
    expect((await sending).status).toBe(200);
  });

  it('serializes a block against the same lock', async () => {
    const first = await consumer('race-block-lock-first@velora.test');
    const second = await consumer('race-block-lock-second@velora.test');
    const holder = new Bun.SQL(database.url, { max: 1 });
    await holder.unsafe('begin');
    await holder.unsafe(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [pairLockKey(first.id, second.id)],
    );

    let settled = false;
    const blocking = blockOf(first, second.id).then((outcome) => {
      settled = true;
      return outcome;
    });
    await Bun.sleep(250);
    expect(settled).toBe(false);

    await holder.unsafe('commit');
    await holder.close();
    expect((await blocking).status).toBe(200);
    // Both operations wait on the same lock, so no interleaving of the two is
    // reachable: one commits entirely before the other begins its check.
  });

  it('leaves no half state when a block and a message race', async () => {
    const pairs = await Promise.all(
      Array.from({ length: 8 }, async (_, index) =>
        connectedPair(`race-message-${String(index)}`),
      ),
    );
    const deadlocksBefore = await deadlockCount();

    const outcomes = await Promise.all(
      pairs.flatMap((pair, index) => [
        send(pair.first, {
          body: 'racing the block',
          clientMessageId: `race-${String(index).padStart(4, '0')}`,
          conversationId: pair.conversationId,
        }),
        blockOf(pair.second, pair.first.id).then((result) => ({
          body: result.body,
          status: result.status,
        })),
      ]),
    );

    // Nothing errored, and PostgreSQL resolved no deadlock: the pair lock is
    // always taken before any row lock, so the lock graph has no cycle.
    expect(outcomes.every((outcome) => outcome.status < 500)).toBe(true);
    expect(await deadlockCount()).toBe(deadlocksBefore);

    for (const pair of pairs) {
      // Whichever order the pair serialized in, the end state is consistent:
      // the block stands, and a further send is refused.
      expect(
        await countOf('safety_blocks', `blocker_id = '${pair.second.id}'`),
      ).toBe(1);
      const after = await send(pair.first, {
        body: 'after the race',
        clientMessageId: 'race-after-0001',
        conversationId: pair.conversationId,
      });
      expect(after.status).toBe(409);
      const written = await countOf(
        'messaging_messages',
        `conversation_id = '${pair.conversationId}'`,
      );
      expect(written === 0 || written === 1).toBe(true);
    }
  });

  it('leaves no half state when a block and an introduction race', async () => {
    const deadlocksBefore = await deadlockCount();
    const pairs = await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const first = await consumer(
          `race-intro-${String(index)}-first@velora.test`,
        );
        const second = await consumer(
          `race-intro-${String(index)}-second@velora.test`,
        );
        return { first, second };
      }),
    );

    const outcomes = await Promise.all(
      pairs.flatMap((pair) => [
        signal(pair.first, pair.second.id),
        blockOf(pair.second, pair.first.id),
      ]),
    );
    expect(outcomes.every((outcome) => outcome.status < 500)).toBe(true);
    expect(await deadlockCount()).toBe(deadlocksBefore);

    for (const pair of pairs) {
      // Once the block stands, a further signal is refused and answers exactly
      // as a candidate who is not there.
      const after = await signal(pair.first, pair.second.id);
      expect(after.status).toBe(404);
      const live = await countOf(
        'discovery_introductions',
        `state <> 'closed' and pair_low_id in ('${pair.first.id}', '${pair.second.id}') and pair_high_id in ('${pair.first.id}', '${pair.second.id}')`,
      );
      expect(live <= 1).toBe(true);
    }
  });

  it('refuses a reciprocal signal once either side has blocked', async () => {
    const first = await consumer('race-reciprocal-first@velora.test');
    const second = await consumer('race-reciprocal-second@velora.test');
    const pending = await signal(first, second.id);
    expect(pending.body.state).toBe('pending');

    await blockOf(second, first.id);
    const reciprocal = await signal(second, first.id);
    expect(reciprocal.status).toBe(404);
    expect(await countOf('discovery_introductions', "state = 'mutual'")).toBe(
      0,
    );
  });

  it('removes a blocked candidate from discovery at once', async () => {
    const viewer = await consumer('race-feed-viewer@velora.test');
    const candidate = await consumer('race-feed-candidate@velora.test');
    expect(await candidateIds(viewer)).toContain(candidate.id);

    await blockOf(viewer, candidate.id);
    expect(await candidateIds(viewer)).not.toContain(candidate.id);
    // And in the other direction, from the blocked person's own feed.
    expect(await candidateIds(candidate)).not.toContain(viewer.id);
  });

  it('never leaks a blocked candidate onto a later page of a live feed', async () => {
    const viewer = await consumer('race-paging-viewer@velora.test');
    const candidates = await Promise.all(
      Array.from({ length: 6 }, async (_, index) =>
        consumer(`race-paging-${String(index)}@velora.test`),
      ),
    );

    const firstPage = await handle(
      get('/v1/discovery/candidates?pageSize=2', viewer),
    );
    const firstBody = (await firstPage.json()) as {
      candidates: readonly { id: string }[];
      nextCursor?: string;
    };
    const seen = firstBody.candidates.map((entry) => entry.id);

    // Everybody the reader has not yet reached is blocked mid-read.
    const remaining = candidates.filter((entry) => !seen.includes(entry.id));
    await Promise.all(
      remaining.map(async (entry) => blockOf(viewer, entry.id)),
    );

    let cursor = firstBody.nextCursor;
    while (cursor !== undefined) {
      const response = await handle(
        get(`/v1/discovery/candidates?pageSize=2&cursor=${cursor}`, viewer),
      );
      const body = (await response.json()) as {
        candidates: readonly { id: string }[];
        nextCursor?: string;
      };
      for (const entry of body.candidates) {
        expect(remaining.map((item) => item.id)).not.toContain(entry.id);
      }
      cursor = body.nextCursor;
    }
  });
});

describe('a report is evidence, not a message to the person reported', () => {
  it('records a report and shows it only to its own reporter', async () => {
    const reporter = await consumer('report-reporter@velora.test');
    const subject = await consumer('report-subject@velora.test');

    const created = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'report-key-0001',
        detail: 'a private narrative that must never be republished',
        reasonCode: 'harassment',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    expect(created.status).toBe(200);
    const body = (await created.json()) as Record<string, unknown>;
    expect(body.state).toBe('received');
    expect(body.targetType).toBe('consumer_account');
    // The reporter is not handed an identifier back; they named the person.
    expect(body.subjectId).toBeUndefined();
    // Nothing about the reporter, and nothing they wrote, comes back.
    expect(Object.keys(body).sort()).toEqual([
      'createdAt',
      'id',
      'reasonCode',
      'state',
      'targetType',
    ]);

    const mine = await handle(get('/v1/safety/reports', reporter));
    expect(
      ((await mine.json()) as { reports: unknown[] }).reports,
    ).toHaveLength(1);
    // The person reported sees nothing at all.
    const theirs = await handle(get('/v1/safety/reports', subject));
    expect(
      ((await theirs.json()) as { reports: unknown[] }).reports,
    ).toHaveLength(0);
  });

  it('never publishes a reporter, a narrative, or an internal state anywhere', async () => {
    const reporter = await consumer('privacy-reporter@velora.test');
    const subject = await consumer('privacy-subject@velora.test');
    const narrative = 'narrative-that-must-never-leave-the-database-7c1f';

    await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'privacy-key-0001',
        detail: narrative,
        reasonCode: 'impersonation',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );

    // The narrative and the field names that could carry one are absent from
    // every response either party can obtain.
    const everySurface = await Promise.all([
      handle(get('/v1/safety/reports', reporter)),
      handle(get('/v1/safety/reports', subject)),
      handle(get('/v1/safety/blocks', reporter)),
      handle(get('/v1/safety/blocks', subject)),
      handle(get('/v1/discovery/candidates', subject)),
      handle(get('/v1/users/me', subject)),
      handle(get('/v1/users/me/onboarding', subject)),
      handle(get('/v1/messaging/conversations', subject)),
    ]);
    for (const response of everySurface) {
      const text = await response.text();
      expect(text).not.toContain(narrative);
      expect(text).not.toContain('reporterId');
      expect(text).not.toContain('detail');
    }

    // The reporter's identifier is absent from every safety surface. It is
    // deliberately not asserted absent from discovery: a report is not a block,
    // so the two people remain ordinary candidates to each other, and hiding
    // one from the other would itself disclose that a report exists.
    const safetySurfaces = await Promise.all([
      handle(get('/v1/safety/reports', subject)),
      handle(get('/v1/safety/blocks', subject)),
      handle(get('/v1/messaging/conversations', subject)),
    ]);
    for (const response of safetySurfaces) {
      expect(await response.text()).not.toContain(reporter.id);
    }

    // Nor does the narrative reach a log.
    expect(JSON.stringify(logs)).not.toContain(narrative);
  });

  it('leaves the person reported in exactly the state they were in', async () => {
    const reporter = await consumer('quiet-reporter@velora.test');
    const subject = await consumer('quiet-subject@velora.test');
    const before = await (await handle(get('/v1/users/me', subject))).text();

    await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'quiet-key-0001',
        reasonCode: 'spam_or_scam',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );

    const after = await (await handle(get('/v1/users/me', subject))).text();
    expect(after).toBe(before);
    // A report is not a block: the two are still ordinary candidates.
    expect(await candidateIds(subject)).toContain(reporter.id);
  });

  it('is retry-safe without collapsing two genuine reports', async () => {
    const reporter = await consumer('retry-reporter@velora.test');
    const subject = await consumer('retry-subject@velora.test');
    const file = async (clientReportId: string) =>
      handle(
        post('/v1/safety/reports', reporter, {
          clientReportId,
          reasonCode: 'harassment',
          target: { accountId: subject.id, type: 'consumer_account' },
        }),
      );

    const outcomes = await Promise.all([
      file('retry-key-0001'),
      file('retry-key-0001'),
      file('retry-key-0001'),
    ]);
    const ids = new Set(
      await Promise.all(
        outcomes.map(
          async (response) => ((await response.json()) as { id: string }).id,
        ),
      ),
    );
    expect(ids.size).toBe(1);
    expect(await countOf('safety_reports')).toBe(1);

    // A second report under a new key is a second report, never refused.
    expect((await file('retry-key-0002')).status).toBe(200);
    expect(await countOf('safety_reports')).toBe(2);
  });

  it('refuses reporting oneself or an account that is not there', async () => {
    const reporter = await consumer('report-invalid@velora.test');
    const self = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'invalid-key-0001',
        reasonCode: 'other',
        target: { accountId: reporter.id, type: 'consumer_account' },
      }),
    );
    const absent = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'invalid-key-0002',
        reasonCode: 'other',
        target: { accountId: crypto.randomUUID(), type: 'consumer_account' },
      }),
    );
    expect([self.status, absent.status]).toEqual([422, 422]);
    expect(await countOf('safety_reports')).toBe(0);
  });

  it('bounds submission volume without discarding a report already made', async () => {
    const reporter = await consumer('rate-reporter@velora.test');
    const subject = await consumer('rate-subject@velora.test');
    for (let index = 0; index < reportRateLimitCount; index += 1) {
      const response = await handle(
        post('/v1/safety/reports', reporter, {
          clientReportId: `rate-key-${String(index).padStart(4, '0')}`,
          reasonCode: 'other',
          target: { accountId: subject.id, type: 'consumer_account' },
        }),
      );
      expect(response.status).toBe(200);
    }

    const beyond = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'rate-key-overflow',
        reasonCode: 'other',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    expect(beyond.status).toBe(409);
    expect(((await beyond.json()) as { code: string }).code).toBe(
      'RATE_LIMITED',
    );
    // Every earlier report survives; nothing is dropped to make room.
    expect(await countOf('safety_reports')).toBe(reportRateLimitCount);
  });

  it('refuses evidence about a message with no conversation behind it', async () => {
    const reporter = await consumer('evidence-reporter@velora.test');
    const subject = await consumer('evidence-subject@velora.test');
    const response = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'evidence-key-0001',
        messageId: crypto.randomUUID(),
        reasonCode: 'harassment',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    // The database refuses it too; this is the contract refusing first.
    expect(response.status).toBe(422);
    expect(await countOf('safety_reports')).toBe(0);
  });
});

describe('report and block is one act, and the block is the half that lands', () => {
  it('blocks and reports in one call, and neither is told to the subject', async () => {
    const reporter = await consumer('rb-reporter@velora.test');
    const subject = await consumer('rb-subject@velora.test');

    const response = await handle(
      post('/v1/safety/reports/with-block', reporter, {
        clientReportId: 'report-and-block-0001',
        detail: 'what happened, written once and never echoed back',
        reasonCode: 'threats_or_violence',
        targetAccountId: subject.id,
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      block: { blockedId: string };
      report?: { reasonCode: string; state: string };
    };
    expect(body.block.blockedId).toBe(subject.id);
    expect(body.report?.state).toBe('received');
    expect(body.report?.reasonCode).toBe('threats_or_violence');

    // The block is real, not a claim in a response body.
    const blocks = await handle(get('/v1/safety/blocks', reporter));
    const held = ((await blocks.json()) as { blocks: { blockedId: string }[] })
      .blocks;
    expect(held.map((entry) => entry.blockedId)).toEqual([subject.id]);

    // And the subject learns nothing from either half.
    const theirBlocks = await handle(get('/v1/safety/blocks', subject));
    expect(
      ((await theirBlocks.json()) as { blocks: unknown[] }).blocks,
    ).toHaveLength(0);
    const theirReports = await handle(get('/v1/safety/reports', subject));
    expect(
      ((await theirReports.json()) as { reports: unknown[] }).reports,
    ).toHaveLength(0);
  });

  it('is idempotent on the client report identifier and on the block', async () => {
    const reporter = await consumer('rb-retry-reporter@velora.test');
    const subject = await consumer('rb-retry-subject@velora.test');
    const body = {
      clientReportId: 'report-and-block-retry-0001',
      reasonCode: 'hate_or_abuse',
      targetAccountId: subject.id,
    };

    const first = await handle(
      post('/v1/safety/reports/with-block', reporter, body),
    );
    const second = await handle(
      post('/v1/safety/reports/with-block', reporter, body),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const one = (await first.json()) as { report?: { id: string } };
    const two = (await second.json()) as { report?: { id: string } };
    // The same report, not a second one: a retry after a lost response is the
    // same submission.
    expect(two.report?.id).toBe(one.report?.id ?? '');

    const reports = await handle(get('/v1/safety/reports', reporter));
    expect(
      ((await reports.json()) as { reports: unknown[] }).reports,
    ).toHaveLength(1);
    const blocks = await handle(get('/v1/safety/blocks', reporter));
    expect(
      ((await blocks.json()) as { blocks: unknown[] }).blocks,
    ).toHaveLength(1);
  });

  it('still separates the pair when the reporting bound refuses the report', async () => {
    const reporter = await consumer('rb-bound-reporter@velora.test');
    const subject = await consumer('rb-bound-subject@velora.test');

    // Spend the whole reporting window on other people, so the composite call
    // arrives with nothing left in the budget.
    for (let index = 0; index < reportRateLimitCount; index += 1) {
      const other = await consumer(
        `rb-bound-other-${String(index)}@velora.test`,
      );
      const spent = await handle(
        post('/v1/safety/reports', reporter, {
          clientReportId: `rb-bound-spend-${String(index)}`,
          reasonCode: 'spam_or_scam',
          target: { accountId: other.id, type: 'consumer_account' },
        }),
      );
      expect(spent.status).toBe(200);
    }

    const response = await handle(
      post('/v1/safety/reports/with-block', reporter, {
        clientReportId: 'rb-bound-final-0001',
        reasonCode: 'harassment',
        targetAccountId: subject.id,
      }),
    );
    // The block is the half that protects somebody, so it is applied and
    // reported. The report is absent rather than invented, and the caller is
    // never told they were separated when they were not.
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      block: { blockedId: string };
      report?: unknown;
    };
    expect(body.block.blockedId).toBe(subject.id);
    expect(body.report).toBeUndefined();

    const blocks = await handle(get('/v1/safety/blocks', reporter));
    const blocked = (
      (await blocks.json()) as { blocks: { blockedId: string }[] }
    ).blocks;
    expect(blocked.map((entry) => entry.blockedId)).toContain(subject.id);
  });

  it('answers a target that is the caller, or is nobody, identically', async () => {
    const reporter = await consumer('rb-invalid-reporter@velora.test');
    const self = await handle(
      post('/v1/safety/reports/with-block', reporter, {
        clientReportId: 'rb-invalid-0001',
        reasonCode: 'other',
        targetAccountId: reporter.id,
      }),
    );
    const nobody = await handle(
      post('/v1/safety/reports/with-block', reporter, {
        clientReportId: 'rb-invalid-0002',
        reasonCode: 'other',
        targetAccountId: '11111111-1111-4111-8111-111111111111',
      }),
    );
    expect(self.status).toBe(422);
    expect(nobody.status).toBe(422);
    // Identical but for the correlation identifier, which is per-request by
    // construction. A caller cannot tell "that is you" from "that is nobody",
    // which is what stops this endpoint enumerating accounts.
    const withoutCorrelation = (body: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== 'correlationId'),
      );
    expect(
      withoutCorrelation((await self.json()) as Record<string, unknown>),
    ).toEqual(
      withoutCorrelation((await nobody.json()) as Record<string, unknown>),
    );
  });
});

describe('a consumer cannot become a moderator', () => {
  it('keeps every review route behind the operator prefix', () => {
    const paths = application.app.routes.map((route) => route.path);
    for (const path of paths) {
      // The review workflow exists now and lives under Platform Admin, which
      // is asserted unreachable below. What must never appear is one of these
      // outside that prefix.
      if (/moderation|enforcement|case|decision|evidence/iu.test(path)) {
        expect(path, path).toStartWith('/v1/admin/');
      }
    }
    // The safety surface a consumer can reach, in full. Standing and appeals
    // are here because a person is entitled to know what was done to them and
    // to contest it; nothing on this list reveals anything about anybody else.
    expect(
      paths.filter((path) => path.startsWith('/v1/safety')).sort(),
    ).toEqual([
      '/v1/safety/appeals',
      '/v1/safety/appeals',
      '/v1/safety/appeals/withdrawal',
      '/v1/safety/blocks',
      '/v1/safety/blocks',
      '/v1/safety/blocks/removal',
      '/v1/safety/reports',
      '/v1/safety/reports',
      '/v1/safety/reports/with-block',
      '/v1/safety/standing',
    ]);
  });

  it('refuses a consumer session at every Platform Admin route', async () => {
    const actor = await consumer('admin-reach@velora.test');
    const adminPaths = [
      ...new Set(
        application.app.routes
          .filter((route) => route.path.startsWith('/v1/admin'))
          .map((route) => `${route.method} ${route.path}`),
      ),
    ];
    expect(adminPaths.length).toBeGreaterThan(0);

    for (const entry of adminPaths) {
      const [method, path] = entry.split(' ');
      const response = await handle(
        method === 'GET'
          ? new Request(`http://api.test${path ?? ''}`, {
              headers: { cookie: actor.cookie, origin: testConsumerOrigin },
            })
          : post(path ?? '', actor, {}),
      );
      // Route visibility is not permission. Every one of them refuses the
      // audience before it looks at anything.
      expect(response.status, entry).toBe(403);
      expect(await response.json(), entry).toMatchObject({
        code: 'ACTION_NOT_PERMITTED',
      });
    }
  });

  it('cannot mint a Platform Admin credential at all', async () => {
    // The escalation path a consumer would need does not begin. No adapter may
    // produce Admin authority, so the sign-in contract refuses the audience
    // outright rather than issuing something a route would then have to refuse.
    const response = await handle(
      new Request('http://api.test/v1/auth/local/web-sessions', {
        body: JSON.stringify({
          audience: 'platform_admin',
          subject: 'operator@velora.test',
        }),
        headers: {
          'content-type': 'application/json',
          origin: testAdminOrigin,
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(422);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('refuses a non-consumer session on every consumer safety route', async () => {
    const consumerCaller = await consumer('escalation-consumer@velora.test');
    const creator = await signIn('operator@velora.test', 'creator_studio');
    const asCreator = (path: string, body: unknown) =>
      new Request(`http://api.test${path}`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
          cookie: creator.cookie,
          origin: testCreatorOrigin,
          'x-velora-csrf': creator.csrf,
        },
        method: 'POST',
      });

    const blocked = await handle(
      asCreator('/v1/safety/blocks', { targetId: consumerCaller.id }),
    );
    const reported = await handle(
      asCreator('/v1/safety/reports', {
        clientReportId: 'escalation-key-01',
        reasonCode: 'other',
        target: { accountId: consumerCaller.id, type: 'consumer_account' },
      }),
    );
    const listed = await handle(
      new Request('http://api.test/v1/safety/reports', {
        headers: { cookie: creator.cookie, origin: testCreatorOrigin },
      }),
    );

    for (const response of [blocked, reported, listed]) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(
        'CONSUMER_SURFACE_REQUIRED',
      );
    }
    expect(await countOf('safety_blocks')).toBe(0);
    expect(await countOf('safety_reports')).toBe(0);
  });

  it('gives no consumer request any path to an enforcement', async () => {
    const reporter = await consumer('no-enforce-reporter@velora.test');
    const subject = await consumer('no-enforce-subject@velora.test');
    await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'no-enforce-0001',
        reasonCode: 'underage_concern',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    await blockOf(reporter, subject.id);

    // A report is an allegation. Nothing a consumer can send makes it a finding.
    expect(await countOf('safety_enforcements')).toBe(0);
    const stillActive = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts where id = ${subject.id}`,
    );
    expect(stillActive[0]?.status).toBe('active');
  });

  it('keeps privileged authentication refused, so no Admin authority exists', () => {
    // The seam is only safe because nothing can mint the authority it expects.
    expect(config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER).toBe('unavailable');
  });
});

describe('enforcement is applied by the domain that owns what changes', () => {
  /**
   * The open case a report opened, and the version a reviewer would have read.
   *
   * A decision is taken on a case rather than on a report: the case is the unit
   * of review, and a decision that named a report would settle one person's
   * allegation while leaving the others in the same case open.
   */
  async function openCaseFor(
    targetId: string,
  ): Promise<{ id: string; version: number }> {
    const rows = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${targetId} and state not in ('decided', 'closed')
        order by opened_at desc limit 1`,
    );
    const row = rows[0];
    if (row === undefined) throw new Error('no open case for that target');
    return row;
  }

  async function evidenceFor(caseId: string): Promise<string[]> {
    const rows = await rowsOf<{ id: string }>(
      database.sql`select id from safety_evidence
        where case_id = ${caseId} order by recorded_at, id`,
    );
    return rows.map((row) => row.id);
  }

  it('restricts an account and removes it from discovery and messaging', async () => {
    const pair = await connectedPair('enforce-account');
    const reporter = pair.first;
    const subject = pair.second;
    const filed = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'enforce-account-01',
        reasonCode: 'harassment',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    const reportId = ((await filed.json()) as { id: string }).id;

    const review = await safety.moderation.beginReview({ reportId });
    expect(review.kind).toBe('recorded');
    const open = await openCaseFor(subject.id);
    const decision = await safety.moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'operator-reference-1',
      caseId: open.id,
      evidenceIds: await evidenceFor(open.id),
      expectedVersion: open.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    expect(decision.kind).toBe('recorded');

    const account = await rowsOf<{ status: string; status_reason: string }>(
      database.sql`select status, status_reason from users_accounts where id = ${subject.id}`,
    );
    expect(account[0]?.status).toBe('restricted');
    expect(account[0]?.status_reason).toBe('safety_enforcement');

    // The restriction propagates through the standing every domain reads.
    expect(await candidateIds(reporter)).not.toContain(subject.id);
    const attempted = await send(subject, {
      body: 'still talking',
      clientMessageId: 'enforce-account-02',
      conversationId: pair.conversationId,
    });
    expect(attempted.status).toBe(409);
    expect(await countOf('safety_enforcements')).toBe(1);
  });

  it('closes one conversation without touching the rest of an account', async () => {
    const pair = await connectedPair('enforce-conversation');
    await send(pair.first, {
      body: 'exchanged before the closure',
      clientMessageId: 'enforce-conv-0001',
      conversationId: pair.conversationId,
    });
    const filed = await handle(
      post('/v1/safety/reports', pair.first, {
        clientReportId: 'enforce-conv-0002',
        conversationId: pair.conversationId,
        reasonCode: 'harassment',
        target: { accountId: pair.second.id, type: 'consumer_account' },
      }),
    );
    const reportId = ((await filed.json()) as { id: string }).id;
    expect(reportId.length).toBeGreaterThan(0);

    const open = await openCaseFor(pair.second.id);
    const decision = await safety.moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'operator-reference-2',
      caseId: open.id,
      evidenceIds: await evidenceFor(open.id),
      expectedVersion: open.version,
      reasonCode: 'harassment',
      scope: 'conversation_closure',
      targetConversationId: pair.conversationId,
    });
    expect(decision.kind).toBe('recorded');

    const attempted = await send(pair.second, {
      body: 'into a closed room',
      clientMessageId: 'enforce-conv-0003',
      conversationId: pair.conversationId,
    });
    expect(attempted.status).toBe(409);
    // The account itself is untouched, and nothing was deleted.
    const account = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts where id = ${pair.second.id}`,
    );
    expect(account[0]?.status).toBe('active');
    expect(await countOf('messaging_messages')).toBe(1);
  });

  it('dismisses without recording an enforcement', async () => {
    const reporter = await consumer('dismiss-reporter@velora.test');
    const subject = await consumer('dismiss-subject@velora.test');
    const filed = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'dismiss-key-0001',
        reasonCode: 'other',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    const reportId = ((await filed.json()) as { id: string }).id;
    expect(reportId.length).toBeGreaterThan(0);

    const open = await openCaseFor(subject.id);
    const decision = await safety.moderation.decideCase({
      action: 'no_action',
      actorReference: 'operator-reference-3',
      caseId: open.id,
      evidenceIds: [],
      expectedVersion: open.version,
      reasonCode: 'no_violation_found',
    });
    expect(decision.kind).toBe('recorded');
    expect(await countOf('safety_enforcements')).toBe(0);
    expect(await countOf('safety_reports', "state = 'dismissed'")).toBe(1);

    // The reporter sees the outcome of their own report and nothing else.
    const mine = await handle(get('/v1/safety/reports', reporter));
    const body = (await mine.json()) as {
      reports: readonly { state: string }[];
    };
    expect(body.reports[0]?.state).toBe('dismissed');
  });

  it('lets exactly one of two concurrent reviewers decide', async () => {
    const reporter = await consumer('concurrent-reporter@velora.test');
    const subject = await consumer('concurrent-subject@velora.test');
    const filed = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'concurrent-key-01',
        reasonCode: 'harassment',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    const reportId = ((await filed.json()) as { id: string }).id;
    expect(reportId.length).toBeGreaterThan(0);

    const open = await openCaseFor(subject.id);
    const evidenceIds = await evidenceFor(open.id);
    const outcomes = await Promise.all([
      safety.moderation.decideCase({
        action: 'restrict_capability',
        actorReference: 'operator-a',
        caseId: open.id,
        evidenceIds,
        expectedVersion: open.version,
        reasonCode: 'harassment',
        scope: 'account_restriction',
      }),
      safety.moderation.decideCase({
        action: 'no_action',
        actorReference: 'operator-b',
        caseId: open.id,
        evidenceIds: [],
        expectedVersion: open.version,
        reasonCode: 'no_violation_found',
      }),
    ]);
    const recorded = outcomes.filter(
      (outcome) => outcome.kind === 'recorded',
    ).length;
    expect(recorded).toBe(1);
    expect(outcomes.some((outcome) => outcome.kind === 'conflict')).toBe(true);
    // One decision, so at most one enforcement.
    expect(await countOf('safety_enforcements')).toBeLessThanOrEqual(1);
  });

  it('rolls the report back when the enforcement cannot take effect', async () => {
    const reporter = await consumer('rollback-reporter@velora.test');
    const subject = await consumer('rollback-subject@velora.test');
    const filed = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'rollback-key-01',
        reasonCode: 'harassment',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    const reportId = ((await filed.json()) as { id: string }).id;
    expect(reportId.length).toBeGreaterThan(0);

    const open = await openCaseFor(subject.id);
    const decision = await safety.moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'operator-reference-4',
      caseId: open.id,
      evidenceIds: await evidenceFor(open.id),
      expectedVersion: open.version,
      reasonCode: 'harassment',
      scope: 'conversation_closure',
      // A conversation no report in this case named. Closing it would be a
      // decision about two people nobody complained about.
      targetConversationId: crypto.randomUUID(),
    });
    expect(decision.kind).toBe('not_applicable');
    // A case marked decided with no decision behind it, or a report marked
    // actioned with no enforcement, are states an audit could not explain, so
    // neither is reachable.
    expect(await countOf('safety_reports', "state = 'received'")).toBe(1);
    expect(await countOf('safety_cases', "state = 'new'")).toBe(1);
    expect(await countOf('safety_decisions')).toBe(0);
    expect(await countOf('safety_enforcements')).toBe(0);
  });

  it('records a reversal as its own action rather than editing the first', async () => {
    const reporter = await consumer('restore-reporter@velora.test');
    const subject = await consumer('restore-subject@velora.test');
    const filed = await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'restore-key-0001',
        reasonCode: 'harassment',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    const reportId = ((await filed.json()) as { id: string }).id;
    expect(reportId.length).toBeGreaterThan(0);
    const open = await openCaseFor(subject.id);
    const evidenceIds = await evidenceFor(open.id);
    const restricted = await safety.moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'operator-reference-5',
      caseId: open.id,
      evidenceIds,
      expectedVersion: open.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (restricted.kind !== 'recorded') throw new Error('setup failed');

    // The reversal is a decision that names the decision it replaces, not an
    // edit of it and not a free-standing lift with no record of who decided.
    const settled = await rowsOf<{ version: number }>(
      database.sql`select version from safety_cases where id = ${open.id}`,
    );
    const reversal = await safety.moderation.decideCase({
      action: 'revoke_restriction',
      actorReference: 'operator-reference-6',
      caseId: open.id,
      evidenceIds,
      expectedVersion: settled[0]?.version ?? 0,
      reasonCode: 'platform_integrity',
      scope: 'account_restriction',
      supersedesDecisionId: restricted.decision.id,
    });
    expect(reversal.kind).toBe('recorded');
    if (reversal.kind !== 'recorded') return;
    expect(reversal.decision.supersedesId).toBe(restricted.decision.id);
    expect(reversal.decision.priorState).toBe('restricted');
    expect(reversal.decision.resultingState).toBe('unrestricted');

    const account = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts where id = ${subject.id}`,
    );
    expect(account[0]?.status).toBe('active');
    // Two enforcement records, and the first is unchanged.
    const enforcements = await safety.moderation.enforcementsFor(subject.id);
    expect(enforcements).toHaveLength(2);
    expect(
      enforcements.filter((entry) => entry.reportId === null),
    ).toHaveLength(2);
    // And the superseded decision is exactly what was written.
    const detail = await safety.moderation.caseDetail(open.id);
    const original = detail?.decisions.find(
      (entry) => entry.id === restricted.decision.id,
    );
    expect(original).toEqual(restricted.decision);
  });
});

describe('nothing sensitive reaches a log line', () => {
  it('logs no narrative, no operator note, and no appellant statement', async () => {
    const reporter = await consumer('logging-reporter@velora.test');
    const subject = await consumer('logging-subject@velora.test');
    const narrative = 'REPORTER-NARRATIVE-a4f2';
    const note = 'OPERATOR-NOTE-b7c1';
    const statement = 'APPELLANT-STATEMENT-c9d3';

    await handle(
      post('/v1/safety/reports', reporter, {
        clientReportId: 'logging-key-0001',
        detail: narrative,
        reasonCode: 'harassment',
        target: { accountId: subject.id, type: 'consumer_account' },
      }),
    );
    const [opened] = await rowsOf<{ id: string; version: number }>(
      database.sql`select id, version from safety_cases
        where target_id = ${subject.id} limit 1`,
    );
    if (opened === undefined) throw new Error('no case opened');

    await safety.moderation.recordEvidence({
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidence: { kind: 'operator_note', note },
    });
    const evidenceIds = (
      await rowsOf<{ id: string }>(
        database.sql`select id from safety_evidence where case_id = ${opened.id}`,
      )
    ).map((row) => row.id);
    const decided = await safety.moderation.decideCase({
      action: 'restrict_capability',
      actorReference: 'session:reviewer-a',
      caseId: opened.id,
      evidenceIds,
      expectedVersion: opened.version,
      reasonCode: 'harassment',
      scope: 'account_restriction',
    });
    if (decided.kind !== 'recorded') throw new Error('setup failed');

    await handle(
      post('/v1/safety/appeals', subject, {
        decisionId: decided.decision.id,
        statement,
      }),
    );

    // Every one of these is stored, and none of them is a thing an operator
    // reads out of a log, a metric label, or an error line.
    const written = JSON.stringify(logs);
    expect(written).not.toContain(narrative);
    expect(written).not.toContain(note);
    expect(written).not.toContain(statement);
    // And what was stored genuinely is stored, so this is not passing because
    // nothing happened.
    expect(await countOf('safety_evidence', "kind = 'operator_note'")).toBe(1);
    expect(await countOf('safety_appeals')).toBe(1);
  });
});

describe('the database enforces the safety invariants', () => {
  it('owns exactly the safety tables and nothing else', async () => {
    const rows = await rowsOf<{ table_name: string }>(
      database.sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'safety_%'
        order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'safety_appeals',
      'safety_blocks',
      'safety_cases',
      'safety_consent_records',
      'safety_content_classifications',
      'safety_content_depictions',
      'safety_decision_evidence',
      'safety_decisions',
      'safety_depicted_participants',
      'safety_enforcements',
      'safety_evidence',
      'safety_reports',
      'safety_takedown_claims',
    ]);
  });

  it('refuses a self block, a self report, and an unknown reason', async () => {
    const actor = await consumer('constraint-actor@velora.test');
    const selfBlock = await refused(async () =>
      execute(
        database.sql`insert into safety_blocks (blocked_id, blocker_id, created_at, updated_at)
          values (${actor.id}, ${actor.id}, now(), now())`,
      ),
    );
    const selfReport = await refused(async () =>
      execute(
        database.sql`insert into safety_reports
          (client_report_id, created_at, id, policy_version, reason_code, reporter_id, state, subject_id, updated_at)
          values ('constraint-self01', now(), ${crypto.randomUUID()}, 'v1-provisional',
            'harassment', ${actor.id}, 'received', ${actor.id}, now())`,
      ),
    );
    const unknownReason = await refused(async () =>
      execute(
        database.sql`insert into safety_reports
          (client_report_id, created_at, id, policy_version, reason_code, reporter_id, state, subject_id, updated_at)
          values ('constraint-reason1', now(), ${crypto.randomUUID()}, 'v1-provisional',
            'because_i_said_so', ${actor.id}, 'received', ${crypto.randomUUID()}, now())`,
      ),
    );
    expect([selfBlock, selfReport, unknownReason]).toEqual([true, true, true]);
  });

  it('refuses a resolved report with no moment and an unresolved one with a moment', async () => {
    const reporter = await consumer('constraint-reporter@velora.test');
    const subject = await consumer('constraint-subject@velora.test');
    const resolvedWithoutMoment = await refused(async () =>
      execute(
        database.sql`insert into safety_reports
          (client_report_id, created_at, id, policy_version, reason_code, reporter_id, state, subject_id, updated_at)
          values ('constraint-res001', now(), ${crypto.randomUUID()}, 'v1-provisional',
            'harassment', ${reporter.id}, 'dismissed', ${subject.id}, now())`,
      ),
    );
    const openWithMoment = await refused(async () =>
      execute(
        database.sql`insert into safety_reports
          (client_report_id, created_at, id, policy_version, reason_code, reporter_id, resolved_at, state, subject_id, updated_at)
          values ('constraint-res002', now(), ${crypto.randomUUID()}, 'v1-provisional',
            'harassment', ${reporter.id}, now(), 'received', ${subject.id}, now())`,
      ),
    );
    expect([resolvedWithoutMoment, openWithMoment]).toEqual([true, true]);
  });

  it('refuses an account restriction that names a conversation, and the reverse', async () => {
    const subject = await consumer('constraint-enforce@velora.test');
    const accountWithConversation = await refused(async () =>
      execute(
        database.sql`insert into safety_enforcements
          (actor_reference, created_at, effective_at, id, policy_version, reason_code, scope, subject_id, target_conversation_id)
          values ('operator', now(), now(), ${crypto.randomUUID()}, 'v1-provisional',
            'harassment', 'account_restriction', ${subject.id}, ${crypto.randomUUID()})`,
      ),
    );
    const closureWithout = await refused(async () =>
      execute(
        database.sql`insert into safety_enforcements
          (actor_reference, created_at, effective_at, id, policy_version, reason_code, scope, subject_id)
          values ('operator', now(), now(), ${crypto.randomUUID()}, 'v1-provisional',
            'harassment', 'conversation_closure', ${subject.id})`,
      ),
    );
    expect([accountWithConversation, closureWithout]).toEqual([true, true]);
  });

  it('permits the same pair to be blocked again after a withdrawal', async () => {
    const first = await consumer('reblock-first@velora.test');
    const second = await consumer('reblock-second@velora.test');
    await blockOf(first, second.id);
    await handle(
      post('/v1/safety/blocks/removal', first, { targetId: second.id }),
    );
    expect((await blockOf(first, second.id)).status).toBe(200);
    expect(await countOf('safety_blocks')).toBe(2);
    expect(await countOf('safety_blocks', 'revoked_at is null')).toBe(1);
  });
});
