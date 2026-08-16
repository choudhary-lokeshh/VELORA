import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createMediaRuntime } from '../../src/media/composition.js';
import {
  mediaAbandonedUploadMilliseconds,
  mediaUploadWindowMilliseconds,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import { MediaRepository } from '../../src/media/repository.js';
import { MediaService } from '../../src/media/service.js';
import { MediaStorageUnavailableError } from '../../src/media/storage.js';
import type {
  LocalTestMediaStorage,
  MediaObjectRead,
  MediaObjectStat,
  MediaStoragePort,
  MediaUploadCapability,
} from '../../src/media/storage.js';
import {
  connectDatabase,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * Secure upload orchestration.
 *
 * The property under test throughout is that no sequence of client behaviour,
 * provider behaviour, or process death produces bytes the platform believes in
 * without having verified them itself, and that none of them leaves work the
 * platform silently stops owing.
 *
 * MEDIA publishes no HTTP route, and one test below asserts that. An upload
 * endpoint that did not belong to a product domain would be a purpose-free
 * upload endpoint, which is exactly the thing the architecture forbids: the
 * owning domain authorizes the purpose and only then calls this service. The
 * consequence is that CSRF, origin, and audience behaviour is a property of the
 * Consumer and Creator routes rather than of anything here, and it is tested
 * where those routes live.
 */

const databaseUrl = await provisionDatabase('velora_media_upload');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-upload-'));

const config = testServerConfig({
  MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
  MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
  MEDIA_STORAGE_PROVIDER: 'local-test',
});

let clock = new Date('2026-08-16T09:00:00.000Z');
const now = () => clock;

const media = createMediaRuntime({
  config,
  database: database.drizzle,
  logger: silentLogger(),
  now,
});
const storage = media.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '11111111-1111-4111-8111-111111111111',
};
const otherOwner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '22222222-2222-4222-8222-222222222222',
};
const profileImage: MediaAssetClass = 'consumer_profile_image';
const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

async function openUpload(idempotencyKey: string, who = owner) {
  const outcome = await media.service.createUpload({
    assetClass: profileImage,
    idempotencyKey,
    ...who,
  });
  if (outcome.kind !== 'upload_ready') {
    throw new Error(`expected an upload, got ${outcome.kind}`);
  }
  return outcome;
}

async function objectKeyOf(assetId: string): Promise<string> {
  const [row] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${assetId} and state = 'issued'`,
  );
  if (row === undefined) throw new Error('no open upload window');
  return row.object_key;
}

beforeEach(async () => {
  clock = new Date('2026-08-16T09:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('MEDIA publishes no upload endpoint of its own', () => {
  it('registers no media route, because an upload needs a purpose first', () => {
    const application = createApplication({ config });
    const paths = application.app.routes.map((route) => route.path);

    // Nothing under a media namespace. The owning domain authorizes the purpose
    // and calls the service; a route here would let somebody reserve storage
    // with no product reason at all.
    expect(paths.filter((path) => path.startsWith('/v1/media'))).toEqual([]);
    expect(
      paths.filter(
        (path) => path.includes('media') && !path.includes('profile'),
      ),
    ).toEqual([]);
  });
});

describe('the operation identity is bounded', () => {
  it('refuses a key outside the published contract before writing anything', async () => {
    for (const key of ['short', 'has spaces here', 'a'.repeat(129), '']) {
      expect(
        await media.service.createUpload({
          assetClass: profileImage,
          idempotencyKey: key,
          ...owner,
        }),
        key,
      ).toEqual({ kind: 'invalid_idempotency_key' });
    }
    const assets = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_assets`,
    );
    expect(assets[0]?.count).toBe('0');
  });

  it('is enforced by the database as well as by the service', async () => {
    expect(
      await refused(() =>
        database.sql.unsafe(
          `insert into media_assets (asset_class, created_at, id, idempotency_key, lifecycle, lifecycle_changed_at, owner_domain, owner_reference, updated_at)
           values ('consumer_profile_image', now(), '${crypto.randomUUID()}', 'no', 'initiated', now(), 'users', '${owner.ownerReference}', now())`,
        ),
      ),
    ).toBe(true);
  });
});

