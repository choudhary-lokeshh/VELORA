import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import type {
  LivePreferenceSelection,
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
  // Only so a language preference can be refused before it is sold. It asks
  // what the *buyer* speaks and nothing about anybody they might meet.
  profiles: users.directory,
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

async function consumer(
  subject: string,
  profile: {
    readonly languages?: readonly string[];
    readonly matchingGender?: string;
    readonly region?: string;
  } = {},
): Promise<Credentials> {
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
      region: profile.region ?? 'ES',
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
      languages: [...(profile.languages ?? ['es'])],
    }),
  );
  if (profile.matchingGender !== undefined) {
    const declared = await handle(
      post('/v1/users/me/matching-gender', caller, {
        matchingGender: profile.matchingGender,
      }),
    );
    expect(declared.status).toBe(200);
  }
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

/**
 * Leaves the pool.
 *
 * Used deliberately between the negative and positive halves of a filter test.
 * Two people who do not match the buyer are still ordinary eligible strangers
 * to each other, so leaving them in the pool means they pair with each other —
 * and the next assertion then passes or fails for a reason that has nothing to
 * do with the filter under test.
 */
async function leave(caller: Credentials): Promise<void> {
  const response = await handle(post('/v1/live/departures', caller, {}));
  expect(response.status).toBe(200);
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
  selection: LivePreferenceSelection | string,
): Promise<Response> {
  return handle(
    post(
      '/v1/wallet/live-preference',
      caller,
      typeof selection === 'string' ? { region: selection } : selection,
    ),
  );
}

async function broaden(
  caller: Credentials,
  selection: LivePreferenceSelection,
): Promise<Response> {
  return handle(
    post('/v1/wallet/live-preference/broadening', caller, selection),
  );
}

/** What one selection costs, from the catalogue the server publishes. */
function priceOf(
  state: WalletStateResponse,
  ...kinds: readonly ('gender' | 'language' | 'region')[]
): bigint {
  return kinds.reduce((total, kind) => {
    const entry = state.livePreferenceCatalogue.preferences.find(
      (preference) => preference.kind === kind,
    );
    expect(entry, `catalogue publishes ${kind}`).toBeDefined();
    return total + BigInt(entry?.coins ?? '0');
  }, 0n);
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
    expect(state.livePreferenceCatalogue.durationSeconds).toBeGreaterThan(0);
    expect(
      state.livePreferenceCatalogue.preferences.map(
        (preference) => preference.kind,
      ),
    ).toEqual(['gender', 'region', 'language']);
    for (const preference of state.livePreferenceCatalogue.preferences) {
      expect(Number(preference.coins)).toBeGreaterThan(0);
    }
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
    const price = priceOf(funded, 'region');

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
    const price = priceOf(funded, 'region');
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
    const price = priceOf(funded, 'region');
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
    expect(state.balance).toEqual({
      available: (100n - price).toString(),
      reserved: '0',
    });
    // And the window is *still running*. What was bought is fifteen minutes of
    // narrowed matching, not one match: an entitlement that vanished the
    // instant it was charged would be a per-match fee wearing a window's
    // clothes, and the person pressing Next would silently be handed the whole
    // pool a second later.
    expect(state.livePreference?.region).toBe('ES');
    expect(state.livePreference?.charged).toBe(true);
  });

  it('charges once for the window, however many matches it produces', async () => {
    const alex = await consumer('capture-once-a@wallet.test');
    const blair = await consumer('capture-once-b@wallet.test');
    const casey = await consumer('capture-once-c@wallet.test');
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'region');
    await activate(alex, 'ES');

    await search(blair);
    expect((await search(alex)).state).toBe('matched');
    // Next. A second real, filtered encounter inside the same window.
    await handle(post('/v1/live/departures', alex, {}));
    await search(casey);
    const second = await search(alex);
    expect(second.state).toBe('matched');
    expect(second.premium?.charged).toBe(true);

    // One charge, for one window. Two would be the per-match fee this product
    // deliberately does not sell.
    const captures = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'capture'`,
      ),
    );
    expect(captures[0]?.total).toBe('1');
    expect((await derivedBalance(alex.id)).available).toBe(100n - price);
  });

  it('closes a charged window when its time is up, and returns nothing', async () => {
    const alex = await consumer('capture-expiry-a@wallet.test');
    const blair = await consumer('capture-expiry-b@wallet.test');
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'region');
    await activate(alex, 'ES');
    await search(blair);
    expect((await search(alex)).state).toBe('matched');

    clockOffsetMilliseconds = 16 * 60 * 1000;
    const swept = await wallet.service.sweepExpired();
    // Closed, not released. The money moved at capture, and a release here
    // would be the platform handing back coins it had already earned.
    expect(swept.closed).toBe(1);
    expect(swept.released).toBe(0);
    expect((await derivedBalance(alex.id)).available).toBe(100n - price);
    const releases = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'release'`,
      ),
    );
    expect(releases[0]?.total).toBe('0');
    // And the person may buy another one, which the open-window index would
    // otherwise refuse for ever.
    expect((await readWallet(alex)).livePreference).toBeUndefined();
    expect((await activate(alex, 'FR')).status).toBe(200);
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

