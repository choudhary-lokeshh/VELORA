import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
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
 * Commercial offers and frozen prices against real PostgreSQL.
 *
 * Two properties this suite exists to prove. The first is that "purchasable" is
 * a conjunction re-evaluated at the moment of activation: a creator who was
 * active when they drafted, a club that was published last week, and a currency
 * somebody once approved are each necessary and none is sufficient. The second
 * is that a published price is frozen — the database refuses to change what an
 * amount says, whoever asks and whatever the service believes.
 *
 * A separate suite runs with no commercial policy published, which is the only
 * configuration a deployed environment may have, and proves that every
 * commercial mutation answers `503 DEPENDENCY_UNAVAILABLE` rather than
 * collecting terms nobody approved.
 */

const databaseUrl = await provisionDatabase('velora_billing_offers');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();

function applicationFor(commercePolicy: string) {
  const config = testServerConfig({ BILLING_COMMERCE_POLICY: commercePolicy });
  const auth = createAuthRuntime({
    config,
    database: database.drizzle,
    logger,
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'offers-test',
    },
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: database.drizzle,
    logger,
  });
  return createApplication({
    config,
    dependencies: {
      auth,
      ...testProductRuntimes({
        caller: auth.caller,
        config,
        database: database.drizzle,
        logger,
        users,
      }),
      database: healthy,
      databaseAdmission: testDatabaseAdmission(),
      ephemeralRedis: healthy,
      logger,
      queueRedis: healthy,
      users,
    },
  });
}

const enabled = applicationFor('local-test');
const unpublished = applicationFor('unpublished');
const handle = (request: Request) => enabled.app.handle(request);

afterAll(async () => {
  await enabled.close();
  await unpublished.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

interface Studio {
  readonly cookie: string;
  readonly csrf: string;
}

async function session(
  app: { readonly app: { handle(request: Request): Promise<Response> } },
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<Studio> {
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

function studioRequest(
  path: string,
  studio: Studio,
  init: { readonly body?: unknown; readonly method?: string } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: studio.cookie,
      origin: testCreatorOrigin,
      'x-velora-csrf': studio.csrf,
    },
  });
}

const acknowledgements = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

/** An active creator whose public page is published. */
async function activeCreator(
  app: { readonly app: { handle(request: Request): Promise<Response> } },
  subject: string,
  creatorHandle: string,
): Promise<Studio> {
  const consumer = await session(app, subject, 'consumer_web');
  const consumerPost = (path: string, body: unknown) =>
    new Request(`http://api.test${path}`, {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        cookie: consumer.cookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': consumer.csrf,
      },
      method: 'POST',
    });
  await app.app.handle(consumerPost('/v1/users', {}));
  await app.app.handle(
    consumerPost('/v1/users/me/onboarding/adult-declaration', {
      declaresAdult: true,
      region: 'ES',
    }),
  );

  const studio = await session(app, subject, 'creator_studio');
  await app.app.handle(
    studioRequest('/v1/creator', studio, { method: 'POST' }),
  );
  await app.app.handle(
    studioRequest('/v1/creator/onboarding/acknowledgements', studio, {
      body: { acknowledgements },
      method: 'POST',
    }),
  );
  const profile = (await (
    await app.app.handle(
      studioRequest('/v1/creator/profile', studio, {
        body: { displayName: 'Ember Vale', handle: creatorHandle },
        method: 'POST',
      }),
    )
  ).json()) as { version: number };
  await app.app.handle(
    studioRequest('/v1/creator/profile/publication', studio, {
      body: { publication: 'published', version: profile.version },
      method: 'POST',
    }),
  );
  return studio;
}

interface Club {
  readonly id: string;
  readonly version: number;
}

