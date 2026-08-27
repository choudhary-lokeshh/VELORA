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
  localTestCheckoutPath,
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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';

/**
 * The membership product, end to end, against real PostgreSQL.
 *
 * The suites beside this one prove the machinery: that an operation exists
 * before a provider is called, that a redelivered event settles once, that the
 * books balance. This one proves the *product* — that a person can find a
 * membership, buy it, read what it admits them to, stop it, and lose access
 * when the period they paid for runs out, and that every one of those steps
 * refuses when it should.
 *
 * The property it exists to defend is the one worth stating plainly: **starting
 * a checkout unlocks nothing**. Access follows an authoritative settlement
 * published through the outbox and applied by PRIVATE CLUBS, and every
 * protected read re-derives it. A test that only proved the happy path would
 * not distinguish that from a client that hid a button.
 */

const databaseUrl = await provisionDatabase('velora_billing_memberships');
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
      request.headers.get('x-velora-device') ?? 'membership-test',
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

/** The relay the worker runs, over the same database, with the real consumers. */
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
  owner: 'membership-test-relay',
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

/** A Consumer Mobile bearer token for the same person. */
async function mobileToken(subject: string): Promise<string> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/mobile-sessions', {
      body: JSON.stringify({
        installationId: `installation-${subject.replaceAll(/[^a-z0-9]/gu, '-')}`,
        subject,
      }),
      headers: {
        'content-type': 'application/json',
        'x-velora-device': `${subject}-mobile`,
      },
      method: 'POST',
    }),
  );
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
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

interface Sellable {
  readonly clubId: string;
  readonly contentId: string;
  readonly handle: string;
  readonly offerId: string;
  readonly studio: Session;
}

/**
 * A creator with a published club, a members-only item inside it, benefits, and
 * one active priced offer. Everything through the ordinary routes.
 */
async function sellable(subject: string, slug: string): Promise<Sellable> {
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
    await post('/v1/creator/clubs', {
      benefits: ['A letter every week', 'The recordings'],
      name: 'Inner circle',
      slug,
    })
  ).json()) as { clubs: { id: string; version: number }[] };
  const clubRow = created.clubs[0];
  if (clubRow === undefined) throw new Error('club was not created');
  await post('/v1/creator/clubs/lifecycle', {
    clubId: clubRow.id,
    lifecycle: 'published',
    version: clubRow.version,
  });
  const content = (await (
    await post('/v1/creator/content', {
      body: 'Only members read this.',
      clubId: clubRow.id,
      summary: 'A members-only letter',
      title: 'The first letter',
      visibility: 'members_only',
    })
  ).json()) as { content: { id: string; version: number }[] };
  const item = content.content[0];
  if (item === undefined) throw new Error('content was not created');
  await post('/v1/creator/content/lifecycle', {
    contentId: item.id,
    lifecycle: 'published',
    version: item.version,
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
  return {
    clubId: clubRow.id,
    contentId: item.id,
    handle: slug,
    offerId: offer.offer.id,
    studio,
  };
}

interface Purchase {
  readonly paymentId: string;
  readonly providerReference: string;
  readonly redirectUrl: string;
}

async function startCheckout(
  buyer: Session,
  offerId: string,
  key: string,
  interval?: 'month' | 'year',
): Promise<Purchase> {
  const response = await handle(
    signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
      body: {
        currency: 'USD',
        ...(interval === undefined ? {} : { interval }),
        offerId,
      },
      idempotencyKey: key,
      method: 'POST',
    }),
  );
  const body = (await response.json()) as {
    payment: { id: string };
    redirectUrl?: string;
  };
  const [row] = await rowsOf<{ provider_reference: string }>(
    database.sql`select provider_reference from billing_payments where id = ${body.payment.id}`,
  );
  return {
    paymentId: body.payment.id,
    providerReference: row?.provider_reference ?? '',
    redirectUrl: body.redirectUrl ?? '',
  };
}

/**
 * Somebody pressing the button on the provider's own hosted page.
 *
 * A browser navigation and a form post to an origin that is not a product
 * route. Nothing about it is authorized as Velora: the settlement is the signed
 * event the adapter delivers afterwards.
 */