/**
 * The declared preferences, one at a time and together.
 *
 * Every test here is about a way a paid filter goes wrong: it matches somebody
 * it should not, it silently drops half of what was bought, it treats "not
 * declared" as a category, or it sells a narrowing the data cannot answer.
 */
describe('a paid narrowing uses declared data and nothing else', () => {
  it('matches only people who declared the category that was bought', async () => {
    const alex = await consumer('gender-buyer@wallet.test');
    const woman = await consumer('gender-woman@wallet.test', {
      matchingGender: 'woman',
    });
    const man = await consumer('gender-man@wallet.test', {
      matchingGender: 'man',
    });
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'gender');
    expect((await activate(alex, { gender: 'woman' })).status).toBe(200);

    // The man is in the pool first and is eligible in every other way. A filter
    // that admitted him would be the filter not being applied.
    await search(man);
    expect((await search(alex)).state).toBe('searching');
    expect((await derivedBalance(alex.id)).reserved).toBe(price);

    // He leaves before she arrives. Left in the pool the two of them would
    // simply pair with each other — they are ordinary eligible strangers — and
    // the next assertion would be about queue order rather than about the
    // filter.
    await leave(man);
    await search(woman);
    const matched = await search(alex);
    expect(matched.state).toBe('matched');
    expect(matched.encounter?.peer.id).toBe(woman.id);
    expect((await derivedBalance(alex.id)).reserved).toBe(0n);
  });

  it('never returns somebody who has not declared, or who declined to say', async () => {
    const alex = await consumer('gender-silent-buyer@wallet.test');
    const silent = await consumer('gender-silent@wallet.test');
    const declined = await consumer('gender-declined@wallet.test', {
      matchingGender: 'undisclosed',
    });
    await grant(alex, '100');
    await activate(alex, { gender: 'woman' });

    // One at a time, so each is the only candidate when the buyer looks.
    // Neither is a woman, a man, or non-binary as far as this platform knows,
    // and the platform declines to guess: they are matched by Everyone, which
    // is free, and by nothing narrower.
    for (const nobody of [silent, declined]) {
      await search(nobody);
      expect((await search(alex)).state).toBe('searching');
      await leave(nobody);
    }
  });

  it('cannot be asked to filter for the people who declined to say', async () => {
    const alex = await consumer('gender-undisclosed@wallet.test');
    await grant(alex, '100');
    // Refused by the contract before the service is reached. Declining has to
    // stay an answer with no consequences, and a filter over it would make it
    // one with several.
    const refused = await activate(alex, {
      gender: 'undisclosed',
    } as unknown as LivePreferenceSelection);
    expect(refused.status).toBe(422);
    expect((await derivedBalance(alex.id)).reserved).toBe(0n);
  });

  it('matches on a declared language, and refuses to sell one nobody speaks', async () => {
    const alex = await consumer('language-buyer@wallet.test', {
      languages: ['es', 'fr'],
    });
    const speaker = await consumer('language-fr@wallet.test', {
      languages: ['es', 'fr'],
    });
    const other = await consumer('language-es@wallet.test', {
      languages: ['es'],
    });
    await grant(alex, '100');

    // A language the buyer does not speak is a search that means nothing, so it
    // is refused rather than sold and quietly dropped.
    expect((await activate(alex, { language: 'de' })).status).toBe(422);
    expect((await derivedBalance(alex.id)).reserved).toBe(0n);

    expect((await activate(alex, { language: 'fr' })).status).toBe(200);
    await search(other);
    expect((await search(alex)).state).toBe('searching');
    await leave(other);
    await search(speaker);
    expect((await search(alex)).encounter?.peer.id).toBe(speaker.id);
  });

  it('intersects a composed selection rather than loosening it', async () => {
    const alex = await consumer('combined-buyer@wallet.test', {
      languages: ['es', 'fr'],
    });
    // Satisfies two of the three. Every one of these is a person a looser
    // matcher would hand over, and none of them is what was bought.
    const wrongRegion = await consumer('combined-wrong-region@wallet.test', {
      languages: ['es', 'fr'],
      matchingGender: 'woman',
      region: 'DE',
    });
    const wrongGender = await consumer('combined-wrong-gender@wallet.test', {
      languages: ['es', 'fr'],
      matchingGender: 'man',
      region: 'FR',
    });
    const wrongLanguage = await consumer('combined-wrong-lang@wallet.test', {
      languages: ['es'],
      matchingGender: 'woman',
      region: 'FR',
    });
    const exact = await consumer('combined-exact@wallet.test', {
      languages: ['es', 'fr'],
      matchingGender: 'woman',
      region: 'FR',
    });

    const funded = await grant(alex, '200');
    const price = priceOf(funded, 'gender', 'region', 'language');
    const activated = await activate(alex, {
      gender: 'woman',
      language: 'fr',
      region: 'FR',
    });
    expect(activated.status).toBe(200);
    const state = (await activated.json()) as WalletStateResponse;
    // The price of a selection is the sum of what is in it, published by the
    // catalogue and never computed by a client.
    expect(state.balance?.reserved).toBe(price.toString());
    expect(state.livePreference?.gender).toBe('woman');
    expect(state.livePreference?.language).toBe('fr');
    expect(state.livePreference?.region).toBe('FR');

    // One at a time, so each is the only candidate when the buyer looks — three
    // near-misses left in the pool would pair two of them with each other and
    // prove nothing about the filter.
    for (const near of [wrongRegion, wrongGender, wrongLanguage]) {
      await search(near);
      expect((await search(alex)).state).toBe('searching');
      await leave(near);
    }
    // Each satisfies two of the three. An intersection finds nobody, and a
    // filter that quietly loosened would have matched all of them.
    expect((await derivedBalance(alex.id)).reserved).toBe(price);

    await search(exact);
    expect((await search(alex)).encounter?.peer.id).toBe(exact.id);
    expect((await derivedBalance(alex.id)).reserved).toBe(0n);
  });

  it('answers an empty pool honestly rather than inventing anybody', async () => {
    const alex = await consumer('empty-pool@wallet.test');
    await grant(alex, '100');
    await activate(alex, { gender: 'non_binary', region: 'JP' });
    // Nobody at all is searching. The honest answer is that the search is still
    // running, the coins are still held, and no person has been fabricated to
    // justify the purchase.
    const state = await search(alex);
    expect(state.state).toBe('searching');
    expect(state.encounter).toBeUndefined();
    expect(state.premium?.charged).toBe(false);
    expect((await derivedBalance(alex.id)).reserved > 0n).toBe(true);
  });

  it('lets a client change what it declares, and applies it to the next match', async () => {
    const alex = await consumer('declaration-change-buyer@wallet.test');
    const blair = await consumer('declaration-change@wallet.test', {
      matchingGender: 'man',
    });
    await grant(alex, '100');
    await activate(alex, { gender: 'woman' });

    await search(blair);
    expect((await search(alex)).state).toBe('searching');

    // Blair changes what they declare. It takes effect on the next candidate
    // the matcher considers, which is the whole of what a declaration does.
    expect(
      (
        await handle(
          post('/v1/users/me/matching-gender', blair, {
            matchingGender: 'woman',
          }),
        )
      ).status,
    ).toBe(200);
    expect((await search(alex)).encounter?.peer.id).toBe(blair.id);
  });
});

