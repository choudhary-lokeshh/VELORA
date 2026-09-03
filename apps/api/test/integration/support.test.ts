import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  maximumOpenSupportTickets,
  supportReferenceAlphabet,
  supportTicketRateLimitCount,
} from '../../src/support/policy.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
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
  testAdminOrigin,
  testConsumerOrigin,
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * Consumer support, against real PostgreSQL.
 *
 * The competitor complaint this whole domain answers is the flattest one in the
 * category: there is no way to reach anybody. So what is proved here is not
 * that a table exists — it is the four properties that make a support path
 * something a person can rely on rather than something a screen claimed.
 *
 * **Submitting is retry-safe.** The connection that lost the response is very
 * often the thing being reported, and a person who taps again must not end up
 * with two tickets and no idea which one anybody is reading.
 *
 * **A reference comes back, and it is readable.** Somebody who quotes it to an
 * operator has to be able to say it out loud, which is why the alphabet has no
 * `I`, `L`, `O`, or `U`, and the database enforces the shape rather than
 * trusting the generator.
 *
 * **Nobody sees anybody else's ticket.** Somebody else's answers exactly as one
 * that does not exist, so an identifier cannot be probed.
 *
 * **An operator can actually answer one, and cannot do anything else.** Status
 * moves, notes are recorded, and there is no route from here to an account, an
 * enforcement, or a balance.
 */

const databaseUrl = await provisionDatabase('velora_support');
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
      return `support-test-${String(requesterSequence)}`;
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

function post(
  path: string,
  credentials: Credentials,
  body: unknown,
  origin = testConsumerOrigin,
): Request {
  return new Request(`http://api.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: credentials.cookie,
      origin,
      'x-velora-csrf': credentials.csrf,
    },
    method: 'POST',
  });
}

function get(
  path: string,
  credentials: Credentials,
  origin = testConsumerOrigin,
): Request {
  return new Request(`http://api.test${path}`, {
    headers: { cookie: credentials.cookie, origin },
  });
}

