import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { PayoutDisbursementIntake } from '../../src/billing/disbursement-intake.js';
import {
  entitlementGrantedEvent,
  entitlementRevokedEvent,
} from '../../src/billing/entitlement-events.js';
import {
  LocalTestPaymentProvider,
  localTestSignatureHeader,
} from '../../src/billing/local-test-provider.js';
import {
  revenueReversedEvent,
  revenueSettledEvent,
} from '../../src/billing/revenue-events.js';
import { billingOutbox } from '../../src/billing/schema.js';
import { ClubRepository } from '../../src/clubs/club-repository.js';
import { billingEntitlementIntakes } from '../../src/clubs/entitlement-intake.js';
import { OutboxRelay } from '../../src/events/relay.js';
import { OutboxRepository } from '../../src/events/outbox.js';
import { createPayoutsRuntime } from '../../src/payouts/composition.js';
import { disbursementSettledEvent } from '../../src/payouts/disbursement-events.js';
import type { LocalTestPayoutProvider } from '../../src/payouts/local-test-provider.js';
import { billingRevenueIntakes } from '../../src/payouts/revenue-intake.js';
import { payoutsOutbox } from '../../src/payouts/schema.js';
import { createUsersRuntime } from '../../src/users/composition.js';
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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * Creator payouts: the architecture, and the reasons it cannot run.
 *
 * Four properties matter here, and three of them are about money not moving
 * twice.
 *
 * **No payout exceeds what the book says a creator is owed.** The bound is
 * summed from journal entries under a lock on the recipient row, and PostgreSQL
 * refuses a posting that would overdraw a creator's position whatever the
 * service believes — so the guarantee survives a caller that never went near
 * the service.
 *
 * **The reservation is durable before the provider is called.** A crash between
 * the two leaves an instruction reconciliation can resolve, not money sent that
 * Velora has no record of.
 *
 * **Nothing marks money as sent except a provider.** There is no path — for a
 * creator, an operator, or a job — that reaches `paid` without a provider
 * reference.
 *
 * **Velora stores no bank detail and no identity document.** Asserted against
 * the column list rather than against a validator, because the guarantee is
 * that the field does not exist.
 */

const databaseUrl = await provisionDatabase('velora_payouts');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};
const logger = silentLogger();
const config = testServerConfig({
  BILLING_COMMERCE_POLICY: 'local-test',
  BILLING_PAYMENT_PROVIDER: 'local-test',
  PAYOUTS_POLICY: 'local-test',
  PAYOUTS_PROVIDER: 'local-test',
});

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'payouts-test',
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
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
const paymentProvider = product.billing.provider as LocalTestPaymentProvider;
const payoutProvider = product.payouts.provider as LocalTestPayoutProvider;
const handle = (request: Request) => application.app.handle(request);

/** Both directions of the money seam, exactly as the worker wires them. */
const relay = new OutboxRelay({
  consumers: [
    ...billingEntitlementIntakes({
      clubs: new ClubRepository(database.drizzle),
      database: database.drizzle,
      grantedEvent: entitlementGrantedEvent,
      logger,
      now: () => new Date(),
      revokedEvent: entitlementRevokedEvent,
    }),
    ...billingRevenueIntakes({
      database: database.drizzle,
      journal: product.payouts.journal,
      logger,
      now: () => new Date(),
      reversedEvent: revenueReversedEvent,
      settledEvent: revenueSettledEvent,
    }),
    new PayoutDisbursementIntake(disbursementSettledEvent, {
      database: database.drizzle,
      journal: product.billing.journal,
      logger,
      now: () => new Date(),
    }),
  ],
  logger,
  now: () => new Date(),
  owner: 'payouts-test-relay',
  sources: [
    {
      producer: 'billing',
      repository: new OutboxRepository(database.drizzle, billingOutbox),
    },
    {
      producer: 'payouts',
      repository: new OutboxRepository(database.drizzle, payoutsOutbox),
    },
  ],
});

