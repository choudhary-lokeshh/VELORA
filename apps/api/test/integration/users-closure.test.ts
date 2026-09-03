import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createAccountClosureRuntime } from '../../src/users/closure-composition.js';
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
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * Leaving, against real PostgreSQL.
 *
 * The competitor complaint is one of the loudest in the category: the Delete
 * Account button does not delete anything, and often is not there at all. So
 * what is proved here is not that a status column can be written. It is that
 * closing an account actually takes away everything the account could still be
 * used for, in one act, and that what it says about itself afterwards is true.
 *
 * Four properties.
 *
 * **Authority is gone.** The session that made the request cannot make another
 * one, and neither can any other session the account held.
 *
 * **Reachability is gone.** Push registrations are retired and any availability
 * window is closed, so nothing is queued for somebody who has left and no
 * matcher reads them as reachable.
 *
 * **It is idempotent.** Somebody who taps twice, or whose response was lost, is
 * asking for the state they already have — and is answered with it rather than
 * with an error that leaves them unsure whether it worked.
 *
 * **It does not claim erasure.** `erasureScheduled` is false and the surfaces
 * read it, because destroying what remains depends on retention schedules
 * nobody has approved and inventing one is the retention error that cannot be
 * undone.
 */

const databaseUrl = await provisionDatabase('velora_users_closure');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig();
const logs: unknown[] = [];
const logger = silentLogger(logs);
const now = () => new Date();

let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `closure-test-${String(requesterSequence)}`;
    },
  },
});

const mediaForUsers = testMediaRuntime({
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
  media: mediaForUsers.service,
  now,
});
const runtimes = testProductRuntimes({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  now,
  users,
});
// LIVE is deliberately absent from this composition. What it contributes to a
// closure — ending an encounter and leaving the pool — is proved in the live
// suite, where the matcher that allocates one actually exists; here the point
// is that closure works without it rather than depending on it.
const accountClosure = createAccountClosureRuntime({
  auth: auth.service,
  consumerContext: users.consumerContext,
  database: database.drizzle,
  devices: runtimes.notifications.repository,
  logger,
  now,
  repository: users.repository,
});

const application = createApplication({
  config,
  dependencies: {
    accountClosure,
    admin: runtimes.admin,
    auth,
    billing: runtimes.billing,
    clubs: runtimes.clubs,
    creators: runtimes.creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery: runtimes.discovery,
    ephemeralRedis: healthy,
    identity: runtimes.identity,
    logger,
    media: runtimes.media,
    messaging: runtimes.messaging,
    notifications: runtimes.notifications,
    payouts: runtimes.payouts,
    queueRedis: healthy,
    safety: runtimes.safety,
    support: runtimes.support,
    users,
  },
});
const handle = (request: Request) => application.app.handle(request);

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  logs.length = 0;
  await database.truncate();
});

interface Credentials {
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
}

