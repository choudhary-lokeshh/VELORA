import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import {
  candidateOverFetchFactor,
  maximumCandidateBatchSize,
  maximumFilterRounds,
  passSuppressionMilliseconds,
  pendingSignalMaximumMilliseconds,
} from '../../src/discovery/policy.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { LocalTestProfileMediaStorage } from '../../src/users/media.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import {
  connectDatabase,
  insertRows,
  provisionDatabase,
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
} from '../support/harness.js';

/**
 * Phase 6.5 — discovery and introduction scale hardening.
 *
 * Two properties are proved here that unit tests cannot reach, because both are
 * about what PostgreSQL does with real volume and real concurrency:
 *
 *  - the number of suppression relationships an account has accumulated is not
 *    an input to whether discovery is correct, at any count;
 *  - a positive signal stops being able to complete an introduction the moment
 *    it expires, including when the reciprocal signal lands either side of that
 *    instant and when many contenders arrive at once.
 */

const databaseUrl = await provisionDatabase('velora_discovery_scale');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  USERS_PROFILE_MEDIA_STORAGE: 'local-test',
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
      return `discovery-scale-${String(requesterSequence)}`;
    },
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
});
const safety = createSafetyRuntime({
  accounts: users.enforcement,
  consumerContext: users.consumerContext,
  conversations: new ConversationEnforcement(database.drizzle),
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
const application = createApplication({
  config,
  dependencies: {
    auth,
    clubs: testClubsRuntime({
      config,
      creators,
      database: database.drizzle,
      now,
      users,
    }),
    creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery,
    ephemeralRedis: healthy,
    logger,
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

const configuredStorage = users.profileMediaStorage;
if (!(configuredStorage instanceof LocalTestProfileMediaStorage)) {
  throw new Error(
    'Discovery scale tests expect the development storage adapter',
  );
}
const storage: LocalTestProfileMediaStorage = configuredStorage;

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  logs.length = 0;
  await database.truncate();
});

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

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

/** A consumer built through the real API, so every eligibility rule applies. */
async function discoverableConsumer(input: {
  readonly available?: boolean;
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
      region: 'DE',
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
      languages: ['de'],
    }),
  );

  const upload = await handle(post('/v1/users/me/profile/media', caller, {}));
  const media = (await upload.json()) as { mediaId: string };
  const rows = await rowsOf<{ storage_key: string }>(
    database.sql`select storage_key from users_profile_media where id = ${media.mediaId}`,
  );
  storage.put(rows[0]?.storage_key ?? '', jpegBytes);
  await handle(
    post('/v1/users/me/profile/media/completion', caller, {
      mediaId: media.mediaId,
    }),
  );
  await handle(
    post('/v1/users/me/preferences', caller, { discoverable: true }),
  );
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

/**
 * Bulk-creates fully eligible consumers directly in USERS' tables.
 *
 * The API path is the right way to build a handful of people and the wrong way
 * to build a thousand: this test is about what the candidate query does at
 * volume, and the rows it reads are the same rows either route produces. Every
 * eligibility condition is satisfied, so the only thing that can keep one of
 * these accounts out of a feed is the suppression under test.
 */
async function seedEligibleConsumers(
  count: number,
  region = 'DE',
): Promise<string[]> {
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  const since = new Date(now().getTime() - 30 * 60 * 1000);
  const until = new Date(now().getTime() + 60 * 60 * 1000);
  const insert = (table: string, rows: readonly Record<string, unknown>[]) =>
    insertRows(database, table, rows);

  await insert(
    'users_accounts',
    ids.map((id) => ({
      auth_account_id: crypto.randomUUID(),
      created_at: since,
      id,
      region,
      status: 'active',
      status_changed_at: since,
      updated_at: since,
    })),
  );
  await insert(
    'users_profiles',
    ids.map((id, index) => ({
      created_at: since,
      display_name: `Seeded ${String(index)}`,
      updated_at: since,
      user_id: id,
    })),
  );
  await insert(
    'users_profile_languages',
    ids.map((id) => ({ created_at: since, language: 'de', user_id: id })),
  );
  await insert(
    'users_preferences',
    ids.map((id) => ({
      created_at: since,
      discoverable: true,
      updated_at: since,
      user_id: id,
    })),
  );
  await insert(
    'users_availability',
    ids.map((id) => ({
      available_since: since,
      available_until: until,
      created_at: since,
      state: 'available',
      updated_at: since,
      user_id: id,
    })),
  );
  await insert(
    'users_adult_assurances',
    ids.map((id) => ({
      assurance_class: 'self_declared',
      created_at: since,
      decided_at: since,
      method: 'self_declaration',
      outcome: 'passed',
      policy_version: 'v1',
      region,
      user_id: id,
    })),
  );
  await insert(
    'users_profile_media',
    ids.map((id) => ({
      byte_size: 6,
      checksum: 'a'.repeat(64),
      content_type: 'image/jpeg',
      created_at: since,
      id: crypto.randomUUID(),
      position: 0,
      ready_at: since,
      state: 'ready',
      state_changed_at: since,
      storage_key: `seeded/${id}`,
      updated_at: since,
      upload_expires_at: until,
      user_id: id,
    })),
  );
  return ids;
}

/** Records a live pass from the viewer against every listed candidate. */
async function seedPasses(
  viewerId: string,
  candidateIds: readonly string[],
): Promise<void> {
  const expiry = new Date(now().getTime() + passSuppressionMilliseconds);
  await insertRows(
    database,
    'discovery_passes',
    candidateIds.map((candidateId) => ({
      candidate_id: candidateId,
      expires_at: expiry,
      passed_at: now(),
      viewer_id: viewerId,
    })),
  );
}

/** A live pending signal from the viewer towards each listed counterpart. */
async function seedPendingIntroductions(
  viewerId: string,
  counterpartIds: readonly string[],
  expiresAt: Date,
): Promise<void> {
  await insertRows(
    database,
    'discovery_introductions',
    counterpartIds.map((counterpartId) => ({
      created_at: now(),
      expires_at: expiresAt,
      id: crypto.randomUUID(),
      initiator_id: viewerId,
      pair_high_id: viewerId < counterpartId ? counterpartId : viewerId,
      pair_low_id: viewerId < counterpartId ? viewerId : counterpartId,
      state: 'pending',
      updated_at: now(),
    })),
  );
}

interface FeedBody {
  readonly candidates: readonly { readonly id: string }[];
  readonly nextCursor?: string;
}

async function feed(
  credentials: Credentials,
  query = '',
): Promise<{ body: FeedBody; status: number }> {
  const response = await handle(
    get(`/v1/discovery/candidates${query}`, credentials),
  );
  return { body: (await response.json()) as FeedBody, status: response.status };
}

/**
 * Reads the whole feed by following cursors.
 *
 * A short page is not the end: the walk hands back the position it reached, so
 * the only thing that ends a feed is the absence of a cursor. Draining proves
 * that, and the round trip count proves the walk is not looping forever.
 */
async function drainFeed(
  credentials: Credentials,
  pageSize: number,
): Promise<{ ids: string[]; requests: number }> {
  const ids: string[] = [];
  let cursor: string | undefined;
  let requests = 0;
  // Far above what any case here needs, and finite so a regression that stops
  // advancing the position fails as a test rather than as a hung suite.
  const limit = 200;
  do {
    requests += 1;
    const query = `?pageSize=${String(pageSize)}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    const page = await feed(credentials, query);
    expect(page.status).toBe(200);
    ids.push(...page.body.candidates.map((candidate) => candidate.id));
    cursor = page.body.nextCursor;
  } while (cursor !== undefined && requests < limit);
  expect(requests).toBeLessThan(limit);
  return { ids, requests };
}

describe('suppression scale is not a correctness boundary', () => {
  it('never leaks a suppressed candidate with far more than a thousand of them', async () => {
    const viewer = await discoverableConsumer({ subject: 'scale@velora.test' });
    const suppressed = await seedEligibleConsumers(1_200);
    const visible = await seedEligibleConsumers(3);
    await seedPasses(viewer.id, suppressed);

    const drained = await drainFeed(viewer, 10);

    expect(new Set(drained.ids)).toEqual(new Set(visible));
    for (const candidate of suppressed) {
      expect(drained.ids).not.toContain(candidate);
    }
  });

  it('reaches candidates ranked behind more than a thousand suppressed ones', async () => {
    const viewer = await discoverableConsumer({
      subject: 'behind@velora.test',
    });
    // The viewer's own region sorts first, so a candidate in another region is
    // deterministically ranked behind every suppressed one rather than landing
    // among them by hash. Region affects order only; eligibility is unchanged.
    const suppressed = await seedEligibleConsumers(1_050);
    await seedPasses(viewer.id, suppressed);
    const visible = await seedEligibleConsumers(1, 'FR');

    const drained = await drainFeed(viewer, 5);

    expect(drained.ids).toEqual(visible);
  });

  it('hands back a resumable position instead of ending the feed early', async () => {
    const viewer = await discoverableConsumer({
      subject: 'budget@velora.test',
    });
    const pageSize = 10;
    const batchSize = Math.min(
      maximumCandidateBatchSize,
      Math.max(pageSize + 1, pageSize * candidateOverFetchFactor),
    );
    // More suppressed candidates ranked ahead than one request's round budget
    // can walk, so the first page must come back empty with a cursor rather than
    // empty and final. Reporting no cursor here would end a feed the ranking
    // never finished reading, which is the silent truncation this design
    // removes.
    const suppressed = await seedEligibleConsumers(
      batchSize * maximumFilterRounds + 50,
    );
    await seedPasses(viewer.id, suppressed);
    const visible = await seedEligibleConsumers(2, 'FR');

    const first = await feed(viewer, `?pageSize=${String(pageSize)}`);
    expect(first.status).toBe(200);
    expect(first.body.candidates).toEqual([]);
    expect(first.body.nextCursor).toBeDefined();

    const drained = await drainFeed(viewer, pageSize);
    expect(new Set(drained.ids)).toEqual(new Set(visible));
    expect(drained.requests).toBeGreaterThan(1);
  });

  it('excludes live introduction counterparts at the same scale', async () => {
    const viewer = await discoverableConsumer({
      subject: 'paired@velora.test',
    });
    const counterparts = await seedEligibleConsumers(1_100);
    const visible = await seedEligibleConsumers(2);
    await seedPendingIntroductions(
      viewer.id,
      counterparts,
      new Date(now().getTime() + pendingSignalMaximumMilliseconds),
    );

    const drained = await drainFeed(viewer, 10);
    expect(new Set(drained.ids)).toEqual(new Set(visible));
  });

  it('shows a counterpart again once the signal that excluded them expires', async () => {
    const viewer = await discoverableConsumer({
      subject: 'lapsed@velora.test',
    });
    const [counterpart] = await seedEligibleConsumers(1);
    if (counterpart === undefined) throw new Error('seed produced no consumer');
    await seedPendingIntroductions(
      viewer.id,
      [counterpart],
      new Date(now().getTime() + 60_000),
    );

    expect((await feed(viewer)).body.candidates).toEqual([]);

    clockOffsetMilliseconds = 120_000;
    const after = await feed(viewer);
    expect(after.body.candidates.map((candidate) => candidate.id)).toEqual([
      counterpart,
    ]);
  });
});

describe('a candidate does not move because availability was re-saved', () => {
  it('shows every candidate exactly once across a refresh mid-pagination', async () => {
    const viewer = await discoverableConsumer({
      subject: 'stable@velora.test',
    });
    const others = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        discoverableConsumer({
          subject: `stable-${String(index)}@velora.test`,
        }),
      ),
    );

    const first = await feed(viewer, '?pageSize=2');
    expect(first.body.candidates).toHaveLength(2);
    const cursor = first.body.nextCursor;
    expect(cursor).toBeDefined();

    // The person shown first extends their window. Under a ranking keyed on the
    // last write they would jump to the front and be delivered twice; keyed on
    // when the session began, they do not move at all.
    clockOffsetMilliseconds = 5 * 60 * 1000;
    const shownFirst = first.body.candidates[0]?.id;
    const refreshed = others.find((other) => other.id === shownFirst);
    if (refreshed === undefined) throw new Error('feed returned an unknown id');
    const extended = await handle(
      post('/v1/users/me/availability', refreshed, {
        availableUntil: new Date(
          now().getTime() + 90 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
    expect(extended.status).toBe(200);

    const second = await feed(
      viewer,
      `?pageSize=2&cursor=${encodeURIComponent(cursor ?? '')}`,
    );
    const seen = [
      ...first.body.candidates.map((candidate) => candidate.id),
      ...second.body.candidates.map((candidate) => candidate.id),
    ];
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(new Set(others.map((other) => other.id)));
  });

  it('starts a new session, and a new ranking position, after a real absence', async () => {
    const consumer = await discoverableConsumer({
      subject: 'session@velora.test',
    });
    const readSince = async () =>
      (
        await rowsOf<{ available_since: Date | null }>(
          database.sql`select available_since from users_availability where user_id = ${consumer.id}`,
        )
      )[0]?.available_since ?? null;

    const opened = await readSince();
    expect(opened).not.toBeNull();

    clockOffsetMilliseconds = 60_000;
    await handle(
      post('/v1/users/me/availability', consumer, {
        availableUntil: new Date(
          now().getTime() + 60 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
    expect((await readSince())?.getTime()).toBe(opened?.getTime());

    await handle(
      post('/v1/users/me/availability', consumer, { state: 'unavailable' }),
    );
    expect(await readSince()).toBeNull();

    clockOffsetMilliseconds = 120_000;
    await handle(
      post('/v1/users/me/availability', consumer, {
        availableUntil: new Date(
          now().getTime() + 60 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
    const reopened = await readSince();
    expect(reopened).not.toBeNull();
    expect(reopened?.getTime()).toBeGreaterThan(opened?.getTime() ?? 0);
  });
});

describe('a positive signal expires', () => {
  async function signal(
    caller: Credentials,
    candidateId: string,
  ): Promise<{ body: { id?: string; state?: string }; status: number }> {
    const response = await handle(
      post('/v1/discovery/introductions', caller, { candidateId }),
    );
    return {
      body: (await response.json()) as { id?: string; state?: string },
      status: response.status,
    };
  }

  async function expiryOf(): Promise<Date | null> {
    const rows = await rowsOf<{ expires_at: Date | null }>(
      database.sql`select expires_at from discovery_introductions where state = 'pending'`,
    );
    return rows[0]?.expires_at ?? null;
  }

  it('expires at the availability window when that closes first', async () => {
    const initiator = await discoverableConsumer({
      subject: 'window@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'window-target@velora.test',
    });
    const closesAt = new Date(now().getTime() + 30 * 60 * 1000);
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: closesAt.toISOString(),
        state: 'available',
      }),
    );

    expect((await signal(initiator, target.id)).status).toBe(200);
    expect((await expiryOf())?.getTime()).toBe(closesAt.getTime());
  });

  it('expires a day out when the caller has no open availability window', async () => {
    const initiator = await discoverableConsumer({
      subject: 'day@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'day-target@velora.test',
    });
    // Browsing is not gated on being available, so a caller can signal with no
    // open window. The approved maximum window is itself a day, which means the
    // ceiling is the only bound that can apply here.
    await handle(
      post('/v1/users/me/availability', initiator, { state: 'unavailable' }),
    );
    const opened = now();

    expect((await signal(initiator, target.id)).status).toBe(200);
    const expiry = await expiryOf();
    expect(expiry).not.toBeNull();
    expect(
      Math.abs(
        (expiry?.getTime() ?? 0) -
          (opened.getTime() + pendingSignalMaximumMilliseconds),
      ),
    ).toBeLessThan(5_000);
  });

  it('completes a reciprocal signal that arrives just before expiry', async () => {
    const initiator = await discoverableConsumer({
      subject: 'before@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'before-target@velora.test',
    });
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(
          now().getTime() + 10 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
    expect((await signal(initiator, target.id)).status).toBe(200);

    clockOffsetMilliseconds = 9 * 60 * 1000;
    const reciprocal = await signal(target, initiator.id);
    expect(reciprocal.status).toBe(200);
    expect(reciprocal.body.state).toBe('mutual');
  });

  it('refuses to complete a reciprocal signal that arrives just after expiry', async () => {
    const initiator = await discoverableConsumer({
      subject: 'after@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'after-target@velora.test',
    });
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(
          now().getTime() + 10 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
    expect((await signal(initiator, target.id)).status).toBe(200);

    // Past the expiry, with the initiator around again. Their being available is
    // what makes them a candidate at all; it does not revive the offer they made
    // in the window that has closed.
    clockOffsetMilliseconds = 11 * 60 * 1000;
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(
          now().getTime() + 60 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );

    const reciprocal = await signal(target, initiator.id);
    expect(reciprocal.status).toBe(200);
    // The expired offer became a fresh signal from the other side, not a
    // mutual introduction: the answer arrived after the question lapsed.
    expect(reciprocal.body.state).toBe('pending');

    const states = await rowsOf<{
      closed_reason: string | null;
      state: string;
    }>(
      database.sql`select closed_reason, state from discovery_introductions order by created_at`,
    );
    expect(states).toHaveLength(2);
    expect(states[0]).toEqual({ closed_reason: 'expired', state: 'closed' });
    expect(states[1]?.state).toBe('pending');
  });

  it('keeps the expired signal auditable rather than rewriting it', async () => {
    const initiator = await discoverableConsumer({
      subject: 'audit@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'audit-target@velora.test',
    });
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(now().getTime() + 5 * 60 * 1000).toISOString(),
        state: 'available',
      }),
    );
    expect((await signal(initiator, target.id)).status).toBe(200);
    const before = await rowsOf<{
      created_at: Date;
      expires_at: Date;
      id: string;
      initiator_id: string;
    }>(
      database.sql`select created_at, expires_at, id, initiator_id from discovery_introductions`,
    );

    clockOffsetMilliseconds = 6 * 60 * 1000;
    await signal(initiator, target.id);

    const after = await rowsOf<{
      created_at: Date;
      expires_at: Date;
      id: string;
      initiator_id: string;
    }>(
      database.sql`select created_at, expires_at, id, initiator_id from discovery_introductions where id = ${before[0]?.id ?? ''}`,
    );
    expect(after[0]?.created_at.getTime()).toBe(
      before[0]?.created_at.getTime() ?? -1,
    );
    expect(after[0]?.expires_at.getTime()).toBe(
      before[0]?.expires_at.getTime() ?? -1,
    );
    expect(after[0]?.initiator_id).toBe(before[0]?.initiator_id ?? '');
  });

  it('hides an expired signal from the list and refuses to decline it', async () => {
    const initiator = await discoverableConsumer({
      subject: 'hidden@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'hidden-target@velora.test',
    });
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(now().getTime() + 5 * 60 * 1000).toISOString(),
        state: 'available',
      }),
    );
    const created = await signal(initiator, target.id);
    expect(created.status).toBe(200);

    clockOffsetMilliseconds = 6 * 60 * 1000;
    const list = await handle(get('/v1/discovery/introductions', target));
    expect(
      ((await list.json()) as { introductions: unknown[] }).introductions,
    ).toEqual([]);

    const declined = await handle(
      post('/v1/discovery/introductions/decline', target, {
        introductionId: created.body.id ?? '',
      }),
    );
    expect(declined.status).toBe(404);
  });

  it('produces exactly one mutual introduction under many reciprocal contenders', async () => {
    const initiator = await discoverableConsumer({
      subject: 'contend@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'contend-target@velora.test',
    });
    expect((await signal(initiator, target.id)).status).toBe(200);

    const contenders = await Promise.all(
      Array.from({ length: 16 }, () => signal(target, initiator.id)),
    );
    for (const contender of contenders) {
      expect([200, 409]).toContain(contender.status);
    }

    const rows = await rowsOf<{ count: string; state: string }>(
      database.sql`select count(*)::text as count, state from discovery_introductions group by state`,
    );
    expect(rows).toEqual([{ count: '1', state: 'mutual' }]);
  });

  it('produces exactly one outcome when sixteen contenders race an expiry', async () => {
    const initiator = await discoverableConsumer({
      subject: 'race@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'race-target@velora.test',
    });
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(now().getTime() + 60_000).toISOString(),
        state: 'available',
      }),
    );
    expect((await signal(initiator, target.id)).status).toBe(200);

    clockOffsetMilliseconds = 61_000;
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(
          now().getTime() + 60 * 60 * 1000,
        ).toISOString(),
        state: 'available',
      }),
    );
    await Promise.all(
      Array.from({ length: 16 }, () => signal(target, initiator.id)),
    );

    const rows = await rowsOf<{ count: string; state: string }>(
      database.sql`select count(*)::text as count, state from discovery_introductions group by state order by state`,
    );
    // Whatever order the contenders resolve in, the expired offer is closed
    // exactly once and the pair ends with one live signal and no mutual: none of
    // the sixteen can answer a question that lapsed before they arrived.
    expect(rows).toEqual([
      { count: '1', state: 'closed' },
      { count: '1', state: 'pending' },
    ]);
  });

  it('refuses a reciprocal signal when the expiry was the counterpart leaving', async () => {
    const initiator = await discoverableConsumer({
      subject: 'gone@velora.test',
    });
    const target = await discoverableConsumer({
      subject: 'gone-target@velora.test',
    });
    await handle(
      post('/v1/users/me/availability', initiator, {
        availableUntil: new Date(now().getTime() + 60_000).toISOString(),
        state: 'available',
      }),
    );
    expect((await signal(initiator, target.id)).status).toBe(200);

    // The window that bounded the signal is also what made its author visible,
    // so once it closes there is nobody to signal back to.
    clockOffsetMilliseconds = 61_000;
    expect((await signal(target, initiator.id)).status).toBe(404);
    const rows = await rowsOf<{ closed_reason: string | null; state: string }>(
      database.sql`select closed_reason, state from discovery_introductions`,
    );
    expect(rows).toEqual([{ closed_reason: 'expired', state: 'closed' }]);
  });
});
