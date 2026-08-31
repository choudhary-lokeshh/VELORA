import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import { RtcCallEnforcement } from '../../src/realtime/enforcement.js';
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

const databaseUrl = await provisionDatabase('velora_rtc_safety');
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
    requesterReference: () => 'rtc-safety-test',
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

/**
 * The same contract the application composes, built the same way.
 *
 * It takes a database handle rather than REALTIME's runtime, which is what
 * keeps the composition acyclic — and it means this suite exercises the object
 * production uses rather than a stand-in wired for the test.
 */
const callEnforcement = new RtcCallEnforcement(database.drizzle);

const safety = createSafetyRuntime({
  accounts: users.enforcement,
  calls: callEnforcement,
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
  enforcement: safety.eligibility,
  logger,
  now,
  onboarding: users.onboarding,
  safety: safety.directory,
  standing: users.standing,
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

/** Two accounts that exist, so a block can name one. */
async function accounts(): Promise<void> {
  for (const id of [caller, recipient]) {
    await execute(
      database.sql`insert into auth_accounts (created_at, id, status, updated_at)
        values (now(), ${id}, 'active', now())`,
    );
    await execute(
      database.sql`insert into users_accounts
        (auth_account_id, created_at, id, status, status_changed_at, updated_at)
        values (${id}, now(), ${id}, 'active', now(), now())`,
    );
  }
}

/** A call for the pair, in the given state. */
async function callInState(state: string): Promise<string> {
  const id = crypto.randomUUID();
  const terminal = ['ended', 'expired', 'rejected', 'cancelled', 'failed'];
  const answered = state !== 'invited';
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, state, state_entered_at, updated_at,
       ended_at, end_reason)
     values (1, ${answered ? database.sql`now() - interval '1 second'` : null},
       now() - interval '2 seconds', ${id}, ${caller},
       now() + interval '1 minute', 'voice', ${crypto.randomUUID()},
       ${recipient}, ${caller}, ${state}, now(), now(),
       ${terminal.includes(state) ? database.sql`now()` : null},
       ${terminal.includes(state) ? 'hung_up' : null})`,
  );
  await execute(
    database.sql`insert into realtime_participants (invited_at, accepted_at, role, session_id, user_id)
      values (now(), ${answered ? database.sql`now()` : null}, 'caller', ${id}, ${caller}),
             (now(), ${answered ? database.sql`now()` : null}, 'recipient', ${id}, ${recipient})`,
  );
  return id;
}

async function stateOf(id: string): Promise<{
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
      from realtime_sessions where id = ${id}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no call');
  return row;
}

async function accountRow(id: string) {
  const found = await users.service.findAccountById(id);
  if (found === undefined) throw new Error('no account');
  return found;
}

describe('a block ends the call it is placed during', () => {
  for (const state of [
    'invited',
    'accepted',
    'connecting',
    'active',
    'reconnecting',
  ]) {
    it(`ends a call that is ${state} when one of them blocks the other`, async () => {
      await accounts();
      const id = await callInState(state);

      const outcome = await safety.service.block(
        await accountRow(caller),
        recipient,
      );
      expect(outcome.kind).toBe('blocked');

      const after = await stateOf(id);
      // Refusing the *next* thing the pair does would leave the conversation
      // they are having right now running, which is the one moment a block most
      // needs to work.
      expect(after.state).toBe('ended');
      expect(after.end_reason).toBe('safety_block');
      // Every credential outstanding for this call is dead at the platform
      // boundary the instant the generation moves.
      expect(after.generation).toBe('2');
    });
  }

  it('records the ending as the platform decision it is', async () => {
    await accounts();
    const id = await callInState('invited');
    await safety.service.block(await accountRow(recipient), caller);

    const after = await stateOf(id);
    // A ringing call blocked mid-ring is neither declined nor withdrawn.
    // Recording it as either would say one of the two people decided, when
    // neither did.
    expect(after.end_reason).not.toBe('declined');
    expect(after.end_reason).not.toBe('withdrawn');
    expect(after.state).not.toBe('rejected');
    expect(after.state).not.toBe('cancelled');
  });

  it('leaves a finished call exactly as it was', async () => {
    await accounts();
    const id = await callInState('ended');
    const before = await stateOf(id);

    await safety.service.block(await accountRow(caller), recipient);

    const after = await stateOf(id);
    // Terminal is terminal. Rewriting why a finished call ended would destroy
    // the record of what actually happened.
    expect(after).toEqual(before);
  });

  it('succeeds when the pair has no call at all', async () => {
    await accounts();
    const outcome = await safety.service.block(
      await accountRow(caller),
      recipient,
    );
    // Most blocks are not placed mid-call, and nothing about that is an error.
    expect(outcome.kind).toBe('blocked');
  });

  it('ends a call for a block placed the other way round', async () => {
    await accounts();
    const id = await callInState('active');
    // The person being called blocks the caller. Which side of the ordered pair
    // somebody is on is an artefact of identifier ordering.
    await safety.service.block(await accountRow(recipient), caller);
    expect((await stateOf(id)).state).toBe('ended');
  });

  it('is idempotent, and still ends a call that outlived an earlier block', async () => {
    await accounts();
    await safety.service.block(await accountRow(caller), recipient);
    const id = await callInState('active');

    // Blocking again renews nothing and answers with the block that stands —
    // but a call that somehow exists despite it is still ended rather than
    // reported as fine.
    const outcome = await safety.service.block(
      await accountRow(caller),
      recipient,
    );
    expect(outcome.kind).toBe('blocked');
    expect((await stateOf(id)).state).toBe('ended');
  });
});

describe('a block and the ending of the call commit together', () => {
  it('leaves no instant in which the block stands and the call runs', async () => {
    await accounts();
    const id = await callInState('active');
    await safety.service.block(await accountRow(caller), recipient);

    const rows = await rowsOf<{ blocked: string; live: string }>(
      database.sql`select
        (select count(*)::text from safety_blocks
          where blocker_id = ${caller} and blocked_id = ${recipient}
            and revoked_at is null) as blocked,
        (select count(*)::text from realtime_sessions
          where id = ${id} and state not in
            ('ended', 'expired', 'rejected', 'cancelled', 'failed')) as live`,
    );
    // Both facts are read in one statement after the transaction committed. The
    // block exists and nothing is live; there is no ordering in which a reader
    // could have seen one without the other.
    expect(rows[0]?.blocked).toBe('1');
    expect(rows[0]?.live).toBe('0');
  });

  it('frees the pair, so the block is what refuses the next call', async () => {
    await accounts();
    await callInState('active');
    await safety.service.block(await accountRow(caller), recipient);

    // Not held open by a call the pair can no longer have. The refusal that
    // follows comes from eligibility, which is where it belongs.
    const live = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions
        where pair_low_id = ${caller} and pair_high_id = ${recipient}
          and state not in ('ended', 'expired', 'rejected', 'cancelled', 'failed')`,
    );
    expect(live[0]?.count).toBe('0');
    expect(
      await realtime.eligibility.mayCall({
        executor: database.drizzle,
        first: caller,
        now: now(),
        purpose: 'introduced',
        second: recipient,
      }),
    ).toBe(false);
  });
});

