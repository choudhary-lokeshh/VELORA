import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import type {
  LiveMessageListResponse,
  LiveStateResponse,
} from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createLiveRuntime } from '../../src/live/composition.js';
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
 * Random live discovery, end to end, through the routes a browser calls.
 *
 * The whole loop is here because the whole loop is the feature: a stranger, a
 * live session, words exchanged, two independent decisions to connect, one
 * durable conversation, and messaging that outlives the encounter. Testing the
 * halves separately would prove every half and none of the join.
 *
 * Nothing is stubbed that a person would meet. Accounts are created and
 * onboarded through the real routes, blocks are placed through the real safety
 * route, the matcher is the real matcher, and the introduction that a Connect
 * produces is DISCOVERY's own — which is what makes the assertion "exactly one
 * conversation" meaningful rather than a statement about a fixture.
 */

const databaseUrl = await provisionDatabase('velora_live');
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

async function readState(caller: Credentials): Promise<LiveStateResponse> {
  const response = await handle(get('/v1/live/sessions', caller));
  expect(response.status).toBe(200);
  return (await response.json()) as LiveStateResponse;
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

describe('entering live discovery', () => {
  it('admits an onboarded account and puts it in the pool', async () => {
    const alex = await consumer('alex@live.test');
    const state = await search(alex);
    expect(state.admission).toBe('eligible');
    expect(state.state).toBe('searching');
    expect(state.encounter).toBeUndefined();
    // No count of anybody. There is no presence projection behind this product,
    // so a number here would be one the platform invented.
    expect(Object.keys(state)).not.toContain('waiting');
    expect(Object.keys(state)).not.toContain('online');
  });

  it('refuses an account that has not finished onboarding', async () => {
    // Signed in and account-created, and nothing else: no adult declaration, no
    // policies, no profile. The most exposing surface in the product must be the
    // last one an unfinished account reaches, not the first.
    const signIn = await handle(
      new Request('http://api.test/v1/auth/local/web-sessions', {
        body: JSON.stringify({
          audience: 'consumer_web',
          subject: 'unfinished@live.test',
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
    const unfinished: Credentials = {
      cookie,
      csrf: session.csrfToken,
      id: account.id,
    };

    const response = await handle(
      post('/v1/live/sessions', unfinished, { medium: 'video' }),
    );
    expect(response.status).toBe(409);
    const state = await readState(unfinished);
    expect(state.admission).toBe('not_eligible');
    expect(state.state).toBe('idle');
  });

  it('is idempotent: searching twice does not open a second search', async () => {
    const alex = await consumer('alex@live.test');
    await search(alex);
    await search(alex);
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from live_participations
        where user_id = ${alex.id} and state <> 'left'`,
    );
    expect(rows[0]?.count).toBe('1');
  });
});

describe('matching two strangers', () => {
  it('allocates one encounter and gives both sides the same one', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);

    expect(matched.encounter?.peer.id).toBe(alex.id);
    const other = await readState(alex);
    expect(other.state).toBe('matched');
    expect(other.encounter?.id).toBe(matched.encounter?.id);
    expect(other.encounter?.peer.id).toBe(remi.id);

    const encounters = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from live_encounters where state = 'live'`,
    );
    expect(encounters[0]?.count).toBe('1');
  });

  it('opens exactly one live RTC session for the encounter', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);

    expect(matched.encounter?.call).toBeDefined();
    const sessions = await rowsOf<{
      count: string;
      purpose: string;
    }>(
      database.sql`select count(*)::text as count, min(purpose) as purpose
        from realtime_sessions where live_encounter_id is not null`,
    );
    expect(sessions[0]?.count).toBe('1');
    expect(sessions[0]?.purpose).toBe('live_discovery');
    // A random session carries no introduction, and the database refuses one
    // that does. That constraint is what stops a few minutes of live discovery
    // being recorded as a standing relationship.
    const introductions = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions
        where purpose = 'live_discovery' and origin_introduction_id is not null`,
    );
    expect(introductions[0]?.count).toBe('0');
  });

  it('cannot put one account into two encounters at once', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const sam = await consumer('sam@live.test');
    await meet(alex, remi);

    // Sam arrives while the other two are already talking. Neither of them is
    // available, so Sam waits — the partial unique index over a live
    // participation is what guarantees it rather than a check somebody wrote.
    const waiting = await search(sam);
    expect(waiting.state).toBe('searching');
    const encounters = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from live_encounters where state = 'live'`,
    );
    expect(encounters[0]?.count).toBe('1');
  });

  it('never matches a blocked pair', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const blocked = await handle(
      post('/v1/safety/blocks', alex, { targetId: remi.id }),
    );
    expect(blocked.status).toBe(200);

    await search(alex);
    const attempted = await search(remi);
    expect(attempted.state).toBe('searching');
    const encounters = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from live_encounters`,
    );
    expect(encounters[0]?.count).toBe('0');
  });

  it('does not hand back the person somebody just moved on from', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    const advanced = await handle(
      post('/v1/live/transitions', remi, { encounterId }),
    );
    expect(advanced.status).toBe(200);

    // Alex is still there and is the only other person in the world. Rematching
    // immediately is what makes random discovery feel broken, so the pair is
    // suppressed and Remi waits instead.
    const again = await search(remi);
    expect(again.state).toBe('searching');
  });
});

describe('inside an encounter', () => {
  it('exchanges live messages that never reach the Inbox', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    const sent = await handle(
      post('/v1/live/messages', remi, {
        body: 'hello from the other side',
        clientMessageId: 'client-message-one',
        encounterId,
      }),
    );
    expect(sent.status).toBe(200);
    const list = (await sent.json()) as LiveMessageListResponse;
    expect(list.messages).toHaveLength(1);
    expect(list.messages[0]?.self).toBe(true);

    const seen = await handle(
      get(`/v1/live/messages?encounterId=${encounterId}`, alex),
    );
    const theirs = (await seen.json()) as LiveMessageListResponse;
    expect(theirs.messages[0]?.body).toBe('hello from the other side');
    // Read from the other side, the same message is not theirs.
    expect(theirs.messages[0]?.self).toBe(false);

    // The whole product rule, asserted where it can actually be broken: a
    // temporary meeting leaves nothing in either Inbox.
    const conversations = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from messaging_conversations`,
    );
    expect(conversations[0]?.count).toBe('0');
    const messages = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from messaging_messages`,
    );
    expect(messages[0]?.count).toBe('0');
  });

  it('writes one message for a repeated client identifier', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    for (const attempt of [1, 2, 3]) {
      void attempt;
      const response = await handle(
        post('/v1/live/messages', remi, {
          body: 'said once',
          clientMessageId: 'retried-key',
          encounterId,
        }),
      );
      expect(response.status).toBe(200);
    }
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from live_messages`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('refuses a message into somebody else’s encounter', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const outsider = await consumer('outsider@live.test');
    const matched = await meet(alex, remi);

    const response = await handle(
      post('/v1/live/messages', outsider, {
        body: 'let me in',
        clientMessageId: 'outsider-key',
        encounterId: matched.encounter?.id ?? '',
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('connecting', () => {
  it('is one-sided until the other person asks too', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    const first = await handle(
      post('/v1/live/connections', remi, { encounterId }),
    );
    expect(first.status).toBe(200);
    const asked = (await first.json()) as {
      connection: { conversationId?: string; state: string };
    };
    expect(asked.connection.state).toBe('requested');
    expect(asked.connection.conversationId).toBeUndefined();

    // From the other side it reads as somebody having asked, which is a fact
    // about the caller's own inbox rather than a disclosure about anybody.
    const theirs = await readState(alex);
    expect(theirs.encounter?.connection.state).toBe('received');

    // Nothing durable exists yet. One tap is not a relationship.
    const conversations = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from messaging_conversations`,
    );
    expect(conversations[0]?.count).toBe('0');
  });

  it('creates exactly one relationship and one conversation on mutual interest', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    await handle(post('/v1/live/connections', remi, { encounterId }));
    const second = await handle(
      post('/v1/live/connections', alex, { encounterId }),
    );
    expect(second.status).toBe(200);
    const connected = (await second.json()) as {
      connection: { conversationId?: string; state: string };
    };
    expect(connected.connection.state).toBe('connected');
    expect(connected.connection.conversationId).toBeDefined();

    const introductions = await rowsOf<{ count: string; state: string }>(
      database.sql`select count(*)::text as count, min(state) as state
        from discovery_introductions`,
    );
    expect(introductions[0]?.count).toBe('1');
    expect(introductions[0]?.state).toBe('mutual');

    const conversations = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from messaging_conversations`,
    );
    expect(conversations[0]?.count).toBe('1');
  });

  it('leaves the conversation in both inboxes after the encounter ends', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    await handle(post('/v1/live/connections', remi, { encounterId }));
    const connected = (await (
      await handle(post('/v1/live/connections', alex, { encounterId }))
    ).json()) as { connection: { conversationId: string } };

    // Remi moves on. The relationship is the thing that survives.
    await handle(post('/v1/live/transitions', remi, { encounterId }));

    for (const person of [alex, remi]) {
      const inbox = await handle(get('/v1/messaging/conversations', person));
      expect(inbox.status).toBe(200);
      const body = (await inbox.json()) as {
        conversations: { id: string }[];
      };
      expect(body.conversations).toHaveLength(1);
      expect(body.conversations[0]?.id).toBe(
        connected.connection.conversationId,
      );
    }

    // And messaging works after the encounter is over, which is the point of
    // the whole loop: stranger, live interaction, mutual connection, durable
    // relationship, ongoing conversation.
    const sent = await handle(
      post('/v1/messaging/messages', alex, {
        body: 'good to meet you properly',
        clientMessageId: 'after-live-one',
        conversationId: connected.connection.conversationId,
      }),
    );
    expect(sent.status).toBe(200);
  });

  it('refuses a connect into an encounter that has already ended', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    await handle(post('/v1/live/transitions', remi, { encounterId }));
    const late = await handle(
      post('/v1/live/connections', alex, { encounterId }),
    );
    expect(late.status).toBe(404);
  });
});

describe('moving on and stopping', () => {
  it('ends the session before the next encounter begins', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';
    const callId = matched.encounter?.call?.id ?? '';
    expect(callId).not.toBe('');

    await handle(post('/v1/live/transitions', remi, { encounterId }));

    const sessions = await rowsOf<{ end_reason: string; state: string }>(
      database.sql`select state, end_reason from realtime_sessions where id = ${callId}::uuid`,
    );
    expect(sessions[0]?.state).toBe('ended');
    // Not `hung_up`. Nobody hung up: the encounter the session existed for is
    // over, and recording a decision nobody took would be a lie in a row an
    // operator later reads.
    expect(sessions[0]?.end_reason).toBe('encounter_ended');

    const encounters = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from live_encounters where state = 'live'`,
    );
    expect(encounters[0]?.count).toBe('0');
  });

  it('tells the person who was left that they were left', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    await handle(post('/v1/live/transitions', remi, { encounterId }));

    const left = await readState(alex);
    expect(left.state).toBe('ended');
    expect(left.encounter?.endReason).toBe('peer_left');

    const mover = await readState(remi);
    // The person who pressed Next has already said what they want next, so
    // they are searching rather than being asked again.
    expect(mover.state).toBe('searching');
  });

  it('lets the person who was left meet somebody else', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const sam = await consumer('sam@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    // Remi moves on, and then leaves entirely — otherwise Remi is back in the
    // pool and is who Sam meets, which would leave this test asserting the
    // matcher's ordering rather than the thing it is about.
    await handle(post('/v1/live/transitions', remi, { encounterId }));
    await handle(post('/v1/live/departures', remi));
    expect((await readState(alex)).state).toBe('ended');

    // Alex asks to meet somebody else, which is the whole meaning of the
    // control. Without a resume this searched for ever: the matcher chose a
    // partner and then lost to the `searching` guard on every attempt, and
    // Alex was told "still searching" while partners were quietly discarded.
    await search(sam);
    const again = await search(alex);
    expect(again.state).toBe('matched');
    expect(again.encounter?.peer.id).toBe(sam.id);
  });

  it('answers a repeated Next with current state rather than an error', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const encounterId = matched.encounter?.id ?? '';

    const first = await handle(
      post('/v1/live/transitions', remi, { encounterId }),
    );
    const second = await handle(
      post('/v1/live/transitions', remi, { encounterId }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('cannot end the encounter that replaced the one it names', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const sam = await consumer('sam@live.test');
    const first = await meet(alex, remi);
    const staleEncounterId = first.encounter?.id ?? '';

    await handle(
      post('/v1/live/transitions', remi, { encounterId: staleEncounterId }),
    );
    // Remi meets Sam. Alex's client, which has been offline, now sends the Next
    // it queued for the encounter that is already over.
    await search(sam);
    const second = await search(remi);
    expect(second.state).toBe('matched');
    expect(second.encounter?.id).not.toBe(staleEncounterId);

    const stale = await handle(
      post('/v1/live/transitions', remi, { encounterId: staleEncounterId }),
    );
    expect(stale.status).toBe(200);
    const after = await readState(remi);
    expect(after.state).toBe('matched');
    expect(after.encounter?.id).toBe(second.encounter?.id);
  });

  it('leaves the pool entirely, and stops the session with it', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const callId = matched.encounter?.call?.id ?? '';

    const left = await handle(post('/v1/live/departures', remi));
    expect(left.status).toBe(200);
    const state = (await left.json()) as LiveStateResponse;
    expect(state.state).toBe('idle');

    const sessions = await rowsOf<{ state: string }>(
      database.sql`select state from realtime_sessions where id = ${callId}::uuid`,
    );
    expect(sessions[0]?.state).toBe('ended');

    const participations = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from live_participations
        where user_id = ${remi.id} and state <> 'left'`,
    );
    expect(participations[0]?.count).toBe('0');
  });
});

/** A bounded wait, for racing against an interleaving that may not arrive. */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * A promise something else opens, for holding two requests inside one call.
 *
 * Written out rather than reached for with a bare `let`, so nothing here is an
 * empty function waiting to be replaced.
 */
function gate(): { readonly open: () => void; readonly passed: Promise<void> } {
  let release: (() => void) | undefined;
  const passed = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    open: () => {
      release?.();
    },
    passed,
  };
}

describe('the session a match publishes', () => {
  it('reaches the provider before the encounter names the session', async () => {
    // The ordering, observed from inside the provider call rather than inferred
    // from the rows afterwards. A room is created exactly once per encounter,
    // and at that instant the encounter must still name no session: an
    // identifier published before the room exists is one both clients can read
    // and neither can join.
    const provider = realtime.provider;
    const original = provider.createSession.bind(provider);
    const boundWhenReached: (string | null)[] = [];
    provider.createSession = async (request) => {
      const rows = await rowsOf<{ realtime_session_id: string | null }>(
        database.sql`select realtime_session_id from live_encounters`,
      );
      boundWhenReached.push(rows[0]?.realtime_session_id ?? null);
      return original(request);
    };

    try {
      const alex = await consumer('alex@live.test');
      const remi = await consumer('remi@live.test');
      await meet(alex, remi);
    } finally {
      provider.createSession = original;
    }

    expect(boundWhenReached).toEqual([null]);
  });

  it('publishes a call both people can join the moment they are matched', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const callId = matched.encounter?.call?.id ?? '';
    expect(callId).not.toBe('');

    // The person who did not trigger the match reads the encounter separately,
    // which is what a browser polling beside the matcher actually does. Both
    // reads name the same session and both are joinable — the defect this
    // guards was that the first of them named a session with no room, and was
    // refused.
    const waiting = await readState(alex);
    expect(waiting.encounter?.call?.id).toBe(callId);

    for (const caller of [alex, remi]) {
      const authorized = await handle(
        post('/v1/rtc/calls/join-authorization', caller, { callId }),
      );
      expect(authorized.status).toBe(200);
    }
  });

  it('survives the other person polling while the provider is being reached', async () => {
    // Both browsers poll, and a poll by somebody already matched does the same
    // session work as the request that allocated the encounter — so two runs
    // for one encounter overlap as a matter of course. They are held inside the
    // provider call here so the overlap is certain rather than lucky.
    //
    // The loser of the bind holds the same session as the winner, because one
    // encounter has one session by construction. Ending it there tore down a
    // call the other person had already joined: against a real provider one
    // browser was connected and publishing while the other's poll ended the
    // session underneath it, and every credential afterwards was correctly
    // refused for a call that no longer existed.
    const provider = realtime.provider;
    const original = provider.createSession.bind(provider);
    const first = gate();
    const both = gate();
    const held = gate();
    let entered = 0;
    provider.createSession = async (request) => {
      entered += 1;
      if (entered === 1) first.open();
      if (entered >= 2) both.open();
      await held.passed;
      return original(request);
    };

    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    let matched: LiveStateResponse;
    let polled: LiveStateResponse;
    try {
      await search(alex);
      const allocating = search(remi);
      await first.passed;
      const polling = search(alex);
      // Both inside the provider call is the tightest interleaving, and it is
      // not the only one worth surviving. Waited for rather than assumed, and
      // bounded: if the second request took a different path it still polled
      // while the first was held, which is the window under test, and a proof
      // must not hang waiting for a stronger version of a race it already has.
      await Promise.race([both.passed, delay(2000)]);
      held.open();
      [polled, matched] = await Promise.all([polling, allocating]);
    } finally {
      provider.createSession = original;
    }

    const callId = matched.encounter?.call?.id ?? '';
    expect(callId).not.toBe('');
    expect(polled.encounter?.call?.id).toBe(callId);

    // The session both of them were handed is still the session both of them
    // can join. Read from the row rather than from a view, because "ended" was
    // the exact durable state the defect produced.
    const sessions = await rowsOf<{ end_reason: string | null; state: string }>(
      database.sql`select state, end_reason from realtime_sessions where id = ${callId}::uuid`,
    );
    expect(sessions[0]?.state).not.toBe('ended');
    expect(sessions[0]?.end_reason).toBeNull();

    for (const caller of [alex, remi]) {
      const authorized = await handle(
        post('/v1/rtc/calls/join-authorization', caller, { callId }),
      );
      expect(authorized.status).toBe(200);
    }
  });

  it('answers a session with no room yet apart from a refusal', async () => {
    // The remainder the ordering above cannot remove: a create the provider
    // left unresolved, which reconciliation owns and completes later. The
    // session is real, both people are in it, and there is no room yet — and
    // the answer has to say "not yet" rather than "not permitted", because a
    // client treats the second as final and would never ask again.
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const callId = matched.encounter?.call?.id ?? '';

    // Back to exactly the state `establishProviderSession` leaves behind when
    // the provider does not answer: accepted, reserved under an idempotency
    // key, and holding no reference. The reference and the instant it was bound
    // are cleared together because the table refuses either without the other.
    await database.sql`update realtime_sessions
      set state = 'accepted',
          provider_reference = null,
          provider_bound_at = null,
          connected_at = null
      where id = ${callId}::uuid`;

    const authorized = await handle(
      post('/v1/rtc/calls/join-authorization', alex, { callId }),
    );
    expect(authorized.status).toBe(409);
    const body = (await authorized.json()) as { code: string };
    expect(body.code).toBe('STATE_CONFLICT');
  });

  it('still refuses somebody who may not join a session with no room', async () => {
    // The ordering inside the issuance, which is what keeps the softer answer
    // from being a disclosure. A blocked pair is refused for being blocked, not
    // told that a room is on its way.
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const callId = matched.encounter?.call?.id ?? '';

    // The block first, because it ends the encounter and the session with it.
    // The session is then put back into the exact state a provider that has not
    // answered leaves behind, so the issuance below reaches a live session with
    // no room whose encounter is gone. Eligibility refuses it — the encounter
    // that authorized it no longer exists — and that refusal has to win over
    // the softer "not yet", which is the ordering under test.
    await handle(post('/v1/safety/blocks', remi, { targetId: alex.id }));
    await database.sql`update realtime_sessions
      set state = 'accepted',
          provider_reference = null,
          provider_bound_at = null,
          connected_at = null,
          ended_at = null,
          end_reason = null
      where id = ${callId}::uuid`;

    const authorized = await handle(
      post('/v1/rtc/calls/join-authorization', alex, { callId }),
    );
    expect(authorized.status).toBe(409);
    const body = (await authorized.json()) as { code: string };
    expect(body.code).toBe('ACTION_NOT_PERMITTED');
  });
});

