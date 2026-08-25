import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { image } from '../support/media-fixtures.js';
import {
  connectDatabase,
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
import { mediaEnvironment } from '../support/profile-media.js';

/**
 * A creator's page and catalog imagery, end to end.
 *
 * The persistence for both has existed since the media architecture run, and so
 * have the adapters that decide who may be served them — a published page's
 * avatar is public, a members-only item's attachment is restricted to live
 * members. What did not exist was any way to put an image there, so those
 * decisions had nothing to decide about.
 *
 * These tests take the same three steps a browser takes for every image on this
 * platform — reserve, PUT the bytes, confirm — and then check the two things
 * that are genuinely this domain's: that an image reaches a page and a catalog
 * item only through its own creator, and that what a visitor with no session
 * receives is a reference to something ready rather than a status report.
 */

const databaseUrl = await provisionDatabase('velora_creators_media');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();
const config = testServerConfig({ ...mediaEnvironment });
let requesterSequence = 0;
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: () => {
      requesterSequence += 1;
      return `creator-media-test-${String(requesterSequence)}`;
    },
  },
});
const users = createUsersRuntime({
  caller: auth.caller,
  config,
  database: database.drizzle,
  logger,
  media: { ...emptyProfileMediaPort() },
});
const runtimes = testProductRuntimes({
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
    ...runtimes,
    database: healthy,
    databaseAdmission: testDatabaseAdmission(),
    ephemeralRedis: healthy,
    logger,
    queueRedis: healthy,
    users,
  },
});
const handle = (request: Request) => application.app.handle(request);
const storage = runtimes.media.storage as LocalTestMediaStorage;

/**
 * USERS is not under test here and has no consumer image in these suites, so it
 * is given a media port that reserves nothing rather than the real one. It
 * keeps this file's composition to the two domains it is actually about.
 */
function emptyProfileMediaPort() {
  return {
    createUpload: () =>
      Promise.resolve({ kind: 'storage_unavailable' as const }),
    describeReadiness: () => Promise.resolve([]),
    recordUpload: () => Promise.resolve({ kind: 'storage_unavailable' }),
    requestDeletion: () => Promise.resolve(undefined),
  };
}

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
  readonly handle: string;
}

function post(session: Studio, path: string, body: unknown): Request {
  return new Request(`http://api.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: session.cookie,
      origin: testCreatorOrigin,
      'x-velora-csrf': session.csrf,
    },
    method: 'POST',
  });
}

function get(session: Studio, path: string): Request {
  return new Request(`http://api.test${path}`, {
    headers: { cookie: session.cookie, origin: testCreatorOrigin },
  });
}

async function jsonOf<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** A creator whose page is published, reached only through the product path. */
async function publishedCreator(
  subject: string,
  creatorHandle: string,
): Promise<Studio> {
  const consumerSignIn = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'consumer_web', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testConsumerOrigin,
      },
      method: 'POST',
    }),
  );
  const consumerSession = await jsonOf<{ csrfToken: string }>(consumerSignIn);
  const consumerCookie = consumerSignIn.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .join('; ');
  await handle(
    new Request('http://api.test/v1/users', {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        cookie: consumerCookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': consumerSession.csrfToken,
      },
      method: 'POST',
    }),
  );
  await handle(
    new Request('http://api.test/v1/users/me/onboarding/adult-declaration', {
      body: JSON.stringify({ declaresAdult: true, region: 'ES' }),
      headers: {
        'content-type': 'application/json',
        cookie: consumerCookie,
        origin: testConsumerOrigin,
        'x-velora-csrf': consumerSession.csrfToken,
      },
      method: 'POST',
    }),
  );

  const studioSignIn = await handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience: 'creator_studio', subject }),
      headers: {
        'content-type': 'application/json',
        origin: testCreatorOrigin,
      },
      method: 'POST',
    }),
  );
  const studioSession = await jsonOf<{ csrfToken: string }>(studioSignIn);
  const studio: Studio = {
    cookie: studioSignIn.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0] ?? '')
      .join('; '),
    csrf: studioSession.csrfToken,
    handle: creatorHandle,
  };

  await handle(post(studio, '/v1/creator', {}));
  const onboarding = await jsonOf<{
    outstandingPolicies: { key: string; version: string }[];
  }>(await handle(get(studio, '/v1/creator/onboarding')));
  await handle(
    post(studio, '/v1/creator/onboarding/acknowledgements', {
      acknowledgements: onboarding.outstandingPolicies.map((one) => ({
        key: one.key,
        version: one.version,
      })),
    }),
  );
  const saved = await jsonOf<{ version: number }>(
    await handle(
      post(studio, '/v1/creator/profile', {
        displayName: 'A Creator',
        handle: creatorHandle,
        links: [],
      }),
    ),
  );
  await handle(
    post(studio, '/v1/creator/profile/publication', {
      publication: 'published',
      version: saved.version,
    }),
  );
  return studio;
}

