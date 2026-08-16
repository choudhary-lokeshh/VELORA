import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { mediaLiveAvailability } from '../../src/media/operations.js';
import type { MediaAssetClass } from '../../src/media/policy.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import * as fixture from '../support/media-fixtures.js';
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
  testDatabaseAdmission,
  testMediaRuntime,
  testProductRuntimes,
  testServerConfig,
} from '../support/harness.js';
import { mediaEnvironment } from '../support/profile-media.js';

/**
 * Platform Admin media operations against real PostgreSQL.
 *
 * Two things are being held to account here, and only one of them is a screen.
 *
 * The first is the trigger. Taking a creator's object out of public view is not
 * the same as a delivery layer forgetting it: a derivative served from an
 * immutable public address stays fetchable by anybody holding the URL until the
 * cache is told, and the origin refusing does nothing about that. So a takedown
 * owes the purge, in the same transaction that records the enforcement — which
 * is what makes "taken down but still served" a state the platform cannot be
 * left in rather than a race between two operations.
 *
 * The second is what the operator surface refuses to be. It carries the
 * technical lifecycle, which every product surface is deliberately denied, and
 * it carries no owner, no list, and no search — an operator who could page
 * through everybody's media has a browsing surface over private images however
 * it is labelled. The one action available destroys nothing.
 */

const databaseUrl = await provisionDatabase('velora_admin_media');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

const logger = silentLogger();
const config = testServerConfig(mediaEnvironment);
const auth = createAuthRuntime({
  config,
  database: database.drizzle,
  logger,
  options: {
    rateLimiter: new InMemoryRateLimiter(),
    requesterReference: (request) =>
      request.headers.get('x-velora-device') ?? 'admin-media-test',
  },
});
const mediaRuntime = testMediaRuntime({
  config,
  database: database.drizzle,
  logger,
});
const storage = mediaRuntime.storage as LocalTestMediaStorage;

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

const creatorId = '44444444-4444-4444-8444-444444444444';
let operation = 0;

afterAll(async () => {
  await application.close();
  await database.close();
});

beforeEach(async () => {
  await database.truncate();
});

interface Operator {
  readonly cookie: string;
  readonly csrf: string;
}

/**
 * A Platform Admin session, written straight into AUTH's tables.
 *
 * There is no way to mint one through a route, and that is the point: no
 * approved verifier can produce the phishing-resistant assurance these routes
 * require, so every one of them is unreachable in a deployed environment. The
 * contract still has to be exercised against the authority it will actually
 * demand.
 */
async function operatorSession(
  assurance: 'phishing_resistant' | 'single_factor' = 'phishing_resistant',
): Promise<Operator> {
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
      ${crypto.randomUUID()}, ${accountId}, 'platform_admin', ${assurance}, ${now},
      ${now}, ${now}, ${digest(csrf)}, ${new Date(now.getTime() + 3_600_000)},
      ${now}, ${new Date(now.getTime() + 3_600_000)}, ${digest(token)}
    )`);
  return {
    // The audience-scoped cookie AUTH actually sets. A session written into
    // the table is reachable only under the name the resolver looks for.
    cookie: `__Host-velora_platform_admin_session=${token}`,
    csrf,
  };
}

function operatorRequest(
  path: string,
  operator: Operator,
  init: { readonly body?: unknown; readonly method?: string } = {},
): Request {
  const method = init.method ?? 'GET';
  return new Request(`http://api.test${path}`, {
    ...(method === 'GET'
      ? {}
      : { body: JSON.stringify(init.body ?? {}), method }),
    headers: {
      'content-type': 'application/json',
      cookie: operator.cookie,
      origin: testAdminOrigin,
      'x-velora-csrf': operator.csrf,
    },
  });
}

