import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createBillingRuntime } from '../../src/billing/composition.js';
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
import { money } from '../../src/money/money.js';
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
 * What a creator has earned, and where every figure on that screen comes from.
 *
 * The property that matters is that the payable is the ledger's answer rather
 * than a number computed beside it. A capture credits the creator's own
 * account, a reversal debits it, and the surface reads the balance — so a bug
 * in the split shows up as a payable that disagrees with the sales, and not as
 * money.
 *
 * The second property is separation. Two currencies are two answers and never
 * a third that adds them, and one creator's sales are invisible to another
 * however the identifiers are guessed.
 */

const databaseUrl = await provisionDatabase('velora_billing_earnings');
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
      request.headers.get('x-velora-device') ?? 'earnings-test',
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
  owner: 'earnings-test-relay',
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

interface EarningsBody {
  readonly currencies: {
    readonly currency: string;
    readonly disputed: string;
    readonly gross: string;
    readonly payable: string;
    readonly platform: string;
    readonly reversed: string;
    readonly sources: {
      readonly gross: string;
      readonly reversed: string;
      readonly source: string;
    }[];
    readonly tax: string;
  }[];
  readonly readiness: { readonly enabled: boolean };
}

async function earnings(studio: Session): Promise<EarningsBody> {
  const response = await handle(
    signed('/v1/creator/earnings', studio, testCreatorOrigin),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as EarningsBody;
}

/** The creator payable balance straight from the journal, for comparison. */
async function ledgerPayable(currency: string): Promise<string> {
  const [row] = await rowsOf<{ balance: string }>(
    database.sql`select coalesce(-sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end), 0)::text as balance
      from billing_journal_entries e
      join billing_journal_accounts a on a.id = e.account_id
      where a.category = 'creator_payable' and a.currency = ${currency}`,
  );
  return row?.balance ?? '0';
}

/** The local-test gift catalogue, published for a creator who already exists. */
async function giftCatalogFor(studio: Session): Promise<void> {
  const response = await handle(
    signed('/v1/creator/gifts/catalog/provision', studio, testCreatorOrigin, {
      method: 'POST',
    }),
  );
  expect(response.status).toBe(200);
}

/** A settled virtual gift, returning what it cost. */
async function sentGift(input: {
  readonly buyer: string;
  readonly handle: string;
  readonly key: string;
}): Promise<string> {
  const consumer = await consumerSession(input.buyer);
  const catalogue = (await (
    await handle(
      signed(
        `/v1/billing/gifts/catalog?handle=${input.handle}&currency=USD`,
        consumer,
        testConsumerOrigin,
      ),
    )
  ).json()) as { items: { id: string; price: { amountMinor: string } }[] };
  const item = catalogue.items[0];
  if (item === undefined) throw new Error('the gift catalogue is empty');
  const sent = await handle(
    signed('/v1/billing/gifts', consumer, testConsumerOrigin, {
      body: {
        context: { type: 'creator_profile' },
        currency: 'USD',
        giftItemId: item.id,
        handle: input.handle,
      },
      idempotencyKey: input.key,
      method: 'POST',
    }),
  );
  expect(sent.status).toBe(201);
  expect(((await sent.json()) as { gift: { state: string } }).gift.state).toBe(
    'sent',
  );
  return item.price.amountMinor;
}

describe('what a creator has earned', () => {
  it('reports nothing before anything has settled, and says why', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'nothingyet',
      subject: 'nothingyet@velora.test',
    });
    const body = await earnings(sold.studio);
    // An empty answer rather than a zero for a currency nobody has transacted
    // in. A creator has not "earned zero euros"; they have no euro history.
    expect(body.currencies).toEqual([]);
    expect(body.readiness.enabled).toBe(true);
  });

  it('splits a settled sale between the creator and the platform', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'splitting',
      subject: 'split@velora.test',
    });
    await settledPurchase({
      buyer: 'splitbuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-split',
      offerId: sold.offerId,
    });

    const body = await earnings(sold.studio);
    expect(body.currencies).toEqual([
      {
        currency: 'USD',
        disputed: '0',
        gross: '1500',
        payable: '1200',
        platform: '300',
        reversed: '0',
        // The whole gross again, attributed to the only thing this creator
        // sells. It is a split of `gross` rather than money on top of it.
        sources: [{ gross: '1500', reversed: '0', source: 'club' }],
        // Zero because no tax authority is configured, which is a statement
        // about what Velora withheld rather than about what anybody owes.
        tax: '0',
      },
    ]);
    // The payable the surface reports is the ledger's own balance and not a
    // figure computed beside it.
    expect(await ledgerPayable('USD')).toBe('1200');
  });

  it('keeps two currencies apart and never adds them together', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['EUR', 'USD'],
      slug: 'twocurrency',
      subject: 'twocurrency@velora.test',
    });
    await settledPurchase({
      buyer: 'twobuyer-usd@velora.test',
      currency: 'USD',
      key: 'earnings-key-two-usd',
      offerId: sold.offerId,
    });
    await settledPurchase({
      buyer: 'twobuyer-eur@velora.test',
      currency: 'EUR',
      key: 'earnings-key-two-eur',
      offerId: sold.offerId,
    });

    const body = await earnings(sold.studio);
    // Two answers, in currency order, and no third that sums them: a euro plus
    // a dollar is not an amount, and a creator shown one would plan against it.
    expect(body.currencies.map((row) => row.currency)).toEqual(['EUR', 'USD']);
    expect(body.currencies.map((row) => row.payable)).toEqual(['1200', '1200']);
    expect(await ledgerPayable('EUR')).toBe('1200');
    expect(await ledgerPayable('USD')).toBe('1200');
  });

  it('lowers the payable when part of a sale is returned', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'partialback',
      subject: 'partialback@velora.test',
    });
    const paymentId = await settledPurchase({
      buyer: 'partialbackbuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-partial',
      offerId: sold.offerId,
    });
    const operator = await adminSession();
    await handle(
      signed('/v1/admin/billing/refunds', operator, testAdminOrigin, {
        body: {
          amountMinor: '500',
          currency: 'USD',
          paymentId,
          reasonCode: 'not_delivered',
        },
        idempotencyKey: 'earnings-key-partial-1',
        method: 'POST',
      }),
    );

    const body = await earnings(sold.studio);
    // A third of the charge came back, so a third of each party's claim on it
    // went with it. The creator is not left owed money for a sale that was
    // partly undone.
    expect(body.currencies).toEqual([
      {
        currency: 'USD',
        disputed: '0',
        gross: '1500',
        payable: '800',
        platform: '200',
        reversed: '500',
        sources: [{ gross: '1500', reversed: '500', source: 'club' }],
        tax: '0',
      },
    ]);
    expect(await ledgerPayable('USD')).toBe('800');
  });

  it('leaves nobody owed anything after a sale is fully returned', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'fullback',
      subject: 'fullback@velora.test',
    });
    const paymentId = await settledPurchase({
      buyer: 'fullbackbuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-full',
      offerId: sold.offerId,
    });
    const operator = await adminSession();
    // Two partial reversals rather than one whole, because splitting each one
    // independently is what rounds; the platform share of 1500 is 300, and of
    // 700 and 800 taken separately it would be 140 and 160 — which happens to
    // agree here, so the test also reverses an amount whose fifth is not whole.
    for (const [amountMinor, key] of [
      ['701', 'earnings-key-full-1'],
      ['799', 'earnings-key-full-2'],
    ]) {
      const response = await handle(
        signed('/v1/admin/billing/refunds', operator, testAdminOrigin, {
          body: {
            amountMinor,
            currency: 'USD',
            paymentId,
            reasonCode: 'operator_correction',
          },
          idempotencyKey: key ?? '',
          method: 'POST',
        }),
      );
      expect(response.status).toBe(201);
    }

    const body = await earnings(sold.studio);
    expect(body.currencies).toEqual([
      {
        currency: 'USD',
        disputed: '0',
        gross: '1500',
        // Exactly zero, not one minor unit either side of it. Each reversal is
        // split as the difference between the allocation of the cumulative
        // total and the allocation of what came before, so a series of partial
        // returns cannot leave a residue behind.
        payable: '0',
        platform: '0',
        reversed: '1500',
        sources: [{ gross: '1500', reversed: '1500', source: 'club' }],
        tax: '0',
      },
    ]);
    expect(await ledgerPayable('USD')).toBe('0');
  });

  it('reports a live claim without treating it as money already lost', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'claimed',
      subject: 'claimed@velora.test',
    });
    const paymentId = await settledPurchase({
      buyer: 'claimedbuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-claim',
      offerId: sold.offerId,
    });
    const [payment] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_payments where id = ${paymentId}`,
    );
    await providerEvent({
      dispute: {
        amountMinor: '1500',
        currency: 'USD',
        providerDisputeReference: 'dp_earnings_0001',
        reason: 'fraudulent',
        status: 'opened',
      },
      eventId: crypto.randomUUID(),
      eventType: 'dispute.opened',
      providerPaymentReference: payment?.provider_reference ?? '',
    });
    await drain();

    const body = await earnings(sold.studio);
    const usd = body.currencies[0];
    // The claim is reported, and the payable is untouched: a dispute that is
    // still open has taken nothing from the creator yet, and pretending it had
    // would show a creator money disappearing over an outcome nobody knows.
    expect(usd?.disputed).toBe('1500');
    expect(usd?.reversed).toBe('0');
    expect(usd?.payable).toBe('1200');
  });

  it('withdraws the creator payable when a claim is lost', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'claimlost',
      subject: 'claimlost@velora.test',
    });
    const paymentId = await settledPurchase({
      buyer: 'claimlostbuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-lost',
      offerId: sold.offerId,
    });
    const [payment] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_payments where id = ${paymentId}`,
    );
    for (const status of ['opened', 'lost']) {
      await providerEvent({
        dispute: {
          amountMinor: '1500',
          currency: 'USD',
          providerDisputeReference: 'dp_earnings_lost',
          reason: 'fraudulent',
          status,
        },
        eventId: crypto.randomUUID(),
        eventType: status === 'opened' ? 'dispute.opened' : 'dispute.closed',
        providerPaymentReference: payment?.provider_reference ?? '',
      });
      await drain();
    }

    const body = await earnings(sold.studio);
    expect(body.currencies).toEqual([
      {
        currency: 'USD',
        disputed: '0',
        gross: '1500',
        payable: '0',
        platform: '0',
        reversed: '1500',
        sources: [{ gross: '1500', reversed: '1500', source: 'club' }],
        tax: '0',
      },
    ]);
    expect(await ledgerPayable('USD')).toBe('0');
  });
});

