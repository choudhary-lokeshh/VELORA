import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { passSuppressionMilliseconds } from '../../src/discovery/policy.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { LocalTestProfileMediaStorage } from '../../src/users/media.js';
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
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_introductions');
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

const logger = silentLogger([]);
let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `introductions-test-${String(requesterSequence)}`;
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
  throw new Error('Introduction tests expect the development storage adapter');
}
const storage: LocalTestProfileMediaStorage = configuredStorage;

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
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

async function consumer(subject: string): Promise<Credentials> {
  const signIn = await handle(
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
  await handle(
    post('/v1/users/me/availability', caller, {
      availableUntil: new Date(now().getTime() + 60 * 60 * 1000).toISOString(),
      state: 'available',
    }),
  );
  return caller;
}

interface IntroductionBody {
  readonly counterpart: { readonly displayName: string; readonly id: string };
  readonly createdAt: string;
  readonly id: string;
  readonly mutualAt?: string;
  readonly role: string;
  readonly state: string;
}

async function signal(
  actor: Credentials,
  target: Credentials,
): Promise<{ body: IntroductionBody; status: number }> {
  const response = await handle(
    post('/v1/discovery/introductions', actor, { candidateId: target.id }),
  );
  return {
    body: (await response.json()) as IntroductionBody,
    status: response.status,
  };
}

async function candidateIds(caller: Credentials): Promise<string[]> {
  const response = await handle(get('/v1/discovery/candidates', caller));
  const body = (await response.json()) as {
    candidates: readonly { id: string }[];
  };
  return body.candidates.map((candidate) => candidate.id);
}

async function introductions(caller: Credentials): Promise<IntroductionBody[]> {
  const response = await handle(get('/v1/discovery/introductions', caller));
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    introductions: readonly IntroductionBody[];
  };
  return [...body.introductions];
}

