import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createBillingRuntime } from '../../src/billing/composition.js';
import { PayoutDisbursementIntake } from '../../src/billing/disbursement-intake.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  entitlementGrantedEvent,
  entitlementRevokedEvent,
} from '../../src/billing/entitlement-events.js';
import type { LocalTestPaymentProvider } from '../../src/billing/local-test-provider.js';
import {
  revenueReversedEvent,
  revenueSettledEvent,
} from '../../src/billing/revenue-events.js';
import { billingOutbox } from '../../src/billing/schema.js';
import { ClubRepository } from '../../src/clubs/club-repository.js';
import { billingEntitlementIntakes } from '../../src/clubs/entitlement-intake.js';
import { OutboxRelay } from '../../src/events/relay.js';
import { OutboxRepository } from '../../src/events/outbox.js';
import { disbursementSettledEvent } from '../../src/payouts/disbursement-events.js';
import type { LocalTestPayoutProvider } from '../../src/payouts/local-test-provider.js';
import { billingRevenueIntakes } from '../../src/payouts/revenue-intake.js';
import { payoutsOutbox } from '../../src/payouts/schema.js';
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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * What the platform does when it does not know.
 *
 * Every ambiguous outcome leaves a durable row saying so, and this suite proves
 * those rows are a temporary state rather than a permanent one. A capture whose
 * answer was lost, a reversal in the same position, and a payout instruction
 * that was sent and never confirmed all end up resolved from what the provider
 * itself holds.
 *
 * The property that matters most is that resolving is a *read*. Every call the
 * sweep makes carries the idempotency key Velora already sent, so a provider
 * that acted returns what it created and one that did not acts once — and a
 * second sweep over an already-resolved row changes nothing at all.
 */

const databaseUrl = await provisionDatabase('velora_billing_reconciliation');
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
      request.headers.get('x-velora-device') ?? 'reconciliation-test',
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
    // What a creator is owed reaches the payout book through a published fact
    // rather than by reading a `billing_` row, so a payout is only possible
    // once this has run.
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
  owner: 'reconciliation-test-relay',
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

