import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import { LocalTestRtcProvider } from '../../src/realtime/local-test-provider.js';
import { maximumRtcProviderEventBytes } from '../../src/realtime/policy.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testMediaRuntime,
  testServerConfig,
} from '../support/harness.js';
import { mediaEnvironment } from '../support/profile-media.js';

const databaseUrl = await provisionDatabase('velora_rtc_provider_events');
const database: TestDatabase = connectDatabase(databaseUrl);

const config = testServerConfig({
  REALTIME_CALL_ELIGIBILITY: 'composed',
  REALTIME_RTC_PROVIDER: 'local-test',
  ...mediaEnvironment,
});

const now = () => new Date();
const logs: unknown[] = [];
const logger = silentLogger(logs);

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'rtc-provider-events-test',
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

const caller = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  logs.length = 0;
  await database.truncate();
});

/** A call bound to a provider room, so events have something to be about. */
async function boundCall(): Promise<{ callId: string; roomId: string }> {
  const callId = crypto.randomUUID();
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, state, updated_at)
     values (1, now(), now(), ${callId}, ${caller}, now() + interval '1 minute',
       'voice', ${crypto.randomUUID()}, ${recipient}, ${caller}, 'accepted', now())`,
  );
  await execute(
    database.sql`insert into realtime_participants (invited_at, accepted_at, role, session_id, user_id)
      values (now(), now(), 'caller', ${callId}, ${caller}),
             (now(), now(), 'recipient', ${callId}, ${recipient})`,
  );
  await realtime.service.establishProviderSession(callId);
  const rows = await rowsOf<{ provider_reference: string }>(
    database.sql`select provider_reference from realtime_sessions where id = ${callId}`,
  );
  const roomId = rows[0]?.provider_reference;
  if (roomId === undefined) throw new Error('unbound call');
  return { callId, roomId };
}

function signedEvent(input: {
  readonly eventId: string;
  readonly eventType?: string;
  readonly roomId: string;
  readonly state?: string;
}): { body: Uint8Array; headers: Headers } {
  const body = new TextEncoder().encode(
    JSON.stringify({
      eventId: input.eventId,
      eventType: input.eventType ?? 'session.live',
      providerReference: input.roomId,
      state: input.state ?? 'live',
    }),
  );
  return {
    body,
    headers: new Headers({
      'x-velora-rtc-test-signature': LocalTestRtcProvider.sign(body),
    }),
  };
}

async function eventRows(): Promise<
  { attempts: number; payload_digest: string; provider_event_id: string }[]
> {
  return rowsOf(
    database.sql`select provider_event_id, payload_digest, attempts
      from realtime_provider_events order by received_at`,
  );
}

describe('bytes authenticate before anything parses them', () => {
  it('refuses an unsigned callback and records nothing', async () => {
    const { roomId } = await boundCall();
    const { body } = signedEvent({ eventId: 'e1', roomId });

    const outcome = await realtime.providerEvents.receive({
      correlationId: 'c1',
      headers: new Headers(),
      rawBody: body,
    });
    expect(outcome).toEqual({ kind: 'rejected', reason: 'unverified' });
    expect(await eventRows()).toHaveLength(0);
  });

  it('refuses a body mutated after it was signed', async () => {
    const { roomId } = await boundCall();
    const { headers } = signedEvent({ eventId: 'e2', roomId });
    const mutated = new TextEncoder().encode(
      JSON.stringify({
        eventId: 'e2',
        eventType: 'session.live',
        providerReference: 'somebody-elses-room',
        state: 'live',
      }),
    );

    const outcome = await realtime.providerEvents.receive({
      correlationId: 'c2',
      headers,
      rawBody: mutated,
    });
    expect(outcome).toEqual({ kind: 'rejected', reason: 'unverified' });
    expect(await eventRows()).toHaveLength(0);
  });

  it('refuses an oversized body before reading it as anything', async () => {
    const oversized = new Uint8Array(maximumRtcProviderEventBytes + 1);
    const outcome = await realtime.providerEvents.receive({
      correlationId: 'c3',
      headers: new Headers({ 'x-velora-rtc-test-signature': 'anything' }),
      rawBody: oversized,
    });
    // The limit does not depend on reading what it is limiting.
    expect(outcome).toEqual({ kind: 'rejected', reason: 'oversized' });
    expect(await eventRows()).toHaveLength(0);
  });

  it('answers every rejection the same way', async () => {
    const { roomId } = await boundCall();
    const unsigned = await realtime.providerEvents.receive({
      correlationId: 'c4',
      headers: new Headers(),
      rawBody: signedEvent({ eventId: 'e3', roomId }).body,
    });
    const wrongSignature = await realtime.providerEvents.receive({
      correlationId: 'c5',
      headers: new Headers({ 'x-velora-rtc-test-signature': 'deadbeef' }),
      rawBody: signedEvent({ eventId: 'e4', roomId }).body,
    });
    // Telling a forger which part of the forgery to fix is the one thing a
    // rejection must not do.
    expect(unsigned).toEqual(wrongSignature);
  });
});

describe('the body is discarded and a digest is kept', () => {
  it('stores a digest of the exact bytes and no payload column', async () => {
    const { roomId } = await boundCall();
    const { body, headers } = signedEvent({ eventId: 'e5', roomId });
    await realtime.providerEvents.receive({
      correlationId: 'c6',
      headers,
      rawBody: body,
    });

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload_digest).toMatch(/^[0-9a-f]{64}$/u);

    const columns = await rowsOf<{ column_name: string }>(
      database.sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'realtime_provider_events'`,
    );
    const names = columns.map((row) => row.column_name);
    // No body, and nowhere a body could hide.
    for (const forbidden of ['payload', 'body', 'raw_body', 'headers']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('duplication, reordering, and replay are expected', () => {
  it('records one receipt however many times an event is delivered', async () => {
    const { roomId } = await boundCall();
    const { body, headers } = signedEvent({ eventId: 'e6', roomId });

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const outcome = await realtime.providerEvents.receive({
        correlationId: `c-${String(attempt)}`,
        headers,
        rawBody: body,
      });
      // Every delivery is accepted; the platform already holds the fact.
      expect(outcome).toEqual({ kind: 'accepted' });
    }
    expect(await eventRows()).toHaveLength(1);
  });

  it('keeps two different events about one room apart', async () => {
    const { roomId } = await boundCall();
    for (const eventId of ['e7', 'e8']) {
      const { body, headers } = signedEvent({ eventId, roomId });
      await realtime.providerEvents.receive({
        correlationId: eventId,
        headers,
        rawBody: body,
      });
    }
    const rows = await eventRows();
    expect(rows.map((row) => row.provider_event_id).toSorted()).toEqual([
      'e7',
      'e8',
    ]);
  });

  it('accepts an event about a room this platform no longer knows', async () => {
    const { body, headers } = signedEvent({
      eventId: 'e9',
      roomId: 'a-room-nobody-here-made',
    });
    // A provider is entitled to talk about a room the platform has forgotten.
    // Recording it and doing nothing is the honest outcome; refusing would make
    // the provider retry forever.
    const outcome = await realtime.providerEvents.receive({
      correlationId: 'c9',
      headers,
      rawBody: body,
    });
    expect(outcome).toEqual({ kind: 'accepted' });
    expect(await eventRows()).toHaveLength(1);
  });
});

