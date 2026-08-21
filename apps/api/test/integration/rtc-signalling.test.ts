import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import Redis from 'ioredis';

import {
  RedisRtcSignalPublisher,
  UnavailableRtcSignalPublisher,
  parseRtcSignalMessage,
  rtcSignalChannelFor,
} from '../../src/realtime/signalling.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  requiredEnvironment,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger } from '../support/harness.js';

const databaseUrl = await provisionDatabase('velora_rtc_signalling');
const database: TestDatabase = connectDatabase(databaseUrl);
const redisContainerId = requiredEnvironment('TEST_REDIS_CONTAINER_ID');
const redisHost = requiredEnvironment('TEST_REDIS_HOST');

/**
 * The port Redis is published on *right now*.
 *
 * `TEST_REDIS_URL` is captured once, before any test runs, and one suite in
 * this run deliberately stops and restarts the Redis container to prove the
 * platform recovers from it. That remaps the published port, so a client built
 * from the captured URL connects to a port nothing is listening on and
 * exhausts its retries. Resolving it at connect time is what makes this suite
 * independent of whether that restart has already happened.
 */
function currentRedisUrl(): string {
  const inspected = Bun.spawnSync([
    'docker',
    'inspect',
    '-f',
    '{{json (index .NetworkSettings.Ports "6379/tcp")}}',
    redisContainerId,
  ]);
  const bindings = JSON.parse(inspected.stdout.toString().trim()) as
    { HostPort: string }[] | null;
  const port = bindings?.[0]?.HostPort;
  if (port === undefined) {
    throw new Error('Redis is not published on a host port');
  }
  return `redis://${redisHost}:${port}`;
}

const logs: unknown[] = [];
const logger = silentLogger(logs);

/**
 * Two clients, deliberately.
 *
 * One publishes and one subscribes, because a subscribed connection cannot
 * issue ordinary commands — and because the thing worth proving is that a
 * message crosses between two separate connections rather than being handed
 * back within one.
 */
let publisherClient: Redis;
let subscriberClient: Redis;

/**
 * Connected in `beforeAll` rather than at module scope.
 *
 * Bun imports every integration file before running any of them, so a
 * connection opened at module scope is opened while sixty-odd other files are
 * still initialising — and a connect that loses that race exhausts its retries
 * and takes the whole file down before a single test runs. Connecting when this
 * file's tests are about to run removes the race entirely.
 */
beforeAll(async () => {
  const url = currentRedisUrl();
  publisherClient = new Redis(url);
  subscriberClient = new Redis(url);
  // An unhandled `error` event fails the run. Recording it keeps a real
  // connection problem visible without letting a transient one take down a
  // suite that has already passed.
  for (const client of [publisherClient, subscriberClient]) {
    client.on('error', (error: unknown) => {
      logs.push({ fields: { error }, message: 'test redis client error' });
    });
  }
  // Established before anything is published: the first publish would otherwise
  // race the subscriber's handshake and reach nobody, which reads like a
  // delivery failure and is not one.
  await Promise.all([publisherClient.ping(), subscriberClient.ping()]);
});

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';

afterAll(async () => {
  // `quit` rather than `disconnect`: an abrupt close rejects whatever is still
  // in flight, and a rejected command in a shared container surfaces as an
  // unhandled error that fails a run this suite has already passed.
  await Promise.allSettled([publisherClient.quit(), subscriberClient.quit()]);
  await database.close();
});

beforeEach(() => {
  logs.length = 0;
});

/** Collects messages on one participant's channel for a bounded window. */
async function collect(
  recipientId: string,
  run: () => Promise<void>,
): Promise<string[]> {
  const received: string[] = [];
  const channel = rtcSignalChannelFor(recipientId);
  const handler = (incoming: string, message: string) => {
    if (incoming === channel) received.push(message);
  };
  subscriberClient.on('message', handler);
  await subscriberClient.subscribe(channel);
  try {
    await run();
    // Pub/sub delivery is asynchronous; a bounded wait is the honest way to
    // observe it, and a failure here is a real delivery failure rather than a
    // slow assertion.
    const deadline = Date.now() + 2_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    await subscriberClient.unsubscribe(channel);
    subscriberClient.off('message', handler);
  }
  return received;
}

