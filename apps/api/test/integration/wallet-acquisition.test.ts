import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import type {
  CoinPackListResponse,
  WalletStateResponse,
} from '@velora/validation';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import {
  entitlementGrantedEvent,
  entitlementRevokedEvent,
} from '../../src/billing/entitlement-events.js';
import { LocalTestPaymentProvider } from '../../src/billing/local-test-provider.js';
import { localTestSignatureHeader } from '../../src/billing/local-test-provider.js';
import { billingOutbox } from '../../src/billing/schema.js';
import { OutboxRelay } from '../../src/events/relay.js';
import { OutboxRepository } from '../../src/events/outbox.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { createWalletRuntime } from '../../src/wallet/composition.js';
import { localTestCoinProduct } from '../../src/wallet/acquisition.js';
import { walletEntitlementIntakes } from '../../src/wallet/entitlement-intake.js';
import {
  coinPackOffers,
  publishPlatformCoinPacks,
} from '../../src/wallet/provisioning.js';
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
 * Buying coins, through the two channels that can ever sell them.
 *
 * The whole point of this suite is the one property both channels share and
 * neither can be trusted to have on its own: **one real purchase mints coins
 * once**. A provider redelivers, a client retries, a webhook and a client
 * confirmation race, a store replays a token after a reinstall — every one of
 * those is a normal event, and every one of them must leave the balance where
 * a single purchase left it.
 *
 * The second property is the one that is easy to lose while adding the first.
 * A coin pack is VELORA's own product: settling one must credit no creator
 * payable, publish no revenue fact, and appear in nobody's earnings — because
 * the money is not theirs and telling PAYOUTS otherwise would be a liability
 * invented out of a sale a creator had no part in.
 *
 * Nothing is stubbed that money passes through. The payment is the real
 * checkout against the local provider, the settlement is a real signed provider
 * event through the real verified inbox, the entitlement fact travels the real
 * outbox, and the credit is the real ledger with its own triggers.
 */

const databaseUrl = await provisionDatabase('velora_wallet_acquisition');
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
  WALLET_ANDROID_ACQUISITION: 'local-test',
  WALLET_COIN_LEDGER: 'enabled',
  WALLET_WEB_ACQUISITION: 'local-test',
});

const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'acquisition-test',
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
const wallet = createWalletRuntime({
  config,
  consumerContext: users.consumerContext,
  database: database.drizzle,
  logger,
  // The same assembly the application performs, from the same three domains.
  packs: (userId: string) =>
    coinPackOffers({
      consumers: users.adultStanding,
      eligibility: product.billing.eligibility,
      now: () => new Date(),
      offers: product.billing.offerRepository,
      userId,
    }),
  profiles: users.directory,
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
    wallet,
  },
});
const provider = product.billing.provider as LocalTestPaymentProvider;
const handle = (request: Request) => application.app.handle(request);

/**
 * The relay the worker runs, with WALLET's own consumers.
 *
 * The real ones. A test that substituted them would prove BILLING published
 * something, which is the uninteresting half of a seam whose whole purpose is
 * that the two domains never call each other.
 */
const relay = new OutboxRelay({
  consumers: walletEntitlementIntakes({
    grantedEvent: entitlementGrantedEvent,
    logger,
    revokedEvent: entitlementRevokedEvent,
    wallet: wallet.service,
  }),
  logger,
  now: () => new Date(),
  owner: 'acquisition-test-relay',
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
  // The platform publishes its own packs at every start, and this is that.
  await publishPlatformCoinPacks({
    now: () => new Date(),
    offers: product.billing.offerRepository,
  });
});

interface Session {
  readonly cookie: string;
  readonly csrf: string;
}

async function consumer(subject: string, region = 'ES'): Promise<Session> {
  const response = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'consumer_web', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testConsumerOrigin,
        'x-velora-device': subject,
      },
      method: 'POST',
    }),
  );
  const body = (await response.json()) as { csrfToken: string };
  const actor: Session = {
    cookie: response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0] ?? '')
      .filter((pair) => pair.length > 0)
      .join('; '),
    csrf: body.csrfToken,
  };
  await handle(signed('/v1/users', actor, { method: 'POST' }));
  await handle(
    signed('/v1/users/me/onboarding/adult-declaration', actor, {
      body: { declaresAdult: true, region },
      method: 'POST',
    }),
  );
  return actor;
}

