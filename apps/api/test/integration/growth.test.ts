import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import {
  connectDatabase,
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
 * GROWTH, against real PostgreSQL.
 *
 * The domain exists because VELORA has no acquisition budget, so what is proved
 * here is not that rows can be written — it is the five properties that decide
 * whether an invitation is worth anything at all.
 *
 * **An account has exactly one origin, forever.** Not "the service checks
 * first": the account is the primary key, so a second attribution cannot be
 * written by a race, a retry, or a client that decided to send it twice.
 *
 * **Attribution happens only on the request that created the account.** An
 * account that already exists calls the provisioning route on every sign-in,
 * and one that could claim an invitation there could claim one a year later.
 *
 * **Nobody invites themselves.** Refused by the service with a real answer and
 * by a CHECK constraint underneath it, so it stays true if the service is ever
 * wrong.
 *
 * **A person refreshing an invitation page is one opening.** Otherwise every
 * number this domain produces is whatever a bored visitor felt like making it.
 *
 * **A window's state is arithmetic, not a job.** Nothing sweeps, nothing
 * schedules, and a worker that was restarted, late, or never started changes no
 * answer — which is the failure this repository has already had twice.
 */

const databaseUrl = await provisionDatabase('velora_growth');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const config = testServerConfig();
const logger = silentLogger();

/**
 * A clock the suite moves, because every window assertion is about a moment.
 *
 * Read through a function everywhere, so moving it moves what the application
 * believes rather than what this file believes.
 */
let clock = new Date('2026-06-01T12:00:00.000Z');
const now = () => clock;

/**
 * A code this suite can name.
 *
 * The generator draws from a 36-character alphabet by rejection sampling, so
 * bytes of a fixed value produce a fixed code — and a test that could not name
 * the code would have to read it back before it could use it, which is exactly
 * the read the idempotency assertions are trying to avoid depending on.
 */
let codeByte = 0;
const randomBytes = (size: number) => new Uint8Array(size).fill(codeByte % 36);

let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `growth-test-${String(requesterSequence)}`;
    },
  },
});

const mediaForUsers = testMediaRuntime({
  config,
  database: database.drizzle,
  logger,
  now,
});

/*
 * The application's own arrangement, including the order that makes it work.
 *
 * GROWTH composes after ADMIN and USERS composes before both, so USERS is given
 * a way to ask for the attribution contract later rather than the contract
 * itself. Reproducing that here is the point: a harness that handed USERS a
 * ready-made GROWTH would be proving a composition the application cannot have.
 */
const users = createUsersRuntime({
  // Referenced before it is defined on purpose: the closure runs when an
  // account is created, which is long after this file has finished evaluating.
  // It is the same late resolution the application performs, and reproducing it
  // is the point — a harness that handed USERS a ready-made GROWTH would be
  // proving a composition the application cannot have.
  attribution: () => runtimes.growth.service,
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
  randomBytes,
  users,
});
const growth = runtimes.growth;

const application = createApplication({
  config,
  dependencies: {
    admin: runtimes.admin,
    auth,
    billing: runtimes.billing,
    clubs: runtimes.clubs,
    creators: runtimes.creators,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    discovery: runtimes.discovery,
    ephemeralRedis: healthy,
    growth: runtimes.growth,
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
  clock = new Date('2026-06-01T12:00:00.000Z');
  codeByte = 0;
  await database.truncate();
});

interface Credentials {
  readonly cookie: string;
  readonly csrf: string;
  readonly id: string;
}

function request(
  path: string,
  init: {
    readonly body?: unknown;
    readonly credentials?: Credentials;
    readonly method?: string;
    readonly origin?: string;
  } = {},
): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: init.origin ?? testConsumerOrigin,
  };
  if (init.credentials !== undefined) {
    headers.cookie = init.credentials.cookie;
    headers['x-velora-csrf'] = init.credentials.csrf;
  }
  return new Request(`http://api.test${path}`, {
    headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    method: init.method ?? 'GET',
  });
}

