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
  testMediaRuntime,
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

async function giftRecipient(
  subject: string,
  creatorHandle: string,
): Promise<{
  readonly owner: Session;
  readonly recipientUserId: string;
  readonly studio: Session;
}> {
  const owner = await consumer(live.runtime, subject);
  const ownAccount = (await (
    await live.runtime.app.handle(
      signed('/v1/users/me', owner, testConsumerOrigin),
    )
  ).json()) as { id: string };
  const studio = await session(live.runtime, subject, 'creator_studio');
  const post = (path: string, body: unknown = {}) =>
    live.runtime.app.handle(
      signed(path, studio, testCreatorOrigin, { body, method: 'POST' }),
    );
  await post('/v1/creator');
  await post('/v1/creator/onboarding/acknowledgements', { acknowledgements });
  const profile = (await (
    await post('/v1/creator/profile', {
      displayName: 'Gifted Creator',
      handle: creatorHandle,
    })
  ).json()) as { version: number };
  await post('/v1/creator/profile/publication', {
    publication: 'published',
    version: profile.version,
  });
  const provisioned = await post('/v1/creator/gifts/catalog/provision');
  expect(provisioned.status).toBe(200);
  return { owner, recipientUserId: ownAccount.id, studio };
}

async function giftCatalog(buyer: Session, creatorHandle: string) {
  return handle(
    signed(
      `/v1/billing/gifts/catalog?handle=${creatorHandle}&currency=USD`,
      buyer,
      testConsumerOrigin,
    ),
  );
}