/** An asset carried all the way to `ready`, owned by the named domain. */
async function readyAsset(
  ownerDomain: 'clubs' | 'creators',
  assetClass: MediaAssetClass,
): Promise<string> {
  operation += 1;
  const created = await mediaRuntime.service.createUpload({
    assetClass,
    idempotencyKey: `admin-media-${String(operation).padStart(4, '0')}`,
    ownerDomain,
    ownerReference: creatorId,
  });
  if (created.kind !== 'upload_ready') throw new Error('expected an upload');
  const [session] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${created.asset.id} and state = 'issued'`,
  );
  await storage.putObject(
    session?.object_key ?? '',
    await fixture.image({ format: 'jpeg' }),
  );
  await mediaRuntime.service.recordUpload({
    assetId: created.asset.id,
    ownerDomain,
    ownerReference: creatorId,
  });
  await mediaRuntime.service.runInspections({ owner: 'test' });
  await mediaRuntime.service.runProcessing({ owner: 'test' });
  return created.asset.id;
}

async function seedCreator(): Promise<void> {
  operation += 1;
  await execute(
    database.sql`insert into creators_accounts (activated_at, auth_account_id, created_at, id, status, status_changed_at, updated_at)
      values (now(), ${crypto.randomUUID()}, now(), ${creatorId}, 'active', now(), now())`,
  );
  await execute(
    database.sql`insert into creators_profiles (created_at, creator_id, display_name, handle, publication, published_at, updated_at)
      values (now(), ${creatorId}, 'Ada', ${`ada-${String(operation)}`}, 'published', now(), now())`,
  );
}

async function attachToProfile(
  column: 'avatar_media_asset_id' | 'cover_media_asset_id',
  assetId: string,
): Promise<void> {
  await database.sql.unsafe(
    `update creators_profiles set ${column} = '${assetId}' where creator_id = '${creatorId}'`,
  );
}

async function seedContentWithImage(assetId: string): Promise<string> {
  const contentId = crypto.randomUUID();
  await execute(
    database.sql`insert into clubs_content (created_at, creator_id, id, lifecycle, published_at, title, updated_at, visibility)
      values (now(), ${creatorId}, ${contentId}, 'published', now(), 'An item', now(), 'public')`,
  );
  await execute(
    database.sql`insert into clubs_content_media (content_id, created_at, id, media_asset_id, position, updated_at)
      values (${contentId}, now(), ${crypto.randomUUID()}, ${assetId}, 0, now())`,
  );
  return contentId;
}

async function purgesOwed(assetId: string): Promise<number> {
  const rows = await rowsOf(
    database.sql`select 1 from media_obligations
                 where asset_id = ${assetId} and kind = 'purge' and state = 'pending'`,
  );
  return rows.length;
}

describe('a takedown owes the cache the news', () => {
  it('owes a purge for every image a withdrawn profile was showing', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const avatar = await readyAsset('creators', 'creator_avatar_image');
    const cover = await readyAsset('creators', 'creator_cover_image');
    await attachToProfile('avatar_media_asset_id', avatar);
    await attachToProfile('cover_media_asset_id', cover);

    const response = await handle(
      operatorRequest('/v1/admin/creators/object-removal', operator, {
        body: {
          creatorId,
          objectType: 'creator_profile',
          reasonCode: 'sexual_content_violation',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    // Two derivatives on the avatar and two on the cover, and every one of them
    // has a permanent public address a cache may be holding.
    expect(await purgesOwed(avatar)).toBe(2);
    expect(await purgesOwed(cover)).toBe(2);
  });

  it('owes a purge for the images on a withdrawn content item', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const image = await readyAsset('clubs', 'creator_content_image');
    const contentId = await seedContentWithImage(image);

    const response = await handle(
      operatorRequest('/v1/admin/creators/object-removal', operator, {
        body: {
          creatorId,
          objectId: contentId,
          objectType: 'creator_content',
          reasonCode: 'platform_integrity',
        },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    expect(await purgesOwed(image)).toBe(2);
  });

  it('destroys nothing, so an upheld appeal has something to restore', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const avatar = await readyAsset('creators', 'creator_avatar_image');
    await attachToProfile('avatar_media_asset_id', avatar);

    await handle(
      operatorRequest('/v1/admin/creators/object-removal', operator, {
        body: {
          creatorId,
          objectType: 'creator_profile',
          reasonCode: 'impersonation',
        },
        method: 'POST',
      }),
    );

    // A purge asks a cache to forget an address. The bytes, the record, and the
    // creator's ownership of them are untouched.
    const objects = await rowsOf<{ readonly state: string }>(
      database.sql`select state from media_objects where asset_id = ${avatar}`,
    );
    expect(objects).toHaveLength(3);
    for (const object of objects) expect(object.state).toBe('present');
    const [asset] = await rowsOf<{ readonly lifecycle: string }>(
      database.sql`select lifecycle from media_assets where id = ${avatar}`,
    );
    expect(asset?.lifecycle).toBe('ready');
  });

  it('leaves the enforcement and the purge to stand or fall together', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const avatar = await readyAsset('creators', 'creator_avatar_image');
    await attachToProfile('avatar_media_asset_id', avatar);

    // A removal that cannot be applied. The item does not belong to this
    // creator, so nothing is withdrawn — and therefore nothing is owed either.
    const refused = await handle(
      operatorRequest('/v1/admin/creators/object-removal', operator, {
        body: {
          creatorId,
          objectId: crypto.randomUUID(),
          objectType: 'creator_content',
          reasonCode: 'harassment',
        },
        method: 'POST',
      }),
    );

    expect(refused.status).toBe(409);
    expect(await purgesOwed(avatar)).toBe(0);
    // And no enforcement record survived the rollback either. The decision and
    // its effect commit together or not at all.
    expect(
      await rowsOf(database.sql`select 1 from safety_enforcements`),
    ).toHaveLength(0);
  });

  it('owes the purge once however many times the takedown is repeated', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const avatar = await readyAsset('creators', 'creator_avatar_image');
    await attachToProfile('avatar_media_asset_id', avatar);

    const takedown = () =>
      handle(
        operatorRequest('/v1/admin/creators/object-removal', operator, {
          body: {
            creatorId,
            objectType: 'creator_profile',
            reasonCode: 'spam_or_scam',
          },
          method: 'POST',
        }),
      );
    await takedown();
    await takedown();

    // The second removal finds the profile already withdrawn and is refused, so
    // the count is the first one's. Even had it applied, the partial unique
    // index would settle it: an outstanding purge for an object is one duty.
    expect(await purgesOwed(avatar)).toBe(2);
  });
});

describe('the operator media screen', () => {
  it('reports counts, adapter names, and no identifier at all', async () => {
    const operator = await operatorSession();
    await seedCreator();
    await readyAsset('creators', 'creator_avatar_image');

    const response = await handle(
      operatorRequest('/v1/admin/media/state', operator),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      adapters: { scanner: string; storage: string };
      assets: { count: number; state: string }[];
      liveMediaAvailable: boolean;
      objects: { count: number; state: string }[];
    };
    expect(body.assets).toEqual([{ count: 1, state: 'ready' }]);
    expect(body.objects).toEqual([
      { count: 1, state: 'original_present' },
      { count: 2, state: 'variant_present' },
    ]);
    // The adapter name rather than a boolean, so "off" and "off because nobody
    // has approved one" are distinguishable without a second screen.
    expect(body.adapters).toEqual({
      scanner: 'local-test',
      storage: 'local-test',
    });
    expect(body.liveMediaAvailable).toBe(true);
    // Not one identifier anywhere on it. A dashboard that also listed whose
    // uploads were failing is a dashboard somebody eventually screenshots.
    expect(JSON.stringify(body)).not.toContain(creatorId);
    expect(JSON.stringify(body)).not.toContain('media/');
  });

  it('needs both halves of the seam before it reports media available', () => {
    // Asserted on the rule itself rather than on this suite's configuration:
    // an approved store with no scanner accepts bytes nobody vetted, and a
    // scanner with no store has nothing to vet. Either alone is unavailable.
    expect(
      mediaLiveAvailability({
        scannerName: 'local-test',
        storageName: 'local-test',
      }),
    ).toBe(true);
    expect(
      mediaLiveAvailability({
        scannerName: 'unavailable',
        storageName: 'local-test',
      }),
    ).toBe(false);
    expect(
      mediaLiveAvailability({
        scannerName: 'local-test',
        storageName: 'unavailable',
      }),
    ).toBe(false);
    expect(
      mediaLiveAvailability({
        scannerName: 'unavailable',
        storageName: 'unavailable',
      }),
    ).toBe(false);
  });

  it('reports the adapters this process composed, not what was configured', async () => {
    const operator = await operatorSession();

    const response = await handle(
      operatorRequest('/v1/admin/media/state', operator),
    );
    const body = (await response.json()) as {
      adapters: { scanner: string; storage: string };
      liveMediaAvailable: boolean;
    };

    // The flag is derived from the same names, so a screen cannot report a
    // configured adapter while the process runs a different one.
    expect(response.status).toBe(200);
    expect(body.liveMediaAvailable).toBe(
      mediaLiveAvailability({
        scannerName: body.adapters.scanner,
        storageName: body.adapters.storage,
      }),
    );
  });

  it('surfaces drift and dead-lettered duties as things needing a person', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const assetId = await readyAsset('creators', 'creator_avatar_image');
    // An original the provider lost, observed and recorded with no safe
    // correction available — exactly the class that resolves on its own never.
    await execute(
      database.sql`insert into media_drift_findings
        (asset_id, created_at, id, kind, last_observed_at, occurrences, updated_at)
        values (${assetId}, now(), ${crypto.randomUUID()}, 'original_missing', now(), 3, now())`,
    );

    const response = await handle(
      operatorRequest('/v1/admin/media/state', operator),
    );
    const body = (await response.json()) as {
      attention: { count: number; state: string }[];
      drift: { count: number; state: string }[];
    };

    expect(body.drift).toEqual([{ count: 1, state: 'original_missing' }]);
    expect(body.attention).toContainEqual({
      count: 1,
      state: 'drift_original_missing',
    });
  });
});

describe('the operator asset view', () => {
  it('carries the technical lifecycle every product surface is denied', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const assetId = await readyAsset('creators', 'creator_avatar_image');

    const response = await handle(
      operatorRequest(`/v1/admin/media/asset?assetId=${assetId}`, operator),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      asset: {
        legalHold: boolean;
        lifecycle: string;
        objects: { objectKey: string; role: string }[];
        ownerDomain: string;
        truncated: boolean;
      };
    };
    // `ready`, not `preparing`. An operator is the one person the coarse
    // readiness projection is useless to.
    expect(body.asset.lifecycle).toBe('ready');
    expect(body.asset.legalHold).toBe(false);
    expect(body.asset.objects).toHaveLength(3);
    // The domain that asked, never the account that owns it.
    expect(body.asset.ownerDomain).toBe('creators');
    // Retained history is bounded, and the view says when it cut something off
    // rather than letting an operator believe they have all of it.
    expect(body.asset.truncated).toBe(false);
    expect(JSON.stringify(body)).not.toContain(creatorId);
  });

  it('answers an unknown asset the same as one that never existed', async () => {
    const operator = await operatorSession();

    const response = await handle(
      operatorRequest(
        `/v1/admin/media/asset?assetId=${crypto.randomUUID()}`,
        operator,
      ),
    );

    expect(response.status).toBe(404);
  });

  it('refuses an identifier that is not one', async () => {
    const operator = await operatorSession();

    const response = await handle(
      operatorRequest('/v1/admin/media/asset', operator),
    );

    expect(response.status).toBe(422);
  });
});

describe('the one media action an operator has', () => {
  it('owes a purge for every public address and returns the asset', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const assetId = await readyAsset('creators', 'creator_avatar_image');

    const response = await handle(
      operatorRequest('/v1/admin/media/purge', operator, {
        body: { assetId },
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      asset: { objects: { purgeRequestedAt?: string; role: string }[] };
      owed: number;
    };
    expect(body.owed).toBe(2);
    expect(await purgesOwed(assetId)).toBe(2);
    // Nothing has been performed yet: the duty is a row, and the worker holds
    // the lease that carries it out.
    for (const object of body.asset.objects) {
      expect(object.purgeRequestedAt).toBeUndefined();
    }
  });

  it('owes it once when asked twice, and says so with a zero', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const assetId = await readyAsset('creators', 'creator_avatar_image');

    const ask = () =>
      handle(
        operatorRequest('/v1/admin/media/purge', operator, {
          body: { assetId },
          method: 'POST',
        }),
      );
    await ask();
    const second = await ask();

    const body = (await second.json()) as { owed: number };
    // Zero owed is a success, which is why the asset comes back with it: an
    // operator reads the purge state off the objects rather than off a number.
    expect(body.owed).toBe(0);
    expect(await purgesOwed(assetId)).toBe(2);
  });

  it('destroys nothing', async () => {
    const operator = await operatorSession();
    await seedCreator();
    const assetId = await readyAsset('creators', 'creator_avatar_image');

    await handle(
      operatorRequest('/v1/admin/media/purge', operator, {
        body: { assetId },
        method: 'POST',
      }),
    );

    const [asset] = await rowsOf<{ readonly lifecycle: string }>(
      database.sql`select lifecycle from media_assets where id = ${assetId}`,
    );
    expect(asset?.lifecycle).toBe('ready');
    const objects = await rowsOf<{ readonly state: string }>(
      database.sql`select state from media_objects where asset_id = ${assetId}`,
    );
    for (const object of objects) expect(object.state).toBe('present');
  });
});

describe('nobody without operator authority reaches any of it', () => {
  it('refuses an operator who has not proved a phishing-resistant factor', async () => {
    const weak = await operatorSession('single_factor');

    for (const request of [
      operatorRequest('/v1/admin/media/state', weak),
      operatorRequest(
        `/v1/admin/media/asset?assetId=${crypto.randomUUID()}`,
        weak,
      ),
      operatorRequest('/v1/admin/media/purge', weak, {
        body: { assetId: crypto.randomUUID() },
        method: 'POST',
      }),
    ]) {
      const response = await handle(request);
      // Being an operator is not enough, and nothing here degrades to something
      // weaker when the assurance is absent.
      expect(response.status, request.url).toBe(403);
    }
  });

  it('refuses a request with no session at all', async () => {
    const response = await handle(
      new Request('http://api.test/v1/admin/media/state', {
        headers: { origin: testAdminOrigin },
      }),
    );

    expect(response.status).toBe(401);
  });
});
