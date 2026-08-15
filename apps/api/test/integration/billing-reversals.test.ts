import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createBillingRuntime } from '../../src/billing/composition.js';
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
  testAdminOrigin,
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * Reversals: refunds, disputes, and what both do to the books and to access.
 *
 * The properties this suite exists to prove are the ones that only break under
 * simultaneity and only matter about money.
 *
 * **Nothing over-refunds.** Fifty operators asking to reverse one charge at the
 * same instant return it once, and they do so because PostgreSQL serialized
 * them rather than because a handler looked first.
 *
 * **Nothing rewrites history.** A reversal is a new balanced transaction beside
 * the capture, never an edit of it, and the assertions run against the tables
 * directly so a rule the service upholds is not mistaken for a rule the
 * database enforces.
 *
 * **Nothing invents an outcome.** A provider whose answer was lost leaves a
 * reversal waiting, with its amount still reserved, and no second instruction
 * under a new key.
 *
 * **Nothing consumer-facing exists.** There is no refund route a consumer can
 * reach, because refund eligibility is unresolved commercial policy; what
 * exists is an operator path that a deployed environment refuses twice over.
 */

const databaseUrl = await provisionDatabase('velora_billing_reversals');
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
      request.headers.get('x-velora-device') ?? 'reversal-test',
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
  owner: 'reversal-test-relay',
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

/**
 * A Platform Admin session, written directly.
 *
 * The local identity adapter cannot mint Admin authority: ADR-0017 requires a
 * phishing-resistant authenticator and none is approved. A suite that needs an
 * operator therefore writes the session it is testing the rules around, which is
 * the same reason the refund route is unreachable in a deployed environment.
 */
