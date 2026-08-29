import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  entitlementGrantedEvent,
  entitlementRevokedEvent,
} from '../../src/billing/entitlement-events.js';
import {
  LocalTestPaymentProvider,
  localTestSignatureHeader,
} from '../../src/billing/local-test-provider.js';
import { ClubRepository } from '../../src/clubs/club-repository.js';
import { billingEntitlementIntakes } from '../../src/clubs/entitlement-intake.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { OutboxRelay } from '../../src/events/relay.js';
import { OutboxRepository } from '../../src/events/outbox.js';
import { billingOutbox } from '../../src/billing/schema.js';
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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';

/**
 * The operator reads an operations team works from, against real PostgreSQL.
 *
 * Three properties matter, and each is asserted rather than described.
 *
 * **Nobody reaches any of them without being an operator.** A consumer session,
 * a Creator Studio session, and a Platform Admin session whose assurance is not
 * phishing-resistant are each refused on every route — and because no such
 * verifier is approved in a deployed environment, that is the same as saying
 * none of this is reachable there at all.
 *
 * **Nothing published names a person.** A payment carries no payer, a payout no
 * recipient, a membership no member, and a security event no account. Each is
 * asserted as an exact key set rather than by spot-checking a field, because a
 * field added later is exactly the way one of these becomes a browsing surface
 * over private material without anybody deciding to do that.
 *
 * **Every figure is the platform's own, over the whole table.** The overview is
 * counted from the database rather than from a page, so a count that disagreed
 * with the record it summarises would fail here rather than mislead an operator
 * at three in the morning.
 */

const databaseUrl = await provisionDatabase('velora_admin_operations');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};
const logger = silentLogger();
const config = testServerConfig({
  BILLING_COMMERCE_ELIGIBILITY: 'local-test',
  BILLING_COMMERCE_POLICY: 'local-test',
  BILLING_PAYMENT_PROVIDER: 'local-test',
  BILLING_TAX_AUTHORITY: 'local-test',
});

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'admin-operations-test',
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
const product = testProductRuntimes({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  users,
});
const application = createApplication({
  config,
  dependencies: {
    auth,
    ...product,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    ephemeralRedis: healthy,
    logger,
    queueRedis: healthy,
    users,
  },
});
const provider = product.billing.provider as LocalTestPaymentProvider;
const handle = (request: Request) => application.app.handle(request);

const relay = new OutboxRelay({
  consumers: billingEntitlementIntakes({
    clubs: new ClubRepository(database.drizzle),
    database: database.drizzle,
    grantedEvent: entitlementGrantedEvent,
    logger,
    now: () => new Date(),
    revokedEvent: entitlementRevokedEvent,
  }),
  logger,
  now: () => new Date(),
  owner: 'admin-operations-relay',
  sources: [
    {
      producer: 'billing',
      repository: new OutboxRepository(database.drizzle, billingOutbox),
    },
  ],
});

async function drain(): Promise<void> {
  await product.billing.webhooks.processOnce();
  await relay.dispatchOnce();
}

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
  provider.behaveAs('normal');
  provider.refundBehaveAs('normal');
});

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

async function session(
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<Session> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience, subject }),
      headers: {
        'content-type': 'application/json',
        origin:
          audience === 'consumer_web' ? testConsumerOrigin : testCreatorOrigin,
        'x-velora-device': `${subject}-${audience}`,
      },
      method: 'POST',
    }),
  );
  const body = (await response.json()) as { csrfToken: string };
  return {
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0] ?? '')
      .filter((pair) => pair.length > 0)
      .join('; '),
    csrf: body.csrfToken,
  };
}