/**
 * The same money, told apart by what was sold.
 *
 * A creator selling club memberships and receiving gifts is running two
 * businesses through one ledger, and "how much of this came from gifts" is a
 * question the records can answer exactly: every payment names the offer it
 * paid for, and every offer names what it sells. What the records cannot
 * answer is how the platform's share or the payable divide between the two,
 * because each of those is one position per creator and currency — so neither
 * is split, here or anywhere.
 */
describe('where a creator’s money came from', () => {
  it('splits one currency between club memberships and gifts', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'twosources',
      subject: 'twosources@velora.test',
    });
    await giftCatalogFor(sold.studio);
    await settledPurchase({
      buyer: 'twosourcesmember@velora.test',
      currency: 'USD',
      key: 'earnings-key-sources-club',
      offerId: sold.offerId,
    });
    const giftMinor = await sentGift({
      buyer: 'twosourcesgifter@velora.test',
      handle: 'twosources',
      key: 'earnings-key-sources-gift',
    });

    const body = await earnings(sold.studio);
    const [row] = body.currencies;
    if (row === undefined) throw new Error('the creator has earned nothing');
    expect(row.sources).toEqual([
      { gross: '1500', reversed: '0', source: 'club' },
      { gross: giftMinor, reversed: '0', source: 'gift' },
    ]);
    // The split is a reading of `gross` rather than an addition to it. If these
    // ever disagree, the surface is showing a creator two different totals for
    // the same money.
    expect(
      row.sources
        .reduce((sum, entry) => sum + BigInt(entry.gross), 0n)
        .toString(),
    ).toBe(row.gross);
    expect(row.gross).toBe((1500n + BigInt(giftMinor)).toString());
    // And nothing else grew a split. The platform's share and the payable are
    // one position each, and apportioning them would be an inference that stops
    // being true the moment a payout moves the payable.
    expect(Object.keys(row).sort()).toEqual([
      'currency',
      'disputed',
      'gross',
      'payable',
      'platform',
      'reversed',
      'sources',
      'tax',
    ]);
  });

  it('attributes a reversal to the thing that was returned', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'returnedsource',
      subject: 'returnedsource@velora.test',
    });
    await giftCatalogFor(sold.studio);
    const paymentId = await settledPurchase({
      buyer: 'returnedmember@velora.test',
      currency: 'USD',
      key: 'earnings-key-return-club',
      offerId: sold.offerId,
    });
    const giftMinor = await sentGift({
      buyer: 'returnedgifter@velora.test',
      handle: 'returnedsource',
      key: 'earnings-key-return-gift',
    });
    const operator = await adminSession();
    await handle(
      signed('/v1/admin/billing/refunds', operator, testAdminOrigin, {
        body: {
          amountMinor: '500',
          currency: 'USD',
          paymentId,
          reasonCode: 'not_delivered',
        },
        idempotencyKey: 'earnings-key-return-refund',
        method: 'POST',
      }),
    );

    const body = await earnings(sold.studio);
    const [row] = body.currencies;
    if (row === undefined) throw new Error('the creator has earned nothing');
    // The refund landed against the membership, so only the membership shows
    // it. A reversal spread across sources would tell a creator gifts were
    // returned that nobody returned.
    expect(row.sources).toEqual([
      { gross: '1500', reversed: '500', source: 'club' },
      { gross: giftMinor, reversed: '0', source: 'gift' },
    ]);
    expect(row.reversed).toBe('500');
  });

  it('omits a source a creator has no history in', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'clubonly',
      subject: 'clubonly@velora.test',
    });
    await settledPurchase({
      buyer: 'clubonlybuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-clubonly',
      offerId: sold.offerId,
    });

    const [row] = (await earnings(sold.studio)).currencies;
    // Absent rather than zero, for the same reason a currency nobody has
    // transacted in is absent: this creator has not "earned nothing from
    // gifts", they have no gift history.
    expect(row?.sources).toEqual([
      { gross: '1500', reversed: '0', source: 'club' },
    ]);
  });

  it('names what was sold on every row of the history', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'sourcedstory',
      subject: 'sourcedstory@velora.test',
    });
    await giftCatalogFor(sold.studio);
    await settledPurchase({
      buyer: 'sourcedmember@velora.test',
      currency: 'USD',
      key: 'earnings-key-story-club',
      offerId: sold.offerId,
    });
    await sentGift({
      buyer: 'sourcedgifter@velora.test',
      handle: 'sourcedstory',
      key: 'earnings-key-story-gift',
    });

    const response = await handle(
      signed(
        '/v1/creator/earnings/history?currency=USD',
        sold.studio,
        testCreatorOrigin,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entries: { kind: string; source: string }[];
    };
    // The offer identifier is already on every row and is a UUID, which tells
    // the creator reading their own history nothing.
    expect(body.entries.map((entry) => entry.source).sort()).toEqual([
      'club',
      'gift',
    ]);
    expect(body.entries.every((entry) => entry.kind === 'capture')).toBe(true);
  });
});

