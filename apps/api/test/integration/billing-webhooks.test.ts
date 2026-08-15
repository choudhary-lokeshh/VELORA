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
 * Verified provider events, subscriptions, and the entitlement bridge.
 *
 * What this suite exists to prove is that an external message becomes internal
 * state only through one door, and that the door holds under everything a real
 * provider does: sending an event five times, sending them out of order,
 * replaying an old one, and sending one signed by nobody.
 *
 * The bridge is the other half. BILLING publishes a commercial fact and
 * PRIVATE CLUBS decides what it means for access, so the assertions run against
 * `clubs_memberships` — the table BILLING must never be able to write — and the
 * only thing that put a row there is a relay draining an outbox.
 */

const databaseUrl = await provisionDatabase('velora_billing_webhooks');
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
      request.headers.get('x-velora-device') ?? 'webhook-test',
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
const provider = product.billing.provider as LocalTestPaymentProvider;
const handle = (request: Request) => application.app.handle(request);

/**
 * The relay the worker runs, built here over the same database.
 *
 * The consumers are the real ones. A test that substituted them would prove
 * that BILLING published something, which is the uninteresting half.
 */
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
  owner: 'webhook-test-relay',
  sources: [
    {
      producer: 'billing',
      repository: new OutboxRepository(database.drizzle, billingOutbox),
    },
  ],
});

/** Applies every verified event and publishes everything they produced. */
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

interface Sellable {
  readonly clubId: string;
  readonly offerId: string;
}

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
  return { clubId: clubRow.id, offerId: offer.offer.id };
}

interface Purchase {
  readonly paymentId: string;
  readonly providerReference: string;
}

async function purchase(
  buyer: Session,
  offerId: string,
  key: string,
): Promise<Purchase> {
  const response = await handle(
    signed('/v1/billing/checkouts', buyer, testConsumerOrigin, {
      body: { currency: 'USD', offerId },
      idempotencyKey: key,
      method: 'POST',
    }),
  );
  const body = (await response.json()) as { payment: { id: string } };
  const [row] = await rowsOf<{ provider_reference: string }>(
    database.sql`select provider_reference from billing_payments where id = ${body.payment.id}`,
  );
  return {
    paymentId: body.payment.id,
    providerReference: row?.provider_reference ?? '',
  };
}