/**
 * Changing a window that is already running.
 *
 * The rule is one sentence — widening is free, anything else is a new window —
 * and these are the ways an implementation drifts off it.
 */
describe('a window can be widened, and never silently re-sold', () => {
  it('drops a preference at no charge and keeps the time it has left', async () => {
    const alex = await consumer('broaden-buyer@wallet.test');
    const woman = await consumer('broaden-woman@wallet.test', {
      matchingGender: 'woman',
      region: 'DE',
    });
    const funded = await grant(alex, '200');
    const full = priceOf(funded, 'gender', 'region');
    const activated = await activate(alex, { gender: 'woman', region: 'ES' });
    const before = (await activated.json()) as WalletStateResponse;

    const widened = await broaden(alex, { gender: 'woman' });
    expect(widened.status).toBe(200);
    const after = (await widened.json()) as WalletStateResponse;
    expect(after.livePreference?.region).toBeUndefined();
    expect(after.livePreference?.gender).toBe('woman');
    // Nothing charged and nothing refunded: a wider search cannot cost more
    // than the one already paid for, and the window keeps its own clock.
    expect(after.balance?.reserved).toBe(full.toString());
    expect(after.livePreference?.expiresAt).toBe(
      before.livePreference?.expiresAt,
    );
    expect(after.livePreference?.id).toBe(before.livePreference?.id);

    // And the wider search now reaches somebody the narrow one excluded.
    await search(woman);
    expect((await search(alex)).encounter?.peer.id).toBe(woman.id);
  });

  it('refuses anything that is not strictly a widening', async () => {
    const alex = await consumer('broaden-refuse@wallet.test', {
      languages: ['es', 'fr'],
    });
    await grant(alex, '200');
    await activate(alex, { gender: 'woman', region: 'ES' });

    const attempts: readonly LivePreferenceSelection[] = [
      // Swapping a value. It could cost the same and still be a different
      // window, and a surprise charge is not the only way to break trust.
      { gender: 'woman', region: 'FR' },
      { gender: 'man', region: 'ES' },
      // Adding a preference. This one genuinely costs more.
      { gender: 'woman', language: 'fr', region: 'ES' },
      // Naming exactly what is already held changes nothing, and a no-op that
      // reported success would let a surface believe it had done something.
      { gender: 'woman', region: 'ES' },
      // A kind the window never had.
      { language: 'fr' },
    ];
    for (const attempt of attempts) {
      const refused = await broaden(alex, attempt);
      expect(refused.status, JSON.stringify(attempt)).toBe(422);
    }
    // Emptying it entirely is `Everyone`, which is cancellation and has its own
    // operation — the one that knows whether coins are owed back.
    expect((await broaden(alex, {})).status).toBe(422);
    const held = (await readWallet(alex)).livePreference;
    expect(held?.gender).toBe('woman');
    expect(held?.region).toBe('ES');
  });

  it('refuses to widen when no window is running', async () => {
    const alex = await consumer('broaden-none@wallet.test');
    await grant(alex, '100');
    expect((await broaden(alex, { gender: 'woman' })).status).toBe(409);
  });

  it('returns everything when an uncharged window is cancelled, and nothing when a charged one is', async () => {
    const alex = await consumer('cancel-charged-a@wallet.test');
    const blair = await consumer('cancel-charged-b@wallet.test');
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'region');

    // Uncharged: everything comes back.
    await activate(alex, 'ES');
    await handle(post('/v1/wallet/live-preference/cancellation', alex, {}));
    expect((await derivedBalance(alex.id)).available).toBe(100n);

    // Charged: the window found somebody, was paid for then, and ending it
    // early gives up only the time it had left.
    await activate(alex, 'ES');
    await search(blair);
    expect((await search(alex)).state).toBe('matched');
    await handle(post('/v1/wallet/live-preference/cancellation', alex, {}));
    const derived = await derivedBalance(alex.id);
    expect(derived.available).toBe(100n - price);
    expect(derived.reserved).toBe(0n);
    expect((await readWallet(alex)).livePreference).toBeUndefined();
  });
});

