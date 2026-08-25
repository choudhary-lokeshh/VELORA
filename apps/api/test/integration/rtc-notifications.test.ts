import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { OutboxRelay } from '../../src/events/relay.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createNotificationsRuntime } from '../../src/notifications/composition.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import {
  callInvitedEventName,
  callMissedEventName,
} from '../../src/realtime/events.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
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

const databaseUrl = await provisionDatabase('velora_rtc_notifications');
const database: TestDatabase = connectDatabase(databaseUrl);

const config = testServerConfig({
  REALTIME_CALL_ELIGIBILITY: 'composed',
  REALTIME_RTC_PROVIDER: 'local-test',
  ...mediaEnvironment,
});

let clockOffsetMilliseconds = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);
const logs: unknown[] = [];
const logger = silentLogger(logs);

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'rtc-notifications-test',
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
const realtime = createRealtimeRuntime({
  config,
  connections: discovery.connections,
  database: database.drizzle,
  eligibility: { mayCall: () => Promise.resolve(true) },
  logger,
  now,
  onboarding: users.onboarding,
});
const notifications = createNotificationsRuntime({
  config,
  database: database.drizzle,
  logger,
  now,
  safety: safety.directory,
  standing: users.standing,
});

/** One relay cycle over REALTIME's outbox, exactly as the worker composes it. */
const relay = new OutboxRelay({
  consumers: [...notifications.intakes],
  logger,
  now,
  owner: 'rtc-notifications-test',
  sources: [{ producer: 'realtime', repository: realtime.outbox }],
});

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};
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

/**
 * A consumer built through the real admission ladder.
 *
 * Seeding the rows by hand would skip the onboarding gate this domain asks
 * about, and a suite that skipped it could prove a notice for somebody
 * production would refuse to call at all.
 */
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
  const credentials: Credentials = {
    cookie,
    csrf: session.csrfToken,
    id: account.id,
  };

  await handle(
    post('/v1/users/me/onboarding/adult-declaration', credentials, {
      declaresAdult: true,
      region: 'ES',
    }),
  );
  await handle(
    post('/v1/users/me/onboarding/acknowledgements', credentials, {
      acknowledgements: requiredPolicyDocuments.map((document) => ({
        key: document.key,
        version: document.version,
      })),
    }),
  );
  await handle(
    post('/v1/users/me/profile', credentials, {
      displayName: subject.split('@')[0] ?? 'Consumer',
      languages: ['es'],
    }),
  );
  const upload = await handle(
    post('/v1/users/me/profile/media', credentials, {}),
  );
  const media = (await upload.json()) as { mediaId: string };
  await readyProfileImage({
    database,
    media: mediaRuntime,
    assetId: media.mediaId,
    users,
  });
  await handle(
    post('/v1/users/me/preferences', credentials, { discoverable: true }),
  );
  await handle(
    post('/v1/users/me/availability', credentials, {
      availableUntil: new Date(now().getTime() + 3_600_000).toISOString(),
      state: 'available',
    }),
  );
  return credentials;
}

let caller = '';
let recipient = '';

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  logs.length = 0;
  caller = '';
  recipient = '';
  await database.truncate();
});

/**
 * Two people who may call each other, built on demand.
 *
 * Lazy rather than in `beforeEach` because a test that only asserts a database
 * constraint has no use for a pair, and building one costs the whole admission
 * ladder.
 */
async function ensurePair(): Promise<void> {
  if (caller !== '') return;
  const a = await consumer('call-caller@rtc.test');
  const b = await consumer('call-recipient@rtc.test');
  caller = a.id;
  recipient = b.id;
  await handle(post('/v1/discovery/introductions', a, { candidateId: b.id }));
  await handle(post('/v1/discovery/introductions', b, { candidateId: a.id }));
}