async function adminSession(): Promise<Session> {
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
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', 'phishing_resistant', ${now},
      ${now}, ${now}, ${digest(csrf)}, ${new Date(now.getTime() + 900_000)}, ${now},
      ${new Date(now.getTime() + 28_800_000)}, ${digest(token)}
    )
  `);
  return { cookie: `__Host-velora_platform_admin_session=${token}`, csrf };
}

function signed(
  path: string,
  actor: Session,
  origin: string,
  init: {
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly method?: string;
  } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: actor.cookie,
      origin,
      'x-velora-csrf': actor.csrf,
      ...(init.idempotencyKey === undefined
        ? {}
        : { 'x-velora-idempotency-key': init.idempotencyKey }),
    },
  });
}

const acknowledgements = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

async function consumerSession(subject: string): Promise<Session> {
  const actor = await session(subject, 'consumer_web');
  await handle(
    signed('/v1/users', actor, testConsumerOrigin, { method: 'POST' }),
  );
  await handle(
    signed(
      '/v1/users/me/onboarding/adult-declaration',
      actor,
      testConsumerOrigin,
      { body: { declaresAdult: true, region: 'ES' }, method: 'POST' },
    ),
  );
  return actor;
}

interface Seller {
  readonly offerId: string;
  readonly studio: Session;
}

/** A published creator with a priced, active offer in the given currencies. */
async function seller(input: {
  readonly amountMinor: string;
  readonly currencies: readonly string[];
  readonly slug: string;
  readonly subject: string;
}): Promise<Seller> {
  await consumerSession(input.subject);
  const studio = await session(input.subject, 'creator_studio');
  const post = async (path: string, body: unknown) =>
    handle(signed(path, studio, testCreatorOrigin, { body, method: 'POST' }));
  await handle(
    signed('/v1/creator', studio, testCreatorOrigin, { method: 'POST' }),
  );
  await post('/v1/creator/onboarding/acknowledgements', { acknowledgements });
  const profile = (await (
    await post('/v1/creator/profile', {
      displayName: 'Ember Vale',
      handle: input.slug,
    })
  ).json()) as { version: number };
  await post('/v1/creator/profile/publication', {
    publication: 'published',
    version: profile.version,
  });
  const created = (await (
    await post('/v1/creator/clubs', { name: 'Inner circle', slug: input.slug })
  ).json()) as { clubs: { id: string; version: number }[] };
  const clubRow = created.clubs[0];
  if (clubRow === undefined) throw new Error('club was not created');
  await post('/v1/creator/clubs/lifecycle', {
    clubId: clubRow.id,
    lifecycle: 'published',
    version: clubRow.version,
  });
  const offer = (await (
    await post('/v1/creator/offers', {
      mode: 'subscription',
      resourceId: clubRow.id,
      resourceType: 'club',
    })
  ).json()) as { offer: { id: string; version: number } };
  for (const currency of input.currencies) {
    await post('/v1/creator/offers/prices', {
      amountMinor: input.amountMinor,
      currency,
      interval: 'month',
      offerId: offer.offer.id,
    });
  }
  await post('/v1/creator/offers/lifecycle', {
    offerId: offer.offer.id,
    state: 'active',
    version: offer.offer.version,
  });
  return { offerId: offer.offer.id, studio };
}

async function providerEvent(
  event: Readonly<Record<string, unknown>>,
): Promise<Response> {
  const raw = JSON.stringify(event);
  return handle(
    new Request('http://api.test/v1/billing/provider-events', {
      body: raw,
      headers: {
        'content-type': 'application/json',
        [localTestSignatureHeader]: LocalTestPaymentProvider.signatureFor(raw),
      },
      method: 'POST',
    }),
  );
}

/** A consumer who has bought and paid, verified end to end. */
async function settledPurchase(input: {
  readonly buyer: string;
  readonly currency: string;
  readonly key: string;
  readonly offerId: string;
}): Promise<string> {
  const consumer = await consumerSession(input.buyer);
  const response = await handle(
    signed('/v1/billing/checkouts', consumer, testConsumerOrigin, {
      body: { currency: input.currency, offerId: input.offerId },
      idempotencyKey: input.key,
      method: 'POST',
    }),
  );
  const body = (await response.json()) as { payment: { id: string } };
  const [row] = await rowsOf<{ provider_reference: string }>(
    database.sql`select provider_reference from billing_payments where id = ${body.payment.id}`,
  );
  await providerEvent({
    eventId: crypto.randomUUID(),
    eventType: 'payment.succeeded',
    providerPaymentReference: row?.provider_reference ?? '',
    status: 'succeeded',
  });
  await drain();
  return body.payment.id;
}

/** A Platform Admin session whose assurance the operator routes will refuse. */
async function weakAdminSession(): Promise<Session> {
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
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', 'single_factor', ${now},
      ${now}, ${now}, ${digest(csrf)}, ${new Date(now.getTime() + 900_000)}, ${now},
      ${new Date(now.getTime() + 28_800_000)}, ${digest(token)}
    )
  `);
  return { cookie: `__Host-velora_platform_admin_session=${token}`, csrf };
}

