import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { OutboxRelay } from '../../src/events/relay.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import {
  LocalTestNotificationChannel,
  UnavailableNotificationChannel,
} from '../../src/notifications/channel.js';
import {
  createNotificationsApiRuntime,
  createNotificationsRuntime,
} from '../../src/notifications/composition.js';
import { NotificationDeliveryService } from '../../src/notifications/delivery.js';
import { maximumDeliveryAttempts } from '../../src/notifications/policy.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { LocalTestProfileMediaStorage } from '../../src/users/media.js';
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
  testDatabaseAdmission,
  testServerConfig,
  testCreatorsRuntime,
  testClubsRuntime,
  testAdminRuntime,
  testBillingRuntime,
  testPayoutsRuntime,
} from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_notifications');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
  NOTIFICATIONS_DELIVERY_CHANNEL: 'local-test',
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
      return `notifications-test-${String(requesterSequence)}`;
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

/**
 * The worker half, composed exactly as `src/worker.ts` composes it, minus the
 * queue: BullMQ only carries a wake-up, and every guarantee under test is a
 * property of PostgreSQL and the sweep that reads it.
 */
const notifications = createNotificationsRuntime({
  config,
  database: database.drizzle,
  logger,
  now,
  owner: 'test-delivery-worker',
  safety: safety.directory,
  standing: users.standing,
});
const relay = new OutboxRelay({
  consumers: notifications.intakes,
  logger,
  now,
  owner: 'test-relay',
  sources: [
    { producer: 'discovery', repository: discovery.outbox },
    { producer: 'messaging', repository: messaging.outbox },
  ],
});

const configuredChannel = notifications.channel;
if (!(configuredChannel instanceof LocalTestNotificationChannel)) {
  throw new Error('Notification tests expect the development channel adapter');
}
const channel: LocalTestNotificationChannel = configuredChannel;

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
      safety,
    }),
    clubs: clubsRuntime,
    creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery,
    ephemeralRedis: healthy,
    logger,
    messaging,
    notifications: createNotificationsApiRuntime({
      consumerContext: users.consumerContext,
      database: database.drizzle,
      now,
      safety: safety.directory,
    }),
    queueRedis: healthy,
    safety,
    users,
  },
});
const handle = (request: Request) => application.app.handle(request);

const configuredStorage = users.profileMediaStorage;
if (!(configuredStorage instanceof LocalTestProfileMediaStorage)) {
  throw new Error('Notification tests expect the development storage adapter');
}
const storage: LocalTestProfileMediaStorage = configuredStorage;

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  logs.length = 0;
  channel.reset();
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

async function conversationBetween(
  first: Credentials,
  second: Credentials,
): Promise<string> {
  await handle(
    post('/v1/discovery/introductions', first, { candidateId: second.id }),
  );
  const mutual = await handle(
    post('/v1/discovery/introductions', second, { candidateId: first.id }),
  );
  const introduction = (await mutual.json()) as { id: string; state: string };
  expect(introduction.state).toBe('mutual');
  const opened = await handle(
    post('/v1/messaging/conversations', first, {
      introductionId: introduction.id,
    }),
  );
  expect(opened.status).toBe(200);
  return ((await opened.json()) as { id: string }).id;
}

async function sendMessage(
  actor: Credentials,
  input: {
    readonly body: string;
    readonly clientMessageId: string;
    readonly conversationId: string;
  },
): Promise<number> {
  const response = await handle(post('/v1/messaging/messages', actor, input));
  return response.status;
}

interface IntentRow {
  readonly attempts: number;
  readonly id: string;
  readonly payload: Record<string, unknown>;
  readonly recipient_id: string;
  readonly state: string;
  readonly subject_id: string | null;
  readonly suppression_reason: string | null;
  readonly template_key: string;
}

/**
 * Bun's SQL tag hands back `jsonb` as text, where the query builder the
 * application uses returns it decoded. These tests read the raw column so the
 * assertion is about what is actually stored, so they decode it here.
 */
function payloadOf(value: unknown): Record<string, unknown> {
  return typeof value === 'string'
    ? (JSON.parse(value) as Record<string, unknown>)
    : (value as Record<string, unknown>);
}

