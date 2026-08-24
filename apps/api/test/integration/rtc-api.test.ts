import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { apiRoutePaths } from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
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
  testAdminRuntime,
  testBillingRuntime,
  testClubsRuntime,
  testConsumerOrigin,
  testCreatorsRuntime,
  testDatabaseAdmission,
  testForeignOrigin,
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

const databaseUrl = await provisionDatabase('velora_rtc_api');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
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
      return `rtc-api-test-${String(requesterSequence)}`;
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
const realtime = createRealtimeRuntime({
  config,
  connections: discovery.connections,
  consumerContext: users.consumerContext,
  database: database.drizzle,
  directory: users.directory,
  enforcement: safety.eligibility,
  logger,
  now,
  onboarding: users.onboarding,
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

async function consumer(subject: string): Promise<Credentials> {
  const signIn = await handle(
    new Request(`http://api.test${apiRoutePaths.localWebSession}`, {
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
    new Request(`http://api.test${apiRoutePaths.consumerAccount}`, {
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
    post(apiRoutePaths.consumerAdultDeclaration, caller, {
      declaresAdult: true,
      region: 'ES',
    }),
  );
  await handle(
    post(apiRoutePaths.consumerPolicyAcknowledgements, caller, {
      acknowledgements: requiredPolicyDocuments.map((document) => ({
        key: document.key,
        version: document.version,
      })),
    }),
  );
  await handle(
    post(apiRoutePaths.consumerProfile, caller, {
      displayName: subject.split('@')[0] ?? 'Consumer',
      languages: ['es'],
    }),
  );
  const upload = await handle(
    post(apiRoutePaths.consumerProfileMedia, caller, {}),
  );
  const media = (await upload.json()) as { mediaId: string };
  await readyProfileImage({
    database,
    media: mediaRuntime,
    slotId: media.mediaId,
    users,
  });
  await handle(
    post(apiRoutePaths.consumerPreferences, caller, { discoverable: true }),
  );
  await handle(
    post(apiRoutePaths.consumerAvailability, caller, {
      availableUntil: new Date(now().getTime() + 3_600_000).toISOString(),
      state: 'available',
    }),
  );
  return caller;
}

async function introducedPair(): Promise<{
  readonly a: Credentials;
  readonly b: Credentials;
  readonly introductionId: string;
}> {
  const a = await consumer('api-caller@rtc.test');
  const b = await consumer('api-recipient@rtc.test');
  await handle(
    post(apiRoutePaths.discoveryIntroductions, a, { candidateId: b.id }),
  );
  const mutual = await handle(
    post(apiRoutePaths.discoveryIntroductions, b, { candidateId: a.id }),
  );
  const introduction = (await mutual.json()) as { id: string };
  return { a, b, introductionId: introduction.id };
}

interface CallBody {
  readonly counterpart: { readonly displayName: string; readonly id: string };
  readonly endReason?: string;
  readonly id: string;
  readonly role: string;
  readonly state: string;
}

async function placeCall(
  pair: Awaited<ReturnType<typeof introducedPair>>,
): Promise<CallBody> {
  const response = await handle(
    post(apiRoutePaths.rtcCalls, pair.a, {
      introductionId: pair.introductionId,
      medium: 'video',
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as CallBody;
}

/** An error body with the per-request correlation identifier removed. */
function withoutCorrelation(body: unknown): unknown {
  const record = { ...(body as Record<string, unknown>) };
  delete record.correlationId;
  return record;
}

describe('the call-control surface', () => {
  it('places, answers, and ends a call over HTTP', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);
    expect(call.state).toBe('invited');
    expect(call.role).toBe('caller');
    expect(call.counterpart.id).toBe(pair.b.id);

    const accepted = await handle(
      post(apiRoutePaths.rtcCallAcceptance, pair.b, { callId: call.id }),
    );
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as CallBody).state).toBe('accepted');

    const ended = await handle(
      post(apiRoutePaths.rtcCallTermination, pair.a, { callId: call.id }),
    );
    expect(ended.status).toBe(200);
    const body = (await ended.json()) as CallBody;
    expect(body.state).toBe('ended');
    expect(body.endReason).toBe('hung_up');
  });

  it('reads a call the caller is part of', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);
    const read = await handle(
      new Request(
        `http://api.test${apiRoutePaths.rtcCalls}?callId=${call.id}`,
        { headers: { cookie: pair.b.cookie, origin: testConsumerOrigin } },
      ),
    );
    expect(read.status).toBe(200);
    // The same call, seen from the other side.
    expect(((await read.json()) as CallBody).role).toBe('recipient');
  });

  it('issues a join credential only after the call is answered', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);

    const tooEarly = await handle(
      post(apiRoutePaths.rtcCallJoinAuthorization, pair.a, { callId: call.id }),
    );
    expect(tooEarly.status).toBe(409);

    await handle(
      post(apiRoutePaths.rtcCallAcceptance, pair.b, { callId: call.id }),
    );
    await realtime.service.establishProviderSession(call.id);

    const issued = await handle(
      post(apiRoutePaths.rtcCallJoinAuthorization, pair.a, { callId: call.id }),
    );
    expect(issued.status).toBe(200);
    const grant = (await issued.json()) as {
      callId: string;
      credential: string;
      expiresAt: string;
    };
    expect(grant.callId).toBe(call.id);
    expect(grant.credential.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(grant.credential);
  });
});

describe('a request can never name a participant', () => {
  it('publishes no field that could', async () => {
    const pair = await introducedPair();
    // The strict contract refuses anything beyond the introduction and medium,
    // so there is no shape in which a caller supplies a counterpart.
    const attempt = await handle(
      post(apiRoutePaths.rtcCalls, pair.a, {
        introductionId: pair.introductionId,
        medium: 'video',
        recipientId: pair.b.id,
      }),
    );
    expect(attempt.status).toBe(422);
  });

  it('refuses an introduction the caller is not part of', async () => {
    const pair = await introducedPair();
    const outsider = await consumer('api-outsider@rtc.test');
    const attempt = await handle(
      post(apiRoutePaths.rtcCalls, outsider, {
        introductionId: pair.introductionId,
        medium: 'voice',
      }),
    );
    // Indistinguishable from an introduction that does not exist.
    expect(attempt.status).toBe(404);
  });
});

describe('every RTC route refuses an unauthorized caller the same way', () => {
  const paths = [
    apiRoutePaths.rtcCalls,
    apiRoutePaths.rtcCallAcceptance,
    apiRoutePaths.rtcCallRejection,
    apiRoutePaths.rtcCallCancellation,
    apiRoutePaths.rtcCallTermination,
    apiRoutePaths.rtcCallJoinAuthorization,
  ];

  it('refuses a caller with no session at all', async () => {
    for (const path of paths) {
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
      expect(response.status).toBe(401);
    }
  });

  it('refuses a credentialed request from a foreign origin', async () => {
    const pair = await introducedPair();
    for (const path of paths) {
      const response = await handle(
        new Request(`http://api.test${path}`, {
          body: '{}',
          headers: {
            'content-type': 'application/json',
            cookie: pair.a.cookie,
            origin: testForeignOrigin,
            'x-velora-csrf': pair.a.csrf,
          },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(403);
    }
  });

  it('refuses a state-changing cookie request with no CSRF evidence', async () => {
    const pair = await introducedPair();
    for (const path of paths) {
      const response = await handle(
        new Request(`http://api.test${path}`, {
          body: '{}',
          headers: {
            'content-type': 'application/json',
            cookie: pair.a.cookie,
            origin: testConsumerOrigin,
          },
          method: 'POST',
        }),
      );
      expect(response.status).toBe(403);
    }
  });
});

describe('a call between two other people cannot be reached or probed', () => {
  it('answers a stranger exactly as it answers a call that does not exist', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);
    const stranger = await consumer('api-stranger@rtc.test');

    for (const path of [
      apiRoutePaths.rtcCallAcceptance,
      apiRoutePaths.rtcCallRejection,
      apiRoutePaths.rtcCallCancellation,
      apiRoutePaths.rtcCallTermination,
      apiRoutePaths.rtcCallJoinAuthorization,
    ]) {
      const onSomebodyElses = await handle(
        post(path, stranger, { callId: call.id }),
      );
      const onNothing = await handle(
        post(path, stranger, { callId: crypto.randomUUID() }),
      );
      expect(onSomebodyElses.status).toBe(404);
      expect(onNothing.status).toBe(404);
      // Same status and same body once the per-request correlation identifier
      // is set aside: the shape of a refusal discloses nothing, so a caller
      // cannot tell a call that exists from one that does not.
      expect(withoutCorrelation(await onSomebodyElses.json())).toEqual(
        withoutCorrelation(await onNothing.json()),
      );
    }
  });
});

describe('a safety ending is never attributed to the other person', () => {
  it('reports a block as ended_by_platform rather than as a decline', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);
    await handle(
      post(apiRoutePaths.safetyBlocks, pair.b, { targetId: pair.a.id }),
    );
    // The acceptance re-composes eligibility, so the block ends the call.
    await handle(
      post(apiRoutePaths.rtcCallAcceptance, pair.b, { callId: call.id }),
    );

    const read = await handle(
      new Request(
        `http://api.test${apiRoutePaths.rtcCalls}?callId=${call.id}`,
        { headers: { cookie: pair.a.cookie, origin: testConsumerOrigin } },
      ),
    );
    const body = (await read.json()) as CallBody;
    expect(body.state).toBe('ended');
    // Internally `safety_block`; on the wire, never that.
    expect(body.endReason).toBe('ended_by_platform');

    const stored = await rowsOf<{ end_reason: string }>(
      database.sql`select end_reason from realtime_sessions where id = ${call.id}`,
    );
    expect(stored[0]?.end_reason).toBe('safety_block');
  });
});

describe('a duplicate invitation returns the live call', () => {
  it('opens one call however many times it is asked', async () => {
    const pair = await introducedPair();
    const first = await placeCall(pair);
    const second = await placeCall(pair);
    expect(second.id).toBe(first.id);

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions`,
    );
    expect(rows[0]?.count).toBe('1');
  });
});

describe('no transport detail reaches a client', () => {
  it('publishes no provider reference, address, or scope on a call', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);
    await handle(
      post(apiRoutePaths.rtcCallAcceptance, pair.b, { callId: call.id }),
    );
    await realtime.service.establishProviderSession(call.id);

    const read = await handle(
      new Request(
        `http://api.test${apiRoutePaths.rtcCalls}?callId=${call.id}`,
        { headers: { cookie: pair.a.cookie, origin: testConsumerOrigin } },
      ),
    );
    const text = await read.text();
    const stored = await rowsOf<{ provider_reference: string | null }>(
      database.sql`select provider_reference from realtime_sessions where id = ${call.id}`,
    );
    const reference = stored[0]?.provider_reference ?? 'absent';
    expect(reference).not.toBe('absent');
    // The room exists and the client is never told its name.
    expect(text).not.toContain(reference);
    for (const forbidden of ['sdp', 'iceServers', 'turn', 'candidate']) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('the database still holds the truth after an HTTP ending', () => {
  it('advances the authorization generation when a call ends over the API', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);
    await handle(
      post(apiRoutePaths.rtcCallRejection, pair.b, { callId: call.id }),
    );
    const rows = await rowsOf<{ generation: string; state: string }>(
      database.sql`select state, authorization_generation::text as generation
        from realtime_sessions where id = ${call.id}`,
    );
    expect(rows[0]?.state).toBe('rejected');
    expect(rows[0]?.generation).toBe('2');
  });

  it('treats a repeated hang-up as the same ending', async () => {
    const pair = await introducedPair();
    const call = await placeCall(pair);
    await handle(
      post(apiRoutePaths.rtcCallAcceptance, pair.b, { callId: call.id }),
    );
    const first = await handle(
      post(apiRoutePaths.rtcCallTermination, pair.a, { callId: call.id }),
    );
    const second = await handle(
      post(apiRoutePaths.rtcCallTermination, pair.b, { callId: call.id }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await execute(database.sql`select 1`);
  });
});