async function operatorRead(
  path: string,
  admin: Session,
): Promise<{ readonly body: unknown; readonly status: number }> {
  const response = await handle(signed(path, admin, testAdminOrigin));
  return { body: await response.json(), status: response.status };
}

/** Opens one case by filing a report against a consumer account. */
async function openCase(reporter: Session, targetId: string): Promise<void> {
  const response = await handle(
    signed('/v1/safety/reports', reporter, testConsumerOrigin, {
      body: {
        clientReportId: crypto.randomUUID(),
        reasonCode: 'spam_or_scam',
        target: { accountId: targetId, type: 'consumer_account' },
      },
      method: 'POST',
    }),
  );
  // 200 rather than 201: a repeated client report identifier answers with the
  // report it already filed, so the route is not always a creation.
  expect(response.status).toBe(200);
}

async function accountIdOf(subject: string): Promise<string> {
  const [row] = await rowsOf<{ id: string }>(
    database.sql`select a.id from users_accounts a
      join auth_identities i on i.account_id = a.auth_account_id
      where i.provider_subject = ${subject}`,
  );
  if (row === undefined) throw new Error(`no consumer account for ${subject}`);
  return row.id;
}

/* ============================ Who may read =========================== */

describe('who may read the operator surface', () => {
  const everyRoute = [
    '/v1/admin/overview',
    '/v1/admin/accounts',
    '/v1/admin/billing/payments',
    '/v1/admin/payouts',
    '/v1/admin/clubs',
    '/v1/admin/audit',
  ] as const;

  it('refuses a consumer session on every operator read', async () => {
    const consumer = await consumerSession('operations-consumer');

    const statuses = await Promise.all(
      everyRoute.map(async (path) => {
        const response = await handle(
          signed(path, consumer, testConsumerOrigin),
        );
        return `${path} ${String(response.status)}`;
      }),
    );

    // 403 rather than 404: the caller is authenticated and the audience is
    // wrong, which is a refusal about them rather than about the address.
    expect(statuses).toEqual(everyRoute.map((path) => `${path} 403`));
  });

  it('refuses an operator whose assurance is not phishing-resistant', async () => {
    const weak = await weakAdminSession();

    const statuses = await Promise.all(
      everyRoute.map(async (path) => {
        const response = await handle(signed(path, weak, testAdminOrigin));
        return `${path} ${String(response.status)}`;
      }),
    );

    // Being an operator is not enough. ADR-0017 requires the assurance, and
    // this is the condition no deployed environment can satisfy today.
    expect(statuses).toEqual(everyRoute.map((path) => `${path} 403`));
  });

  it('refuses a request with no session at all', async () => {
    const response = await handle(
      new Request('http://api.test/v1/admin/overview', {
        headers: { origin: testAdminOrigin },
      }),
    );

    expect(response.status).toBe(401);
  });
});

/* ============================== Overview ============================= */