async function consumer(subject: string): Promise<Credentials> {
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
  const credentials = { cookie, csrf: session.csrfToken ?? '', id: '' };
  const created = await handle(post('/v1/users', credentials, {}));
  const account = (await created.json()) as { id: string };
  const caller: Credentials = { ...credentials, id: account.id };
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

/**
 * A Platform Admin session with the fresh phishing-resistant assurance the
 * operator routes require.
 *
 * Written directly, because no configured adapter can mint one: the local
 * privileged verifier is refused outside local and test and no phishing-
 * resistant verifier is approved anywhere. That is the same reason the operator
 * routes are unreachable in a deployed environment today.
 */
async function operator(): Promise<Credentials> {
  const accountId = crypto.randomUUID();
  await execute(
    database.sql`insert into auth_accounts (id, status) values (${accountId}, 'active')`,
  );
  const opaque = () =>
    `v1.${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')}`;
  const token = opaque();
  const csrf = opaque();
  const digest = (value: string) => Bun.SHA256.hash(value, 'hex');
  const moment = new Date();
  await execute(database.sql`
    insert into auth_sessions (
      id, account_id, audience, assurance, assurance_established_at,
      authenticated_at, created_at, csrf_digest, idle_expires_at,
      last_active_at, absolute_expires_at, token_digest
    ) values (
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', 'phishing_resistant', ${moment},
      ${moment}, ${moment}, ${digest(csrf)}, ${new Date(moment.getTime() + 900_000)}, ${moment},
      ${new Date(moment.getTime() + 28_800_000)}, ${digest(token)}
    )
  `);
  return {
    cookie: `__Host-velora_platform_admin_session=${token}`,
    csrf,
    id: accountId,
  };
}

interface Ticket {
  readonly category: string;
  readonly description: string;
  readonly id: string;
  readonly reference: string;
  readonly status: string;
  readonly subject: string;
  readonly updatedAt: string;
}

async function openTicket(
  caller: Credentials,
  overrides: Partial<{
    category: string;
    clientTicketId: string;
    description: string;
    subject: string;
  }> = {},
): Promise<{ readonly body: Ticket; readonly status: number }> {
  const response = await handle(
    post('/v1/support/tickets', caller, {
      category: overrides.category ?? 'account_access',
      clientTicketId: overrides.clientTicketId ?? crypto.randomUUID(),
      description:
        overrides.description ??
        'I cannot sign in on my phone and the screen just spins.',
      subject: overrides.subject ?? 'Cannot sign in',
    }),
  );
  return { body: (await response.json()) as Ticket, status: response.status };
}

describe('somebody can actually reach support', () => {
  it('records a ticket and hands back a reference to quote', async () => {
    const caller = await consumer('support-one@velora.test');
    const opened = await openTicket(caller, {
      category: 'live',
      description: 'The video freezes about ten seconds into every call.',
      subject: 'Video freezes on Live',
    });

    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('received');
    expect(opened.body.category).toBe('live');
    // Readable, sayable, and in the published shape. The alphabet excludes the
    // characters somebody reads back wrong.
    expect(opened.body.reference).toMatch(
      /^VS-[0-9A-HJ-KMNP-TV-Z]{4}-[0-9A-HJ-KMNP-TV-Z]{4}$/u,
    );
    for (const character of opened.body.reference
      .replaceAll('-', '')
      .slice(2)) {
      expect(supportReferenceAlphabet, character).toContain(character);
    }
    // Their own words come back, which is what "see your ticket" means. This is
    // deliberately unlike a safety report, whose narrative is evidence about
    // somebody else and is never echoed.
    expect(opened.body.subject).toBe('Video freezes on Live');
    expect(opened.body.description).toContain('freezes');
    // And nothing about how it is handled.
    expect(Object.keys(opened.body).sort()).toEqual([
      'category',
      'createdAt',
      'description',
      'id',
      'reference',
      'status',
      'subject',
      'updatedAt',
    ]);
  });

  it('is retry-safe, which is the whole point on a bad connection', async () => {
    const caller = await consumer('support-retry@velora.test');
    const clientTicketId = crypto.randomUUID();
    const first = await openTicket(caller, { clientTicketId });
    const second = await openTicket(caller, { clientTicketId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.reference).toBe(first.body.reference);

    const listed = await handle(get('/v1/support/tickets', caller));
    expect(
      ((await listed.json()) as { tickets: unknown[] }).tickets,
    ).toHaveLength(1);
  });

  it('lets somebody read their ticket back and nobody else read it', async () => {
    const mine = await consumer('support-mine@velora.test');
    const theirs = await consumer('support-theirs@velora.test');
    const opened = await openTicket(mine);

    const own = await handle(
      get(`/v1/support/ticket?ticketId=${opened.body.id}`, mine),
    );
    expect(own.status).toBe(200);
    expect(((await own.json()) as Ticket).reference).toBe(
      opened.body.reference,
    );

    // Somebody else's ticket answers exactly as one that does not exist.
    const stranger = await handle(
      get(`/v1/support/ticket?ticketId=${opened.body.id}`, theirs),
    );
    const absent = await handle(
      get(
        '/v1/support/ticket?ticketId=11111111-1111-4111-8111-111111111111',
        theirs,
      ),
    );
    expect(stranger.status).toBe(404);
    expect(absent.status).toBe(404);

    const theirList = await handle(get('/v1/support/tickets', theirs));
    expect(
      ((await theirList.json()) as { tickets: unknown[] }).tickets,
    ).toHaveLength(0);
  });

  it('serves an account that is restricted, because that account needs it most', async () => {
    const caller = await consumer('support-restricted@velora.test');
    await execute(
      database.sql`
        update users_accounts
        set status = 'restricted', status_reason = 'safety_enforcement',
            status_changed_at = now()
        where id = ${caller.id}::uuid
      `,
    );

    const opened = await openTicket(caller, {
      description: 'My account was restricted and I do not know why.',
      subject: 'My account is restricted',
    });
    // Requiring good standing here would deny help to precisely the people
    // asking why they cannot use the product.
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('received');
  });

  it('bounds how many one account may open, and removes nothing already made', async () => {
    const caller = await consumer('support-bounded@velora.test');
    // The open-ticket bound is the tighter of the two, so it is what refuses.
    for (let index = 0; index < maximumOpenSupportTickets; index += 1) {
      const opened = await openTicket(caller, {
        subject: `Question ${String(index)}`,
      });
      expect(opened.status).toBe(200);
    }
    expect(maximumOpenSupportTickets).toBeLessThan(supportTicketRateLimitCount);

    const refusedResponse = await handle(
      post('/v1/support/tickets', caller, {
        category: 'other',
        clientTicketId: crypto.randomUUID(),
        description: 'One more thing I wanted to ask about.',
        subject: 'One more',
      }),
    );
    expect(refusedResponse.status).toBe(409);

    const listed = await handle(get('/v1/support/tickets', caller));
    expect(
      ((await listed.json()) as { tickets: unknown[] }).tickets,
    ).toHaveLength(maximumOpenSupportTickets);
  });

  it('never writes what somebody wrote into a log line', async () => {
    const caller = await consumer('support-logs@velora.test');
    const secret = 'narrative-that-must-not-reach-a-log-line-4f2c';
    await openTicket(caller, {
      description: `Something went wrong: ${secret}`,
      subject: 'A private matter',
    });

    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('A private matter');
    // The operational signal is still there, with what an operator needs to
    // notice a spike and find the row.
    expect(serialized).toContain('support.ticket.opened');
  });
});

describe('an operator can answer a ticket, and can do nothing else with it', () => {
  it('reads the queue, moves a ticket, and records why', async () => {
    const caller = await consumer('support-queue@velora.test');
    const admin = await operator();
    const opened = await openTicket(caller);

    const queue = await handle(
      get('/v1/admin/support/tickets?status=received', admin, testAdminOrigin),
    );
    expect(queue.status).toBe(200);
    const listed = (await queue.json()) as {
      tickets: { id: string; ownerId: string }[];
    };
    expect(listed.tickets).toHaveLength(1);
    // The owner identifier is the one field the owner's own view does not
    // carry, and it is here so an operator can look the person up.
    expect(listed.tickets[0]?.ownerId).toBe(caller.id);

    const moved = await handle(
      post(
        '/v1/admin/support/tickets/update',
        admin,
        {
          note: 'Reproduced on a second device; asked engineering.',
          status: 'in_review',
          ticketId: opened.body.id,
        },
        testAdminOrigin,
      ),
    );
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as Ticket).status).toBe('in_review');

    // The owner sees the status and never the note.
    const own = await handle(
      get(`/v1/support/ticket?ticketId=${opened.body.id}`, caller),
    );
    const body = (await own.json()) as Record<string, unknown>;
    expect(body.status).toBe('in_review');
    expect(JSON.stringify(body)).not.toContain('engineering');

    // The operator sees the whole history, oldest first.
    const detail = await handle(
      get(
        `/v1/admin/support/ticket?ticketId=${opened.body.id}`,
        admin,
        testAdminOrigin,
      ),
    );
    const history = (await detail.json()) as {
      events: { kind: string; note?: string }[];
    };
    expect(history.events.map((event) => event.kind)).toEqual([
      'opened',
      'note',
      'status_changed',
    ]);
    expect(history.events[1]?.note).toContain('engineering');
  });

  it('refuses a move the status may not make', async () => {
    const caller = await consumer('support-transition@velora.test');
    const admin = await operator();
    const opened = await openTicket(caller);

    const resolveFirst = await handle(
      post(
        '/v1/admin/support/tickets/update',
        admin,
        { status: 'resolved', ticketId: opened.body.id },
        testAdminOrigin,
      ),
    );
    expect(resolveFirst.status).toBe(200);

    // `resolved -> received` is not a claim anybody may make: a ticket does not
    // become unlooked-at again.
    const backwards = await handle(
      post(
        '/v1/admin/support/tickets/update',
        admin,
        { status: 'received', ticketId: opened.body.id },
        testAdminOrigin,
      ),
    );
    expect(backwards.status).toBe(409);
  });

  it('answers a move to the status it already holds without inventing history', async () => {
    const caller = await consumer('support-idempotent@velora.test');
    const admin = await operator();
    const opened = await openTicket(caller);

    for (let index = 0; index < 3; index += 1) {
      const response = await handle(
        post(
          '/v1/admin/support/tickets/update',
          admin,
          { status: 'in_review', ticketId: opened.body.id },
          testAdminOrigin,
        ),
      );
      expect(response.status).toBe(200);
    }

    const detail = await handle(
      get(
        `/v1/admin/support/ticket?ticketId=${opened.body.id}`,
        admin,
        testAdminOrigin,
      ),
    );
    const history = (await detail.json()) as { events: { kind: string }[] };
    // One lifecycle entry, not three. An append-only history full of entries
    // that describe no change is a history nobody can read.
    expect(history.events.map((event) => event.kind)).toEqual([
      'opened',
      'status_changed',
    ]);
  });

  it('refuses every operator route to a consumer session', async () => {
    const caller = await consumer('support-audience@velora.test');
    const opened = await openTicket(caller);

    const queue = await handle(get('/v1/admin/support/tickets', caller));
    const detail = await handle(
      get(`/v1/admin/support/ticket?ticketId=${opened.body.id}`, caller),
    );
    const update = await handle(
      post('/v1/admin/support/tickets/update', caller, {
        status: 'closed',
        ticketId: opened.body.id,
      }),
    );
    for (const response of [queue, detail, update]) {
      expect(response.status).toBe(403);
    }

    // And the ticket did not move.
    const own = await handle(
      get(`/v1/support/ticket?ticketId=${opened.body.id}`, caller),
    );
    expect(((await own.json()) as Ticket).status).toBe('received');
  });
});