describe('mutual introductions require both sides', () => {
  it('records one side as pending and does not tell the other it is mutual', async () => {
    const alice = await consumer('intro-alice@velora.test');
    const bob = await consumer('intro-bob@velora.test');

    const first = await signal(alice, bob);
    expect(first.status).toBe(200);
    expect(first.body.state).toBe('pending');
    expect(first.body.role).toBe('initiator');
    expect(first.body.counterpart.id).toBe(bob.id);
    expect(first.body.mutualAt).toBeUndefined();

    // Bob sees a pending introduction he did not start.
    const bobsView = await introductions(bob);
    expect(bobsView).toHaveLength(1);
    expect(bobsView[0]?.state).toBe('pending');
    expect(bobsView[0]?.role).toBe('recipient');
  });

  it('becomes mutual only when the other person opts in independently', async () => {
    const alice = await consumer('mutual-alice@velora.test');
    const bob = await consumer('mutual-bob@velora.test');

    await signal(alice, bob);
    // Alice signalling again cannot complete her own introduction.
    const repeated = await signal(alice, bob);
    expect(repeated.status).toBe(200);
    expect(repeated.body.state).toBe('pending');

    const reciprocal = await signal(bob, alice);
    expect(reciprocal.status).toBe(200);
    expect(reciprocal.body.state).toBe('mutual');
    expect(reciprocal.body.mutualAt).toBeDefined();

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from discovery_introductions`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('produces exactly one introduction from simultaneous reciprocal signals', async () => {
    const alice = await consumer('race-alice@velora.test');
    const bob = await consumer('race-bob@velora.test');

    const attempts = 16;
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_value, index) =>
        index % 2 === 0
          ? handle(
              post('/v1/discovery/introductions', alice, {
                candidateId: bob.id,
              }),
            )
          : handle(
              post('/v1/discovery/introductions', bob, {
                candidateId: alice.id,
              }),
            ),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(
      true,
    );

    const rows = await rowsOf<{ count: string; state: string }>(
      database.sql`select count(*)::text as count, state from discovery_introductions group by state`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe('1');
    expect(rows[0]?.state).toBe('mutual');
  });

  it('is idempotent when a signal is repeated after it became mutual', async () => {
    const alice = await consumer('idem-alice@velora.test');
    const bob = await consumer('idem-bob@velora.test');
    await signal(alice, bob);
    const mutual = await signal(bob, alice);

    const again = await signal(alice, bob);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(mutual.body.id);
    expect(again.body.state).toBe('mutual');
  });
});

describe('introductions and discovery interact correctly', () => {
  it('removes a pair from the feed once an introduction is live', async () => {
    const alice = await consumer('feed-alice@velora.test');
    const bob = await consumer('feed-bob@velora.test');
    expect(await candidateIds(alice)).toEqual([bob.id]);

    await signal(alice, bob);
    expect(await candidateIds(alice)).toEqual([]);
    // The other side is also no longer a candidate: the pair has a live state.
    expect(await candidateIds(bob)).toEqual([]);
  });

  it('refuses to signal somebody who is not currently introducible', async () => {
    const alice = await consumer('gate-alice@velora.test');
    const bob = await consumer('gate-bob@velora.test');
    await handle(
      post('/v1/users/me/preferences', bob, {
        discoverable: false,
        expectedVersion: 1,
      }),
    );

    const response = await handle(
      post('/v1/discovery/introductions', alice, { candidateId: bob.id }),
    );
    // Indistinguishable from an account that does not exist.
    expect(response.status).toBe(404);
    expect(((await response.json()) as { code: string }).code).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('refuses a self-introduction and malformed input', async () => {
    const alice = await consumer('input-alice@velora.test');
    const selfSignal = await handle(
      post('/v1/discovery/introductions', alice, { candidateId: alice.id }),
    );
    expect(selfSignal.status).toBe(404);

    for (const body of [
      {},
      { candidateId: 'nope' },
      { candidateId: alice.id, extra: 1 },
    ]) {
      const response = await handle(
        post('/v1/discovery/introductions', alice, body),
      );
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('refuses an ineligible caller and an unauthenticated one', async () => {
    const alice = await consumer('elig-alice@velora.test');
    const bob = await consumer('elig-bob@velora.test');
    const media = await rowsOf<{ id: string }>(
      database.sql`select id from users_profile_media where user_id = ${alice.id} and state = 'ready'`,
    );
    await handle(
      post('/v1/users/me/profile/media/removal', alice, {
        mediaId: media[0]?.id ?? '',
      }),
    );

    const refusedSignal = await handle(
      post('/v1/discovery/introductions', alice, { candidateId: bob.id }),
    );
    expect(refusedSignal.status).toBe(409);
    expect(((await refusedSignal.json()) as { code: string }).code).toBe(
      'ACCOUNT_NOT_ELIGIBLE',
    );

    const anonymous = await handle(
      new Request('http://api.test/v1/discovery/introductions'),
    );
    expect(anonymous.status).toBe(401);
  });
});

describe('declining and withdrawing', () => {
  it('lets the recipient decline privately and suppresses the pair', async () => {
    const alice = await consumer('decline-alice@velora.test');
    const bob = await consumer('decline-bob@velora.test');
    const pending = await signal(alice, bob);

    const declined = await handle(
      post('/v1/discovery/introductions/decline', bob, {
        introductionId: pending.body.id,
      }),
    );
    expect(declined.status).toBe(200);
    expect(((await declined.json()) as IntroductionBody).state).toBe('closed');

    // Alice is told nothing: the introduction simply is not live any more.
    expect(await introductions(alice)).toEqual([]);
    expect(await introductions(bob)).toEqual([]);
    // And the pair is suppressed, so declining is not undone by a refresh.
    expect(await candidateIds(bob)).toEqual([]);

    const rows = await rowsOf<{ closed_reason: string }>(
      database.sql`select closed_reason from discovery_introductions`,
    );
    expect(rows[0]?.closed_reason).toBe('declined');
    const passes = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from discovery_passes`,
    );
    expect(passes[0]?.count).toBe('1');
  });

  it('lets the initiator withdraw without suppressing anybody', async () => {
    const alice = await consumer('withdraw-alice@velora.test');
    const bob = await consumer('withdraw-bob@velora.test');
    const pending = await signal(alice, bob);

    const withdrawn = await handle(
      post('/v1/discovery/introductions/withdrawal', alice, {
        introductionId: pending.body.id,
      }),
    );
    expect(withdrawn.status).toBe(200);
    const passes = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from discovery_passes`,
    );
    expect(passes[0]?.count).toBe('0');
    // Changing your mind puts the pair back in front of both of you.
    expect(await candidateIds(alice)).toEqual([bob.id]);
  });

  it('refuses to let the wrong side close an introduction', async () => {
    const alice = await consumer('side-alice@velora.test');
    const bob = await consumer('side-bob@velora.test');
    const pending = await signal(alice, bob);

    // The initiator cannot decline their own signal, and the recipient cannot
    // withdraw one they never made.
    const wrongDecline = await handle(
      post('/v1/discovery/introductions/decline', alice, {
        introductionId: pending.body.id,
      }),
    );
    expect(wrongDecline.status).toBe(404);
    const wrongWithdraw = await handle(
      post('/v1/discovery/introductions/withdrawal', bob, {
        introductionId: pending.body.id,
      }),
    );
    expect(wrongWithdraw.status).toBe(404);
  });

  it('gives a stranger no way to address a pair they are not in', async () => {
    const alice = await consumer('outsider-alice@velora.test');
    const bob = await consumer('outsider-bob@velora.test');
    const eve = await consumer('outsider-eve@velora.test');
    const pending = await signal(alice, bob);

    for (const path of [
      '/v1/discovery/introductions/decline',
      '/v1/discovery/introductions/withdrawal',
    ]) {
      const response = await handle(
        post(path, eve, { introductionId: pending.body.id }),
      );
      expect(response.status, path).toBe(404);
    }
    const rows = await rowsOf<{ state: string }>(
      database.sql`select state from discovery_introductions`,
    );
    expect(rows[0]?.state).toBe('pending');
  });

  it('resolves simultaneous decline and withdrawal to one closure', async () => {
    const alice = await consumer('close-race-alice@velora.test');
    const bob = await consumer('close-race-bob@velora.test');
    const pending = await signal(alice, bob);

    const responses = await Promise.all([
      ...Array.from({ length: 6 }, () =>
        handle(
          post('/v1/discovery/introductions/decline', bob, {
            introductionId: pending.body.id,
          }),
        ),
      ),
      ...Array.from({ length: 6 }, () =>
        handle(
          post('/v1/discovery/introductions/withdrawal', alice, {
            introductionId: pending.body.id,
          }),
        ),
      ),
    ]);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);

    const rows = await rowsOf<{ closed_reason: string; state: string }>(
      database.sql`select closed_reason, state from discovery_introductions`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('closed');
  });

  it('allows a fresh introduction once the suppression from a decline expires', async () => {
    const alice = await consumer('again-alice@velora.test');
    const bob = await consumer('again-bob@velora.test');
    const pending = await signal(alice, bob);
    await handle(
      post('/v1/discovery/introductions/decline', bob, {
        introductionId: pending.body.id,
      }),
    );

    clockOffsetMilliseconds = passSuppressionMilliseconds + 60_000;
    for (const person of [alice, bob]) {
      await handle(
        post('/v1/users/me/availability', person, {
          availableUntil: new Date(
            now().getTime() + 60 * 60 * 1000,
          ).toISOString(),
          state: 'available',
        }),
      );
    }

    const renewed = await signal(bob, alice);
    expect(renewed.status).toBe(200);
    expect(renewed.body.state).toBe('pending');
    expect(renewed.body.id).not.toBe(pending.body.id);
    // The earlier attempt is still on the record rather than rewritten.
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from discovery_introductions`,
    );
    expect(rows[0]?.count).toBe('2');
  });
});