const messageTemplateKey = 'messaging.message.received.v1';
const introductionTemplateKey = 'discovery.introduction.mutual.v1';

/**
 * Notices produced by one template.
 *
 * Two templates are approved, and a connected pair produces one of each: the
 * mutual introduction, then the message. The suites below are about the message
 * notice, so they ask for that one by name rather than by position.
 */
async function intents(
  templateKey: string = messageTemplateKey,
): Promise<IntentRow[]> {
  const rows = await rowsOf<IntentRow>(
    database.sql`select attempts, id, payload, recipient_id, state, subject_id, suppression_reason, template_key
      from notifications_intents where template_key = ${templateKey}
      order by created_at`,
  );
  return rows.map((row) => ({ ...row, payload: payloadOf(row.payload) }));
}

async function attemptsOf(intentId: string) {
  return rowsOf<{
    attempt_number: number;
    failure_reason: string | null;
    outcome: string;
  }>(
    database.sql`select attempt_number, failure_reason, outcome
      from notifications_attempts where intent_id = ${intentId}
      order by attempt_number`,
  );
}

async function outbox() {
  const rows = await rowsOf<{
    attempts: number;
    event_name: string;
    id: string;
    payload: Record<string, unknown>;
    state: string;
  }>(
    database.sql`select attempts, event_name, id, payload, state
      from messaging_outbox order by sequence`,
  );
  return rows.map((row) => ({ ...row, payload: payloadOf(row.payload) }));
}

/** A conversation whose next message will owe the other person a notice. */
async function pair(): Promise<{
  readonly conversationId: string;
  readonly recipient: Credentials;
  readonly sender: Credentials;
}> {
  const sender = await consumer(
    `sender-${String(requesterSequence)}@velora.test`,
  );
  const recipient = await consumer(
    `recipient-${String(requesterSequence)}@velora.test`,
  );
  const conversationId = await conversationBetween(sender, recipient);
  // Becoming mutual is itself a notice, owed to whoever signalled first. It is
  // drained and settled here so every assertion below is about what that
  // suite's own message produced.
  await relay.dispatchOnce();
  await notifications.delivery.deliverDue();
  channel.reset();
  return { conversationId, recipient, sender };
}

describe('durable notification handoff', () => {
  it('commits the published fact in the same transaction as the message', async () => {
    const { conversationId, recipient, sender } = await pair();

    expect(
      await sendMessage(sender, {
        body: 'hello',
        clientMessageId: 'client-1',
        conversationId,
      }),
    ).toBe(200);

    const rows = await outbox();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('pending');
    expect(rows[0]?.event_name).toBe('messaging.message.sent.v1');
    // The fact names who must be told and who it is about, and carries no
    // message body: what reaches a lock screen is decided by NOTIFICATIONS from
    // fields MESSAGING never published.
    expect(rows[0]?.payload.recipientId).toBe(recipient.id);
    expect(rows[0]?.payload.senderId).toBe(sender.id);
    expect(Object.keys(rows[0]?.payload ?? {})).not.toContain('body');
  });

  it('keeps the notice owed when the process dies before anything was dispatched', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });

    // Nothing has drained yet — this is the state a worker that never started,
    // or died immediately after the send committed, leaves behind.
    expect(await intents()).toHaveLength(0);
    expect((await outbox())[0]?.state).toBe('pending');

    await relay.dispatchOnce();
    await notifications.delivery.deliverDue();

    const queued = await intents();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.state).toBe('delivered');
    expect(queued[0]?.recipient_id).toBe(recipient.id);
    expect(queued[0]?.subject_id).toBe(sender.id);
    expect(channel.deliveredTo(recipient.id)).toHaveLength(1);
    expect((await outbox())[0]?.state).toBe('dispatched');
  });

  it('produces one notice when the relay dies between the intake and the dispatch record', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    // A relay killed after its consumer committed but before it recorded the
    // dispatch leaves the row claimable, so the fact is delivered again.
    await execute(
      database.sql`update messaging_outbox set state = 'pending', dispatched_at = null, lease_owner = null, lease_expires_at = null`,
    );
    await relay.dispatchOnce();

    // The inbox index, not a prior read, is what makes the redelivery a no-op.
    const rows = await intents();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.recipient_id).toBe(recipient.id);
    expect(rows[0]?.subject_id).toBe(sender.id);
  });

  it('recovers a notice whose delivery worker was killed holding the claim', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    // Exactly what a `kill -9` between claiming and sending leaves in the
    // table: an `attempted` row whose lease nobody will ever release.
    await execute(
      database.sql`update notifications_intents
        set state = 'attempted', lease_owner = 'dead-worker',
            lease_expires_at = now() - interval '1 hour'
        where template_key = ${messageTemplateKey}`,
    );

    const outcomes = await notifications.delivery.deliverDue();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.kind).toBe('delivered');
    expect((await intents())[0]?.state).toBe('delivered');
    expect(channel.deliveredTo(recipient.id)).toHaveLength(1);
    expect(channel.deliveredTo(sender.id)).toHaveLength(0);
  });

  it('delivers once however many times the sweep runs', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    await notifications.delivery.deliverDue();
    const second = await notifications.delivery.deliverDue();

    expect(second).toHaveLength(0);
    expect(channel.deliveredTo(recipient.id)).toHaveLength(1);
    const attempts = await attemptsOf((await intents())[0]?.id ?? '');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.outcome).toBe('delivered');
  });

  it('carries no message body into the notice', async () => {
    const { conversationId, sender } = await pair();
    await sendMessage(sender, {
      body: 'something private',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    const rows = await intents();
    expect(Object.keys(rows[0]?.payload ?? {})).toEqual(['conversationId']);
    expect(rows[0]?.template_key).toBe('messaging.message.received.v1');
    expect(channel.delivered).toHaveLength(0);
  });
});