describe('what needs a person', () => {
  it('counts open work over the whole table rather than over a page', async () => {
    const admin = await adminSession();
    const reporter = await consumerSession('operations-reporter');
    const subject = await consumerSession('operations-subject');
    void subject;
    await openCase(reporter, await accountIdOf('operations-subject'));

    const { body, status } = await operatorRead('/v1/admin/overview', admin);
    const overview = body as {
      readonly attention: Record<string, number>;
      readonly casesByPriority: { count: number; state: string }[];
      readonly casesByQueue: { count: number; state: string }[];
      readonly oldestOpenCaseAt?: string;
    };

    expect(status).toBe(200);
    expect(overview.attention).toEqual({
      accountsRestricted: 0,
      appealsAwaiting: 0,
      casesOpen: 1,
      // Nobody has claimed it, which is the figure an operator opens the
      // console to see.
      casesUnclaimed: 1,
      creatorsSuspended: 0,
      disputesOpen: 0,
      financialRecordsNeedingPerson: 0,
      payoutsAwaitingConfirmation: 0,
    });
    expect(overview.casesByQueue).toEqual([
      { count: 1, state: 'consumer_conduct' },
    ]);
    expect(overview.casesByPriority).toEqual([
      { count: 1, state: 'untriaged' },
    ]);
    expect(overview.oldestOpenCaseAt).toBeDefined();
  });

  it('says nothing is open rather than reporting an age of zero', async () => {
    const admin = await adminSession();

    const { body } = await operatorRead('/v1/admin/overview', admin);
    const overview = body as {
      readonly attention: { readonly casesOpen: number };
      readonly oldestOpenCaseAt?: string;
    };

    expect(overview.attention.casesOpen).toBe(0);
    // Absent, not an instant. "Nothing is open" and "the oldest one opened at
    // the epoch" are different answers.
    expect(overview.oldestOpenCaseAt).toBeUndefined();
  });

  it('stops a case somebody has claimed being counted as unclaimed', async () => {
    const admin = await adminSession();
    const reporter = await consumerSession('operations-reporter');
    await consumerSession('operations-subject');
    await openCase(reporter, await accountIdOf('operations-subject'));
    const [caseRow] = await rowsOf<{ id: string }>(
      database.sql`select id from safety_cases limit 1`,
    );
    await handle(
      signed('/v1/admin/safety/cases/claim', admin, testAdminOrigin, {
        body: { caseId: caseRow?.id },
        method: 'POST',
      }),
    );

    const { body } = await operatorRead('/v1/admin/overview', admin);
    const overview = body as {
      readonly attention: {
        readonly casesOpen: number;
        readonly casesUnclaimed: number;
      };
    };

    expect(overview.attention).toMatchObject({
      casesOpen: 1,
      casesUnclaimed: 0,
    });
  });
});

/* ============================== Accounts ============================= */

describe('consumer accounts an operator may read', () => {
  it('answers with the enforcement work list rather than with everybody', async () => {
    const admin = await adminSession();
    await consumerSession('operations-a');
    await consumerSession('operations-b');

    const { body, status } = await operatorRead('/v1/admin/accounts', admin);
    const page = body as {
      readonly accounts: unknown[];
      readonly statusCounts: { count: number; state: string }[];
    };

    expect(status).toBe(200);
    // Two accounts exist and neither is under enforcement, so the list is
    // empty — and the counts beside it still say how many there are, which is
    // what stops an empty work list reading as an empty platform.
    expect(page.accounts).toEqual([]);
    // `pending_profile`: both have declared and neither has saved a profile,
    // which is the ordinary state of somebody part-way through joining and
    // deliberately not an enforcement concern.
    expect(page.statusCounts).toEqual([{ count: 2, state: 'pending_profile' }]);
  });

  it('publishes an account without publishing a person', async () => {
    const admin = await adminSession();
    await consumerSession('operations-a');

    const { body } = await operatorRead(
      '/v1/admin/accounts?status=pending_profile',
      admin,
    );
    const page = body as { readonly accounts: Record<string, unknown>[] };
    const account = page.accounts[0];

    expect(account).toBeDefined();
    // The exact key set, not a spot check. A field added later is how this
    // becomes a people browser without anybody deciding to make one.
    expect(Object.keys(account ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'region',
      'status',
      'statusChangedAt',
    ]);
  });

  it('refuses a status the platform does not publish', async () => {
    const admin = await adminSession();

    const { status } = await operatorRead(
      '/v1/admin/accounts?status=banned',
      admin,
    );

    // A filter that accepted anything is a filter somebody probes with
    // something else.
    expect(status).toBe(422);
  });

  it('refuses an account identifier that is not one', async () => {
    const admin = await adminSession();

    const { status } = await operatorRead(
      '/v1/admin/accounts?accountId=not-a-uuid',
      admin,
    );

    expect(status).toBe(422);
  });
});