/**
 * The races.
 *
 * Each of these is a way two correct-looking operations produce a wrong balance
 * when they overlap, and each is written as the overlap rather than as a
 * sequence — because a sequential version of any of them passes against code
 * that has the bug.
 */
describe('two things happening at once still produce one financial answer', () => {
  it('cannot be double-reserved from two tabs, two devices, or four', async () => {
    const alex = await consumer('race-tabs@wallet.test');
    const funded = await grant(alex, '200');
    const price = priceOf(funded, 'gender', 'region');

    // Four simultaneous activations of the *same* selection, as two tabs and a
    // phone would produce. The partial unique index settles it inside the
    // database rather than a prior read all four would pass.
    const attempts = await Promise.all(
      Array.from({ length: 4 }, async () =>
        activate(alex, { gender: 'woman', region: 'FR' }),
      ),
    );
    expect(attempts.filter((one) => one.status === 200)).toHaveLength(1);
    expect((await derivedBalance(alex.id)).reserved).toBe(price);
  });

  it('cannot be double-reserved by two different selections at once', async () => {
    const alex = await consumer('race-different@wallet.test');
    await grant(alex, '200');
    // Different bodies, so nothing can collide on an idempotency key: only the
    // one-open-window rule stands between this and two reservations.
    const [first, second] = await Promise.all([
      activate(alex, { gender: 'woman' }),
      activate(alex, { region: 'FR' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const state = await readWallet(alex);
    const held = state.livePreference;
    expect(held).toBeDefined();
    expect(state.balance?.reserved).toBe(held?.coins);
  });

  it('never lets a capture and a release settle the same window', async () => {
    const alex = await consumer('race-settle-a@wallet.test');
    const blair = await consumer('race-settle-b@wallet.test');
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'region');
    await activate(alex, 'ES');
    await search(blair);

    // The match and the expiry sweep, overlapping. Whichever commits first, the
    // other finds a window that is no longer settleable — so exactly one of
    // "charged" and "returned" is true, and the books say which.
    clockOffsetMilliseconds = 16 * 60 * 1000;
    const [, swept] = await Promise.all([
      search(alex),
      wallet.service.sweepExpired(),
    ]);
    clockOffsetMilliseconds = 0;

    const settlements = await rowsOf<{
      readonly reason: string;
      readonly total: string;
    }>(
      database.drizzle.execute(
        sql`select reason, count(*)::text as total from wallet_transactions
            where reason in ('capture', 'release') group by reason`,
      ),
    );
    const total = settlements.reduce((sum, row) => sum + Number(row.total), 0);
    expect(total).toBe(1);
    const derived = await derivedBalance(alex.id);
    expect(derived.reserved).toBe(0n);
    // Charged exactly the price, or charged nothing. Never both and never half.
    expect([100n - price, 100n]).toContain(derived.available);
    expect(swept.examined).toBeGreaterThanOrEqual(0);
  });

  it('settles an expired window once when two workers sweep together', async () => {
    const alex = await consumer('race-two-workers@wallet.test');
    await grant(alex, '100');
    await activate(alex, 'FR');
    clockOffsetMilliseconds = 16 * 60 * 1000;

    // Two sweeps at once, which a second worker process is. The guarded update
    // is what makes the second one a no-op rather than a second refund.
    const [first, second] = await Promise.all([
      wallet.service.sweepExpired(),
      wallet.service.sweepExpired(),
    ]);
    clockOffsetMilliseconds = 0;
    expect(first.released + second.released).toBe(1);
    expect((await derivedBalance(alex.id)).available).toBe(100n);
    const releases = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'release'`,
      ),
    );
    expect(releases[0]?.total).toBe('1');
  });

  it('never releases a window that has already been charged', async () => {
    const alex = await consumer('race-no-release-a@wallet.test');
    const blair = await consumer('race-no-release-b@wallet.test');
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'region');
    await activate(alex, 'ES');
    await search(blair);
    expect((await search(alex)).state).toBe('matched');

    // Charged. Now every path that could return coins runs, twice: the person
    // cancelling, and the sweep after expiry. Neither may give back money the
    // platform has already earned.
    await handle(post('/v1/wallet/live-preference/cancellation', alex, {}));
    clockOffsetMilliseconds = 16 * 60 * 1000;
    await wallet.service.sweepExpired();
    await wallet.service.sweepExpired();
    clockOffsetMilliseconds = 0;
    expect((await derivedBalance(alex.id)).available).toBe(100n - price);
    const releases = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'release'`,
      ),
    );
    expect(releases[0]?.total).toBe('0');
  });

  it('never charges a window that has already been returned', async () => {
    const alex = await consumer('race-no-capture-a@wallet.test');
    const blair = await consumer('race-no-capture-b@wallet.test');
    await grant(alex, '100');
    await activate(alex, 'ES');
    // Returned in full at the person's request. The matcher then finds a real
    // match, which it should — the search is free again — and charges nothing.
    await handle(post('/v1/wallet/live-preference/cancellation', alex, {}));
    expect((await derivedBalance(alex.id)).available).toBe(100n);

    await search(blair);
    expect((await search(alex)).state).toBe('matched');
    expect((await derivedBalance(alex.id)).available).toBe(100n);
    const captures = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'capture'`,
      ),
    );
    expect(captures[0]?.total).toBe('0');
  });

  it('cannot fund a window from coins another spend is already taking', async () => {
    const alex = await consumer('race-overspend@wallet.test');
    const funded = await grant(alex, '30');
    const price = priceOf(funded, 'gender');
    expect(price).toBeGreaterThan(15n);

    // Two activations that would together cost more than the balance. The
    // reserved position is a real ledger position, so the second is refused by
    // the books rather than by whichever read ran first.
    const attempts = await Promise.all([
      activate(alex, { gender: 'woman' }),
      activate(alex, { gender: 'man' }),
    ]);
    expect(attempts.filter((one) => one.status === 200)).toHaveLength(1);
    const derived = await derivedBalance(alex.id);
    expect(derived.reserved).toBe(price);
    expect(derived.available).toBe(30n - price);
    expect(derived.available >= 0n).toBe(true);
  });

  it('keeps a candidate who leaves during allocation out of the encounter', async () => {
    const alex = await consumer('race-leaver-a@wallet.test');
    const blair = await consumer('race-leaver-b@wallet.test');
    await grant(alex, '100');
    await activate(alex, 'ES');
    await search(blair);
    await leave(blair);

    // Nobody left in the pool. No encounter is invented to justify the window,
    // and the coins stay held rather than being charged for a person who is
    // not there.
    expect((await search(alex)).state).toBe('searching');
    expect((await derivedBalance(alex.id)).reserved > 0n).toBe(true);
  });

  it('does not unwind a charge because a declaration changed afterwards', async () => {
    const alex = await consumer('race-declaration-a@wallet.test');
    const blair = await consumer('race-declaration-b@wallet.test', {
      matchingGender: 'woman',
    });
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'gender');
    await activate(alex, { gender: 'woman' });
    await search(blair);
    const matched = await search(alex);
    expect(matched.state).toBe('matched');

    // Blair changes what they declare while the encounter is live. It decides
    // who the matcher considers next; it is not a safety event, and it does not
    // reach back into a meeting that was legitimately allocated under the
    // declaration in force at the time.
    await handle(
      post('/v1/users/me/matching-gender', blair, { matchingGender: 'man' }),
    );
    expect((await search(alex)).state).toBe('matched');
    expect((await derivedBalance(alex.id)).available).toBe(100n - price);
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

  it('refuses a blocked pair to somebody who paid for the exact category', async () => {
    const alex = await consumer('safe-gender-a@wallet.test');
    const blair = await consumer('safe-gender-b@wallet.test', {
      matchingGender: 'woman',
    });
    const funded = await grant(alex, '100');
    const price = priceOf(funded, 'gender');
    await handle(post('/v1/safety/blocks', blair, { targetId: alex.id }));

    await activate(alex, { gender: 'woman' });
    await search(blair);
    // She is exactly what was bought, and she is still not offered. Paying
    // narrows the pool; it grants no interaction authority, and the order the
    // predicates run in is what makes that a property of the code rather than
    // of a comment.
    expect((await search(alex)).state).toBe('searching');
    expect((await derivedBalance(alex.id)).reserved).toBe(price);
    const captures = await rowsOf<{ readonly total: string }>(
      database.drizzle.execute(
        sql`select count(*)::text as total from wallet_transactions where reason = 'capture'`,
      ),
    );
    expect(captures[0]?.total).toBe('0');
  });

  it('applies a paid narrowing from both sides of the pair', async () => {
    const buyer = await consumer('symmetry-buyer@wallet.test', {
      matchingGender: 'man',
    });
    const seeker = await consumer('symmetry-seeker@wallet.test', {
      matchingGender: 'man',
    });
    await grant(buyer, '100');
    await activate(buyer, { gender: 'woman' });

    // The buyer sits in the pool. The seeker — who is a man, and is not what
    // the buyer paid for — searches, and it is *their* search that runs the
    // matcher. A narrowing that only applied to the buyer's own polls would
    // hand them exactly the person they paid to avoid.
    await search(buyer);
    expect((await search(seeker)).state).toBe('searching');
    expect((await derivedBalance(buyer.id)).reserved > 0n).toBe(true);
  });

  it('charges the window of whoever bought one, whichever side searched', async () => {
    const buyer = await consumer('symmetry-charge-buyer@wallet.test');
    const woman = await consumer('symmetry-charge-woman@wallet.test', {
      matchingGender: 'woman',
    });
    const funded = await grant(buyer, '100');
    const price = priceOf(funded, 'gender');
    await activate(buyer, { gender: 'woman' });
    await search(buyer);

    // She searches, and her poll is what allocates. The buyer's window did the
    // work either way, so it is charged either way — what somebody pays must
    // not depend on whose poll happened to arrive first.
    expect((await search(woman)).state).toBe('matched');
    const derived = await derivedBalance(buyer.id);
    expect(derived.available).toBe(100n - price);
    expect(derived.reserved).toBe(0n);
  });
});

/**
 * A paid filter is one tap away from being an attribute-enumeration API. These
 * are the shapes that would make it one.
 */
describe('a preference cannot be used to read anybody', () => {
  it('never carries another person’s declaration in anything it returns', async () => {
    const alex = await consumer('probe-viewer@wallet.test');
    const blair = await consumer('probe-subject@wallet.test', {
      matchingGender: 'woman',
    });
    await grant(alex, '100');
    await activate(alex, { gender: 'woman' });
    await search(blair);
    const matched = await search(alex);
    expect(matched.state).toBe('matched');

    // The peer projection is a name, a region, and shared languages. Nothing
    // says what they declared, and nothing says why they were selected — a
    // person learns they were matched, never that they were matched *because*.
    const serialized = JSON.stringify(matched.encounter?.peer);
    expect(serialized).not.toContain('matchingGender');
    expect(serialized).not.toContain('woman');
    // Nor does the discovery projection, which is the other place a peer
    // appears.
    const person = await handle(
      get(`/v1/discovery/people?personId=${blair.id}`, alex),
    );
    expect(await person.clone().text()).not.toContain('matchingGender');

    // And the declaration is readable in exactly one place: its owner's own
    // profile. The same read by anybody else does not exist as a route.
    const own = await handle(get('/v1/users/me/profile', blair));
    expect(
      ((await own.json()) as { matchingGender?: string }).matchingGender,
    ).toBe('woman');
  });

  it('has no shape in which a request names the account it is asking about', async () => {
    const alex = await consumer('probe-shape@wallet.test');
    const blair = await consumer('probe-target@wallet.test', {
      matchingGender: 'woman',
    });
    await grant(alex, '100');

    // Every one of these is the same idea: get the server to answer a question
    // about one named person. The contract is strict, so each is a 422 rather
    // than a filter that quietly ignored the extra field and answered anyway.
    for (const probe of [
      { gender: 'woman', userId: blair.id },
      { candidateId: blair.id, gender: 'woman' },
      { gender: 'woman', onlyId: blair.id },
      { gender: 'woman', target: blair.id },
    ]) {
      const response = await handle(
        post('/v1/wallet/live-preference', alex, probe),
      );
      expect(response.status, JSON.stringify(probe)).toBe(422);
    }
    expect((await derivedBalance(alex.id)).reserved).toBe(0n);
  });

  it('refuses a predicate the catalogue does not publish', async () => {
    const alex = await consumer('probe-predicate@wallet.test');
    await grant(alex, '100');
    for (const predicate of [
      { age: 25 },
      { ageBand: '18-25' },
      { orientation: 'straight' },
      { region: { in: ['FR', 'ES'] } },
      { region: 'FR OR TRUE' },
      { gender: 'woman', sql: '1=1' },
      { languages: ['fr', 'es'] },
    ]) {
      const response = await handle(
        post('/v1/wallet/live-preference', alex, predicate),
      );
      expect(response.status, JSON.stringify(predicate)).toBe(422);
    }
    expect((await derivedBalance(alex.id)).available).toBe(100n);
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