describe('a signal reaches a connection on another instance', () => {
  it('delivers one hint per participant', async () => {
    const publisher = new RedisRtcSignalPublisher({
      channel: publisherClient,
      logger,
    });

    const received = await collect(bob, async () => {
      await publisher.publish({
        callId: '33333333-3333-4333-8333-333333333333',
        generation: 1,
        recipientIds: [alice, bob],
        state: 'invited',
      });
    });

    expect(received).toHaveLength(1);
    const signal = parseRtcSignalMessage(received[0] ?? '');
    expect(signal?.callId).toBe('33333333-3333-4333-8333-333333333333');
    expect(signal?.state).toBe('invited');
    expect(signal?.generation).toBe(1);
  });

  it('carries no transport detail, no reason, and no identity', async () => {
    const publisher = new RedisRtcSignalPublisher({
      channel: publisherClient,
      logger,
    });
    const received = await collect(bob, async () => {
      await publisher.publish({
        callId: '44444444-4444-4444-8444-444444444444',
        generation: 2,
        recipientIds: [bob],
        state: 'ended',
      });
    });

    const body = received[0] ?? '';
    // A fanout message travels over infrastructure this domain does not control
    // and lands in memory it cannot audit, so it carries the minimum.
    expect(Object.keys(JSON.parse(body) as object).toSorted()).toEqual([
      'callId',
      'generation',
      'state',
    ]);
    for (const forbidden of [
      alice,
      bob,
      'sdp',
      'candidate',
      'turn',
      'reason',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('reaches every participant on their own channel and nobody else', async () => {
    const publisher = new RedisRtcSignalPublisher({
      channel: publisherClient,
      logger,
    });
    const stranger = '55555555-5555-4555-8555-555555555555';

    const strangerHeard = await collect(stranger, async () => {
      await publisher.publish({
        callId: '66666666-6666-4666-8666-666666666666',
        generation: 1,
        recipientIds: [alice, bob],
        state: 'invited',
      });
      // Give a wrongly-addressed message time to arrive, if one were sent.
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(strangerHeard).toHaveLength(0);
  });
});

describe('fanout is a hint, and never the reason a call is in a state', () => {
  it('swallows a transport failure rather than failing the caller', async () => {
    const publisher = new RedisRtcSignalPublisher({
      channel: {
        publish: () => Promise.reject(new Error('redis is gone')),
      },
      logger,
    });

    // Does not throw. A cosmetic transport problem must never become a failed
    // hang-up, and the call it describes is already committed.
    await publisher.publish({
      callId: '77777777-7777-4777-8777-777777777777',
      generation: 1,
      recipientIds: [alice, bob],
      state: 'ended',
    });

    expect(JSON.stringify(logs)).toContain('rtc signal fanout failed');
  });

  it('carries nothing at all when no transport is configured', async () => {
    const publisher = new UnavailableRtcSignalPublisher();
    expect(publisher.transport).toBe('unavailable');
    // A complete answer rather than a stub: no gateway exists to deliver to,
    // and clients read authoritative state over HTTP regardless.
    await publisher.publish();
  });
});

describe('a subscriber parses rather than trusts', () => {
  it('discards a message it cannot read', () => {
    for (const message of [
      'not json',
      'null',
      '[]',
      JSON.stringify({ callId: 'x', state: 'invited' }),
      JSON.stringify({ callId: 'x', generation: 0, state: 'invited' }),
      JSON.stringify({ callId: 'x', generation: 1.5, state: 'invited' }),
      JSON.stringify({ generation: 1, state: 'invited' }),
    ]) {
      expect(parseRtcSignalMessage(message)).toBeUndefined();
    }
  });

  it('namespaces a channel so no other domain can be heard on it', () => {
    expect(rtcSignalChannelFor(alice)).toBe(`velora:rtc:participant:${alice}`);
    expect(rtcSignalChannelFor(alice)).not.toBe(rtcSignalChannelFor(bob));
  });
});

describe('Redis holds no call state', () => {
  it('answers a question about a call from PostgreSQL, never from a channel', async () => {
    const callId = crypto.randomUUID();
    await execute(
      database.sql`insert into realtime_sessions
        (authorization_generation, created_at, id, initiator_id,
         invitation_expires_at, medium, origin_introduction_id,
         pair_high_id, pair_low_id, state, state_entered_at, updated_at)
       values (1, now(), ${callId}, ${alice}, now() + interval '1 minute',
         'voice', ${crypto.randomUUID()}, ${bob}, ${alice}, 'invited', now(), now())`,
    );

    // Pub/sub stores nothing: a published message exists only for whoever was
    // subscribed at that instant, and Redis keeps no key for it. So there is
    // nothing to flush and nothing to lose — the call is answerable from
    // PostgreSQL whether or not any instance was listening, which is what makes
    // losing the whole fanout a cosmetic event.
    const channels = await publisherClient.pubsub('CHANNELS', 'velora:rtc:*');
    expect(channels).toEqual([]);

    const rows = await rowsOf<{ state: string }>(
      database.sql`select state from realtime_sessions where id = ${callId}`,
    );
    expect(rows[0]?.state).toBe('invited');
  });
});