/* ============================== Payments ============================= */

describe('the commercial record behind the totals', () => {
  it('publishes a payment without publishing who paid', async () => {
    const admin = await adminSession();
    const shop = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'operationsone',
      subject: 'operations-seller',
    });
    const paymentId = await settledPurchase({
      buyer: 'operations-buyer',
      currency: 'USD',
      key: crypto.randomUUID(),
      offerId: shop.offerId,
    });

    const { body, status } = await operatorRead(
      '/v1/admin/billing/payments',
      admin,
    );
    const page = body as { readonly payments: Record<string, unknown>[] };
    const payment = page.payments[0];

    expect(status).toBe(200);
    expect(payment?.id).toBe(paymentId);
    expect(Object.keys(payment ?? {}).sort()).toEqual([
      'amountMinor',
      'createdAt',
      'currency',
      'id',
      'lastProviderSyncAt',
      'provider',
      'providerReference',
      // What was sold, because a reversal decision differs between a club
      // membership and a gift.
      'resourceType',
      'state',
      'taxMinor',
      'updatedAt',
    ]);
  });

  it('carries a payment and everything recorded against it', async () => {
    const admin = await adminSession();
    const shop = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'operationstwo',
      subject: 'operations-seller',
    });
    const paymentId = await settledPurchase({
      buyer: 'operations-buyer',
      currency: 'USD',
      key: crypto.randomUUID(),
      offerId: shop.offerId,
    });
    await handle(
      signed('/v1/admin/billing/refunds', admin, testAdminOrigin, {
        body: {
          amountMinor: '500',
          currency: 'USD',
          paymentId,
          reasonCode: 'operator_correction',
        },
        idempotencyKey: crypto.randomUUID(),
        method: 'POST',
      }),
    );

    const { body, status } = await operatorRead(
      `/v1/admin/billing/payment?paymentId=${paymentId}`,
      admin,
    );
    const detail = body as {
      readonly disputes: unknown[];
      readonly payment: { readonly id: string };
      readonly refunds: { readonly amountMinor: string }[];
    };

    expect(status).toBe(200);
    expect(detail.payment.id).toBe(paymentId);
    // The reversal is on the same screen as the payment, because the question
    // in front of a payment is whether money has already gone back.
    expect(detail.refunds.map((refund) => refund.amountMinor)).toEqual(['500']);
    expect(detail.disputes).toEqual([]);
  });

  it('answers a payment that does not exist with not found', async () => {
    const admin = await adminSession();

    const { status } = await operatorRead(
      `/v1/admin/billing/payment?paymentId=${crypto.randomUUID()}`,
      admin,
    );

    expect(status).toBe(404);
  });

  it('refuses a payment state the platform does not publish', async () => {
    const admin = await adminSession();

    const { status } = await operatorRead(
      '/v1/admin/billing/payments?state=reticulating',
      admin,
    );

    expect(status).toBe(422);
  });
});

/* =============================== Payouts ============================= */

describe('payout instructions an operator may read', () => {
  it('answers with nothing while no payout provider is approved', async () => {
    const admin = await adminSession();

    const { body, status } = await operatorRead('/v1/admin/payouts', admin);

    expect(status).toBe(200);
    // Honest emptiness rather than a fabricated queue: no payout provider is
    // approved and no settlement terms are published, so no creator can have
    // asked for one.
    expect(body).toEqual({ payouts: [] });
  });

  it('refuses a payout state the platform does not publish', async () => {
    const admin = await adminSession();

    const { status } = await operatorRead(
      '/v1/admin/payouts?state=released',
      admin,
    );

    expect(status).toBe(422);
  });
});

/* ================================ Clubs ============================== */