describe('safety inside a live encounter', () => {
  it('ends the encounter and the session the moment a block lands', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const callId = matched.encounter?.call?.id ?? '';

    const blocked = await handle(
      post('/v1/safety/blocks', remi, { targetId: alex.id }),
    );
    expect(blocked.status).toBe(200);

    const encounters = await rowsOf<{ end_reason: string; state: string }>(
      database.sql`select state, end_reason from live_encounters`,
    );
    expect(encounters[0]?.state).toBe('ended');
    expect(encounters[0]?.end_reason).toBe('safety_block');

    const sessions = await rowsOf<{ state: string }>(
      database.sql`select state from realtime_sessions where id = ${callId}::uuid`,
    );
    expect(sessions[0]?.state).toBe('ended');
  });

  it('never tells the blocked person that they were blocked', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    await meet(alex, remi);
    await handle(post('/v1/safety/blocks', remi, { targetId: alex.id }));

    const seen = await readState(alex);
    expect(seen.state).toBe('ended');
    // The disclosable vocabulary and nothing finer. `safety_block` stays inside
    // the platform, where an operator can see it, and never reaches the person
    // it was taken about.
    expect(seen.encounter?.endReason).toBe('ended_by_platform');
  });

  it('refuses a join credential the instant the encounter is over', async () => {
    const alex = await consumer('alex@live.test');
    const remi = await consumer('remi@live.test');
    const matched = await meet(alex, remi);
    const callId = matched.encounter?.call?.id ?? '';
    const encounterId = matched.encounter?.id ?? '';

    await handle(post('/v1/live/transitions', remi, { encounterId }));

    // The encounter is the only thing that authorized this session, so its
    // ending is what refuses the reconnect a client is already attempting.
    const authorized = await handle(
      post('/v1/rtc/calls/join-authorization', alex, { callId }),
    );
    expect(authorized.status).toBe(409);
  });
});

