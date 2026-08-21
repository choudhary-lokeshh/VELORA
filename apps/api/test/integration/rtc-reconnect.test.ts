import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import {
  rtcJoinTimeoutMilliseconds,
  rtcReconnectGraceMilliseconds,
} from '../../src/realtime/policy.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { createUsersRuntime } from '../../src/users/composition.js';
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

const databaseUrl = await provisionDatabase('velora_rtc_reconnect');
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

let permitted = true;

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'rtc-reconnect-test',
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
  // Switchable, so a test can make safety change its mind mid-call without
  // rebuilding the runtime around it.
  eligibility: { mayCall: () => Promise.resolve(permitted) },
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
  clockOffsetMilliseconds = 0;
  permitted = true;
  logs.length = 0;
  await database.truncate();
});

/** A call in `connecting`, bound to a provider room. */
async function connectingCall(): Promise<string> {
  const callId = crypto.randomUUID();
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, state, state_entered_at, updated_at)
     values (1, now() - interval '1 second', now() - interval '2 seconds', ${callId},
       ${caller}, now() + interval '1 minute', 'video', ${crypto.randomUUID()},
       ${recipient}, ${caller}, 'accepted', now(), now())`,
  );
  await execute(
    database.sql`insert into realtime_participants (invited_at, accepted_at, role, session_id, user_id)
      values (now(), now(), 'caller', ${callId}, ${caller}),
             (now(), now(), 'recipient', ${callId}, ${recipient})`,
  );
  const bound = await realtime.service.establishProviderSession(callId);
  if (bound.kind !== 'call' || bound.view.state !== 'connecting') {
    throw new Error('the call did not reach a provider room');
  }
  return callId;
}

/** A call with media flowing. */
async function activeCall(): Promise<string> {
  const callId = await connectingCall();
  expect(await realtime.service.markConnected(callId)).toBe(true);
  return callId;
}

async function stateOf(callId: string): Promise<{
  end_reason: string | null;
  generation: string;
  state: string;
}> {
  const rows = await rowsOf<{
    end_reason: string | null;
    generation: string;
    state: string;
  }>(
    database.sql`select state, end_reason, authorization_generation::text as generation
      from realtime_sessions where id = ${callId}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no call');
  return row;
}

describe('a network drop is not a hang-up', () => {
  it('moves an active call to reconnecting and keeps everything else', async () => {
    const callId = await activeCall();
    const before = await stateOf(callId);

    expect(await realtime.service.markInterrupted(callId)).toBe(true);
    const after = await stateOf(callId);

    expect(after.state).toBe('reconnecting');
    expect(after.end_reason).toBeNull();
    // The call keeps its participants, its room, and — critically — its
    // authorization generation, so an interruption does not invalidate a
    // credential the other side is still using.
    expect(after.generation).toBe(before.generation);

    const participants = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_participants
        where session_id = ${callId}`,
    );
    expect(participants[0]?.count).toBe('2');
  });

  it('comes back to active when media returns within the grace period', async () => {
    const callId = await activeCall();
    await realtime.service.markInterrupted(callId);

    clockOffsetMilliseconds = rtcReconnectGraceMilliseconds - 1_000;
    expect(await realtime.service.markConnected(callId)).toBe(true);
    expect((await stateOf(callId)).state).toBe('active');
  });

  it('keeps the first connection instant rather than rewriting it', async () => {
    const callId = await activeCall();
    const first = await rowsOf<{ connected_at: Date }>(
      database.sql`select connected_at from realtime_sessions where id = ${callId}`,
    );
    await realtime.service.markInterrupted(callId);
    clockOffsetMilliseconds = 5_000;
    await realtime.service.markConnected(callId);

    const second = await rowsOf<{ connected_at: Date }>(
      database.sql`select connected_at from realtime_sessions where id = ${callId}`,
    );
    // When the call first carried media is a fact about the call, not about
    // its most recent leg.
    expect(second[0]?.connected_at).toEqual(first[0]?.connected_at);
  });
});

describe('a bounded wait ends on its own', () => {
  it('ends a reconnect that outlives its grace', async () => {
    const callId = await activeCall();
    await realtime.service.markInterrupted(callId);

    clockOffsetMilliseconds = rtcReconnectGraceMilliseconds + 1_000;
    const closed = await realtime.service.closeStalledCalls();
    expect(closed.reconnectExpired).toBe(1);

    const after = await stateOf(callId);
    // An ending rather than a failure: the call happened, and then nobody was
    // connected to it any more.
    expect(after.state).toBe('ended');
    expect(after.end_reason).toBe('reconnect_expired');
  });

  it('fails a call that never established media', async () => {
    const callId = await connectingCall();

    clockOffsetMilliseconds = rtcJoinTimeoutMilliseconds + 1_000;
    const closed = await realtime.service.closeStalledCalls();
    expect(closed.failedToConnect).toBe(1);

    const after = await stateOf(callId);
    // A failure to connect, said plainly, rather than something that looks
    // like somebody hung up.
    expect(after.state).toBe('failed');
    expect(after.end_reason).toBe('join_timeout');
  });

  it('closes each stalled call exactly once', async () => {
    const callId = await activeCall();
    await realtime.service.markInterrupted(callId);
    clockOffsetMilliseconds = rtcReconnectGraceMilliseconds + 1_000;

    const [first, second] = await Promise.all([
      realtime.service.closeStalledCalls(),
      realtime.service.closeStalledCalls(),
    ]);
    // Two sweeps racing produce one ending, because every closure is a guarded
    // transition rather than a read followed by a write.
    expect(first.reconnectExpired + second.reconnectExpired).toBe(1);
    expect((await stateOf(callId)).generation).toBe('2');
  });

  it('leaves a call alone while it is still inside its grace', async () => {
    const callId = await activeCall();
    await realtime.service.markInterrupted(callId);

    clockOffsetMilliseconds = rtcReconnectGraceMilliseconds - 1_000;
    const closed = await realtime.service.closeStalledCalls();
    expect(closed.reconnectExpired).toBe(0);
    expect((await stateOf(callId)).state).toBe('reconnecting');
  });

  it('frees the pair once a stalled call is closed', async () => {
    const callId = await connectingCall();
    clockOffsetMilliseconds = rtcJoinTimeoutMilliseconds + 1_000;
    await realtime.service.closeStalledCalls();

    const live = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions
        where pair_low_id = ${caller} and pair_high_id = ${recipient}
          and state not in ('ended', 'expired', 'rejected', 'cancelled', 'failed')`,
    );
    expect(live[0]?.count).toBe('0');
    expect((await stateOf(callId)).state).toBe('failed');
  });
});