describe('safety recheck before external delivery', () => {
  it('suppresses a queued notice when the recipient blocks the sender first', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    expect((await intents())[0]?.state).toBe('queued');

    // The block lands after the notice is queued and before it is delivered,
    // which is the window a queue-time evaluation would sail straight through.
    const blocked = await handle(
      post('/v1/safety/blocks', recipient, { targetId: sender.id }),
    );
    expect(blocked.status).toBe(200);

    const outcomes = await notifications.delivery.deliverDue();

    expect(outcomes[0]).toEqual({
      intentId: (await intents())[0]?.id ?? '',
      kind: 'suppressed',
      reason: 'safety_block',
    });
    const rows = await intents();
    expect(rows[0]?.state).toBe('suppressed');
    expect(rows[0]?.suppression_reason).toBe('safety_block');
    // The claim that matters: nothing left the building. "We checked first" and
    // "we did not send" are different statements.
    expect(channel.delivered).toHaveLength(0);
    const attempts = await attemptsOf(rows[0]?.id ?? '');
    expect(attempts[0]?.outcome).toBe('suppressed');
  });

  it('suppresses just as firmly when the sender blocks the recipient', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    await handle(post('/v1/safety/blocks', sender, { targetId: recipient.id }));

    await notifications.delivery.deliverDue();

    // A block is directional as a record and symmetric as an effect. The person
    // who did not do the blocking is not told about the person who did.
    expect((await intents())[0]?.suppression_reason).toBe('safety_block');
    expect(channel.delivered).toHaveLength(0);
  });

  it('does not contact a recipient whose account was restricted after queueing', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    await users.enforcement.restrict({
      executor: database.drizzle,
      now: now(),
      userId: recipient.id,
    });

    await notifications.delivery.deliverDue();

    const rows = await intents();
    expect(rows[0]?.state).toBe('suppressed');
    expect(rows[0]?.suppression_reason).toBe('recipient_not_deliverable');
    expect(channel.delivered).toHaveLength(0);
  });

  it('suppresses a notice that outlived what it was about', async () => {
    const { conversationId, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    // Two days later nobody wants a push about yesterday's message.
    clockOffsetMilliseconds = 2 * 86_400_000;
    await notifications.delivery.deliverDue();

    const rows = await intents();
    expect(rows[0]?.state).toBe('suppressed');
    expect(rows[0]?.suppression_reason).toBe('expired');
    expect(channel.delivered).toHaveLength(0);
  });

  it('delivers when the block is lifted before the notice is claimed', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    await handle(post('/v1/safety/blocks', recipient, { targetId: sender.id }));
    await handle(
      post('/v1/safety/blocks/removal', recipient, { targetId: sender.id }),
    );

    await notifications.delivery.deliverDue();

    // The recheck reads the current answer, not a remembered one.
    expect((await intents())[0]?.state).toBe('delivered');
    expect(channel.deliveredTo(recipient.id)).toHaveLength(1);
  });
});

