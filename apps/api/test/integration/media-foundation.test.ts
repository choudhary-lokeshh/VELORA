import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  mediaObjectKey,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import { InvalidMediaTransitionError } from '../../src/media/repository.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import {
  connectDatabase,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * The MEDIA foundation, against a real PostgreSQL.
 *
 * Most of what this domain promises is enforced by the database rather than by
 * a service, and that is deliberate: an invariant a code path can forget is not
 * an invariant. So these tests write directly where the guarantee is a
 * constraint, and go through the service where the guarantee is an ordering.
 *
 * There are no HTTP routes yet. Upload orchestration, inspection, processing,
 * and delivery arrive in later phases; what is proved here is that the storage
 * underneath them cannot hold a state that lies.
 */

const databaseUrl = await provisionDatabase('velora_media_foundation');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-foundation-'));

const config = testServerConfig({
  MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
  MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
  MEDIA_STORAGE_PROVIDER: 'local-test',
});

const media = createMediaRuntime({
  config,
  database: database.drizzle,
  logger: silentLogger(),
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

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('one asset per owner operation', () => {
  it('settles fifty simultaneous initiations into one asset', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 50 }, () =>
        media.service.createUpload({
          assetClass: profileImage,
          idempotencyKey: 'operation-one',
          ...owner,
        }),
      ),
    );

    const identifiers = new Set(
      attempts.map((attempt) =>
        attempt.kind === 'upload_ready' || attempt.kind === 'asset'
          ? attempt.asset.id
          : attempt.kind,
      ),
    );
    expect(identifiers.size).toBe(1);

    const assets = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_assets`,
    );
    expect(assets[0]?.count).toBe('1');
    // And exactly one upload window, so a duplicate initiation cannot leave a
    // second live capability against the same object.
    const sessions = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_upload_sessions`,
    );
    expect(sessions[0]?.count).toBe('1');
  });

  it('refuses a reused operation identity that asks for something else', async () => {
    const first = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-two',
      ...owner,
    });
    expect(first.kind).toBe('upload_ready');

    const reused = await media.service.createUpload({
      assetClass: 'creator_avatar_image',
      idempotencyKey: 'operation-two',
      ...owner,
    });
    // Silently returning the first asset would hand the caller something other
    // than what it asked for.
    expect(reused.kind).toBe('idempotency_conflict');
  });

  it('scopes an operation identity to its owner', async () => {
    const mine = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'shared-word',
      ...owner,
    });
    const theirs = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'shared-word',
      ...otherOwner,
    });

    expect(mine.kind).toBe('upload_ready');
    expect(theirs.kind).toBe('upload_ready');
    if (mine.kind !== 'upload_ready' || theirs.kind !== 'upload_ready') return;
    expect(mine.asset.id).not.toBe(theirs.asset.id);
  });
});

describe('an asset belongs to the owner that asked for it', () => {
  it('does not answer another owner asking for it by identifier', async () => {
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-three',
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    expect(
      await media.service.readOwned({ assetId: created.asset.id, ...owner }),
    ).toMatchObject({ kind: 'asset' });
    // Knowing the identifier is not knowing the owner.
    expect(
      await media.service.readOwned({
        assetId: created.asset.id,
        ...otherOwner,
      }),
    ).toEqual({ kind: 'not_found' });
    // Nor is being the same account under a different domain's authority.
    expect(
      await media.service.readOwned({
        assetId: created.asset.id,
        ownerDomain: 'creators',
        ownerReference: owner.ownerReference,
      }),
    ).toEqual({ kind: 'not_found' });
  });
});

