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
import {
  passSuppressionMilliseconds,
  rankingVersion,
} from '../../src/discovery/policy.js';
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

const databaseUrl = await provisionDatabase('velora_discovery');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  ...mediaEnvironment,
});

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

const logs: unknown[] = [];
const logger = silentLogger(logs);
// Every sign-in is a distinct requester, so building a population of consumers
// does not run into the AUTH rate limiter and produce misleading failures.
let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `discovery-test-${String(requesterSequence)}`;
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

/**
 * A consumer that satisfies every approved eligibility condition: admitted,
 * minimum profile complete, discoverable, and currently available.
 */
async function discoverableConsumer(input: {
  readonly available?: boolean;
  readonly discoverable?: boolean;
  readonly languages?: readonly string[];
  readonly region?: string;
  readonly subject: string;
}): Promise<Credentials> {
  const signIn = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({
        audience: 'consumer_web',
        subject: input.subject,
      }),
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
  const created = await handle(
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

  await handle(
    post('/v1/users/me/onboarding/adult-declaration', caller, {
      declaresAdult: true,
      region: input.region ?? 'DE',
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
      displayName: input.subject.split('@')[0] ?? 'Consumer',
      languages: [...(input.languages ?? ['de'])],
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

  if (input.discoverable !== false) {
    await handle(
      post('/v1/users/me/preferences', caller, { discoverable: true }),
    );
  }
  if (input.available !== false) {
    await handle(
      post('/v1/users/me/availability', caller, {
        availableUntil: new Date(
          now().getTime() + 60 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
  }
  return caller;
}

interface FeedBody {
  readonly candidates: readonly {
    readonly bio?: string;
    readonly displayName: string;
    readonly id: string;
    readonly media: readonly { readonly id: string }[];
    readonly region?: string;
    readonly sharedLanguages: readonly string[];
  }[];
  readonly nextCursor?: string;
  readonly rankingVersion: string;
}

async function feed(
  credentials: Credentials,
  query = '',
): Promise<{ body: FeedBody; status: number }> {
  const response = await handle(
    get(`/v1/discovery/candidates${query}`, credentials),
  );
  return {
    body: (await response.json()) as FeedBody,
    status: response.status,
  };
}

describe('opening one person', () => {
  it('gives a viewer somebody they may currently be shown', async () => {
    const viewer = await discoverableConsumer({
      subject: 'person-page-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'person-page-target@velora.test',
    });

    const response = await handle(
      get(`/v1/discovery/people?personId=${other.id}`, viewer),
    );
    const body = (await response.json()) as {
      readonly displayName: string;
      readonly id: string;
      readonly media: unknown[];
    };

    expect(response.status).toBe(200);
    expect(body.id).toBe(other.id);
    expect(body.media.length).toBeGreaterThan(0);
    // Exactly the card projection and nothing more. The seeded person in this
    // suite has no bio, and an absent optional field is absent rather than
    // null, so the required set is what this asserts.
    expect(Object.keys(body).toSorted()).toEqual([
      'displayName',
      'id',
      'media',
      'region',
      'sharedLanguages',
    ]);
  });

  it('keeps giving a counterpart whose availability window has closed', async () => {
    const viewer = await discoverableConsumer({
      subject: 'person-page-first@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'person-page-second@velora.test',
    });
    await handle(
      post('/v1/discovery/introductions', viewer, { candidateId: other.id }),
    );
    await handle(
      post('/v1/discovery/introductions', other, { candidateId: viewer.id }),
    );
    await handle(
      post('/v1/users/me/availability', other, { state: 'unavailable' }),
    );

    const response = await handle(
      get(`/v1/discovery/people?personId=${other.id}`, viewer),
    );

    expect(response.status).toBe(200);
  });

  it('answers somebody nobody may see exactly as somebody who is not there', async () => {
    const viewer = await discoverableConsumer({
      subject: 'person-page-prober@velora.test',
    });
    const hidden = await discoverableConsumer({
      discoverable: false,
      subject: 'person-page-hidden@velora.test',
    });

    const forbidden = await handle(
      get(`/v1/discovery/people?personId=${hidden.id}`, viewer),
    );
    const absent = await handle(
      get(
        '/v1/discovery/people?personId=99999999-9999-4999-8999-999999999999',
        viewer,
      ),
    );
    const malformed = await handle(
      get('/v1/discovery/people?personId=not-a-uuid', viewer),
    );

    expect(forbidden.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(malformed.status).toBe(404);
    // Same code and same shape; the correlation identifier differs per request
    // by design, so it is the one field a comparison must not include.
    const shapeOf = (body: Record<string, unknown>) => ({
      code: body.code,
      keys: Object.keys(body).toSorted(),
    });
    expect(
      shapeOf((await forbidden.json()) as Record<string, unknown>),
    ).toEqual(shapeOf((await absent.json()) as Record<string, unknown>));
  });

  it('stops giving somebody the viewer has blocked', async () => {
    const viewer = await discoverableConsumer({
      subject: 'person-page-blocker@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'person-page-blocked@velora.test',
    });
    expect(
      (await handle(get(`/v1/discovery/people?personId=${other.id}`, viewer)))
        .status,
    ).toBe(200);

    await handle(post('/v1/safety/blocks', viewer, { targetId: other.id }));

    expect(
      (await handle(get(`/v1/discovery/people?personId=${other.id}`, viewer)))
        .status,
    ).toBe(404);
  });
});

describe('discovery eligibility', () => {
  it('shows a fully eligible candidate and nobody else', async () => {
    const viewer = await discoverableConsumer({
      subject: 'viewer@velora.test',
    });
    const visible = await discoverableConsumer({
      subject: 'visible@velora.test',
    });
    await discoverableConsumer({
      discoverable: false,
      subject: 'hidden@velora.test',
    });
    await discoverableConsumer({
      available: false,
      subject: 'away@velora.test',
    });

    const page = await feed(viewer);
    expect(page.status).toBe(200);
    expect(page.body.rankingVersion).toBe(rankingVersion);
    expect(page.body.candidates.map((candidate) => candidate.id)).toEqual([
      visible.id,
    ]);
  });

  it('never shows the viewer their own account', async () => {
    const viewer = await discoverableConsumer({ subject: 'self@velora.test' });
    const page = await feed(viewer);
    expect(
      page.body.candidates.some((candidate) => candidate.id === viewer.id),
    ).toBe(false);
  });

  it('requires a shared language', async () => {
    const viewer = await discoverableConsumer({
      languages: ['de'],
      subject: 'lang-viewer@velora.test',
    });
    await discoverableConsumer({
      languages: ['ja'],
      subject: 'lang-other@velora.test',
    });
    const shared = await discoverableConsumer({
      languages: ['de', 'en'],
      subject: 'lang-shared@velora.test',
    });

    const page = await feed(viewer);
    expect(page.body.candidates.map((candidate) => candidate.id)).toEqual([
      shared.id,
    ]);
    // Only the languages the two actually share, not everything they speak.
    expect(page.body.candidates[0]?.sharedLanguages).toEqual(['de']);
  });

  it('drops a candidate whose availability window has closed', async () => {
    const viewer = await discoverableConsumer({
      subject: 'expiry-viewer@velora.test',
    });
    await discoverableConsumer({ subject: 'expiry-other@velora.test' });

    expect((await feed(viewer)).body.candidates).toHaveLength(1);
    clockOffsetMilliseconds = 61 * 60 * 1000;
    expect((await feed(viewer)).body.candidates).toHaveLength(0);
  });

  it('drops a candidate whose later adult declaration is refused', async () => {
    const viewer = await discoverableConsumer({
      subject: 'assurance-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'assurance-other@velora.test',
    });
    expect((await feed(viewer)).body.candidates).toHaveLength(1);

    // Eligibility is read from evidence, not inferred from the account status
    // column, so a refusal takes effect without any status write happening.
    await execute(
      database.sql`insert into users_adult_declarations (decided_at, outcome, policy_version, region, user_id)
        values (now(), 'failed', '0-unpublished', 'DE', ${other.id})`,
    );
    expect((await feed(viewer)).body.candidates).toHaveLength(0);
  });

  it('drops a candidate who loses the minimum profile', async () => {
    const viewer = await discoverableConsumer({
      subject: 'profile-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'profile-other@velora.test',
    });
    expect((await feed(viewer)).body.candidates).toHaveLength(1);

    const media = await rowsOf<{ id: string }>(
      database.sql`select media_asset_id as id from users_profile_media
                   where user_id = ${other.id} and state = 'attached'`,
    );
    await handle(
      post('/v1/users/me/profile/media/removal', other, {
        mediaId: media[0]?.id ?? '',
      }),
    );
    expect((await feed(viewer)).body.candidates).toHaveLength(0);
  });

  it('refuses to let an ineligible account browse', async () => {
    const incomplete = await discoverableConsumer({
      subject: 'browse-incomplete@velora.test',
    });
    const media = await rowsOf<{ id: string }>(
      database.sql`select media_asset_id as id from users_profile_media
                   where user_id = ${incomplete.id} and state = 'attached'`,
    );
    await handle(
      post('/v1/users/me/profile/media/removal', incomplete, {
        mediaId: media[0]?.id ?? '',
      }),
    );

    const page = await feed(incomplete);
    expect(page.status).toBe(409);
    expect((page.body as unknown as { code: string }).code).toBe(
      'ACCOUNT_NOT_ELIGIBLE',
    );
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await handle(
      new Request('http://api.test/v1/discovery/candidates'),
    );
    expect(response.status).toBe(401);
  });
});

describe('candidate projection is minimized', () => {
  it('exposes only the approved fields and nothing about eligibility', async () => {
    const viewer = await discoverableConsumer({
      subject: 'privacy-viewer@velora.test',
    });
    await discoverableConsumer({ subject: 'privacy-other@velora.test' });

    const page = await feed(viewer);
    const candidate = page.body.candidates[0];
    expect(Object.keys(candidate ?? {}).sort()).toEqual([
      'displayName',
      'id',
      'media',
      'region',
      'sharedLanguages',
    ]);
    const serialized = JSON.stringify(page.body);
    for (const leak of [
      'availableUntil',
      'discoverable',
      'status',
      'authAccountId',
      'assurance',
      'sortKey',
      'storage',
      'checksum',
    ]) {
      expect(serialized, leak).not.toContain(leak);
    }
  });
});

describe('deterministic ranking and paging', () => {
  it('orders by region match, then shared languages, and repeats that order', async () => {
    const viewer = await discoverableConsumer({
      languages: ['de', 'en'],
      region: 'DE',
      subject: 'rank-viewer@velora.test',
    });
    const sameRegion = await discoverableConsumer({
      languages: ['de'],
      region: 'DE',
      subject: 'rank-same-region@velora.test',
    });
    const otherRegionTwoLanguages = await discoverableConsumer({
      languages: ['de', 'en'],
      region: 'FR',
      subject: 'rank-other-two@velora.test',
    });
    const otherRegionOneLanguage = await discoverableConsumer({
      languages: ['de'],
      region: 'FR',
      subject: 'rank-other-one@velora.test',
    });

    const expected = [
      sameRegion.id,
      otherRegionTwoLanguages.id,
      otherRegionOneLanguage.id,
    ];
    const first = await feed(viewer);
    expect(first.body.candidates.map((candidate) => candidate.id)).toEqual(
      expected,
    );
    // Deterministic means repeatable: the same inputs give the same order.
    const second = await feed(viewer);
    expect(second.body.candidates.map((candidate) => candidate.id)).toEqual(
      expected,
    );
  });

  it('pages forward without repeating or skipping a candidate', async () => {
    const viewer = await discoverableConsumer({
      subject: 'page-viewer@velora.test',
    });
    const expected = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      const candidate = await discoverableConsumer({
        subject: `page-candidate-${String(index)}@velora.test`,
      });
      expected.add(candidate.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const query = `?pageSize=2${cursor === undefined ? '' : `&cursor=${cursor}`}`;
      const result = await feed(viewer, query);
      expect(result.status).toBe(200);
      seen.push(...result.body.candidates.map((candidate) => candidate.id));
      cursor = result.body.nextCursor;
      if (cursor === undefined) break;
    }
    expect(new Set(seen)).toEqual(expected);
    expect(seen).toHaveLength(expected.size);
  });

  it('keeps the order stable while a reader pages through it', async () => {
    const viewer = await discoverableConsumer({
      subject: 'tie-viewer@velora.test',
    });
    for (let index = 0; index < 6; index += 1) {
      await discoverableConsumer({
        subject: `tie-candidate-${String(index)}@velora.test`,
      });
    }

    const order = async () =>
      (await feed(viewer)).body.candidates.map((candidate) => candidate.id);
    const first = await order();
    expect(first).toHaveLength(6);
    // Deterministic: the same inputs give the same order, every time.
    expect(await order()).toEqual(first);

    const firstPage = await feed(viewer, '?pageSize=3');
    expect(firstPage.body.nextCursor).toBeDefined();
    const secondPage = await feed(
      viewer,
      `?pageSize=3&cursor=${firstPage.body.nextCursor ?? ''}`,
    );
    // Nobody shown twice, nobody skipped, and the two pages are the one order.
    expect([
      ...firstPage.body.candidates.map((candidate) => candidate.id),
      ...secondPage.body.candidates.map((candidate) => candidate.id),
    ]).toEqual(first);
    expect(secondPage.body.nextCursor).toBeUndefined();
  });

  it('refuses a cursor or page size outside the published contract', async () => {
    const viewer = await discoverableConsumer({
      subject: 'cursor-viewer@velora.test',
    });
    for (const query of [
      '?cursor=not a cursor',
      `?cursor=${'a'.repeat(600)}`,
      '?pageSize=0',
      '?pageSize=500',
      '?pageSize=abc',
      // Structurally valid encoding, semantically not one of ours.
      `?cursor=${Buffer.from('{"a":"../../etc","w":1}', 'utf8').toString('base64url')}`,
      `?cursor=${Buffer.from('{"a":"0-00-0-0-x","w":-5}', 'utf8').toString('base64url')}`,
    ]) {
      const result = await feed(viewer, query);
      expect(result.status, query).toBe(422);
    }
  });

  it('treats a tampered cursor as a position, never as authority', async () => {
    const viewer = await discoverableConsumer({
      subject: 'tamper-viewer@velora.test',
    });
    const hidden = await discoverableConsumer({
      discoverable: false,
      subject: 'tamper-hidden@velora.test',
    });

    // A cursor that starts before everything cannot conjure an ineligible
    // candidate: eligibility is re-evaluated for every row on every page.
    const forged = Buffer.from(
      JSON.stringify({ a: '0', w: 0 }),
      'utf8',
    ).toString('base64url');
    const result = await feed(viewer, `?cursor=${forged}`);
    expect(result.status).toBe(200);
    expect(
      result.body.candidates.some((candidate) => candidate.id === hidden.id),
    ).toBe(false);
  });
});

describe('presentations and passes', () => {
  it('records one bounded row per pair however often a page is refreshed', async () => {
    const viewer = await discoverableConsumer({
      subject: 'present-viewer@velora.test',
    });
    await discoverableConsumer({ subject: 'present-other@velora.test' });

    await feed(viewer);
    await feed(viewer);
    await feed(viewer);

    const rows = await rowsOf<{
      ranking_version: string;
      show_count: number;
    }>(
      database.sql`select ranking_version, show_count from discovery_presentations`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.show_count).toBe(3);
    expect(rows[0]?.ranking_version).toBe(rankingVersion);
  });

  it('keeps a pair honest when two pages record it out of order', async () => {
    const viewer = await discoverableConsumer({
      subject: 'record-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'record-other@velora.test',
    });

    await feed(viewer);
    const shown = now();

    // The second page carries an earlier moment than the first, which is what a
    // request that started earlier and committed later looks like to this
    // statement. Recording it must not fail, and must not claim the pair was
    // last shown before it was first shown.
    clockOffsetMilliseconds = -5 * 60 * 1000;
    const page = await feed(viewer);
    expect(page.status).toBe(200);
    expect(page.body.candidates.map((candidate) => candidate.id)).toEqual([
      other.id,
    ]);

    const rows = await rowsOf<{
      first_shown_at: Date;
      last_shown_at: Date;
      show_count: number;
    }>(
      database.sql`select first_shown_at, last_shown_at, show_count from discovery_presentations`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.show_count).toBe(2);
    // Earliest known first, latest known last, whichever order they arrived in.
    const first = rows[0]?.first_shown_at.getTime() ?? 0;
    const last = rows[0]?.last_shown_at.getTime() ?? 0;
    expect(last).toBeGreaterThanOrEqual(first);
    expect(last - first).toBeGreaterThan(4 * 60 * 1000);
    expect(Math.abs(last - shown.getTime())).toBeLessThan(60_000);
  });

  it('suppresses a passed pair for the policy window and then restores it', async () => {
    const viewer = await discoverableConsumer({
      subject: 'pass-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'pass-other@velora.test',
    });
    expect((await feed(viewer)).body.candidates).toHaveLength(1);

    const passed = await handle(
      post('/v1/discovery/passes', viewer, { candidateId: other.id }),
    );
    expect(passed.status).toBe(200);
    const { suppressedUntil } = (await passed.json()) as {
      suppressedUntil: string;
    };
    expect(
      new Date(suppressedUntil).getTime() - now().getTime(),
    ).toBeGreaterThan(passSuppressionMilliseconds - 60_000);

    expect((await feed(viewer)).body.candidates).toHaveLength(0);
    // The other person is never told, and nothing about them changed.
    expect((await feed(other)).body.candidates.map((c) => c.id)).toEqual([
      viewer.id,
    ]);

    clockOffsetMilliseconds = passSuppressionMilliseconds + 60_000;
    await handle(
      post('/v1/users/me/availability', other, {
        availableUntil: new Date(
          now().getTime() + 60 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
    expect((await feed(viewer)).body.candidates).toHaveLength(1);
  });

  it('renews the window when a pass is repeated instead of failing', async () => {
    const viewer = await discoverableConsumer({
      subject: 'repeat-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'repeat-other@velora.test',
    });

    const first = await handle(
      post('/v1/discovery/passes', viewer, { candidateId: other.id }),
    );
    expect(first.status).toBe(200);
    clockOffsetMilliseconds = 60_000;
    const second = await handle(
      post('/v1/discovery/passes', viewer, { candidateId: other.id }),
    );
    expect(second.status).toBe(200);

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from discovery_passes`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('keeps a pass one-directional and private', async () => {
    const viewer = await discoverableConsumer({
      subject: 'direction-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'direction-other@velora.test',
    });
    await handle(
      post('/v1/discovery/passes', viewer, { candidateId: other.id }),
    );

    const rows = await rowsOf<{ candidate_id: string; viewer_id: string }>(
      database.sql`select candidate_id, viewer_id from discovery_passes`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.viewer_id).toBe(viewer.id);
    // The other side still sees the viewer: a decline is not a mutual event.
    expect((await feed(other)).body.candidates.map((c) => c.id)).toEqual([
      viewer.id,
    ]);
  });

  it('handles many simultaneous passes on the same pair as one decision', async () => {
    const viewer = await discoverableConsumer({
      subject: 'race-viewer@velora.test',
    });
    const other = await discoverableConsumer({
      subject: 'race-other@velora.test',
    });

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        handle(post('/v1/discovery/passes', viewer, { candidateId: other.id })),
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from discovery_passes`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('refuses a pass against oneself and malformed input', async () => {
    const viewer = await discoverableConsumer({
      subject: 'pass-input@velora.test',
    });
    for (const body of [
      { candidateId: viewer.id },
      { candidateId: 'not-a-uuid' },
      {},
      { candidateId: crypto.randomUUID(), extra: true },
    ]) {
      const response = await handle(post('/v1/discovery/passes', viewer, body));
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
  });
});

describe('database constraints protect discovery invariants', () => {
  it('refuses a self pair and an expiry that precedes its decision', async () => {
    const viewerId = crypto.randomUUID();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_passes (candidate_id, expires_at, passed_at, viewer_id)
            values (${viewerId}, now() + interval '1 day', now(), ${viewerId})`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_passes (candidate_id, expires_at, passed_at, viewer_id)
            values (${crypto.randomUUID()}, now() - interval '1 day', now(), ${viewerId})`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a presentation that was never shown or shown before it started', async () => {
    const viewerId = crypto.randomUUID();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_presentations (candidate_id, first_shown_at, last_shown_at, ranking_version, show_count, viewer_id)
            values (${crypto.randomUUID()}, now(), now(), 'v1-deterministic', 0, ${viewerId})`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_presentations (candidate_id, first_shown_at, last_shown_at, ranking_version, show_count, viewer_id)
            values (${crypto.randomUUID()}, now(), now() - interval '1 hour', 'v1-deterministic', 1, ${viewerId})`,
        ),
      ),
    ).toBe(true);
  });
});