interface Capability {
  readonly mediaId: string;
  readonly uploadHeaders: Record<string, string>;
  readonly uploadUrl: string;
}

/** Writes real bytes to the address the platform issued, as a browser does. */
async function putBytes(capability: Capability): Promise<void> {
  const [session] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${capability.mediaId} and state = 'issued'`,
  );
  await storage.putObject(
    session?.object_key ?? '',
    await image({ format: 'jpeg' }),
  );
}

/** Runs the byte work a worker would, so a test does not have to wait. */
async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await runtimes.media.service.runInspections({
      owner: 'creator-media-test',
    });
    await runtimes.media.service.runProcessing({ owner: 'creator-media-test' });
  }
}

async function addPageImage(
  studio: Studio,
  slot: 'avatar' | 'cover',
): Promise<string> {
  const reserved = await handle(
    post(studio, '/v1/creator/profile/media', { slot }),
  );
  expect(reserved.status).toBe(201);
  const capability = await jsonOf<Capability>(reserved);
  await putBytes(capability);
  const completed = await handle(
    post(studio, '/v1/creator/profile/media/completion', {
      mediaId: capability.mediaId,
    }),
  );
  expect(completed.status).toBe(200);
  await settle();
  return capability.mediaId;
}

describe('a creator page carries the images its creator put there', () => {
  it('takes an avatar through reserve, upload, and confirm', async () => {
    const studio = await publishedCreator('avatar@velora.test', 'avatar-page');

    const assetId = await addPageImage(studio, 'avatar');

    const profile = await jsonOf<{
      media: { id: string; slot: string; state: string }[];
    }>(await handle(get(studio, '/v1/creator/profile')));
    expect(profile.media).toEqual([
      { id: assetId, slot: 'avatar', state: 'ready' },
    ]);
  });

  it('holds an avatar and a cover at the same time', async () => {
    const studio = await publishedCreator('both@velora.test', 'both-page');

    await addPageImage(studio, 'avatar');
    await addPageImage(studio, 'cover');

    const profile = await jsonOf<{ media: { slot: string }[] }>(
      await handle(get(studio, '/v1/creator/profile')),
    );
    expect(profile.media.map((one) => one.slot).toSorted()).toEqual([
      'avatar',
      'cover',
    ]);
  });

  it('replaces what a slot held, and owes the old bytes a deletion', async () => {
    const studio = await publishedCreator('replace@velora.test', 'replace-me');
    const first = await addPageImage(studio, 'avatar');

    const second = await addPageImage(studio, 'avatar');

    expect(second).not.toBe(first);
    const profile = await jsonOf<{ media: { id: string }[] }>(
      await handle(get(studio, '/v1/creator/profile')),
    );
    expect(profile.media.map((one) => one.id)).toEqual([second]);
    const [replaced] = await rowsOf<{ readonly lifecycle: string }>(
      database.sql`select lifecycle from media_assets where id = ${first}`,
    );
    expect(['deleting', 'deleted']).toContain(replaced?.lifecycle ?? '');
  });

  it('detaches an image on request', async () => {
    const studio = await publishedCreator('detach@velora.test', 'detach-me');
    const assetId = await addPageImage(studio, 'avatar');

    const removed = await handle(
      post(studio, '/v1/creator/profile/media/removal', { mediaId: assetId }),
    );

    expect(removed.status).toBe(200);
    const profile = await jsonOf<{ media: unknown[] }>(removed);
    expect(profile.media).toEqual([]);
  });

  it('refuses to let one creator name another creator’s image', async () => {
    const owner = await publishedCreator('owner@velora.test', 'owner-page');
    const other = await publishedCreator('other@velora.test', 'other-page');
    const assetId = await addPageImage(owner, 'avatar');

    const stolen = await handle(
      post(other, '/v1/creator/profile/media/removal', { mediaId: assetId }),
    );

    expect(stolen.status).toBe(409);
    const profile = await jsonOf<{ media: { id: string }[] }>(
      await handle(get(owner, '/v1/creator/profile')),
    );
    expect(profile.media.map((one) => one.id)).toEqual([assetId]);
  });
});

describe('what a visitor is shown', () => {
  it('publishes a reference for a ready page image and none for an unready one', async () => {
    const studio = await publishedCreator(
      'visitor@velora.test',
      'visitor-page',
    );

    const reserved = await jsonOf<Capability>(
      await handle(
        post(studio, '/v1/creator/profile/media', { slot: 'avatar' }),
      ),
    );
    const beforeUpload = await jsonOf<{ avatar?: { id: string } }>(
      await handle(
        new Request('http://api.test/v1/creators?handle=visitor-page', {
          headers: { origin: testConsumerOrigin },
        }),
      ),
    );
    expect(beforeUpload.avatar).toBeUndefined();

    await putBytes(reserved);
    await handle(
      post(studio, '/v1/creator/profile/media/completion', {
        mediaId: reserved.mediaId,
      }),
    );
    await settle();

    const afterReady = await jsonOf<{ avatar?: { id: string } }>(
      await handle(
        new Request('http://api.test/v1/creators?handle=visitor-page', {
          headers: { origin: testConsumerOrigin },
        }),
      ),
    );
    expect(afterReady.avatar).toEqual({ id: reserved.mediaId });
  });

  it('serves a published page image to a visitor with no session at all', async () => {
    const studio = await publishedCreator('public@velora.test', 'public-page');
    const assetId = await addPageImage(studio, 'avatar');

    const delivered = await handle(
      new Request('http://api.test/v1/media/deliveries', {
        body: JSON.stringify({
          assetIds: [assetId],
          variant: 'avatar_large',
        }),
        headers: {
          'content-type': 'application/json',
          origin: testConsumerOrigin,
        },
        method: 'POST',
      }),
    );

    const body = await jsonOf<{ deliveries: { assetId: string }[] }>(delivered);
    expect(body.deliveries.map((one) => one.assetId)).toEqual([assetId]);
  });

  it('serves nothing from a page its creator has not published', async () => {
    const studio = await publishedCreator('draft@velora.test', 'draft-page');
    const assetId = await addPageImage(studio, 'avatar');
    const profile = await jsonOf<{ version: number }>(
      await handle(get(studio, '/v1/creator/profile')),
    );
    await handle(
      post(studio, '/v1/creator/profile/publication', {
        publication: 'draft',
        version: profile.version,
      }),
    );

    const delivered = await handle(
      new Request('http://api.test/v1/media/deliveries', {
        body: JSON.stringify({
          assetIds: [assetId],
          variant: 'avatar_large',
        }),
        headers: {
          'content-type': 'application/json',
          origin: testConsumerOrigin,
        },
        method: 'POST',
      }),
    );

    expect(
      (await jsonOf<{ deliveries: unknown[] }>(delivered)).deliveries,
    ).toEqual([]);
  });
});

describe('a catalog item carries the images its creator attached', () => {
  async function draftItem(studio: Studio, title: string): Promise<string> {
    const created = await handle(
      post(studio, '/v1/creator/content', { title, visibility: 'public' }),
    );
    const body = await jsonOf<{ content: { id: string }[] }>(created);
    return body.content[0]?.id ?? '';
  }

  it('attaches images in the next free position', async () => {
    const studio = await publishedCreator('items@velora.test', 'items-page');
    const contentId = await draftItem(studio, 'An item with pictures');

    for (let index = 0; index < 2; index += 1) {
      const reserved = await jsonOf<Capability>(
        await handle(post(studio, '/v1/creator/content/media', { contentId })),
      );
      await putBytes(reserved);
      await handle(
        post(studio, '/v1/creator/content/media/completion', {
          mediaId: reserved.mediaId,
        }),
      );
    }
    await settle();

    const listed = await jsonOf<{
      content: { media: { position: number; state: string }[] }[];
    }>(await handle(get(studio, '/v1/creator/content')));
    expect(listed.content[0]?.media.map((one) => one.position)).toEqual([0, 1]);
    expect(listed.content[0]?.media.every((one) => one.state === 'ready')).toBe(
      true,
    );
  });

  it('publishes references on a published public item and none on a draft', async () => {
    const studio = await publishedCreator(
      'catalog@velora.test',
      'catalog-page',
    );
    const contentId = await draftItem(studio, 'Published with a picture');
    const reserved = await jsonOf<Capability>(
      await handle(post(studio, '/v1/creator/content/media', { contentId })),
    );
    await putBytes(reserved);
    await handle(
      post(studio, '/v1/creator/content/media/completion', {
        mediaId: reserved.mediaId,
      }),
    );
    await settle();

    const catalogRequest = () =>
      new Request('http://api.test/v1/creators/catalog?handle=catalog-page', {
        headers: { origin: testConsumerOrigin },
      });
    const asDraft = await jsonOf<{ content: unknown[] }>(
      await handle(catalogRequest()),
    );
    expect(asDraft.content).toEqual([]);

    const own = await jsonOf<{ content: { version: number }[] }>(
      await handle(get(studio, '/v1/creator/content')),
    );
    await handle(
      post(studio, '/v1/creator/content/lifecycle', {
        contentId,
        lifecycle: 'published',
        version: own.content[0]?.version ?? 1,
      }),
    );

    const published = await jsonOf<{
      content: { media: { id: string; position: number }[] }[];
    }>(await handle(catalogRequest()));
    expect(published.content[0]?.media).toEqual([
      { id: reserved.mediaId, position: 0 },
    ]);
  });

  it('serves a published public item’s image to a visitor with no session', async () => {
    const studio = await publishedCreator('served@velora.test', 'served-page');
    const contentId = await draftItem(studio, 'An item somebody can see');
    const reserved = await jsonOf<Capability>(
      await handle(post(studio, '/v1/creator/content/media', { contentId })),
    );
    await putBytes(reserved);
    await handle(
      post(studio, '/v1/creator/content/media/completion', {
        mediaId: reserved.mediaId,
      }),
    );
    await settle();
    const own = await jsonOf<{ content: { version: number }[] }>(
      await handle(get(studio, '/v1/creator/content')),
    );
    await handle(
      post(studio, '/v1/creator/content/lifecycle', {
        contentId,
        lifecycle: 'published',
        version: own.content[0]?.version ?? 1,
      }),
    );

    const delivered = await handle(
      new Request('http://api.test/v1/media/deliveries', {
        body: JSON.stringify({ assetIds: [reserved.mediaId], variant: 'card' }),
        headers: {
          'content-type': 'application/json',
          origin: testConsumerOrigin,
        },
        method: 'POST',
      }),
    );

    // The assertion the catalog projection cannot make. A reference published
    // beside an item proves the attachment exists; only an address proves the
    // asset was reserved under the domain whose adapter decides it, which is
    // the one thing about this that fails silently.
    expect(
      (
        await jsonOf<{ deliveries: { assetId: string }[] }>(delivered)
      ).deliveries.map((one) => one.assetId),
    ).toEqual([reserved.mediaId]);
  });

  it('serves nothing from an item its creator has not published', async () => {
    const studio = await publishedCreator(
      'unpublished@velora.test',
      'unpub-page',
    );
    const contentId = await draftItem(studio, 'Still a draft');
    const reserved = await jsonOf<Capability>(
      await handle(post(studio, '/v1/creator/content/media', { contentId })),
    );
    await putBytes(reserved);
    await handle(
      post(studio, '/v1/creator/content/media/completion', {
        mediaId: reserved.mediaId,
      }),
    );
    await settle();

    const delivered = await handle(
      new Request('http://api.test/v1/media/deliveries', {
        body: JSON.stringify({ assetIds: [reserved.mediaId], variant: 'card' }),
        headers: {
          'content-type': 'application/json',
          origin: testConsumerOrigin,
        },
        method: 'POST',
      }),
    );

    expect(
      (await jsonOf<{ deliveries: unknown[] }>(delivered)).deliveries,
    ).toEqual([]);
  });

  it('refuses to attach an image to another creator’s item', async () => {
    const owner = await publishedCreator('owns@velora.test', 'owns-page');
    const other = await publishedCreator('nope@velora.test', 'nope-page');
    const contentId = await draftItem(owner, 'Not yours');

    const refused = await handle(
      post(other, '/v1/creator/content/media', { contentId }),
    );

    expect(refused.status).toBe(409);
  });
});
