import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  AdminRtcRoutes,
  rtcLiveAvailability,
} from '../../src/admin/rtc-routes.js';
import {
  rtcBacklogKinds,
  rtcBacklogThresholdMilliseconds,
  rtcJoinTimeoutMilliseconds,
  rtcProviderEventStates,
  rtcProviderObligationStates,
  rtcSessionStates,
} from '../../src/realtime/policy.js';
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
  testAdminOrigin,
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';
import { mediaEnvironment } from '../support/profile-media.js';

/**
 * Platform Admin calling operations against real PostgreSQL.
 *
 * What is being held to account here is mostly what the surface refuses to be.
 *
 * It carries the technical lifecycle every product surface is deliberately
 * denied — how many calls are stuck, how long they have been stuck, whether a
 * provider may still be holding rooms for calls that ended. It carries no list
 * of calls, no search, and no identifier of any kind on the screen an operator
 * watches, because an operator able to page through calls has a browsing
 * surface over who contacts whom. An asset has one owner; a call is a
 * relationship neither person published.
 *
 * And it carries no action at all. Ending somebody's call from a console is a
 * safety decision, and safety decisions go through TRUST & SAFETY where they
 * acquire a record, a reason, and an appeal path. A button here would be the
 * same power with none of those.
 */

const databaseUrl = await provisionDatabase('velora_admin_rtc');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();
const config = testServerConfig(mediaEnvironment);
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => 'admin-rtc-test',
  },
});
const mediaRuntime = testMediaRuntime({
  config,
  database: database.drizzle,
  logger,
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  media: mediaRuntime.service,
});

const application = createApplication({
  config,
  dependencies: {
    auth,
    ...testProductRuntimes({
      caller: auth.caller,
      config,
      database: database.drizzle,
      logger,
      users,
    }),
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    ephemeralRedis: healthy,
    logger,
    queueRedis: healthy,
    users,
  },
});
const handle = (request: Request) => application.app.handle(request);

interface Operator {
  readonly cookie: string;
  readonly csrf: string;
}

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

async function operatorSession(
  assurance: 'phishing_resistant' | 'single_factor' = 'phishing_resistant',
): Promise<Operator> {
  const accountId = crypto.randomUUID();
  await execute(
    database.sql`insert into auth_accounts (id, status) values (${accountId}, 'active')`,
  );
  const opaque = () =>
    `v1.${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
  const token = opaque();
  const csrf = opaque();
  const digest = (value: string) => Bun.SHA256.hash(value, 'hex');
  const now = new Date();
  await execute(database.sql`
    insert into auth_sessions (
      id, account_id, audience, assurance, assurance_established_at,
      authenticated_at, created_at, csrf_digest, idle_expires_at,
      last_active_at, absolute_expires_at, token_digest
    ) values (
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', ${assurance}, ${now},
      ${now}, ${now}, ${digest(csrf)}, ${new Date(now.getTime() + 3_600_000)},
      ${now}, ${new Date(now.getTime() + 3_600_000)}, ${digest(token)}
    )`);
  return {
    cookie: `__Host-velora_platform_admin_session=${token}`,
    csrf,
  };
}

function operatorRequest(path: string, operator: Operator): Request {
  return new Request(`http://api.test${path}`, {
    headers: {
      cookie: operator.cookie,
      origin: testAdminOrigin,
      'x-velora-csrf': operator.csrf,
    },
  });
}

const caller = '11111111-1111-4111-8111-111111111111';
const recipient = '22222222-2222-4222-8222-222222222222';

