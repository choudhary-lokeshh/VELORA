import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import type { LocalTestRtcProvider } from '../../src/realtime/local-test-provider.js';
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

const databaseUrl = await provisionDatabase('velora_rtc_provider');
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
    requesterReference: () => 'rtc-provider-test',
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
  enforcement: safety.eligibility,
  logger,
  now,
  onboarding: users.onboarding,
  safety: safety.directory,
  standing: users.standing,
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  logs.length = 0;
  await database.truncate();
});

/**
 * A session row written directly.
 *
 * The lifecycle that produces one is proved by `rtc-lifecycle.test.ts`; this
 * suite is about what happens between the platform and a provider, so it starts
 * from an accepted call rather than re-walking the path to one.
 */
async function acceptedSession(): Promise<string> {
  const id = crypto.randomUUID();
  const low = '11111111-1111-4111-8111-111111111111';
  const high = '22222222-2222-4222-8222-222222222222';
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, state, updated_at)
     values (1, now(), now(), ${id}, ${low}, now() + interval '1 minute',
       'voice', ${crypto.randomUUID()}, ${high}, ${low}, 'accepted', now())`,
  );
  await execute(
    database.sql`insert into realtime_participants (invited_at, accepted_at, role, session_id, user_id)
      values (now(), now(), 'caller', ${id}, ${low}), (now(), now(), 'recipient', ${id}, ${high})`,
  );
  return id;
}

async function sessionRow(id: string): Promise<{
  provider: string | null;
  provider_reference: string | null;
  state: string;
}> {
  const rows = await rowsOf<{
    provider: string | null;
    provider_reference: string | null;
    state: string;
  }>(
    database.sql`select state, provider, provider_reference
      from realtime_sessions where id = ${id}`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no session');
  return row;
}

describe('provider work never runs inside a database transaction', () => {
  it('holds no open transaction while the provider is being called', async () => {
    const id = await acceptedSession();
    let openDuringCall: number | undefined;

    const provider = realtime.provider as LocalTestRtcProvider;
    const original = provider.createSession.bind(provider);
    // Instrumented at the adapter boundary, which is the only place that can
    // observe what the pool is doing at the instant of the external call.
    (provider as unknown as { createSession: unknown }).createSession = async (
      request: Parameters<LocalTestRtcProvider['createSession']>[0],
    ) => {
      const rows = await rowsOf<{ count: string }>(
        database.sql`select count(*)::text as count from pg_stat_activity
          where datname = current_database() and state = 'idle in transaction'`,
      );
      openDuringCall = Number(rows[0]?.count ?? '0');
      return original(request);
    };

    await realtime.service.establishProviderSession(id);
    (provider as unknown as { createSession: unknown }).createSession =
      original;

    // The ADR-0019 invariant, asserted rather than assumed: a pooled connection
    // held across somebody else's network is a connection the admission bound
    // cannot account for, and a slow vendor would become a database outage.
    expect(openDuringCall).toBe(0);
  });

  it('commits the provider identity before the provider is contacted', async () => {
    const id = await acceptedSession();
    const provider = realtime.provider as LocalTestRtcProvider;
    const original = provider.createSession.bind(provider);
    let keyAtCallTime: string | null | undefined;
    (provider as unknown as { createSession: unknown }).createSession = async (
      request: Parameters<LocalTestRtcProvider['createSession']>[0],
    ) => {
      const rows = await rowsOf<{ provider_idempotency_key: string | null }>(
        database.sql`select provider_idempotency_key from realtime_sessions where id = ${id}`,
      );
      keyAtCallTime = rows[0]?.provider_idempotency_key;
      return original(request);
    };
    await realtime.service.establishProviderSession(id);
    (provider as unknown as { createSession: unknown }).createSession =
      original;

    // Committed first, which is the whole mechanism that makes an ambiguous
    // create answerable rather than lost.
    expect(keyAtCallTime).toBe(`rtc-${id}`);
  });
});

describe('an ambiguous create is recovered, not repeated', () => {
  it('binds the room the provider made but never acknowledged', async () => {
    const id = await acceptedSession();
    const provider = realtime.provider as LocalTestRtcProvider;
    const before = provider.createCallCount();
    provider.behaveAs('ambiguous-create');

    await realtime.service.establishProviderSession(id);
    provider.behaveAs('normal');

    const row = await sessionRow(id);
    // One room, found by the key that was committed before the call.
    expect(provider.createCallCount()).toBe(before + 1);
    expect(row.provider_reference).not.toBeNull();
    expect(row.provider).toBe('local-test');
    expect(row.state).toBe('connecting');
  });

  it('leaves the call recoverable when the provider cannot be reached at all', async () => {
    const id = await acceptedSession();
    const provider = realtime.provider as LocalTestRtcProvider;
    provider.behaveAs('outage');

    const outcome = await realtime.service.establishProviderSession(id);
    provider.behaveAs('normal');

    // Nothing infers success from silence, and nothing ends the call either:
    // the reservation stands and the call is still answerable.
    expect(outcome.kind).toBe('not_permitted');
    const row = await sessionRow(id);
    expect(row.state).toBe('accepted');
    expect(row.provider_reference).toBeNull();
  });
});

describe('a call with no approved provider fails for that reason', () => {
  it('says the provider was unavailable rather than that somebody hung up', async () => {
    const refusing = createRealtimeRuntime({
      config: testServerConfig({
        REALTIME_CALL_ELIGIBILITY: 'composed',
        ...mediaEnvironment,
      }),
      connections: discovery.connections,
      database: database.drizzle,
      enforcement: safety.eligibility,
      logger,
      now,
      onboarding: users.onboarding,
      safety: safety.directory,
      standing: users.standing,
    });
    const id = await acceptedSession();
    await refusing.service.establishProviderSession(id);

    const rows = await rowsOf<{ end_reason: string; state: string }>(
      database.sql`select state, end_reason from realtime_sessions where id = ${id}`,
    );
    expect(rows[0]?.state).toBe('failed');
    expect(rows[0]?.end_reason).toBe('provider_unavailable');
  });
});

describe('nothing a provider hands back is stored where it should not be', () => {
  it('persists no join credential anywhere in the domain', async () => {
    const id = await acceptedSession();
    await realtime.service.establishProviderSession(id);
    const row = await sessionRow(id);
    const provider = realtime.provider as LocalTestRtcProvider;
    const grant = await provider.issueParticipantGrant({
      authorizationGeneration: 1,
      medium: 'voice',
      participantReference: 'participant-a',
      providerReference: row.provider_reference ?? '',
      ttlMilliseconds: 60_000,
    });

    // The credential exists for exactly one caller and is written nowhere.
    const found = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions
        where provider_reference = ${grant.credential}
           or provider_idempotency_key = ${grant.credential}`,
    );
    expect(found[0]?.count).toBe('0');
    expect(JSON.stringify(logs)).not.toContain(grant.credential);
  });

  it('holds no column for a credential or a transport detail', async () => {
    const columns = await rowsOf<{ column_name: string }>(
      database.sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name like 'realtime_%'`,
    );
    const names = columns.map((row) => row.column_name);
    for (const forbidden of [
      'credential',
      'join_token',
      'token',
      'secret',
      'sdp',
      'ice_candidate',
      'turn_username',
      'turn_password',
      'ip_address',
      'recording_url',
      'transcript',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