describe('what the platform hands a client', () => {
  it('carries an address and nothing about the provider', async () => {
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-four',
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    const [session] = await rowsOf<{
      readonly object_key: string;
      readonly provider: string;
      readonly provider_reference: string;
    }>(
      database.sql`select object_key, provider, provider_reference from media_upload_sessions`,
    );
    expect(session?.provider).toBe('local-test');
    expect(session?.provider_reference).toContain('local-test:');

    // The handoff is an address, a method, a ceiling, and an expiry, and it
    // carries no field naming the adapter or its capability handle.
    //
    // The object key is the one thing that unavoidably appears, inside the
    // upload address itself, because a direct-to-storage capability is an
    // address for one object and cannot be anything else. That costs nothing:
    // it is the key of the caller's own object, it is unguessable, and key
    // knowledge is not part of the authorization model. What must never be
    // true is that a key could be *derived* — hence the random component.
    const serialized = JSON.stringify(created.capability);
    expect(serialized).not.toContain(session?.provider_reference ?? 'absent');
    expect(serialized).not.toContain('local-test:');
    expect(created.capability.url).toContain(session?.object_key ?? 'absent');
    expect(Object.keys(created.capability).toSorted()).toEqual([
      'assetId',
      'expiresAt',
      'headers',
      'maximumBytes',
      'method',
      'url',
    ]);
  });
});

describe('the lifecycle only advances the way the map says', () => {
  it('refuses a transition that is not on the map before touching the row', async () => {
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-five',
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    let refusal: unknown;
    try {
      await media.repository.transitionAsset(media.repository.transactionless, {
        assetId: created.asset.id,
        expectedLifecycle: 'awaiting_upload',
        lifecycle: 'ready',
        now: new Date(),
        readyAt: new Date(),
      });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(InvalidMediaTransitionError);

    const [row] = await rowsOf<{ readonly lifecycle: string }>(
      database.sql`select lifecycle from media_assets where id = ${created.asset.id}`,
    );
    expect(row?.lifecycle).toBe('awaiting_upload');
  });

  it('applies nothing when the expected state is stale', async () => {
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-six',
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    // Two writers believe the asset is `initiated`; it is not, because the
    // service already advanced it. Neither may apply.
    const results = await Promise.all([
      media.repository.transitionAsset(media.repository.transactionless, {
        assetId: created.asset.id,
        expectedLifecycle: 'initiated',
        lifecycle: 'awaiting_upload',
        now: new Date(),
      }),
      media.repository.transitionAsset(media.repository.transactionless, {
        assetId: created.asset.id,
        expectedLifecycle: 'initiated',
        lifecycle: 'awaiting_upload',
        now: new Date(),
      }),
    ]);
    expect(results).toEqual([undefined, undefined]);
  });
});

describe('an upload is recorded only once the provider agrees', () => {
  it('refuses completion while no object exists, and accepts it afterwards', async () => {
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-seven',
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    // The client says it uploaded. It did not.
    expect(
      await media.service.recordUpload({
        assetId: created.asset.id,
        ...owner,
      }),
    ).toEqual({ kind: 'conflict' });

    const [session] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_upload_sessions`,
    );
    await storage.putObject(
      session?.object_key ?? '',
      new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
    );

    const recorded = await media.service.recordUpload({
      assetId: created.asset.id,
      ...owner,
    });
    expect(recorded).toMatchObject({ kind: 'asset' });
    if (recorded.kind !== 'asset') return;
    // `uploaded` means an object exists. It does not mean anybody believes it.
    expect(recorded.asset.lifecycle).toBe('uploaded');
    expect(recorded.asset.detectedFormat).toBeNull();
    expect(recorded.asset.byteSize).toBeNull();

    // The inspection duty is durable before any queue hears about it.
    const obligations = await rowsOf<{
      readonly kind: string;
      readonly state: string;
    }>(
      database.sql`select kind, state from media_obligations where asset_id = ${created.asset.id}`,
    );
    expect(obligations).toEqual([{ kind: 'inspect', state: 'pending' }]);

    // Repeating a completion that already landed is a no-op success.
    const repeated = await media.service.recordUpload({
      assetId: created.asset.id,
      ...owner,
    });
    expect(repeated).toMatchObject({ kind: 'asset' });
    const sessions = await rowsOf<{ readonly state: string }>(
      database.sql`select state from media_upload_sessions`,
    );
    expect(sessions).toEqual([{ state: 'completed' }]);
  });
});

describe('removal is owed before it is done', () => {
  it('stops the window, records the duty, and is idempotent', async () => {
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-eight',
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    const deleted = await media.service.requestDeletion({
      assetId: created.asset.id,
    });
    expect(deleted).toMatchObject({ kind: 'asset' });
    if (deleted.kind !== 'asset') return;
    expect(deleted.asset.lifecycle).toBe('deleting');
    expect(deleted.asset.deletionRequestedAt).not.toBeNull();

    const sessions = await rowsOf<{ readonly state: string }>(
      database.sql`select state from media_upload_sessions`,
    );
    expect(sessions).toEqual([{ state: 'abandoned' }]);

    const obligations = await rowsOf<{ readonly kind: string }>(
      database.sql`select kind from media_obligations where asset_id = ${created.asset.id}`,
    );
    expect(obligations).toEqual([{ kind: 'delete' }]);

    // Asking twice owes it once.
    const again = await media.service.requestDeletion({
      assetId: created.asset.id,
    });
    expect(again).toMatchObject({ kind: 'asset' });
    const afterwards = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_obligations`,
    );
    expect(afterwards[0]?.count).toBe('1');
  });

  it('tells every simultaneous caller the removal is under way', async () => {
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: 'operation-nine',
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    // Sixteen callers read the same pre-deletion state and then race. One
    // transition applies. Reporting a conflict to the other fifteen would
    // invite them to retry a duty that is already owed, so each is told what
    // is true: the asset is being removed.
    const attempts = await Promise.all(
      Array.from({ length: 16 }, () =>
        media.service.requestDeletion({ assetId: created.asset.id }),
      ),
    );
    for (const attempt of attempts) {
      expect(attempt.kind).toBe('asset');
      if (attempt.kind !== 'asset') continue;
      expect(attempt.asset.lifecycle).toBe('deleting');
    }

    const obligations = await rowsOf<{ readonly count: string }>(
      database.sql`select count(*)::text as count from media_obligations`,
    );
    expect(obligations[0]?.count).toBe('1');
  });
});