async function club(
  app: { readonly app: { handle(request: Request): Promise<Response> } },
  studio: Studio,
  slug: string,
  publish: boolean,
): Promise<Club> {
  const created = (await (
    await app.app.handle(
      studioRequest('/v1/creator/clubs', studio, {
        body: { name: 'Inner circle', slug },
        method: 'POST',
      }),
    )
  ).json()) as { clubs: { id: string; version: number }[] };
  const row = created.clubs[0];
  if (row === undefined) throw new Error('club was not created');
  if (!publish) return row;
  const published = (await (
    await app.app.handle(
      studioRequest('/v1/creator/clubs/lifecycle', studio, {
        body: { clubId: row.id, lifecycle: 'published', version: row.version },
        method: 'POST',
      }),
    )
  ).json()) as { clubs: { id: string; version: number }[] };
  const live = published.clubs[0];
  if (live === undefined) throw new Error('club was not published');
  return live;
}

interface OfferBody {
  readonly id: string;
  readonly mode: string;
  readonly prices: {
    readonly amount: {
      readonly amountMinor: string;
      readonly currency: string;
    };
    readonly id: string;
    readonly interval?: string;
    readonly state: string;
  }[];
  readonly state: string;
  readonly version: number;
}

async function offerFrom(response: Response): Promise<OfferBody> {
  const body = (await response.json()) as { offer: OfferBody };
  return body.offer;
}

async function draftOffer(
  studio: Studio,
  clubId: string,
  mode: 'subscription' | 'one_time' = 'subscription',
): Promise<OfferBody> {
  const response = await handle(
    studioRequest('/v1/creator/offers', studio, {
      body: { mode, resourceId: clubId, resourceType: 'club' },
      method: 'POST',
    }),
  );
  expect(response.status).toBe(201);
  return offerFrom(response);
}

async function price(
  studio: Studio,
  offerId: string,
  input: {
    readonly amountMinor: string;
    readonly currency: string;
    readonly interval?: 'month' | 'year';
  },
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/offers/prices', studio, {
      body: { offerId, ...input },
      method: 'POST',
    }),
  );
}