describe('introduction listing', () => {
  it('pages the caller own live introductions without repeating one', async () => {
    const alice = await consumer('list-alice@velora.test');
    const expected = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      const other = await consumer(`list-other-${String(index)}@velora.test`);
      const created = await signal(alice, other);
      expected.add(created.body.id);
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await handle(
        get(
          `/v1/discovery/introductions?pageSize=2${cursor === undefined ? '' : `&cursor=${cursor}`}`,
          alice,
        ),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        introductions: readonly IntroductionBody[];
        nextCursor?: string;
      };
      seen.push(...body.introductions.map((item) => item.id));
      cursor = body.nextCursor;
      if (cursor === undefined) break;
    }
    expect(new Set(seen)).toEqual(expected);
    expect(seen).toHaveLength(expected.size);
  });

  it('refuses a malformed list cursor', async () => {
    const alice = await consumer('list-cursor@velora.test');
    for (const query of [
      '?cursor=not a cursor',
      `?cursor=${Buffer.from('{"i":"nope","t":"2026-01-01T00:00:00.000Z"}', 'utf8').toString('base64url')}`,
      `?cursor=${Buffer.from('{"i":"11111111-2222-3333-4444-555555555555","t":"soon"}', 'utf8').toString('base64url')}`,
    ]) {
      const response = await handle(
        get(`/v1/discovery/introductions${query}`, alice),
      );
      expect(response.status, query).toBe(422);
    }
  });

  it('never exposes the other person state beyond the pair', async () => {
    const alice = await consumer('leak-alice@velora.test');
    const bob = await consumer('leak-bob@velora.test');
    await signal(alice, bob);

    const listed = await introductions(alice);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual([
      'counterpart',
      'createdAt',
      'id',
      'role',
      'state',
    ]);
    const serialized = JSON.stringify(listed);
    for (const leak of ['initiatorId', 'pairLow', 'closedReason', 'version']) {
      expect(serialized, leak).not.toContain(leak);
    }
  });
});