describe('a creator sees their own money and nobody else’s', () => {
  it('never reports another creator’s sales', async () => {
    const first = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'sellerone',
      subject: 'sellerone@velora.test',
    });
    const second = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'sellertwo',
      subject: 'sellertwo@velora.test',
    });
    await settledPurchase({
      buyer: 'onlyonebuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-isolation',
      offerId: first.offerId,
    });

    expect((await earnings(first.studio)).currencies).toHaveLength(1);
    // The second creator has sold nothing, and reads nothing, even though the
    // first creator's sale is in the same tables and the same currency.
    expect((await earnings(second.studio)).currencies).toEqual([]);
  });

  it('refuses a consumer session and an operator session alike', async () => {
    const consumer = await consumerSession('earningsconsumer@velora.test');
    expect(
      (
        await handle(
          signed('/v1/creator/earnings', consumer, testConsumerOrigin),
        )
      ).status,
    ).toBe(403);
    const operator = await adminSession();
    expect(
      (await handle(signed('/v1/creator/earnings', operator, testAdminOrigin)))
        .status,
    ).toBe(403);
  });
});

describe('the history of what happened', () => {
  it('returns captures, reversals, and claims as one sequence', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'storyline',
      subject: 'storyline@velora.test',
    });
    const paymentId = await settledPurchase({
      buyer: 'storylinebuyer@velora.test',
      currency: 'USD',
      key: 'earnings-key-history',
      offerId: sold.offerId,
    });
    const operator = await adminSession();
    await handle(
      signed('/v1/admin/billing/refunds', operator, testAdminOrigin, {
        body: {
          amountMinor: '500',
          currency: 'USD',
          paymentId,
          reasonCode: 'not_delivered',
        },
        idempotencyKey: 'earnings-key-history-1',
        method: 'POST',
      }),
    );

    const response = await handle(
      signed(
        '/v1/creator/earnings/history?currency=USD',
        sold.studio,
        testCreatorOrigin,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      currency: string;
      entries: { amount: { amountMinor: string }; kind: string }[];
    };
    expect(body.currency).toBe('USD');
    // Newest first, and one list rather than three: reading a purchase and its
    // reversal from separate places makes a sequence nobody can line up.
    expect(body.entries.map((entry) => entry.kind)).toEqual([
      'refund',
      'capture',
    ]);
    expect(body.entries.map((entry) => entry.amount.amountMinor)).toEqual([
      '500',
      '1500',
    ]);
  });

  it('requires a currency rather than choosing one', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'nocurrency',
      subject: 'nocurrency@velora.test',
    });
    // Defaulting would pick one of a creator's currencies for them and show it
    // as though it were all of their money.
    expect(
      (
        await handle(
          signed(
            '/v1/creator/earnings/history',
            sold.studio,
            testCreatorOrigin,
          ),
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await handle(
          signed(
            '/v1/creator/earnings/history?currency=ZZZ',
            sold.studio,
            testCreatorOrigin,
          ),
        )
      ).status,
    ).toBe(422);
  });

  it('pages by keyset and never repeats or skips an entry', async () => {
    const sold = await seller({
      amountMinor: '1500',
      currencies: ['USD'],
      slug: 'paging',
      subject: 'paging@velora.test',
    });
    for (let index = 0; index < 5; index += 1) {
      await settledPurchase({
        buyer: `pagingbuyer${String(index)}@velora.test`,
        currency: 'USD',
        key: `earnings-key-paging-${String(index)}`,
        offerId: sold.offerId,
      });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const path = `/v1/creator/earnings/history?currency=USD&pageSize=2${
        cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`
      }`;
      const response = await handle(
        signed(path, sold.studio, testCreatorOrigin),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        entries: { id: string }[];
        nextCursor?: string;
      };
      seen.push(...body.entries.map((entry) => entry.id));
      cursor = body.nextCursor;
      if (cursor === undefined) break;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});

describe('a deployed environment reports no earnings capability', () => {
  it('answers that monetisation is not enabled, and can allocate nothing', () => {
    // The configuration a deployed environment is forced to carry. Staging and
    // production reject any other value, so this is what the earnings surface
    // meets there.
    const deployed = createBillingRuntime({
      config: testServerConfig(),
      consumerContext: users.consumerContext,
      consumers: users.adultStanding,
      creatorContext: product.creators.creatorContext,
      creators: product.creators.directory,
      database: database.drizzle,
      resources: product.clubs.commercialDirectory,
    });
    expect(deployed.policy.currencies()).toEqual([]);
    // No split exists, so a capture cannot be divided and no payable can be
    // created. That is the honest state of a platform with no published fee and
    // no published revenue share, rather than a percentage nobody approved.
    expect(deployed.policy.allocate(money(1500n, 'USD'))).toBeUndefined();
  });
});