describe('the database refuses a state that lies', () => {
  async function seedAsset(): Promise<string> {
    const id = crypto.randomUUID();
    await database.sql.unsafe(
      `insert into media_assets (asset_class, created_at, id, idempotency_key, lifecycle, lifecycle_changed_at, owner_domain, owner_reference, updated_at)
       values ('consumer_profile_image', now(), '${id}', '${id}', 'initiated', now(), 'users', '${owner.ownerReference}', now())`,
    );
    return id;
  }

  it('will not let a lifecycle claim knowledge it does not carry', async () => {
    const id = await seedAsset();
    // `inspected` without measurements, `ready` without an instant, and a
    // quarantine without a reason are each refused by a constraint rather than
    // by whichever service happened to write the row.
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_assets set lifecycle = 'inspected' where id = '${id}'`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_assets set lifecycle = 'ready', detected_format = 'jpeg', byte_size = 10, digest = '${'a'.repeat(64)}', width = 10, height = 10 where id = '${id}'`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_assets set lifecycle = 'quarantined' where id = '${id}'`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_assets set lifecycle = 'deleted', deleted_at = now() where id = '${id}'`,
        ),
      ),
    ).toBe(true);
  });

  it('bounds every measurement it stores', async () => {
    const id = await seedAsset();
    for (const clause of [
      `byte_size = 0`,
      `byte_size = 15728641`,
      `width = 12001`,
      `height = 12001`,
      `width = 11000, height = 11000`,
      `frame_count = 2`,
      `frame_count = 0`,
      `digest = 'not-a-digest'`,
      `detected_format = 'svg'`,
      `rejection_reason = 'because'`,
      `asset_class = 'video'`,
      `owner_domain = 'billing'`,
      `lifecycle = 'published'`,
      `version = 0`,
    ]) {
      expect(
        await refused(() =>
          database.sql.unsafe(
            `update media_assets set ${clause} where id = '${id}'`,
          ),
        ),
        clause,
      ).toBe(true);
    }
  });

  it('holds one original and one variant per kind per processing version', async () => {
    const assetId = await seedAsset();
    const insertObject = (
      role: string,
      kind: string | null,
      version: number | null,
    ) =>
      database.sql.unsafe(
        `insert into media_objects (asset_id, created_at, id, object_key, processing_version, provider, role, state, updated_at, variant_kind)
         values ('${assetId}', now(), '${crypto.randomUUID()}', '${mediaObjectKey(
           role === 'original'
             ? { assetId, role: 'original' }
             : {
                 assetId,
                 processingVersion: version ?? 1,
                 role: 'variant',
                 variantKind: 'avatar_small',
               },
         )}', ${version === null ? 'null' : String(version)}, 'local-test', '${role}', 'present', now(), ${kind === null ? 'null' : `'${kind}'`})`,
      );

    await insertObject('original', null, null);
    // Fifty attempts, one truth. This is where concurrent processing collapses.
    expect(await refused(() => insertObject('original', null, null))).toBe(
      true,
    );

    await insertObject('variant', 'avatar_small', 1);
    expect(
      await refused(() => insertObject('variant', 'avatar_small', 1)),
    ).toBe(true);
    // A new processing version is a new derivative, not a mutation of the old.
    await insertObject('variant', 'avatar_small', 2);

    // A variant is exactly the thing with a kind and a version.
    expect(await refused(() => insertObject('variant', null, 1))).toBe(true);
    expect(await refused(() => insertObject('original', 'card', 1))).toBe(true);
  });

  it('will not owe the same duty twice, for an asset or for an object', async () => {
    const assetId = await seedAsset();
    const objectId = crypto.randomUUID();
    await database.sql.unsafe(
      `insert into media_objects (asset_id, created_at, id, object_key, provider, role, state, updated_at)
       values ('${assetId}', now(), '${objectId}', '${mediaObjectKey({ assetId, role: 'original' })}', 'local-test', 'original', 'present', now())`,
    );

    const obligation = (kind: string, object: string | null) =>
      database.sql.unsafe(
        `insert into media_obligations (asset_id, available_at, created_at, id, kind, object_id, state, updated_at)
         values ('${assetId}', now(), now(), '${crypto.randomUUID()}', '${kind}', ${object === null ? 'null' : `'${object}'`}, 'pending', now())`,
      );

    await obligation('inspect', null);
    expect(await refused(() => obligation('inspect', null))).toBe(true);
    // A different kind against the same asset is a different duty.
    await obligation('process', null);

    await obligation('purge', objectId);
    expect(await refused(() => obligation('purge', objectId))).toBe(true);

    // A lease belongs to a row somebody may still be working on.
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_obligations set state = 'completed', completed_at = now(), lease_owner = 'worker', lease_expires_at = now() where kind = 'process'`,
        ),
      ),
    ).toBe(true);
    // And a lease without an expiry is not a lease.
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_obligations set lease_owner = 'worker' where kind = 'process'`,
        ),
      ),
    ).toBe(true);
  });

  it('keeps every object key unique across the whole platform', async () => {
    const first = await seedAsset();
    const second = await seedAsset();
    const key = mediaObjectKey({ assetId: first, role: 'original' });

    await database.sql.unsafe(
      `insert into media_objects (asset_id, created_at, id, object_key, provider, role, state, updated_at)
       values ('${first}', now(), '${crypto.randomUUID()}', '${key}', 'local-test', 'original', 'present', now())`,
    );
    // Two assets cannot share bytes by sharing an address, so one owner's media
    // can never be overwritten by another's.
    expect(
      await refused(() =>
        database.sql.unsafe(
          `insert into media_objects (asset_id, created_at, id, object_key, provider, role, state, updated_at)
           values ('${second}', now(), '${crypto.randomUUID()}', '${key}', 'local-test', 'original', 'present', now())`,
        ),
      ),
    ).toBe(true);
  });
});