async function drain(): Promise<void> {
  await product.billing.webhooks.processOnce();
  await relay.dispatchOnce();
  await relay.dispatchOnce();
}

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
  paymentProvider.behaveAs('normal');
  paymentProvider.refundBehaveAs('normal');
  payoutProvider.behaveAs('normal');
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
  readonly creatorId: string;
  readonly offerId: string;
  readonly studio: Session;
}

async function seller(input: {
  readonly slug: string;
  readonly subject: string;
}): Promise<Seller> {
  await consumerSession(input.subject);
  const studio = await session(input.subject, 'creator_studio');
  const post = async (path: string, body: unknown) =>
    handle(signed(path, studio, testCreatorOrigin, { body, method: 'POST' }));
  const account = (await (
    await handle(
      signed('/v1/creator', studio, testCreatorOrigin, { method: 'POST' }),
    )
  ).json()) as { id: string };
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
  await post('/v1/creator/offers/prices', {
    amountMinor: '1500',
    currency: 'USD',
    interval: 'month',
    offerId: offer.offer.id,
  });
  await post('/v1/creator/offers/lifecycle', {
    offerId: offer.offer.id,
    state: 'active',
    version: offer.offer.version,
  });
  return { creatorId: account.id, offerId: offer.offer.id, studio };
}

async function settledPurchase(input: {
  readonly buyer: string;
  readonly key: string;
  readonly offerId: string;
}): Promise<void> {
  const consumer = await consumerSession(input.buyer);
  const response = await handle(
    signed('/v1/billing/checkouts', consumer, testConsumerOrigin, {
      body: { currency: 'USD', offerId: input.offerId },
      idempotencyKey: input.key,
      method: 'POST',
    }),
  );
  const body = (await response.json()) as { payment: { id: string } };
  const [row] = await rowsOf<{ provider_reference: string }>(
    database.sql`select provider_reference from billing_payments where id = ${body.payment.id}`,
  );
  const raw = JSON.stringify({
    eventId: crypto.randomUUID(),
    eventType: 'payment.succeeded',
    providerPaymentReference: row?.provider_reference ?? '',
    status: 'succeeded',
  });
  await handle(
    new Request('http://api.test/v1/billing/provider-events', {
      body: raw,
      headers: {
        'content-type': 'application/json',
        [localTestSignatureHeader]: LocalTestPaymentProvider.signatureFor(raw),
      },
      method: 'POST',
    }),
  );
  await drain();
}

interface Readiness {
  readonly balances: {
    readonly available: string;
    readonly currency: string;
    readonly held: string;
    readonly releasable: string;
    readonly reserved: string;
  }[];
  readonly enabled: boolean;
  readonly policySource: string;
  readonly providerSource: string;
  readonly recipientStatus: string;
}