describe('delivery failure handling', () => {
  it('retries a failing channel and retires the notice without deleting it', async () => {
    const { conversationId, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    channel.failWith('provider_rejected');

    for (let attempt = 0; attempt < maximumDeliveryAttempts; attempt += 1) {
      await notifications.delivery.deliverDue();
      clockOffsetMilliseconds += 3_600_000;
    }

    const rows = await intents();
    expect(rows[0]?.state).toBe('dead_letter');
    expect(rows[0]?.attempts).toBe(maximumDeliveryAttempts);
    // Retired, not discarded: the row still carries what a repair would need.
    expect(rows[0]?.payload.conversationId).toBe(conversationId);
    const attempts = await attemptsOf(rows[0]?.id ?? '');
    expect(attempts).toHaveLength(maximumDeliveryAttempts);
    expect(attempts.every((row) => row.outcome === 'failed')).toBe(true);
    expect(attempts[0]?.failure_reason).toBe('provider_rejected');
    expect(
      logs.some(
        (entry) =>
          (entry as { message?: string }).message ===
          'notification dead-lettered',
      ),
    ).toBe(true);
  });

  it('holds a notice indefinitely while no delivery provider is approved', async () => {
    const { conversationId, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    // The posture every deployed environment has today.
    const unavailable = new NotificationDeliveryService({
      channel: new UnavailableNotificationChannel(),
      logger,
      now,
      owner: 'test-delivery-worker',
      repository: notifications.repository,
      safety: safety.directory,
      standing: users.standing,
    });
    const outcomes = await unavailable.deliverDue();

    expect(outcomes[0]?.kind).toBe('channel_unavailable');
    const rows = await intents();
    expect(rows[0]?.state).toBe('queued');
    // Nothing was asked of anybody, so nothing was spent. The notice survives
    // to be delivered — or suppressed — on the day a provider exists.
    expect(rows[0]?.attempts).toBe(0);
    expect(await attemptsOf(rows[0]?.id ?? '')).toHaveLength(0);
  });
});

describe('notification event coverage', () => {
  it('owes the person who signalled first a notice when the other reciprocates', async () => {
    const first = await consumer(
      `first-${String(requesterSequence)}@velora.test`,
    );
    const second = await consumer(
      `second-${String(requesterSequence)}@velora.test`,
    );

    await handle(
      post('/v1/discovery/introductions', first, { candidateId: second.id }),
    );
    // Nothing is owed yet: one signal is an offer, not an introduction.
    await relay.dispatchOnce();
    expect(await intents(introductionTemplateKey)).toHaveLength(0);

    const mutual = await handle(
      post('/v1/discovery/introductions', second, { candidateId: first.id }),
    );
    const introduction = (await mutual.json()) as { id: string };
    await relay.dispatchOnce();

    const rows = await intents(introductionTemplateKey);
    expect(rows).toHaveLength(1);
    // Only the initiator. The person who reciprocated received the mutual
    // introduction in the response to their own request.
    expect(rows[0]?.recipient_id).toBe(first.id);
    expect(rows[0]?.subject_id).toBe(second.id);
    expect(Object.keys(rows[0]?.payload ?? {})).toEqual(['introductionId']);
    expect(rows[0]?.payload.introductionId).toBe(introduction.id);
  });

  it('commits that fact in the same transaction as the transition', async () => {
    const first = await consumer(
      `first-${String(requesterSequence)}@velora.test`,
    );
    const second = await consumer(
      `second-${String(requesterSequence)}@velora.test`,
    );
    await handle(
      post('/v1/discovery/introductions', first, { candidateId: second.id }),
    );
    await handle(
      post('/v1/discovery/introductions', second, { candidateId: first.id }),
    );

    // Committed and undrained: the state a worker that never started leaves.
    const rows = await rowsOf<{ event_name: string; state: string }>(
      database.sql`select event_name, state from discovery_outbox order by sequence`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_name).toBe('discovery.introduction.mutual.v1');
    expect(rows[0]?.state).toBe('pending');
    expect(await intents(introductionTemplateKey)).toHaveLength(0);
  });

  it('produces one notice however many times the relay redelivers the fact', async () => {
    const first = await consumer(
      `first-${String(requesterSequence)}@velora.test`,
    );
    const second = await consumer(
      `second-${String(requesterSequence)}@velora.test`,
    );
    await handle(
      post('/v1/discovery/introductions', first, { candidateId: second.id }),
    );
    await handle(
      post('/v1/discovery/introductions', second, { candidateId: first.id }),
    );
    await relay.dispatchOnce();

    await execute(
      database.sql`update discovery_outbox set state = 'pending', dispatched_at = null,
        lease_owner = null, lease_expires_at = null`,
    );
    await relay.dispatchOnce();

    expect(await intents(introductionTemplateKey)).toHaveLength(1);
    expect(await feedRowsFor(first.id)).toHaveLength(1);
  });

  it('suppresses the introduction notice when the pair blocked each other first', async () => {
    const first = await consumer(
      `first-${String(requesterSequence)}@velora.test`,
    );
    const second = await consumer(
      `second-${String(requesterSequence)}@velora.test`,
    );
    await handle(
      post('/v1/discovery/introductions', first, { candidateId: second.id }),
    );
    await handle(
      post('/v1/discovery/introductions', second, { candidateId: first.id }),
    );
    await relay.dispatchOnce();
    await handle(post('/v1/safety/blocks', first, { targetId: second.id }));

    await notifications.delivery.deliverDue();

    const rows = await intents(introductionTemplateKey);
    expect(rows[0]?.state).toBe('suppressed');
    expect(rows[0]?.suppression_reason).toBe('safety_block');
    expect(channel.delivered).toHaveLength(0);
  });
});

async function feedRowsFor(recipientId: string) {
  return rowsOf<{
    conversation_id: string | null;
    id: string;
    introduction_id: string | null;
    kind: string;
    read_at: string | null;
    subject_id: string;
  }>(
    database.sql`select conversation_id, id, introduction_id, kind, read_at, subject_id
      from notifications_feed where recipient_id = ${recipientId}
      order by created_at desc, id desc`,
  );
}

interface FeedEntry {
  readonly conversationId?: string;
  readonly createdAt: string;
  readonly id: string;
  readonly introductionId?: string;
  readonly kind: string;
  readonly readAt?: string;
  readonly subjectId: string;
}

function get(path: string, credentials: Credentials): Request {
  return new Request(`http://api.test${path}`, {
    headers: { cookie: credentials.cookie, origin: testConsumerOrigin },
  });
}

async function feed(
  actor: Credentials,
  query = '',
): Promise<{
  readonly nextCursor?: string;
  readonly notifications: FeedEntry[];
  readonly status: number;
}> {
  const response = await handle(get(`/v1/notifications${query}`, actor));
  const body = (await response.json()) as {
    nextCursor?: string;
    notifications: FeedEntry[];
  };
  return { ...body, status: response.status };
}

describe('the in-app notification surface', () => {
  it('shows a person what happened, and only what happened to them', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    const theirs = await feed(recipient);
    expect(theirs.status).toBe(200);
    expect(theirs.notifications).toHaveLength(1);
    expect(theirs.notifications[0]?.kind).toBe('message_received');
    expect(theirs.notifications[0]?.conversationId).toBe(conversationId);
    expect(theirs.notifications[0]?.subjectId).toBe(sender.id);
    expect(theirs.notifications[0]?.readAt).toBeUndefined();

    // The sender's own feed holds the introduction they were told about, and
    // nothing about the message they themselves sent.
    const mine = await feed(sender);
    expect(mine.notifications.map((entry) => entry.kind)).toEqual([
      'introduction_mutual',
    ]);
    expect(mine.notifications[0]?.introductionId).toBeDefined();
  });

  it('publishes no delivery state a consumer has no business seeing', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    // Make the notice terminally suppressed, which is the state that carries
    // the most operator-only detail.
    await handle(post('/v1/safety/blocks', sender, { targetId: recipient.id }));
    await notifications.delivery.deliverDue();
    await handle(
      post('/v1/safety/blocks/removal', sender, { targetId: recipient.id }),
    );

    const response = await handle(get('/v1/notifications', recipient));
    const raw = await response.text();

    // Whatever happened to the external obligation, none of it is here. The
    // suppression reason in particular would disclose somebody else's block.
    for (const forbidden of [
      'attempts',
      'dead_letter',
      'leaseOwner',
      'lease_owner',
      'providerReference',
      'safety_block',
      'suppressed',
      'suppressionReason',
      'templateKey',
    ]) {
      expect(raw).not.toContain(forbidden);
    }
    const parsed = JSON.parse(raw) as { notifications: FeedEntry[] };
    expect(Object.keys(parsed.notifications[0] ?? {}).sort()).toEqual([
      'conversationId',
      'createdAt',
      'id',
      'kind',
      'subjectId',
    ]);
  });

  it('marks read only what the caller owns, and says nothing about the rest', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    const theirs = await feed(recipient);
    const senderFeed = await feed(sender);
    const mine = theirs.notifications[0]?.id ?? '';
    const foreign = senderFeed.notifications[0]?.id ?? '';
    expect(foreign).not.toBe(mine);

    const response = await handle(
      post('/v1/notifications/read', recipient, {
        notificationIds: [mine, foreign],
      }),
    );
    expect(response.status).toBe(200);
    // The foreign identifier is absent rather than refused: a different answer
    // would turn this endpoint into a way to test whether one exists.
    expect(await response.json()).toEqual({ readIds: [mine] });

    expect((await feed(recipient)).notifications[0]?.readAt).toBeDefined();
    expect((await feed(sender)).notifications[0]?.readAt).toBeUndefined();
  });

  it('keeps the first acknowledgement rather than moving it', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    const id = (await feed(recipient)).notifications[0]?.id ?? '';

    await handle(
      post('/v1/notifications/read', recipient, { notificationIds: [id] }),
    );
    const first = (await feed(recipient)).notifications[0]?.readAt;
    clockOffsetMilliseconds = 60_000;
    const repeated = await handle(
      post('/v1/notifications/read', recipient, { notificationIds: [id] }),
    );

    // A repeat changes nothing, and reports that it changed nothing.
    expect(await repeated.json()).toEqual({ readIds: [] });
    expect((await feed(recipient)).notifications[0]?.readAt).toBe(first ?? '');
  });

  it('hides a notice about somebody the reader may no longer interact with', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    expect((await feed(recipient)).notifications).toHaveLength(1);

    await handle(post('/v1/safety/blocks', recipient, { targetId: sender.id }));

    expect((await feed(recipient)).notifications).toHaveLength(0);
    // Filtered, never deleted. The evidence that the platform owed this notice
    // survives the block, and the filter follows the current answer.
    expect(await feedRowsFor(recipient.id)).toHaveLength(1);

    await handle(
      post('/v1/safety/blocks/removal', recipient, { targetId: sender.id }),
    );
    expect((await feed(recipient)).notifications).toHaveLength(1);
  });

  it('hides it just as firmly when the block came from the other side', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    expect((await feed(recipient)).notifications).toHaveLength(1);

    // The recipient did not block anybody. A block is directional as a record
    // and symmetric as an effect, and a feed that only checked the reader's own
    // blocks would keep showing them somebody who has shut them out.
    await handle(post('/v1/safety/blocks', sender, { targetId: recipient.id }));

    expect((await feed(recipient)).notifications).toHaveLength(0);
    expect(await feedRowsFor(recipient.id)).toHaveLength(1);
  });

  it('pages newest first without repeating or skipping a notice', async () => {
    const { conversationId, recipient, sender } = await pair();
    for (let index = 0; index < 5; index += 1) {
      clockOffsetMilliseconds = index * 1_000;
      await sendMessage(sender, {
        body: `message ${String(index)}`,
        clientMessageId: `client-${String(index)}`,
        conversationId,
      });
      await relay.dispatchOnce();
    }

    const firstPage = await feed(recipient, '?pageSize=2');
    expect(firstPage.notifications).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();

    const seen = [...firstPage.notifications];
    let cursor = firstPage.nextCursor;
    // A short page with a cursor is not "no more"; the loop stops when the
    // server stops offering a continuation.
    for (let round = 0; round < 10 && cursor !== undefined; round += 1) {
      const page = await feed(
        recipient,
        `?pageSize=2&cursor=${encodeURIComponent(cursor)}`,
      );
      seen.push(...page.notifications);
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(5);
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(5);
    const instants = seen.map((entry) => Date.parse(entry.createdAt));
    expect([...instants].sort((left, right) => right - left)).toEqual(instants);
  });

  it('refuses a malformed cursor rather than answering a different question', async () => {
    const { recipient } = await pair();
    const response = await handle(
      get('/v1/notifications?cursor=nonsense', recipient),
    );
    expect(response.status).toBe(422);
  });

  it('is reachable only by an authenticated consumer', async () => {
    const anonymous = await handle(
      new Request('http://api.test/v1/notifications'),
    );
    expect(anonymous.status).toBe(401);
  });
});