describe('database constraints protect the introduction state machine', () => {
  const pairLow = '11111111-1111-1111-1111-111111111111';
  const pairHigh = '22222222-2222-2222-2222-222222222222';

  it('refuses an unordered pair and an initiator outside it', async () => {
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_introductions (created_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
            values (now(), ${crypto.randomUUID()}, ${pairLow}, ${pairLow}, ${pairHigh}, 'pending', now())`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_introductions (created_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
            values (now(), ${crypto.randomUUID()}, ${crypto.randomUUID()}, ${pairHigh}, ${pairLow}, 'pending', now())`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a mutual row with no moment and a closure with no reason', async () => {
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_introductions (created_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
            values (now(), ${crypto.randomUUID()}, ${pairLow}, ${pairHigh}, ${pairLow}, 'mutual', now())`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_introductions (closed_at, created_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
            values (now(), now(), ${crypto.randomUUID()}, ${pairLow}, ${pairHigh}, ${pairLow}, 'closed', now())`,
        ),
      ),
    ).toBe(true);
  });

  it('keeps the moment a closed introduction became mutual', async () => {
    const first = await consumer('closure-evidence-first@velora.test');
    const second = await consumer('closure-evidence-second@velora.test');
    await signal(first, second);
    const mutual = await signal(second, first);
    expect(mutual.body.state).toBe('mutual');

    // An enforcement closure of a mutual introduction, which is what Phase 8
    // performs. It must not have to erase when the two people connected in
    // order to satisfy a constraint.
    await execute(
      database.sql`update discovery_introductions
        set state = 'closed', closed_at = now(), closed_reason = 'enforcement'
        where id = ${mutual.body.id}`,
    );
    const rows = await rowsOf<{ mutual_at: Date | null; state: string }>(
      database.sql`select mutual_at, state from discovery_introductions where id = ${mutual.body.id}`,
    );
    expect(rows[0]?.state).toBe('closed');
    expect(rows[0]?.mutual_at).not.toBeNull();

    // A pending signal still may not claim a mutual moment it never had.
    const invented = await refused(async () =>
      execute(
        database.sql`update discovery_introductions
          set state = 'pending', closed_at = null, closed_reason = null
          where id = ${mutual.body.id}`,
      ),
    );
    expect(invented).toBe(true);
  });

  it('refuses a pending signal with no expiry and an unknown closure reason', async () => {
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_introductions (created_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
            values (now(), ${crypto.randomUUID()}, ${pairLow}, ${pairHigh}, ${pairLow}, 'pending', now())`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_introductions (closed_at, closed_reason, created_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
            values (now(), 'because', now(), ${crypto.randomUUID()}, ${pairLow}, ${pairHigh}, ${pairLow}, 'closed', now())`,
        ),
      ),
    ).toBe(true);
  });

  it('permits only one live introduction per pair but any number of closed ones', async () => {
    await execute(
      database.sql`insert into discovery_introductions (created_at, expires_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
        values (now(), now() + interval '1 hour', ${crypto.randomUUID()}, ${pairLow}, ${pairHigh}, ${pairLow}, 'pending', now())`,
    );
    expect(
      await refused(() =>
        execute(
          database.sql`insert into discovery_introductions (created_at, expires_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
            values (now(), now() + interval '1 hour', ${crypto.randomUUID()}, ${pairHigh}, ${pairHigh}, ${pairLow}, 'pending', now())`,
        ),
      ),
    ).toBe(true);

    for (let index = 0; index < 2; index += 1) {
      await execute(
        database.sql`insert into discovery_introductions (closed_at, closed_reason, created_at, id, initiator_id, pair_high_id, pair_low_id, state, updated_at)
          values (now(), 'withdrawn', now(), ${crypto.randomUUID()}, ${pairLow}, ${pairHigh}, ${pairLow}, 'closed', now())`,
      );
    }
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from discovery_introductions`,
    );
    expect(rows[0]?.count).toBe('3');
  });
});