async function readiness(studio: Session): Promise<Readiness> {
  const response = await handle(
    signed('/v1/creator/payouts/readiness', studio, testCreatorOrigin),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Readiness;
}

/** A creator whose provider record exists and who the provider will pay. */
async function onboarded(sold: Seller): Promise<void> {
  payoutProvider.markRecipient(
    payoutProvider.referenceFor(sold.creatorId),
    'ready',
  );
  const response = await handle(
    signed('/v1/creator/payouts/onboarding', sold.studio, testCreatorOrigin, {
      method: 'POST',
    }),
  );
  expect(response.status).toBe(201);
}

async function requestPayout(
  studio: Session,
  body: Readonly<Record<string, unknown>>,
  key: string,
): Promise<Response> {
  return handle(
    signed('/v1/creator/payouts', studio, testCreatorOrigin, {
      body,
      idempotencyKey: key,
      method: 'POST',
    }),
  );
}

async function count(table: string): Promise<string> {
  const rows = await rowsOf<{ count: string }>(
    database.sql.unsafe(`select count(*)::text as count from ${table}`),
  );
  return rows[0]?.count ?? '0';
}

describe('what Velora stores about a payout recipient', () => {
  it('has no column for a bank detail or an identity document', async () => {
    const columns = await rowsOf<{ column_name: string }>(
      database.sql`select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'payouts_recipients'
        order by column_name`,
    );
    // The guarantee is the absence of the field, not a validator that rejects
    // one. Onboarding happens on the provider's own hosted flow, and what
    // Velora keeps is a reference plus a normalized capability answer.
    expect(columns.map((column) => column.column_name)).toEqual([
      'capability_checked_at',
      'created_at',
      'creator_id',
      'provider',
      'provider_reference',
      'status',
      'updated_at',
      'version',
    ]);
  });

  it('returns a provider-hosted link and records what the provider said', async () => {
    const sold = await seller({
      slug: 'onboarding',
      subject: 'onboard@velora.test',
    });
    payoutProvider.markRecipient(
      payoutProvider.referenceFor(sold.creatorId),
      'ready',
    );
    const response = await handle(
      signed('/v1/creator/payouts/onboarding', sold.studio, testCreatorOrigin, {
        method: 'POST',
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      onboardingUrl: string;
      recipientStatus: string;
    };
    // A link into somebody else's flow, and nothing collected here.
    expect(body.onboardingUrl).toStartWith('https://');
    expect(body.recipientStatus).toBe('ready');

    const [row] = await rowsOf<{ provider_reference: string; status: string }>(
      database.sql`select provider_reference, status from payouts_recipients`,
    );
    expect(row?.status).toBe('ready');
    expect(row?.provider_reference).toStartWith('lp_');
  });
});

describe('what a creator may ask for', () => {
  it('accrues the creator share into its own book when a sale settles', async () => {
    const sold = await seller({
      slug: 'accrual',
      subject: 'accrual@velora.test',
    });
    await settledPurchase({
      buyer: 'accrualbuyer@velora.test',
      key: 'payout-key-accrual',
      offerId: sold.offerId,
    });

    // The payout book learned from BILLING's published fact and not by reading
    // a `billing_` row: a fifth of the charge is the platform's under the test
    // policy, so 1200 of 1500 is the creator's.
    const state = await readiness(sold.studio);
    expect(state.balances).toEqual([
      {
        available: '1200',
        currency: 'USD',
        held: '0',
        releasable: '1200',
        reserved: '0',
      },
    ]);
    expect(state.enabled).toBe(true);
  });

  it('refuses a creator the provider has not said it can pay', async () => {
    const sold = await seller({
      slug: 'notready',
      subject: 'notready@velora.test',
    });
    await settledPurchase({
      buyer: 'notreadybuyer@velora.test',
      key: 'payout-key-notready',
      offerId: sold.offerId,
    });
    const response = await requestPayout(
      sold.studio,
      { amountMinor: '1200', currency: 'USD' },
      'payout-key-notready-1',
    );
    // Provider readiness never overrides Velora's own gates, but its absence is
    // decisive on its own.
    expect(response.status).toBe(409);
    expect(await count('payouts_instructions')).toBe('0');
  });

  it('reserves, sends, and settles a payout the book can cover', async () => {
    const sold = await seller({
      slug: 'paying',
      subject: 'paying@velora.test',
    });
    await settledPurchase({
      buyer: 'payingbuyer@velora.test',
      key: 'payout-key-pay',
      offerId: sold.offerId,
    });
    await onboarded(sold);

    const response = await requestPayout(
      sold.studio,
      { amountMinor: '1200', currency: 'USD' },
      'payout-key-pay-1',
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { payout: { state: string } };
    expect(body.payout.state).toBe('paid');

    // The reservation and the disbursement are both in the book, and the
    // creator is owed nothing further.
    const postings = await rowsOf<{ reason: string }>(
      database.sql`select reason from payouts_journal_transactions order by reason`,
    );
    expect(postings).toEqual([
      { reason: 'payout_paid' },
      { reason: 'payout_reserved' },
      { reason: 'revenue_accrued' },
    ]);
    const after = await readiness(sold.studio);
    expect(after.balances[0]).toMatchObject({ available: '0', reserved: '0' });

    // And BILLING learned that it no longer owes the money, through the fact
    // PAYOUTS published rather than by anybody writing its rows.
    await drain();
    const [billingPosting] = await rowsOf<{ reason: string }>(
      database.sql`select reason from billing_journal_transactions where reason = 'payout_settled'`,
    );
    expect(billingPosting?.reason).toBe('payout_settled');
  });

  it('refuses more than the book holds', async () => {
    const sold = await seller({
      slug: 'toomuch',
      subject: 'toomuch@velora.test',
    });
    await settledPurchase({
      buyer: 'toomuchbuyer@velora.test',
      key: 'payout-key-toomuch',
      offerId: sold.offerId,
    });
    await onboarded(sold);

    const response = await requestPayout(
      sold.studio,
      { amountMinor: '1201', currency: 'USD' },
      'payout-key-toomuch-1',
    );
    expect(response.status).toBe(409);
    expect(await count('payouts_instructions')).toBe('0');
  });

  it('spends one balance once under fifty simultaneous requests', async () => {
    const sold = await seller({
      slug: 'storming',
      subject: 'storm@velora.test',
    });
    await settledPurchase({
      buyer: 'stormbuyer@velora.test',
      key: 'payout-key-storm',
      offerId: sold.offerId,
    });
    await onboarded(sold);

    // Fifty distinct keys, so nothing is deduplicated by idempotency. What
    // stops the second one is the reservation itself, taken under a lock on the
    // recipient: without it every caller would read a balance of 1200 and every
    // caller would decide there was room for all of it.
    const responses = await Promise.all(
      Array.from({ length: 50 }, async (_unused, index) =>
        requestPayout(
          sold.studio,
          { amountMinor: '1200', currency: 'USD' },
          `payout-key-storm-${String(index).padStart(4, '0')}`,
        ),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(49);
    expect(await count('payouts_instructions')).toBe('1');

    const [imbalance] = await rowsOf<{ total: string }>(
      database.sql`select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0)::text as total
        from payouts_journal_entries`,
    );
    expect(imbalance?.total).toBe('0');
  });

  it('answers a duplicate request with the instruction it already made', async () => {
    const sold = await seller({
      slug: 'duplicating',
      subject: 'dup@velora.test',
    });
    await settledPurchase({
      buyer: 'dupbuyer@velora.test',
      key: 'payout-key-dup',
      offerId: sold.offerId,
    });
    await onboarded(sold);

    const responses = await Promise.all(
      Array.from({ length: 10 }, async () =>
        requestPayout(
          sold.studio,
          { amountMinor: '600', currency: 'USD' },
          'payout-key-dup-same',
        ),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(await count('payouts_instructions')).toBe('1');
  });
});

describe('when the provider does not answer', () => {
  it('leaves the instruction submitted with its reservation intact', async () => {
    const sold = await seller({
      slug: 'ambiguous',
      subject: 'ambiguous@velora.test',
    });
    await settledPurchase({
      buyer: 'ambiguousbuyer@velora.test',
      key: 'payout-key-ambiguous',
      offerId: sold.offerId,
    });
    await onboarded(sold);
    payoutProvider.behaveAs('ambiguous');

    const response = await requestPayout(
      sold.studio,
      { amountMinor: '1200', currency: 'USD' },
      'payout-key-ambiguous-1',
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { payout: { state: string } };
    // Neither paid nor failed. The provider may have sent the money and the
    // answer was lost, and guessing either way is how a platform pays twice.
    expect(body.payout.state).toBe('submitted');

    // Nothing is disbursed, because nothing is known.
    expect(
      await rowsOf(
        database.sql`select 1 from payouts_journal_transactions where reason = 'payout_paid'`,
      ),
    ).toHaveLength(0);
    // The reservation stays, so nothing else can spend it while the question is
    // open.
    const state = await readiness(sold.studio);
    expect(state.balances[0]).toMatchObject({
      available: '0',
      reserved: '1200',
    });
    payoutProvider.behaveAs('normal');
    expect(
      (
        await requestPayout(
          sold.studio,
          { amountMinor: '1', currency: 'USD' },
          'payout-key-ambiguous-2',
        )
      ).status,
    ).toBe(409);
  });

  it('releases the reservation when the provider refuses', async () => {
    const sold = await seller({
      slug: 'declining',
      subject: 'decline@velora.test',
    });
    await settledPurchase({
      buyer: 'declinebuyer@velora.test',
      key: 'payout-key-decline',
      offerId: sold.offerId,
    });
    await onboarded(sold);
    payoutProvider.behaveAs('declined');

    const response = await requestPayout(
      sold.studio,
      { amountMinor: '1200', currency: 'USD' },
      'payout-key-decline-1',
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      payout: { failureReason?: string; state: string };
    };
    expect(body.payout.state).toBe('failed');
    expect(body.payout.failureReason).toBe('declined');

    // The money never left, so the creator is owed it again — through a
    // compensating transaction rather than by rewriting the reservation.
    const state = await readiness(sold.studio);
    expect(state.balances[0]).toMatchObject({
      available: '1200',
      reserved: '0',
    });
    const postings = await rowsOf<{ reason: string }>(
      database.sql`select reason from payouts_journal_transactions order by reason`,
    );
    expect(postings).toEqual([
      { reason: 'payout_reserved' },
      { reason: 'reservation_released' },
      { reason: 'revenue_accrued' },
    ]);
  });
});

describe('a reversal at BILLING reaches the payout book', () => {
  it('lowers what a creator may claim when a sale is refunded', async () => {
    const sold = await seller({
      slug: 'reversing',
      subject: 'reverse@velora.test',
    });
    await settledPurchase({
      buyer: 'reversebuyer@velora.test',
      key: 'payout-key-reverse',
      offerId: sold.offerId,
    });
    const [payment] = await rowsOf<{ id: string }>(
      database.sql`select id from billing_payments`,
    );

    // An operator reversal at BILLING, applied through the same seam the
    // accrual came through.
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
    await handle(
      new Request('http://api.test/v1/admin/billing/refunds', {
        body: JSON.stringify({
          amountMinor: '500',
          currency: 'USD',
          paymentId: payment?.id ?? '',
          reasonCode: 'not_delivered',
        }),
        headers: {
          'content-type': 'application/json',
          cookie: `__Host-velora_platform_admin_session=${token}`,
          origin: 'http://127.0.0.1:3002',
          'x-velora-csrf': csrf,
          'x-velora-idempotency-key': 'payout-key-reverse-1',
        },
        method: 'POST',
      }),
    );
    await drain();

    // A third of the charge went back, so a third of the creator's share went
    // with it: 1200 becomes 800.
    const state = await readiness(sold.studio);
    expect(state.balances[0]).toMatchObject({
      available: '800',
      releasable: '800',
    });
  });
});

describe('the database enforces the payout invariants', () => {
  it('refuses a posting that would overdraw a creator, written directly', async () => {
    const sold = await seller({
      slug: 'overdrawn',
      subject: 'overdraw@velora.test',
    });
    await settledPurchase({
      buyer: 'overdrawbuyer@velora.test',
      key: 'payout-key-overdraw',
      offerId: sold.offerId,
    });

    // A hand-written posting that pays out more than the creator ever earned.
    // Nothing about the service is involved: the bound is the database's.
    const transactionId = crypto.randomUUID();
    const [account] = await rowsOf<{ id: string }>(
      database.sql`select id from payouts_journal_accounts
        where category = 'creator_available' and subject_id = ${sold.creatorId}`,
    );
    const [platform] = await rowsOf<{ id: string }>(
      database.sql`select id from payouts_journal_accounts where category = 'revenue_intake'`,
    );
    expect(
      await refused(async () =>
        execute(database.sql`
          with posted as (
            insert into payouts_journal_transactions
              (business_reference, business_type, created_at, currency, id, occurred_at, reason)
            values ('direct-overdraw', 'payouts.correction', now(), 'USD', ${transactionId}, now(), 'payout_paid')
            returning id
          )
          insert into payouts_journal_entries
            (account_id, amount_minor, created_at, currency, direction, id, transaction_id)
          values
            (${account?.id ?? ''}, 9999, now(), 'USD', 'debit', ${crypto.randomUUID()}, ${transactionId}),
            (${platform?.id ?? ''}, 9999, now(), 'USD', 'credit', ${crypto.randomUUID()}, ${transactionId})
        `),
      ),
    ).toBe(true);
  });

  it('freezes what an instruction means and retains every row', async () => {
    const sold = await seller({
      slug: 'frozen',
      subject: 'frozenpayout@velora.test',
    });
    await settledPurchase({
      buyer: 'frozenbuyer@velora.test',
      key: 'payout-key-frozen',
      offerId: sold.offerId,
    });
    await onboarded(sold);
    await requestPayout(
      sold.studio,
      { amountMinor: '600', currency: 'USD' },
      'payout-key-frozen-1',
    );

    for (const statement of [
      database.sql`update payouts_instructions set amount_minor = 1200`,
      database.sql`update payouts_instructions set currency = 'EUR'`,
      database.sql`update payouts_instructions set creator_id = ${crypto.randomUUID()}`,
      database.sql`update payouts_instructions set requested_by = 'creator:somebody-else'`,
      database.sql`update payouts_instructions set provider_reference = 'lp_elsewhere'`,
      database.sql`delete from payouts_instructions`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }
  });

  it('refuses a paid instruction that names no provider object', async () => {
    const sold = await seller({
      slug: 'fabricated',
      subject: 'fake@velora.test',
    });
    await settledPurchase({
      buyer: 'fakebuyer@velora.test',
      key: 'payout-key-fake',
      offerId: sold.offerId,
    });
    // The constraint that makes a fabricated payout unwritable: an operator, a
    // job, or a careless service cannot mark money as sent without naming the
    // provider object that sent it.
    expect(
      await refused(async () =>
        execute(database.sql`
          insert into payouts_instructions
            (amount_minor, created_at, creator_id, currency, id, idempotency_key,
             provider, provider_idempotency_key, requested_by, state, updated_at, version)
          values (100, now(), ${sold.creatorId}, 'USD', ${crypto.randomUUID()},
                  'direct-key-0001', 'local-test', 'direct-key-0001-p',
                  'session:direct', 'paid', now(), 1)
        `),
      ),
    ).toBe(true);
  });
});

describe('a deployed environment cannot pay anybody', () => {
  it('refuses on the provider axis and the policy axis independently', () => {
    // The configuration a deployed environment is forced to carry. Staging and
    // production reject any other value for either.
    const deployed = createPayoutsRuntime({
      config: testServerConfig(),
      creatorContext: product.creators.creatorContext,
      database: database.drizzle,
    });
    expect(deployed.provider.provider).toBe('unavailable');
    expect(deployed.policy.source).toBe('unpublished');
    // Nothing is ever releasable, so a payout refuses even before the adapter
    // is asked — and the adapter refuses even if the policy were published.
    expect(
      deployed.policy.releasable({
        available: { amountMinor: 100_000n, currency: 'USD' },
        held: { amountMinor: 0n, currency: 'USD' },
        reserved: { amountMinor: 0n, currency: 'USD' },
      }),
    ).toBeUndefined();
  });
});
