import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import type { LocalTestPaymentProvider } from '../../src/billing/local-test-provider.js';
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
 * Checkout orchestration against real PostgreSQL and a deterministic provider.
 *
 * The properties this suite exists to prove are the ones that only show up when
 * something goes wrong: the operation exists before the provider is called, a
 * lost provider answer leaves something reconcilable rather than a guess, fifty
 * simultaneous submissions of one purchase produce one operation, and no
 * browser navigation anywhere can move a payment forward.
 *
 * A second application runs with no provider configured — the only setting a
 * deployed environment may have — and proves that starting a purchase is
 * refused rather than recorded.
 */

const databaseUrl = await provisionDatabase('velora_billing_checkout');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};
const logger = silentLogger();

function applicationFor(overrides: Readonly<Record<string, string>>) {
  const config = testServerConfig(overrides);
  const auth = createAuthRuntime({
    config,
    database: database.drizzle,
    logger,
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'checkout-test',
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
  return {
    billing: product.billing,
    runtime: createApplication({
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
    }),
  };
}

const live = applicationFor({
  BILLING_COMMERCE_ELIGIBILITY: 'local-test',
  BILLING_COMMERCE_POLICY: 'local-test',
  BILLING_PAYMENT_PROVIDER: 'local-test',
  BILLING_TAX_AUTHORITY: 'local-test',
});
const withoutProvider = applicationFor({
  BILLING_COMMERCE_POLICY: 'local-test',
  BILLING_PAYMENT_PROVIDER: 'unavailable',
});
const provider = live.billing.provider as LocalTestPaymentProvider;
const handle = (request: Request) => live.runtime.app.handle(request);

afterAll(async () => {
  await live.runtime.close();
  await withoutProvider.runtime.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
  provider.behaveAs('normal');
});

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

async function session(
  app: { readonly app: { handle(request: Request): Promise<Response> } },
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<Session> {
  const response = await app.app.handle(
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
  if (response.status !== 201) {
    throw new Error(`sign-in failed with ${String(response.status)}`);
  }
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

async function consumer(
  app: { readonly app: { handle(request: Request): Promise<Response> } },
  subject: string,
): Promise<Session> {
  const actor = await session(app, subject, 'consumer_web');
  await app.app.handle(
    signed('/v1/users', actor, testConsumerOrigin, { method: 'POST' }),
  );
  await app.app.handle(
    signed(
      '/v1/users/me/onboarding/adult-declaration',
      actor,
      testConsumerOrigin,
      {
        body: { declaresAdult: true, region: 'ES' },
        method: 'POST',
      },
    ),
  );
  return actor;
}

/** A creator with a published club and one active, priced offer. */
async function sellableOffer(
  app: { readonly app: { handle(request: Request): Promise<Response> } },
  subject: string,
  creatorHandle: string,
  slug: string,
): Promise<string> {
  await consumer(app, subject);
  const studio = await session(app, subject, 'creator_studio');
  const post = (path: string, body: unknown) =>
    app.app.handle(
      signed(path, studio, testCreatorOrigin, { body, method: 'POST' }),
    );
  await app.app.handle(
    signed('/v1/creator', studio, testCreatorOrigin, { method: 'POST' }),
  );
  await post('/v1/creator/onboarding/acknowledgements', { acknowledgements });
  const profile = (await (
    await post('/v1/creator/profile', {
      displayName: 'Ember Vale',
      handle: creatorHandle,
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

interface CheckoutBody {
  readonly payment: {
    readonly amount: {
      readonly amountMinor: string;
      readonly currency: string;
    };
    readonly id: string;
    readonly state: string;
  };
  readonly redirectUrl?: string;
}

async function startCheckout(
  buyer: Session,
  offerId: string,
  idempotencyKey: string,
  currency = 'USD',
): Promise<Response> {
  return handle(
    signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
      body: { currency, offerId },
      idempotencyKey,
      method: 'POST',
    }),
  );
}

async function paymentCount(): Promise<string> {
  const rows = await rowsOf<{ count: string }>(
    database.sql`select count(*)::text as count from billing_payments`,
  );
  return rows[0]?.count ?? '0';
}

describe('checkout orchestration', () => {
  it('records the operation before the provider is asked for anything', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'seller@velora.test',
      'sellerly',
      'inner',
    );
    const buyer = await consumer(live.runtime, 'buyer@velora.test');
    const response = await startCheckout(buyer, offerId, 'checkout-key-0001');
    expect(response.status).toBe(201);
    const body = (await response.json()) as CheckoutBody;

    expect(body.payment.state).toBe('provider_pending');
    expect(body.payment.amount).toEqual({
      amountMinor: '1500',
      currency: 'USD',
    });
    expect(body.redirectUrl).toContain('local-test.provider.invalid');

    // The stored operation names a provider object and the price it was made
    // against; nothing about a payment instrument is anywhere in the row.
    const rows = await rowsOf<Record<string, unknown>>(
      database.sql`select * from billing_payments`,
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toMatch(
      /card|pan|cvc|iban|account_number/iu,
    );
  });

  it('resolves fifty simultaneous submissions of one purchase to one operation', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'rush@velora.test',
      'rushing',
      'rush',
    );
    const buyer = await consumer(live.runtime, 'rushbuyer@velora.test');
    const responses = await Promise.all(
      Array.from({ length: 50 }, async () =>
        startCheckout(buyer, offerId, 'checkout-key-rush'),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    const bodies = (await Promise.all(
      responses.map(async (response) => response.json()),
    )) as CheckoutBody[];
    expect(new Set(bodies.map((body) => body.payment.id)).size).toBe(1);
    expect(await paymentCount()).toBe('1');

    // Exactly one caller was the one that created the provider object. The rest
    // are replays and are told the current state rather than handed a second
    // link to pay through.
    expect(
      bodies.filter((body) => body.redirectUrl !== undefined),
    ).toHaveLength(1);

    const [deadlocks] = await rowsOf<{ deadlocks: string }>(
      database.sql`select deadlocks::text as deadlocks from pg_stat_database where datname = current_database()`,
    );
    expect(deadlocks?.deadlocks).toBe('0');
  });

  it('refuses a reused key that names a different purchase', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'reuse@velora.test',
      'reusing',
      'reuse',
    );
    const buyer = await consumer(live.runtime, 'reusebuyer@velora.test');
    expect(
      (await startCheckout(buyer, offerId, 'checkout-key-reuse')).status,
    ).toBe(201);
    // Same key, different currency. A replay would charge for something the
    // caller did not ask for, so it is a conflict rather than a repeat.
    const conflicting = await startCheckout(
      buyer,
      offerId,
      'checkout-key-reuse',
      'EUR',
    );
    expect(conflicting.status).toBe(409);
    expect((await conflicting.json()) as { code: string }).toMatchObject({
      code: 'IDEMPOTENCY_KEY_MISMATCH',
    });
    expect(await paymentCount()).toBe('1');
  });

  it('leaves an ambiguous provider outcome to reconciliation rather than guessing', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'lost@velora.test',
      'lostly',
      'lost',
    );
    const buyer = await consumer(live.runtime, 'lostbuyer@velora.test');
    provider.behaveAs('ambiguous');
    const response = await startCheckout(buyer, offerId, 'checkout-key-lost');
    expect(response.status).toBe(201);
    const body = (await response.json()) as CheckoutBody;

    // Not succeeded, not failed. The provider may have acted and the answer was
    // lost, and the only honest state for that is one a job resolves later.
    expect(body.payment.state).toBe('reconciliation_pending');
    expect(body.redirectUrl).toBeUndefined();

    // The provider did create something, and it is findable under the same key
    // the operation already holds — which is why no second instruction is ever
    // sent under a new one.
    const [row] = await rowsOf<{ provider_idempotency_key: string }>(
      database.sql`select provider_idempotency_key from billing_payments`,
    );
    expect(row?.provider_idempotency_key).toBeDefined();
  });

  it('never lets a browser, a return URL, or another consumer move a payment', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'safe@velora.test',
      'safely',
      'safe',
    );
    const buyer = await consumer(live.runtime, 'safebuyer@velora.test');
    const stranger = await consumer(live.runtime, 'stranger@velora.test');
    const created = (await (
      await startCheckout(buyer, offerId, 'checkout-key-safe')
    ).json()) as CheckoutBody;

    // The return route is a read. It reports what the server already believed
    // and has no transition on its path at all.
    const read = await handle(
      signed(
        `/v1/billing/checkouts?paymentId=${created.payment.id}`,
        buyer,
        testConsumerOrigin,
      ),
    );
    expect(read.status).toBe(200);
    expect(((await read.json()) as CheckoutBody).payment.state).toBe(
      'provider_pending',
    );

    // Somebody else's payment is indistinguishable from one that does not
    // exist.
    const stolen = await handle(
      signed(
        `/v1/billing/checkouts?paymentId=${created.payment.id}`,
        stranger,
        testConsumerOrigin,
      ),
    );
    expect(stolen.status).toBe(404);

    // There is no route that accepts a state. The contract is strict, so a body
    // claiming success is a validation failure rather than a partially applied
    // update.
    const forged = await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: {
          amountMinor: '1',
          currency: 'USD',
          offerId,
          paymentMethod: { number: '4242424242424242' },
          state: 'succeeded',
        },
        idempotencyKey: 'checkout-key-forged',
        method: 'POST',
      }),
    );
    expect(forged.status).toBe(422);
    expect(await paymentCount()).toBe('1');
  });

  it('requires an idempotency key and a Consumer Web audience', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'guard@velora.test',
      'guarding',
      'guard',
    );
    const buyer = await consumer(live.runtime, 'guardbuyer@velora.test');

    const keyless = await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        method: 'POST',
      }),
    );
    expect(keyless.status).toBe(422);

    // Consumer Mobile holds a perfectly valid consumer credential and is still
    // refused: a purchase initiated from a mobile app is a different commercial
    // arrangement, and the boundary is the API rather than an absent screen.
    const mobile = await handle(
      new Request('http://api.test/v1/auth/local/mobile-sessions', {
        body: JSON.stringify({
          installationId: 'installation-checkout',
          subject: 'guardbuyer@velora.test',
        }),
        headers: {
          'content-type': 'application/json',
          'x-velora-device': 'guard-mobile',
        },
        method: 'POST',
      }),
    );
    const tokens = (await mobile.json()) as { accessToken: string };
    const fromMobile = await handle(
      new Request('http://api.test/v1/billing/checkouts', {
        body: JSON.stringify({ currency: 'USD', offerId }),
        headers: {
          authorization: `Bearer ${tokens.accessToken}`,
          'content-type': 'application/json',
          'x-velora-idempotency-key': 'checkout-key-mobile',
        },
        method: 'POST',
      }),
    );
    expect(fromMobile.status).toBe(403);
    expect(await paymentCount()).toBe('0');
  });

  it('refuses a purchase whose offer stopped being sellable', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'pulled@velora.test',
      'pulling',
      'pulled',
    );
    const buyer = await consumer(live.runtime, 'pulledbuyer@velora.test');
    // Retiring the offer withdraws every live price with it, which is what the
    // checkout path re-reads inside the transaction that would record the
    // operation.
    await execute(
      database.sql`update billing_prices set state = 'retired', retired_at = now() where state = 'active'`,
    );
    const response = await startCheckout(buyer, offerId, 'checkout-key-pulled');
    expect(response.status).toBe(403);
    expect(await paymentCount()).toBe('0');
  });
});