describe('an event is an observation, never an instruction', () => {
  it('does not move the call it names', async () => {
    const { callId, roomId } = await boundCall();
    const before = await rowsOf<{ generation: string; state: string }>(
      database.sql`select state, authorization_generation::text as generation
        from realtime_sessions where id = ${callId}`,
    );

    const { body, headers } = signedEvent({
      eventId: 'e10',
      roomId,
      state: 'live',
    });
    await realtime.providerEvents.receive({
      correlationId: 'c10',
      headers,
      rawBody: body,
    });

    const after = await rowsOf<{ generation: string; state: string }>(
      database.sql`select state, authorization_generation::text as generation
        from realtime_sessions where id = ${callId}`,
    );
    // Recording a provider's account of a call changes nothing about the
    // platform's own record of it.
    expect(after[0]?.state).toBe(before[0]?.state);
    expect(after[0]?.generation).toBe(before[0]?.generation);
  });

  it('creates no participant and no credential', async () => {
    const { callId, roomId } = await boundCall();
    const { body, headers } = signedEvent({ eventId: 'e11', roomId });
    await realtime.providerEvents.receive({
      correlationId: 'c11',
      headers,
      rawBody: body,
    });

    const participants = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_participants
        where session_id = ${callId}`,
    );
    const issuances = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_join_issuances
        where session_id = ${callId}`,
    );
    expect(participants[0]?.count).toBe('2');
    expect(issuances[0]?.count).toBe('0');
  });

  it('cannot revive a call the platform ended', async () => {
    const { callId, roomId } = await boundCall();
    await execute(
      database.sql`update realtime_sessions
        set state = 'ended', ended_at = now(), end_reason = 'hung_up',
            authorization_generation = authorization_generation + 1
        where id = ${callId}`,
    );

    const { body, headers } = signedEvent({
      eventId: 'e12',
      roomId,
      state: 'live',
    });
    await realtime.providerEvents.receive({
      correlationId: 'c12',
      headers,
      rawBody: body,
    });

    const rows = await rowsOf<{ end_reason: string; state: string }>(
      database.sql`select state, end_reason from realtime_sessions where id = ${callId}`,
    );
    // The provider insists the room is live. The platform ended the call, and
    // that is the answer — the divergence is for reconciliation to close.
    expect(rows[0]?.state).toBe('ended');
    expect(rows[0]?.end_reason).toBe('hung_up');
  });
});

describe('nothing is entitled to call this when no provider is approved', () => {
  it('refuses intake outright', async () => {
    const unavailable = createRealtimeRuntime({
      config: testServerConfig({
        REALTIME_CALL_ELIGIBILITY: 'composed',
        ...mediaEnvironment,
      }),
      connections: discovery.connections,
      database: database.drizzle,
      eligibility: { mayCall: () => Promise.resolve(true) },
      logger,
      now,
      onboarding: users.onboarding,
    });
    const outcome = await unavailable.providerEvents.receive({
      correlationId: 'c13',
      headers: new Headers(),
      rawBody: new TextEncoder().encode('{}'),
    });
    expect(outcome).toEqual({ kind: 'unavailable' });
  });
});

describe('a verified event never reaches a log', () => {
  it('logs no payload and no signature when it refuses one', async () => {
    const { roomId } = await boundCall();
    const { body } = signedEvent({ eventId: 'secret-event-id', roomId });
    await realtime.providerEvents.receive({
      correlationId: 'c14',
      headers: new Headers({ 'x-velora-rtc-test-signature': 'wrong' }),
      rawBody: body,
    });
    const written = JSON.stringify(logs);
    expect(written).toContain('rtc provider event failed verification');
    expect(written).not.toContain('secret-event-id');
    expect(written).not.toContain(roomId);
  });
});