/** A ringing call, placed through the service so the outbox fact is real. */
async function ringingCall(): Promise<string> {
  await ensurePair();
  const introductions = await rowsOf<{ id: string }>(
    database.sql`select id from discovery_introductions where state = 'mutual' limit 1`,
  );
  const introductionId = introductions[0]?.id;
  if (introductionId === undefined) throw new Error('no mutual introduction');
  const account = await users.repository.findById(
    users.repository.transactionless,
    caller,
  );
  if (account === undefined) throw new Error('no caller account');
  const outcome = await realtime.service.invite(account, {
    introductionId,
    medium: 'voice',
  });
  if (outcome.kind !== 'call') {
    throw new Error(`expected a call, got ${outcome.kind}`);
  }
  return outcome.view.id;
}

async function outboxRows(): Promise<
  { event_name: string; payload: unknown; state: string }[]
> {
  return rowsOf(
    database.sql`select event_name, payload, state from realtime_outbox order by sequence`,
  );
}

/**
 * The payload as a consumer sees it.
 *
 * `jsonb` holds it encoded, so a direct read gets a string where the relay's
 * consumers get an object. Reading it the same way they do keeps this suite
 * asserting the fact rather than the encoding.
 */
function payloadOf(
  row: { payload: unknown } | undefined,
): Record<string, unknown> {
  const raw = row?.payload;
  if (typeof raw === 'string') {
    return JSON.parse(raw) as Record<string, unknown>;
  }
  return (raw ?? {}) as Record<string, unknown>;
}

describe('a call is durable before anybody is told about it', () => {
  it('writes the invitation and its published fact in one transaction', async () => {
    const callId = await ringingCall();

    const sessions = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions where id = ${callId}`,
    );
    const events = await outboxRows();
    expect(sessions[0]?.count).toBe('1');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_name).toBe(callInvitedEventName);
    // Pending: the fact is committed and nothing has been told to anybody yet.
    expect(events[0]?.state).toBe('pending');
  });

  it('carries identifiers and nothing that could reach a lock screen', async () => {
    const callId = await ringingCall();
    const events = await outboxRows();
    const payload = payloadOf(events[0]);
    expect(payload.callId).toBe(callId);
    expect(payload.callerId).toBe(caller);
    expect(payload.recipientId).toBe(recipient);
    // No medium, no name, no provider reference, no credential, no reason.
    expect(Object.keys(payload).toSorted()).toEqual([
      'callId',
      'callerId',
      'recipientId',
    ]);
  });
});

describe('the relay turns a call fact into a notice the platform owes', () => {
  it('produces one incoming-call notice for the person being called', async () => {
    const callId = await ringingCall();
    const report = await relay.dispatchOnce();
    expect(report.dispatched).toBe(1);

    const feed = await rowsOf<{
      call_id: string;
      kind: string;
      recipient_id: string;
      subject_id: string;
    }>(
      database.sql`select call_id, kind, recipient_id, subject_id from notifications_feed`,
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]?.kind).toBe('call_incoming');
    // The person being called is told; the caller is not told about their own
    // call, and the line is about the other person.
    expect(feed[0]?.recipient_id).toBe(recipient);
    expect(feed[0]?.subject_id).toBe(caller);
    expect(feed[0]?.call_id).toBe(callId);
  });

  it('owes exactly one notice however many times the relay runs', async () => {
    await ringingCall();
    await relay.dispatchOnce();
    // A redelivery is the ordinary case for an at-least-once relay, and the
    // inbox key is what makes it harmless.
    await relay.dispatchOnce();

    const feed = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from notifications_feed`,
    );
    const intents = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from notifications_intents`,
    );
    expect(feed[0]?.count).toBe('1');
    expect(intents[0]?.count).toBe('1');
  });

  it('leaves the call untouched when nothing has drained the outbox', async () => {
    const callId = await ringingCall();
    // No relay cycle at all: the call still exists and is still ringing, which
    // is the property that makes a lost push cost a ring rather than a call.
    const state = await rowsOf<{ state: string }>(
      database.sql`select state from realtime_sessions where id = ${callId}`,
    );
    expect(state[0]?.state).toBe('invited');
    const feed = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from notifications_feed`,
    );
    expect(feed[0]?.count).toBe('0');
  });
});

