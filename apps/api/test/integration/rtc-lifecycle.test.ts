import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import { CreatorDirectory } from '../../src/creators/directory.js';
import { createDiscoveryRuntime } from '../../src/discovery/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { createMessagingRuntime } from '../../src/messaging/composition.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import { createRealtimeRuntime } from '../../src/realtime/composition.js';
import { createSafetyRuntime } from '../../src/safety/composition.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import type { UserAccountRow } from '../../src/users/repository.js';
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
  testAdminRuntime,
  testBillingRuntime,
  testClubsRuntime,
  testConsumerOrigin,
  testCreatorsRuntime,
  testDatabaseAdmission,
  testIdentityRuntime,
  testMediaRuntime,
  testNotificationsApiRuntime,
  testPayoutsRuntime,
  testServerConfig,
} from '../support/harness.js';
import {
  mediaEnvironment,
  readyProfileImage,
} from '../support/profile-media.js';

const databaseUrl = await provisionDatabase('velora_rtc_lifecycle');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig({
  MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
  REALTIME_CALL_ELIGIBILITY: 'composed',
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
      return `rtc-test-${String(requesterSequence)}`;
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

// REALTIME composed exactly as production composes it: DISCOVERY's
// relationship contract, TRUST & SAFETY's pairwise and enforcement answers,
// and USERS' account standing, all selected by configuration. Nothing here is
// a permissive stub, so a lifecycle test cannot pass on a pair production
// would refuse.
const realtime = createRealtimeRuntime({
  config,
  connections: discovery.connections,
  database: database.drizzle,
  enforcement: safety.eligibility,
  now,
  onboarding: users.onboarding,
  safety: safety.directory,
  standing: users.standing,
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
    admin: testAdminRuntime({
      billing: billingRuntime,
      caller: auth.caller,
      config,
      clubs: clubsRuntime,
      creators,
      media: mediaRuntime,
      safety,
    }),
    auth,
    billing: billingRuntime,
    clubs: clubsRuntime,
    creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery,
    ephemeralRedis: healthy,
    identity: testIdentityRuntime({
      config,
      database: database.drizzle,
      logger,
      now,
    }),
    logger,
    media: mediaRuntime,
    messaging,
    notifications: testNotificationsApiRuntime({
      database: database.drizzle,
      now,
      safety,
      users,
    }),
    payouts: testPayoutsRuntime({
      config,
      creators,
      database: database.drizzle,
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
    slotId: media.mediaId,
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

/** Two consumers who have mutually introduced themselves. */
async function introducedPair(): Promise<{
  readonly a: UserAccountRow;
  readonly b: UserAccountRow;
  readonly credentialsA: Credentials;
  readonly credentialsB: Credentials;
  readonly introductionId: string;
}> {
  const credentialsA = await consumer('caller@rtc.test');
  const credentialsB = await consumer('recipient@rtc.test');
  await handle(
    post('/v1/discovery/introductions', credentialsA, {
      candidateId: credentialsB.id,
    }),
  );
  const mutual = await handle(
    post('/v1/discovery/introductions', credentialsB, {
      candidateId: credentialsA.id,
    }),
  );
  const introduction = (await mutual.json()) as { id: string; state: string };
  expect(introduction.state).toBe('mutual');
  return {
    a: await account(credentialsA.id),
    b: await account(credentialsB.id),
    credentialsA,
    credentialsB,
    introductionId: introduction.id,
  };
}

async function account(id: string): Promise<UserAccountRow> {
  const row = await users.repository.findById(
    users.repository.transactionless,
    id,
  );
  if (row === undefined) throw new Error(`No account ${id}`);
  return row;
}

async function stateOf(sessionId: string): Promise<string> {
  const rows = await rowsOf<{ state: string }>(
    database.sql`select state from realtime_sessions where id = ${sessionId}`,
  );
  return rows[0]?.state ?? 'missing';
}

describe('a call is invited, answered, and ended', () => {
  it('walks the lifecycle a mutual introduction authorizes', async () => {
    const pair = await introducedPair();

    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'video',
    });
    expect(invited.kind).toBe('call');
    if (invited.kind !== 'call') throw new Error('expected a call');
    expect(invited.view.state).toBe('invited');
    expect(invited.view.role).toBe('caller');
    expect(invited.view.counterpartId).toBe(pair.b.id);
    expect(invited.view.medium).toBe('video');

    const accepted = await realtime.service.accept(pair.b, invited.view.id);
    expect(accepted.kind).toBe('call');
    if (accepted.kind !== 'call') throw new Error('expected a call');
    expect(accepted.view.state).toBe('accepted');
    expect(accepted.view.role).toBe('recipient');
    expect(accepted.view.acceptedAt).toBeDefined();

    const ended = await realtime.service.end(pair.a, invited.view.id);
    expect(ended.kind).toBe('call');
    if (ended.kind !== 'call') throw new Error('expected a call');
    expect(ended.view.state).toBe('ended');
    expect(ended.view.endReason).toBe('hung_up');
    expect(ended.view.endedAt).toBeDefined();
  });

  it('advances the authorization generation the moment a call ends', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    const before = await rowsOf<{ authorization_generation: number }>(
      database.sql`select authorization_generation from realtime_sessions where id = ${invited.view.id}`,
    );
    expect(Number(before[0]?.authorization_generation)).toBe(1);

    await realtime.service.reject(pair.b, invited.view.id);
    const after = await rowsOf<{ authorization_generation: number }>(
      database.sql`select authorization_generation from realtime_sessions where id = ${invited.view.id}`,
    );
    // Every credential issued under generation 1 is dead at the platform
    // boundary the instant this row moves, whatever a provider still believes.
    expect(Number(after[0]?.authorization_generation)).toBe(2);
  });
});

describe('only the right person may take each transition', () => {
  it('refuses an acceptance from the caller', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    expect((await realtime.service.accept(pair.a, invited.view.id)).kind).toBe(
      'not_permitted',
    );
    expect(await stateOf(invited.view.id)).toBe('invited');
  });

  it('refuses a cancellation from the recipient and a rejection from the caller', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    expect((await realtime.service.cancel(pair.b, invited.view.id)).kind).toBe(
      'not_permitted',
    );
    expect((await realtime.service.reject(pair.a, invited.view.id)).kind).toBe(
      'not_permitted',
    );
    expect(await stateOf(invited.view.id)).toBe('invited');
  });

  it('answers a stranger exactly as it answers a call that does not exist', async () => {
    const pair = await introducedPair();
    const stranger = await account((await consumer('stranger@rtc.test')).id);
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');

    expect((await realtime.service.read(stranger, invited.view.id)).kind).toBe(
      'not_found',
    );
    expect((await realtime.service.end(stranger, invited.view.id)).kind).toBe(
      'not_found',
    );
    expect(
      (await realtime.service.read(stranger, crypto.randomUUID())).kind,
    ).toBe('not_found');
  });
});

describe('a pair holds one live call at a time', () => {
  it('returns the existing call rather than opening a second', async () => {
    const pair = await introducedPair();
    const first = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    const second = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (first.kind !== 'call' || second.kind !== 'call') {
      throw new Error('expected calls');
    }
    expect(second.view.id).toBe(first.view.id);
  });

  it('settles simultaneous invitations at the admission ceiling on one call', async () => {
    const pair = await introducedPair();
    // Sixteen rather than fifty, and the number is the point. This drives the
    // service directly because RTC publishes no route until the call-control
    // phase, so it bypasses the `DatabaseAdmission` bound every production
    // request passes through. Sixteen is that bound in a test pool; above it,
    // what is being exercised is a concurrency production never reaches, and
    // Bun.SQL's pool answers a burst that large with a protocol desync rather
    // than with the invariant under test. The route-level proof at full
    // concurrency belongs with the routes.
    const attempts = await Promise.all(
      Array.from({ length: 16 }, () =>
        realtime.service.invite(pair.a, {
          introductionId: pair.introductionId,
          medium: 'voice',
        }),
      ),
    );
    const ids = new Set(
      attempts.flatMap((outcome) =>
        outcome.kind === 'call' ? [outcome.view.id] : [],
      ),
    );
    expect(ids.size).toBe(1);
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from realtime_sessions`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('lets both people call each other at once without producing two calls', async () => {
    const pair = await introducedPair();
    const [fromA, fromB] = await Promise.all([
      realtime.service.invite(pair.a, {
        introductionId: pair.introductionId,
        medium: 'voice',
      }),
      realtime.service.invite(pair.b, {
        introductionId: pair.introductionId,
        medium: 'voice',
      }),
    ]);
    expect(fromA.kind).toBe('call');
    expect(fromB.kind).toBe('call');
    if (fromA.kind !== 'call' || fromB.kind !== 'call') {
      throw new Error('expected calls');
    }
    expect(fromB.view.id).toBe(fromA.view.id);
    // Whoever lost the index reads the winner's call and is told which side of
    // it they are on, rather than being handed a second call nobody answered.
    expect(fromA.view.role).not.toBe(fromB.view.role);
  });

  it('opens a fresh call once the previous one has finished', async () => {
    const pair = await introducedPair();
    const first = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (first.kind !== 'call') throw new Error('expected a call');
    await realtime.service.cancel(pair.a, first.view.id);

    const second = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (second.kind !== 'call') throw new Error('expected a call');
    expect(second.view.id).not.toBe(first.view.id);
    expect(second.view.state).toBe('invited');
  });
});

describe('a finished call stays finished', () => {
  it('treats a repeated hang-up as the same ending', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    await realtime.service.accept(pair.b, invited.view.id);

    const first = await realtime.service.end(pair.a, invited.view.id);
    const second = await realtime.service.end(pair.b, invited.view.id);
    if (first.kind !== 'call' || second.kind !== 'call') {
      throw new Error('expected calls');
    }
    expect(second.view.state).toBe('ended');
    expect(second.view.endedAt?.getTime()).toBe(first.view.endedAt?.getTime());
    expect(second.view.endReason).toBe('hung_up');
  });

  it('settles concurrent hang-ups from both sides on one ending', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    await realtime.service.accept(pair.b, invited.view.id);

    await Promise.all([
      realtime.service.end(pair.a, invited.view.id),
      realtime.service.end(pair.b, invited.view.id),
    ]);
    const rows = await rowsOf<{ ended_at: string; generation: string }>(
      database.sql`select ended_at, authorization_generation::text as generation from realtime_sessions where id = ${invited.view.id}`,
    );
    // One ending, so one generation advance. Two would mean the terminal write
    // happened twice and the first credential window was reasoned about twice.
    expect(rows[0]?.generation).toBe('2');
  });

  it('refuses an acceptance after the call was cancelled', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    await realtime.service.cancel(pair.a, invited.view.id);
    expect((await realtime.service.accept(pair.b, invited.view.id)).kind).toBe(
      'not_permitted',
    );
    expect(await stateOf(invited.view.id)).toBe('cancelled');
  });

  it('lets exactly one of a simultaneous accept and cancel win', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');

    await Promise.all([
      realtime.service.accept(pair.b, invited.view.id),
      realtime.service.cancel(pair.a, invited.view.id),
    ]);
    const state = await stateOf(invited.view.id);
    expect(['accepted', 'cancelled']).toContain(state);
  });
});

describe('safety and the relationship decide, at the moment of the action', () => {
  it('refuses an invitation between people who are not introduced', async () => {
    const credentialsA = await consumer('lonely@rtc.test');
    const credentialsB = await consumer('unrelated@rtc.test');
    const a = await account(credentialsA.id);
    await handle(
      post('/v1/discovery/introductions', credentialsA, {
        candidateId: credentialsB.id,
      }),
    );
    // A one-sided signal is not a mutual introduction, so there is no
    // introduction identifier a caller could name.
    expect(
      (
        await realtime.service.invite(a, {
          introductionId: crypto.randomUUID(),
          medium: 'voice',
        })
      ).kind,
    ).toBe('not_found');
  });

  it('refuses a new invitation once one of them has blocked the other', async () => {
    const pair = await introducedPair();
    await handle(
      post('/v1/safety/blocks', pair.credentialsB, {
        targetId: pair.credentialsA.id,
      }),
    );
    expect(
      (
        await realtime.service.invite(pair.a, {
          introductionId: pair.introductionId,
          medium: 'voice',
        })
      ).kind,
    ).toBe('not_permitted');
  });

  it('ends a ringing call when a block lands before it is answered', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');

    await handle(
      post('/v1/safety/blocks', pair.credentialsB, {
        targetId: pair.credentialsA.id,
      }),
    );

    // The acceptance re-composes eligibility rather than trusting the
    // invitation, so the block wins and the invitation is closed rather than
    // left ringing.
    expect((await realtime.service.accept(pair.b, invited.view.id)).kind).toBe(
      'not_permitted',
    );
    const rows = await rowsOf<{ end_reason: string; state: string }>(
      database.sql`select state, end_reason from realtime_sessions where id = ${invited.view.id}`,
    );
    expect(rows[0]?.state).toBe('ended');
    expect(rows[0]?.end_reason).toBe('safety_block');
  });

  it('refuses a call from an account whose standing does not permit it', async () => {
    const pair = await introducedPair();
    await execute(
      database.sql`update users_accounts
        set status = 'restricted', status_reason = 'safety_enforcement'
        where id = ${pair.a.id}`,
    );
    const suspended = await account(pair.a.id);
    expect(
      (
        await realtime.service.invite(suspended, {
          introductionId: pair.introductionId,
          medium: 'voice',
        })
      ).kind,
    ).toBe('not_eligible');
  });
});

describe('both people have to be callable, not just the one calling', () => {
  it('refuses a call to an account whose standing does not permit contact', async () => {
    const pair = await introducedPair();
    // The asymmetry a check on the actor alone would miss: the caller is in
    // perfect standing and the person being called is not.
    await execute(
      database.sql`update users_accounts
        set status = 'restricted', status_reason = 'safety_enforcement'
        where id = ${pair.b.id}`,
    );
    expect(
      (
        await realtime.service.invite(pair.a, {
          introductionId: pair.introductionId,
          medium: 'voice',
        })
      ).kind,
    ).toBe('not_permitted');
  });

  it('refuses a call when a live enforcement denies either party', async () => {
    const pair = await introducedPair();
    await realtime.repository.transaction(async (executor) =>
      safety.authority.impose(executor, {
        actorReference: 'rtc-test-operator',
        reasonCode: 'harassment',
        scope: 'account_restriction',
        subjectId: pair.b.id,
      }),
    );
    expect(
      (
        await realtime.service.invite(pair.a, {
          introductionId: pair.introductionId,
          medium: 'voice',
        })
      ).kind,
    ).toBe('not_permitted');
  });

  it('refuses a call once the introduction that authorized it has closed', async () => {
    const pair = await introducedPair();
    await execute(
      database.sql`update discovery_introductions
        set state = 'closed', closed_at = now(), closed_reason = 'enforcement'
        where id = ${pair.introductionId}`,
    );
    // A mutual introduction that has since closed is not standing permission
    // to call, and the relationship is re-read rather than remembered.
    expect(
      (
        await realtime.service.invite(pair.a, {
          introductionId: pair.introductionId,
          medium: 'voice',
        })
      ).kind,
    ).toBe('not_found');
  });

  it('refuses every pair when the eligibility contract is unavailable', async () => {
    const pair = await introducedPair();
    const refusing = createRealtimeRuntime({
      config: testServerConfig({
        MESSAGING_SAFETY_ELIGIBILITY: 'trust-and-safety',
        ...mediaEnvironment,
      }),
      connections: discovery.connections,
      database: database.drizzle,
      enforcement: safety.eligibility,
      now,
      onboarding: users.onboarding,
      safety: safety.directory,
      standing: users.standing,
    });
    // The default in every environment, and what a deployed one gets.
    expect(
      (
        await refusing.service.invite(pair.a, {
          introductionId: pair.introductionId,
          medium: 'voice',
        })
      ).kind,
    ).toBe('not_permitted');
  });
});

describe('an invitation expires on its own', () => {
  it('refuses an acceptance after the deadline and records the expiry', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');

    clockOffsetMilliseconds = 60_000;
    expect((await realtime.service.accept(pair.b, invited.view.id)).kind).toBe(
      'not_permitted',
    );
    const rows = await rowsOf<{ end_reason: string; state: string }>(
      database.sql`select state, end_reason from realtime_sessions where id = ${invited.view.id}`,
    );
    expect(rows[0]?.state).toBe('expired');
    expect(rows[0]?.end_reason).toBe('invitation_expired');
  });

  it('expires due invitations from the sweep, exactly once each', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');

    clockOffsetMilliseconds = 60_000;
    expect(await realtime.service.expireDueInvitations()).toBe(1);
    // A second sweep finds nothing, because the first one moved the row out of
    // the state the sweep selects.
    expect(await realtime.service.expireDueInvitations()).toBe(0);
    expect(await stateOf(invited.view.id)).toBe('expired');
  });

  it('frees the pair once the invitation has expired', async () => {
    const pair = await introducedPair();
    const first = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (first.kind !== 'call') throw new Error('expected a call');

    clockOffsetMilliseconds = 60_000;
    await realtime.service.expireDueInvitations();
    const second = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (second.kind !== 'call') throw new Error('expected a call');
    expect(second.view.id).not.toBe(first.view.id);
  });
});

describe('the database refuses what the domain forbids', () => {
  it('will not record a call with a third participant', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    const stranger = await consumer('third@rtc.test');

    // Both roles are already taken, so there is no role a third row could hold.
    expect(
      await refused(() =>
        execute(database.sql`insert into realtime_participants (invited_at, role, session_id, user_id)
         values (now(), 'caller', ${invited.view.id}, ${stranger.id})`),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(database.sql`insert into realtime_participants (invited_at, role, session_id, user_id)
         values (now(), 'recipient', ${invited.view.id}, ${stranger.id})`),
      ),
    ).toBe(true);
  });

  it('will not record the same person on both sides', async () => {
    const pair = await introducedPair();
    expect(
      await refused(() =>
        execute(database.sql`insert into realtime_sessions
           (authorization_generation, created_at, id, initiator_id, invitation_expires_at,
            medium, origin_introduction_id, pair_high_id, pair_low_id, state, state_entered_at, updated_at)
         values (1, now(), ${crypto.randomUUID()}, ${pair.a.id}, now() + interval '1 minute',
            'voice', ${pair.introductionId}, ${pair.a.id}, ${pair.a.id}, 'invited', now(), now())`),
      ),
    ).toBe(true);
  });

  it('will not record an initiator who is not one of the two people', async () => {
    const pair = await introducedPair();
    const stranger = await consumer('outsider@rtc.test');
    const ordered = [pair.a.id, pair.b.id].sort();
    expect(
      await refused(() =>
        execute(database.sql`insert into realtime_sessions
           (authorization_generation, created_at, id, initiator_id, invitation_expires_at,
            medium, origin_introduction_id, pair_high_id, pair_low_id, state, state_entered_at, updated_at)
         values (1, now(), ${crypto.randomUUID()}, ${stranger.id}, now() + interval '1 minute',
            'voice', ${pair.introductionId}, ${ordered[1] ?? ''}, ${ordered[0] ?? ''}, 'invited', now(), now())`),
      ),
    ).toBe(true);
  });

  it('will not record a terminal state without when and why it ended', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    expect(
      await refused(() =>
        execute(
          database.sql`update realtime_sessions set state = 'ended' where id = ${invited.view.id}`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`update realtime_sessions set state = 'ended', ended_at = now() where id = ${invited.view.id}`,
        ),
      ),
    ).toBe(true);
  });

  it('will not record media as observed on a call nobody answered', async () => {
    const pair = await introducedPair();
    const invited = await realtime.service.invite(pair.a, {
      introductionId: pair.introductionId,
      medium: 'voice',
    });
    if (invited.kind !== 'call') throw new Error('expected a call');
    expect(
      await refused(() =>
        execute(
          database.sql`update realtime_sessions set connected_at = now() where id = ${invited.view.id}`,
        ),
      ),
    ).toBe(true);
  });
});

describe('nothing about a call is stored that should not be', () => {
  it('holds no column for media, transport, or an address', async () => {
    const columns = await rowsOf<{
      column_name: string;
    }>(database.sql`select column_name from information_schema.columns
       where table_schema = 'public' and table_name like 'realtime_%'`);
    const names = columns.map((row) => row.column_name);
    expect(names.length).toBeGreaterThan(0);
    for (const forbidden of [
      'sdp',
      'ice',
      'ice_candidate',
      'candidate',
      'turn_credential',
      'turn_username',
      'turn_password',
      'join_token',
      'token',
      'credential',
      'secret',
      'ip',
      'ip_address',
      'remote_address',
      'recording',
      'recording_url',
      'transcript',
      'media_url',
      'audio',
      'video_url',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('keeps every realtime table free of a foreign key outside the domain', async () => {
    const rows = await rowsOf<{
      foreign_table: string;
      source: string;
    }>(database.sql`select tc.table_name as source, ccu.table_name as foreign_table
         from information_schema.table_constraints tc
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_name like 'realtime_%'`);
    for (const row of rows) {
      expect(row.foreign_table.startsWith('realtime_')).toBe(true);
    }
  });
});