describe('a call cannot slip past the block by moving', () => {
  it('ends the call the other transaction left behind, not the one it read', async () => {
    await accounts();
    const id = await callInState('connecting');

    let releaseHolder = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseHolder = () => {
        resolve();
      };
    });
    let finished = false;

    // One transaction takes the call and moves it: a provider observed media,
    // so `connecting` becomes `active`. It holds the row until released.
    const holder = database.drizzle.transaction(async (executor) => {
      await realtime.repository.lockById(executor, id);
      await realtime.repository.transitionSession(executor, {
        expected: 'connecting',
        id,
        next: 'active',
        now: now(),
      });
      await held;
    });

    // Enforcement runs against the same call at the same time.
    const waiter = database.drizzle.transaction(async (executor) => {
      const ended = await callEnforcement.endLiveCallForPair({
        executor,
        first: caller,
        now: now(),
        second: recipient,
      });
      finished = true;
      return ended;
    });

    // Long enough that an unlocked read would have returned by now, holding a
    // state that is about to stop being true.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(finished).toBe(false);

    releaseHolder();
    await holder;

    // The whole property. Enforcement reads the call *after* the other
    // transaction committed, so it ends `active` — the state the call is
    // actually in. An unlocked read would have taken `connecting`, and the
    // guarded terminate that follows would then match nothing: a block
    // committed over a call that carried on.
    expect(await waiter).toBe(true);
    const after = await stateOf(id);
    expect(after.state).toBe('ended');
    expect(after.end_reason).toBe('safety_block');
  });

  it('leaves the call ended whichever way a concurrent transition resolves', async () => {
    await accounts();
    const id = await callInState('connecting');

    const [, blocked] = await Promise.all([
      realtime.service.markConnected(id),
      safety.service.block(await accountRow(caller), recipient),
    ]);
    expect(blocked.kind).toBe('blocked');

    // Media being observed does not save a call from a block, in either
    // ordering: the transition happens and is then ended, or the ending happens
    // and the transition finds nothing to move.
    const after = await stateOf(id);
    expect(after.state).toBe('ended');
    expect(after.end_reason).toBe('safety_block');
  });

  it('records one ending when a stall sweep wants the same call', async () => {
    await accounts();
    const id = await callInState('connecting');

    const [, blocked] = await Promise.all([
      realtime.service.closeStalledCalls(),
      safety.service.block(await accountRow(caller), recipient),
    ]);
    expect(blocked.kind).toBe('blocked');

    const after = await stateOf(id);
    expect(after.state).toBe('ended');
    // One ending, so one generation advance. Two would mean the call was
    // terminated twice.
    expect(after.generation).toBe('2');
  });
});