function signed(
  path: string,
  actor: Session,
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
      origin: testConsumerOrigin,
      'x-velora-csrf': actor.csrf,
      ...(init.idempotencyKey === undefined
        ? {}
        : { 'x-velora-idempotency-key': init.idempotencyKey }),
    },
  });
}

async function packs(actor: Session): Promise<CoinPackListResponse> {
  const response = await handle(signed('/v1/wallet/coin-packs', actor));
  expect(response.status).toBe(200);
  return (await response.json()) as CoinPackListResponse;
}

async function balance(actor: Session): Promise<string> {
  const response = await handle(signed('/v1/wallet', actor));
  expect(response.status).toBe(200);
  return (
    ((await response.json()) as WalletStateResponse).balance?.available ?? '0'
  );
}

async function buy(
  actor: Session,
  offerId: string,
  key: string,
): Promise<string> {
  const response = await handle(
    signed('/v1/billing/checkouts', actor, {
      body: { currency: 'EUR', offerId },
      idempotencyKey: key,
      method: 'POST',
    }),
  );
  expect(response.status).toBe(201);
  const body = (await response.json()) as { payment: { id: string } };
  const [row] = await rowsOf<{ provider_reference: string }>(
    database.sql`select provider_reference from billing_payments where id = ${body.payment.id}`,
  );
  return row?.provider_reference ?? '';
}