/** One call, in whatever state and age the test needs. */
async function seedCall(input: {
  readonly ageMilliseconds?: number;
  readonly providerBound?: boolean;
  readonly state: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  const terminal = ['ended', 'expired', 'rejected', 'cancelled', 'failed'];
  const answered = input.state !== 'invited';
  const at = new Date(Date.now() - (input.ageMilliseconds ?? 1_000));
  await execute(
    database.sql`insert into realtime_sessions
      (authorization_generation, accepted_at, created_at, id, initiator_id,
       invitation_expires_at, medium, origin_introduction_id,
       pair_high_id, pair_low_id, provider, provider_bound_at,
       provider_reference, state, state_entered_at, updated_at,
       ended_at, end_reason)
     values (1, ${answered ? at : null}, ${at}, ${id}, ${caller},
       ${new Date(at.getTime() + 45_000)}, 'voice', ${crypto.randomUUID()},
       ${recipient}, ${caller},
       ${input.providerBound === true ? 'local-test' : null},
       ${input.providerBound === true ? at : null},
       ${input.providerBound === true ? crypto.randomUUID() : null},
       ${input.state}, ${at}, ${at},
       ${terminal.includes(input.state) ? at : null},
       ${terminal.includes(input.state) ? 'hung_up' : null})`,
  );
  return id;
}

interface StateBody {
  readonly adapters: {
    readonly eligibility: string;
    readonly provider: string;
    readonly signalTransport: string;
  };
  readonly backlogs: {
    readonly breached: boolean;
    readonly count: number;
    readonly oldestAgeSeconds?: number;
    readonly state: string;
    readonly thresholdSeconds: number;
  }[];
  readonly calls: { readonly count: number; readonly state: string }[];
  readonly endedWithUndischargedTeardown: number;
  readonly liveCallingAvailable: boolean;
  readonly providerEvents: { readonly count: number; readonly state: string }[];
  readonly providerObligations: {
    readonly count: number;
    readonly state: string;
  }[];
}

async function operatorState(operator: Operator): Promise<StateBody> {
  const response = await handle(
    operatorRequest('/v1/admin/rtc/state', operator),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as StateBody;
}

describe('the operator calling screen', () => {
  it('reports counts and adapter names, and no identifier at all', async () => {
    const operator = await operatorSession();
    const id = await seedCall({ providerBound: true, state: 'active' });

    const body = await operatorState(operator);

    expect(body.calls.find((row) => row.state === 'active')?.count).toBe(1);
    // A screen an operator watches all day must not become a window onto who is
    // talking to whom. Not the call, not either person, not the provider room.
    const serialized = JSON.stringify(body);
    for (const forbidden of [id, caller, recipient]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('reports every call state, including the ones at zero', async () => {
    const operator = await operatorSession();
    await seedCall({ state: 'active' });

    const body = await operatorState(operator);
    // A list that omitted the empty states could not tell "no calls are
    // failing" from "the signal stopped arriving".
    expect(body.calls.map((row) => row.state).toSorted()).toEqual(
      [...rtcSessionStates].toSorted(),
    );
    expect(body.providerObligations.map((row) => row.state).toSorted()).toEqual(
      [...rtcProviderObligationStates].toSorted(),
    );
    expect(body.providerEvents.map((row) => row.state).toSorted()).toEqual(
      [...rtcProviderEventStates].toSorted(),
    );
  });

  it('reports every backlog class with its threshold, every time', async () => {
    const operator = await operatorSession();
    const body = await operatorState(operator);

    expect(body.backlogs.map((row) => row.state).toSorted()).toEqual(
      [...rtcBacklogKinds].toSorted(),
    );
    for (const backlog of body.backlogs) {
      expect(backlog.count).toBe(0);
      expect(backlog.breached).toBe(false);
      // Absent rather than zero. A zero would read as "something has waited no
      // time at all", and an alert rule written against it would be written
      // against a lie.
      expect(backlog.oldestAgeSeconds).toBeUndefined();
      expect(backlog.thresholdSeconds).toBe(
        rtcBacklogThresholdMilliseconds[
          backlog.state as keyof typeof rtcBacklogThresholdMilliseconds
        ] / 1000,
      );
    }
  });

  it('ages a stuck call, and says when that is past the alert threshold', async () => {
    const operator = await operatorSession();
    await seedCall({
      ageMilliseconds:
        rtcJoinTimeoutMilliseconds +
        rtcBacklogThresholdMilliseconds.join_timeout +
        60_000,
      state: 'connecting',
    });

    const body = await operatorState(operator);
    const backlog = body.backlogs.find((row) => row.state === 'join_timeout');
    expect(backlog?.count).toBe(1);
    // The age is the whole point: a count cannot tell a busy platform from one
    // whose sweep has stopped running.
    expect(backlog?.oldestAgeSeconds).toBeGreaterThan(
      backlog?.thresholdSeconds ?? 0,
    );
    expect(backlog?.breached).toBe(true);
  });

  it('counts a call that ended while its teardown did not', async () => {
    const operator = await operatorSession();
    const id = await seedCall({ providerBound: true, state: 'ended' });
    await execute(
      database.sql`insert into realtime_provider_obligations
        (attempts, available_at, created_at, kind, provider, provider_reference,
         session_id, state, updated_at)
       values (0, now(), now(), 'terminate_session', 'local-test',
         ${crypto.randomUUID()}, ${id}, 'pending', now())`,
    );

    const body = await operatorState(operator);
    // The platform believes the call is over and a provider may still be
    // holding the room open. A number, not a list — listing it would name
    // conversations.
    expect(body.endedWithUndischargedTeardown).toBe(1);
    expect(JSON.stringify(body)).not.toContain(id);
  });

  it('reports calling as unavailable, because it is', async () => {
    const operator = await operatorSession();
    const body = await operatorState(operator);

    // The truth about a deployed environment, and about this one. Naming the
    // adapters rather than reporting a bare boolean is what makes "off" and
    // "off because nobody has approved a provider" distinguishable.
    expect(body.adapters.provider).toBe('unavailable');
    expect(body.liveCallingAvailable).toBe(false);
  });

  it('needs both halves before it would call anything available', () => {
    // Neither half is sufficient. A provider with no eligibility answer is a
    // room nobody was authorized to be in; an eligibility answer with no
    // provider has nowhere to put a call.
    expect(
      rtcLiveAvailability({ eligibility: 'composed', provider: 'local-test' }),
    ).toBe(true);
    expect(
      rtcLiveAvailability({
        eligibility: 'unavailable',
        provider: 'local-test',
      }),
    ).toBe(false);
    expect(
      rtcLiveAvailability({
        eligibility: 'composed',
        provider: 'unavailable',
      }),
    ).toBe(false);
  });
});

describe('one call, for an operator who already has its identifier', () => {
  it('answers with the lifecycle and nothing about the people in it', async () => {
    const operator = await operatorSession();
    const id = await seedCall({ providerBound: true, state: 'active' });
    await execute(
      database.sql`insert into realtime_join_issuances
        (authorization_generation, expires_at, issued_at, session_id, user_id)
       values (1, now() + interval '2 minutes', now(), ${id}, ${caller})`,
    );

    const response = await handle(
      operatorRequest(`/v1/admin/rtc/call?callId=${id}`, operator),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.id).toBe(id);
    expect(body.state).toBe('active');
    expect(body.issuances).toBe(1);
    expect(body.providerBound).toBe(true);
    // The lifecycle, and none of the people. A call has two participants and
    // an operator triaging a stuck room needs neither of them.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(caller);
    expect(serialized).not.toContain(recipient);
  });

  it('never reports the provider room reference', async () => {
    const operator = await operatorSession();
    const id = await seedCall({ providerBound: true, state: 'active' });
    const rows = await rowsOf<{ reference: string }>(
      database.sql`select provider_reference as reference
        from realtime_sessions where id = ${id}`,
    );
    const reference = rows[0]?.reference ?? '';

    const response = await handle(
      operatorRequest(`/v1/admin/rtc/call?callId=${id}`, operator),
    );
    // The provider's handle for a private conversation. That a room exists is
    // operational; which room it is, is not.
    expect(await response.text()).not.toContain(reference);
  });

  it('answers a call that does not exist exactly as one that does not', async () => {
    const operator = await operatorSession();
    const response = await handle(
      operatorRequest(
        `/v1/admin/rtc/call?callId=${crypto.randomUUID()}`,
        operator,
      ),
    );
    // An operations tool is still a place where guessing identifiers must not
    // be productive.
    expect(response.status).toBe(404);
  });

  it('refuses a request that names no call', async () => {
    const operator = await operatorSession();
    const response = await handle(
      operatorRequest('/v1/admin/rtc/call', operator),
    );
    expect(response.status).toBe(422);
  });
});

describe('the surface offers no way to act on a call', () => {
  it('publishes only reads', () => {
    // Ending a call, revoking a credential, forcing a teardown: each is a
    // safety decision, and each goes through TRUST & SAFETY where it acquires
    // an enforcement record, a reason, and an appeal path. A console button
    // would be the same power with none of those.
    expect(
      Object.getOwnPropertyNames(AdminRtcRoutes.prototype).toSorted(),
    ).toEqual(['constructor', 'getRtcCall', 'getRtcState']);
  });

  it('refuses an operator whose assurance is not phishing-resistant', async () => {
    const weak = await operatorSession('single_factor');
    const response = await handle(operatorRequest('/v1/admin/rtc/state', weak));
    // Every Admin route is reachable by nobody today: no approved verifier can
    // establish the assurance these require, so they fail closed rather than
    // degrading to something weaker.
    expect(response.status).toBe(403);
  });

  it('refuses a request carrying no operator session at all', async () => {
    const response = await handle(
      new Request('http://api.test/v1/admin/rtc/state', {
        headers: { origin: testAdminOrigin },
      }),
    );
    expect(response.status).toBe(401);
  });
});