describe('clubs and the memberships an operator may act on', () => {
  it('counts a club’s memberships without naming a member', async () => {
    const admin = await adminSession();
    const shop = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'operationsthree',
      subject: 'operations-seller',
    });
    await settledPurchase({
      buyer: 'operations-buyer',
      currency: 'USD',
      key: crypto.randomUUID(),
      offerId: shop.offerId,
    });

    const { body, status } = await operatorRead('/v1/admin/clubs', admin);
    const page = body as {
      readonly clubs: {
        readonly handle?: string;
        readonly id: string;
        readonly memberships: { count: number; state: string }[];
      }[];
    };
    const club = page.clubs[0];

    expect(status).toBe(200);
    expect(club?.handle).toBe('operationsthree');
    expect(club?.memberships).toEqual([{ count: 1, state: 'active' }]);
  });

  it('gives the one membership operation a target an operator can find', async () => {
    const admin = await adminSession();
    const shop = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'operationsfour',
      subject: 'operations-seller',
    });
    await settledPurchase({
      buyer: 'operations-buyer',
      currency: 'USD',
      key: crypto.randomUUID(),
      offerId: shop.offerId,
    });
    const list = (await operatorRead('/v1/admin/clubs', admin)).body as {
      readonly clubs: { readonly id: string }[];
    };
    const clubId = list.clubs[0]?.id;

    const { body } = await operatorRead(
      `/v1/admin/clubs?clubId=${String(clubId)}`,
      admin,
    );
    const page = body as {
      readonly memberships: Record<string, unknown>[];
    };
    const membership = page.memberships[0];

    // The identifier the revocation takes, and nothing that says who holds it.
    expect(Object.keys(membership ?? {}).sort()).toEqual([
      'grantedAt',
      'id',
      'source',
      'state',
    ]);
  });

  it('does not publish memberships unless one club was asked for', async () => {
    const admin = await adminSession();
    await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'operationsfive',
      subject: 'operations-seller',
    });

    const { body } = await operatorRead('/v1/admin/clubs', admin);

    expect((body as Record<string, unknown>).memberships).toBeUndefined();
  });
});

/* ================================ Audit ============================== */

describe('what has happened', () => {
  it('publishes AUTH’s own events without publishing whose they are', async () => {
    const admin = await adminSession();
    await consumerSession('operations-a');

    const { body, status } = await operatorRead('/v1/admin/audit', admin);
    const page = body as {
      readonly entries: Record<string, unknown>[];
      readonly stream: string;
    };
    const entry = page.entries[0];

    expect(status).toBe(200);
    expect(page.stream).toBe('security');
    expect(page.entries.length).toBeGreaterThan(0);
    // No account, no address, no device, and no token. There is no field in
    // the record for any of them to arrive in.
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'audience',
      'correlationId',
      'id',
      'occurredAt',
      'stream',
      'what',
    ]);
  });

  it('reads the settled decisions as their own record', async () => {
    const admin = await adminSession();

    const { body, status } = await operatorRead(
      '/v1/admin/audit?stream=decision',
      admin,
    );

    expect(status).toBe(200);
    expect(body).toEqual({ entries: [], stream: 'decision' });
  });

  it('refuses a record that does not exist', async () => {
    const admin = await adminSession();

    const { status } = await operatorRead(
      '/v1/admin/audit?stream=everything',
      admin,
    );

    expect(status).toBe(422);
  });

  it('pages the security record without repeating or skipping an entry', async () => {
    const admin = await adminSession();
    await consumerSession('operations-a');
    await consumerSession('operations-b');

    const first = (await operatorRead('/v1/admin/audit?pageSize=2', admin))
      .body as {
      readonly entries: { readonly id: string }[];
      readonly nextCursor?: string;
    };
    const second = (
      await operatorRead(
        `/v1/admin/audit?pageSize=2&cursor=${encodeURIComponent(
          first.nextCursor ?? '',
        )}`,
        admin,
      )
    ).body as { readonly entries: { readonly id: string }[] };

    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    const seen = new Set(first.entries.map((entry) => entry.id));
    for (const entry of second.entries) {
      expect(seen.has(entry.id)).toBe(false);
    }
  });
});