/** Makes every unsettled row old enough for the sweep to examine. */
async function age(): Promise<void> {
  await execute(
    database.sql`update billing_payments set updated_at = now() - interval '10 minutes'
      where state in ('created', 'provider_pending', 'requires_action', 'reconciliation_pending')`,
  );
  await execute(
    database.sql`update billing_refunds set updated_at = now() - interval '10 minutes'
      where state in ('requested', 'provider_pending', 'reconciliation_pending')`,
  );
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

async function sellable(subject: string, slug: string): Promise<string> {
  await consumerSession(subject);
  const studio = await session(subject, 'creator_studio');
  const post = async (path: string, body: unknown) =>
    handle(signed(path, studio, testCreatorOrigin, { body, method: 'POST' }));
  await handle(
    signed('/v1/creator', studio, testCreatorOrigin, { method: 'POST' }),
  );
  await post('/v1/creator/onboarding/acknowledgements', { acknowledgements });
  const profile = (await (
    await post('/v1/creator/profile', {
      displayName: 'Ember Vale',
      handle: slug,
    })
  ).json()) as { version: number };
  await post('/v1/creator/profile/publication', {
    publication: 'published',
    version: profile.version,
  });
  const created = (await (
    await post('/v1/creator/clubs', { name: 'Inner circle', slug })
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
  return offer.offer.id;
}

async function paymentStates(): Promise<readonly string[]> {
  const rows = await rowsOf<{ state: string }>(
    database.sql`select state from billing_payments order by created_at`,
  );
  return rows.map((row) => row.state);
}

describe('an ambiguous capture', () => {
  it('is resolved from the provider record, once, through the ordinary path', async () => {
    const offerId = await sellable('recon@velora.test', 'reconciling');
    const buyer = await consumerSession('reconbuyer@velora.test');
    // The worst real outcome: the provider acted and the answer was lost, so
    // Velora holds an operation with no provider reference at all.
    paymentProvider.behaveAs('ambiguous');
    await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'recon-key-ambiguous',
        method: 'POST',
      }),
    );
    expect(await paymentStates()).toEqual(['reconciliation_pending']);
    const [before] = await rowsOf<{ provider_reference: string | null }>(
      database.sql`select provider_reference from billing_payments`,
    );
    expect(before?.provider_reference).toBeNull();

    // The provider now answers. The sweep asks it what it holds under the key
    // Velora already sent rather than sending a second instruction.
    paymentProvider.behaveAs('normal');
    await age();
    const first = await product.billing.reconciliation.reconcileOnce();
    expect(first.paymentsExamined).toBe(1);

    const [after] = await rowsOf<{
      provider_reference: string | null;
      state: string;
    }>(database.sql`select provider_reference, state from billing_payments`);
    // The reference the platform never received, learned from the provider.
    expect(after?.provider_reference).not.toBeNull();
    // Still pending at the provider, so still pending here. Nothing is guessed.
    expect(after?.state).toBe('provider_pending');
    expect(
      await rowsOf(database.sql`select 1 from billing_journal_transactions`),
    ).toHaveLength(0);
  });

  it('settles once when the provider says it succeeded, however many sweeps run', async () => {
    const offerId = await sellable('settle@velora.test', 'settling');
    const buyer = await consumerSession('settlebuyer@velora.test');
    paymentProvider.behaveAs('ambiguous');
    await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'recon-key-settle',
        method: 'POST',
      }),
    );
    paymentProvider.behaveAs('normal');
    await age();
    await product.billing.reconciliation.reconcileOnce();

    // The provider now reports it settled. Nothing about a webhook is involved.
    const [row] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_payments`,
    );
    paymentProvider.markSucceeded(row?.provider_reference ?? '');
    await age();
    await product.billing.reconciliation.reconcileOnce();
    await product.billing.reconciliation.reconcileOnce();
    await relay.dispatchOnce();

    expect(await paymentStates()).toEqual(['succeeded']);
    // One posting and one membership, whatever the sweep did — the repair went
    // through exactly the code an ordinary verified event takes.
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'payment_captured'`,
      ),
    ).toHaveLength(1);
    const memberships = await rowsOf<{ state: string }>(
      database.sql`select state from clubs_memberships`,
    );
    expect(memberships).toEqual([{ state: 'active' }]);
  });
});

describe('an ambiguous reversal', () => {
  it('is settled from the provider record without a second instruction', async () => {
    const offerId = await sellable('reconref@velora.test', 'reconrefunds');
    const buyer = await consumerSession('reconrefbuyer@velora.test');
    await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'recon-key-refund',
        method: 'POST',
      }),
    );
    const [payment] = await rowsOf<{ id: string; provider_reference: string }>(
      database.sql`select id, provider_reference from billing_payments`,
    );
    paymentProvider.markSucceeded(payment?.provider_reference ?? '');
    await age();
    await product.billing.reconciliation.reconcileOnce();
    await relay.dispatchOnce();

    // A reversal whose answer was lost. The amount stays reserved against the
    // capture and nothing is accounted for.
    paymentProvider.refundBehaveAs('ambiguous');
    const operator = await adminSession();
    await handle(
      signed('/v1/admin/billing/refunds', operator, testAdminOrigin, {
        body: {
          amountMinor: '1500',
          currency: 'USD',
          paymentId: payment?.id ?? '',
          reasonCode: 'duplicate_charge',
        },
        idempotencyKey: 'recon-key-refund-1',
        method: 'POST',
      }),
    );
    const [pending] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_refunds`,
    );
    expect(pending?.state).toBe('reconciliation_pending');
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(0);

    // The sweep asks under the same key. The provider returns the reversal it
    // already made, so there is exactly one.
    paymentProvider.refundBehaveAs('normal');
    await age();
    await product.billing.reconciliation.reconcileOnce();
    await product.billing.reconciliation.reconcileOnce();

    const [settled] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_refunds`,
    );
    expect(settled?.state).toBe('succeeded');
    expect(
      await rowsOf(database.sql`select 1 from billing_refunds`),
    ).toHaveLength(1);
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(1);
    const [imbalance] = await rowsOf<{ total: string }>(
      database.sql`select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0)::text as total
        from billing_journal_entries`,
    );
    expect(imbalance?.total).toBe('0');
  });
});

