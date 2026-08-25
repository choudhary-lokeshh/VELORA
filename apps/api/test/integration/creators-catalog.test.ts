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
  testMediaRuntime,
} from '../support/harness.js';

/**
 * The creator catalog against real PostgreSQL.
 *
 * What this suite exists to prove is mostly negative: that a draft is never
 * reachable, that a members-only item is never reachable, that a creator who
 * stops being active takes their whole catalog with them, and that no caller
 * can address an item belonging to somebody else. The positive part is that
 * paging is bounded, ordered, and stable while a creator keeps publishing.
 */

const databaseUrl = await provisionDatabase('velora_creators_catalog');
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
      request.headers.get('x-velora-device') ?? 'catalog-test',
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

const acknowledgements = [
  { key: 'creator_terms', version: '0-unpublished' },
  { key: 'creator_content_policy', version: '0-unpublished' },
];

interface Creator {
  readonly handle: string;
  readonly studio: Studio;
}

/** An active creator with a published public page, ready to publish content. */
async function publishedCreator(
  subject: string,
  creatorHandle: string,
): Promise<Creator> {
  const consumer = await session(subject, 'consumer_web');
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
  await handle(consumerPost('/v1/users', {}));
  await handle(
    consumerPost('/v1/users/me/onboarding/adult-declaration', {
      declaresAdult: true,
      region: 'ES',
    }),
  );

  const studio = await session(subject, 'creator_studio');
  await handle(studioRequest('/v1/creator', studio, { method: 'POST' }));
  await handle(
    studioRequest('/v1/creator/onboarding/acknowledgements', studio, {
      body: { acknowledgements },
      method: 'POST',
    }),
  );
  const profile = (await (
    await handle(
      studioRequest('/v1/creator/profile', studio, {
        body: { displayName: 'Ember Vale', handle: creatorHandle },
        method: 'POST',
      }),
    )
  ).json()) as { version: number };
  await handle(
    studioRequest('/v1/creator/profile/publication', studio, {
      body: { publication: 'published', version: profile.version },
      method: 'POST',
    }),
  );
  return { handle: creatorHandle, studio };
}

interface ContentItem {
  readonly id: string;
  readonly lifecycle: string;
  readonly title: string;
  readonly version: number;
  readonly visibility: string;
}

async function saveContent(
  studio: Studio,
  body: Record<string, unknown>,
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/content', studio, { body, method: 'POST' }),
  );
}

async function firstOf(response: Response): Promise<ContentItem> {
  const body = (await response.json()) as { content: ContentItem[] };
  const item = body.content[0];
  if (item === undefined) throw new Error('response carried no content');
  return item;
}

async function setLifecycle(
  studio: Studio,
  item: ContentItem,
  lifecycle: string,
): Promise<Response> {
  return handle(
    studioRequest('/v1/creator/content/lifecycle', studio, {
      body: { contentId: item.id, lifecycle, version: item.version },
      method: 'POST',
    }),
  );
}

/** Creates one item and publishes it, returning the published row. */
async function publishItem(
  studio: Studio,
  title: string,
  visibility: 'public' | 'members_only' = 'public',
): Promise<ContentItem> {
  const draft = await firstOf(await saveContent(studio, { title, visibility }));
  return firstOf(await setLifecycle(studio, draft, 'published'));
}

function catalogRequest(handleValue: string, query = ''): Request {
  return new Request(
    `http://api.test/v1/creators/catalog?handle=${encodeURIComponent(handleValue)}${query}`,
  );
}

interface PublicCatalog {
  readonly content: { id: string; title: string }[];
  readonly handle: string;
  readonly nextCursor?: string;
}