describe('an outstanding credential does not outlive the block', () => {
  it('refuses a fresh issuance and kills the generation the old one named', async () => {
    await accounts();
    const id = await callInState('accepted');
    await execute(
      database.sql`update realtime_sessions
        set provider = 'local-test', provider_reference = 'room-safety',
            provider_bound_at = now(), state = 'connecting'
        where id = ${id}`,
    );
    const before = await realtime.authorization.issue({
      actorId: caller,
      sessionId: id,
    });
    expect(before.kind).toBe('not_permitted');

    await safety.service.block(await accountRow(caller), recipient);

    // The call is terminal, so nothing is issued — and the generation the
    // earlier credential named is no longer the session's.
    const after = await realtime.authorization.issue({
      actorId: caller,
      sessionId: id,
    });
    expect(after.kind).toBe('not_permitted');
    expect((await stateOf(id)).generation).toBe('2');
  });
});

describe('the contract is the whole of what safety may do to a call', () => {
  it('ends every live call one account is in', async () => {
    await accounts();
    const first = await callInState('active');

    const third = '33333333-3333-4333-8333-333333333333';
    await execute(
      database.sql`insert into auth_accounts (created_at, id, status, updated_at)
        values (now(), ${third}, 'active', now())`,
    );
    const second = crypto.randomUUID();
    await execute(
      database.sql`insert into realtime_sessions
        (authorization_generation, accepted_at, created_at, id, initiator_id,
         invitation_expires_at, medium, origin_introduction_id,
         pair_high_id, pair_low_id, state, state_entered_at, updated_at)
       values (1, now() - interval '1 second', now() - interval '2 seconds',
         ${second}, ${caller}, now() + interval '1 minute', 'voice',
         ${crypto.randomUUID()}, ${third}, ${caller}, 'active', now(), now())`,
    );

    const ended = await database.drizzle.transaction(async (executor) =>
      callEnforcement.endLiveCallsForSubject({
        executor,
        now: now(),
        userId: caller,
      }),
    );

    // A restriction is about a person, not a pair, and one person can be in a
    // call with each of several others at once.
    expect(ended).toBe(2);
    for (const id of [first, second]) {
      const after = await stateOf(id);
      expect(after.state).toBe('ended');
      expect(after.end_reason).toBe('safety_enforcement');
    }
  });

  it('touches no call of anybody else', async () => {
    await accounts();
    const stranger = '44444444-4444-4444-8444-444444444444';
    const other = '55555555-5555-5555-8555-555555555555';
    const untouched = crypto.randomUUID();
    await execute(
      database.sql`insert into realtime_sessions
        (authorization_generation, accepted_at, created_at, id, initiator_id,
         invitation_expires_at, medium, origin_introduction_id,
         pair_high_id, pair_low_id, state, state_entered_at, updated_at)
       values (1, now() - interval '1 second', now() - interval '2 seconds',
         ${untouched}, ${stranger}, now() + interval '1 minute', 'voice',
         ${crypto.randomUUID()}, ${other}, ${stranger}, 'active', now(), now())`,
    );
    const mine = await callInState('active');

    await database.drizzle.transaction(async (executor) =>
      callEnforcement.endLiveCallsForSubject({
        executor,
        now: now(),
        userId: caller,
      }),
    );

    expect((await stateOf(mine)).state).toBe('ended');
    // Two other people talking is not this decision's business.
    expect((await stateOf(untouched)).state).toBe('active');
  });

  it('cannot start, answer, or reopen anything', () => {
    // The contract's whole surface is two ways to end a call. There is no
    // method here that could create one, admit somebody to one, extend a
    // credential, or move a terminal call back to life — which is what stops
    // this becoming a second, unreviewed way into calling.
    expect(
      Object.getOwnPropertyNames(RtcCallEnforcement.prototype).toSorted(),
    ).toEqual([
      'constructor',
      'end',
      'endLiveCallForPair',
      'endLiveCallsForSubject',
      'transactionless',
    ]);
  });
});