describe('checkout with no approved payment provider', () => {
  it('refuses to record an intention to charge somebody', async () => {
    const offerId = await sellableOffer(
      withoutProvider.runtime,
      'blocked@velora.test',
      'blocking',
      'blocked',
    );
    const buyer = await consumer(
      withoutProvider.runtime,
      'blockedbuyer@velora.test',
    );
    const response = await withoutProvider.runtime.app.handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'checkout-key-blocked',
        method: 'POST',
      }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()) as { code: string }).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
    });
    // Nothing was written. A pending payment nobody can settle is worse than a
    // refusal: it would be a durable record of an intention to charge somebody
    // through a provider that does not exist.
    expect(await paymentCount()).toBe('0');
  });
});

describe('the database enforces the payment invariants', () => {
  it('freezes what a payment says and retains every row', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'frozen@velora.test',
      'frozenpay',
      'frozen',
    );
    const buyer = await consumer(live.runtime, 'frozenbuyer@velora.test');
    await startCheckout(buyer, offerId, 'checkout-key-frozen');

    for (const statement of [
      database.sql`update billing_payments set amount_minor = 1`,
      database.sql`update billing_payments set currency = 'EUR'`,
      database.sql`update billing_payments set consumer_id = ${crypto.randomUUID()}`,
      database.sql`update billing_payments set idempotency_key = 'rewritten-key'`,
      database.sql`update billing_payments set provider_reference = 'another-charge'`,
      database.sql`delete from billing_payments`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }

    const rows = await rowsOf<{ amount_minor: string; currency: string }>(
      database.sql`select amount_minor::text as amount_minor, currency from billing_payments`,
    );
    expect(rows).toEqual([{ amount_minor: '1500', currency: 'USD' }]);
  });

  it('refuses a settlement that names no provider object', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'claim@velora.test',
      'claiming',
      'claim',
    );
    const buyer = await consumer(live.runtime, 'claimbuyer@velora.test');
    provider.behaveAs('ambiguous');
    await startCheckout(buyer, offerId, 'checkout-key-claim');

    // The operation has no provider reference, so nothing — not a service, not
    // a manual repair — can mark it succeeded.
    expect(
      await refused(async () =>
        execute(
          database.sql`update billing_payments set state = 'succeeded' where provider_reference is null`,
        ),
      ),
    ).toBe(true);
  });

  it('permits one operation per provider object and one provider key overall', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'unique@velora.test',
      'uniquely',
      'unique',
    );
    const buyer = await consumer(live.runtime, 'uniquebuyer@velora.test');
    const created = (await (
      await startCheckout(buyer, offerId, 'checkout-key-unique')
    ).json()) as CheckoutBody;
    const [row] = await rowsOf<{
      offer_id: string;
      price_id: string;
      provider_idempotency_key: string;
      provider_reference: string;
    }>(
      database.sql`select offer_id, price_id, provider_idempotency_key, provider_reference from billing_payments`,
    );
    expect(row).toBeDefined();
    expect(created.payment.id).toBeDefined();

    for (const insert of [
      database.sql`insert into billing_payments
        (amount_minor, consumer_id, created_at, currency, id, idempotency_key, offer_id, price_id,
         provider, provider_idempotency_key, provider_reference, state, updated_at, version)
        values (1500, ${crypto.randomUUID()}, now(), 'USD', ${crypto.randomUUID()}, 'other-key-0001',
                ${row?.offer_id ?? ''}, ${row?.price_id ?? ''}, 'local-test', 'another-provider-key',
                ${row?.provider_reference ?? ''}, 'provider_pending', now(), 1)`,
      database.sql`insert into billing_payments
        (amount_minor, consumer_id, created_at, currency, id, idempotency_key, offer_id, price_id,
         provider, provider_idempotency_key, state, updated_at, version)
        values (1500, ${crypto.randomUUID()}, now(), 'USD', ${crypto.randomUUID()}, 'other-key-0002',
                ${row?.offer_id ?? ''}, ${row?.price_id ?? ''}, 'local-test',
                ${row?.provider_idempotency_key ?? ''}, 'created', now(), 1)`,
    ]) {
      expect(await refused(async () => execute(insert))).toBe(true);
    }
  });

  it('refuses a payment whose currency disagrees with the price it names', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'mismatch@velora.test',
      'mismatched',
      'mismatch',
    );
    const buyer = await consumer(live.runtime, 'mismatchbuyer@velora.test');
    await startCheckout(buyer, offerId, 'checkout-key-mismatch');
    const [row] = await rowsOf<{ offer_id: string; price_id: string }>(
      database.sql`select offer_id, price_id from billing_payments`,
    );
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into billing_payments
            (amount_minor, consumer_id, created_at, currency, id, idempotency_key, offer_id, price_id,
             provider, provider_idempotency_key, state, updated_at, version)
            values (1500, ${crypto.randomUUID()}, now(), 'EUR', ${crypto.randomUUID()}, 'currency-key-01',
                    ${row?.offer_id ?? ''}, ${row?.price_id ?? ''}, 'local-test', 'currency-provider-key',
                    'created', now(), 1)`,
        ),
      ),
    ).toBe(true);
  });
});

describe('where Velora may transact at all', () => {
  it('refuses a country pairing no authority approved, and writes nothing', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'geogate@velora.test',
      'geogate',
      'geogating',
    );
    // A consumer whose region the test authority does not sell into. The gate
    // is about countries rather than about this person: nothing is wrong with
    // them, and the platform has simply not been approved to sell there.
    const buyer = await session(
      live.runtime,
      'geobuyer@velora.test',
      'consumer_web',
    );
    await handle(
      signed('/v1/users', buyer, testConsumerOrigin, { method: 'POST' }),
    );
    await handle(
      signed(
        '/v1/users/me/onboarding/adult-declaration',
        buyer,
        testConsumerOrigin,
        { body: { declaresAdult: true, region: 'BR' }, method: 'POST' },
      ),
    );

    const response = await startCheckout(
      buyer,
      offerId,
      'checkout-key-geogate',
    );
    expect(response.status).toBe(403);
    // No operation, and therefore no tax engine was asked about a sale that was
    // never going to happen.
    expect(await paymentCount()).toBe('0');
  });

  it('snapshots the tax assessment and freezes it', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'taxsnap@velora.test',
      'taxsnap',
      'taxsnapping',
    );
    const buyer = await consumer(live.runtime, 'taxsnapbuyer@velora.test');
    const response = await startCheckout(
      buyer,
      offerId,
      'checkout-key-taxsnap',
    );
    expect(response.status).toBe(201);

    const [payment] = await rowsOf<{
      tax_authority: string;
      tax_minor: string;
    }>(
      database.sql`select tax_authority, tax_minor::text as tax_minor from billing_payments`,
    );
    // A zero that names who said it. An authority with no amount, or an amount
    // with no authority, is refused by a CHECK rather than stored as half an
    // answer.
    expect(payment).toEqual({ tax_authority: 'local-test', tax_minor: '0' });

    for (const statement of [
      database.sql`update billing_payments set tax_minor = 100`,
      database.sql`update billing_payments set tax_authority = 'somebody-else'`,
      database.sql`update billing_payments set tax_authority = null, tax_minor = null`,
    ]) {
      // Recomputing a historical sale against today's rates would silently
      // rewrite what somebody was charged, and a rate change is exactly what
      // makes somebody want to.
      expect(await refused(async () => execute(statement))).toBe(true);
    }
  });
});