describe('a missed call is derived from the lifecycle', () => {
  it('publishes exactly one missed fact when an invitation expires', async () => {
    const callId = await ringingCall();
    clockOffsetMilliseconds = 60_000;

    expect(await realtime.service.expireDueInvitations()).toBe(1);
    // A second sweep finds nothing, so no second missed fact is written.
    expect(await realtime.service.expireDueInvitations()).toBe(0);

    const events = await outboxRows();
    const missed = events.filter(
      (row) => row.event_name === callMissedEventName,
    );
    expect(missed).toHaveLength(1);
    expect(payloadOf(missed[0]).callId).toBe(callId);
  });

  it('tells the person who missed it, about the person who called', async () => {
    await ringingCall();
    clockOffsetMilliseconds = 60_000;
    await realtime.service.expireDueInvitations();
    await relay.dispatchOnce();

    const feed = await rowsOf<{
      kind: string;
      recipient_id: string;
      subject_id: string;
    }>(
      database.sql`select kind, recipient_id, subject_id from notifications_feed
        where kind = 'call_missed'`,
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]?.recipient_id).toBe(recipient);
    expect(feed[0]?.subject_id).toBe(caller);
  });

  it('records a missed call even when nobody was ever successfully told', async () => {
    await ringingCall();
    clockOffsetMilliseconds = 60_000;
    await realtime.service.expireDueInvitations();

    // The incoming notice was never drained, and the call is still missed.
    // "Missed" is a fact about the invitation's deadline, not about whether a
    // device rang.
    const sessions = await rowsOf<{ end_reason: string; state: string }>(
      database.sql`select state, end_reason from realtime_sessions`,
    );
    expect(sessions[0]?.state).toBe('expired');
    expect(sessions[0]?.end_reason).toBe('invitation_expired');
  });
});

describe('a producer may trigger only its own approved template', () => {
  it('refuses a call template claimed by another domain', async () => {
    await ringingCall();
    const impostor = new OutboxRelay({
      consumers: [...notifications.intakes],
      logger,
      now,
      owner: 'impostor',
      // The same rows, published under somebody else's name.
      sources: [{ producer: 'messaging', repository: realtime.outbox }],
    });
    const report = await impostor.dispatchOnce();
    expect(report.dispatched).toBe(0);

    const feed = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from notifications_feed`,
    );
    // No notice, and the fact is retained and retried rather than discarded.
    expect(feed[0]?.count).toBe('0');
  });
});

describe('the notice a call produces is openable and minimal', () => {
  it('carries a call target and neither of the other two', async () => {
    await ringingCall();
    await relay.dispatchOnce();
    const feed = await rowsOf<{
      call_id: string | null;
      conversation_id: string | null;
      introduction_id: string | null;
    }>(
      database.sql`select call_id, conversation_id, introduction_id from notifications_feed`,
    );
    expect(feed[0]?.call_id).not.toBeNull();
    expect(feed[0]?.conversation_id).toBeNull();
    expect(feed[0]?.introduction_id).toBeNull();
  });

  it('refuses a call notice with no call to open', async () => {
    // No pair needed: this is a database constraint, and the identifiers only
    // have to be distinct.
    const recipientId = crypto.randomUUID();
    const subjectId = crypto.randomUUID();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into notifications_feed
          (created_at, id, kind, recipient_id, source_event_id, subject_id, template_key)
         values (now(), ${crypto.randomUUID()}, 'call_incoming', ${recipientId},
           ${crypto.randomUUID()}, ${subjectId}, 'realtime.call.incoming.v1')`,
        ),
      ),
    ).toBe(true);
  });
});