describe('a spent window can be replaced but never reused', () => {
  it('issues a new window on a new key once the old one lapses', async () => {
    const first = await openUpload('operation-reissue');
    const firstKey = await objectKeyOf(first.asset.id);

    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);
    const swept = await media.service.sweepExpiredUploads();
    expect(swept).toBe(1);

    const second = await media.service.reissueUpload({
      assetId: first.asset.id,
      ...owner,
    });
    expect(second.kind).toBe('upload_ready');
    const secondKey = await objectKeyOf(first.asset.id);

    // A new key, never the old one. If a lapsed capability were ever honoured
    // late, its bytes would land somewhere the next completion does not look.
    expect(secondKey).not.toBe(firstKey);
    expect(second.kind === 'upload_ready' && second.capability.url).toContain(
      secondKey,
    );

    const sessions = await rowsOf<{
      readonly attempt: number;
      readonly state: string;
    }>(
      database.sql`select attempt, state from media_upload_sessions
                   where asset_id = ${first.asset.id} order by attempt`,
    );
    expect(sessions).toEqual([
      { attempt: 1, state: 'expired' },
      { attempt: 2, state: 'issued' },
    ]);
  });

  it('will not accept bytes written under the lapsed capability', async () => {
    const first = await openUpload('operation-lapsed');
    const staleKey = await objectKeyOf(first.asset.id);

    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);
    await media.service.sweepExpiredUploads();
    await media.service.reissueUpload({ assetId: first.asset.id, ...owner });

    // The holder of the expired capability writes anyway.
    await storage.putObject(staleKey, jpegHeader);

    // Completion looks at the current window's object, which has nothing in it.
    expect(
      await media.service.recordUpload({ assetId: first.asset.id, ...owner }),
    ).toEqual({ kind: 'conflict' });

    const objects = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_objects`,
    );
    expect(objects[0]?.count).toBe('0');
  });

  it('hands a repeated initiation a fresh window rather than a dead asset', async () => {
    const first = await openUpload('operation-repeat');
    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);
    await media.service.sweepExpiredUploads();

    // Same operation identity. The caller asked to upload; telling it the asset
    // exists and leaving it no way to send bytes would be useless.
    const repeat = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-repeat',
      ...owner,
    });
    expect(repeat.kind).toBe('upload_ready');
    if (repeat.kind !== 'upload_ready') return;
    expect(repeat.asset.id).toBe(first.asset.id);
  });

  it('refuses a window on an asset that has moved past waiting for bytes', async () => {
    const created = await openUpload('operation-past');
    await storage.putObject(await objectKeyOf(created.asset.id), jpegHeader);
    await media.service.recordUpload({ assetId: created.asset.id, ...owner });

    // Uploaded means untrusted, not finished — but it does mean a second window
    // would let a client overwrite what the platform is about to inspect.
    expect(
      await media.service.reissueUpload({
        assetId: created.asset.id,
        ...owner,
      }),
    ).toEqual({ kind: 'conflict' });
  });

  it('gives one window to sixteen simultaneous reissues', async () => {
    const created = await openUpload('operation-race');
    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);
    await media.service.sweepExpiredUploads();

    const attempts = await Promise.all(
      Array.from({ length: 16 }, () =>
        media.service.reissueUpload({ assetId: created.asset.id, ...owner }),
      ),
    );
    for (const attempt of attempts) expect(attempt.kind).toBe('upload_ready');

    const open = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_upload_sessions
                   where asset_id = ${created.asset.id} and state = 'issued'`,
    );
    expect(open[0]?.count).toBe('1');
  });
});

describe('a window belongs to the owner that opened it', () => {
  it('does not reissue for another owner holding the identifier', async () => {
    const created = await openUpload('operation-owner');
    expect(
      await media.service.reissueUpload({
        assetId: created.asset.id,
        ...otherOwner,
      }),
    ).toEqual({ kind: 'not_found' });
  });

  it('does not complete another owner’s upload', async () => {
    const created = await openUpload('operation-complete-owner');
    await storage.putObject(await objectKeyOf(created.asset.id), jpegHeader);

    expect(
      await media.service.recordUpload({
        assetId: created.asset.id,
        ...otherOwner,
      }),
    ).toEqual({ kind: 'not_found' });
    // And the real owner still can, so the refusal denied the stranger rather
    // than breaking the upload.
    expect(
      await media.service.recordUpload({ assetId: created.asset.id, ...owner }),
    ).toMatchObject({ kind: 'asset' });
  });

  it('will not let one asset’s bytes complete another asset', async () => {
    const mine = await openUpload('operation-mine');
    const theirs = await openUpload('operation-theirs', otherOwner);

    // Bytes land under the other asset's key.
    await storage.putObject(await objectKeyOf(theirs.asset.id), jpegHeader);

    expect(
      await media.service.recordUpload({ assetId: mine.asset.id, ...owner }),
    ).toEqual({ kind: 'conflict' });
  });
});