describe('hostile access to the notification surface', () => {
  it('never returns one person a notice owed to another', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    const theirs = await feed(recipient);
    const outsider = await consumer(
      `outsider-${String(requesterSequence)}@velora.test`,
    );
    const seen = await feed(outsider);

    // Scoping is in the query predicate, not a filter applied afterwards, so
    // there is no arrangement of inputs that widens it.
    expect(seen.notifications).toHaveLength(0);
    expect(theirs.notifications).toHaveLength(1);

    // And an identifier belonging to somebody else changes nothing and is
    // reported as changing nothing, so it cannot be probed for existence.
    const stolen = await handle(
      post('/v1/notifications/read', outsider, {
        notificationIds: [theirs.notifications[0]?.id ?? ''],
      }),
    );
    expect(stolen.status).toBe(200);
    expect(await stolen.json()).toEqual({ readIds: [] });
    expect((await feed(recipient)).notifications[0]?.readAt).toBeUndefined();
  });

  it('refuses a non-consumer session on both notification routes', async () => {
    const creator = await signIn('operator@velora.test', 'creator_studio');
    const listed = await handle(
      new Request('http://api.test/v1/notifications', {
        headers: { cookie: creator.cookie, origin: testCreatorOrigin },
      }),
    );
    const acknowledged = await handle(
      new Request('http://api.test/v1/notifications/read', {
        body: JSON.stringify({
          notificationIds: ['11111111-1111-4111-8111-111111111111'],
        }),
        headers: {
          'content-type': 'application/json',
          cookie: creator.cookie,
          origin: testCreatorOrigin,
          'x-velora-csrf': creator.csrf,
        },
        method: 'POST',
      }),
    );

    for (const response of [listed, acknowledged]) {
      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe(
        'CONSUMER_SURFACE_REQUIRED',
      );
    }
  });

  it('refuses a tampered cursor rather than answering a different question', async () => {
    const { recipient } = await pair();
    const forged = Buffer.from(
      JSON.stringify({
        i: '00000000-0000-4000-8000-000000000000',
        t: '2099-01-01T00:00:00.000Z',
      }),
      'utf8',
    ).toString('base64url');

    // A cursor is not a credential and carries no authority. The worst a forged
    // one can do is move a caller around their own notices, and a malformed one
    // is a validation failure.
    const forgedPage = await feed(
      recipient,
      `?cursor=${encodeURIComponent(forged)}`,
    );
    expect(forgedPage.status).toBe(200);
    expect(forgedPage.notifications).toHaveLength(0);
    for (const nonsense of [
      '',
      'not base64',
      '../../etc/passwd',
      'a'.repeat(600),
    ]) {
      const response = await handle(
        get(
          `/v1/notifications?cursor=${encodeURIComponent(nonsense)}`,
          recipient,
        ),
      );
      expect(response.status).toBe(422);
    }
  });

  it('bounds what one acknowledgement may write', async () => {
    const { recipient } = await pair();
    const tooMany = Array.from({ length: 51 }, () => crypto.randomUUID());
    const refused = await handle(
      post('/v1/notifications/read', recipient, { notificationIds: tooMany }),
    );
    expect(refused.status).toBe(422);

    const empty = await handle(
      post('/v1/notifications/read', recipient, { notificationIds: [] }),
    );
    expect(empty.status).toBe(422);
  });

  it('keeps an unauthenticated caller out of both routes', async () => {
    const listed = await handle(
      new Request('http://api.test/v1/notifications'),
    );
    const acknowledged = await handle(
      new Request('http://api.test/v1/notifications/read', {
        body: '{"notificationIds":["11111111-1111-4111-8111-111111111111"]}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
    );
    expect(listed.status).toBe(401);
    expect(acknowledged.status).toBe(401);
  });
});

describe('crash injection around the introduction fact', () => {
  it('owes the notice even when the process dies before anything drains', async () => {
    const first = await consumer(
      `crash-a-${String(requesterSequence)}@velora.test`,
    );
    const second = await consumer(
      `crash-b-${String(requesterSequence)}@velora.test`,
    );
    await handle(
      post('/v1/discovery/introductions', first, { candidateId: second.id }),
    );
    await handle(
      post('/v1/discovery/introductions', second, { candidateId: first.id }),
    );

    // Committed and undrained: nothing in memory, nothing in a queue.
    expect(await intents(introductionTemplateKey)).toHaveLength(0);
    expect(await feedRowsFor(first.id)).toHaveLength(0);

    await relay.dispatchOnce();

    expect(await intents(introductionTemplateKey)).toHaveLength(1);
    expect(await feedRowsFor(first.id)).toHaveLength(1);
  });

  it('produces one notice when the worker dies between the intake and the dispatch record', async () => {
    const first = await consumer(
      `crash-c-${String(requesterSequence)}@velora.test`,
    );
    const second = await consumer(
      `crash-d-${String(requesterSequence)}@velora.test`,
    );
    await handle(
      post('/v1/discovery/introductions', first, { candidateId: second.id }),
    );
    await handle(
      post('/v1/discovery/introductions', second, { candidateId: first.id }),
    );
    await relay.dispatchOnce();

    // Exactly what a worker killed after its consumer committed and before it
    // recorded the dispatch leaves behind.
    await execute(
      database.sql`update discovery_outbox set state = 'pending', dispatched_at = null,
        lease_owner = null, lease_expires_at = null`,
    );
    await relay.dispatchOnce();
    await relay.dispatchOnce();

    expect(await intents(introductionTemplateKey)).toHaveLength(1);
    expect(await feedRowsFor(first.id)).toHaveLength(1);
  });

  it('recovers a fact whose relay was killed holding the lease', async () => {
    const first = await consumer(
      `crash-e-${String(requesterSequence)}@velora.test`,
    );
    const second = await consumer(
      `crash-f-${String(requesterSequence)}@velora.test`,
    );
    await handle(
      post('/v1/discovery/introductions', first, { candidateId: second.id }),
    );
    await handle(
      post('/v1/discovery/introductions', second, { candidateId: first.id }),
    );

    // A relay that died holding rows releases nothing; expiry is what brings
    // the work back.
    await execute(
      database.sql`update discovery_outbox
        set lease_owner = 'dead-relay', lease_expires_at = now() - interval '1 hour'`,
    );
    await relay.dispatchOnce();

    const rows = await rowsOf<{ state: string }>(
      database.sql`select state from discovery_outbox`,
    );
    expect(rows[0]?.state).toBe('dispatched');
    expect(await intents(introductionTemplateKey)).toHaveLength(1);
  });
});