describe('creator content lifecycle', () => {
  it('creates every item as a draft that no visitor can reach', async () => {
    const creator = await publishedCreator(
      'catalog-draft@velora.test',
      'draft-test',
    );

    const created = await saveContent(creator.studio, {
      body: 'Long form.',
      summary: 'Short form.',
      title: 'A first post',
      visibility: 'public',
    });
    const item = await firstOf(created);
    const catalog = (await (
      await handle(catalogRequest(creator.handle))
    ).json()) as PublicCatalog;

    expect(created.status).toBe(201);
    expect(item.lifecycle).toBe('draft');
    expect(item.version).toBe(1);
    expect(catalog.content).toHaveLength(0);
  });

  it('publishes on an explicit decision and withdraws without destroying the record', async () => {
    const creator = await publishedCreator(
      'catalog-cycle@velora.test',
      'cycle-test',
    );
    const published = await publishItem(creator.studio, 'Visible now');
    const visible = (await (
      await handle(catalogRequest(creator.handle))
    ).json()) as PublicCatalog;

    const archived = await firstOf(
      await setLifecycle(creator.studio, published, 'archived'),
    );
    const gone = (await (
      await handle(catalogRequest(creator.handle))
    ).json()) as PublicCatalog;

    expect(published.lifecycle).toBe('published');
    expect(visible.content.map((entry) => entry.title)).toEqual([
      'Visible now',
    ]);
    expect(archived.lifecycle).toBe('archived');
    expect(gone.content).toHaveLength(0);
    // Withdrawn, not deleted.
    expect(
      await rowsOf(database.sql`select 1 from clubs_content`),
    ).toHaveLength(1);
  });

  it('refuses a transition the item cannot make and a stale version', async () => {
    const creator = await publishedCreator(
      'catalog-transitions@velora.test',
      'transition-test',
    );
    const draft = await firstOf(
      await saveContent(creator.studio, {
        title: 'Transitions',
        visibility: 'public',
      }),
    );

    // Draft to draft is not a transition, and archived never goes straight back
    // in front of people.
    const sameState = await setLifecycle(creator.studio, draft, 'draft');
    const published = await firstOf(
      await setLifecycle(creator.studio, draft, 'published'),
    );
    const archived = await firstOf(
      await setLifecycle(creator.studio, published, 'archived'),
    );
    const straightBack = await setLifecycle(
      creator.studio,
      archived,
      'published',
    );
    const stale = await setLifecycle(creator.studio, published, 'archived');

    expect(sameState.status).toBe(409);
    expect(straightBack.status).toBe(409);
    expect(stale.status).toBe(409);
  });

  it('settles two simultaneous publications of one item as one transition', async () => {
    const creator = await publishedCreator(
      'catalog-race@velora.test',
      'race-test',
    );
    const draft = await firstOf(
      await saveContent(creator.studio, {
        title: 'Contested',
        visibility: 'public',
      }),
    );

    const responses = await Promise.all(
      Array.from({ length: 10 }, async () =>
        setLifecycle(creator.studio, draft, 'published'),
      ),
    );

    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(9);
    const rows = await rowsOf<{ lifecycle: string; version: number }>(
      database.sql`select lifecycle, version from clubs_content`,
    );
    expect(rows).toEqual([{ lifecycle: 'published', version: 2 }]);
  });

  it('refuses an edit that carries no version and one that carries a stale one', async () => {
    const creator = await publishedCreator(
      'catalog-edit@velora.test',
      'edit-test',
    );
    const first = await firstOf(
      await saveContent(creator.studio, {
        title: 'Original',
        visibility: 'public',
      }),
    );
    const second = await firstOf(
      await saveContent(creator.studio, {
        contentId: first.id,
        title: 'Edited',
        version: first.version,
        visibility: 'public',
      }),
    );

    const noVersion = await saveContent(creator.studio, {
      contentId: first.id,
      title: 'Overwrite',
      visibility: 'public',
    });
    const staleVersion = await saveContent(creator.studio, {
      contentId: first.id,
      title: 'Overwrite',
      version: first.version,
      visibility: 'public',
    });

    expect(second.title).toBe('Edited');
    expect(second.version).toBe(first.version + 1);
    expect(noVersion.status).toBe(409);
    expect(staleVersion.status).toBe(409);
  });
});