describe('the crash window between the commit and the provider call', () => {
  it('leaves a recoverable session and recovers it', async () => {
    const created = await openUpload('operation-crash');
    // Exactly what a process death after the commit leaves behind: the rows are
    // there and the capability was never recorded.
    await database.sql.unsafe(
      `update media_upload_sessions set provider = null, provider_reference = null
       where asset_id = '${created.asset.id}'`,
    );

    const stranded = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_upload_sessions
                   where state = 'issued' and provider_reference is null`,
    );
    expect(stranded[0]?.count).toBe('1');

    expect(await media.service.recoverUploadCapabilities()).toBe(1);

    const [recovered] = await rowsOf<{
      readonly provider: string;
      readonly provider_reference: string;
    }>(
      database.sql`select provider, provider_reference from media_upload_sessions
                   where asset_id = ${created.asset.id}`,
    );
    expect(recovered?.provider).toBe('local-test');
    expect(recovered?.provider_reference).toContain('local-test:');
    // Recovery did not open a second window.
    const open = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_upload_sessions
                   where asset_id = ${created.asset.id} and state = 'issued'`,
    );
    expect(open[0]?.count).toBe('1');
  });
});

describe('an ambiguous provider is not a refusal', () => {
  /** A provider that accepts nothing and says nothing useful about why. */
  function timingOutStorage(): MediaStoragePort {
    const inner = storage;
    return {
      authorizeDelivery: (input) => inner.authorizeDelivery(input),
      createUploadCapability: (): Promise<MediaUploadCapability> =>
        Promise.reject(new Error('provider timed out')),
      deleteObject: (key) => inner.deleteObject(key),
      name: 'local-test',
      purge: (key) => inner.purge(key),
      readObject: (input): Promise<MediaObjectRead> => inner.readObject(input),
      statObject: (): Promise<MediaObjectStat | undefined> =>
        Promise.reject(new Error('provider timed out')),
      writeObject: (input) => inner.writeObject(input),
    };
  }

  it('records nothing and leaves the session recoverable', async () => {
    const stalling = new MediaService({
      logger: silentLogger(),
      now,
      repository: new MediaRepository(database.drizzle),
      storage: timingOutStorage(),
    });

    let thrown: unknown;
    try {
      await stalling.createUpload({
        assetClass: profileImage,
        idempotencyKey: 'operation-timeout',
        ...owner,
      });
    } catch (error) {
      thrown = error;
    }
    // A timeout is not a success and not a refusal. The caller is told nothing
    // worked, rather than being handed an outcome the platform cannot support.
    expect((thrown as Error).message).toContain('provider timed out');

    // The asset and its window exist, with no capability — the shape recovery
    // is built to find.
    const [session] = await rowsOf<{
      readonly provider_reference: string | null;
      readonly state: string;
    }>(
      database.sql`select provider_reference, state from media_upload_sessions`,
    );
    expect(session?.state).toBe('issued');
    expect(session?.provider_reference).toBeNull();
    expect(await media.service.recoverUploadCapabilities()).toBe(1);
  });

  it('reports an unapproved provider as unavailable rather than as an error', async () => {
    const refusing = new MediaService({
      logger: silentLogger(),
      now,
      repository: new MediaRepository(database.drizzle),
      storage: {
        authorizeDelivery: () =>
          Promise.reject(new MediaStorageUnavailableError()),
        createUploadCapability: () =>
          Promise.reject(new MediaStorageUnavailableError()),
        deleteObject: () => Promise.reject(new MediaStorageUnavailableError()),
        name: 'unavailable',
        purge: () => Promise.reject(new MediaStorageUnavailableError()),
        readObject: () => Promise.reject(new MediaStorageUnavailableError()),
        statObject: () => Promise.reject(new MediaStorageUnavailableError()),
        writeObject: () => Promise.reject(new MediaStorageUnavailableError()),
      },
    });

    expect(
      await refusing.createUpload({
        assetClass: profileImage,
        idempotencyKey: 'operation-unavailable',
        ...owner,
      }),
    ).toEqual({ kind: 'storage_unavailable' });
  });
});