async function sessionFor(subject: string): Promise<Credentials> {
  const response = await handle(
    request('/v1/auth/local/web-sessions', {
      body: { audience: 'consumer_web', subject },
      method: 'POST',
    }),
  );
  const session = (await response.json()) as { csrfToken?: string };
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
  return { cookie, csrf: session.csrfToken ?? '', id: '' };
}

/** A session that has been through account provisioning, carrying an origin. */
async function accountFor(
  subject: string,
  acquisition?: Record<string, unknown>,
): Promise<Credentials> {
  const credentials = await sessionFor(subject);
  const created = await handle(
    request('/v1/users', {
      body: acquisition === undefined ? {} : { acquisition },
      credentials,
      method: 'POST',
    }),
  );
  const account = (await created.json()) as { id: string };
  return { ...credentials, id: account.id };
}

async function inviteCodeFor(credentials: Credentials): Promise<string> {
  const response = await handle(
    request('/v1/growth/invite', { credentials, method: 'POST' }),
  );
  const body = (await response.json()) as {
    invite?: { code: string };
  };
  return body.invite?.code ?? '';
}

interface AttributionRow {
  readonly campaign: string | null;
  readonly invite_id: string | null;
  readonly inviter_user_id: string | null;
  readonly medium: string | null;
  readonly source: string;
  readonly user_id: string;
}

async function attributions(): Promise<AttributionRow[]> {
  return rowsOf<AttributionRow>(
    database.sql`select * from growth_signup_attributions`,
  );
}