async function adminSession(
  assurance: 'phishing_resistant' | 'single_factor' = 'phishing_resistant',
  establishedAt: Date = new Date(),
): Promise<Session> {
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
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', ${assurance}, ${establishedAt},
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

interface Sellable {
  readonly clubId: string;
  readonly offerId: string;
}

/** A published creator with an active, priced, subscription offer. */
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

interface Settled {
  readonly consumer: Session;
  readonly paymentId: string;
  readonly providerReference: string;
}

/** A consumer who has bought and paid for access, verified end to end. */
async function settledPurchase(input: {
  readonly buyer: string;
  readonly key: string;
  readonly offerId: string;
}): Promise<Settled> {
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
  const providerReference = row?.provider_reference ?? '';
  await providerEvent({
    eventId: crypto.randomUUID(),
    eventType: 'payment.succeeded',
    providerPaymentReference: providerReference,
    status: 'succeeded',
  });
  await drain();
  return { consumer, paymentId: body.payment.id, providerReference };
}

/** An operator asking for a reversal, exactly as Platform Admin would. */
async function requestRefund(
  operator: Session,
  body: Readonly<Record<string, unknown>>,
  key: string,
): Promise<Response> {
  return handle(
    signed('/v1/admin/billing/refunds', operator, testAdminOrigin, {
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

/** Debits minus credits across the whole book. Always zero, or the book is wrong. */
async function journalImbalance(): Promise<string> {
  const [row] = await rowsOf<{ total: string }>(
    database.sql`select coalesce(sum(case when direction = 'debit' then amount_minor else -amount_minor end), 0)::text as total
      from billing_journal_entries`,
  );
  return row?.total ?? '0';
}

async function refundedTotal(paymentId: string): Promise<string> {
  const [row] = await rowsOf<{ total: string }>(
    database.sql`select coalesce(sum(amount_minor), 0)::text as total
      from billing_refunds where payment_id = ${paymentId} and state <> 'failed'`,
  );
  return row?.total ?? '0';
}

/** A cardholder claim as the provider reports it, opened or resolved. */
const claimFor = (input: {
  readonly paymentReference: string;
  readonly reference: string;
  readonly status: string;
}) => ({
  dispute: {
    amountMinor: '1500',
    currency: 'USD',
    providerDisputeReference: input.reference,
    reason: 'fraudulent',
    status: input.status,
  },
  eventId: crypto.randomUUID(),
  eventType: input.status === 'opened' ? 'dispute.opened' : 'dispute.closed',
  providerPaymentReference: input.paymentReference,
});

describe('who may reverse a charge', () => {
  it('offers no consumer-facing refund path at all', async () => {
    const { offerId } = await sellable(
      'noselfserve@velora.test',
      'noselfserve',
    );
    const bought = await settledPurchase({
      buyer: 'noselfbuyer@velora.test',
      key: 'reversal-key-noself',
      offerId,
    });
    // The consumer surface has no refund operation. A consumer session
    // presented at the operator route is refused for being the wrong audience,
    // and there is nothing else for them to call: refund eligibility is
    // unresolved commercial policy, so a self-service control would be a
    // commercial promise nobody approved.
    const response = await requestRefund(
      bought.consumer,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-noself-1',
    );
    expect(response.status).toBe(403);
    expect(await count('billing_refunds')).toBe('0');
  });

  it('refuses an operator who has not proved a phishing-resistant factor', async () => {
    const { offerId } = await sellable('stepup@velora.test', 'stepup');
    const bought = await settledPurchase({
      buyer: 'stepupbuyer@velora.test',
      key: 'reversal-key-stepup',
      offerId,
    });
    const body = {
      amountMinor: '1500',
      currency: 'USD',
      paymentId: bought.paymentId,
      reasonCode: 'duplicate_charge',
    };

    // No session at all.
    expect(
      (
        await handle(
          new Request('http://api.test/v1/admin/billing/refunds', {
            body: JSON.stringify(body),
            headers: {
              'content-type': 'application/json',
              origin: testAdminOrigin,
              'x-velora-idempotency-key': 'reversal-key-stepup-a',
            },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(401);

    // An operator, but a weaker authenticator than ADR-0017 requires.
    const weak = await adminSession('single_factor');
    expect(
      (await requestRefund(weak, body, 'reversal-key-stepup-b')).status,
    ).toBe(403);

    // An operator whose phishing-resistant assurance has gone stale. Being an
    // operator is not enough; the assurance has to be recent.
    const stale = await adminSession(
      'phishing_resistant',
      new Date(Date.now() - 24 * 60 * 60 * 1000),
    );
    expect(
      (await requestRefund(stale, body, 'reversal-key-stepup-c')).status,
    ).toBe(403);

    expect(await count('billing_refunds')).toBe('0');
  });

  it('requires an idempotency key before it will record anything', async () => {
    const { offerId } = await sellable('nokey@velora.test', 'nokey');
    const bought = await settledPurchase({
      buyer: 'nokeybuyer@velora.test',
      key: 'reversal-key-nokey',
      offerId,
    });
    const operator = await adminSession();
    const response = await handle(
      signed('/v1/admin/billing/refunds', operator, testAdminOrigin, {
        body: {
          amountMinor: '1500',
          currency: 'USD',
          paymentId: bought.paymentId,
          reasonCode: 'duplicate_charge',
        },
        method: 'POST',
      }),
    );
    // Without a key a double-submitted reversal is two reversals, and the
    // server has nothing to recognise the second by.
    expect(response.status).toBe(422);
    expect(await count('billing_refunds')).toBe('0');
  });
});

describe('a reversal and its accounting', () => {
  it('posts a compensating transaction and leaves the capture untouched', async () => {
    const { offerId } = await sellable('compensate@velora.test', 'compensate');
    const bought = await settledPurchase({
      buyer: 'compensatebuyer@velora.test',
      key: 'reversal-key-compensate',
      offerId,
    });
    const operator = await adminSession();

    const response = await requestRefund(
      operator,
      {
        amountMinor: '500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'not_delivered',
      },
      'reversal-key-compensate-1',
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      refund: { amount: { amountMinor: string }; state: string };
    };
    expect(body.refund.state).toBe('succeeded');
    expect(body.refund.amount.amountMinor).toBe('500');

    // The capture is exactly as it was. A refund is a new financial event, not
    // an edit of the one it reverses.
    const [payment] = await rowsOf<{ amount_minor: string; state: string }>(
      database.sql`select amount_minor::text as amount_minor, state
        from billing_payments where id = ${bought.paymentId}`,
    );
    expect(payment).toEqual({ amount_minor: '1500', state: 'succeeded' });

    // Two transactions: the capture and its compensation, each balanced, and
    // the capture's own entries unchanged.
    const postings = await rowsOf<{ business_type: string; reason: string }>(
      database.sql`select business_type, reason from billing_journal_transactions
        order by reason`,
    );
    expect(postings).toEqual([
      { business_type: 'billing.payment', reason: 'payment_captured' },
      { business_type: 'billing.refund', reason: 'refund_issued' },
    ]);
    expect(await journalImbalance()).toBe('0');

    // Every claim the sale created is withdrawn in the proportion it was
    // created in. A fifth of the charge was the platform's share under the test
    // policy, so a third of that share comes back out with the third of the
    // charge that was returned — and the creator's payable falls with it, which
    // is the only reading under which a refunded sale leaves nobody owed for it.
    const balances = await rowsOf<{ balance: string; category: string }>(
      database.sql`select a.category,
          sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end)::text as balance
        from billing_journal_entries e
        join billing_journal_accounts a on a.id = e.account_id
        group by a.category order by a.category`,
    );
    expect(balances).toEqual([
      { balance: '-800', category: 'creator_payable' },
      { balance: '-200', category: 'platform_revenue' },
      { balance: '1000', category: 'provider_clearing' },
    ]);
  });

  it('answers a duplicate request with the reversal it already made', async () => {
    const { offerId } = await sellable('duplicate@velora.test', 'duplicating');
    const bought = await settledPurchase({
      buyer: 'duplicatebuyer@velora.test',
      key: 'reversal-key-duplicate',
      offerId,
    });
    const operator = await adminSession();
    const body = {
      amountMinor: '1500',
      currency: 'USD',
      paymentId: bought.paymentId,
      reasonCode: 'duplicate_charge',
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, async () =>
        requestRefund(operator, body, 'reversal-key-duplicate-same'),
      ),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    // One key, one reversal, one posting, whatever arrives.
    expect(await count('billing_refunds')).toBe('1');
    expect(await refundedTotal(bought.paymentId)).toBe('1500');
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(1);
    expect(await journalImbalance()).toBe('0');
  });

  it('refuses the same key used for a different amount', async () => {
    const { offerId } = await sellable('mismatch@velora.test', 'mismatching');
    const bought = await settledPurchase({
      buyer: 'mismatchbuyer@velora.test',
      key: 'reversal-key-mismatch',
      offerId,
    });
    const operator = await adminSession();
    const first = await requestRefund(
      operator,
      {
        amountMinor: '500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'operator_correction',
      },
      'reversal-key-mismatch-1',
    );
    expect(first.status).toBe(201);
    const second = await requestRefund(
      operator,
      {
        amountMinor: '900',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'operator_correction',
      },
      'reversal-key-mismatch-1',
    );
    // Not a replay: a different instruction wearing a used key. Answering it
    // with the old reversal would return the wrong amount.
    expect(second.status).toBe(409);
    expect(await refundedTotal(bought.paymentId)).toBe('500');
  });
});

describe('nothing returns more than was taken', () => {
  it('refuses a partial reversal that would exceed the capture', async () => {
    const { offerId } = await sellable('exceed@velora.test', 'exceeding');
    const bought = await settledPurchase({
      buyer: 'exceedbuyer@velora.test',
      key: 'reversal-key-exceed',
      offerId,
    });
    const operator = await adminSession();
    const partial = async (amountMinor: string, key: string) =>
      requestRefund(
        operator,
        {
          amountMinor,
          currency: 'USD',
          paymentId: bought.paymentId,
          reasonCode: 'operator_correction',
        },
        key,
      );

    expect((await partial('1000', 'reversal-key-exceed-1')).status).toBe(201);
    expect((await partial('500', 'reversal-key-exceed-2')).status).toBe(201);
    // Exactly the captured amount is now returned, and the next minor unit is
    // one too many.
    expect((await partial('1', 'reversal-key-exceed-3')).status).toBe(409);
    expect(await refundedTotal(bought.paymentId)).toBe('1500');
    expect(await journalImbalance()).toBe('0');
  });

  it('returns one capture once under fifty simultaneous full reversals', async () => {
    const { offerId } = await sellable('storm@velora.test', 'storming');
    const bought = await settledPurchase({
      buyer: 'stormbuyer@velora.test',
      key: 'reversal-key-storm',
      offerId,
    });
    const operator = await adminSession();

    // Fifty distinct keys, so nothing here is deduplicated by idempotency. What
    // stops the second one is the bound itself, taken under a lock on the
    // capture: without it every caller would read a total of zero and every
    // caller would decide there was room.
    const responses = await Promise.all(
      Array.from({ length: 50 }, async (_unused, index) =>
        requestRefund(
          operator,
          {
            amountMinor: '1500',
            currency: 'USD',
            paymentId: bought.paymentId,
            reasonCode: 'duplicate_charge',
          },
          `reversal-key-storm-${String(index).padStart(4, '0')}`,
        ),
      ),
    );
    const issued = responses.filter((response) => response.status === 201);
    const refusedRequests = responses.filter(
      (response) => response.status === 409,
    );
    expect(issued).toHaveLength(1);
    expect(refusedRequests).toHaveLength(49);

    expect(await count('billing_refunds')).toBe('1');
    expect(await refundedTotal(bought.paymentId)).toBe('1500');
    expect(await journalImbalance()).toBe('0');
    const [clearing] = await rowsOf<{ balance: string }>(
      database.sql`select sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end)::text as balance
        from billing_journal_entries e
        join billing_journal_accounts a on a.id = e.account_id
        where a.category = 'provider_clearing'`,
    );
    expect(clearing?.balance).toBe('0');
  });

  it('refuses a reversal in a currency the charge was not taken in', async () => {
    const { offerId } = await sellable('currency@velora.test', 'currencies');
    const bought = await settledPurchase({
      buyer: 'currencybuyer@velora.test',
      key: 'reversal-key-currency',
      offerId,
    });
    const operator = await adminSession();
    const response = await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'EUR',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-currency-1',
    );
    // A EUR reversal of a USD charge would balance perfectly inside its own
    // transaction and mean nothing.
    expect(response.status).toBe(409);
    expect(await count('billing_refunds')).toBe('0');
  });

  it('refuses to reverse a charge that never settled', async () => {
    const { offerId } = await sellable('unsettled@velora.test', 'unsettling');
    const consumer = await consumerSession('unsettledbuyer@velora.test');
    const started = await handle(
      signed('/v1/billing/checkouts', consumer, testConsumerOrigin, {
        body: { currency: 'USD', offerId },
        idempotencyKey: 'reversal-key-unsettled',
        method: 'POST',
      }),
    );
    const body = (await started.json()) as { payment: { id: string } };
    const operator = await adminSession();
    const response = await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: body.payment.id,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-unsettled-1',
    );
    // Reversing an unsettled charge would be a claim about a movement of money
    // that never happened.
    expect(response.status).toBe(409);
    expect(await count('billing_refunds')).toBe('0');
  });
});

describe('an ambiguous provider answer', () => {
  it('leaves the reversal waiting, still reserved, and posts nothing', async () => {
    const { offerId } = await sellable('ambiguous@velora.test', 'ambiguities');
    const bought = await settledPurchase({
      buyer: 'ambiguousbuyer@velora.test',
      key: 'reversal-key-ambiguous',
      offerId,
    });
    const operator = await adminSession();
    provider.refundBehaveAs('ambiguous');

    const response = await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-ambiguous-1',
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { refund: { state: string } };
    // Neither issued nor refused. The provider may have moved the money and the
    // answer was lost, and guessing either way is how a platform returns money
    // twice or tells somebody they were repaid when they were not.
    expect(body.refund.state).toBe('reconciliation_pending');

    // Nothing is accounted for, because nothing is known.
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(0);
    // The amount stays reserved against the capture, so nothing else can claim
    // it while the question is open.
    expect(await refundedTotal(bought.paymentId)).toBe('1500');
    provider.refundBehaveAs('normal');
    const second = await requestRefund(
      operator,
      {
        amountMinor: '1',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-ambiguous-2',
    );
    expect(second.status).toBe(409);
  });

  it('settles a pending reversal from the verified event that confirms it', async () => {
    const { offerId } = await sellable('late@velora.test', 'lateness');
    const bought = await settledPurchase({
      buyer: 'latebuyer@velora.test',
      key: 'reversal-key-late',
      offerId,
    });
    const operator = await adminSession();
    // The ordinary case at several real providers: the instruction is accepted
    // and an object is created, and whether the money moved is confirmed later.
    provider.refundBehaveAs('pending');
    const response = await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-late-1',
    );
    const started = (await response.json()) as { refund: { state: string } };
    expect(started.refund.state).toBe('provider_pending');
    // Nothing is accounted for while it is merely accepted. A posting made on
    // acceptance would be a movement of money nobody has confirmed.
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(0);

    const [pending] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_refunds`,
    );
    await providerEvent({
      amountMinor: '1500',
      currency: 'USD',
      eventId: crypto.randomUUID(),
      eventType: 'refund.succeeded',
      providerRefundReference: pending?.provider_reference ?? '',
    });
    await drain();

    const [settled] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_refunds`,
    );
    expect(settled?.state).toBe('succeeded');
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(1);
    expect(await journalImbalance()).toBe('0');
  });

  it('leaves an unmatched reversal event to reconciliation rather than guessing', async () => {
    const { offerId } = await sellable('unmatched@velora.test', 'unmatching');
    const bought = await settledPurchase({
      buyer: 'unmatchedbuyer@velora.test',
      key: 'reversal-key-unmatched',
      offerId,
    });
    const operator = await adminSession();
    provider.refundBehaveAs('ambiguous');
    await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-unmatched-1',
    );
    const [waiting] = await rowsOf<{
      provider_idempotency_key: string;
      provider_reference: string | null;
      state: string;
    }>(
      database.sql`select provider_idempotency_key, provider_reference, state
        from billing_refunds`,
    );
    // The answer was lost, so Velora never learned which object the provider
    // created. That is what makes it unmatchable from the event alone.
    expect(waiting?.state).toBe('reconciliation_pending');
    expect(waiting?.provider_reference).toBeNull();

    const recorded = provider.refundFor(
      waiting?.provider_idempotency_key ?? '',
    );
    await providerEvent({
      amountMinor: '1500',
      currency: 'USD',
      eventId: crypto.randomUUID(),
      eventType: 'refund.succeeded',
      providerRefundReference: recorded?.providerReference ?? '',
    });
    await drain();

    // Recorded as seen with nothing to do. Attaching a reversal to a provider
    // object Velora never recorded would be taking a provider's word for which
    // instruction it acted on; resolving it means asking the provider about the
    // key Velora sent, which is reconciliation's job rather than the inbox's.
    const [event] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_provider_events
        where event_type = 'refund.succeeded'`,
    );
    expect(event?.state).toBe('ignored');
    const [unchanged] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_refunds`,
    );
    expect(unchanged?.state).toBe('reconciliation_pending');
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(0);
  });

  it('posts once however many times a reversal confirmation is redelivered', async () => {
    const { offerId } = await sellable('replay@velora.test', 'replaying');
    const bought = await settledPurchase({
      buyer: 'replaybuyer@velora.test',
      key: 'reversal-key-replay',
      offerId,
    });
    const operator = await adminSession();
    await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-replay-1',
    );
    const [row] = await rowsOf<{ provider_reference: string }>(
      database.sql`select provider_reference from billing_refunds`,
    );
    for (let index = 0; index < 20; index += 1) {
      await providerEvent({
        amountMinor: '1500',
        currency: 'USD',
        eventId: crypto.randomUUID(),
        eventType: 'refund.succeeded',
        providerRefundReference: row?.provider_reference ?? '',
      });
    }
    await drain();
    await drain();

    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'refund_issued'`,
      ),
    ).toHaveLength(1);
    expect(await journalImbalance()).toBe('0');
  });
});

describe('what a reversal does to access', () => {
  it('withdraws access when the whole charge is returned', async () => {
    const { offerId } = await sellable('revoke@velora.test', 'revoking');
    const bought = await settledPurchase({
      buyer: 'revokebuyer@velora.test',
      key: 'reversal-key-revoke',
      offerId,
    });
    expect(await count('clubs_memberships')).toBe('1');

    const operator = await adminSession();
    await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'not_delivered',
      },
      'reversal-key-revoke-1',
    );
    await drain();

    // Access follows the money out through the same door it came in: BILLING
    // publishes a fact and PRIVATE CLUBS applies its own policy to it.
    const memberships = await rowsOf<{ source: string; state: string }>(
      database.sql`select source, state from clubs_memberships`,
    );
    expect(memberships).toEqual([{ source: 'billing', state: 'revoked' }]);
  });

  it('leaves access alone when only part of the charge is returned', async () => {
    const { offerId } = await sellable('partial@velora.test', 'partially');
    const bought = await settledPurchase({
      buyer: 'partialbuyer@velora.test',
      key: 'reversal-key-partial',
      offerId,
    });
    const operator = await adminSession();
    await requestRefund(
      operator,
      {
        amountMinor: '400',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'operator_correction',
      },
      'reversal-key-partial-1',
    );
    await drain();

    // Withdrawing access for part of a reversal would be a commercial term
    // nobody has approved.
    const memberships = await rowsOf<{ state: string }>(
      database.sql`select state from clubs_memberships`,
    );
    expect(memberships).toEqual([{ state: 'active' }]);
  });

  it('reverses a charge whose subscription was already cancelled', async () => {
    const { offerId } = await sellable('after@velora.test', 'afterwards');
    const bought = await settledPurchase({
      buyer: 'afterbuyer@velora.test',
      key: 'reversal-key-after',
      offerId,
    });
    await providerEvent({
      eventId: crypto.randomUUID(),
      eventType: 'subscription.cancelled',
      providerPaymentReference: bought.providerReference,
    });
    await drain();

    const operator = await adminSession();
    const response = await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'not_delivered',
      },
      'reversal-key-after-1',
    );
    // A cancelled relationship does not make the money unreturnable. The
    // capture settled, so it can be reversed.
    expect(response.status).toBe(201);
    await drain();
    expect(await refundedTotal(bought.paymentId)).toBe('1500');
    expect(await journalImbalance()).toBe('0');
  });
});

describe('disputes', () => {
  it('records the withholding when a claim opens, and leaves access alone', async () => {
    const { offerId } = await sellable('dispute@velora.test', 'disputing');
    const bought = await settledPurchase({
      buyer: 'disputebuyer@velora.test',
      key: 'reversal-key-dispute',
      offerId,
    });
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_open_0001',
        status: 'opened',
      }),
    );
    await drain();

    const disputes = await rowsOf<{
      amount_minor: string;
      reason_code: string;
      state: string;
    }>(
      database.sql`select amount_minor::text as amount_minor, reason_code, state from billing_disputes`,
    );
    expect(disputes).toEqual([
      { amount_minor: '1500', reason_code: 'fraudulent', state: 'opened' },
    ]);

    // The provider has taken the money out of Velora's position pending the
    // outcome. That is a real movement and it is posted when the claim opens.
    const postings = await rowsOf<{ reason: string }>(
      database.sql`select reason from billing_journal_transactions order by reason`,
    );
    expect(postings).toEqual([
      { reason: 'dispute_opened' },
      { reason: 'payment_captured' },
    ]);
    expect(await journalImbalance()).toBe('0');

    // Whether somebody keeps what they bought while a claim is live is
    // unresolved commercial policy, so nothing is withdrawn.
    expect(
      await rowsOf<{ state: string }>(
        database.sql`select state from clubs_memberships`,
      ),
    ).toEqual([{ state: 'active' }]);
  });

  it('stops that consumer starting anything new while a claim is live', async () => {
    const { offerId } = await sellable(
      'newcommerce@velora.test',
      'newcommerce',
    );
    const bought = await settledPurchase({
      buyer: 'newcommercebuyer@velora.test',
      key: 'reversal-key-newcommerce',
      offerId,
    });
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_block_0001',
        status: 'opened',
      }),
    );
    await drain();

    const second = await sellable('newcommerce2@velora.test', 'newcommerce2');
    const response = await handle(
      signed('/v1/billing/checkouts', bought.consumer, testConsumerOrigin, {
        body: { currency: 'USD', offerId: second.offerId },
        idempotencyKey: 'reversal-key-newcommerce-2',
        method: 'POST',
      }),
    );
    // New commercial access fails closed. It withdraws nothing they hold and
    // commits Velora to nothing further while their bank is reversing the last
    // payment.
    expect(response.status).toBe(403);
  });

  it('records one claim however many times the provider sends it', async () => {
    const { offerId } = await sellable('dupdispute@velora.test', 'dupdisputes');
    const bought = await settledPurchase({
      buyer: 'dupdisputebuyer@velora.test',
      key: 'reversal-key-dupdispute',
      offerId,
    });
    for (let index = 0; index < 20; index += 1) {
      await providerEvent(
        claimFor({
          paymentReference: bought.providerReference,
          reference: 'dp_duplicate_0001',
          status: 'opened',
        }),
      );
    }
    await drain();
    await drain();

    expect(await count('billing_disputes')).toBe('1');
    expect(
      await rowsOf(
        database.sql`select 1 from billing_journal_transactions where reason = 'dispute_opened'`,
      ),
    ).toHaveLength(1);
    expect(await journalImbalance()).toBe('0');
  });

  it('unwinds the sale when a claim is lost, and withdraws access', async () => {
    const { offerId } = await sellable('lost@velora.test', 'losing');
    const bought = await settledPurchase({
      buyer: 'lostbuyer@velora.test',
      key: 'reversal-key-lost',
      offerId,
    });
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_lost_0001',
        status: 'opened',
      }),
    );
    await drain();
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_lost_0001',
        status: 'lost',
      }),
    );
    await drain();

    const [dispute] = await rowsOf<{
      resolved_at: string | null;
      state: string;
    }>(database.sql`select resolved_at, state from billing_disputes`);
    expect(dispute?.state).toBe('lost');
    expect(dispute?.resolved_at).not.toBeNull();

    // The money went to the cardholder, so the sale did not survive it: every
    // position the capture touched is back at zero.
    const balances = await rowsOf<{ balance: string; category: string }>(
      database.sql`select a.category,
          sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end)::text as balance
        from billing_journal_entries e
        join billing_journal_accounts a on a.id = e.account_id
        group by a.category order by a.category`,
    );
    expect(balances).toEqual([
      { balance: '0', category: 'creator_payable' },
      { balance: '0', category: 'disputes' },
      { balance: '0', category: 'platform_revenue' },
      { balance: '0', category: 'provider_clearing' },
    ]);
    expect(await journalImbalance()).toBe('0');
    expect(
      await rowsOf<{ state: string }>(
        database.sql`select state from clubs_memberships`,
      ),
    ).toEqual([{ state: 'revoked' }]);
  });

  it('returns the money and leaves the sale standing when a claim is won', async () => {
    const { offerId } = await sellable('won@velora.test', 'winning');
    const bought = await settledPurchase({
      buyer: 'wonbuyer@velora.test',
      key: 'reversal-key-won',
      offerId,
    });
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_won_0001',
        status: 'opened',
      }),
    );
    await drain();
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_won_0001',
        status: 'won',
      }),
    );
    await drain();

    const balances = await rowsOf<{ balance: string; category: string }>(
      database.sql`select a.category,
          sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end)::text as balance
        from billing_journal_entries e
        join billing_journal_accounts a on a.id = e.account_id
        group by a.category order by a.category`,
    );
    expect(balances).toEqual([
      { balance: '-1200', category: 'creator_payable' },
      { balance: '0', category: 'disputes' },
      { balance: '-300', category: 'platform_revenue' },
      { balance: '1500', category: 'provider_clearing' },
    ]);
    expect(
      await rowsOf<{ state: string }>(
        database.sql`select state from clubs_memberships`,
      ),
    ).toEqual([{ state: 'active' }]);
  });

  it('survives a resolution that arrives before the opening', async () => {
    const { offerId } = await sellable('reorder@velora.test', 'reordering');
    const bought = await settledPurchase({
      buyer: 'reorderbuyer@velora.test',
      key: 'reversal-key-reorder',
      offerId,
    });

    // The outcome first. Discarding it for want of an opening still in flight
    // would lose a movement of money that has already happened.
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_reorder_0001',
        status: 'won',
      }),
    );
    await drain();
    const [afterClose] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_disputes`,
    );
    expect(afterClose?.state).toBe('won');

    // The opening arrives afterwards and must not reopen what is settled.
    await providerEvent(
      claimFor({
        paymentReference: bought.providerReference,
        reference: 'dp_reorder_0001',
        status: 'opened',
      }),
    );
    await drain();
    const [afterOpen] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_disputes`,
    );
    expect(afterOpen?.state).toBe('won');

    // Both legs are still posted exactly once, and the book balances.
    const postings = await rowsOf<{ reason: string }>(
      database.sql`select reason from billing_journal_transactions order by reason`,
    );
    expect(postings).toEqual([
      { reason: 'dispute_opened' },
      { reason: 'dispute_resolved' },
      { reason: 'payment_captured' },
    ]);
    expect(await journalImbalance()).toBe('0');
  });

  it('ignores a claim whose amount disagrees with the capture', async () => {
    const { offerId } = await sellable('overclaim@velora.test', 'overclaiming');
    const bought = await settledPurchase({
      buyer: 'overclaimbuyer@velora.test',
      key: 'reversal-key-overclaim',
      offerId,
    });
    await providerEvent({
      dispute: {
        amountMinor: '9999',
        currency: 'USD',
        providerDisputeReference: 'dp_over_0001',
        reason: 'fraudulent',
        status: 'opened',
      },
      eventId: crypto.randomUUID(),
      eventType: 'dispute.opened',
      providerPaymentReference: bought.providerReference,
    });
    await drain();

    // Recorded as seen with nothing to do. A dispute Velora cannot reconcile
    // against its own record is not evidence of anything, and accounting for it
    // would put a number nobody agreed to in the books.
    const [event] = await rowsOf<{ state: string }>(
      database.sql`select state from billing_provider_events
        where event_type = 'dispute.opened'`,
    );
    expect(event?.state).toBe('ignored');
    expect(await count('billing_disputes')).toBe('0');
    expect(await journalImbalance()).toBe('0');
  });
});

/**
 * Two ways of undoing one sale, arriving together.
 *
 * A refund and a lost claim both return money that has already been counted,
 * and they travel different paths: one is an operator asking BILLING, the other
 * is a bank telling it. The bound they share is the capture, and nothing about
 * either path reads the other's intent — so the only thing that can hold the
 * bound is what they both write against.
 */
describe('a capture claimed back by two routes at once', () => {
  it('never returns more than was taken, however the two interleave', async () => {
    const { offerId } = await sellable('bothways@velora.test', 'bothways');
    const bought = await settledPurchase({
      buyer: 'bothwaysbuyer@velora.test',
      key: 'reversal-key-bothways',
      offerId,
    });
    const operator = await adminSession();

    // Ten operator reversals of a fifth of the charge each — twice what the
    // capture holds — against a bank taking the whole of it back at the same
    // moment.
    const attempts = Array.from({ length: 10 }, async (_unused, index) =>
      requestRefund(
        operator,
        {
          amountMinor: '300',
          currency: 'USD',
          paymentId: bought.paymentId,
          reasonCode: 'duplicate_charge',
        },
        `reversal-key-bothways-${String(index)}`,
      ),
    );
    const claimed = (async () => {
      await providerEvent(
        claimFor({
          paymentReference: bought.providerReference,
          reference: 'dp_bothways_0001',
          status: 'opened',
        }),
      );
      await providerEvent(
        claimFor({
          paymentReference: bought.providerReference,
          reference: 'dp_bothways_0001',
          status: 'lost',
        }),
      );
      await drain();
    })();
    await Promise.all([...attempts, claimed]);
    await drain();

    // The two claims together may well exceed the charge, and that is not a
    // defect: a consumer can be refunded in full and their bank can still take
    // the same money back, and the platform is genuinely out both. What must
    // not happen is the creator being charged for it twice.
    const [unwound] = await rowsOf<{ total: string }>(
      database.sql`select (
        coalesce((select sum(amount_minor) from billing_refunds
                   where payment_id = ${bought.paymentId} and state <> 'failed'), 0)
        + coalesce((select sum(amount_minor) from billing_disputes
                     where payment_id = ${bought.paymentId} and state = 'lost'), 0)
      )::text as total`,
    );
    expect(BigInt(unwound?.total ?? '0') > 0n).toBe(true);

    // What the creator was actually charged for. The sale credited them 1200,
    // so nothing may take more than that back out of their earnings however
    // many claims arrive — the rest is a platform loss, absorbed against
    // platform revenue rather than against somebody who already earned it.
    const [clawedBack] = await rowsOf<{ total: string }>(
      database.sql`select coalesce(sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end), 0)::text as total
         from billing_journal_entries e
         join billing_journal_accounts a on a.id = e.account_id
        where a.category = 'creator_payable'`,
    );
    expect(BigInt(clawedBack?.total ?? '0') <= 0n).toBe(true);

    // The book still balances, and the platform never handed a creator more
    // than the sale put there.
    expect(await journalImbalance()).toBe('0');
    const owed = await rowsOf<{ balance: string }>(
      database.sql`select sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end)::text as balance
         from billing_journal_entries e
         join billing_journal_accounts a on a.id = e.account_id
        where a.category = 'creator_payable'
        group by a.id
       having sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end) > 0`,
    );
    expect(owed).toHaveLength(0);
  });
});

describe('the database enforces the reversal invariants', () => {
  it('refuses a reversal that would exceed the capture, written directly', async () => {
    const { offerId } = await sellable('sqlbound@velora.test', 'sqlbounding');
    const bought = await settledPurchase({
      buyer: 'sqlboundbuyer@velora.test',
      key: 'reversal-key-sqlbound',
      offerId,
    });
    const insert = (amountMinor: number, key: string) =>
      database.sql`insert into billing_refunds
        (amount_minor, created_at, currency, id, idempotency_key, initiated_by,
         payment_id, provider, provider_idempotency_key, reason_code, state, updated_at, version)
        values (${amountMinor}, now(), 'USD', ${crypto.randomUUID()}, ${key},
                'session:direct', ${bought.paymentId}, 'local-test',
                ${`direct-${key}`}, 'operator_correction', 'requested', now(), 1)`;
    // The bound is the database's, not the service's. A caller that never went
    // near the service is refused just the same.
    await execute(insert(1500, 'direct-key-0001'));
    expect(
      await refused(async () => execute(insert(1, 'direct-key-0002'))),
    ).toBe(true);
  });

  it('refuses a reversal in another currency, written directly', async () => {
    const { offerId } = await sellable(
      'sqlcurrency@velora.test',
      'sqlcurrency',
    );
    const bought = await settledPurchase({
      buyer: 'sqlcurrencybuyer@velora.test',
      key: 'reversal-key-sqlcurrency',
      offerId,
    });
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into billing_refunds
            (amount_minor, created_at, currency, id, idempotency_key, initiated_by,
             payment_id, provider, provider_idempotency_key, reason_code, state, updated_at, version)
            values (100, now(), 'EUR', ${crypto.randomUUID()}, 'direct-key-eur01',
                    'session:direct', ${bought.paymentId}, 'local-test',
                    'direct-key-eur01-p', 'operator_correction', 'requested', now(), 1)`,
        ),
      ),
    ).toBe(true);
  });

  it('freezes what a reversal means and retains every row', async () => {
    const { offerId } = await sellable('frozen@velora.test', 'freezing');
    const bought = await settledPurchase({
      buyer: 'frozenbuyer@velora.test',
      key: 'reversal-key-frozen',
      offerId,
    });
    const operator = await adminSession();
    await requestRefund(
      operator,
      {
        amountMinor: '500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'operator_correction',
      },
      'reversal-key-frozen-1',
    );
    for (const statement of [
      database.sql`update billing_refunds set amount_minor = 1500`,
      database.sql`update billing_refunds set currency = 'EUR'`,
      database.sql`update billing_refunds set initiated_by = 'session:somebody-else'`,
      database.sql`update billing_refunds set reason_code = 'not_delivered'`,
      database.sql`update billing_refunds set idempotency_key = 'rewritten-key'`,
      database.sql`update billing_refunds set provider_reference = 'lt_somewhere_else'`,
      database.sql`delete from billing_refunds`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }
    const [row] = await rowsOf<{ amount_minor: string; reason_code: string }>(
      database.sql`select amount_minor::text as amount_minor, reason_code from billing_refunds`,
    );
    expect(row).toEqual({
      amount_minor: '500',
      reason_code: 'operator_correction',
    });
  });

  it('keeps the capture and its posting immutable after a reversal', async () => {
    const { offerId } = await sellable('immutable@velora.test', 'immutably');
    const bought = await settledPurchase({
      buyer: 'immutablebuyer@velora.test',
      key: 'reversal-key-immutable',
      offerId,
    });
    const operator = await adminSession();
    await requestRefund(
      operator,
      {
        amountMinor: '1500',
        currency: 'USD',
        paymentId: bought.paymentId,
        reasonCode: 'duplicate_charge',
      },
      'reversal-key-immutable-1',
    );
    for (const statement of [
      database.sql`update billing_payments set amount_minor = 0 where id = ${bought.paymentId}`,
      database.sql`update billing_payments set currency = 'EUR' where id = ${bought.paymentId}`,
      database.sql`update billing_payments set provider_reference = 'lt_elsewhere' where id = ${bought.paymentId}`,
      database.sql`delete from billing_payments where id = ${bought.paymentId}`,
      database.sql`update billing_journal_transactions set reason = 'correction'`,
      database.sql`update billing_journal_entries set amount_minor = 1`,
      database.sql`delete from billing_journal_entries`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }
    const [payment] = await rowsOf<{ amount_minor: string; state: string }>(
      database.sql`select amount_minor::text as amount_minor, state from billing_payments where id = ${bought.paymentId}`,
    );
    expect(payment).toEqual({ amount_minor: '1500', state: 'succeeded' });
    expect(await journalImbalance()).toBe('0');
  });

  it('refuses to reopen a resolved claim, written directly', async () => {
    const { offerId } = await sellable('final@velora.test', 'finality');
    const bought = await settledPurchase({
      buyer: 'finalbuyer@velora.test',
      key: 'reversal-key-final',
      offerId,
    });
    await providerEvent({
      dispute: {
        amountMinor: '1500',
        currency: 'USD',
        providerDisputeReference: 'dp_final_0001',
        reason: 'duplicate',
        status: 'won',
      },
      eventId: crypto.randomUUID(),
      eventType: 'dispute.closed',
      providerPaymentReference: bought.providerReference,
    });
    await drain();
    for (const statement of [
      database.sql`update billing_disputes set state = 'opened', resolved_at = null`,
      database.sql`update billing_disputes set amount_minor = 1`,
      database.sql`update billing_disputes set provider_reference = 'dp_other'`,
      database.sql`delete from billing_disputes`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }
  });
});

describe('a deployed environment cannot reverse anything', () => {
  it('refuses when no payment provider and no commercial terms are approved', async () => {
    const { offerId } = await sellable('blocked@velora.test', 'blocking');
    const bought = await settledPurchase({
      buyer: 'blockedbuyer@velora.test',
      key: 'reversal-key-blocked',
      offerId,
    });
    // The configuration a deployed environment is forced to carry: no approved
    // provider and no published commercial terms. Staging and production reject
    // any other value, so this is what the refund path meets there.
    const deployed = createBillingRuntime({
      config: testServerConfig(),
      consumerContext: users.consumerContext,
      consumers: users.adultStanding,
      creatorContext: product.creators.creatorContext,
      creators: product.creators.directory,
      database: database.drizzle,
      resources: product.clubs.commercialDirectory,
    });
    const outcome = await deployed.refunds.issue({
      actorReference: 'session:operator',
      amountMinor: 1500n,
      correlationId: 'blocked-correlation',
      currency: 'USD',
      idempotencyKey: 'reversal-key-blocked-1',
      paymentId: bought.paymentId,
      reasonCode: 'duplicate_charge',
    });
    expect(outcome).toEqual({ kind: 'refused', reason: 'unavailable' });
    // Nothing durable was written, so there is no intention to move money
    // through a provider that does not exist.
    expect(await count('billing_refunds')).toBe('0');
  });
});