async function payOnProviderPage(
  reference: string,
  outcome: 'pay' | 'cancel' = 'pay',
): Promise<Response> {
  return handle(
    new Request(`http://api.test${localTestCheckoutPath}`, {
      body: new URLSearchParams({ outcome, reference }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    }),
  );
}

async function readClub(
  actor: Session | undefined,
  creatorHandle: string,
  slug: string,
): Promise<{
  readonly body: {
    club: { benefits: string[]; membership?: { source: string } };
    content: { body?: string; id: string; title: string }[];
  };
  readonly status: number;
}> {
  const path = `/v1/clubs?handle=${creatorHandle}&slug=${slug}`;
  const response =
    actor === undefined
      ? await handle(new Request(`http://api.test${path}`))
      : await handle(signed(path, actor, testConsumerOrigin));
  return {
    body: (await response.json()) as {
      club: { benefits: string[]; membership?: { source: string } };
      content: { body?: string; id: string; title: string }[];
    },
    status: response.status,
  };
}

async function count(table: string): Promise<string> {
  const rows = await rowsOf<{ count: string }>(
    database.sql`select count(*)::text as count from ${database.sql(table)}`,
  );
  return rows[0]?.count ?? '0';
}

describe('finding a membership', () => {
  it('publishes what a club costs and what it promises through two owners', async () => {
    const shop = await sellable('offers@velora.test', 'offering');
    const buyer = await consumerSession('offerbuyer@velora.test');

    const clubs = (await (
      await handle(
        signed(
          `/v1/creators/clubs?handle=${shop.handle}`,
          buyer,
          testConsumerOrigin,
        ),
      )
    ).json()) as {
      clubs: { benefits: string[]; id: string; name: string }[];
    };
    const memberships = (await (
      await handle(
        signed(
          `/v1/creators/memberships?handle=${shop.handle}`,
          buyer,
          testConsumerOrigin,
        ),
      )
    ).json()) as {
      gates?: string[];
      offers: {
        id: string;
        prices: { amount: { amountMinor: string; currency: string } }[];
        resource: { id: string; type: string };
      }[];
      readiness: { enabled: boolean };
      subscriptions: unknown[];
    };

    // Two answers, from two domains, joined on an opaque identifier. Neither
    // route knows the other exists.
    const club = clubs.clubs[0];
    const offer = memberships.offers[0];
    expect(club?.benefits).toEqual(['A letter every week', 'The recordings']);
    expect(offer?.resource).toEqual({ id: club?.id ?? '', type: 'club' });
    expect(offer?.prices[0]?.amount).toEqual({
      amountMinor: '1500',
      currency: 'USD',
    });
    expect(memberships.readiness.enabled).toBe(true);
    // Nothing is shut for this pairing, so the surface may offer to sell.
    expect(memberships.gates).toEqual([]);
    expect(memberships.subscriptions).toEqual([]);
    // No price anywhere in the club answer. What something costs is BILLING's.
    expect(JSON.stringify(clubs)).not.toContain('1500');
  });

  it('reports every shut gate for a consumer VELORA may not sell to', async () => {
    const shop = await sellable('gated@velora.test', 'gatekeeper');
    const buyer = await consumerSession('gatedbuyer@velora.test');
    // A country the local-test authority does not approve for selling into.
    // The account's own declared region, which is the only thing VELORA holds.
    const account = (await (
      await handle(signed('/v1/users/me', buyer, testConsumerOrigin))
    ).json()) as { id: string };
    await execute(
      database.sql`update users_accounts set region = 'GB' where id = ${account.id}`,
    );

    const body = (await (
      await handle(
        signed(
          `/v1/creators/memberships?handle=${shop.handle}`,
          buyer,
          testConsumerOrigin,
        ),
      )
    ).json()) as { gates?: string[]; offers: unknown[] };

    // The offer is still published — it is not for sale *to this person*, which
    // is a different statement and the one an honest surface makes.
    expect(body.offers).toHaveLength(1);
    expect(body.gates).toEqual(['consumer_country']);
  });
});

describe('two cadences for one membership', () => {
  /** The same club, sold monthly and yearly, in one currency. */
  async function twoCadences(subject: string, slug: string) {
    const shop = await sellable(subject, slug);
    const published = await handle(
      signed('/v1/creator/offers/prices', shop.studio, testCreatorOrigin, {
        body: {
          amountMinor: '15000',
          currency: 'USD',
          interval: 'year',
          offerId: shop.offerId,
        },
        method: 'POST',
      }),
    );
    expect(published.status).toBe(201);
    return shop;
  }

  it('publishes both, because they are two prices for two different things', async () => {
    const shop = await twoCadences('cadence@velora.test', 'cadencing');
    const buyer = await consumerSession('cadencebuyer@velora.test');

    const body = (await (
      await handle(
        signed(
          `/v1/creators/memberships?handle=${shop.handle}`,
          buyer,
          testConsumerOrigin,
        ),
      )
    ).json()) as {
      offers: {
        prices: {
          amount: { amountMinor: string };
          interval?: string;
        }[];
      }[];
    };

    const prices = body.offers[0]?.prices ?? [];
    expect(
      prices
        .map(
          (price) => `${price.interval ?? 'once'}:${price.amount.amountMinor}`,
        )
        .toSorted(),
    ).toEqual(['month:1500', 'year:15000']);
  });

  it('charges the cadence the request named', async () => {
    const shop = await twoCadences('picked@velora.test', 'picking');
    const buyer = await consumerSession('pickedbuyer@velora.test');

    const started = await startCheckout(
      buyer,
      shop.offerId,
      'cadence-year',
      'year',
    );
    await payOnProviderPage(started.providerReference);
    await drain();

    const [subscription] = await rowsOf<{ amount_minor: string }>(
      database.sql`select amount_minor::text as amount_minor from billing_subscriptions`,
    );
    expect(subscription?.amount_minor).toBe('15000');
  });

  it('refuses a purchase that does not say which cadence it is for', async () => {
    const shop = await twoCadences('vague@velora.test', 'vaguing');
    const buyer = await consumerSession('vaguebuyer@velora.test');

    const response = await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', offerId: shop.offerId },
        idempotencyKey: 'cadence-unsaid',
        method: 'POST',
      }),
    );

    // Charging the cheaper one, the first one, or whichever the database
    // returned would each be VELORA deciding what somebody bought.
    expect(response.status).toBe(403);
    expect(await count('billing_payments')).toBe('0');
  });

  it('refuses one key reused across two cadences', async () => {
    const shop = await twoCadences('reused@velora.test', 'reusing');
    const buyer = await consumerSession('reusedbuyer@velora.test');

    const first = await startCheckout(
      buyer,
      shop.offerId,
      'cadence-shared',
      'month',
    );
    expect(first.paymentId).toBeDefined();
    const second = await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', interval: 'year', offerId: shop.offerId },
        idempotencyKey: 'cadence-shared',
        method: 'POST',
      }),
    );

    // A different purchase wearing a used key. Answering it with the monthly
    // operation would look like a successful retry while charging for the
    // wrong thing.
    expect(second.status).toBe(409);
    expect(await count('billing_payments')).toBe('1');
  });

  it('still refuses a second live price at the same cadence', async () => {
    const shop = await twoCadences('duplicate@velora.test', 'duplicating');

    const again = await handle(
      signed('/v1/creator/offers/prices', shop.studio, testCreatorOrigin, {
        body: {
          amountMinor: '1600',
          currency: 'USD',
          interval: 'month',
          offerId: shop.offerId,
        },
        method: 'POST',
      }),
    );

    // Two live monthly prices in one currency is the ambiguity the rule exists
    // to prevent, and it still does. Changing a price retires the old row.
    expect(again.status).toBe(409);
  });
});