/**
 * A payout instruction the platform sent and never heard back about.
 *
 * The reservation it holds keeps a creator's balance earmarked until somebody
 * finds out whether the money moved. The sweep asks the provider what it holds
 * under the key Velora already used, which returns the object that key created
 * rather than creating a second one — the property that makes this a read.
 */
describe('an unconfirmed payout instruction', () => {
  it('is settled from the provider record without sending a second instruction', async () => {
    const offerId = await sellable('payoutrecon@velora.test', 'payoutrecon');
    const studio = await session('payoutrecon@velora.test', 'creator_studio');
    const buyer = await consumerSession('payoutreconbuyer@velora.test');
    await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'payout-recon-purchase',
        method: 'POST',
      }),
    );
    const [payment] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_payments`,
    );
    paymentProvider.markSucceeded(payment?.provider_reference ?? '');
    await age();
    await product.billing.reconciliation.reconcileOnce();
    // The creator's share reaches the payout book through the published fact,
    // not by reading a `billing_` row.
    await relay.dispatchOnce();
    await relay.dispatchOnce();

    const [offer] = await rowsOf<{ creator_id: string }>(
      database.sql`select creator_id from billing_offers`,
    );
    payoutProvider.markRecipient(
      payoutProvider.referenceFor(offer?.creator_id ?? ''),
      'ready',
    );
    expect(
      (
        await handle(
          signed('/v1/creator/payouts/onboarding', studio, testCreatorOrigin, {
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(201);

    // The provider acts and the answer is lost.
    payoutProvider.behaveAs('ambiguous');
    const requested = await handle(
      signed('/v1/creator/payouts', studio, testCreatorOrigin, {
        body: { amountMinor: '1200', currency: 'USD' },
        idempotencyKey: 'payout-recon-1',
        method: 'POST',
      }),
    );
    expect(requested.status).toBe(201);
    const [submitted] = await rowsOf<{ state: string }>(
      database.sql`select state from payouts_instructions`,
    );
    // Neither paid nor failed, and the reservation stays while it is unknown.
    expect(submitted?.state).toBe('submitted');
    expect(
      await rowsOf(
        database.sql`select 1 from payouts_journal_transactions where reason = 'payout_paid'`,
      ),
    ).toHaveLength(0);

    // The sweep asks under the same key and gets back the payout that key
    // already made.
    payoutProvider.behaveAs('normal');
    const first = await product.payouts.reconciliation.reconcileOnce();
    expect(first.examined).toBe(1);
    expect(first.resolved).toBe(1);
    // And a second sweep changes nothing at all.
    await product.payouts.reconciliation.reconcileOnce();

    const [settled] = await rowsOf<{ state: string }>(
      database.sql`select state from payouts_instructions`,
    );
    expect(settled?.state).toBe('paid');
    // One instruction, one disbursement, however many sweeps ran.
    expect(
      await rowsOf(database.sql`select 1 from payouts_instructions`),
    ).toHaveLength(1);
    expect(
      await rowsOf(
        database.sql`select 1 from payouts_journal_transactions where reason = 'payout_paid'`,
      ),
    ).toHaveLength(1);
    const [imbalance] = await rowsOf<{ total: string }>(
      database.sql`select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0)::text as total
        from payouts_journal_entries`,
    );
    expect(imbalance?.total).toBe('0');
  });
});

/**
 * What a backlog does to a sweep.
 *
 * A cycle that walked the whole history rather than the unsettled part, or that
 * tried to resolve every stale row in one pass, would be a sweep that gets
 * slower exactly as the thing it exists to fix gets worse.
 */
describe('reconciliation under a backlog', () => {
  it('reads the backlog by its own index and bounds what one cycle takes', async () => {
    const offerId = await sellable('backlog@velora.test', 'backlogged');
    const buyer = await consumerSession('backlogbuyer@velora.test');
    paymentProvider.behaveAs('ambiguous');
    await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'backlog-seed-key',
        method: 'POST',
      }),
    );
    paymentProvider.behaveAs('normal');

    // One real operation, copied into a backlog. Everything a payment must
    // satisfy is already true of the row being copied, so this seeds volume
    // without inventing a shape the ordinary path could not produce.
    await execute(database.sql`
      insert into billing_payments (
        amount_minor, consumer_id, correlation_id, created_at, currency, id,
        idempotency_key, offer_id, price_id, provider, provider_idempotency_key,
        state, tax_authority, tax_minor, updated_at, version
      )
      select
        seed.amount_minor, seed.consumer_id, seed.correlation_id, seed.created_at,
        seed.currency, gen_random_uuid(),
        'backlog-' || lpad(n::text, 8, '0'),
        seed.offer_id, seed.price_id, seed.provider,
        'velora-backlog-' || lpad(n::text, 8, '0'),
        'reconciliation_pending', seed.tax_authority, seed.tax_minor,
        now() - interval '10 minutes', 1
      from billing_payments seed, generate_series(1, 120) as n
      where seed.idempotency_key = 'backlog-seed-key'
    `);
    await age();

    const [unsettled] = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_payments
         where state = 'reconciliation_pending'`,
    );
    expect(Number(unsettled?.count ?? '0')).toBe(121);

    // The backlog is found through the partial index over the unsettled states,
    // so the read is the size of what is unresolved rather than of the history.
    const plan = await rowsOf<{ 'QUERY PLAN': string }>(
      database.sql`explain (format text)
        select * from billing_payments
         where state in ('created', 'provider_pending', 'requires_action', 'reconciliation_pending')
           and updated_at < now()
         order by updated_at, id
         limit 50`,
    );
    const planText = plan.map((row) => row['QUERY PLAN']).join('\n');
    expect(planText).toContain('billing_payments_unsettled_idx');
    expect(planText).not.toContain('Seq Scan');

    // And one cycle takes a bounded bite rather than the whole backlog, so a
    // bad day cannot stall the loop that recovers from it.
    const report = await product.billing.reconciliation.reconcileOnce();
    expect(report.paymentsExamined).toBe(50);
  });
});

describe('a deployed environment reconciles nothing', () => {
  it('examines no rows at all when no provider is approved', async () => {
    const offerId = await sellable('reconblocked@velora.test', 'reconblocked');
    const buyer = await consumerSession('reconblockedbuyer@velora.test');
    paymentProvider.behaveAs('ambiguous');
    await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'recon-key-blocked',
        method: 'POST',
      }),
    );
    await age();

    // The configuration a deployed environment is forced to carry. The sweep
    // asks nobody, because there is nobody to ask; it does not treat silence as
    // failure and it does not move a row on a guess.
    const deployed = createBillingRuntime({
      config: testServerConfig(),
      consumerContext: users.consumerContext,
      consumers: users.adultStanding,
      creatorContext: product.creators.creatorContext,
      creators: product.creators.directory,
      database: database.drizzle,
      resources: product.clubs.commercialDirectory,
    });
    const report = await deployed.reconciliation.reconcileOnce();
    expect(report.paymentsExamined).toBe(0);
    expect(report.refundsExamined).toBe(0);
    expect(await paymentStates()).toEqual(['reconciliation_pending']);
  });
});