describe('when live discovery is switched off', () => {
  it('admits nobody and says so', async () => {
    // A second application over the same database with the product gate at its
    // default. Nothing else changes, which is the point: the refusal is
    // configuration, not a missing implementation.
    const offConfig = testServerConfig({
      MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
      ...mediaEnvironment,
    });
    const offLive = createLiveRuntime({
      accounts: users.service,
      admission: users.onboarding,
      config: offConfig,
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
      realtime: realtime.liveSessions,
      safety: safety.directory,
      standing: users.standing,
    });
    // No simulation adapter is composed when the configuration does not name
    // one, which is what makes the stand-in unreachable rather than merely
    // unused.
    expect(offLive.simulator).toBeUndefined();

    const alex = await consumer('alex@live.test');
    const account = await users.service.findAccountById(alex.id);
    expect(account).toBeDefined();
    if (account === undefined) return;
    const outcome = await offLive.service.search(account, 'video');
    expect(outcome.kind).toBe('unavailable');
    const state = await offLive.service.read(account);
    expect(state.admission).toBe('unavailable');
  });

  it('refuses the configuration outright in a deployed environment', () => {
    // The structural guarantee. It is not that staging is expected to leave the
    // value alone; it is that the process refuses to start if it does not.
    expect(() =>
      testServerConfig({ APP_ENV: 'staging', LIVE_DISCOVERY_MODE: 'open' }),
    ).toThrow();
    expect(() =>
      testServerConfig({
        APP_ENV: 'production',
        LIVE_DISCOVERY_SIMULATION: 'local-test',
      }),
    ).toThrow();
  });
});