describe('commercial offers', () => {
  it('reports what the platform may sell before anybody tries to sell it', async () => {
    const studio = await activeCreator(
      enabled,
      'readiness@velora.test',
      'ember',
    );
    const response = await handle(studioRequest('/v1/creator/offers', studio));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      offers: unknown[];
      readiness: {
        currencies: string[];
        enabled: boolean;
        intervals: string[];
        source: string;
      };
    };
    expect(body.offers).toEqual([]);
    expect(body.readiness.enabled).toBe(true);
    expect(body.readiness.source).toBe('local-test');
    expect(body.readiness.currencies).toEqual(['EUR', 'JPY', 'USD']);
    expect(body.readiness.intervals).toEqual(['month', 'year']);
  });

  it('drafts terms for an unpublished club and refuses to activate them', async () => {
    const studio = await activeCreator(enabled, 'draft@velora.test', 'draftly');
    const unpublishedClub = await club(enabled, studio, 'quiet', false);
    const offer = await draftOffer(studio, unpublishedClub.id);
    expect(offer.state).toBe('draft');

    const priced = await price(studio, offer.id, {
      amountMinor: '1500',
      currency: 'USD',
      interval: 'month',
    });
    expect(priced.status).toBe(201);

    const activation = await handle(
      studioRequest('/v1/creator/offers/lifecycle', studio, {
        body: { offerId: offer.id, state: 'active', version: offer.version },
        method: 'POST',
      }),
    );
    expect(activation.status).toBe(403);
  });

  it('activates only when every authority agrees, and reports the frozen price', async () => {
    const studio = await activeCreator(enabled, 'live@velora.test', 'liveone');
    const published = await club(enabled, studio, 'inner', true);
    const offer = await draftOffer(studio, published.id);

    // No price yet: there is nothing to sell, so nothing may be sold.
    const premature = await handle(
      studioRequest('/v1/creator/offers/lifecycle', studio, {
        body: { offerId: offer.id, state: 'active', version: offer.version },
        method: 'POST',
      }),
    );
    expect(premature.status).toBe(403);

    expect(
      (
        await price(studio, offer.id, {
          amountMinor: '1500',
          currency: 'USD',
          interval: 'month',
        })
      ).status,
    ).toBe(201);

    const activated = await offerFrom(
      await handle(
        studioRequest('/v1/creator/offers/lifecycle', studio, {
          body: { offerId: offer.id, state: 'active', version: offer.version },
          method: 'POST',
        }),
      ),
    );
    expect(activated.state).toBe('active');
    expect(activated.prices).toHaveLength(1);
    expect(activated.prices[0]?.amount).toEqual({
      amountMinor: '1500',
      currency: 'USD',
    });
    expect(activated.prices[0]?.interval).toBe('month');
  });

  it('refuses an amount, currency, or cadence outside approved terms', async () => {
    const studio = await activeCreator(
      enabled,
      'bounds@velora.test',
      'bounded',
    );
    const published = await club(enabled, studio, 'bounds', true);
    const offer = await draftOffer(studio, published.id);

    // Below the approved minimum, above the approved maximum, and in a currency
    // the policy does not publish at all.
    expect(
      (
        await price(studio, offer.id, {
          amountMinor: '1',
          currency: 'USD',
          interval: 'month',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await price(studio, offer.id, {
          amountMinor: '5000000',
          currency: 'USD',
          interval: 'month',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await price(studio, offer.id, {
          amountMinor: '1500',
          currency: 'GBP',
          interval: 'month',
        })
      ).status,
    ).toBe(403);
    // A recurring offer must say how often, and a single purchase must not.
    expect(
      (await price(studio, offer.id, { amountMinor: '1500', currency: 'USD' }))
        .status,
    ).toBe(403);
    // A negative or zero price never reaches policy at all: the contract
    // refuses it, because the direction of a movement is carried by what the
    // operation is and never by the sign of an amount.
    for (const amountMinor of ['-1500', '0']) {
      expect(
        (
          await price(studio, offer.id, {
            amountMinor,
            currency: 'USD',
            interval: 'month',
          })
        ).status,
      ).toBe(422);
    }
  });

  it('keeps one live price per currency and preserves the one it replaces', async () => {
    const studio = await activeCreator(
      enabled,
      'reprice@velora.test',
      'repriced',
    );
    const published = await club(enabled, studio, 'reprice', true);
    const offer = await draftOffer(studio, published.id);
    const first = await offerFrom(
      await price(studio, offer.id, {
        amountMinor: '1500',
        currency: 'USD',
        interval: 'month',
      }),
    );
    const original = first.prices.find((row) => row.state === 'active');
    expect(original).toBeDefined();

    // A second live price in the same currency is refused rather than silently
    // replacing what the next person would pay.
    expect(
      (
        await price(studio, offer.id, {
          amountMinor: '2000',
          currency: 'USD',
          interval: 'month',
        })
      ).status,
    ).toBe(409);

    expect(
      (
        await handle(
          studioRequest('/v1/creator/offers/prices/retirement', studio, {
            body: { offerId: offer.id, priceId: original?.id },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await price(studio, offer.id, {
          amountMinor: '2000',
          currency: 'USD',
          interval: 'month',
        })
      ).status,
    ).toBe(201);

    // Both rows survive: the retired price is what a purchase made yesterday
    // still points at.
    const rows = await rowsOf<{ amount_minor: string; state: string }>(
      database.sql`select amount_minor::text as amount_minor, state
        from billing_prices order by created_at, id`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.state).sort()).toEqual(['active', 'retired']);
  });

  it('never lets one creator reach another creator commercial terms', async () => {
    const owner = await activeCreator(enabled, 'owner@velora.test', 'ownerly');
    const stranger = await activeCreator(
      enabled,
      'stranger@velora.test',
      'strangely',
    );
    const published = await club(enabled, owner, 'private', true);
    const offer = await draftOffer(owner, published.id);

    // Every one of these names a real identifier belonging to somebody else and
    // is answered as though it did not exist.
    expect(
      (
        await handle(
          studioRequest('/v1/creator/offers', stranger, {
            body: {
              mode: 'subscription',
              resourceId: published.id,
              resourceType: 'club',
            },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await price(stranger, offer.id, {
          amountMinor: '1500',
          currency: 'USD',
          interval: 'month',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await handle(
          studioRequest('/v1/creator/offers/lifecycle', stranger, {
            body: { offerId: offer.id, state: 'retired', version: 1 },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(403);

    const list = (await (
      await handle(studioRequest('/v1/creator/offers', stranger))
    ).json()) as { offers: unknown[] };
    expect(list.offers).toEqual([]);
  });

  it('refuses a stale lifecycle change and a second live offer for one club', async () => {
    const studio = await activeCreator(
      enabled,
      'stale@velora.test',
      'staleone',
    );
    const published = await club(enabled, studio, 'stale', true);
    const offer = await draftOffer(studio, published.id);
    await price(studio, offer.id, {
      amountMinor: '1500',
      currency: 'USD',
      interval: 'month',
    });

    expect(
      (
        await handle(
          studioRequest('/v1/creator/offers/lifecycle', studio, {
            body: {
              offerId: offer.id,
              state: 'active',
              version: offer.version + 5,
            },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(409);

    // A second live offer for the same club and mode is refused by the index.
    expect(
      (
        await handle(
          studioRequest('/v1/creator/offers', studio, {
            body: {
              mode: 'subscription',
              resourceId: published.id,
              resourceType: 'club',
            },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(409);
  });

  it('retires an offer with every live price on it and deletes nothing', async () => {
    const studio = await activeCreator(
      enabled,
      'retire@velora.test',
      'retiring',
    );
    const published = await club(enabled, studio, 'retire', true);
    const offer = await draftOffer(studio, published.id);
    await price(studio, offer.id, {
      amountMinor: '1500',
      currency: 'USD',
      interval: 'month',
    });
    await price(studio, offer.id, {
      amountMinor: '1200',
      currency: 'EUR',
      interval: 'month',
    });

    const retired = await offerFrom(
      await handle(
        studioRequest('/v1/creator/offers/lifecycle', studio, {
          body: { offerId: offer.id, state: 'retired', version: offer.version },
          method: 'POST',
        }),
      ),
    );
    expect(retired.state).toBe('retired');

    const rows = await rowsOf<{ state: string }>(
      database.sql`select state from billing_prices`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.state === 'retired')).toBe(true);

    // A retired offer frees the club for a new one, which is how a creator
    // changes commercial terms rather than editing what somebody already bought.
    const replacement = await draftOffer(studio, published.id);
    expect(replacement.state).toBe('draft');
  });

  it('stops selling the moment the club is unpublished', async () => {
    const studio = await activeCreator(enabled, 'pull@velora.test', 'pulled');
    const published = await club(enabled, studio, 'pull', true);
    const offer = await draftOffer(studio, published.id);
    await price(studio, offer.id, {
      amountMinor: '1500',
      currency: 'USD',
      interval: 'month',
    });
    await handle(
      studioRequest('/v1/creator/clubs/lifecycle', studio, {
        body: {
          clubId: published.id,
          lifecycle: 'draft',
          version: published.version,
        },
        method: 'POST',
      }),
    );
    expect(
      (
        await handle(
          studioRequest('/v1/creator/offers/lifecycle', studio, {
            body: {
              offerId: offer.id,
              state: 'active',
              version: offer.version,
            },
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(403);
  });
});

describe('the database enforces the commercial invariants', () => {
  it('owns exactly the eleven billing tables and nothing else', async () => {
    const rows = await rowsOf<{ table_name: string }>(
      database.sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'billing_%'
        order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'billing_disputes',
      'billing_journal_accounts',
      'billing_journal_entries',
      'billing_journal_transactions',
      'billing_offers',
      'billing_outbox',
      'billing_payments',
      'billing_prices',
      'billing_provider_events',
      'billing_refunds',
      'billing_subscriptions',
    ]);
  });

  it('freezes what a published price says and retains every row', async () => {
    const studio = await activeCreator(
      enabled,
      'frozen@velora.test',
      'frozenly',
    );
    const published = await club(enabled, studio, 'frozen', true);
    const offer = await draftOffer(studio, published.id);
    await price(studio, offer.id, {
      amountMinor: '1500',
      currency: 'USD',
      interval: 'month',
    });

    for (const statement of [
      database.sql`update billing_prices set amount_minor = 1`,
      database.sql`update billing_prices set currency = 'EUR'`,
      database.sql`update billing_prices set billing_interval = 'year'`,
      database.sql`update billing_prices set effective_from = now()`,
      database.sql`delete from billing_prices`,
      database.sql`delete from billing_offers`,
    ]) {
      expect(await refused(async () => execute(statement))).toBe(true);
    }

    const rows = await rowsOf<{ amount_minor: string; currency: string }>(
      database.sql`select amount_minor::text as amount_minor, currency from billing_prices`,
    );
    expect(rows).toEqual([{ amount_minor: '1500', currency: 'USD' }]);
  });

  it('refuses a recurring price with no cadence and a single purchase with one', async () => {
    const studio = await activeCreator(enabled, 'shape@velora.test', 'shaped');
    const published = await club(enabled, studio, 'shape', true);
    const offer = await draftOffer(studio, published.id);
    for (const [mode, interval] of [
      ['subscription', null],
      ['one_time', 'month'],
    ] as const) {
      expect(
        await refused(async () =>
          execute(
            database.sql`insert into billing_prices
              (amount_minor, billing_interval, commercial_mode, created_at, currency, effective_from, id, offer_id, state)
              values (1500, ${interval}, ${mode}, now(), 'USD', now(), ${crypto.randomUUID()}, ${offer.id}, 'active')`,
          ),
        ),
      ).toBe(true);
    }
  });

  it('refuses a price whose mode disagrees with its offer', async () => {
    const studio = await activeCreator(enabled, 'mode@velora.test', 'modally');
    const published = await club(enabled, studio, 'mode', true);
    const offer = await draftOffer(studio, published.id, 'subscription');
    expect(
      await refused(async () =>
        execute(
          database.sql`insert into billing_prices
            (amount_minor, billing_interval, commercial_mode, created_at, currency, effective_from, id, offer_id, state)
            values (1500, null, 'one_time', now(), 'USD', now(), ${crypto.randomUUID()}, ${offer.id}, 'active')`,
        ),
      ),
    ).toBe(true);
  });
});

describe('monetisation with no approved commercial terms', () => {
  it('says so, and refuses every commercial mutation', async () => {
    const studio = await activeCreator(
      unpublished,
      'closed@velora.test',
      'closedly',
    );
    const published = await club(unpublished, studio, 'closed', true);

    const listed = await unpublished.app.handle(
      studioRequest('/v1/creator/offers', studio),
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      readiness: { currencies: string[]; enabled: boolean; source: string };
    };
    expect(body.readiness.enabled).toBe(false);
    expect(body.readiness.currencies).toEqual([]);
    expect(body.readiness.source).toBe('unpublished');

    // Every mutation answers the same way: the environment cannot sell
    // anything, which is a statement about the platform rather than about the
    // caller or the request.
    for (const [path, payload] of [
      [
        '/v1/creator/offers',
        {
          mode: 'subscription',
          resourceId: published.id,
          resourceType: 'club',
        },
      ],
      [
        '/v1/creator/offers/prices',
        {
          amountMinor: '1500',
          currency: 'USD',
          interval: 'month',
          offerId: crypto.randomUUID(),
        },
      ],
      [
        '/v1/creator/offers/lifecycle',
        { offerId: crypto.randomUUID(), state: 'active', version: 1 },
      ],
    ] as const) {
      const response = await unpublished.app.handle(
        studioRequest(path, studio, { body: payload, method: 'POST' }),
      );
      expect(response.status, path).toBe(503);
      expect((await response.json()) as { code: string }).toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
      });
    }

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from billing_offers`,
    );
    expect(rows[0]?.count).toBe('0');
  });
});
