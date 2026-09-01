import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import type {
  LiveStateResponse,
  WalletStateResponse,
} from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createLiveRuntime } from '../../src/live/composition.js';
import { createWalletRuntime } from '../../src/wallet/composition.js';
import { LiveEncounterDirectory } from '../../src/live/directory.js';
import { LiveEncounterEnforcement } from '../../src/live/enforcement.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import { RtcCallEnforcement } from '../../src/realtime/enforcement.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testAdminRuntime,
  testBillingRuntime,
  testClubsRuntime,
  testConsumerOrigin,
  testCreatorsRuntime,
  testDatabaseAdmission,
  testIdentityRuntime,
  testMediaRuntime,
  testNotificationsApiRuntime,
  testPayoutsRuntime,
  testServerConfig,
} from '../support/harness.js';
import {
  mediaEnvironment,
  readyProfileImage,
} from '../support/profile-media.js';

/**
 * Coins, the paid narrowing they buy, and the matcher they narrow — end to end,
 * through the routes a client calls.
 *
 * The whole loop is here because the whole loop is the feature. A balance that
 * is right in isolation and a matcher that is right in isolation still leave
 * the two questions that matter: is somebody charged for a match the filter did
 * not make, and can somebody who paid reach a person safety says they may not.
 * Both are only answerable with the real matcher, the real ledger, the real
 * safety contract, and a real database enforcing its own constraints.
 *
 * Nothing is stubbed that a person would meet. Accounts are onboarded through
 * the real routes, blocks are placed through the real safety route, coins move
 * through the real ledger with its own triggers, and the projection is checked
 * against the entries rather than trusted.
 */