/** Posts a signed provider event, exactly as a provider would. */
async function providerEvent(
  event: Readonly<Record<string, unknown>>,
  options: { readonly signature?: string } = {},
): Promise<Response> {
  const raw = JSON.stringify(event);
  return handle(
    new Request('http://api.test/v1/billing/provider-events', {
      body: raw,
      headers: {
        'content-type': 'application/json',
        [localTestSignatureHeader]:
          options.signature ?? LocalTestPaymentProvider.signatureFor(raw),
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

describe('provider event intake', () => {
  it('refuses an unsigned or wrongly signed event and writes nothing', async () => {
    for (const signature of ['', 'not-a-signature', 'a'.repeat(64)]) {
      const response = await providerEvent(
        { eventId: crypto.randomUUID(), eventType: 'payment.succeeded' },
        { signature },
      );
      expect(response.status).toBe(401);
    }
    // Nothing about a failed verification is durable. Writing it would let
    // anybody fill this table by posting nonsense at an unauthenticated
    // endpoint.
    expect(await count('billing_provider_events')).toBe('0');
  });

  it('refuses an oversized body before reading it as anything', async () => {
    const raw = JSON.stringify({
      eventId: crypto.randomUUID(),
      eventType: 'payment.succeeded',
      padding: 'x'.repeat(70_000),
    });
    const response = await handle(
      new Request('http://api.test/v1/billing/provider-events', {
        body: raw,
        headers: {
          'content-type': 'application/json',
          // A valid signature, so the refusal is provably about size rather
          // than about verification.
          [localTestSignatureHeader]:
            LocalTestPaymentProvider.signatureFor(raw),
        },
        method: 'POST',
      }),
    );
    expect(response.status).toBe(413);
    expect(await count('billing_provider_events')).toBe('0');
  });

  it('records one receipt however many times an event is delivered', async () => {
    const eventId = crypto.randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 50 }, async () =>
        providerEvent({ eventId, eventType: 'payment.succeeded' }),
      ),
    );
    // Every delivery is acknowledged identically. A provider that got a
    // different answer for a redelivery would learn which events Velora had
    // already seen.
    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(await count('billing_provider_events')).toBe('1');
  });
});

describe('the entitlement bridge', () => {
  it('grants club access only after a verified settlement, through the outbox', async () => {
    const { clubId, offerId } = await sellable('seller@velora.test', 'selling');
    const buyer = await consumerSession('buyer@velora.test');
    const bought = await purchase(buyer, offerId, 'webhook-key-0001');

    // A payment that is merely pending grants nothing, however many times
    // anybody drains.
    await drain();
    expect(await count('clubs_memberships')).toBe('0');

    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'payment.succeeded',
      providerPaymentReference: bought.providerReference,
      status: 'succeeded',
    });
    await drain();

    const memberships = await rowsOf<{ source: string; state: string }>(
      database.sql`select source, state from clubs_memberships`,
    );
    expect(memberships).toEqual([{ source: 'billing', state: 'active' }]);

    // The money, the subscription, and the accounting all landed with it.
    const [payment] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_payments where id = ${bought.paymentId}`,
    );
    expect(payment?.state).toBe('succeeded');
    expect(await count('billing_subscriptions')).toBe('1');
    expect(await count('billing_journal_transactions')).toBe('1');
    expect(clubId).toBeDefined();
  });

  it('stays at one membership, one subscription, and one posting under redelivery', async () => {
    const { offerId } = await sellable('repeat@velora.test', 'repeating');
    const buyer = await consumerSession('repeatbuyer@velora.test');
    const bought = await purchase(buyer, offerId, 'webhook-key-repeat');

    // Fifty distinct events, all saying the same thing. A provider does this.
    for (let index = 0; index < 50; index += 1) {
      await providerEvent({
        eventId: crypto.randomUUID(),
        eventType: 'payment.succeeded',
        providerPaymentReference: bought.providerReference,
        status: 'succeeded',
      });
    }
    await drain();
    await drain();

    expect(await count('clubs_memberships')).toBe('1');
    expect(await count('billing_subscriptions')).toBe('1');
    // One business event, one journal transaction, whatever arrives.
    expect(await count('billing_journal_transactions')).toBe('1');
    const [balance] = await rowsOf<{ total: string }>(
      database.sql`select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0)::text as total
        from billing_journal_entries`,
    );
    expect(balance?.total).toBe('0');
  });

  it('revokes on cancellation and is not resurrected by a late success', async () => {
    const { offerId } = await sellable('cancel@velora.test', 'cancelling');
    const buyer = await consumerSession('cancelbuyer@velora.test');
    const bought = await purchase(buyer, offerId, 'webhook-key-cancel');
    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'payment.succeeded',
      providerPaymentReference: bought.providerReference,
      status: 'succeeded',
    });
    await drain();
    expect(await count('clubs_memberships')).toBe('1');

    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'subscription.cancelled',
      providerPaymentReference: bought.providerReference,
    });
    await drain();
    const afterCancel = await rowsOf<{ state: string }>(
      database.sql`select state from clubs_memberships`,
    );
    expect(afterCancel).toEqual([{ state: 'revoked' }]);

    // The case the flow document names specifically: a settlement event
    // arriving after a cancellation must not restore access.
    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'payment.succeeded',
      providerPaymentReference: bought.providerReference,
      status: 'succeeded',
    });
    await drain();
    await drain();
    const afterLate = await rowsOf<{ state: string }>(
      database.sql`select state from clubs_memberships`,
    );
    expect(afterLate).toEqual([{ state: 'revoked' }]);
    const [subscription] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_subscriptions`,
    );
    expect(subscription?.state).toBe('cancelled');
  });

  it('leaves a creator invitation alone when a commercial reversal arrives', async () => {
    const { clubId, offerId } = await sellable('mixed@velora.test', 'mixing');
    const buyer = await consumerSession('mixedbuyer@velora.test');
    const bought = await purchase(buyer, offerId, 'webhook-key-mixed');
    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'payment.succeeded',
      providerPaymentReference: bought.providerReference,
      status: 'succeeded',
    });
    await drain();

    // Rewrite the one live membership to look like a creator invitation, which
    // is the state somebody who was invited and then also subscribed would be
    // left in once the commercial one was withdrawn.
    await execute(
      database.sql`update clubs_memberships set source = 'creator_invite' where club_id = ${clubId}`,
    );
    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'subscription.cancelled',
      providerPaymentReference: bought.providerReference,
    });
    await drain();

    // The money ending is not the creator changing their mind.
    const rows = await rowsOf<{ source: string; state: string }>(
      database.sql`select source, state from clubs_memberships`,
    );
    expect(rows).toEqual([{ source: 'creator_invite', state: 'active' }]);
  });

  it('ignores an event for an object it has no record of', async () => {
    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'payment.succeeded',
      providerPaymentReference: 'lt_nothing_here',
      status: 'succeeded',
    });
    await drain();
    const [row] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_provider_events`,
    );
    // Recorded as seen with nothing to do, rather than retried forever or
    // dropped. Inventing a payment from a webhook would be taking a provider's
    // word for the existence of a purchase.
    expect(row?.state).toBe('ignored');
    expect(await count('clubs_memberships')).toBe('0');
  });
});

describe('the database enforces the event and subscription invariants', () => {
  it('keeps a verified receipt as evidence and retains every row', async () => {
    await providerEvent({
      eventId: 'evidence-event-0001',
      eventType: 'payment.succeeded',
      providerPaymentReference: 'lt_evidence',
    });
    for (const statement of [
      database.sql`update billing_provider_events set payload_digest = repeat('a', 64)`,
      database.sql`update billing_provider_events set provider_event_id = 'rewritten'`,
      database.sql`update billing_provider_events set occurred_at = now()`,
      database.sql`delete from billing_provider_events`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }
    const [row] = await rowsOf<{ provider_event_id: string }>(
      database.sql`select provider_event_id from billing_provider_events`,
    );
    expect(row?.provider_event_id).toBe('evidence-event-0001');
  });

  it('permits one live subscription per consumer and offer', async () => {
    const { offerId } = await sellable('unique@velora.test', 'uniquesub');
    const buyer = await consumerSession('uniquebuyer@velora.test');
    const bought = await purchase(buyer, offerId, 'webhook-key-unique');
    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'payment.succeeded',
      providerPaymentReference: bought.providerReference,
      status: 'succeeded',
    });
    await drain();

    const [row] = await rowsOf<{
      consumer_id: string;
      currency: string;
      offer_id: string;
      price_id: string;
    }>(
      database.sql`select consumer_id, currency, offer_id, price_id from billing_subscriptions`,
    );
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into billing_subscriptions
            (amount_minor, consumer_id, created_at, currency, current_period_end, current_period_start,
             id, offer_id, origin_payment_id, price_id, provider, state, updated_at, version)
            values (1500, ${row?.consumer_id ?? ''}, now(), ${row?.currency ?? 'USD'},
                    now() + interval '30 days', now(), ${crypto.randomUUID()},
                    ${row?.offer_id ?? ''}, ${bought.paymentId}, ${row?.price_id ?? ''},
                    'local-test', 'active', now(), 1)`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses an entitling subscription with no paid period', async () => {
    const { offerId } = await sellable('period@velora.test', 'periodic');
    const buyer = await consumerSession('periodbuyer@velora.test');
    const bought = await purchase(buyer, offerId, 'webhook-key-period');
    const [price] = await rowsOf<{ price_id: string }>(
      database.sql`select price_id from billing_payments where id = ${bought.paymentId}`,
    );
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into billing_subscriptions
            (amount_minor, consumer_id, created_at, currency, id, offer_id, origin_payment_id,
             price_id, provider, state, updated_at, version)
            values (1500, ${crypto.randomUUID()}, now(), 'USD', ${crypto.randomUUID()},
                    ${offerId}, ${bought.paymentId}, ${price?.price_id ?? ''},
                    'local-test', 'active', now(), 1)`,
        ),
      ),
    ).toBe(true);
  });
});