describe('the database enforces the support invariants', () => {
  it('refuses a second ticket under the same client identifier', async () => {
    const caller = await consumer('support-db-idem@velora.test');
    const opened = await openTicket(caller, { clientTicketId: 'fixed-key-01' });
    expect(opened.status).toBe(200);

    expect(
      await refused(
        () => database.sql`
          insert into support_tickets (
            id, owner_id, client_ticket_id, category, subject, description,
            reference, status, created_at, updated_at
          ) values (
            ${crypto.randomUUID()}, ${caller.id}::uuid, 'fixed-key-01', 'other',
            'Second', 'A second ticket under the same key', 'VS-AAAA-BBBB',
            'received', now(), now()
          )
        `,
      ),
    ).toBe(true);
  });

  it('refuses a reference that is not in the published shape', async () => {
    const caller = await consumer('support-db-reference@velora.test');
    expect(
      await refused(
        () => database.sql`
          insert into support_tickets (
            id, owner_id, client_ticket_id, category, subject, description,
            reference, status, created_at, updated_at
          ) values (
            ${crypto.randomUUID()}, ${caller.id}::uuid, 'shape-key-01', 'other',
            'Bad reference', 'A ticket carrying a reference nobody could type',
            'VS-IIII-LLLL', 'received', now(), now()
          )
        `,
      ),
    ).toBe(true);
  });

  it('refuses an edit or a deletion of the support history', async () => {
    const caller = await consumer('support-db-history@velora.test');
    const opened = await openTicket(caller);
    const events = await rowsOf<{ id: string }>(
      database.sql`select id from support_ticket_events where ticket_id = ${opened.body.id}::uuid`,
    );
    const eventId = events[0]?.id ?? '';
    expect(eventId).not.toBe('');

    // This is what an operator relies on when somebody says "I was already told
    // it was fixed". A record that can be edited is not that record.
    expect(
      await refused(
        () =>
          database.sql`update support_ticket_events set note = 'rewritten' where id = ${eventId}::uuid`,
      ),
    ).toBe(true);
    expect(
      await refused(
        () =>
          database.sql`delete from support_ticket_events where id = ${eventId}::uuid`,
      ),
    ).toBe(true);
  });

  it('freezes what somebody wrote while leaving the status free', async () => {
    const caller = await consumer('support-db-frozen@velora.test');
    const opened = await openTicket(caller);

    expect(
      await refused(
        () =>
          database.sql`update support_tickets set description = 'rewritten' where id = ${opened.body.id}::uuid`,
      ),
    ).toBe(true);
    expect(
      await refused(
        () =>
          database.sql`update support_tickets set owner_id = ${crypto.randomUUID()}::uuid where id = ${opened.body.id}::uuid`,
      ),
    ).toBe(true);
    expect(
      await refused(
        () =>
          database.sql`delete from support_tickets where id = ${opened.body.id}::uuid`,
      ),
    ).toBe(true);

    // The one thing that may move, moves.
    await execute(
      database.sql`update support_tickets set status = 'in_review', updated_at = now() where id = ${opened.body.id}::uuid`,
    );
    const rows = await rowsOf<{ status: string }>(
      database.sql`select status from support_tickets where id = ${opened.body.id}::uuid`,
    );
    expect(rows[0]?.status).toBe('in_review');
  });

  it('refuses a note with no words and a lifecycle entry with no state', async () => {
    const caller = await consumer('support-db-shape@velora.test');
    const opened = await openTicket(caller);

    expect(
      await refused(
        () => database.sql`
          insert into support_ticket_events (id, ticket_id, kind, created_at)
          values (${crypto.randomUUID()}, ${opened.body.id}::uuid, 'note', now())
        `,
      ),
    ).toBe(true);
    expect(
      await refused(
        () => database.sql`
          insert into support_ticket_events (id, ticket_id, kind, created_at)
          values (${crypto.randomUUID()}, ${opened.body.id}::uuid, 'status_changed', now())
        `,
      ),
    ).toBe(true);
  });

  it('holds no column that would make a ticket a channel or a decision', async () => {
    const columns = await rowsOf<{ column_name: string }>(
      database.sql`
        select column_name from information_schema.columns
        where table_name = 'support_tickets'
      `,
    );
    const names = columns.map((column) => column.column_name);
    // A ticket is a row somebody reads in Platform Admin, not a message sent
    // anywhere, and it is not an enforcement wearing another name.
    for (const forbidden of [
      'email',
      'address',
      'phone',
      'device_token',
      'attachment_url',
      'enforcement_id',
      'account_status',
    ]) {
      expect(names, forbidden).not.toContain(forbidden);
    }
  });
});