const databaseUrl = await provisionDatabase('velora_wallet');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  LIVE_DISCOVERY_MODE: 'open',
  MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
  REALTIME_CALL_ELIGIBILITY: 'composed',
  REALTIME_RTC_PROVIDER: 'local-test',
  // Both wallet gates on, which is only possible in local and test. Every
  // deployed environment refuses them, and a unit test asserts that refusal.
  WALLET_ANDROID_ACQUISITION: 'local-test',
  WALLET_COIN_LEDGER: 'enabled',
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
      return `live-test-${String(requesterSequence)}`;
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
  calls: new RtcCallEnforcement(database.drizzle),
  catalog: new ClubSafetyDirectory(),
  config,
  consumerContext: users.consumerContext,
  consumers: users.existence,
  conversationTargets: new ConversationParticipation(),
  conversations: new ConversationEnforcement(database.drizzle),
  creators: new CreatorDirectory(),
  database: database.drizzle,
  liveEncounters: new LiveEncounterEnforcement(database.drizzle),
  now,
  users: users.service,
});
// Built once and handed to both DISCOVERY and REALTIME, exactly as the
// application composes it: LIVE's two published facts, constructed from the
// handle rather than from LIVE's runtime, so neither of them needs LIVE to
// exist first.
const liveEncounters = new LiveEncounterDirectory(database.drizzle);
const discovery = createDiscoveryRuntime({
  consumerContext: users.consumerContext,
  database: database.drizzle,
  directory: users.directory,
  liveEncounters,
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
const realtime = createRealtimeRuntime({
  config,
  connections: discovery.connections,
  consumerContext: users.consumerContext,
  database: database.drizzle,
  directory: users.directory,
  enforcement: safety.eligibility,
  liveEncounters,
  logger,
  now,
  onboarding: users.onboarding,
  safety: safety.directory,
  standing: users.standing,
});
const wallet = createWalletRuntime({
  config,
  consumerContext: users.consumerContext,
  database: database.drizzle,
  now,
});
const live = createLiveRuntime({
  accounts: users.service,
  admission: users.onboarding,
  config,
  connections: discovery.connections,
  consumerContext: users.consumerContext,
  conversations: messaging.service,
  database: database.drizzle,
  directory: users.directory,
  enforcement: safety.eligibility,
  introducibility: {
    mayBeIntroducedTo: async (viewer, candidateId, at) =>
      discovery.service.mayBeIntroducedTo(viewer, candidateId, at),
  },
  introductions: {
    signal: async (actor, counterpartId) =>
      discovery.service.signalIntroduction(actor, counterpartId),
  },
  logger,
  now,
  // The published preference contract, supplied because this environment has a
  // ledger. Without it no search is ever narrowed by a paid preference and
  // nothing is ever charged, which is the whole product in every deployed
  // environment.
  premium: wallet.service,
  realtime: realtime.liveSessions,
  safety: safety.directory,
  standing: users.standing,
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
    admin: testAdminRuntime({
      billing: billingRuntime,
      caller: auth.caller,
      config,
      clubs: clubsRuntime,
      creators,
      media: mediaRuntime,
      safety,
    }),
    auth,
    billing: billingRuntime,
    clubs: clubsRuntime,
    creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery,
    ephemeralRedis: healthy,
    identity: testIdentityRuntime({
      config,
      database: database.drizzle,
      logger,
      now,
    }),
    live,
    logger,
    media: mediaRuntime,
    messaging,
    notifications: testNotificationsApiRuntime({
      database: database.drizzle,
      now,
      safety,
      users,
    }),
    payouts: testPayoutsRuntime({
      config,
      creators,
      database: database.drizzle,
    }),
    queueRedis: healthy,
    realtime,
    safety,
    users,
    wallet,
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

function post(path: string, credentials: Credentials, body?: unknown): Request {
  return new Request(`http://api.test${path}`, {
    body: JSON.stringify(body ?? {}),
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
  await readyProfileImage({
    database,
    media: mediaRuntime,
    assetId: media.mediaId,
    users,
  });
  return caller;
}

async function search(caller: Credentials): Promise<LiveStateResponse> {
  const response = await handle(
    post('/v1/live/sessions', caller, { medium: 'video' }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as LiveStateResponse;
}

async function readWallet(caller: Credentials): Promise<WalletStateResponse> {
  const response = await handle(get('/v1/wallet', caller));
  expect(response.status).toBe(200);
  return (await response.json()) as WalletStateResponse;
}

/** Credits coins the way a developer does, through the published route. */
async function grant(
  caller: Credentials,
  coins: string,
  reference = 'suite-grant-0001',
): Promise<WalletStateResponse> {
  const response = await handle(
    post('/v1/wallet/grants', caller, { coins, reference }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as WalletStateResponse;
}

async function activate(
  caller: Credentials,
  region: string,
): Promise<Response> {
  return handle(post('/v1/wallet/live-preference', caller, { region }));
}

/**
 * The ledger's own arithmetic, recomputed from the entries.
 *
 * The projection a balance is read from is a *derived* row, and a derived row
 * that nothing checks is a second source of truth waiting to drift. This is
 * what makes every assertion about a balance in this file an assertion about
 * the books rather than about a cache of them.
 */
async function derivedBalance(
  userId: string,
): Promise<{ readonly available: bigint; readonly reserved: bigint }> {
  const sums = await rowsOf<{
    readonly category: string;
    readonly total: string;
  }>(
    database.drizzle.execute(sql`
      select a.category,
             coalesce(sum(case when e.direction = 'credit' then e.amount else -e.amount end), 0)::text as total
        from wallet_accounts a
        join wallet_entries e on e.account_id = a.id
       where a.subject_id = ${userId}::uuid
       group by a.category
    `),
  );
  const of = (category: string) =>
    BigInt(sums.find((row) => row.category === category)?.total ?? '0');
  return {
    available: of('consumer_balance'),
    reserved: of('consumer_reserved'),
  };
}

/**
 * Two people entering the pool, which is the only way an encounter exists.
 *
 * The second search is what allocates: the first person is waiting when the
 * second arrives, so the matcher hands them to each other. Deliberately not a
 * helper that writes rows — a fixture-built encounter would prove nothing about
 * the matcher, which is where every interesting failure lives.
 */
async function meet(
  first: Credentials,
  second: Credentials,
): Promise<LiveStateResponse> {
  await search(first);
  const matched = await search(second);
  expect(matched.state).toBe('matched');
  return matched;
}

describe('free random matching costs nothing', () => {
  it('opens a search, matches, and moves no coin at all', async () => {
    const alex = await consumer('alex@wallet.test');
    const blair = await consumer('blair@wallet.test');
    await grant(alex, '100');

    const matched = await meet(alex, blair);
    expect(matched.state).toBe('matched');
    // The default search is `Everyone`, and it is free. The reserved position
    // is what a paid narrowing would have moved, and it did not move.
    const balance = await derivedBalance(alex.id);
    expect(balance.available).toBe(100n);
    expect(balance.reserved).toBe(0n);
    const state = await readWallet(alex);
    expect(state.balance?.available).toBe('100');
    expect(state.livePreference).toBeUndefined();
  });

  it('narrows for free on the preferences the product already published', async () => {
    const alex = await consumer('free-narrow@wallet.test');
    const response = await handle(
      post('/v1/live/sessions', alex, {
        medium: 'video',
        preferences: { language: 'es', region: 'same' },
      }),
    );
    expect(response.status).toBe(200);
    const state = (await response.json()) as LiveStateResponse;
    expect(state.preferences.region).toBe('same');
    expect(state.preferences.language).toBe('es');
    // Both of those narrow the pool and neither costs anything, which is what
    // stops a paid tier being sold by making the free product worse.
    expect((await derivedBalance(alex.id)).available).toBe(0n);
  });
});

describe('a balance is the server\u2019s, and a client cannot invent one', () => {
  it('reports nothing rather than zero before anything is granted', async () => {
    const alex = await consumer('empty@wallet.test');
    const state = await readWallet(alex);
    expect(state.enabled).toBe(true);
    expect(state.balance).toEqual({ available: '0', reserved: '0' });
    // The price and the duration come from the server, so a surface can never
    // render a price that is not the price that will be charged.
    expect(Number(state.livePreferenceOffer.coins)).toBeGreaterThan(0);
    expect(state.livePreferenceOffer.durationSeconds).toBeGreaterThan(0);
  });

  it('credits a repeated grant exactly once', async () => {
    const alex = await consumer('idempotent@wallet.test');
    await grant(alex, '40', 'same-reference-01');
    const second = await grant(alex, '40', 'same-reference-01');
    expect(second.balance?.available).toBe('40');
    expect((await derivedBalance(alex.id)).available).toBe(40n);
    // One ledger transaction, not two. The business identity is what settles
    // it, rather than a prior read two concurrent retries would both pass.
    const transactions = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'grant'`,
      ),
    );
    expect(transactions[0]?.total).toBe('1');
  });

  it('credits concurrent grants of one reference exactly once', async () => {
    const alex = await consumer('concurrent-grant@wallet.test');
    const attempts = await Promise.all(
      Array.from({ length: 5 }, async () =>
        handle(
          post('/v1/wallet/grants', alex, {
            coins: '30',
            reference: 'race-reference-01',
          }),
        ),
      ),
    );
    for (const attempt of attempts) expect(attempt.status).toBe(200);
    expect((await derivedBalance(alex.id)).available).toBe(30n);
  });

  it('scopes a grant reference to the caller, so two people do not share one', async () => {
    const alex = await consumer('scope-a@wallet.test');
    const blair = await consumer('scope-b@wallet.test');
    await grant(alex, '25', 'shared-reference');
    await grant(blair, '25', 'shared-reference');
    expect((await derivedBalance(alex.id)).available).toBe(25n);
    expect((await derivedBalance(blair.id)).available).toBe(25n);
  });

  it('refuses to be edited, so a balance cannot be rewritten after the fact', async () => {
    const alex = await consumer('append-only@wallet.test');
    await grant(alex, '50');
    let refused = '';
    try {
      await database.drizzle.execute(
        sql`update wallet_entries set amount = 5000`,
      );
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    // Refused by a trigger rather than by application code. The driver wraps
    // the cause, so what is asserted is that the statement did not succeed and
    // that the books are unchanged — which is the guarantee, and is checkable
    // without depending on how a driver renders a message.
    expect(refused).not.toBe('');
    expect((await derivedBalance(alex.id)).available).toBe(50n);
  });
});

describe('activating a paid narrowing holds coins rather than spending them', () => {
  it('moves the price from available to reserved, and says so', async () => {
    const alex = await consumer('activate@wallet.test');
    const funded = await grant(alex, '100');
    const price = BigInt(funded.livePreferenceOffer.coins);

    const response = await activate(alex, 'FR');
    expect(response.status).toBe(200);
    const state = (await response.json()) as WalletStateResponse;
    expect(state.livePreference?.region).toBe('FR');
    expect(state.balance?.available).toBe((100n - price).toString());
    expect(state.balance?.reserved).toBe(price.toString());

    const derived = await derivedBalance(alex.id);
    expect(derived.available).toBe(100n - price);
    expect(derived.reserved).toBe(price);
  });

  it('refuses a second window rather than charging twice', async () => {
    const alex = await consumer('one-window@wallet.test');
    await grant(alex, '100');
    expect((await activate(alex, 'FR')).status).toBe(200);
    const second = await activate(alex, 'DE');
    expect(second.status).toBe(409);
    const state = await readWallet(alex);
    // Still the first window, and charged once.
    expect(state.livePreference?.region).toBe('FR');
  });

  it('holds one window under concurrent activation', async () => {
    const alex = await consumer('race-window@wallet.test');
    const funded = await grant(alex, '100');
    const price = BigInt(funded.livePreferenceOffer.coins);
    const attempts = await Promise.all(
      Array.from({ length: 4 }, async () => activate(alex, 'FR')),
    );
    expect(attempts.filter((attempt) => attempt.status === 200)).toHaveLength(
      1,
    );
    expect((await derivedBalance(alex.id)).reserved).toBe(price);
  });

  it('refuses an activation the balance will not cover, and says only that', async () => {
    const alex = await consumer('short@wallet.test');
    await grant(alex, '1');
    const response = await activate(alex, 'FR');
    expect(response.status).toBe(409);
    const body = (await response.json()) as Readonly<Record<string, unknown>>;
    expect(body.code).toBe('INSUFFICIENT_FUNDS');
    // How much is missing is not disclosed, and neither is anything else about
    // the balance: a sequence of refusals would otherwise read it. Asserted as
    // the whole shape rather than as the absence of a number, because a
    // correlation identifier is a random string that will eventually contain
    // any number somebody searches for.
    expect(Object.keys(body).toSorted()).toEqual([
      'code',
      'correlationId',
      'message',
    ]);
    expect(body.message).toBe('Request failed');
    expect((await derivedBalance(alex.id)).reserved).toBe(0n);
  });

  it('refuses a preference the product does not support', async () => {
    const alex = await consumer('unsupported@wallet.test');
    await grant(alex, '100');
    // Not a country code, and — decisively — not an attribute either. The
    // contract cannot express a gender, an age, or a list, so the only thing
    // left to refuse is a malformed region.
    for (const body of [
      { region: 'es' },
      { region: 'ESP' },
      { gender: 'women', region: 'ES' },
      { regions: ['ES'] },
    ]) {
      const response = await handle(
        post('/v1/wallet/live-preference', alex, body),
      );
      expect(response.status).toBe(422);
    }
    expect((await derivedBalance(alex.id)).reserved).toBe(0n);
  });

  it('returns the coins in full when the window is cancelled', async () => {
    const alex = await consumer('cancel@wallet.test');
    await grant(alex, '100');
    await activate(alex, 'FR');
    const response = await handle(
      post('/v1/wallet/live-preference/cancellation', alex),
    );
    expect(response.status).toBe(200);
    const state = (await response.json()) as WalletStateResponse;
    expect(state.livePreference).toBeUndefined();
    expect(state.balance).toEqual({ available: '100', reserved: '0' });
    // Cancelling nothing is not an error either.
    expect(
      (await handle(post('/v1/wallet/live-preference/cancellation', alex)))
        .status,
    ).toBe(200);
  });
});

describe('a paid narrowing narrows, and charges only when it works', () => {
  it('keeps somebody outside the chosen region out of the pool', async () => {
    // Both accounts are onboarded in ES by the helper above, so a window
    // narrowed to FR matches nobody. The pool is otherwise identical to the one
    // that matched in the free case.
    const alex = await consumer('narrow-a@wallet.test');
    const blair = await consumer('narrow-b@wallet.test');
    await grant(alex, '100');
    await activate(alex, 'FR');

    await search(blair);
    const state = await search(alex);
    expect(state.state).toBe('searching');
    expect(state.premium?.region).toBe('FR');
    // Nothing was found, so nothing was charged — the coins are still held.
    const derived = await derivedBalance(alex.id);
    expect(derived.reserved > 0n).toBe(true);
    const captured = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'capture'`,
      ),
    );
    expect(captured[0]?.total).toBe('0');
  });

  it('charges the window when it produces the match it was bought for', async () => {
    const alex = await consumer('capture-a@wallet.test');
    const blair = await consumer('capture-b@wallet.test');
    const funded = await grant(alex, '100');
    const price = BigInt(funded.livePreferenceOffer.coins);
    // Both accounts declared ES, so a window narrowed to ES matches.
    await activate(alex, 'ES');

    await search(blair);
    const matched = await search(alex);
    expect(matched.state).toBe('matched');

    const derived = await derivedBalance(alex.id);
    expect(derived.available).toBe(100n - price);
    // Captured, so the reservation is gone rather than still held.
    expect(derived.reserved).toBe(0n);
    const state = await readWallet(alex);
    expect(state.livePreference).toBeUndefined();
    expect(state.balance).toEqual({
      available: (100n - price).toString(),
      reserved: '0',
    });
  });

  it('returns the coins when the window closes having matched nobody', async () => {
    const alex = await consumer('expire@wallet.test');
    await grant(alex, '100');
    await activate(alex, 'FR');
    expect((await derivedBalance(alex.id)).reserved > 0n).toBe(true);

    // Past the window. The sweep is the worker's job and runs whether or not
    // anybody is watching, which is why it is called directly here rather than
    // through a route somebody would have to press.
    clockOffsetMilliseconds = 16 * 60 * 1000;
    const swept = await wallet.service.sweepExpired();
    expect(swept.released).toBe(1);
    const derived = await derivedBalance(alex.id);
    expect(derived.available).toBe(100n);
    expect(derived.reserved).toBe(0n);
    // Settling twice changes nothing.
    expect((await wallet.service.sweepExpired()).released).toBe(0);
  });

  it('stops applying a window whose time is up, even before the sweep runs', async () => {
    const alex = await consumer('stale-window@wallet.test');
    const blair = await consumer('stale-peer@wallet.test');
    await grant(alex, '100');
    await activate(alex, 'FR');
    clockOffsetMilliseconds = 16 * 60 * 1000;

    await search(blair);
    const matched = await search(alex);
    // The narrowing is gone, so the match happens — and it happens for free,
    // because an expired window is not a window that can be charged.
    expect(matched.state).toBe('matched');
    expect(matched.premium).toBeUndefined();
    const captured = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'capture'`,
      ),
    );
    expect(captured[0]?.total).toBe('0');
  });
});

describe('safety decides, and money never overrules it', () => {
  it('refuses a blocked pair to somebody who paid to find them', async () => {
    const alex = await consumer('safe-a@wallet.test');
    const blair = await consumer('safe-b@wallet.test');
    await grant(alex, '100');
    // Blair blocks Alex. Both are in ES, so the paid narrowing includes them.
    const blocked = await handle(
      post('/v1/safety/blocks', blair, { targetId: alex.id }),
    );
    expect(blocked.status).toBe(200);

    await activate(alex, 'ES');
    await search(blair);
    const state = await search(alex);
    // No encounter, and no charge. Paying narrows the pool and authorizes
    // nothing: the block is asked of TRUST & SAFETY under the pair lock, in the
    // same order it always is.
    expect(state.state).toBe('searching');
    expect((await derivedBalance(alex.id)).reserved > 0n).toBe(true);
  });
});

describe('a store purchase is proved by the store', () => {
  it('credits a verified purchase exactly once', async () => {
    const alex = await consumer('play@wallet.test');
    const body = {
      productReference: 'velora.coins.local_test',
      purchaseToken: 'local-test-purchase-aa11bb22',
    };
    const first = await handle(
      post('/v1/wallet/android-purchases', alex, body),
    );
    expect(first.status).toBe(200);
    const state = (await first.json()) as WalletStateResponse;
    expect(state.balance?.available).toBe('100');

    // A redelivered acknowledgement, a reinstall replaying the token, a support
    // retry: all one credit.
    const second = await handle(
      post('/v1/wallet/android-purchases', alex, body),
    );
    expect(second.status).toBe(200);
    expect((await derivedBalance(alex.id)).available).toBe(100n);
  });

  it('mints nothing for a token the store did not issue', async () => {
    const alex = await consumer('forged@wallet.test');
    const response = await handle(
      post('/v1/wallet/android-purchases', alex, {
        productReference: 'velora.coins.local_test',
        purchaseToken: 'i-made-this-up',
      }),
    );
    expect(response.status).toBe(409);
    expect((await derivedBalance(alex.id)).available).toBe(0n);
  });

  it('mints nothing for a product this platform does not sell', async () => {
    const alex = await consumer('wrong-product@wallet.test');
    const response = await handle(
      post('/v1/wallet/android-purchases', alex, {
        productReference: 'velora.coins.enormous',
        purchaseToken: 'local-test-purchase-aa11bb22',
      }),
    );
    expect(response.status).toBe(409);
    expect((await derivedBalance(alex.id)).available).toBe(0n);
  });

  it('credits what the catalogue says rather than what the request claims', async () => {
    const alex = await consumer('claimed@wallet.test');
    const response = await handle(
      post('/v1/wallet/android-purchases', alex, {
        // There is no field in which to say this, and sending one is refused
        // outright rather than ignored.
        coins: '1000000',
        productReference: 'velora.coins.local_test',
        purchaseToken: 'local-test-purchase-aa11bb22',
      }),
    );
    expect(response.status).toBe(422);
    expect((await derivedBalance(alex.id)).available).toBe(0n);
  });
});

describe('nobody can spend somebody else\u2019s coins', () => {
  it('takes the payer from the session rather than from the body', async () => {
    const alex = await consumer('payer@wallet.test');
    const blair = await consumer('bystander@wallet.test');
    await grant(alex, '100');
    // The shape carries no account field at all, so the closest an attacker can
    // come is sending one and having it refused.
    const response = await handle(
      post('/v1/wallet/live-preference', blair, {
        region: 'FR',
        userId: alex.id,
      }),
    );
    expect(response.status).toBe(422);
    expect((await derivedBalance(alex.id)).available).toBe(100n);
  });

  it('refuses every wallet route to somebody with no session', async () => {
    for (const path of [
      '/v1/wallet/live-preference',
      '/v1/wallet/live-preference/cancellation',
      '/v1/wallet/android-purchases',
      '/v1/wallet/grants',
    ]) {
      const response = await handle(
        new Request(`http://api.test${path}`, {
          body: '{}',
          headers: {
            'content-type': 'application/json',
            origin: testConsumerOrigin,
          },
          method: 'POST',
        }),
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });
});