/** Posts a signed provider event, exactly as a provider would. */
async function settle(providerReference: string): Promise<Response> {
  const raw = JSON.stringify({
    eventId: crypto.randomUUID(),
    eventType: 'payment.succeeded',
    providerPaymentReference: providerReference,
    status: 'succeeded',
  });
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

async function count(table: string): Promise<string> {
  const rows = await rowsOf<{ count: string }>(
    database.sql.unsafe(`select count(*)::text as count from ${table}`),
  );
  return rows[0]?.count ?? '0';
}

describe('the platform sells its own coin packs, as its own', () => {
  it('publishes packs nobody owns, priced, and idempotently', async () => {
    // Run again. Publishing is idempotent, so a process that restarts twice
    // does not accumulate offers or prices.
    await publishPlatformCoinPacks({
      now: () => new Date(),
      offers: product.billing.offerRepository,
    });

    const rows = await rowsOf<{ creator_id: string | null; owner: string }>(
      database.sql`select creator_id, owner_type as owner from billing_offers
                   where resource_type = 'coins'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Nobody's but VELORA's. A creator identifier here would be a stranger's
      // name on a sale they had no part in.
      expect(row.owner).toBe('platform');
      expect(row.creator_id).toBeNull();
    }
    expect(await count('billing_prices')).toBe(String(rows.length));

    const actor = await consumer('packs@wallet.test');
    const published = await packs(actor);
    expect(published.channel).toBe('local-test');
    expect(published.packs.length).toBe(rows.length);
    for (const pack of published.packs) {
      expect(Number(pack.coins)).toBeGreaterThan(0);
      expect(Number(pack.price.amountMinor)).toBeGreaterThan(0);
    }
    // Nothing is shut for this buyer, so the answer is an empty list of gates
    // rather than an absent one — "no reason not to" and "nothing to evaluate"
    // are different answers.
    expect(published.gates).toEqual([]);
    // No badge, no saving, no comparison. A shape that could hold one is a
    // shape somebody eventually fills in.
    const serialized = JSON.stringify(published);
    for (const claim of ['bestValue', 'saving', 'popular', 'discount']) {
      expect(serialized, claim).not.toContain(claim);
    }
  });

  it('says which gate is shut rather than offering a purchase that fails', async () => {
    // A country the local commerce authority has not approved. The packs are
    // still published — they exist — and the gate says why this person cannot
    // buy one, which is what stops a surface offering a control that refuses
    // with a message about the state of their account.
    const elsewhere = await consumer('gated@wallet.test', 'IN');
    const published = await packs(elsewhere);
    expect(published.channel).toBe('local-test');
    expect(published.gates).toContain('consumer_country');
    expect(published.packs.length).toBeGreaterThan(0);
  });

  it('refuses to let a creator sell coins, at the database', async () => {
    const refused = await database.sql`
      insert into billing_offers
        (id, created_at, updated_at, version, state, owner_type, creator_id,
         resource_id, resource_type, commercial_mode)
      values
        (gen_random_uuid(), now(), now(), 1, 'draft', 'creator',
         gen_random_uuid(), gen_random_uuid(), 'coins', 'one_time')
    `
      .then(() => false)
      .catch(() => true);
    expect(refused).toBe(true);
  });
});

describe('a Web purchase mints coins exactly once', () => {
  it('credits the pack the platform named, once, after a verified settlement', async () => {
    const actor = await consumer('web-buy@wallet.test');
    const published = await packs(actor);
    const pack = published.packs[0];
    expect(pack).toBeDefined();

    const reference = await buy(actor, pack?.offerId ?? '', 'coins-key-0001');
    // A payment that is merely pending credits nothing, however many times
    // anybody drains.
    await drain();
    expect(await balance(actor)).toBe('0');

    expect((await settle(reference)).status).toBe(202);
    await drain();
    expect(await balance(actor)).toBe(pack?.coins ?? '');
    expect(await count('wallet_acquisitions')).toBe('1');
  });

  it('stays at one credit under a provider that redelivers five times', async () => {
    const actor = await consumer('web-redeliver@wallet.test');
    const published = await packs(actor);
    const pack = published.packs[0];
    const reference = await buy(actor, pack?.offerId ?? '', 'coins-key-0002');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await settle(reference)).status).toBe(202);
      await drain();
    }
    // Five deliveries, one credit. The acquisition row's unique index over
    // channel and reference is what settles it, rather than a prior read every
    // delivery would pass.
    expect(await balance(actor)).toBe(pack?.coins ?? '');
    expect(await count('wallet_acquisitions')).toBe('1');
  });

  it('stays at one credit when the same fact is dispatched repeatedly', async () => {
    const actor = await consumer('web-replay@wallet.test');
    const published = await packs(actor);
    const pack = published.packs[0];
    const reference = await buy(actor, pack?.offerId ?? '', 'coins-key-0003');
    await settle(reference);
    await drain();

    // The relay is at-least-once by design. Draining the same fact again is
    // the normal case, not a fault, and it must change nothing.
    await relay.dispatchOnce();
    await relay.dispatchOnce();
    expect(await balance(actor)).toBe(pack?.coins ?? '');
    expect(await count('wallet_acquisitions')).toBe('1');
  });

  it('owes no creator anything for the platform’s own sale', async () => {
    const actor = await consumer('web-revenue@wallet.test');
    const published = await packs(actor);
    const reference = await buy(
      actor,
      published.packs[0]?.offerId ?? '',
      'coins-key-0004',
    );
    await settle(reference);
    await drain();

    // The money landed, and all of it is the platform's. A creator payable
    // here would be a liability invented out of a sale nobody made.
    const entries = await rowsOf<{ category: string; subject: string | null }>(
      database.sql`select a.category, a.subject_id as subject
                   from billing_journal_entries e
                   join billing_journal_accounts a on a.id = e.account_id`,
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.category).not.toBe('creator_payable');
      if (entry.category === 'platform_revenue') {
        // Platform-scoped, not creator-scoped. A creator-scoped position would
        // put VELORA's own product into somebody's earnings view.
        expect(entry.subject).toBeNull();
      }
    }
    // And PAYOUTS is told nothing, because there is nothing to tell it.
    const facts = await rowsOf<{ event_name: string }>(
      database.sql`select event_name from billing_outbox`,
    );
    expect(facts.map((fact) => fact.event_name)).not.toContain(
      'billing.revenue.settled',
    );
  });

  it('ignores a commercial fact about a product this domain does not sell', async () => {
    const actor = await consumer('web-foreign@wallet.test');
    // A fact naming a resource WALLET does not know. It is ignored rather than
    // failed: treating somebody else's event as an error here would make every
    // future resource type an outage in this consumer.
    await database.sql`
      insert into billing_outbox
        (id, attempts, available_at, created_at, updated_at, event_name,
         event_version, occurred_at, payload, state, subject_id, subject_type)
      values (gen_random_uuid(), 0, now(), now(), now(),
              ${entitlementGrantedEvent}, 1, now(),
              ${JSON.stringify({
                commercialReference: crypto.randomUUID(),
                consumerId: crypto.randomUUID(),
                resourceId: crypto.randomUUID(),
                resourceType: 'coins',
              })}::jsonb,
              'pending', gen_random_uuid(), 'billing.payment')
    `;
    await relay.dispatchOnce();
    expect(await balance(actor)).toBe('0');
    expect(await count('wallet_acquisitions')).toBe('0');
  });
});

describe('an Android purchase mints coins exactly once, and only when proved', () => {
  const token = 'local-test-purchase-0a1b2c3d4e5f6789';

  it('credits a verified purchase once, however many times it is submitted', async () => {
    const actor = await consumer('play-once@wallet.test');
    const redeem = async () =>
      handle(
        signed('/v1/wallet/android-purchases', actor, {
          body: {
            productReference: localTestCoinProduct,
            purchaseToken: token,
          },
          method: 'POST',
        }),
      );

    expect((await redeem()).status).toBe(200);
    const credited = await balance(actor);
    expect(Number(credited)).toBeGreaterThan(0);

    // A reinstall replaying the token, and two devices racing it.
    const again = await Promise.all([redeem(), redeem(), redeem()]);
    for (const response of again) expect(response.status).toBe(200);
    expect(await balance(actor)).toBe(credited);
    expect(await count('wallet_acquisitions')).toBe('1');
  });

  it('mints nothing for a purchase the store never confirmed', async () => {
    const actor = await consumer('play-forged@wallet.test');
    for (const attempt of [
      // A token this platform never issued.
      {
        productReference: localTestCoinProduct,
        purchaseToken: 'i-bought-this',
      },
      // A product this platform does not sell.
      { productReference: 'velora.coins.free', purchaseToken: token },
      // The client saying what it is worth, which the shape cannot express.
      {
        coins: '100000',
        productReference: localTestCoinProduct,
        purchaseToken: token,
      },
    ]) {
      const response = await handle(
        signed('/v1/wallet/android-purchases', actor, {
          body: attempt,
          method: 'POST',
        }),
      );
      expect([409, 422], JSON.stringify(attempt)).toContain(response.status);
    }
    expect(await balance(actor)).toBe('0');
    expect(await count('wallet_acquisitions')).toBe('0');
  });

  it('keeps the two channels’ purchase identities apart', async () => {
    const actor = await consumer('play-namespace@wallet.test');
    const published = await packs(actor);
    const pack = published.packs[0];
    const reference = await buy(actor, pack?.offerId ?? '', 'coins-key-0005');
    await settle(reference);
    await drain();
    const afterWeb = Number(await balance(actor));

    await handle(
      signed('/v1/wallet/android-purchases', actor, {
        body: { productReference: localTestCoinProduct, purchaseToken: token },
        method: 'POST',
      }),
    );
    // Two real purchases through two channels are two credits. A store token
    // and a payment identifier are different namespaces, and collapsing them
    // would make one purchase silently swallow the other.
    expect(Number(await balance(actor))).toBeGreaterThan(afterWeb);
    expect(await count('wallet_acquisitions')).toBe('2');
    const channels = await rowsOf<{ channel: string }>(
      database.sql`select channel from wallet_acquisitions order by channel`,
    );
    expect(channels.map((row) => row.channel)).toEqual(['android', 'web']);
  });
});
