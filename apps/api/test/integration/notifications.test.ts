import { createHash, createHmac } from 'node:crypto';
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
import { RegisteredDeviceDestinations } from '../../src/notifications/destinations.js';
import { NotificationOperations } from '../../src/notifications/operations.js';
import { NotificationProviderEventService } from '../../src/notifications/provider-events.js';
import {
  createNotificationsApiRuntime,
  createNotificationsRuntime,
} from '../../src/notifications/composition.js';
import { NotificationDeliveryService } from '../../src/notifications/delivery.js';
import {
  deliveryFailureClasses,
  maximumDeliveryAttempts,
  notificationStates,
  suppressionReasons,
} from '../../src/notifications/policy.js';
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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
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

const databaseUrl = await provisionDatabase('velora_notifications');
/**
 * Headroom above this suite's own peak, not the default twenty.
 *
 * Two tests here fire fifty simultaneous requests — one registering the same
 * device, one redelivering the same provider event. Admission bounds route
 * concurrency at sixteen, and each admitted request holds a connection for a
 * transaction that also holds an advisory lock, while the suite's own
 * assertions query alongside them. A pool that has to queue a caller while it
 * is serving transactions is the shape `connectDatabase` documents as able to
 * strand a connection `idle in transaction`, and the answer the other
 * concurrency suites already use is a bigger pool rather than a smaller test.
 *
 * Found by the stability sequence: run 9 of 20 returned a status that was
 * neither the registration nor an admission refusal, on eight previously clean
 * runs of identical code.
 */
const database: TestDatabase = connectDatabase(databaseUrl, { max: 60 });

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
  NOTIFICATIONS_DELIVERY_CHANNEL: 'local-test',
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
      return `notifications-test-${String(requesterSequence)}`;
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
    notifications: createNotificationsApiRuntime({
      // The API verifies provider callbacks with the same adapter the worker
      // delivers through, so a signature this suite produces is one the
      // endpoint actually has to check.
      channel,
      config,
      consumerContext: users.consumerContext,
      database: database.drizzle,
      logger,
      now,
      safety: safety.directory,
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
  channel.reset();
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
  readonly failure_reason: string | null;
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
    database.sql`select attempts, failure_reason, id, payload, recipient_id, state, subject_id, suppression_reason, template_key
      from notifications_intents where template_key = ${templateKey}
      order by created_at`,
  );
  return rows.map((row) => ({ ...row, payload: payloadOf(row.payload) }));
}