function post(path: string, credentials: Credentials, body?: unknown): Request {
  return new Request(`http://api.test${path}`, {
    body: JSON.stringify(body ?? {}),
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

async function signIn(
  subject: string,
): Promise<{ readonly cookie: string; readonly csrf: string }> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'consumer_web', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testConsumerOrigin,
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
  const provisional = { ...session, id: '' };
  const created = await handle(post('/v1/users', provisional));
  const account = (await created.json()) as { id: string };
  const caller: Credentials = { ...session, id: account.id };
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
  return caller;
}

async function close(caller: Credentials): Promise<{
  readonly body: Record<string, unknown>;
  readonly status: number;
}> {
  const response = await handle(
    post('/v1/users/me/closure', caller, {
      acknowledgement: 'close-my-account',
    }),
  );
  return {
    body: (await response.json()) as Record<string, unknown>,
    status: response.status,
  };
}

describe('somebody can actually leave', () => {
  it('closes the account and says what that means', async () => {
    const caller = await consumer('closure-one@velora.test');

    const closed = await close(caller);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('deletion_pending');
    // Published and false. Physically destroying what remains depends on
    // retention schedules nobody has approved, and this is where a surface
    // reads that rather than assuming it.
    expect(closed.body.erasureScheduled).toBe(false);
    expect(typeof closed.body.requestedAt).toBe('string');

    const rows = await rowsOf<{
      deletion_requested_at: Date | null;
      status: string;
      status_reason: string | null;
    }>(
      database.sql`
        select status, status_reason, deletion_requested_at
        from users_accounts where id = ${caller.id}::uuid
      `,
    );
    expect(rows[0]?.status).toBe('deletion_pending');
    // The coarse cause the account owner may see. Not `safety_enforcement`,
    // which would say somebody else did this to them.
    expect(rows[0]?.status_reason).toBe('user_requested');
    expect(rows[0]?.deletion_requested_at).not.toBeNull();
  });

  it('takes every session away, including the one that asked', async () => {
    const caller = await consumer('closure-sessions@velora.test');
    // A second device, signed in before the closure.
    const second = await signIn('closure-sessions@velora.test');

    const before = await handle(get('/v1/auth/session', caller));
    expect(before.status).toBe(200);

    expect((await close(caller)).status).toBe(200);

    // The session that made the request cannot make another one.
    const after = await handle(get('/v1/auth/session', caller));
    expect(after.status).toBe(401);
    // And neither can the other device. A closure that only ended the session
    // in somebody's hand would be a sign-out wearing a different word.
    const other = await handle(
      get('/v1/auth/session', { ...second, id: caller.id }),
    );
    expect(other.status).toBe(401);

    const revoked = await rowsOf<{ count: string }>(
      database.sql`
        select count(*)::text as count from auth_sessions
        where revocation_reason = 'account_closed'
      `,
    );
    expect(Number(revoked[0]?.count ?? '0')).toBeGreaterThanOrEqual(2);
  });

  it('retires every push registration rather than deleting it', async () => {
    const caller = await consumer('closure-devices@velora.test');
    const registered = await handle(
      post('/v1/notifications/devices', caller, {
        installationId: 'installation-closure-01',
        platform: 'android',
        token: 'a'.repeat(64),
      }),
    );
    expect(registered.status).toBe(200);

    expect((await close(caller)).status).toBe(200);

    const devices = await rowsOf<{
      disable_reason: string | null;
      disabled_at: Date | null;
    }>(
      database.sql`
        select disable_reason, disabled_at from notifications_push_devices
        where recipient_id = ${caller.id}::uuid
      `,
    );
    expect(devices).toHaveLength(1);
    // Retired, not removed: the row is evidence that a device was reachable,
    // and a row that is gone cannot answer why a notice stopped arriving.
    expect(devices[0]?.disabled_at).not.toBeNull();
    expect(devices[0]?.disable_reason).toBe('account_closed');
  });

  it('closes any availability window, so no matcher reads them as reachable', async () => {
    const caller = await consumer('closure-availability@velora.test');
    await handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Available',
        languages: ['es'],
      }),
    );
    await handle(
      post('/v1/users/me/availability', caller, {
        availableUntil: new Date(Date.now() + 3_600_000).toISOString(),
        state: 'available',
      }),
    );

    expect((await close(caller)).status).toBe(200);

    const rows = await rowsOf<{ state: string }>(
      database.sql`select state from users_availability where user_id = ${caller.id}::uuid`,
    );
    expect(rows[0]?.state).toBe('unavailable');
  });

  it('answers a repeated request with the closure that already exists', async () => {
    const caller = await consumer('closure-idempotent@velora.test');
    const first = await close(caller);
    expect(first.status).toBe(200);

    // The first closure revoked the cookie, so a second request needs a new
    // session — which is exactly what somebody who signs back in has.
    const again = await signIn('closure-idempotent@velora.test');
    const second = await close({ ...again, id: caller.id });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('deletion_pending');
    expect(second.body.requestedAt).toBe(first.body.requestedAt);

    const rows = await rowsOf<{ count: string }>(
      database.sql`
        select count(*)::text as count from users_accounts
        where id = ${caller.id}::uuid and status = 'deletion_pending'
      `,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('answers two closures asked at the same instant with one transition', async () => {
    const caller = await consumer('closure-race@velora.test');
    // Two devices, both already signed in, both asked at once. This is the
    // shape the compare-and-set exists for: the second request reads the same
    // open status the first did, and only one of them may write.
    const other = await signIn('closure-race@velora.test');
    const [first, second] = await Promise.all([
      close(caller),
      close({ ...other, id: caller.id }),
    ]);

    // Whichever lost may find the session it was holding already revoked by
    // the closure it raced with — that is the closure working, not a fault.
    // What must never happen is a failure that says the product broke.
    for (const answer of [first, second]) {
      expect(answer.status === 200 || answer.status === 401).toBe(true);
    }
    expect(first.status === 200 || second.status === 200).toBe(true);

    const rows = await rowsOf<{
      count: string;
      requested: Date | null;
    }>(
      database.sql`
        select count(*)::text as count, max(deletion_requested_at) as requested
        from users_accounts
        where id = ${caller.id}::uuid and status = 'deletion_pending'
      `,
    );
    expect(rows[0]?.count).toBe('1');
    const requested = rows[0]?.requested;
    if (requested === null || requested === undefined) {
      throw new Error('the closure recorded no moment it was asked for');
    }
    const asked = requested.toISOString();

    // Every answer that succeeded names the one moment this was asked for, and
    // the loser did not restamp it. A closure whose recorded request moves is a
    // closure no retention schedule could ever be measured from.
    for (const answer of [first, second]) {
      if (answer.status !== 200) continue;
      expect(answer.body.requestedAt).toBe(asked);
    }

    const again = await signIn('closure-race@velora.test');
    const readBack = await handle(
      get('/v1/users/me/closure', { ...again, id: caller.id }),
    );
    expect(readBack.status).toBe(200);
    expect(
      ((await readBack.json()) as { requestedAt: string }).requestedAt,
    ).toBe(asked);
  });

  it('lets somebody who signs back in read what happened to their account', async () => {
    const caller = await consumer('closure-readback@velora.test');
    expect((await close(caller)).status).toBe(200);

    const again = await signIn('closure-readback@velora.test');
    const closure = await handle(
      get('/v1/users/me/closure', { ...again, id: caller.id }),
    );
    expect(closure.status).toBe(200);
    const body = (await closure.json()) as Record<string, unknown>;
    expect(body.status).toBe('deletion_pending');
    expect(body.erasureScheduled).toBe(false);

    // And the account read still answers, so a surface can explain rather than
    // refusing everything without saying why.
    const account = await handle(
      get('/v1/users/me', { ...again, id: caller.id }),
    );
    expect(account.status).toBe(200);
    expect(((await account.json()) as { status: string }).status).toBe(
      'deletion_pending',
    );
  });

  it('answers nothing to read for an account nobody has closed', async () => {
    const caller = await consumer('closure-open@velora.test');
    const closure = await handle(get('/v1/users/me/closure', caller));
    expect(closure.status).toBe(404);
  });

  it('refuses a request that does not carry the acknowledgement', async () => {
    const caller = await consumer('closure-acknowledgement@velora.test');
    const empty = await handle(post('/v1/users/me/closure', caller, {}));
    const wrong = await handle(
      post('/v1/users/me/closure', caller, { acknowledgement: 'yes' }),
    );
    expect(empty.status).toBe(422);
    expect(wrong.status).toBe(422);

    // Nothing moved.
    const rows = await rowsOf<{ status: string }>(
      database.sql`select status from users_accounts where id = ${caller.id}::uuid`,
    );
    expect(rows[0]?.status).not.toBe('deletion_pending');
  });

  it('serves an account that is restricted, because leaving is not a privilege', async () => {
    const caller = await consumer('closure-restricted@velora.test');
    await execute(
      database.sql`
        update users_accounts
        set status = 'restricted', status_reason = 'safety_enforcement',
            status_changed_at = now()
        where id = ${caller.id}::uuid
      `,
    );

    const closed = await close(caller);
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe('deletion_pending');
  });

  it('takes the account out of the product, not only out of this session', async () => {
    const caller = await consumer('closure-product@velora.test');
    await handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Alex',
        languages: ['es'],
      }),
    );
    const availableBefore = await handle(
      post('/v1/users/me/availability', caller, {
        availableUntil: new Date(Date.now() + 3_600_000).toISOString(),
        state: 'available',
      }),
    );
    expect(availableBefore.status).toBe(200);

    expect((await close(caller)).status).toBe(200);

    // Signing back in gets a session and nothing else. This is not a special
    // case anybody wrote for closure: every product predicate already reads
    // `pending_profile` or `active` for good standing, and `deletion_pending`
    // is neither, so the account loses the product in one transition rather
    // than through a list of cooperating changes somebody could forget.
    const again = await signIn('closure-product@velora.test');
    const reopened: Credentials = { ...again, id: caller.id };
    const availableAfter = await handle(
      post('/v1/users/me/availability', reopened, {
        availableUntil: new Date(Date.now() + 3_600_000).toISOString(),
        state: 'available',
      }),
    );
    expect(availableAfter.status).toBe(409);

    const profileEdit = await handle(
      post('/v1/users/me/profile', reopened, {
        displayName: 'Alex Again',
        languages: ['es'],
      }),
    );
    expect(profileEdit.status).toBe(409);
  });

  it('never writes who left into a log line', async () => {
    const caller = await consumer('closure-logs@velora.test');
    expect((await close(caller)).status).toBe(200);

    const serialized = JSON.stringify(logs);
    expect(serialized).toContain('users.account.closed');
    expect(serialized).not.toContain(caller.id);
    expect(serialized).not.toContain('closure-logs@velora.test');
  });
});