describe('creator catalog isolation', () => {
  it('answers an item belonging to another creator exactly as one that does not exist', async () => {
    const first = await publishedCreator(
      'catalog-a@velora.test',
      'isolate-one',
    );
    const second = await publishedCreator(
      'catalog-b@velora.test',
      'isolate-two',
    );
    const theirs = await firstOf(
      await saveContent(first.studio, {
        title: 'Not yours',
        visibility: 'public',
      }),
    );

    const edited = await saveContent(second.studio, {
      contentId: theirs.id,
      title: 'Stolen',
      version: theirs.version,
      visibility: 'public',
    });
    const published = await setLifecycle(second.studio, theirs, 'published');
    const invented = await saveContent(second.studio, {
      contentId: crypto.randomUUID(),
      title: 'Invented',
      version: 1,
      visibility: 'public',
    });

    expect(edited.status).toBe(409);
    expect(published.status).toBe(409);
    expect(invented.status).toBe(409);
    const rows = await rowsOf<{ title: string }>(
      database.sql`select title from clubs_content`,
    );
    expect(rows).toEqual([{ title: 'Not yours' }]);
  });

  it("lists only the calling creator's own catalog", async () => {
    const first = await publishedCreator(
      'catalog-own-a@velora.test',
      'own-one',
    );
    const second = await publishedCreator(
      'catalog-own-b@velora.test',
      'own-two',
    );
    await saveContent(first.studio, { title: 'Mine', visibility: 'public' });
    await saveContent(second.studio, { title: 'Theirs', visibility: 'public' });

    const listed = (await (
      await handle(studioRequest('/v1/creator/content', first.studio))
    ).json()) as { content: ContentItem[] };

    expect(listed.content.map((entry) => entry.title)).toEqual(['Mine']);
  });

  it('refuses every catalog write from a creator who is not active', async () => {
    const creator = await publishedCreator(
      'catalog-suspended@velora.test',
      'suspended-test',
    );
    const draft = await firstOf(
      await saveContent(creator.studio, {
        title: 'Before',
        visibility: 'public',
      }),
    );
    await execute(
      database.sql`update creators_accounts set status = 'suspended', status_reason = 'safety_enforcement', suspended_at = now()`,
    );

    const created = await saveContent(creator.studio, {
      title: 'After',
      visibility: 'public',
    });
    const published = await setLifecycle(creator.studio, draft, 'published');

    expect(created.status).toBe(409);
    expect(published.status).toBe(409);
  });
});