describe('buying a membership', () => {
  it('unlocks nothing until the provider settles, and everything after', async () => {
    const shop = await sellable('buying@velora.test', 'buying');
    const buyer = await consumerSession('buyingbuyer@velora.test');

    const started = await startCheckout(buyer, shop.offerId, 'membership-0001');
    // The provider's own page, not a product route.
    expect(started.redirectUrl).toContain(localTestCheckoutPath);
    await drain();

    // Checkout has been *started*. Nothing about that is access.
    expect(await count('clubs_memberships')).toBe('0');
    const locked = await readClub(buyer, shop.handle, shop.handle);
    expect(locked.status).toBe(200);
    expect(locked.body.club.membership).toBeUndefined();
    expect(locked.body.content).toEqual([]);
    expect(JSON.stringify(locked.body)).not.toContain('Only members read this');

    const paid = await payOnProviderPage(started.providerReference);
    expect(paid.status).toBe(303);
    await drain();

    const unlocked = await readClub(buyer, shop.handle, shop.handle);
    expect(unlocked.body.club.membership?.source).toBe('billing');
    expect(unlocked.body.content[0]?.title).toBe('The first letter');
    expect(unlocked.body.content[0]?.body).toBe('Only members read this.');

    const [subscription] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_subscriptions`,
    );
    expect(subscription?.state).toBe('active');
    // The money landed with it, and the books balance.
    const [balance] = await rowsOf<{ total: string }>(
      database.sql`select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0)::text as total
        from billing_journal_entries`,
    );
    expect(balance?.total).toBe('0');
  });

  it('leaves a cancelled provider page as a payment nobody was charged for', async () => {
    const shop = await sellable('abandon@velora.test', 'abandoning');
    const buyer = await consumerSession('abandonbuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'membership-0002');

    const answer = await payOnProviderPage(started.providerReference, 'cancel');
    expect(answer.status).toBe(303);
    await drain();

    const [payment] = await rowsOf<{ failure_reason: string; state: string }>(
      database.sql`select failure_reason, state from billing_payments`,
    );
    expect(payment?.state).toBe('cancelled');
    expect(payment?.failure_reason).toBe('cancelled_by_consumer');
    expect(await count('billing_subscriptions')).toBe('0');
    expect(await count('clubs_memberships')).toBe('0');
    expect(await count('billing_journal_transactions')).toBe('0');
  });

  it('settles one purchase however many times the page is submitted', async () => {
    const shop = await sellable('double@velora.test', 'doubling');
    const buyer = await consumerSession('doublebuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'membership-0003');

    await Promise.all([
      payOnProviderPage(started.providerReference),
      payOnProviderPage(started.providerReference),
      payOnProviderPage(started.providerReference),
    ]);
    await drain();
    await drain();

    expect(await count('billing_subscriptions')).toBe('1');
    expect(await count('clubs_memberships')).toBe('1');
    expect(await count('billing_journal_transactions')).toBe('1');
  });

  it('lets Consumer Mobile end what Consumer Web began', async () => {
    const shop = await sellable('mobile@velora.test', 'mobiling');
    const buyer = await consumerSession('mobilebuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'membership-0004');
    await payOnProviderPage(started.providerReference);
    await drain();
    const [row] = await rowsOf<{ id: string }>(
      database.sql`select id from billing_subscriptions`,
    );

    // Starting a purchase from a mobile application is refused because it is a
    // different commercial arrangement. Stopping one is not an arrangement at
    // all, and making a subscription harder to leave than to enter is the
    // pattern consumer-protection law exists to prevent.
    const token = await mobileToken('mobilebuyer@velora.test');
    const response = await handle(
      new Request('http://api.test/v1/billing/subscriptions/cancellation', {
        body: JSON.stringify({ subscriptionId: row?.id }),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    const [after] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_subscriptions`,
    );
    expect(after?.state).toBe('cancel_at_period_end');
  });
});