async function sendGift(
  buyer: Session,
  creatorHandle: string,
  giftItemId: string,
  idempotencyKey: string,
) {
  return handle(
    signed('/v1/billing/gifts', buyer, testConsumerOrigin, {
      body: {
        context: { type: 'creator_profile' },
        currency: 'USD',
        giftItemId,
        handle: creatorHandle,
      },
      idempotencyKey,
      method: 'POST',
    }),
  );
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

describe('virtual gifting', () => {
  it('settles through the verified provider inbox and balanced journal without granting entitlement', async () => {
    const recipient = await giftRecipient('gifted@velora.test', 'gifted');
    const buyer = await consumer(live.runtime, 'giver@velora.test');
    const catalogResponse = await giftCatalog(buyer, 'gifted');
    expect(catalogResponse.status).toBe(200);
    const catalog = (await catalogResponse.json()) as {
      items: { id: string; price: { amountMinor: string } }[];
    };
    expect(catalog.items).toHaveLength(8);
    const item = catalog.items[2];
    if (item === undefined) throw new Error('gift item missing');

    const sent = await sendGift(buyer, 'gifted', item.id, 'gift-send-0001');
    expect(sent.status).toBe(201);
    const body = (await sent.json()) as { gift: { id: string; state: string } };
    expect(body.gift.state).toBe('sent');

    const [payment] = await rowsOf<{
      amount_minor: string;
      id: string;
      state: string;
    }>(
      database.sql`select id, amount_minor::text as amount_minor, state from billing_payments`,
    );
    expect(payment?.state).toBe('succeeded');
    expect(payment?.amount_minor).toBe(item.price.amountMinor);
    const [balance] = await rowsOf<{ debits: string; credits: string }>(
      database.sql`select coalesce(sum(case when direction = 'debit' then amount_minor else 0 end), 0)::text as debits, coalesce(sum(case when direction = 'credit' then amount_minor else 0 end), 0)::text as credits from billing_journal_entries`,
    );
    expect(balance?.debits).toBe(balance?.credits);
    const entitlementEvents = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_outbox where event_name = 'billing.entitlement.granted.v1'`,
    );
    expect(entitlementEvents[0]?.count).toBe('0');

    const sentHistory = await handle(
      signed('/v1/billing/gifts', buyer, testConsumerOrigin),
    );
    expect(sentHistory.status).toBe(200);
    expect(
      ((await sentHistory.json()) as { gifts: unknown[] }).gifts,
    ).toHaveLength(1);
    const receivedHistory = await handle(
      signed('/v1/creator/gifts', recipient.studio, testCreatorOrigin),
    );
    const receivedBody = (await receivedHistory.json()) as {
      gifts: { earning: { amountMinor: string }; senderVisibility: string }[];
    };
    expect(receivedBody.gifts[0]?.senderVisibility).toBe('withheld');
    expect(
      BigInt(receivedBody.gifts[0]?.earning.amountMinor ?? '0'),
    ).toBeGreaterThan(0n);
  });

  it('deduplicates concurrent sends and blocks direct checkout of a gift offer', async () => {
    await giftRecipient('rushgift@velora.test', 'rushgift');
    const buyer = await consumer(live.runtime, 'rushgiver@velora.test');
    const catalog = (await (await giftCatalog(buyer, 'rushgift')).json()) as {
      items: { id: string }[];
    };
    const item = catalog.items[0];
    if (item === undefined) throw new Error('gift item missing');
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        sendGift(buyer, 'rushgift', item.id, 'gift-rush-key'),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(
      (
        await rowsOf<{ count: string }>(
          database.sql`select count(*)::text as count from billing_gifts`,
        )
      )[0]?.count,
    ).toBe('1');
    expect(await paymentCount()).toBe('1');

    const [offer] = await rowsOf<{ id: string }>(
      database.sql`select id from billing_offers where resource_type = 'gift' limit 1`,
    );
    if (offer === undefined) throw new Error('gift offer missing');
    const bypass = await startCheckout(buyer, offer.id, 'gift-bypass-key');
    expect(bypass.status).toBe(403);
  });

  it('refuses self-gifts, blocked pairs, missing items, and deployed provider absence', async () => {
    const recipient = await giftRecipient('guardgift@velora.test', 'guardgift');
    const buyer = await consumer(live.runtime, 'guardgiver@velora.test');
    const catalog = (await (await giftCatalog(buyer, 'guardgift')).json()) as {
      items: { id: string }[];
    };
    const item = catalog.items[0];
    if (item === undefined) throw new Error('gift item missing');

    expect((await giftCatalog(recipient.owner, 'guardgift')).status).toBe(403);
    expect(
      (
        await sendGift(
          buyer,
          'guardgift',
          crypto.randomUUID(),
          'gift-missing-key',
        )
      ).status,
    ).toBe(404);
    expect((await giftCatalog(buyer, 'missing-recipient')).status).toBe(404);
    const blocked = await handle(
      signed('/v1/safety/blocks', buyer, testConsumerOrigin, {
        body: { targetId: recipient.recipientUserId },
        method: 'POST',
      }),
    );
    expect(blocked.status).toBe(200);
    expect((await giftCatalog(buyer, 'guardgift')).status).toBe(403);
    expect(await paymentCount()).toBe('0');

    const absent = await consumer(
      withoutProvider.runtime,
      'nogifts@velora.test',
    );
    const unavailable = await withoutProvider.runtime.app.handle(
      signed(
        '/v1/billing/gifts/catalog?handle=guardgift&currency=USD',
        absent,
        testConsumerOrigin,
      ),
    );
    expect(unavailable.status).toBe(503);
  });

  it('records a declined attempt as failed without showing it to the creator', async () => {
    const recipient = await giftRecipient(
      'declinedgift@velora.test',
      'declinedgift',
    );
    const buyer = await consumer(live.runtime, 'declinedgiver@velora.test');
    const catalog = (await (
      await giftCatalog(buyer, 'declinedgift')
    ).json()) as { items: { id: string }[] };
    const item = catalog.items[0];
    if (item === undefined) throw new Error('gift item missing');
    provider.behaveAs('declined');

    const response = await sendGift(
      buyer,
      'declinedgift',
      item.id,
      'gift-declined-key',
    );
    expect(response.status).toBe(201);
    expect(
      ((await response.json()) as { gift: { state: string } }).gift.state,
    ).toBe('failed');

    const sent = await handle(
      signed('/v1/billing/gifts', buyer, testConsumerOrigin),
    );
    expect(
      ((await sent.json()) as { gifts: { state: string }[] }).gifts[0]?.state,
    ).toBe('failed');
    const received = await handle(
      signed('/v1/creator/gifts', recipient.studio, testCreatorOrigin),
    );
    expect(
      ((await received.json()) as { gifts: unknown[] }).gifts,
    ).toHaveLength(0);
    expect(
      (
        await rowsOf<{ count: string }>(
          database.sql`select count(*)::text as count from billing_journal_transactions`,
        )
      )[0]?.count,
    ).toBe('0');
  });

  it('keeps an ambiguous attempt pending until reconciliation settles it', async () => {
    const recipient = await giftRecipient(
      'reconciledgift@velora.test',
      'reconciledgift',
    );
    const buyer = await consumer(live.runtime, 'reconciledgiver@velora.test');
    const catalog = (await (
      await giftCatalog(buyer, 'reconciledgift')
    ).json()) as { items: { id: string }[] };
    const item = catalog.items[0];
    if (item === undefined) throw new Error('gift item missing');
    provider.behaveAs('ambiguous');

    const pending = await sendGift(
      buyer,
      'reconciledgift',
      item.id,
      'gift-reconcile-key',
    );
    expect(pending.status).toBe(201);
    expect(
      ((await pending.json()) as { gift: { state: string } }).gift.state,
    ).toBe('pending');
    expect(
      (
        await rowsOf<{ count: string }>(
          database.sql`select count(*)::text as count from billing_journal_transactions`,
        )
      )[0]?.count,
    ).toBe('0');

    provider.behaveAs('normal');
    await execute(
      database.sql`update billing_payments set updated_at = now() - interval '10 minutes'`,
    );
    await live.billing.reconciliation.reconcileOnce();
    const [payment] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_payments`,
    );
    provider.markSucceeded(payment?.provider_reference ?? '');
    await execute(
      database.sql`update billing_payments set updated_at = now() - interval '10 minutes'`,
    );
    await live.billing.reconciliation.reconcileOnce();

    const received = await handle(
      signed('/v1/creator/gifts', recipient.studio, testCreatorOrigin),
    );
    const receivedBody = (await received.json()) as {
      gifts: { earning: { amountMinor: string }; state: string }[];
    };
    expect(receivedBody.gifts[0]?.state).toBe('sent');
    expect(
      BigInt(receivedBody.gifts[0]?.earning.amountMinor ?? '0'),
    ).toBeGreaterThan(0n);
  });

  it('moves gift history to reversed when a full refund settles', async () => {
    const recipient = await giftRecipient(
      'refundgift@velora.test',
      'refundgift',
    );
    const buyer = await consumer(live.runtime, 'refundgiver@velora.test');
    const catalog = (await (await giftCatalog(buyer, 'refundgift')).json()) as {
      items: { id: string }[];
    };
    const item = catalog.items[0];
    if (item === undefined) throw new Error('gift item missing');
    expect(
      (await sendGift(buyer, 'refundgift', item.id, 'gift-refund-key')).status,
    ).toBe(201);
    const [payment] = await rowsOf<{
      amount_minor: string;
      currency: string;
      id: string;
    }>(
      database.sql`select id, amount_minor::text as amount_minor, currency from billing_payments`,
    );
    if (payment === undefined) throw new Error('payment missing');
    const refund = await live.billing.refunds.issue({
      actorReference: 'test-operator',
      amountMinor: BigInt(payment.amount_minor),
      correlationId: 'gift-refund-correlation',
      currency: payment.currency,
      idempotencyKey: 'gift-refund-full',
      paymentId: payment.id,
      reasonCode: 'not_delivered',
    });
    expect(refund.kind).toBe('issued');
    expect(
      (
        await rowsOf<{ state: string }>(
          database.sql`select state from billing_gifts`,
        )
      )[0]?.state,
    ).toBe('reversed');
    const history = await handle(
      signed('/v1/creator/gifts', recipient.studio, testCreatorOrigin),
    );
    const historyBody = (await history.json()) as {
      gifts: { earning: { amountMinor: string }; state: string }[];
    };
    expect(historyBody.gifts[0]?.state).toBe('reversed');
    expect(historyBody.gifts[0]?.earning.amountMinor).toBe('0');
  });

  it('freezes gift and catalog identity in PostgreSQL and retains their history', async () => {
    await giftRecipient('frozentgift@velora.test', 'frozentgift');
    const buyer = await consumer(live.runtime, 'frozentgiver@velora.test');
    const catalog = (await (
      await giftCatalog(buyer, 'frozentgift')
    ).json()) as {
      items: { id: string }[];
    };
    const item = catalog.items[0];
    if (item === undefined) throw new Error('gift item missing');
    expect(
      (await sendGift(buyer, 'frozentgift', item.id, 'gift-frozen-key')).status,
    ).toBe(201);

    for (const statement of [
      database.sql`insert into billing_gifts
        (catalog_item_id, context_type, created_at, id, idempotency_key, offer_id,
         payment_id, recipient_creator_id, recipient_display_name, recipient_handle,
         recipient_user_id, reversed_at, sender_user_id, sent_at, state, updated_at, version)
        select catalog_item_id, context_type, now(), ${crypto.randomUUID()},
               'gift-forged-key', offer_id, null, ${crypto.randomUUID()},
               recipient_display_name, recipient_handle, recipient_user_id, null,
               sender_user_id, null, 'pending', now(), 1
          from billing_gifts limit 1`,
      database.sql`update billing_gifts set recipient_handle = 'rewritten'`,
      database.sql`update billing_gifts set state = 'pending', version = version + 1`,
      database.sql`delete from billing_gifts`,
      database.sql`update billing_gift_catalog_items set name = 'Rewritten' where id = ${item.id}`,
      database.sql`delete from billing_gift_catalog_items where id = ${item.id}`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }

    expect(
      (
        await rowsOf<{ count: string }>(
          database.sql`select count(*)::text as count from billing_gifts`,
        )
      )[0]?.count,
    ).toBe('1');
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

/**
 * One person's idempotency key is not another's.
 *
 * The key is a caller-chosen string, so two people will eventually send the
 * same one — a client library that seeds from a timestamp, a retry helper with
 * a fixed prefix, or somebody trying it deliberately. If the identity were the
 * key alone, the second person's purchase would resolve to the first person's
 * operation: they would be shown a payment that is not theirs, and the charge
 * they meant to make would never happen.
 */
describe('whose purchase a key belongs to', () => {
  it('gives two people sending one key two separate purchases', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'shared@velora.test',
      'sharedkey',
      'sharedkey',
    );
    const first = await consumer(live.runtime, 'sharedone@velora.test');
    const second = await consumer(live.runtime, 'sharedtwo@velora.test');
    const collidingKey = 'checkout-key-collide';

    const opened = await startCheckout(first, offerId, collidingKey);
    const other = await startCheckout(second, offerId, collidingKey);
    expect(opened.status).toBe(201);
    expect(other.status).toBe(201);

    const bodies = (await Promise.all([
      opened.json(),
      other.json(),
    ])) as CheckoutBody[];
    // Two operations, not one answered twice.
    expect(new Set(bodies.map((body) => body.payment.id)).size).toBe(2);
    expect(await paymentCount()).toBe('2');
    // And each is answered with a payment link of its own, because each is a
    // purchase that has not been made yet.
    expect(
      bodies.filter((body) => body.redirectUrl !== undefined),
    ).toHaveLength(2);

    // And the two operations belong to two different people, which is the
    // property the key alone could never have carried.
    const owners = await rowsOf<{ consumer_id: string }>(
      database.sql`select distinct consumer_id::text as consumer_id from billing_payments`,
    );
    expect(owners).toHaveLength(2);
  });
});

describe('establishing one purchase identity', () => {
  /**
   * The provider key is derived from the purchase identity, and the column that
   * holds it is bounded. When that derivation spelled the identity out it
   * overran the bound at the longest key a caller may send and was truncated,
   * so two different purchases whose keys differed only past the cut derived
   * the same provider key and the second was refused as a duplicate of a
   * purchase it was not.
   */
  it('keeps two purchases apart when their keys differ only at the end', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'longkey@velora.test',
      'longkeyed',
      'longkey',
    );
    const buyer = await consumer(live.runtime, 'longkeybuyer@velora.test');
    // The old derivation kept 119 characters of the key inside its 200-
    // character bound, so these two agree on everything it would have kept.
    const shared = 'k'.repeat(119);
    const first = await startCheckout(
      buyer,
      offerId,
      `${shared}${'a'.repeat(9)}`,
    );
    const second = await startCheckout(
      buyer,
      offerId,
      `${shared}${'b'.repeat(9)}`,
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const keys = await rowsOf<{ provider_idempotency_key: string }>(
      database.sql`select provider_idempotency_key from billing_payments`,
    );
    // Two purchases, two operations, two distinct instructions to a provider.
    expect(keys).toHaveLength(2);
    expect(new Set(keys.map((row) => row.provider_idempotency_key)).size).toBe(
      2,
    );
  });

  /**
   * Establishing an operation takes an advisory lock on the purchase identity
   * before it inserts.
   *
   * `on conflict` arbitrates one index, and the provider-key index is not it:
   * two callers that both pass the arbiter's check before either is visible
   * would collide there, where a duplicate is raised rather than skipped. The
   * lock is what stops two callers ever being inside that window, so this
   * asserts the lock is actually taken rather than asserting the shape of a
   * race that only appears on a busy machine.
   */
  it('serializes concurrent establishment of one purchase on a lock', async () => {
    const offerId = await sellableOffer(
      live.runtime,
      'locked@velora.test',
      'lockedup',
      'locked',
    );
    const buyer = await consumer(live.runtime, 'lockedbuyer@velora.test');
    const idempotencyKey = 'checkout-key-locked';
    // One ordinary purchase first, purely to learn this buyer's identifier from
    // Velora's own record rather than guessing which account row is theirs.
    expect(
      (await startCheckout(buyer, offerId, 'checkout-key-locked-probe')).status,
    ).toBe(201);
    const [probe] = await rowsOf<{ consumer_id: string }>(
      database.sql`select consumer_id from billing_payments`,
    );
    const consumerId = probe?.consumer_id ?? '';
    // The same key the repository builds, so this holds the lock the checkout
    // path is about to want.
    const identity = ['billing_payments', consumerId, offerId, idempotencyKey]
      .map((part) => part.toLowerCase())
      .join(' ');

    const holder = await database.sql.reserve();
    let started: Promise<Response> | undefined;
    try {
      await holder`begin`;
      await holder`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`;

      started = startCheckout(buyer, offerId, idempotencyKey);

      // It cannot get past the insert while the lock is held elsewhere. Polling
      // for the wait to appear rather than sleeping for it: the condition is
      // what is being asserted, and it either arrives or the lock was never
      // taken and this fails.
      let waiting = 0;
      for (let attempt = 0; attempt < 100 && waiting === 0; attempt += 1) {
        const [row] = await rowsOf<{ count: string }>(
          database.sql`select count(*)::text as count from pg_locks
             where locktype = 'advisory' and not granted`,
        );
        waiting = Number(row?.count ?? '0');
        if (waiting === 0) await Bun.sleep(20);
      }
      expect(waiting).toBeGreaterThan(0);
      // And nothing new was written while it waited.
      expect(await paymentCount()).toBe('1');
    } finally {
      await holder`commit`;
      holder.release();
    }

    const response = await started;
    expect(response.status).toBe(201);
    expect(await paymentCount()).toBe('2');
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
