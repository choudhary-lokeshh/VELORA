import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { participantReferenceFor } from '../../src/realtime/authorization.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
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

const databaseUrl = await provisionDatabase('velora_rtc_authorization');
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
    requesterReference: () => 'rtc-authorization-test',
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

/**
 * Permits every pair, so this suite exercises the *issuance* gate rather than
 * re-proving the eligibility gate that `rtc-lifecycle.test.ts` already covers.
 * The tests that need a refusal install a refusing one explicitly.
 */
const permissive = { mayCall: () => Promise.resolve(true) };

const realtime = createRealtimeRuntime({
  config,
  connections: discovery.connections,
  database: database.drizzle,
  eligibility: permissive,
  logger,
  now,
  onboarding: users.onboarding,
});

const caller = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';
const stranger = '33333333-3333-4333-8333-333333333333';

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  logs.length = 0;
  await database.truncate();
});

/** A call that has been answered and bound to a provider room. */
async function joinableSession(): Promise<string> {
  const id = crypto.randomUUID();
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, state, updated_at)
     values (1, now(), now(), ${id}, ${caller}, now() + interval '1 minute',
       'video', ${crypto.randomUUID()}, ${recipient}, ${caller}, 'accepted', now())`,
  );
  await execute(
    database.sql`insert into realtime_participants (invited_at, accepted_at, role, session_id, user_id)
      values (now(), now(), 'caller', ${id}, ${caller}),
             (now(), now(), 'recipient', ${id}, ${recipient})`,
  );
  await realtime.service.establishProviderSession(id);
  return id;
}

describe('a credential names one person and one call', () => {
  it('issues to each participant, and never the same credential twice', async () => {
    const id = await joinableSession();
    const first = await realtime.authorization.issue({
      actorId: caller,
      sessionId: id,
    });
    const second = await realtime.authorization.issue({
      actorId: recipient,
      sessionId: id,
    });
    expect(first.kind).toBe('authorization');
    expect(second.kind).toBe('authorization');
    if (first.kind !== 'authorization' || second.kind !== 'authorization') {
      throw new Error('expected authorizations');
    }
    // User A never receives a credential that would admit user B.
    expect(first.value.credential).not.toBe(second.value.credential);
  });

  it('answers a non-participant exactly as a call that does not exist', async () => {
    const id = await joinableSession();
    expect(
      (await realtime.authorization.issue({ actorId: stranger, sessionId: id }))
        .kind,
    ).toBe('not_found');
    expect(
      (
        await realtime.authorization.issue({
          actorId: caller,
          sessionId: crypto.randomUUID(),
        })
      ).kind,
    ).toBe('not_found');
  });

  it('gives a provider a reference that is not the account identifier', () => {
    const reference = participantReferenceFor({
      actorId: caller,
      sessionId: '44444444-4444-4444-8444-444444444444',
    });
    expect(reference).not.toContain(caller);
    // Stable within one call, and different in another, so a provider never
    // holds a durable identifier for a person.
    expect(
      participantReferenceFor({
        actorId: caller,
        sessionId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toBe(reference);
    expect(
      participantReferenceFor({
        actorId: caller,
        sessionId: '55555555-5555-4555-8555-555555555555',
      }),
    ).not.toBe(reference);
  });
});

describe('a credential is short-lived and never stored', () => {
  it('expires within the declared window', async () => {
    const id = await joinableSession();
    const issued = await realtime.authorization.issue({
      actorId: caller,
      sessionId: id,
    });
    if (issued.kind !== 'authorization') throw new Error('expected one');
    const lifetime = issued.value.expiresAt.getTime() - new Date().getTime();
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(300_000);
  });

  it('writes the fact of issuance and not the secret', async () => {
    const id = await joinableSession();
    const issued = await realtime.authorization.issue({
      actorId: caller,
      sessionId: id,
    });
    if (issued.kind !== 'authorization') throw new Error('expected one');

    const rows = await rowsOf<{
      authorization_generation: number;
      user_id: string;
    }>(
      database.sql`select authorization_generation, user_id
        from realtime_join_issuances where session_id = ${id}`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(caller);
    expect(Number(rows[0]?.authorization_generation)).toBe(1);

    // The credential appears in no column of the domain and in no log record.
    const leaked = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions
        where provider_reference = ${issued.value.credential}`,
    );
    expect(leaked[0]?.count).toBe('0');
    expect(JSON.stringify(logs)).not.toContain(issued.value.credential);
  });
});