async function attemptsOf(intentId: string) {
  return rowsOf<{
    attempt_number: number;
    failure_class: string | null;
    failure_reason: string | null;
    outcome: string;
  }>(
    database.sql`select attempt_number, failure_class, failure_reason, outcome
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
  // A push notice needs somewhere to arrive. Without a registered device the
  // delivery path suppresses rather than sends, which is the correct behaviour
  // and would make every assertion below about the wrong thing.
  await handle(
    post('/v1/notifications/devices', recipient, {
      installationId: `pair-recipient-${String(requesterSequence)}`,
      platform: 'ios',
      token: `recipient-token-${String(requesterSequence)}`.padEnd(64, '0'),
    }),
  );
  await handle(
    post('/v1/notifications/devices', sender, {
      installationId: `pair-sender-${String(requesterSequence)}`,
      platform: 'android',
      token: `sender-token-${String(requesterSequence)}`.padEnd(64, '0'),
    }),
  );
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
    // Every attempt carries the class that decided it was worth another one.
    expect(attempts.every((row) => row.failure_class === 'transport')).toBe(
      true,
    );
    expect(
      logs.some(
        (entry) =>
          (entry as { message?: string }).message ===
          'notification dead-lettered',
      ),
    ).toBe(true);
  });

  /**
   * A failure whose class can never succeed stops on its first occurrence.
   *
   * The budget is not the question here. A mailbox that does not exist will
   * not start existing on the fourth try, and five more messages to it is how
   * a sending reputation is lost rather than how a notice gets delivered. The
   * retry decision reads the class and nothing else, so a provider inventing a
   * new error string cannot invent a new retry behaviour with it.
   */
  it.each([
    ['hard_bounce', 'address_unknown'],
    ['invalid_token', 'token_retired'],
    ['policy_refused', 'sender_refused'],
    ['destination_suppressed', 'destination_suppressed'],
  ] as const)(
    'retires a notice on the first %s without spending the retry budget',
    async (failureClass, reason) => {
      const { conversationId, sender } = await pair();
      await sendMessage(sender, {
        body: 'hello',
        clientMessageId: 'client-1',
        conversationId,
      });
      await relay.dispatchOnce();
      channel.failWith(reason, failureClass);

      await notifications.delivery.deliverDue();

      const rows = await intents();
      expect(rows[0]?.state).toBe('dead_letter');
      // One attempt, not six. The class decided, not the counter.
      expect(rows[0]?.attempts).toBe(1);
      // The row records why the platform stopped, and the class outranks the
      // budget: "attempts_exhausted" here would misreport it to an operator.
      expect(rows[0]?.failure_reason).toBe(failureClass);
      const attempts = await attemptsOf(rows[0]?.id ?? '');
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.failure_class).toBe(failureClass);
      expect(attempts[0]?.outcome).toBe('failed');
      // Retired, never deleted: the payload a repair would need survives.
      expect(rows[0]?.payload.conversationId).toBe(conversationId);
    },
  );

  it.each([['throttled'], ['soft_bounce']] as const)(
    'keeps a notice owed after a %s, which may succeed later',
    async (failureClass) => {
      const { conversationId, sender } = await pair();
      await sendMessage(sender, {
        body: 'hello',
        clientMessageId: 'client-1',
        conversationId,
      });
      await relay.dispatchOnce();
      channel.failWith('deferred', failureClass);

      await notifications.delivery.deliverDue();

      const rows = await intents();
      expect(rows[0]?.state).toBe('queued');
      expect(rows[0]?.attempts).toBe(1);
      const attempts = await attemptsOf(rows[0]?.id ?? '');
      expect(attempts[0]?.failure_class).toBe(failureClass);

      // And it does succeed, once the provider stops refusing.
      channel.failWith(undefined);
      clockOffsetMilliseconds += 3_600_000;
      await notifications.delivery.deliverDue();
      expect((await intents())[0]?.state).toBe('delivered');
      expect(
        channel.deliveredTo((await intents())[0]?.recipient_id ?? ''),
      ).toHaveLength(1);
    },
  );

  it('never records the legacy class, which exists only for old rows', async () => {
    // `unclassified` is storable so the shape constraint could be added to a
    // table that already held failed attempts. Nothing produces it, and this
    // is the assertion that keeps it that way.
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

    const attempts = await attemptsOf((await intents())[0]?.id ?? '');
    expect(attempts).not.toHaveLength(0);
    expect(attempts.some((row) => row.failure_class === 'unclassified')).toBe(
      false,
    );
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
      destinations: new RegisteredDeviceDestinations(notifications.repository),
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

interface PreferenceEntry {
  readonly category: string;
  readonly channel: string;
  readonly enabled: boolean;
}

async function preferences(actor: Credentials): Promise<{
  readonly preferences: PreferenceEntry[];
  readonly status: number;
}> {
  const response = await handle(get('/v1/notifications/preferences', actor));
  const body = (await response.json()) as { preferences?: PreferenceEntry[] };
  return { preferences: body.preferences ?? [], status: response.status };
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

describe('notification preferences', () => {
  it('offers a switch for every pairing the platform can actually send on', async () => {
    const { recipient } = await pair();
    const listed = await preferences(recipient);

    expect(listed.status).toBe(200);
    // Derived from the approved catalogue, not hand-listed: a switch for
    // something with no template would be a control that does nothing.
    expect(
      listed.preferences.toSorted((first, second) =>
        first.category.localeCompare(second.category),
      ),
    ).toEqual([
      { category: 'call', channel: 'push', enabled: true },
      { category: 'direct_message', channel: 'push', enabled: true },
      { category: 'introduction', channel: 'push', enabled: true },
    ]);
  });

  it('never offers a mandatory category as a switch', async () => {
    const { recipient } = await pair();
    const listed = await preferences(recipient);

    // They are obligations rather than offers, so they are absent from the
    // read surface entirely rather than present and refused on write.
    for (const category of ['account_security', 'safety_legal']) {
      expect(
        listed.preferences.some((entry) => entry.category === category),
      ).toBe(false);
    }
  });

  it('records a decision and answers with the whole set', async () => {
    const { recipient } = await pair();
    const response = await handle(
      post('/v1/notifications/preferences', recipient, {
        category: 'direct_message',
        channel: 'push',
        enabled: false,
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { preferences: PreferenceEntry[] };
    // The whole set, so a client never merges a response into local state.
    expect(body.preferences).toHaveLength(3);
    expect(
      body.preferences.find((entry) => entry.category === 'direct_message')
        ?.enabled,
    ).toBe(false);
  });

  it('refuses a pairing the platform has no template for', async () => {
    const { recipient } = await pair();
    // A real category on a channel it is never sent over. Accepting this would
    // store a preference that governs nothing.
    const response = await handle(
      post('/v1/notifications/preferences', recipient, {
        category: 'direct_message',
        channel: 'email',
        enabled: false,
      }),
    );

    expect(response.status).toBe(422);
  });

  it.each([['account_security'], ['safety_legal']] as const)(
    'refuses to silence the mandatory %s category',
    async (category) => {
      const { recipient } = await pair();
      const response = await handle(
        post('/v1/notifications/preferences', recipient, {
          category,
          channel: 'push',
          enabled: false,
        }),
      );

      expect(response.status).toBe(422);
    },
  );

  it('refuses a disabled mandatory row at the database, not only in code', async () => {
    const { recipient } = await pair();
    // The service refuses this, and so does the table. Two defences for one
    // rule, because a second write path that forgot it would fail silently and
    // in the direction nobody notices: somebody stops being told about their
    // own account.
    let refused = false;
    try {
      await execute(
        database.sql`insert into notifications_preferences
          (category, channel, created_at, enabled, recipient_id, updated_at)
         values ('account_security', 'push', now(), false, ${recipient.id}, now())`,
      );
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);

    // The same row enabled is fine, so the constraint is about the decision
    // rather than about the category existing.
    await execute(
      database.sql`insert into notifications_preferences
        (category, channel, created_at, enabled, recipient_id, updated_at)
       values ('account_security', 'push', now(), true, ${recipient.id}, now())`,
    );
  });

  it('reads only the caller’s own decisions', async () => {
    const { recipient } = await pair();
    const other = await consumer('preference-outsider@velora.test');
    await handle(
      post('/v1/notifications/preferences', recipient, {
        category: 'call',
        channel: 'push',
        enabled: false,
      }),
    );

    const theirs = await preferences(other);

    // Defaults, not the recipient's decision. One person's settings are never
    // reachable from another person's session.
    expect(
      theirs.preferences.find((entry) => entry.category === 'call')?.enabled,
    ).toBe(true);
  });

  it('suppresses an opted-out notice and never reaches the channel', async () => {
    const { conversationId, recipient, sender } = await pair();
    await handle(
      post('/v1/notifications/preferences', recipient, {
        category: 'direct_message',
        channel: 'push',
        enabled: false,
      }),
    );
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();

    await notifications.delivery.deliverDue();

    const rows = await intents();
    expect(rows[0]?.state).toBe('suppressed');
    expect(rows[0]?.suppression_reason).toBe('recipient_opted_out');
    // The assertion that matters: not "we checked" but "we did not send".
    expect(channel.deliveredTo(recipient.id)).toHaveLength(0);
  });

  it('applies a preference set after the notice was already owed', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    // Queued under one answer, delivered under another. Preference is read in
    // the claiming transaction, so the current answer governs rather than the
    // one that held when the notice was created.
    await handle(
      post('/v1/notifications/preferences', recipient, {
        category: 'direct_message',
        channel: 'push',
        enabled: false,
      }),
    );

    await notifications.delivery.deliverDue();

    expect((await intents())[0]?.suppression_reason).toBe(
      'recipient_opted_out',
    );
    expect(channel.deliveredTo(recipient.id)).toHaveLength(0);
  });

  it('still shows an opted-out notice in the app', async () => {
    const { conversationId, recipient, sender } = await pair();
    await handle(
      post('/v1/notifications/preferences', recipient, {
        category: 'direct_message',
        channel: 'push',
        enabled: false,
      }),
    );
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    await notifications.delivery.deliverDue();

    // A push preference is a decision about being interrupted, not about
    // being told. The in-app line is a surface the person chose to open.
    const listed = await feed(recipient);
    expect(listed.notifications).toHaveLength(1);
  });
});

describe('push device registration', () => {
  const token = 'a'.repeat(64);
  const installation = 'installation-0001';
  let deviceSubject = 0;

  /**
   * A fresh account with no device.
   *
   * Deliberately not `pair()`, which registers a device for each side so the
   * delivery suites have somewhere for a push notice to arrive. These tests are
   * about registration itself and have to start from nothing.
   */
  async function deviceOwner(): Promise<Credentials> {
    deviceSubject += 1;
    return consumer(`device-owner-${String(deviceSubject)}@velora.test`);
  }

  async function register(
    actor: Credentials,
    body: Record<string, unknown> = {},
  ) {
    const response = await handle(
      post('/v1/notifications/devices', actor, {
        installationId: installation,
        platform: 'ios',
        token,
        ...body,
      }),
    );
    const parsed = (await response.json()) as {
      devices?: { deviceId: string; lastSeenAt: string; platform: string }[];
    };
    return { devices: parsed.devices ?? [], status: response.status };
  }

  /**
   * What the API's own error handler recorded, if anything.
   *
   * `application.ts` logs `unhandled request error` with the thrown value
   * whenever a request answers 500. The suite's logger keeps every record, so
   * the exception is already in this process — it was simply never read.
   *
   * Read from a mark taken before the action rather than from the whole run,
   * so a record another test provoked cannot be reported as this one's cause.
   */
  function unhandledErrors(from: number): readonly string[] {
    return logs
      .slice(from)
      .filter(
        (entry): entry is { fields: { error?: unknown }; message: string } =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as { message?: unknown }).message ===
            'unhandled request error',
      )
      .map((entry) => {
        const thrown = entry.fields.error;
        return thrown instanceof Error
          ? `${thrown.name}: ${thrown.message}`
          : String(thrown);
      });
  }

  async function liveDevices(recipientId: string) {
    return rowsOf<{
      disable_reason: string | null;
      id: string;
      installation_id: string;
      token_fingerprint: string;
    }>(
      database.sql`select disable_reason, id, installation_id, token_fingerprint
        from notifications_push_devices
        where recipient_id = ${recipientId} and disabled_at is null`,
    );
  }

  it('registers a device and never echoes the credential back', async () => {
    const recipient = await deviceOwner();
    const result = await register(recipient);

    expect(result.status).toBe(200);
    expect(result.devices).toHaveLength(1);
    // The caller already has its own token. Returning one would put a bearer
    // credential in a response body, a log, and a proxy cache for no purpose.
    const serialized = JSON.stringify(result.devices);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('fingerprint');
  });

  it('stores a fingerprint and not the token', async () => {
    const recipient = await deviceOwner();
    await register(recipient);

    const rows = await liveDevices(recipient.id);
    // Nothing can send with a fingerprint — and nothing can send at all, since
    // no push provider is approved and no native build exists to issue a
    // token. Storing a credential no code path can spend is risk with no
    // benefit, so the column that would hold one does not exist yet.
    expect(rows[0]?.token_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(rows[0]?.token_fingerprint).not.toBe(token);
  });

  it('treats a repeat registration as a heartbeat, not a second device', async () => {
    const recipient = await deviceOwner();
    const first = await register(recipient);
    clockOffsetMilliseconds += 60_000;
    const second = await register(recipient);

    expect(second.devices).toHaveLength(1);
    expect(second.devices[0]?.deviceId).toBe(first.devices[0]?.deviceId ?? '');
    // An app that registers on every launch must not accumulate rows.
    expect(second.devices[0]?.lastSeenAt).not.toBe(
      first.devices[0]?.lastSeenAt ?? '',
    );
  });

  it('retires the old token when an installation rotates', async () => {
    const recipient = await deviceOwner();
    await register(recipient);
    const rotated = await register(recipient, { token: 'b'.repeat(64) });

    expect(rotated.devices).toHaveLength(1);
    const all = await rowsOf<{ disable_reason: string | null }>(
      database.sql`select disable_reason from notifications_push_devices
        where recipient_id = ${recipient.id} order by created_at`,
    );
    // Two rows, one live. The retired one keeps its fingerprint as evidence.
    expect(all).toHaveLength(2);
    expect(all[0]?.disable_reason).toBe('token_rotated');
    expect(all[1]?.disable_reason).toBeNull();
  });

  it('takes a token away from an account that no longer holds the device', async () => {
    const recipient = await deviceOwner();
    const other = await deviceOwner();
    await register(recipient);

    // The same physical device, now signed in as somebody else. Leaving both
    // registrations live is one person's notice arriving on another person's
    // phone, so the earlier one is retired rather than shared.
    const claimed = await register(other, {
      installationId: 'installation-0002',
    });

    expect(claimed.status).toBe(200);
    expect(await liveDevices(recipient.id)).toHaveLength(0);
    expect(await liveDevices(other.id)).toHaveLength(1);
    const retired = await rowsOf<{ disable_reason: string | null }>(
      database.sql`select disable_reason from notifications_push_devices
        where recipient_id = ${recipient.id}`,
    );
    expect(retired[0]?.disable_reason).toBe('claimed_by_another_principal');
  });

  it('revokes only the caller’s own installation', async () => {
    const recipient = await deviceOwner();
    const other = await deviceOwner();
    await register(recipient);
    // A different device entirely. Registering the same token would take the
    // recipient's registration away first, which is the previous test's
    // subject and would hide this one's.
    await register(other, {
      installationId: 'installation-0003',
      token: 'c'.repeat(64),
    });

    const response = await handle(
      post('/v1/notifications/devices/revocations', other, {
        installationId: installation,
      }),
    );

    // `installation` is the recipient's, not theirs. Revoking it silently
    // succeeds and changes nothing, so this cannot be used to discover
    // whether an installation identifier exists.
    expect(response.status).toBe(200);
    expect(await liveDevices(recipient.id)).toHaveLength(1);
  });

  it('retires the registration when the caller revokes it', async () => {
    const recipient = await deviceOwner();
    await register(recipient);

    const response = await handle(
      post('/v1/notifications/devices/revocations', recipient, {
        installationId: installation,
      }),
    );
    const body = (await response.json()) as { devices: unknown[] };

    expect(body.devices).toHaveLength(0);
    expect(await liveDevices(recipient.id)).toHaveLength(0);
  });

  it.each([
    [{ token: 'short' }],
    [{ platform: 'windows' }],
    [{ installationId: 'tiny' }],
  ])('refuses a registration that is not a usable shape: %o', async (body) => {
    const recipient = await deviceOwner();
    const result = await register(recipient, body);

    expect(result.status).toBe(422);
  });

  it('refuses to register without a session', async () => {
    const response = await handle(
      new Request('http://api.test/v1/notifications/devices', {
        body: JSON.stringify({
          installationId: installation,
          platform: 'ios',
          token,
        }),
        headers: {
          'content-type': 'application/json',
          origin: testConsumerOrigin,
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(401);
  });

  it('leaves exactly one live registration under fifty concurrent registrations', async () => {
    const recipient = await deviceOwner();
    const logMark = logs.length;

    // The same device registering fifty times at once, which is what a retry
    // storm or a reconnecting app actually looks like.
    const results = await Promise.all(
      Array.from({ length: 50 }, async () => register(recipient)),
    );

    /**
     * Every answer is either the registration or a refusal to begin it.
     *
     * Not "all fifty succeed". Registration serializes on an advisory lock over
     * the token, and database admission bounds how many requests may be in
     * flight at once and declines the rest with a retryable 503 rather than
     * holding them — which is [ADR-0019](../../../docs/decisions/ADR-0019-database-connection-admission.md)
     * working, not failing. Fifty simultaneous registrations of one token is a
     * convoy on that lock, so on a slower machine some of them reach the
     * admission wait and are refused. The first version of this test asserted
     * fifty 200s, passed on every local run, and failed on the hosted runner:
     * it was asserting a throughput guarantee the platform deliberately
     * declines to make.
     *
     * What the platform does promise is that no answer is an internal error
     * and that concurrency cannot produce a second live registration. Both are
     * asserted, and the second is the one that matters — a duplicate here is
     * one person's notice arriving on another person's phone.
     */
    // Asserted as the list of offending statuses rather than as a boolean, so
    // a failure names what arrived instead of leaving the next reader to
    // guess. The first version reported only `false`, which cost a cycle.
    const unexpected = [
      ...new Set(
        results
          .map((result) => result.status)
          .filter((status) => status !== 200 && status !== 503),
      ),
    ];
    // And carried with the server's own account of why. A 500 answers with a
    // correlation identifier and nothing else, by design, so the response body
    // cannot say what went wrong; the record the error handler wrote is the
    // only thing that can. This failure has cost two full runs to see and none
    // to explain, and a run here is twelve minutes.
    expect({ statuses: unexpected, why: unhandledErrors(logMark) }).toEqual({
      statuses: [],
      why: [],
    });
    expect(results.some((result) => result.status === 200)).toBe(true);
    expect(await liveDevices(recipient.id)).toHaveLength(1);
  });
});

describe('delivery needs somewhere to arrive', () => {
  async function messageTo(actor: {
    readonly conversationId: string;
    readonly sender: Credentials;
  }) {
    await sendMessage(actor.sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId: actor.conversationId,
    });
    await relay.dispatchOnce();
  }

  it('suppresses a push notice for somebody with no registered device', async () => {
    const sender = await consumer('no-device-sender@velora.test');
    const recipient = await consumer('no-device-recipient@velora.test');
    const conversationId = await conversationBetween(sender, recipient);
    await relay.dispatchOnce();
    await notifications.delivery.deliverDue();
    channel.reset();

    await messageTo({ conversationId, sender });
    await notifications.delivery.deliverDue();

    const rows = await intents();
    // Not a failure and not a delivery. Nothing was wrong and nobody was
    // asked, and reporting success here would report that a person was
    // reached who has no device to reach.
    expect(rows[0]?.state).toBe('suppressed');
    expect(rows[0]?.suppression_reason).toBe('destination_unavailable');
    expect(channel.deliveredTo(recipient.id)).toHaveLength(0);
    // No attempt was spent either, so the notice cost no retry budget.
    const attempts = await attemptsOf(rows[0]?.id ?? '');
    expect(attempts[0]?.outcome).toBe('suppressed');
  });

  it('suppresses when the only device was revoked after the notice was owed', async () => {
    const { conversationId, recipient, sender } = await pair();
    await messageTo({ conversationId, sender });
    // Registered when the notice was created, gone by the time it is claimed.
    // Destinations are read in the claiming transaction for exactly this
    // reason: a notice aimed at a retired registration is one nobody gets.
    await handle(
      post('/v1/notifications/devices/revocations', recipient, {
        installationId: `pair-recipient-${String(requesterSequence)}`,
      }),
    );

    await notifications.delivery.deliverDue();

    expect((await intents())[0]?.suppression_reason).toBe(
      'destination_unavailable',
    );
    expect(channel.deliveredTo(recipient.id)).toHaveLength(0);
  });

  it('carries every live device, and no credential, to the channel', async () => {
    const { conversationId, recipient, sender } = await pair();
    await handle(
      post('/v1/notifications/devices', recipient, {
        installationId: 'second-device-0001',
        platform: 'android',
        token: 'second-device-token'.padEnd(64, '0'),
      }),
    );

    await messageTo({ conversationId, sender });
    await notifications.delivery.deliverDue();

    const sent = channel.deliveredTo(recipient.id);
    expect(sent).toHaveLength(1);
    // One notice, both devices. Fan-out is the adapter's business; the
    // obligation is still one thing the platform owes one person.
    expect(sent[0]?.destinations).toHaveLength(2);
    // Two distinct devices, not the same one counted twice.
    expect(
      new Set(sent[0]?.destinations.map((entry) => entry.deviceId)).size,
    ).toBe(2);
    expect(
      sent[0]?.destinations.map((entry) => entry.platform).toSorted(),
    ).toEqual(['android', 'ios']);
    // Device references, never tokens or fingerprints.
    const serialized = JSON.stringify(sent[0]?.destinations);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('fingerprint');
  });

  it('has no destination to resolve for email, because no address exists', async () => {
    const { recipient } = await pair();
    const resolver = new RegisteredDeviceDestinations(notifications.repository);

    // A statement about the platform rather than about this person. No domain
    // stores an email address at all, so there is nothing to resolve for
    // anybody, and that blocks the email channel more completely than the
    // absence of an approved provider does.
    expect(
      await resolver.resolve({
        channel: 'email',
        executor: notifications.repository.transactionless,
        recipientId: recipient.id,
      }),
    ).toHaveLength(0);
  });
});

describe('provider feedback is hostile input until it authenticates', () => {
  function signed(body: unknown): Request {
    const raw = Buffer.from(JSON.stringify(body), 'utf8');
    const signature = createHmac(
      'sha256',
      LocalTestNotificationChannel.signingSecret,
    )
      .update(raw)
      .digest('hex');
    return new Request('http://api.test/v1/notifications/provider-events', {
      body: raw,
      headers: {
        'content-type': 'application/json',
        'x-velora-notification-signature': signature,
      },
      method: 'POST',
    });
  }

  function unsigned(body: unknown, signature?: string): Request {
    return new Request('http://api.test/v1/notifications/provider-events', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        ...(signature === undefined
          ? {}
          : { 'x-velora-notification-signature': signature }),
      },
      method: 'POST',
    });
  }

  function feedbackBody(overrides: Record<string, unknown> = {}) {
    return {
      eventId: `event-${crypto.randomUUID()}`,
      feedbackType: 'delivered',
      occurredAt: new Date().toISOString(),
      ...overrides,
    };
  }

  async function events() {
    return rowsOf<{
      feedback_type: string;
      payload_digest: string;
      provider_event_id: string;
      state: string;
      token_fingerprint: string | null;
    }>(
      database.sql`select feedback_type, payload_digest, provider_event_id,
        state, token_fingerprint from notifications_provider_events
        order by received_at`,
    );
  }

  it('records a verified callback and keeps none of the body', async () => {
    const body = feedbackBody();
    const response = await handle(signed(body));

    // 202, not 200: recorded, not applied. A provider's retry budget is never
    // spent waiting for work this platform chose to do later.
    expect(response.status).toBe(202);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('received');
    // A digest of the exact bytes that authenticated, and nothing else. A
    // retained webhook body is where an address or a token arrives and stays.
    expect(rows[0]?.payload_digest).toMatch(/^[0-9a-f]{64}$/u);
    const stored = JSON.stringify(rows[0]);
    expect(stored).not.toContain(body.occurredAt.slice(0, 4) + '-body');
    expect(stored).not.toContain('signature');
  });

  it.each([
    ['no signature at all', undefined],
    ['a signature that is not the right one', 'f'.repeat(64)],
    ['a signature of the wrong length', 'abc'],
  ])('refuses a callback with %s', async (_label, signature) => {
    const response = await handle(unsigned(feedbackBody(), signature));

    // One answer for every failure, because telling them apart would tell a
    // forger which part of the forgery to fix next.
    expect(response.status).toBe(401);
    expect(await events()).toHaveLength(0);
  });

  it('refuses a body mutated after it was signed', async () => {
    const original = feedbackBody();
    const raw = Buffer.from(JSON.stringify(original), 'utf8');
    const signature = createHmac(
      'sha256',
      LocalTestNotificationChannel.signingSecret,
    )
      .update(raw)
      .digest('hex');

    // The signature is genuine; the bytes are not the ones it covers. This is
    // the case a verifier that re-serializes before checking would let through.
    const response = await handle(
      unsigned({ ...original, feedbackType: 'token_invalid' }, signature),
    );

    expect(response.status).toBe(401);
    expect(await events()).toHaveLength(0);
  });

  it('refuses a feedback type this domain has no vocabulary for', async () => {
    const response = await handle(
      signed(feedbackBody({ feedbackType: 'quarantined' })),
    );

    // Refused rather than stored. A row nothing downstream can act on is a
    // row somebody later has to guess about.
    expect(response.status).toBe(401);
    expect(await events()).toHaveLength(0);
  });

  it('refuses a body past the byte limit before parsing it', async () => {
    const response = await handle(
      signed(feedbackBody({ padding: 'x'.repeat(70 * 1024) })),
    );

    expect(response.status).toBe(413);
    expect(await events()).toHaveLength(0);
  });

  it('costs one refused insert when the same event arrives fifty times', async () => {
    const body = feedbackBody();

    const responses = await Promise.all(
      Array.from({ length: 50 }, async () => handle(signed(body))),
    );

    // Duplication is expected rather than exceptional, and a redelivery gets
    // the same answer as a first delivery so a provider learns nothing about
    // which of its events were already seen.
    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(await events()).toHaveLength(1);
  });

  it('never creates a notification, whatever it says', async () => {
    const before = (await intents()).length;
    await handle(signed(feedbackBody({ feedbackType: 'delivered' })));
    await handle(signed(feedbackBody({ feedbackType: 'complained' })));

    // A verified event is an observation. There is no shape of callback that
    // makes this platform owe somebody a notice.
    expect((await intents()).length).toBe(before);
  });

  it('retires a device the provider says it invalidated', async () => {
    const owner = await consumer('feedback-device@velora.test');
    const token = 'd'.repeat(64);
    await handle(
      post('/v1/notifications/devices', owner, {
        installationId: 'feedback-install-1',
        platform: 'ios',
        token,
      }),
    );
    const fingerprint = createHash('sha256')
      .update(token, 'utf8')
      .digest('hex');

    await handle(
      signed(
        feedbackBody({
          feedbackType: 'token_invalid',
          tokenFingerprint: fingerprint,
        }),
      ),
    );
    const applied = await notifications.providerEvents.applyDue();

    expect(applied[0]?.kind).toBe('applied');
    const devices = await rowsOf<{ disable_reason: string | null }>(
      database.sql`select disable_reason from notifications_push_devices
        where recipient_id = ${owner.id}`,
    );
    // The one effect a verified event has with teeth, and it is safe in the
    // direction that matters: the worst case is a device that registers again.
    expect(devices[0]?.disable_reason).toBe('provider_invalidated');
    expect((await events())[0]?.state).toBe('processed');
  });

  it('records an event about something it has never heard of, and moves on', async () => {
    await handle(
      signed(
        feedbackBody({
          feedbackType: 'token_invalid',
          tokenFingerprint: 'e'.repeat(64),
        }),
      ),
    );

    const applied = await notifications.providerEvents.applyDue();

    // Not an error and not a reason to retry. A provider may report about a
    // device that was never registered here, and the honest response is to
    // record that it did not match rather than to keep asking.
    expect(applied[0]?.kind).toBe('unmatched');
    expect((await events())[0]?.state).toBe('processed');
  });

  it('refuses every callback while no provider is approved', async () => {
    const unavailable = new NotificationProviderEventService({
      channel: new UnavailableNotificationChannel(),
      logger,
      now,
      repository: notifications.repository,
    });

    const outcome = await unavailable.receive({
      correlationId: 'test',
      headers: new Headers(),
      rawBody: new Uint8Array(8),
    });

    // The posture every deployed environment has. Nothing is entitled to be
    // calling this at all, so the request is refused before verification.
    expect(outcome.kind).toBe('unavailable');
    expect(await events()).toHaveLength(0);
  });
});

describe('what an operator may see of delivery', () => {
  const operations = new NotificationOperations({
    deliveryChannel: 'local-test',
    now,
    repository: notifications.repository,
  });

  it('reports every declared state, including the zeroes', async () => {
    const state = await operations.operationalState();

    // A list that omitted the healthy states could not tell an operator
    // "nothing is stuck" apart from "the signal stopped arriving", and those
    // are opposite situations.
    expect(state.intents.map((entry) => entry.state).toSorted()).toEqual(
      [...notificationStates].toSorted(),
    );
    expect(state.failures.map((entry) => entry.state).toSorted()).toEqual(
      [...deliveryFailureClasses].toSorted(),
    );
    expect(state.suppressions.map((entry) => entry.state).toSorted()).toEqual(
      [...suppressionReasons].toSorted(),
    );
    expect(state.adapters.deliveryChannel).toBe('local-test');
  });

  it('carries no identifier of any kind', async () => {
    const { conversationId, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    await notifications.delivery.deliverDue();

    const serialized = JSON.stringify(await operations.operationalState());

    // A screen an operator watches all day must not become a window onto who
    // is being told about whom. Counts and ages only.
    expect(serialized).not.toContain(sender.id);
    expect(serialized).not.toContain(conversationId);
    expect(serialized).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u,
    );
  });

  it('answers about one delivery without naming who it was for', async () => {
    const { conversationId, recipient, sender } = await pair();
    await sendMessage(sender, {
      body: 'hello',
      clientMessageId: 'client-1',
      conversationId,
    });
    await relay.dispatchOnce();
    await notifications.delivery.deliverDue();
    const intentId = (await intents())[0]?.id ?? '';

    const detail = await operations.deliveryDetail(intentId);

    expect(detail?.id).toBe(intentId);
    expect(detail?.state).toBe('delivered');
    expect(detail?.channel).toBe('push');
    expect(detail?.templateKey).toBe(messageTemplateKey);
    // The question is why a notice did not go. A recipient, a subject, and a
    // payload answer none of it, so none of them is here.
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(recipient.id);
    expect(serialized).not.toContain(sender.id);
    expect(serialized).not.toContain(conversationId);
    expect(serialized).not.toContain('payload');
    // Whether a worker holds it, never which one: an operator cannot act on a
    // process identifier.
    expect(detail?.leaseHeld).toBe(false);
    expect(serialized).not.toContain('leaseOwner');
  });

  it('answers nothing for an identifier that matches nothing', async () => {
    expect(
      await operations.deliveryDetail(crypto.randomUUID()),
    ).toBeUndefined();
  });

  it('counts live registrations beside the reasons the rest were retired', async () => {
    const owner = await consumer('ops-device@velora.test');
    await handle(
      post('/v1/notifications/devices', owner, {
        installationId: 'ops-install-1',
        platform: 'ios',
        token: 'f'.repeat(64),
      }),
    );

    const devices = (await operations.operationalState()).devices;

    // The interesting comparison is between them: a fleet retiring faster than
    // it registers is a client bug, and neither number says so alone.
    expect(devices.find((entry) => entry.state === 'active')?.count).toBe(1);
    expect(devices.map((entry) => entry.state)).toContain(
      'provider_invalidated',
    );
  });
});
