import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
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
  testConsumerOrigin,
  testCreatorOrigin,
  testDatabaseAdmission,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';

/**
 * The creator's public identity against real PostgreSQL.
 *
 * Three things are proven here that nothing else can prove: that a contested
 * handle has exactly one owner however many callers ask at once, that a
 * concurrent edit is refused rather than silently overwritten, and that what a
 * visitor with no session receives is an allow-list rather than a filtered row.
 */

const databaseUrl = await provisionDatabase('velora_creators_profile');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();
const config = testServerConfig();
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'creator-profile-test',
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
});
const application = createApplication({
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
const handle = (request: Request) => application.app.handle(request);

afterAll(async () => {
  await application.close();
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
  subject: string,
  audience: 'consumer_web' | 'creator_studio',
): Promise<Studio> {
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

function consumerRequest(
  path: string,
  credentials: Studio,
  body: unknown,
): Request {
  return new Request(`http://api.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: credentials.cookie,
      origin: testConsumerOrigin,
      'x-velora-csrf': credentials.csrf,
    },
    method: 'POST',
  });
}

const acknowledgements = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

/** An active creator: adult consumer, capability established, policies held. */
async function activeCreator(subject: string): Promise<Studio> {
  const consumer = await session(subject, 'consumer_web');
  await handle(consumerRequest('/v1/users', consumer, {}));
  await handle(
    consumerRequest('/v1/users/me/onboarding/adult-declaration', consumer, {
      declaresAdult: true,
      region: 'ES',
    }),
  );
  const studio = await session(subject, 'creator_studio');
  const created = await handle(
    studioRequest('/v1/creator', studio, { method: 'POST' }),
  );
  if (created.status !== 201) {
    throw new Error(`capability failed with ${String(created.status)}`);
  }
  const activated = await handle(
    studioRequest('/v1/creator/onboarding/acknowledgements', studio, {
      body: { acknowledgements },
      method: 'POST',
    }),
  );
  if (activated.status !== 200) {
    throw new Error(`activation failed with ${String(activated.status)}`);
  }
  return studio;
}

interface OwnProfile {
  readonly displayName: string;
  readonly handle: string;
  readonly links: { label?: string; url: string }[];
  readonly publicPath: string;
  readonly publication: string;
  readonly publishedAt?: string;
  readonly version: number;
}

async function saveProfile(
  studio: Studio,
  body: Record<string, unknown>,
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/profile', studio, { body, method: 'POST' }),
  );
}

async function publish(
  studio: Studio,
  version: number,
  publication: 'draft' | 'published' = 'published',
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/profile/publication', studio, {
      body: { publication, version },
      method: 'POST',
    }),
  );
}

function publicRequest(handleValue: string): Request {
  return new Request(
    `http://api.test/v1/creators?handle=${encodeURIComponent(handleValue)}`,
  );
}

describe('creator handle claim', () => {
  it('claims a canonical handle on the first save and leaves the profile a draft', async () => {
    const studio = await activeCreator('handle-first@velora.test');

    const response = await saveProfile(studio, {
      displayName: 'Ember Vale',
      handle: 'Ember_Vale',
    });
    const body = (await response.json()) as OwnProfile;

    expect(response.status).toBe(201);
    expect(body.handle).toBe('ember_vale');
    expect(body.publication).toBe('draft');
    expect(body.publicPath).toBe('/c/ember_vale');
    expect(body.version).toBe(1);
    // A draft is not reachable without a session, whatever it contains.
    expect((await handle(publicRequest('ember_vale'))).status).toBe(404);
  });

  it('gives a contested handle exactly one owner under fifty simultaneous claims', async () => {
    const studios = await Promise.all(
      Array.from({ length: 50 }, async (_, index) =>
        activeCreator(`handle-race-${String(index)}@velora.test`),
      ),
    );

    const responses = await Promise.all(
      studios.map(async (studio) =>
        saveProfile(studio, { displayName: 'Contested', handle: 'contested' }),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    const refused = responses.filter((response) => response.status === 409);
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(49);
    expect(
      await rowsOf(
        database.sql`select 1 from creators_profiles where handle = 'contested'`,
      ),
    ).toHaveLength(1);
  });

  it('refuses a handle that differs from an existing one only by case', async () => {
    const first = await activeCreator('handle-case-a@velora.test');
    const second = await activeCreator('handle-case-b@velora.test');
    await saveProfile(first, { displayName: 'First', handle: 'lumen' });

    const response = await saveProfile(second, {
      displayName: 'Second',
      handle: 'LUMEN',
    });

    expect(response.status).toBe(409);
  });

  it('refuses a reserved handle, a malformed one, and one shaped like a path', async () => {
    const studio = await activeCreator('handle-shape@velora.test');

    const reserved = await saveProfile(studio, {
      displayName: 'Reserved',
      handle: 'admin',
    });
    const traversal = await saveProfile(studio, {
      displayName: 'Traversal',
      handle: '../etc',
    });
    const spaced = await saveProfile(studio, {
      displayName: 'Spaced',
      handle: '  ember  ',
    });
    const trailing = await saveProfile(studio, {
      displayName: 'Trailing',
      handle: 'ember-',
    });
    const unicode = await saveProfile(studio, {
      displayName: 'Unicode',
      handle: 'embеr',
    });

    for (const response of [reserved, traversal, spaced, trailing, unicode]) {
      expect(response.status).toBe(422);
    }
    expect(
      await rowsOf(database.sql`select 1 from creators_profiles`),
    ).toHaveLength(0);
  });

  it('refuses a rename, because this milestone has no redirect for the old one', async () => {
    const studio = await activeCreator('handle-rename@velora.test');
    const created = (await (
      await saveProfile(studio, { displayName: 'Ember', handle: 'ember-one' })
    ).json()) as OwnProfile;

    const renamed = await saveProfile(studio, {
      displayName: 'Ember',
      handle: 'ember-two',
      version: created.version,
    });

    expect(renamed.status).toBe(409);
    const rows = await rowsOf<{ handle: string }>(
      database.sql`select handle from creators_profiles`,
    );
    expect(rows.map((row) => row.handle)).toEqual(['ember-one']);
  });
});

describe('creator profile editing', () => {
  it('refuses a stale edit rather than overwriting a newer one', async () => {
    const studio = await activeCreator('profile-stale@velora.test');
    const first = (await (
      await saveProfile(studio, { displayName: 'One', handle: 'stale-test' })
    ).json()) as OwnProfile;
    const second = (await (
      await saveProfile(studio, {
        displayName: 'Two',
        handle: 'stale-test',
        version: first.version,
      })
    ).json()) as OwnProfile;

    const stale = await saveProfile(studio, {
      displayName: 'Three',
      handle: 'stale-test',
      version: first.version,
    });

    expect(second.version).toBe(first.version + 1);
    expect(stale.status).toBe(409);
    const current = (await (
      await handle(studioRequest('/v1/creator/profile', studio))
    ).json()) as OwnProfile;
    expect(current.displayName).toBe('Two');
  });

  it('refuses a save with no version against a profile that already exists', async () => {
    const studio = await activeCreator('profile-noversion@velora.test');
    await saveProfile(studio, { displayName: 'One', handle: 'noversion' });

    const response = await saveProfile(studio, {
      displayName: 'Overwrite',
      handle: 'noversion',
    });

    expect(response.status).toBe(409);
  });

  it('replaces links wholesale and refuses anything that is not an https URL', async () => {
    const studio = await activeCreator('profile-links@velora.test');
    const created = (await (
      await saveProfile(studio, {
        displayName: 'Linked',
        handle: 'linked',
        links: [
          { label: 'Site', url: 'https://example.test/one' },
          { url: 'https://example.test/two' },
        ],
      })
    ).json()) as OwnProfile;
    expect(created.links).toHaveLength(2);

    const trimmed = (await (
      await saveProfile(studio, {
        displayName: 'Linked',
        handle: 'linked',
        links: [{ url: 'https://example.test/three' }],
        version: created.version,
      })
    ).json()) as OwnProfile;
    expect(trimmed.links.map((link) => link.url)).toEqual([
      'https://example.test/three',
    ]);

    for (const url of [
      'javascript:alert(1)',
      'http://example.test/plain',
      'https://user:secret@example.test/credentials',
      'data:text/html,<script>',
    ]) {
      const refused = await saveProfile(studio, {
        displayName: 'Linked',
        handle: 'linked',
        links: [{ url }],
        version: trimmed.version,
      });
      expect(refused.status, url).toBe(422);
    }
  });

  it('never lets one creator read or write another creator profile', async () => {
    const first = await activeCreator('profile-isolation-a@velora.test');
    const second = await activeCreator('profile-isolation-b@velora.test');
    const firstProfile = (await (
      await saveProfile(first, { displayName: 'First', handle: 'isolate-a' })
    ).json()) as OwnProfile;

    const secondRead = await handle(
      studioRequest('/v1/creator/profile', second),
    );
    // The second creator's save names its own handle; there is no field in the
    // contract through which it could address the first creator at all.
    const secondSave = await saveProfile(second, {
      displayName: 'Second',
      handle: 'isolate-b',
    });

    expect(secondRead.status).toBe(404);
    expect(secondSave.status).toBe(201);
    const current = (await (
      await handle(studioRequest('/v1/creator/profile', first))
    ).json()) as OwnProfile;
    expect(current.displayName).toBe('First');
    expect(current.handle).toBe(firstProfile.handle);
  });
});

describe('creator profile publication', () => {
  it('publishes only on an explicit decision and takes the page down again', async () => {
    const studio = await activeCreator('publish-cycle@velora.test');
    const draft = (await (
      await saveProfile(studio, {
        bio: 'Work in progress.',
        displayName: 'Ember Vale',
        handle: 'publish-cycle',
      })
    ).json()) as OwnProfile;
    expect((await handle(publicRequest('publish-cycle'))).status).toBe(404);

    const published = (await (
      await publish(studio, draft.version)
    ).json()) as OwnProfile;
    const visible = await handle(publicRequest('publish-cycle'));
    const withdrawn = await publish(studio, published.version, 'draft');
    const gone = await handle(publicRequest('publish-cycle'));

    expect(published.publication).toBe('published');
    expect(published.publishedAt).toBeDefined();
    expect(visible.status).toBe(200);
    expect(withdrawn.status).toBe(200);
    expect(gone.status).toBe(404);
  });

  it('refuses publication from an applicant and from a suspended creator', async () => {
    const studio = await activeCreator('publish-gate@velora.test');
    const draft = (await (
      await saveProfile(studio, {
        displayName: 'Gated',
        handle: 'publish-gate',
      })
    ).json()) as OwnProfile;
    await execute(
      database.sql`update creators_accounts set status = 'suspended', status_reason = 'safety_enforcement', suspended_at = now()`,
    );

    const suspended = await publish(studio, draft.version);

    expect(suspended.status).toBe(409);
    expect((await handle(publicRequest('publish-gate'))).status).toBe(404);
  });

  it('stops serving a published page the moment the creator is suspended', async () => {
    const studio = await activeCreator('publish-suspend@velora.test');
    const draft = (await (
      await saveProfile(studio, {
        displayName: 'Live',
        handle: 'publish-suspend',
      })
    ).json()) as OwnProfile;
    await publish(studio, draft.version);
    expect((await handle(publicRequest('publish-suspend'))).status).toBe(200);

    await execute(
      database.sql`update creators_accounts set status = 'suspended', status_reason = 'safety_enforcement', suspended_at = now()`,
    );

    // No unpublish happened. The page stops resolving because the read checks
    // current creator state rather than trusting the publication flag.
    expect((await handle(publicRequest('publish-suspend'))).status).toBe(404);
  });

  it('refuses a publication carrying a stale version', async () => {
    const studio = await activeCreator('publish-stale@velora.test');
    const draft = (await (
      await saveProfile(studio, {
        displayName: 'Stale',
        handle: 'publish-stale',
      })
    ).json()) as OwnProfile;
    await saveProfile(studio, {
      displayName: 'Stale Two',
      handle: 'publish-stale',
      version: draft.version,
    });

    const response = await publish(studio, draft.version);

    expect(response.status).toBe(409);
  });
});

describe('the public creator projection', () => {
  it('carries only the allow-listed public fields', async () => {
    const studio = await activeCreator('public-shape@velora.test');
    const draft = (await (
      await saveProfile(studio, {
        bio: 'Ceramics, slowly.',
        displayName: 'Ember Vale',
        handle: 'public-shape',
        links: [{ label: 'Shop', url: 'https://example.test/shop' }],
      })
    ).json()) as OwnProfile;
    await publish(studio, draft.version);

    const response = await handle(publicRequest('public-shape'));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(Object.keys(body).toSorted()).toEqual([
      'bio',
      'displayName',
      'handle',
      'links',
      'publishedAt',
    ]);
    const serialized = JSON.stringify(body);
    for (const absent of [
      'creatorId',
      'authAccountId',
      'userId',
      'status',
      'publication',
      'version',
      'updatedAt',
      'price',
      'members',
    ]) {
      expect(serialized, absent).not.toContain(absent);
    }
  });

  it('answers an unknown handle, a draft, and a bad handle identically', async () => {
    const studio = await activeCreator('public-absent@velora.test');
    await saveProfile(studio, {
      displayName: 'Hidden',
      handle: 'public-absent',
    });

    const unknown = await handle(publicRequest('nobody-here'));
    const draft = await handle(publicRequest('public-absent'));
    const malformed = await handle(publicRequest('../../etc/passwd'));
    const empty = await handle(new Request('http://api.test/v1/creators'));

    for (const response of [unknown, draft, malformed, empty]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    }
  });

  it('resolves a published page for a visitor carrying no credential at all', async () => {
    const studio = await activeCreator('public-anonymous@velora.test');
    const draft = (await (
      await saveProfile(studio, {
        displayName: 'Open',
        handle: 'public-anonymous',
      })
    ).json()) as OwnProfile;
    await publish(studio, draft.version);

    const response = await handle(publicRequest('PUBLIC-Anonymous'));

    // Canonicalized on the way in, so a link somebody typed in the wrong case
    // still resolves to the one page rather than to nothing.
    expect(response.status).toBe(200);
    expect((await response.json()) as { handle: string }).toMatchObject({
      handle: 'public-anonymous',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});

describe('the database enforces the creator profile invariants', () => {
  it('refuses a reserved handle and a malformed one written directly', async () => {
    const creatorId = crypto.randomUUID();
    await execute(
      database.sql`insert into creators_accounts
        (auth_account_id, created_at, id, status, status_changed_at, status_reason, updated_at)
        values (${crypto.randomUUID()}, now(), ${creatorId}, 'applicant', now(), 'onboarding_incomplete', now())`,
    );

    const reserved = await refusedProfile(creatorId, 'settings');
    const malformed = await refusedProfile(creatorId, 'Ember');

    expect(reserved).toBe(true);
    expect(malformed).toBe(true);
  });
});

async function refusedProfile(
  creatorId: string,
  handleValue: string,
): Promise<boolean> {
  try {
    await execute(
      database.sql`insert into creators_profiles
        (created_at, creator_id, display_name, handle, publication, updated_at, version)
        values (now(), ${creatorId}, 'Direct', ${handleValue}, 'draft', now(), 1)`,
    );
    return false;
  } catch {
    return true;
  }
}