describe('an invitation link', () => {
  it('is minted once and is the same link forever', async () => {
    const alex = await accountFor('growth-alex');
    const first = await handle(
      request('/v1/growth/invite', { credentials: alex, method: 'POST' }),
    );
    codeByte = 7; // A different code, if the second call ever minted one.
    const second = await handle(
      request('/v1/growth/invite', { credentials: alex, method: 'POST' }),
    );
    const firstBody = (await first.json()) as { invite: { code: string } };
    const secondBody = (await second.json()) as { invite: { code: string } };

    expect(first.status).toBe(200);
    expect(secondBody.invite.code).toBe(firstBody.invite.code);
    const rows = await rowsOf<{ code: string }>(
      database.sql`select code from growth_invites`,
    );
    expect(rows).toHaveLength(1);
  });

  it('is absent until somebody asks for one', async () => {
    const alex = await accountFor('growth-quiet');
    const response = await handle(
      request('/v1/growth/invite', { credentials: alex }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  });

  it('is refused to somebody with no session', async () => {
    const response = await handle(
      request('/v1/growth/invite', { method: 'POST' }),
    );
    expect(response.status).toBe(401);
  });
});

describe('opening an invitation', () => {
  it('says whether the code works without saying who sent it', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    const response = await handle(
      request('/v1/growth/invitations/openings', {
        body: { code, openingKey: 'aaaaaaaaaaaaaaaaaaaaaa' },
        method: 'POST',
      }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toEqual({ usable: true });
    // Nothing about the inviter reaches a caller who holds a forwarded link.
    expect(JSON.stringify(body)).not.toContain(alex.id);
  });

  it('answers an unknown code the same way it answers a known one', async () => {
    const response = await handle(
      request('/v1/growth/invitations/openings', {
        body: {
          code: 'zzzzzzzzzzzzzzzzzzzzzz',
          openingKey: 'bbbbbbbbbbbbbbbbbbbbbb',
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ usable: false });
  });

  it('counts a person refreshing ten times as one opening', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await handle(
        request('/v1/growth/invitations/openings', {
          body: { code, openingKey: 'cccccccccccccccccccccc' },
          method: 'POST',
        }),
      );
    }
    const rows = await rowsOf<{ name: string }>(
      database.sql`select name from growth_acquisition_events where name = 'invite_opened'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('counts two different visitors as two openings', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    for (const key of ['dddddddddddddddddddddd', 'eeeeeeeeeeeeeeeeeeeeee']) {
      await handle(
        request('/v1/growth/invitations/openings', {
          body: { code, openingKey: key },
          method: 'POST',
        }),
      );
    }
    const rows = await rowsOf<{ name: string }>(
      database.sql`select name from growth_acquisition_events where name = 'invite_opened'`,
    );
    expect(rows).toHaveLength(2);
  });

  it('refuses a code that is not the shape this platform issues', async () => {
    const response = await handle(
      request('/v1/growth/invitations/openings', {
        body: { code: 'nope', openingKey: 'ffffffffffffffffffffff' },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(422);
  });
});

describe('where an account came from', () => {
  it('is recorded once, on the request that created the account', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    const blake = await accountFor('growth-blake', { inviteCode: code });

    const rows = await attributions();
    const attributed = rows.find((row) => row.user_id === blake.id);
    expect(attributed?.source).toBe('invite');
    expect(attributed?.inviter_user_id).toBe(alex.id);
  });

  it('cannot be claimed later by an account that already exists', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    // An account that already exists provisions again on every sign-in. This is
    // the request an older account would use to claim somebody's invitation.
    const blake = await accountFor('growth-blake');
    await handle(
      request('/v1/users', {
        body: { acquisition: { inviteCode: code } },
        credentials: blake,
        method: 'POST',
      }),
    );

    const rows = await attributions();
    const attributed = rows.find((row) => row.user_id === blake.id);
    expect(attributed?.source).toBe('direct');
    expect(attributed?.inviter_user_id).toBeNull();
  });

  it('refuses an account that presents its own invitation', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    // Alex's own account already has an origin, so the self-referral has to be
    // attempted by an account minted with Alex's own code — which is what the
    // same person signing up twice on one device looks like.
    const rows = await attributions();
    const own = rows.find((row) => row.user_id === alex.id);
    expect(own?.inviter_user_id).toBeNull();

    // And directly: the service refuses a self-referral rather than writing one.
    await growth.service.attributeSignup({
      acquisition: { inviteCode: code },
      userId: alex.id,
    });
    const after = await attributions();
    expect(after.find((row) => row.user_id === alex.id)?.inviter_user_id).toBe(
      null,
    );
  });

  it('records an arrival through a dead link as an arrival', async () => {
    const blake = await accountFor('growth-blake', {
      inviteCode: 'zzzzzzzzzzzzzzzzzzzzzz',
      source: 'newsletter',
    });
    const rows = await attributions();
    const attributed = rows.find((row) => row.user_id === blake.id);
    expect(attributed?.source).toBe('newsletter');
    expect(attributed?.invite_id).toBeNull();
  });

  it('counts a signup with nothing attached as direct', async () => {
    const blake = await accountFor('growth-blake');
    const rows = await attributions();
    expect(rows.find((row) => row.user_id === blake.id)?.source).toBe('direct');
  });

  it('lets an invitation win over a campaign label on the same link', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    const blake = await accountFor('growth-blake', {
      inviteCode: code,
      source: 'somewhere-else',
    });
    const rows = await attributions();
    expect(rows.find((row) => row.user_id === blake.id)?.source).toBe('invite');
  });

  it('strips and bounds a hostile campaign label rather than refusing a signup', async () => {
    const hostile = `<script>alert(1)</script>${'x'.repeat(300)}`;
    const blake = await accountFor('growth-blake', {
      campaign: hostile.slice(0, 200),
      medium: "'; drop table growth_invites; --",
      source: 'newsletter',
    });
    const rows = await attributions();
    const attributed = rows.find((row) => row.user_id === blake.id);
    expect(attributed).toBeDefined();
    expect(attributed?.campaign ?? '').not.toContain('<');
    expect((attributed?.campaign ?? '').length).toBeLessThanOrEqual(64);
    expect(attributed?.medium ?? '').not.toContain(';');
    // The table it tried to name is still there.
    const invites = await rowsOf<{ code: string }>(
      database.sql`select code from growth_invites`,
    );
    expect(invites).toHaveLength(0);
  });

  it('is refused outright when a campaign label is longer than the contract', async () => {
    const credentials = await sessionFor('growth-huge');
    const response = await handle(
      request('/v1/users', {
        body: { acquisition: { source: 'x'.repeat(5_000) } },
        credentials,
        method: 'POST',
      }),
    );
    expect(response.status).toBe(422);
  });

  it('survives two provisioning requests racing on one new account', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    const credentials = await sessionFor('growth-racer');
    const [first, second] = await Promise.all([
      handle(
        request('/v1/users', {
          body: { acquisition: { inviteCode: code } },
          credentials,
          method: 'POST',
        }),
      ),
      handle(
        request('/v1/users', {
          body: { acquisition: { inviteCode: code } },
          credentials,
          method: 'POST',
        }),
      ),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const rows = await attributions();
    expect(rows.filter((row) => row.inviter_user_id === alex.id)).toHaveLength(
      1,
    );
  });

  it('keeps working when the inviter has been deleted from beneath it', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    const blake = await accountFor('growth-blake', { inviteCode: code });
    // The account rows are USERS' and GROWTH holds an opaque reference with no
    // foreign key, so an account disappearing must not take the record of where
    // somebody came from with it.
    await database.sql`delete from users_accounts where id = ${alex.id}`;
    const rows = await attributions();
    expect(rows.find((row) => row.user_id === blake.id)?.inviter_user_id).toBe(
      alex.id,
    );
  });
});

describe('a scheduled live window', () => {
  const scheduled = {
    endsAt: '2026-06-02T21:00:00.000Z',
    slug: 'friday-evening',
    startsAt: '2026-06-02T19:00:00.000Z',
    title: 'Friday evening',
  };

  async function schedule(body: Record<string, unknown>): Promise<Response> {
    return handle(
      request('/v1/admin/growth/live-windows', { body, method: 'POST' }),
    );
  }

  it('is refused to a consumer session', async () => {
    const alex = await accountFor('growth-alex');
    const response = await handle(
      request('/v1/admin/growth/live-windows', {
        body: scheduled,
        credentials: alex,
        method: 'POST',
      }),
    );
    expect([401, 403]).toContain(response.status);
  });

  it('is refused to nobody at all', async () => {
    expect((await schedule(scheduled)).status).toBe(401);
  });

  it('publishes nothing to anybody until an operator schedules one', async () => {
    const response = await handle(request('/v1/growth/live-windows'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ windows: [] });
  });

  it('reports upcoming, then active, then nothing, from the clock alone', async () => {
    await growth.service.scheduleWindow({
      endsAt: new Date(scheduled.endsAt),
      slug: scheduled.slug,
      startsAt: new Date(scheduled.startsAt),
      title: scheduled.title,
    });

    const read = async () => {
      const response = await handle(request('/v1/growth/live-windows'));
      return (await response.json()) as {
        windows: { slug: string; state: string }[];
      };
    };

    expect((await read()).windows[0]?.state).toBe('upcoming');

    // No job runs, nothing is swept, and no process is restarted. The only
    // thing that changes is the time.
    clock = new Date('2026-06-02T20:00:00.000Z');
    expect((await read()).windows[0]?.state).toBe('active');

    clock = new Date('2026-06-02T22:00:00.000Z');
    expect((await read()).windows).toHaveLength(0);

    // And the row is still there — it ended, it was not deleted.
    const rows = await rowsOf<{ slug: string }>(
      database.sql`select slug from growth_live_windows`,
    );
    expect(rows).toHaveLength(1);
  });

  it('publishes no attendance figure of any kind', async () => {
    await growth.service.scheduleWindow({
      endsAt: new Date(scheduled.endsAt),
      slug: scheduled.slug,
      startsAt: new Date(scheduled.startsAt),
      title: scheduled.title,
    });
    const response = await handle(request('/v1/growth/live-windows'));
    const body = (await response.json()) as {
      windows: Record<string, unknown>[];
    };
    expect(Object.keys(body.windows[0] ?? {}).sort()).toEqual([
      'endsAt',
      'slug',
      'startsAt',
      'state',
      'title',
    ]);
  });

  it('refuses a window that ends before it starts', async () => {
    const outcome = await growth.service.scheduleWindow({
      endsAt: new Date('2026-06-02T18:00:00.000Z'),
      slug: 'backwards',
      startsAt: new Date('2026-06-02T19:00:00.000Z'),
      title: 'Backwards',
    });
    expect(outcome.kind).toBe('refused');
  });

  it('refuses a window longer than a day, which concentrates nobody', async () => {
    const outcome = await growth.service.scheduleWindow({
      endsAt: new Date('2026-06-05T19:00:00.000Z'),
      slug: 'the-whole-week',
      startsAt: new Date('2026-06-02T19:00:00.000Z'),
      title: 'The whole week',
    });
    expect(outcome.kind).toBe('refused');
  });

  it('moves a window rather than making a second one at the same address', async () => {
    for (const startsAt of [
      '2026-06-02T19:00:00.000Z',
      '2026-06-03T19:00:00.000Z',
    ]) {
      await growth.service.scheduleWindow({
        endsAt: new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1_000),
        slug: scheduled.slug,
        startsAt: new Date(startsAt),
        title: scheduled.title,
      });
    }
    const rows = await rowsOf<{ starts_at: Date }>(
      database.sql`select starts_at from growth_live_windows`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.starts_at.toISOString()).toBe('2026-06-03T19:00:00.000Z');
  });

  it('stops publishing a window an operator withdrew', async () => {
    await growth.service.scheduleWindow({
      endsAt: new Date(scheduled.endsAt),
      slug: scheduled.slug,
      startsAt: new Date(scheduled.startsAt),
      title: scheduled.title,
    });
    await growth.service.cancelWindow(scheduled.slug);
    const response = await handle(request('/v1/growth/live-windows'));
    expect(await response.json()).toEqual({ windows: [] });
  });

  it('answers a slug nobody holds the same way it answers a cancelled one', async () => {
    await growth.service.cancelWindow('never-existed');
    const response = await handle(request('/v1/growth/live-windows'));
    expect(response.status).toBe(200);
  });
});

describe('what an operator is told', () => {
  it('is counts, with no identifier and no percentage in the answer', async () => {
    const alex = await accountFor('growth-alex');
    const code = await inviteCodeFor(alex);
    await handle(
      request('/v1/growth/invitations/openings', {
        body: { code, openingKey: 'gggggggggggggggggggggg' },
        method: 'POST',
      }),
    );
    const blake = await accountFor('growth-blake', { inviteCode: code });

    const summary = await growth.service.acquisitionSummary();
    expect(summary.invitesCreated).toBe(1);
    expect(summary.invitationsOpened).toBe(1);
    expect(summary.signupsAttributed).toBe(2);
    expect(
      summary.sources.find((entry) => entry.source === 'invite')?.signups,
    ).toBe(1);
    const encoded = JSON.stringify(summary);
    expect(encoded).not.toContain(alex.id);
    expect(encoded).not.toContain(blake.id);
    expect(encoded).not.toContain(code);
  });

  it('is refused to a consumer session', async () => {
    const alex = await accountFor('growth-alex');
    const response = await handle(
      request('/v1/admin/growth/acquisition', { credentials: alex }),
    );
    expect([401, 403]).toContain(response.status);
  });
});