describe('the public catalog', () => {
  it('carries only the allow-listed public fields', async () => {
    const creator = await publishedCreator(
      'catalog-shape@velora.test',
      'shape-test',
    );
    await publishItem(creator.studio, 'Public item');

    const response = await handle(catalogRequest(creator.handle));
    const body = (await response.json()) as PublicCatalog;
    const entry = body.content[0] as Record<string, unknown> | undefined;

    expect(response.status).toBe(200);
    expect(Object.keys(body).toSorted()).toEqual(['content', 'handle']);
    expect(Object.keys(entry ?? {}).toSorted()).toEqual([
      'id',
      // References, never addresses. An item with no ready image still carries
      // the field, empty, so a surface never has to distinguish "no images"
      // from "an older server".
      'media',
      'publishedAt',
      'title',
    ]);
    expect(entry?.media).toEqual([]);
    const serialized = JSON.stringify(body);
    for (const absent of [
      'creatorId',
      'lifecycle',
      'visibility',
      'version',
      'updatedAt',
      'price',
      'members',
      'subscribe',
    ]) {
      expect(serialized, absent).not.toContain(absent);
    }
  });

  it('never shows a members-only item to a visitor', async () => {
    const creator = await publishedCreator(
      'catalog-members@velora.test',
      'members-test',
    );
    await publishItem(creator.studio, 'For members', 'members_only');
    await publishItem(creator.studio, 'For everybody', 'public');

    const body = (await (
      await handle(catalogRequest(creator.handle))
    ).json()) as PublicCatalog;

    // No club, membership, or entitlement exists yet, so there is nobody the
    // read path could admit. It refuses rather than defaulting to visible.
    expect(body.content.map((entry) => entry.title)).toEqual(['For everybody']);
  });

  it('takes the whole catalog down when the creator stops being active', async () => {
    const creator = await publishedCreator(
      'catalog-standing@velora.test',
      'standing-test',
    );
    await publishItem(creator.studio, 'Still here');
    expect((await handle(catalogRequest(creator.handle))).status).toBe(200);

    await execute(
      database.sql`update creators_accounts set status = 'suspended', status_reason = 'safety_enforcement', suspended_at = now()`,
    );

    // Nothing was unpublished. The read rechecks current creator state.
    expect((await handle(catalogRequest(creator.handle))).status).toBe(404);
  });

  it('answers an unknown handle and an unpublished profile identically', async () => {
    const creator = await publishedCreator(
      'catalog-hidden@velora.test',
      'hidden-test',
    );
    await publishItem(creator.studio, 'Hidden soon');
    await execute(
      database.sql`update creators_profiles set publication = 'draft', published_at = null`,
    );

    const unknown = await handle(catalogRequest('nobody-here'));
    const unpublished = await handle(catalogRequest(creator.handle));
    const malformed = await handle(catalogRequest('../../etc'));

    for (const response of [unknown, unpublished, malformed]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    }
  });

  it('pages in a bounded, stable order while the creator keeps publishing', async () => {
    const creator = await publishedCreator(
      'catalog-paging@velora.test',
      'paging-test',
    );
    const titles: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const title = `Item ${String(index)}`;
      await publishItem(creator.studio, title);
      titles.push(title);
    }

    const firstPage = (await (
      await handle(catalogRequest(creator.handle, '&pageSize=3'))
    ).json()) as PublicCatalog;
    // A new item appears between pages. Forward-only keyset paging means it is
    // ahead of the reader's position rather than shifting the boundary under
    // them, so nothing already delivered is delivered twice.
    await publishItem(creator.studio, 'Published mid-read');
    const secondPage = (await (
      await handle(
        catalogRequest(
          creator.handle,
          `&pageSize=3&cursor=${encodeURIComponent(firstPage.nextCursor ?? '')}`,
        ),
      )
    ).json()) as PublicCatalog;
    const thirdPage = (await (
      await handle(
        catalogRequest(
          creator.handle,
          `&pageSize=3&cursor=${encodeURIComponent(secondPage.nextCursor ?? '')}`,
        ),
      )
    ).json()) as PublicCatalog;

    expect(firstPage.content).toHaveLength(3);
    expect(secondPage.content).toHaveLength(3);
    expect(thirdPage.content).toHaveLength(1);
    expect(thirdPage.nextCursor).toBeUndefined();
    const seen = [
      ...firstPage.content,
      ...secondPage.content,
      ...thirdPage.content,
    ].map((entry) => entry.id);
    expect(new Set(seen).size).toBe(seen.length);
    // Newest first, and the item published mid-read is not retro-inserted.
    expect(firstPage.content.map((entry) => entry.title)).toEqual(
      titles.slice(-3).toReversed(),
    );
  });

  it('bounds the page size a caller may ask for', async () => {
    const creator = await publishedCreator(
      'catalog-bounds@velora.test',
      'bounds-test',
    );
    await publishItem(creator.studio, 'Only one');

    const excessive = await handle(
      catalogRequest(creator.handle, '&pageSize=5000'),
    );
    const negative = await handle(
      catalogRequest(creator.handle, '&pageSize=-1'),
    );

    expect(excessive.status).toBe(404);
    expect(negative.status).toBe(404);
  });
});

describe('the database enforces the catalog invariants', () => {
  it('owns exactly the five clubs tables and nothing else', async () => {
    const rows = await rowsOf<{ table_name: string }>(
      database.sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_name like 'clubs_%'
        order by table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'clubs_clubs',
      'clubs_content',
      // The attachment, not the bytes. This domain records which image hangs
      // off which item; MEDIA owns everything about the image itself.
      'clubs_content_media',
      'clubs_invites',
      'clubs_memberships',
    ]);
  });

  it('refuses a published row with no publication instant', async () => {
    let refused = false;
    try {
      await execute(
        database.sql`insert into clubs_content
          (created_at, creator_id, id, lifecycle, title, updated_at, version, visibility)
          values (now(), ${crypto.randomUUID()}, ${crypto.randomUUID()}, 'published', 'Direct', now(), 1, 'public')`,
      );
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });
});