describe('only a live, answered call admits anybody', () => {
  it('refuses an invitation nobody has accepted', async () => {
    const id = crypto.randomUUID();
    await execute(
      database.sql`insert into realtime_sessions
        (authorization_generation, created_at, id, initiator_id,
         invitation_expires_at, medium, origin_introduction_id,
         pair_high_id, pair_low_id, state, updated_at)
       values (1, now(), ${id}, ${caller}, now() + interval '1 minute',
         'voice', ${crypto.randomUUID()}, ${recipient}, ${caller}, 'invited', now())`,
    );
    await execute(
      database.sql`insert into realtime_participants (invited_at, role, session_id, user_id)
        values (now(), 'caller', ${id}, ${caller}), (now(), 'recipient', ${id}, ${recipient})`,
    );
    // Acceptance is what admits somebody, and it has not happened.
    expect(
      (await realtime.authorization.issue({ actorId: caller, sessionId: id }))
        .kind,
    ).toBe('not_permitted');
  });

  it('refuses once the call has ended', async () => {
    const id = await joinableSession();
    await execute(
      database.sql`update realtime_sessions
        set state = 'ended', ended_at = now(), end_reason = 'hung_up',
            authorization_generation = authorization_generation + 1
        where id = ${id}`,
    );
    expect(
      (await realtime.authorization.issue({ actorId: caller, sessionId: id }))
        .kind,
    ).toBe('not_permitted');
  });

  it('refuses a call that was never bound to a provider room', async () => {
    const id = crypto.randomUUID();
    await execute(
      database.sql`insert into realtime_sessions
        (authorization_generation, accepted_at, created_at, id, initiator_id,
         invitation_expires_at, medium, origin_introduction_id,
         pair_high_id, pair_low_id, state, updated_at)
       values (1, now(), now(), ${id}, ${caller}, now() + interval '1 minute',
         'voice', ${crypto.randomUUID()}, ${recipient}, ${caller}, 'accepted', now())`,
    );
    await execute(
      database.sql`insert into realtime_participants (invited_at, accepted_at, role, session_id, user_id)
        values (now(), now(), 'caller', ${id}, ${caller}), (now(), now(), 'recipient', ${id}, ${recipient})`,
    );
    expect(
      (await realtime.authorization.issue({ actorId: caller, sessionId: id }))
        .kind,
    ).toBe('not_permitted');
  });
});

describe('eligibility is composed again at issuance', () => {
  it('refuses a credential when the pair may no longer talk', async () => {
    const id = await joinableSession();
    const refusing = createRealtimeRuntime({
      config,
      connections: discovery.connections,
      database: database.drizzle,
      eligibility: { mayCall: () => Promise.resolve(false) },
      logger,
      now,
      onboarding: users.onboarding,
    });
    // Acceptance proves somebody answered. It proves nothing about whether
    // they may still talk now, which is why this is asked again.
    expect(
      (await refusing.authorization.issue({ actorId: caller, sessionId: id }))
        .kind,
    ).toBe('not_permitted');
  });
});

describe('no approved provider means nothing to join', () => {
  it('refuses issuance rather than minting something meaningless', async () => {
    const id = await joinableSession();
    const unavailable = createRealtimeRuntime({
      config: testServerConfig({
        REALTIME_CALL_ELIGIBILITY: 'composed',
        ...mediaEnvironment,
      }),
      connections: discovery.connections,
      database: database.drizzle,
      eligibility: permissive,
      logger,
      now,
      onboarding: users.onboarding,
    });
    expect(
      (
        await unavailable.authorization.issue({
          actorId: caller,
          sessionId: id,
        })
      ).kind,
    ).toBe('unavailable');
  });
});