describe('windows nobody finished are reclaimed', () => {
  it('closes spent windows in bounded batches without touching live ones', async () => {
    const spent = [
      await openUpload('operation-spent-one'),
      await openUpload('operation-spent-two'),
      await openUpload('operation-spent-three'),
    ];

    // Move past the window, then open one more so the sweep has both a spent
    // set and a live window to choose between.
    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);
    const fresh = await openUpload('operation-fresh');

    // Bounded: a backlog drains over several cycles rather than in one
    // statement holding a transaction open across everything.
    expect(await media.service.sweepExpiredUploads({ limit: 2 })).toBe(2);
    expect(await media.service.sweepExpiredUploads({ limit: 2 })).toBe(1);
    expect(await media.service.sweepExpiredUploads({ limit: 2 })).toBe(0);

    const open = await rowsOf<{ readonly asset_id: string }>(
      database.sql`select asset_id from media_upload_sessions where state = 'issued'`,
    );
    expect(open.map((row) => row.asset_id)).toEqual([fresh.asset.id]);

    const expired = await rowsOf<{ readonly asset_id: string }>(
      database.sql`select asset_id from media_upload_sessions
                   where state = 'expired' order by asset_id`,
    );
    expect(expired.map((row) => row.asset_id).toSorted()).toEqual(
      spent.map((one) => one.asset.id).toSorted(),
    );
  });

  it('reclaims an asset that never received bytes once it has gone quiet', async () => {
    const abandoned = await openUpload('operation-abandoned');

    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);
    await media.service.sweepExpiredUploads();
    // Not yet: quiet is measured from the last lifecycle change, and somebody
    // may still come back and reissue within the technical TTL.
    expect(await media.service.sweepAbandonedUploads()).toBe(0);

    clock = new Date(
      clock.getTime() + mediaAbandonedUploadMilliseconds + 1_000,
    );
    expect(await media.service.sweepAbandonedUploads()).toBe(1);

    const [row] = await rowsOf<{ readonly lifecycle: string }>(
      database.sql`select lifecycle from media_assets where id = ${abandoned.asset.id}`,
    );
    // Reclaimed through the ordinary deletion path, so whatever bytes did reach
    // the provider are a recorded obligation rather than an orphan.
    expect(row?.lifecycle).toBe('deleting');
    const obligations = await rowsOf<{ readonly kind: string }>(
      database.sql`select kind from media_obligations where asset_id = ${abandoned.asset.id}`,
    );
    expect(obligations).toEqual([{ kind: 'delete' }]);
  });

  it('leaves an asset alone while its window is still open', async () => {
    const live = await openUpload('operation-still-going');
    clock = new Date(
      clock.getTime() + mediaAbandonedUploadMilliseconds + 1_000,
    );

    // A live capability is somebody's upload in progress, however old the row.
    expect(await media.service.sweepAbandonedUploads()).toBe(0);
    const [row] = await rowsOf<{ readonly lifecycle: string }>(
      database.sql`select lifecycle from media_assets where id = ${live.asset.id}`,
    );
    expect(row?.lifecycle).toBe('awaiting_upload');
  });

  it('does not reclaim an asset that received bytes', async () => {
    const uploaded = await openUpload('operation-arrived');
    await storage.putObject(await objectKeyOf(uploaded.asset.id), jpegHeader);
    await media.service.recordUpload({ assetId: uploaded.asset.id, ...owner });

    clock = new Date(
      clock.getTime() + mediaAbandonedUploadMilliseconds + 1_000,
    );
    expect(await media.service.sweepAbandonedUploads()).toBe(0);
  });

  it('lets two workers sweep at once and close each window once between them', async () => {
    await Promise.all([
      openUpload('operation-parallel-one'),
      openUpload('operation-parallel-two'),
      openUpload('operation-parallel-three'),
    ]);
    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);

    const [first, second] = await Promise.all([
      media.service.sweepExpiredUploads(),
      media.service.sweepExpiredUploads(),
    ]);
    expect(first + second).toBe(3);

    const open = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_upload_sessions
                   where state = 'issued'`,
    );
    expect(open[0]?.count).toBe('0');
  });
});