describe('ending a membership', () => {
  async function bought(subject: string, slug: string) {
    const shop = await sellable(`${subject}-creator@velora.test`, slug);
    const buyer = await consumerSession(`${subject}-buyer@velora.test`);
    const started = await startCheckout(buyer, shop.offerId, `${slug}-key`);
    await payOnProviderPage(started.providerReference);
    await drain();
    const [row] = await rowsOf<{ id: string }>(
      database.sql`select id from billing_subscriptions`,
    );
    return { buyer, shop, subscriptionId: row?.id ?? '' };
  }

  it('schedules the end without taking the period already paid for', async () => {
    const { buyer, shop, subscriptionId } = await bought(
      'cancel',
      'cancelling',
    );

    const response = await handle(
      signed(
        '/v1/billing/subscriptions/cancellation',
        buyer,
        testConsumerOrigin,
        { body: { subscriptionId }, method: 'POST' },
      ),
    );
    const body = (await response.json()) as {
      subscription: { currentPeriodEnd?: string; state: string };
    };
    await drain();

    expect(response.status).toBe(200);
    expect(body.subscription.state).toBe('cancel_at_period_end');
    expect(body.subscription.currentPeriodEnd).toBeDefined();
    // Access is untouched: they paid for this period.
    const still = await readClub(buyer, shop.handle, shop.handle);
    expect(still.body.content).toHaveLength(1);
    expect(await count('clubs_memberships')).toBe('1');
  });

  it('answers a repeated cancellation with the same state', async () => {
    const { buyer, subscriptionId } = await bought('repeat', 'repeating');
    const send = async () =>
      handle(
        signed(
          '/v1/billing/subscriptions/cancellation',
          buyer,
          testConsumerOrigin,
          { body: { subscriptionId }, method: 'POST' },
        ),
      );
    const [first, second] = await Promise.all([send(), send()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const [row] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_subscriptions`,
    );
    expect(row?.state).toBe('cancel_at_period_end');
  });

  it("refuses somebody else's subscription as though it did not exist", async () => {
    const { subscriptionId } = await bought('other', 'othering');
    const stranger = await consumerSession('stranger@velora.test');

    const response = await handle(
      signed(
        '/v1/billing/subscriptions/cancellation',
        stranger,
        testConsumerOrigin,
        { body: { subscriptionId }, method: 'POST' },
      ),
    );

    expect(response.status).toBe(404);
    const [row] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_subscriptions`,
    );
    expect(row?.state).toBe('active');
  });

  it('withdraws access when the paid period actually runs out', async () => {
    const { buyer, shop, subscriptionId } = await bought('expire', 'expiring');
    await handle(
      signed(
        '/v1/billing/subscriptions/cancellation',
        buyer,
        testConsumerOrigin,
        { body: { subscriptionId }, method: 'POST' },
      ),
    );

    // Nothing is due yet, so the sweep is a no-op rather than an early end.
    expect(await product.billing.subscriptions.expireOnce()).toEqual({
      examined: 0,
      expired: 0,
    });
    expect(await count('clubs_memberships')).toBe('1');

    // The period ends. A stored date rather than a timer, so this is what a
    // month passing looks like.
    // The whole period moves into the past, because the row's own constraint
    // requires the end to follow the start. This is what a month passing looks
    // like to a table whose periods are stored dates rather than timers.
    await execute(
      database.sql`update billing_subscriptions
        set current_period_start = now() - interval '1 month',
            current_period_end = now() - interval '1 minute'`,
    );
    const report = await product.billing.subscriptions.expireOnce();
    await relay.dispatchOnce();

    expect(report).toEqual({ examined: 1, expired: 1 });
    const [row] = await rowsOf<{ cancelled_at: Date | null; state: string }>(
      database.sql`select cancelled_at, state from billing_subscriptions`,
    );
    expect(row?.state).toBe('cancelled');
    expect(row?.cancelled_at).not.toBeNull();

    const gone = await readClub(buyer, shop.handle, shop.handle);
    expect(gone.body.club.membership).toBeUndefined();
    expect(gone.body.content).toEqual([]);
    const [membership] = await rowsOf<{ state: string }>(
      database.sql`select state from clubs_memberships`,
    );
    expect(membership?.state).toBe('revoked');
  });

  it('sweeps the same expiry once however often it runs', async () => {
    const { buyer, subscriptionId } = await bought('sweep', 'sweeping');
    await handle(
      signed(
        '/v1/billing/subscriptions/cancellation',
        buyer,
        testConsumerOrigin,
        { body: { subscriptionId }, method: 'POST' },
      ),
    );
    // The whole period moves into the past, because the row's own constraint
    // requires the end to follow the start. This is what a month passing looks
    // like to a table whose periods are stored dates rather than timers.
    await execute(
      database.sql`update billing_subscriptions
        set current_period_start = now() - interval '1 month',
            current_period_end = now() - interval '1 minute'`,
    );

    await product.billing.subscriptions.expireOnce();
    await product.billing.subscriptions.expireOnce();
    await relay.dispatchOnce();

    // One revocation published, one membership revoked, nothing rewritten.
    const revocations = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_outbox
        where event_name = ${entitlementRevokedEvent}`,
    );
    expect(revocations[0]?.count).toBe('1');
  });

  it('withdraws access on a lapsed renewal and never invents a grace period', async () => {
    const { buyer, shop } = await bought('lapse', 'lapsing');
    const [payment] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_payments`,
    );
    const raw = JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'subscription.past_due',
      providerPaymentReference: payment?.provider_reference ?? '',
    });
    await handle(
      new Request('http://api.test/v1/billing/provider-events', {
        body: raw,
        headers: {
          'content-type': 'application/json',
          'x-velora-test-signature': LocalTestPaymentProvider.signatureFor(raw),
        },
        method: 'POST',
      }),
    );
    await drain();

    const [row] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_subscriptions`,
    );
    expect(row?.state).toBe('past_due');
    // `past_due` grants nothing. Whether a lapsed payment keeps access is
    // policy nobody approved, and the fail-closed reading is no access.
    const gone = await readClub(buyer, shop.handle, shop.handle);
    expect(gone.body.content).toEqual([]);
  });
});

describe('leaving a club', () => {
  it('lets somebody hand back an invitation', async () => {
    const shop = await sellable('invite@velora.test', 'inviting');
    const guest = await consumerSession('invited@velora.test');
    const issued = (await (
      await handle(
        signed('/v1/creator/clubs/invites', shop.studio, testCreatorOrigin, {
          body: { clubId: shop.clubId },
          method: 'POST',
        }),
      )
    ).json()) as { secret: string };
    await handle(
      signed('/v1/clubs/redemptions', guest, testConsumerOrigin, {
        body: { secret: issued.secret },
        method: 'POST',
      }),
    );
    expect(await count('clubs_memberships')).toBe('1');

    const left = await handle(
      signed('/v1/clubs/departures', guest, testConsumerOrigin, {
        body: { clubId: shop.clubId },
        method: 'POST',
      }),
    );
    const body = (await left.json()) as {
      access: { state: string }[];
    };

    expect(left.status).toBe(200);
    // The row stays, ended. Somebody's own history is theirs to see.
    expect(body.access.map((row) => row.state)).toEqual(['revoked']);
    const gone = await readClub(guest, shop.handle, shop.handle);
    expect(gone.body.content).toEqual([]);
  });

  it('refuses to leave a membership somebody is paying for', async () => {
    const shop = await sellable('paid@velora.test', 'paying');
    const buyer = await consumerSession('paidbuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'leave-key');
    await payOnProviderPage(started.providerReference);
    await drain();

    const response = await handle(
      signed('/v1/clubs/departures', buyer, testConsumerOrigin, {
        body: { clubId: shop.clubId },
        method: 'POST',
      }),
    );

    // Ending it here would take access away while the money kept running. The
    // subscription route is where that decision belongs.
    expect(response.status).toBe(409);
    const [membership] = await rowsOf<{ state: string }>(
      database.sql`select state from clubs_memberships`,
    );
    expect(membership?.state).toBe('active');
  });

  it('answers a second departure as though there were nothing to leave', async () => {
    const shop = await sellable('twice@velora.test', 'twicing');
    const guest = await consumerSession('twiceguest@velora.test');
    const issued = (await (
      await handle(
        signed('/v1/creator/clubs/invites', shop.studio, testCreatorOrigin, {
          body: { clubId: shop.clubId },
          method: 'POST',
        }),
      )
    ).json()) as { secret: string };
    await handle(
      signed('/v1/clubs/redemptions', guest, testConsumerOrigin, {
        body: { secret: issued.secret },
        method: 'POST',
      }),
    );
    const leave = async () =>
      handle(
        signed('/v1/clubs/departures', guest, testConsumerOrigin, {
          body: { clubId: shop.clubId },
          method: 'POST',
        }),
      );

    const [first, second] = await Promise.all([leave(), leave()]);
    const statuses = [first.status, second.status].toSorted();

    expect(statuses).toEqual([200, 409]);
    expect(await count('clubs_memberships')).toBe('1');
  });
});

describe('the membership product under attack', () => {
  it('resolves a double-clicked join to one purchase', async () => {
    const shop = await sellable('double-click@velora.test', 'clicking');
    const buyer = await consumerSession('double-clickbuyer@velora.test');
    const submit = async () =>
      handle(
        signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
          body: { currency: 'USD', interval: 'month', offerId: shop.offerId },
          idempotencyKey: 'one-intent',
          method: 'POST',
        }),
      );

    const answers = await Promise.all(
      Array.from({ length: 20 }, async () => submit()),
    );

    // Twenty submissions, one operation. The database admits one, rather than a
    // handler checking first and losing the race.
    expect(answers.every((answer) => answer.status === 201)).toBe(true);
    expect(await count('billing_payments')).toBe('1');
  });

  it('refuses a purchase against a price that was withdrawn', async () => {
    const shop = await sellable('stale@velora.test', 'staling');
    const buyer = await consumerSession('stalebuyer@velora.test');
    const offer = (await (
      await handle(
        signed(
          '/v1/creator/offers?pageSize=50',
          shop.studio,
          testCreatorOrigin,
        ),
      )
    ).json()) as { offers: { id: string; prices: { id: string }[] }[] };
    const priceId = offer.offers[0]?.prices[0]?.id;
    await handle(
      signed(
        '/v1/creator/offers/prices/retirement',
        shop.studio,
        testCreatorOrigin,
        { body: { offerId: shop.offerId, priceId }, method: 'POST' },
      ),
    );

    const response = await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', interval: 'month', offerId: shop.offerId },
        idempotencyKey: 'stale-price',
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
    expect(await count('billing_payments')).toBe('0');
  });

  it('refuses a purchase against a membership taken off sale', async () => {
    const shop = await sellable('pulled@velora.test', 'pulling');
    const buyer = await consumerSession('pulledbuyer@velora.test');
    const offer = (await (
      await handle(
        signed(
          '/v1/creator/offers?pageSize=50',
          shop.studio,
          testCreatorOrigin,
        ),
      )
    ).json()) as { offers: { id: string; version: number }[] };
    await handle(
      signed('/v1/creator/offers/lifecycle', shop.studio, testCreatorOrigin, {
        body: {
          offerId: shop.offerId,
          state: 'retired',
          version: offer.offers[0]?.version,
        },
        method: 'POST',
      }),
    );

    const response = await handle(
      signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
        body: { currency: 'USD', interval: 'month', offerId: shop.offerId },
        idempotencyKey: 'pulled-offer',
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);
  });

  it('closes the feed when the club closes, without touching the money', async () => {
    const shop = await sellable('closing@velora.test', 'closing');
    const buyer = await consumerSession('closingbuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'closing-key');
    await payOnProviderPage(started.providerReference);
    await drain();
    expect(
      (await readClub(buyer, shop.handle, shop.handle)).body.content,
    ).toHaveLength(1);

    const clubs = (await (
      await handle(signed('/v1/creator/clubs', shop.studio, testCreatorOrigin))
    ).json()) as { clubs: { id: string; version: number }[] };
    await handle(
      signed('/v1/creator/clubs/lifecycle', shop.studio, testCreatorOrigin, {
        body: {
          clubId: clubs.clubs[0]?.id,
          lifecycle: 'closed',
          version: clubs.clubs[0]?.version,
        },
        method: 'POST',
      }),
    );

    // The club is gone and so is the address. The subscription is untouched:
    // whether somebody is owed money back is a refund decision with an
    // operator, a reason, and a record, and a club closing is not one.
    const gone = await readClub(buyer, shop.handle, shop.handle);
    expect(gone.status).toBe(404);
    const [subscription] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_subscriptions`,
    );
    expect(subscription?.state).toBe('active');
  });

  it('closes the feed the moment the creator is suspended', async () => {
    const shop = await sellable('suspended@velora.test', 'suspending');
    const buyer = await consumerSession('suspendedbuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'suspend-key');
    await payOnProviderPage(started.providerReference);
    await drain();
    expect(
      (await readClub(buyer, shop.handle, shop.handle)).body.content,
    ).toHaveLength(1);

    await execute(
      database.sql`update creators_accounts
        set status = 'suspended', status_reason = 'safety_enforcement',
            status_changed_at = now()`,
    );

    // Asked again on this read rather than remembered from the last one.
    const gone = await readClub(buyer, shop.handle, shop.handle);
    expect(gone.status).toBe(404);
  });

  it('closes the feed the moment the reader is restricted', async () => {
    const shop = await sellable('restricted@velora.test', 'restricting');
    const buyer = await consumerSession('restrictedbuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'restrict-key');
    await payOnProviderPage(started.providerReference);
    await drain();
    const account = (await (
      await handle(signed('/v1/users/me', buyer, testConsumerOrigin))
    ).json()) as { id: string };

    await execute(
      database.sql`update users_accounts
        set status = 'restricted', status_reason = 'safety_enforcement',
            status_changed_at = now()
        where id = ${account.id}`,
    );

    const gone = await readClub(buyer, shop.handle, shop.handle);
    expect(gone.body.content).toEqual([]);
    expect(gone.body.club.membership).toBeUndefined();
  });

  it('refuses a forged reference on the provider page', async () => {
    await sellable('forged@velora.test', 'forging');

    const response = await payOnProviderPage('lt_not_a_real_reference');

    // The adapter is a fixture and still will not answer questions about which
    // identifiers exist.
    expect(response.status).toBe(404);
    expect(await count('billing_payments')).toBe('0');
  });

  it("never lets one person read another person's subscriptions", async () => {
    const shop = await sellable('mine@velora.test', 'mining');
    const buyer = await consumerSession('minebuyer@velora.test');
    const started = await startCheckout(buyer, shop.offerId, 'mine-key');
    await payOnProviderPage(started.providerReference);
    await drain();
    const stranger = await consumerSession('minestranger@velora.test');

    const body = (await (
      await handle(
        signed('/v1/billing/subscriptions', stranger, testConsumerOrigin),
      )
    ).json()) as { subscriptions: unknown[] };

    expect(body.subscriptions).toEqual([]);
  });
});