describe('reconnecting is not a way around a decision', () => {
  it('refuses a fresh credential once the pair may no longer talk', async () => {
    const callId = await activeCall();
    await realtime.service.markInterrupted(callId);

    // Safety changes its mind while the call is interrupted.
    permitted = false;
    const outcome = await realtime.authorization.issue({
      actorId: caller,
      sessionId: callId,
    });
    // Reconnecting obtains a new credential, and obtaining one composes
    // eligibility again — so an interruption is exactly when a block takes
    // effect rather than a window that outlives it.
    expect(outcome.kind).toBe('not_permitted');
  });

  it('refuses a credential once the call has ended', async () => {
    const callId = await activeCall();
    await realtime.service.markInterrupted(callId);
    clockOffsetMilliseconds = rtcReconnectGraceMilliseconds + 1_000;
    await realtime.service.closeStalledCalls();

    const outcome = await realtime.authorization.issue({
      actorId: caller,
      sessionId: callId,
    });
    expect(outcome.kind).toBe('not_permitted');
  });

  it('cannot resume a call that has already ended', async () => {
    const callId = await activeCall();
    await execute(
      database.sql`update realtime_sessions
        set state = 'ended', ended_at = now(), end_reason = 'hung_up',
            authorization_generation = authorization_generation + 1
        where id = ${callId}`,
    );
    // Neither observation moves a terminal call. A late provider event about a
    // finished call is a divergence, not a resurrection.
    expect(await realtime.service.markConnected(callId)).toBe(false);
    expect(await realtime.service.markInterrupted(callId)).toBe(false);
    expect((await stateOf(callId)).state).toBe('ended');
  });

  it('refuses an interruption for a call nobody has connected to', async () => {
    const callId = await connectingCall();
    expect(await realtime.service.markInterrupted(callId)).toBe(false);
    expect((await stateOf(callId)).state).toBe('connecting');
  });
});

describe('recovery is bounded and orderly', () => {
  it('measures each deadline from when the state began', async () => {
    const callId = await activeCall();
    clockOffsetMilliseconds = 60_000;
    // The call has been active for a minute; interrupting it starts the grace
    // period now, not a minute ago.
    await realtime.service.markInterrupted(callId);

    const closed = await realtime.service.closeStalledCalls();
    expect(closed.reconnectExpired).toBe(0);
    expect((await stateOf(callId)).state).toBe('reconnecting');
  });

  it('closes many stalled calls in one pass without exceeding its bound', async () => {
    for (let index = 0; index < 3; index += 1) {
      const id = crypto.randomUUID();
      const low = `1111111${String(index)}-1111-4111-8111-111111111111`;
      await execute(
        database.sql`insert into realtime_sessions
          (authorization_generation, accepted_at, created_at, id, initiator_id,
           invitation_expires_at, medium, origin_introduction_id,
           pair_high_id, pair_low_id, state, state_entered_at, updated_at)
         values (1, now(), now(), ${id}, ${low}, now() + interval '1 minute',
           'voice', ${crypto.randomUUID()}, ${recipient}, ${low}, 'connecting', now(), now())`,
      );
    }
    clockOffsetMilliseconds = rtcJoinTimeoutMilliseconds + 1_000;

    const closed = await realtime.service.closeStalledCalls(2);
    // Bounded by the limit it was given rather than by how much work exists.
    expect(closed.failedToConnect).toBe(2);
    expect((await realtime.service.closeStalledCalls()).failedToConnect).toBe(
      1,
    );
  });
});
