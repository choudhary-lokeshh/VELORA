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

const databaseUrl = await provisionDatabase('velora_messaging');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
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
      return `messaging-test-${String(requesterSequence)}`;
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
  readonly id: string;
  readonly state: string;
}

interface ConversationBody {
  readonly counterpart: {
    readonly displayName: string;
    readonly id: string;
    readonly media: readonly { readonly id: string }[];
  };
  readonly createdAt: string;
  readonly id: string;
  readonly lastActivityAt: string;
  readonly lastMessageSequence: number;
  readonly lastReadSequence: number;
  readonly state: string;
}

interface MessageBody {
  readonly body: string;
  readonly clientMessageId: string;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly id: string;
  readonly senderId: string;
  readonly sequence: number;
}

async function signal(
  actor: Credentials,
  target: Credentials,
): Promise<IntroductionBody> {
  const response = await handle(
    post('/v1/discovery/introductions', actor, { candidateId: target.id }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as IntroductionBody;
}

/** A real block through the real consumer route, not a stubbed port. */
async function blockConsumer(
  actor: Credentials,
  targetId: string,
): Promise<void> {
  const response = await handle(post('/v1/safety/blocks', actor, { targetId }));
  expect(response.status).toBe(200);
}

/** Two people opting in independently, which is the only route to messaging. */
async function mutualIntroduction(
  first: Credentials,
  second: Credentials,
): Promise<string> {
  await signal(first, second);
  const introduction = await signal(second, first);
  expect(introduction.state).toBe('mutual');
  return introduction.id;
}

async function openConversation(
  actor: Credentials,
  introductionId: string,
): Promise<{ body: ConversationBody; status: number }> {
  const response = await handle(
    post('/v1/messaging/conversations', actor, { introductionId }),
  );
  return {
    body: (await response.json()) as ConversationBody,
    status: response.status,
  };
}

async function send(
  actor: Credentials,
  input: {
    readonly body: string;
    readonly clientMessageId: string;
    readonly conversationId: string;
  },
): Promise<{ body: MessageBody & { code?: string }; status: number }> {
  const response = await handle(post('/v1/messaging/messages', actor, input));
  return {
    body: (await response.json()) as MessageBody & { code?: string },
    status: response.status,
  };
}

async function readMessages(
  actor: Credentials,
  conversationId: string,
  query = '',
): Promise<{
  body: {
    readonly conversationId: string;
    readonly messages: readonly MessageBody[];
    readonly nextCursor?: string;
  };
  status: number;
}> {
  const response = await handle(
    get(
      `/v1/messaging/messages?conversationId=${conversationId}${query}`,
      actor,
    ),
  );
  return {
    body: (await response.json()) as {
      conversationId: string;
      messages: readonly MessageBody[];
      nextCursor?: string;
    },
    status: response.status,
  };
}

async function listConversations(
  actor: Credentials,
  query = '',
): Promise<{
  conversations: readonly ConversationBody[];
  nextCursor?: string;
}> {
  const response = await handle(
    get(`/v1/messaging/conversations${query}`, actor),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    conversations: readonly ConversationBody[];
    nextCursor?: string;
  };
}

async function messageCount(conversationId: string): Promise<number> {
  const rows = await rowsOf<{ count: string }>(
    database.sql`select count(*)::text as count from messaging_messages where conversation_id = ${conversationId}`,
  );
  return Number(rows[0]?.count ?? '0');
}

/** A pair that has already opened its conversation. */
async function connectedPair(prefix: string): Promise<{
  readonly conversationId: string;
  readonly first: Credentials;
  readonly introductionId: string;
  readonly second: Credentials;
}> {
  const first = await consumer(`${prefix}-first@velora.test`);
  const second = await consumer(`${prefix}-second@velora.test`);
  const introductionId = await mutualIntroduction(first, second);
  const opened = await openConversation(first, introductionId);
  expect(opened.status).toBe(200);
  return { conversationId: opened.body.id, first, introductionId, second };
}

describe('a conversation exists only because two people opted in', () => {
  it('refuses a conversation from a pending introduction', async () => {
    const first = await consumer('pending-first@velora.test');
    const second = await consumer('pending-second@velora.test');
    const pending = await signal(first, second);
    expect(pending.state).toBe('pending');

    const attempt = await openConversation(first, pending.id);
    expect(attempt.status).toBe(404);
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from messaging_conversations`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('opens exactly one conversation for a mutual introduction, from either side', async () => {
    const first = await consumer('mutual-first@velora.test');
    const second = await consumer('mutual-second@velora.test');
    const introductionId = await mutualIntroduction(first, second);

    const opened = await openConversation(first, introductionId);
    expect(opened.status).toBe(200);
    expect(opened.body.state).toBe('active');
    expect(opened.body.counterpart.id).toBe(second.id);
    expect(opened.body.lastMessageSequence).toBe(0);
    expect(opened.body.lastReadSequence).toBe(0);

    // Repeating is the same conversation, not a second one.
    const again = await openConversation(first, introductionId);
    expect(again.body.id).toBe(opened.body.id);

    // The other person opens the same one, and sees the first as counterpart.
    const otherSide = await openConversation(second, introductionId);
    expect(otherSide.status).toBe(200);
    expect(otherSide.body.id).toBe(opened.body.id);
    expect(otherSide.body.counterpart.id).toBe(first.id);

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from messaging_conversations`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('records which introduction authorized it', async () => {
    const pair = await connectedPair('origin');
    const rows = await rowsOf<{ origin_introduction_id: string }>(
      database.sql`select origin_introduction_id from messaging_conversations where id = ${pair.conversationId}`,
    );
    expect(rows[0]?.origin_introduction_id).toBe(pair.introductionId);
  });

  it('produces one conversation when both people open at the same instant', async () => {
    const first = await consumer('race-first@velora.test');
    const second = await consumer('race-second@velora.test');
    const introductionId = await mutualIntroduction(first, second);

    const outcomes = await Promise.all([
      openConversation(first, introductionId),
      openConversation(second, introductionId),
      openConversation(first, introductionId),
      openConversation(second, introductionId),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      200, 200, 200, 200,
    ]);
    expect(new Set(outcomes.map((outcome) => outcome.body.id)).size).toBe(1);
  });

  it('refuses somebody else’s introduction identically to one that is absent', async () => {
    const pair = await connectedPair('stranger');
    const outsider = await consumer('stranger-outsider@velora.test');

    const borrowed = await openConversation(outsider, pair.introductionId);
    expect(borrowed.status).toBe(404);
    const invented = await openConversation(outsider, crypto.randomUUID());
    expect(invented.status).toBe(404);
  });

  it('refuses a conversation once the introduction is no longer mutual', async () => {
    const first = await consumer('enforced-first@velora.test');
    const second = await consumer('enforced-second@velora.test');
    const introductionId = await mutualIntroduction(first, second);
    // Stands in for the enforcement closure Phase 8 will perform.
    await execute(
      database.sql`update discovery_introductions
        set state = 'closed', closed_at = now(), closed_reason = 'enforcement'
        where id = ${introductionId}`,
    );

    const attempt = await openConversation(first, introductionId);
    expect(attempt.status).toBe(404);
  });
});

describe('the server decides message order', () => {
  it('assigns strictly increasing positions across both senders', async () => {
    const pair = await connectedPair('order');
    const first = await send(pair.first, {
      body: 'first message',
      clientMessageId: 'order-0001',
      conversationId: pair.conversationId,
    });
    const second = await send(pair.second, {
      body: 'second message',
      clientMessageId: 'order-0002',
      conversationId: pair.conversationId,
    });
    const third = await send(pair.first, {
      body: 'third message',
      clientMessageId: 'order-0003',
      conversationId: pair.conversationId,
    });

    expect([first.status, second.status, third.status]).toEqual([
      200, 200, 200,
    ]);
    expect([
      first.body.sequence,
      second.body.sequence,
      third.body.sequence,
    ]).toEqual([1, 2, 3]);
    expect(first.body.senderId).toBe(pair.first.id);
    expect(second.body.senderId).toBe(pair.second.id);
  });

  it('gives sixteen simultaneous senders sixteen distinct positions', async () => {
    const pair = await connectedPair('concurrent-order');
    const outcomes = await Promise.all(
      Array.from({ length: 16 }, async (_, index) =>
        send(index % 2 === 0 ? pair.first : pair.second, {
          body: `simultaneous ${String(index)}`,
          clientMessageId: `concurrent-${String(index).padStart(4, '0')}`,
          conversationId: pair.conversationId,
        }),
      ),
    );

    expect(outcomes.every((outcome) => outcome.status === 200)).toBe(true);
    const sequences = outcomes.map((outcome) => outcome.body.sequence);
    expect(new Set(sequences).size).toBe(16);
    expect([...sequences].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect(await messageCount(pair.conversationId)).toBe(16);
  });

  it('takes no ordering instruction from the client', async () => {
    const pair = await connectedPair('client-order');
    const response = await handle(
      post('/v1/messaging/messages', pair.first, {
        body: 'trying to pick a position',
        clientMessageId: 'client-order-01',
        conversationId: pair.conversationId,
        createdAt: '1999-01-01T00:00:00.000Z',
        sequence: 9_999,
      }),
    );
    // The contract is strict, so an unknown field is a validation failure
    // rather than a field quietly ignored.
    expect(response.status).toBe(422);
    expect(await messageCount(pair.conversationId)).toBe(0);
  });

  it('moves the conversation’s activity forward with the newest message', async () => {
    const pair = await connectedPair('activity');
    const opened = await listConversations(pair.first);
    const before = opened.conversations[0]?.lastActivityAt ?? '';

    clockOffsetMilliseconds = 60_000;
    await send(pair.first, {
      body: 'a later message',
      clientMessageId: 'activity-0001',
      conversationId: pair.conversationId,
    });

    const after = await listConversations(pair.first);
    expect(after.conversations[0]?.lastMessageSequence).toBe(1);
    expect(
      new Date(after.conversations[0]?.lastActivityAt ?? 0).getTime(),
    ).toBeGreaterThan(new Date(before).getTime());
  });
});

describe('a send is idempotent', () => {
  for (const attempts of [2, 10, 50]) {
    it(`writes one message for ${String(attempts)} simultaneous duplicates`, async () => {
      const pair = await connectedPair(`duplicate-${String(attempts)}`);
      const outcomes = await Promise.all(
        Array.from({ length: attempts }, async () =>
          send(pair.first, {
            body: 'exactly once',
            clientMessageId: 'duplicate-key-0001',
            conversationId: pair.conversationId,
          }),
        ),
      );

      expect(outcomes.every((outcome) => outcome.status === 200)).toBe(true);
      expect(new Set(outcomes.map((outcome) => outcome.body.id)).size).toBe(1);
      expect(
        new Set(outcomes.map((outcome) => outcome.body.sequence)).size,
      ).toBe(1);
      expect(await messageCount(pair.conversationId)).toBe(1);

      // No ordering position is burned by a duplicate, because the conversation
      // lock is taken before the allocator rather than after it.
      const rows = await rowsOf<{ message_sequence: string }>(
        database.sql`select message_sequence::text from messaging_conversations where id = ${pair.conversationId}`,
      );
      expect(rows[0]?.message_sequence).toBe('1');
    });
  }

  it('returns the original message to a later retry', async () => {
    const pair = await connectedPair('retry');
    const original = await send(pair.first, {
      body: 'sent once',
      clientMessageId: 'retry-key-0001',
      conversationId: pair.conversationId,
    });
    clockOffsetMilliseconds = 5_000;
    const retry = await send(pair.first, {
      body: 'sent once',
      clientMessageId: 'retry-key-0001',
      conversationId: pair.conversationId,
    });

    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(original.body.id);
    expect(retry.body.createdAt).toBe(original.body.createdAt);
    expect(await messageCount(pair.conversationId)).toBe(1);
  });

  it('refuses a different body under a key that is already used', async () => {
    const pair = await connectedPair('mismatch');
    await send(pair.first, {
      body: 'the original',
      clientMessageId: 'mismatch-key-01',
      conversationId: pair.conversationId,
    });
    const conflicting = await send(pair.first, {
      body: 'something else entirely',
      clientMessageId: 'mismatch-key-01',
      conversationId: pair.conversationId,
    });

    expect(conflicting.status).toBe(409);
    expect(conflicting.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH');
    expect(await messageCount(pair.conversationId)).toBe(1);
  });

  it('scopes the key to one sender, so both people may use the same one', async () => {
    const pair = await connectedPair('scoped-key');
    const mine = await send(pair.first, {
      body: 'from the first person',
      clientMessageId: 'shared-key-0001',
      conversationId: pair.conversationId,
    });
    const theirs = await send(pair.second, {
      body: 'from the second person',
      clientMessageId: 'shared-key-0001',
      conversationId: pair.conversationId,
    });

    expect([mine.status, theirs.status]).toEqual([200, 200]);
    expect(mine.body.id).not.toBe(theirs.body.id);
    expect(await messageCount(pair.conversationId)).toBe(2);
  });
});

describe('only participants reach a conversation', () => {
  it('answers a stranger exactly as it answers an absent conversation', async () => {
    const pair = await connectedPair('outsider');
    const outsider = await consumer('outsider-third@velora.test');
    await send(pair.first, {
      body: 'private between two people',
      clientMessageId: 'outsider-0001',
      conversationId: pair.conversationId,
    });

    const attemptedSend = await send(outsider, {
      body: 'let me in',
      clientMessageId: 'outsider-0002',
      conversationId: pair.conversationId,
    });
    expect(attemptedSend.status).toBe(404);

    const attemptedRead = await readMessages(outsider, pair.conversationId);
    expect(attemptedRead.status).toBe(404);

    const invented = await readMessages(outsider, crypto.randomUUID());
    expect(invented.status).toBe(404);
    expect(await messageCount(pair.conversationId)).toBe(1);
  });

  it('lists only the caller’s own conversations', async () => {
    const pair = await connectedPair('listing');
    const outsider = await consumer('listing-outsider@velora.test');

    expect((await listConversations(outsider)).conversations).toEqual([]);
    const mine = await listConversations(pair.first);
    expect(mine.conversations.map((item) => item.id)).toEqual([
      pair.conversationId,
    ]);
  });

  it('never publishes the other person’s read position', async () => {
    const pair = await connectedPair('read-privacy');
    await send(pair.first, {
      body: 'have you read this',
      clientMessageId: 'read-privacy-01',
      conversationId: pair.conversationId,
    });
    await handle(
      post('/v1/messaging/conversations/read', pair.second, {
        conversationId: pair.conversationId,
        sequence: 1,
      }),
    );

    const senderView = await listConversations(pair.first);
    // The sender's own position, not the reader's.
    expect(senderView.conversations[0]?.lastReadSequence).toBe(0);
    expect(JSON.stringify(senderView)).not.toContain('counterpartRead');
  });
});

describe('history pages exactly once', () => {
  it('walks a conversation newest first without a gap or a repeat', async () => {
    const pair = await connectedPair('paging');
    for (let index = 1; index <= 25; index += 1) {
      const outcome = await send(index % 2 === 0 ? pair.first : pair.second, {
        body: `message ${String(index)}`,
        clientMessageId: `paging-${String(index).padStart(4, '0')}`,
        conversationId: pair.conversationId,
      });
      expect(outcome.status).toBe(200);
    }

    const seen: number[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const response = await readMessages(
        pair.first,
        pair.conversationId,
        `&pageSize=7${cursor === undefined ? '' : `&cursor=${cursor}`}`,
      );
      expect(response.status).toBe(200);
      seen.push(...response.body.messages.map((message) => message.sequence));
      cursor = response.body.nextCursor;
      if (cursor === undefined) break;
    }

    expect(cursor).toBeUndefined();
    expect(seen).toEqual(Array.from({ length: 25 }, (_, index) => 25 - index));
  });

  it('is unmoved by messages arriving mid-read', async () => {
    const pair = await connectedPair('paging-live');
    for (let index = 1; index <= 10; index += 1) {
      await send(pair.first, {
        body: `original ${String(index)}`,
        clientMessageId: `live-${String(index).padStart(4, '0')}`,
        conversationId: pair.conversationId,
      });
    }

    const firstPage = await readMessages(
      pair.first,
      pair.conversationId,
      '&pageSize=4',
    );
    expect(firstPage.body.messages.map((item) => item.sequence)).toEqual([
      10, 9, 8, 7,
    ]);

    // Five more arrive while the reader is between pages.
    for (let index = 11; index <= 15; index += 1) {
      await send(pair.second, {
        body: `arrived later ${String(index)}`,
        clientMessageId: `live-${String(index).padStart(4, '0')}`,
        conversationId: pair.conversationId,
      });
    }

    const secondPage = await readMessages(
      pair.first,
      pair.conversationId,
      `&pageSize=4&cursor=${firstPage.body.nextCursor ?? ''}`,
    );
    // Exactly where the first page ended, with nothing repeated and nothing
    // between 6 and 7 skipped.
    expect(secondPage.body.messages.map((item) => item.sequence)).toEqual([
      6, 5, 4, 3,
    ]);
  });

  it('refuses a cursor minted for another conversation', async () => {
    const first = await connectedPair('cursor-a');
    const second = await connectedPair('cursor-b');
    for (let index = 1; index <= 3; index += 1) {
      await send(first.first, {
        body: `first conversation ${String(index)}`,
        clientMessageId: `cursor-a-${String(index).padStart(4, '0')}`,
        conversationId: first.conversationId,
      });
    }
    const page = await readMessages(
      first.first,
      first.conversationId,
      '&pageSize=1',
    );
    const borrowed = page.body.nextCursor ?? '';
    expect(borrowed.length).toBeGreaterThan(0);

    const response = await handle(
      get(
        `/v1/messaging/messages?conversationId=${second.conversationId}&cursor=${borrowed}`,
        second.first,
      ),
    );
    expect(response.status).toBe(422);
  });

  it('orders the conversation list by activity, newest first', async () => {
    const older = await connectedPair('list-older');
    const newerSecond = await consumer('list-newer-second@velora.test');
    const newerIntroduction = await mutualIntroduction(
      older.first,
      newerSecond,
    );
    const newer = await openConversation(older.first, newerIntroduction);

    clockOffsetMilliseconds = 30_000;
    await send(older.first, {
      body: 'reviving the older conversation',
      clientMessageId: 'list-order-0001',
      conversationId: older.conversationId,
    });

    const listing = await listConversations(older.first);
    expect(listing.conversations.map((item) => item.id)).toEqual([
      older.conversationId,
      newer.body.id,
    ]);
  });
});

describe('safety is re-asked at the moment of the action', () => {
  it('refuses a send once the pair may no longer interact', async () => {
    const pair = await connectedPair('blocked-send');
    const accepted = await send(pair.first, {
      body: 'before the block',
      clientMessageId: 'blocked-0001',
      conversationId: pair.conversationId,
    });
    expect(accepted.status).toBe(200);

    await blockConsumer(pair.first, pair.second.id);
    const refusedSend = await send(pair.first, {
      body: 'after the block',
      clientMessageId: 'blocked-0002',
      conversationId: pair.conversationId,
    });

    expect(refusedSend.status).toBe(409);
    expect(refusedSend.body.code).toBe('ACTION_NOT_PERMITTED');
    // Refused before durable acceptance, not accepted and then hidden.
    expect(await messageCount(pair.conversationId)).toBe(1);
  });

  it('refuses the blocked person in both directions', async () => {
    const pair = await connectedPair('blocked-both');
    await blockConsumer(pair.first, pair.second.id);

    const fromFirst = await send(pair.first, {
      body: 'from one side',
      clientMessageId: 'both-ways-0001',
      conversationId: pair.conversationId,
    });
    const fromSecond = await send(pair.second, {
      body: 'from the other',
      clientMessageId: 'both-ways-0002',
      conversationId: pair.conversationId,
    });

    expect([fromFirst.status, fromSecond.status]).toEqual([409, 409]);
    expect(await messageCount(pair.conversationId)).toBe(0);
  });

  it('withholds the conversation and its history while the block stands', async () => {
    const pair = await connectedPair('blocked-history');
    await send(pair.first, {
      body: 'exchanged before the block',
      clientMessageId: 'history-0001',
      conversationId: pair.conversationId,
    });
    await blockConsumer(pair.first, pair.second.id);

    expect((await listConversations(pair.second)).conversations).toEqual([]);
    const history = await readMessages(pair.second, pair.conversationId);
    expect(history.status).toBe(409);

    // Nothing was deleted to achieve that. Post-block history visibility is an
    // open decision, and the fail-closed reading is reversible only because the
    // rows are still there.
    expect(await messageCount(pair.conversationId)).toBe(1);
  });

  it('refuses a send once the introduction behind it is closed', async () => {
    const pair = await connectedPair('closed-introduction');
    await execute(
      database.sql`update discovery_introductions
        set state = 'closed', closed_at = now(), closed_reason = 'enforcement'
        where id = ${pair.introductionId}`,
    );

    const attempt = await send(pair.first, {
      body: 'the connection is gone',
      clientMessageId: 'closed-intro-01',
      conversationId: pair.conversationId,
    });
    expect(attempt.status).toBe(409);
    expect(await messageCount(pair.conversationId)).toBe(0);
  });

  it('refuses a send into a conversation enforcement has closed', async () => {
    const pair = await connectedPair('closed-conversation');
    await execute(
      database.sql`update messaging_conversations set state = 'closed' where id = ${pair.conversationId}`,
    );

    const attempt = await send(pair.first, {
      body: 'talking into a closed room',
      clientMessageId: 'closed-room-0001',
      conversationId: pair.conversationId,
    });
    expect(attempt.status).toBe(409);
    expect(await messageCount(pair.conversationId)).toBe(0);
  });

  it('refuses an account that has stopped being admitted', async () => {
    const pair = await connectedPair('suspended');
    await execute(
      database.sql`update users_accounts
        set status = 'restricted', status_reason = 'safety_enforcement'
        where id = ${pair.first.id}`,
    );

    const attempt = await send(pair.first, {
      body: 'still here',
      clientMessageId: 'suspended-0001',
      conversationId: pair.conversationId,
    });
    expect(attempt.status).toBe(409);
    expect(attempt.body.code).toBe('ACCOUNT_NOT_ELIGIBLE');
    expect(await messageCount(pair.conversationId)).toBe(0);
  });
});

describe('read state is monotonic', () => {
  it('never retreats and never exceeds what exists', async () => {
    const pair = await connectedPair('read-state');
    for (let index = 1; index <= 3; index += 1) {
      await send(pair.first, {
        body: `message ${String(index)}`,
        clientMessageId: `read-state-${String(index).padStart(4, '0')}`,
        conversationId: pair.conversationId,
      });
    }

    const acknowledge = async (sequence: number) => {
      const response = await handle(
        post('/v1/messaging/conversations/read', pair.second, {
          conversationId: pair.conversationId,
          sequence,
        }),
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { lastReadSequence: number };
    };

    expect((await acknowledge(2)).lastReadSequence).toBe(2);
    // An older acknowledgement is accepted and changes nothing.
    expect((await acknowledge(1)).lastReadSequence).toBe(2);
    // Beyond what exists is clamped rather than believed.
    expect((await acknowledge(9_999)).lastReadSequence).toBe(3);
  });

  it('keeps each person’s position separate', async () => {
    const pair = await connectedPair('read-separate');
    await send(pair.first, {
      body: 'one message',
      clientMessageId: 'read-separate-01',
      conversationId: pair.conversationId,
    });
    await handle(
      post('/v1/messaging/conversations/read', pair.second, {
        conversationId: pair.conversationId,
        sequence: 1,
      }),
    );

    const readerView = await listConversations(pair.second);
    const senderView = await listConversations(pair.first);
    expect(readerView.conversations[0]?.lastReadSequence).toBe(1);
    expect(senderView.conversations[0]?.lastReadSequence).toBe(0);
  });

  it('refuses a read acknowledgement from a stranger', async () => {
    const pair = await connectedPair('read-stranger');
    const outsider = await consumer('read-stranger-third@velora.test');
    const response = await handle(
      post('/v1/messaging/conversations/read', outsider, {
        conversationId: pair.conversationId,
        sequence: 1,
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('a message body is bounded and never logged', () => {
  it('refuses an oversized, blank, or control-bearing body', async () => {
    const pair = await connectedPair('body-bounds');
    for (const body of [
      'a'.repeat(4_001),
      '   ',
      'hidden\u0000character',
      '',
    ]) {
      const attempt = await send(pair.first, {
        body,
        clientMessageId: 'body-bounds-0001',
        conversationId: pair.conversationId,
      });
      expect(attempt.status).toBe(422);
    }
    expect(await messageCount(pair.conversationId)).toBe(0);
  });

  it('accepts a body at the published limit', async () => {
    const pair = await connectedPair('body-limit');
    const attempt = await send(pair.first, {
      body: 'a'.repeat(4_000),
      clientMessageId: 'body-limit-0001',
      conversationId: pair.conversationId,
    });
    expect(attempt.status).toBe(200);
  });

  it('writes no message body to a log', async () => {
    const pair = await connectedPair('log-privacy');
    const secret = 'a-body-that-must-never-be-logged-8f2a';
    await send(pair.first, {
      body: secret,
      clientMessageId: 'log-privacy-0001',
      conversationId: pair.conversationId,
    });
    await readMessages(pair.first, pair.conversationId);
    await listConversations(pair.first);

    expect(JSON.stringify(logs)).not.toContain(secret);
    // Nor is there a log field named for one, which is how a body ends up in a
    // log without anybody deciding to put it there.
    const fieldNames = logs.flatMap((entry) =>
      Object.keys((entry as { fields?: Record<string, unknown> }).fields ?? {}),
    );
    expect(fieldNames).not.toContain('body');
    expect(fieldNames).not.toContain('message');
  });
});

describe('nothing is deleted to satisfy a policy that does not exist', () => {
  it('keeps every message with no expiry column and no sweep', async () => {
    const pair = await connectedPair('retention');
    await send(pair.first, {
      body: 'kept until a policy says otherwise',
      clientMessageId: 'retention-0001',
      conversationId: pair.conversationId,
    });

    // A year later, by the clock the domain reads.
    clockOffsetMilliseconds = 365 * 24 * 60 * 60 * 1000;
    const history = await readMessages(pair.first, pair.conversationId);
    expect(history.body.messages).toHaveLength(1);
    expect(await messageCount(pair.conversationId)).toBe(1);

    const columns = await rowsOf<{ column_name: string }>(
      database.sql`select column_name from information_schema.columns
        where table_name = 'messaging_messages'`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain('expires_at');
    expect(names).not.toContain('deleted_at');
  });
});

describe('the database enforces the messaging invariants', () => {
  it('owns exactly its own tables, outbox included, and nothing else', async () => {
    const rows = await rowsOf<{ table_name: string }>(
      database.sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'messaging_%'
        order by table_name`,
    );
    // The outbox is one of them. A published fact has to commit with the
    // message it describes, so the table that holds it belongs to this domain
    // rather than to a shared events schema.
    expect(rows.map((row) => row.table_name)).toEqual([
      'messaging_conversations',
      'messaging_messages',
      'messaging_outbox',
      'messaging_participants',
    ]);
  });

  it('refuses a second message at a position that is taken', async () => {
    const pair = await connectedPair('constraint-order');
    await send(pair.first, {
      body: 'holds position one',
      clientMessageId: 'constraint-ord-01',
      conversationId: pair.conversationId,
    });
    const duplicated = await refused(async () =>
      execute(
        database.sql`insert into messaging_messages
          (body, client_message_id, conversation_id, created_at, id, sender_id, sequence, updated_at)
          values ('collides', 'constraint-ord-02', ${pair.conversationId}, now(),
            ${crypto.randomUUID()}, ${pair.first.id}, 1, now())`,
      ),
    );
    expect(duplicated).toBe(true);
  });

  it('refuses a blank body, a zero position, and an unordered pair', async () => {
    const pair = await connectedPair('constraint-shape');
    const blank = await refused(async () =>
      execute(
        database.sql`insert into messaging_messages
          (body, client_message_id, conversation_id, created_at, id, sender_id, sequence, updated_at)
          values ('   ', 'constraint-blank1', ${pair.conversationId}, now(),
            ${crypto.randomUUID()}, ${pair.first.id}, 90, now())`,
      ),
    );
    const zero = await refused(async () =>
      execute(
        database.sql`insert into messaging_messages
          (body, client_message_id, conversation_id, created_at, id, sender_id, sequence, updated_at)
          values ('fine', 'constraint-zero01', ${pair.conversationId}, now(),
            ${crypto.randomUUID()}, ${pair.first.id}, 0, now())`,
      ),
    );
    const unordered = await refused(async () =>
      execute(
        database.sql`insert into messaging_conversations
          (created_at, id, last_activity_at, origin_introduction_id, pair_high_id, pair_low_id, state, updated_at)
          values (now(), ${crypto.randomUUID()}, now(), ${crypto.randomUUID()},
            '00000000-0000-4000-8000-000000000001',
            '00000000-0000-4000-8000-000000000002', 'active', now())`,
      ),
    );
    const unknownState = await refused(async () =>
      execute(
        database.sql`insert into messaging_conversations
          (created_at, id, last_activity_at, origin_introduction_id, pair_high_id, pair_low_id, state, updated_at)
          values (now(), ${crypto.randomUUID()}, now(), ${crypto.randomUUID()},
            '00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000001', 'restricted', now())`,
      ),
    );

    expect([blank, zero, unordered, unknownState]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it('refuses a second conversation for the same pair', async () => {
    const pair = await connectedPair('constraint-pair');
    const rows = await rowsOf<{ pair_high_id: string; pair_low_id: string }>(
      database.sql`select pair_high_id, pair_low_id from messaging_conversations where id = ${pair.conversationId}`,
    );
    const existing = rows[0];
    expect(existing).toBeDefined();
    const duplicated = await refused(async () =>
      execute(
        database.sql`insert into messaging_conversations
          (created_at, id, last_activity_at, origin_introduction_id, pair_high_id, pair_low_id, state, updated_at)
          values (now(), ${crypto.randomUUID()}, now(), ${crypto.randomUUID()},
            ${existing?.pair_high_id ?? ''}, ${existing?.pair_low_id ?? ''}, 'active', now())`,
      ),
    );
    expect(duplicated).toBe(true);
  });

  it('refuses a read position recorded without a moment', async () => {
    const pair = await connectedPair('constraint-read');
    const invalid = await refused(async () =>
      execute(
        database.sql`update messaging_participants
          set last_read_sequence = 3, last_read_at = null
          where conversation_id = ${pair.conversationId} and user_id = ${pair.first.id}`,
      ),
    );
    expect(invalid).toBe(true);
  });
});