describe('the club destination', () => {
  it('is safe to reach by typed address with no session at all', async () => {
    const shop = await sellable('typed@velora.test', 'typing');

    const answer = await readClub(undefined, shop.handle, shop.handle);

    expect(answer.status).toBe(200);
    expect(answer.body.club.benefits).toHaveLength(2);
    expect(answer.body.club.membership).toBeUndefined();
    expect(answer.body.content).toEqual([]);
    expect(JSON.stringify(answer.body)).not.toContain('Only members read this');
  });

  it('answers an unpublished club as though it did not exist', async () => {
    const shop = await sellable('hidden@velora.test', 'hiding');
    const clubs = (await (
      await handle(signed('/v1/creator/clubs', shop.studio, testCreatorOrigin))
    ).json()) as { clubs: { id: string; version: number }[] };
    const club = clubs.clubs[0];
    await handle(
      signed('/v1/creator/clubs/lifecycle', shop.studio, testCreatorOrigin, {
        body: {
          clubId: club?.id,
          lifecycle: 'draft',
          version: club?.version,
        },
        method: 'POST',
      }),
    );

    const answer = await readClub(undefined, shop.handle, shop.handle);

    expect(answer.status).toBe(404);
  });

  it('closes the feed the moment a creator withdraws a member', async () => {
    const shop = await sellable('revoke@velora.test', 'revoking');
    const guest = await consumerSession('revoked@velora.test');
    const issued = (await (
      await handle(
        signed('/v1/creator/clubs/invites', shop.studio, testCreatorOrigin, {
          body: { clubId: shop.clubId },
          method: 'POST',
        }),
      )
    ).json()) as { secret: string };
    await handle(
      signed('/v1/clubs/redemptions', guest, testConsumerOrigin, {
        body: { secret: issued.secret },
        method: 'POST',
      }),
    );
    expect(
      (await readClub(guest, shop.handle, shop.handle)).body.content,
    ).toHaveLength(1);

    const members = (await (
      await handle(
        signed(
          `/v1/creator/clubs/members?clubId=${shop.clubId}`,
          shop.studio,
          testCreatorOrigin,
        ),
      )
    ).json()) as { memberships: { id: string }[] };
    const revoked = await handle(
      signed(
        // The club is named in the address and the membership in the body, so
        // an operator cannot withdraw an entitlement from a club they did not
        // say they were acting on.
        `/v1/creator/clubs/members/revocation?clubId=${shop.clubId}`,
        shop.studio,
        testCreatorOrigin,
        {
          body: { membershipId: members.memberships[0]?.id },
          method: 'POST',
        },
      ),
    );
    expect(revoked.status).toBe(200);

    // No sweep, no cache invalidation, no delay. The next read asks again.
    const after = await readClub(guest, shop.handle, shop.handle);
    expect(after.body.content).toEqual([]);
    expect(after.body.club.membership).toBeUndefined();
  });
});
