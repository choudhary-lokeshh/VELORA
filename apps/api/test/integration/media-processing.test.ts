import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  mediaProcessingVersion,
  mediaVariantGeometry,
  requiredMediaVariants,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import * as fixture from '../support/media-fixtures.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * Rendering the platform's own delivery artefacts.
 *
 * The privacy guarantee is the reason this phase exists, and it rests on one
 * structural fact rather than on a stripping step somebody could forget: a
 * derivative is built from decoded pixels and an encoder, so there is no path
 * by which a source's EXIF, GPS, device identity, or colour profile could reach
 * it. The tests below prove the source really carries those things first, so
 * their absence downstream means something.
 */

const databaseUrl = await provisionDatabase('velora_media_processing');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-process-'));

const media = createMediaRuntime({
  config: testServerConfig({
    MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
    MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
    MEDIA_MALWARE_SCANNER: 'local-test',
    MEDIA_STORAGE_PROVIDER: 'local-test',
  }),
  database: database.drizzle,
  logger: silentLogger(),
  performsByteWork: true,
});
const storage = media.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '11111111-1111-4111-8111-111111111111',
};
let operation = 0;

/** Carries an asset all the way to `inspected`, ready for processing. */
async function uploadAndInspect(
  bytes: Uint8Array,
  assetClass: MediaAssetClass = 'consumer_profile_image',
): Promise<string> {
  operation += 1;
  const created = await media.service.createUpload({
    assetClass,
    idempotencyKey: `processing-${String(operation).padStart(4, '0')}`,
    ...owner,
  });
  if (created.kind !== 'upload_ready') {
    throw new Error(`expected an upload, got ${created.kind}`);
  }
  const [session] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${created.asset.id} and state = 'issued'`,
  );
  await storage.putObject(session?.object_key ?? '', bytes);
  await media.service.recordUpload({ assetId: created.asset.id, ...owner });
  await media.service.runInspections({ owner: 'test-worker' });
  return created.asset.id;
}

async function variantsOf(assetId: string) {
  return rowsOf<{
    readonly byte_size: number;
    readonly format: string;
    readonly height: number;
    readonly object_key: string;
    readonly processing_version: number;
    readonly variant_kind: string;
    readonly width: number;
  }>(
    database.sql`select byte_size, format, height, object_key,
                        processing_version, variant_kind, width
                 from media_objects
                 where asset_id = ${assetId} and role = 'variant'
                 order by variant_kind`,
  );
}

/**
 * Whether the bytes carry a GPS directory pointer (EXIF tag 0x8825).
 *
 * A stronger question than "does the decoder report an EXIF block", because it
 * looks for the specific structure that carries a location rather than for the
 * container that happens to hold it.
 */
function hasGpsDirectory(bytes: Uint8Array): boolean {
  for (let index = 0; index + 1 < bytes.length; index += 1) {
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x88) return true;
  }
  return false;
}

async function lifecycleOf(assetId: string): Promise<string> {
  const [row] = await rowsOf<{ readonly lifecycle: string }>(
    database.sql`select lifecycle from media_assets where id = ${assetId}`,
  );
  return row?.lifecycle ?? 'missing';
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('nothing private survives into a derivative', () => {
  it('drops GPS, device identity, and every other tag', async () => {
    const source = await fixture.imageWithPrivateMetadata();

    // The source really carries all of it, so its absence downstream means
    // something rather than being a fixture that never had any.
    const sourceMetadata = await sharp(Buffer.from(source.bytes)).metadata();
    expect(sourceMetadata.exif?.byteLength ?? 0).toBeGreaterThan(0);
    expect(Buffer.from(source.bytes).toString('latin1')).toContain(
      source.deviceMarker,
    );
    // A real GPS directory, not merely an EXIF block that might have held one.
    expect(hasGpsDirectory(sourceMetadata.exif ?? new Uint8Array())).toBe(true);

    const assetId = await uploadAndInspect(source.bytes);
    await media.service.runProcessing({ owner: 'test-worker' });

    const variants = await variantsOf(assetId);
    expect(variants.length).toBeGreaterThan(0);
    for (const variant of variants) {
      const read = await storage.readObject({
        maximumBytes: 5_000_000,
        objectKey: variant.object_key,
      });
      if (read.kind !== 'bytes') throw new Error('variant bytes missing');

      const metadata = await sharp(Buffer.from(read.bytes)).metadata();
      expect(metadata.exif, variant.variant_kind).toBeUndefined();
      expect(metadata.icc, variant.variant_kind).toBeUndefined();
      expect(metadata.xmp, variant.variant_kind).toBeUndefined();
      // Not only "no EXIF block": the device string does not appear anywhere in
      // the bytes, which is the version of this claim that survives a decoder
      // reporting metadata differently one day.
      expect(
        Buffer.from(read.bytes).toString('latin1'),
        variant.variant_kind,
      ).not.toContain(source.deviceMarker);
      expect(hasGpsDirectory(read.bytes), variant.variant_kind).toBe(false);
    }
  });

  it('bakes orientation into pixels rather than leaving a tag to honour', async () => {
    const source = await fixture.imageWithPrivateMetadata();
    // Landscape bytes, tagged to display as portrait.
    const sourceMetadata = await sharp(Buffer.from(source.bytes)).metadata();
    expect(sourceMetadata.width).toBe(120);
    expect(sourceMetadata.height).toBe(60);
    expect(sourceMetadata.orientation).toBe(6);

    const assetId = await uploadAndInspect(source.bytes);
    await media.service.runProcessing({ owner: 'test-worker' });

    const [display] = (await variantsOf(assetId)).filter(
      (variant) => variant.variant_kind === 'display',
    );
    // Portrait. Had the rotation not been applied before the tag was dropped,
    // this would be 120×60 and would render sideways for ever.
    expect(display?.width).toBe(60);
    expect(display?.height).toBe(120);
  });
});

describe('the derivative set a class owes', () => {
  it('produces exactly the required kinds and reaches ready', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'jpeg', height: 900, width: 1200 }),
    );
    await media.service.runProcessing({ owner: 'test-worker' });

    expect(await lifecycleOf(assetId)).toBe('ready');
    const variants = await variantsOf(assetId);
    expect(variants.map((variant) => variant.variant_kind)).toEqual(
      [...requiredMediaVariants.consumer_profile_image].toSorted(),
    );
    for (const variant of variants) {
      expect(variant.format).toBe('webp');
      expect(variant.processing_version).toBe(mediaProcessingVersion);
      expect(variant.byte_size).toBeGreaterThan(0);
    }
  });

  it('honours each kind’s geometry', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'png', height: 900, width: 1200 }),
    );
    await media.service.runProcessing({ owner: 'test-worker' });

    for (const variant of await variantsOf(assetId)) {
      const geometry =
        mediaVariantGeometry[
          variant.variant_kind as keyof typeof mediaVariantGeometry
        ];
      if (geometry.fit === 'cover') {
        // A square slot gets a square image.
        expect(variant.width, variant.variant_kind).toBe(geometry.width);
        expect(variant.height, variant.variant_kind).toBe(geometry.height);
      } else {
        // A bounding box preserves aspect and never exceeds either side.
        expect(variant.width, variant.variant_kind).toBeLessThanOrEqual(
          geometry.width,
        );
        expect(variant.height, variant.variant_kind).toBeLessThanOrEqual(
          geometry.height,
        );
        expect(variant.width / variant.height).toBeCloseTo(1200 / 900, 1);
      }
    }
  });

  it('does not enlarge a source smaller than the box', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'png', height: 20, width: 20 }),
    );
    await media.service.runProcessing({ owner: 'test-worker' });

    const [display] = (await variantsOf(assetId)).filter(
      (variant) => variant.variant_kind === 'display',
    );
    // Twenty, not sixteen hundred. A recorded dimension describes picture
    // rather than padding.
    expect(display?.width).toBe(20);
  });

  it('owes a different set to a different class', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'webp' }),
      'creator_cover_image',
    );
    await media.service.runProcessing({ owner: 'test-worker' });

    expect((await variantsOf(assetId)).map((one) => one.variant_kind)).toEqual(
      [...requiredMediaVariants.creator_cover_image].toSorted(),
    );
  });
});

describe('processing is idempotent under concurrency', () => {
  it('settles fifty simultaneous attempts into one derivative set', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'jpeg' }),
    );

    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        media.service.runProcessing({ owner: `worker-${String(index)}` }),
      ),
    );

    const variants = await variantsOf(assetId);
    expect(variants).toHaveLength(
      requiredMediaVariants.consumer_profile_image.length,
    );
    // One object key per variant, so no worker wrote bytes a row does not name.
    expect(new Set(variants.map((one) => one.object_key)).size).toBe(
      variants.length,
    );
    expect(await lifecycleOf(assetId)).toBe('ready');

    // Worth being precise about what this proves. Two mechanisms stand between
    // fifty attempts and fifty derivative sets, and this exercises the first:
    // the obligation lease, which means only one worker is doing the rendering
    // at all. The second is the partial unique index over asset, variant kind,
    // and processing version, which is what would refuse a duplicate if two
    // writers ever did get that far — and that one is proven directly, by
    // inserting the same variant twice, in the foundation suite.
  });

  it('re-renders only what is missing when an attempt is repeated', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'png' }),
    );
    await media.service.runProcessing({ owner: 'test-worker' });
    const first = await variantsOf(assetId);

    // A second pass finds the asset ready and does nothing at all.
    await media.repository.appendObligation(media.repository.transactionless, {
      assetId,
      id: crypto.randomUUID(),
      kind: 'process',
      now: new Date(),
    });
    await media.service.runProcessing({ owner: 'test-worker' });

    const second = await variantsOf(assetId);
    expect(second.map((one) => one.object_key)).toEqual(
      first.map((one) => one.object_key),
    );
  });
});

describe('processing refuses what it cannot render from', () => {
  it('quarantines when the original has gone missing', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'png' }),
    );
    const [original] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects
                   where asset_id = ${assetId} and role = 'original'`,
    );
    await storage.deleteObject(original?.object_key ?? '');

    await media.service.runProcessing({ owner: 'test-worker' });

    expect(await lifecycleOf(assetId)).toBe('quarantined');
    expect(await variantsOf(assetId)).toHaveLength(0);
  });

  it('leaves a quarantined asset alone', async () => {
    const assetId = await uploadAndInspect(fixture.svg());
    expect(await lifecycleOf(assetId)).toBe('quarantined');

    // Nothing owed it processing, and forcing one changes nothing.
    await media.repository.appendObligation(media.repository.transactionless, {
      assetId,
      id: crypto.randomUUID(),
      kind: 'process',
      now: new Date(),
    });
    await media.service.runProcessing({ owner: 'test-worker' });

    expect(await lifecycleOf(assetId)).toBe('quarantined');
    expect(await variantsOf(assetId)).toHaveLength(0);
  });

  it('does not process an asset that is being removed', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'png' }),
    );
    await media.service.requestDeletion({ assetId });

    await media.service.runProcessing({ owner: 'test-worker' });

    expect(await lifecycleOf(assetId)).toBe('deleting');
    expect(await variantsOf(assetId)).toHaveLength(0);
  });
});

describe('the original stays the original', () => {
  it('is never itself a variant and keeps its own recorded facts', async () => {
    const assetId = await uploadAndInspect(
      await fixture.image({ format: 'jpeg', height: 900, width: 1200 }),
    );
    await media.service.runProcessing({ owner: 'test-worker' });

    const [original] = await rowsOf<{
      readonly format: string;
      readonly height: number;
      readonly processing_version: number | null;
      readonly variant_kind: string | null;
      readonly width: number;
    }>(
      database.sql`select format, height, processing_version, variant_kind, width
                   from media_objects
                   where asset_id = ${assetId} and role = 'original'`,
    );
    // Unchanged by processing: still a JPEG at its own size, with no variant
    // kind and no processing version, because nothing rendered it.
    expect(original?.format).toBe('jpeg');
    expect(original?.width).toBe(1200);
    expect(original?.variant_kind).toBeNull();
    expect(original?.processing_version).toBeNull();
  });
});
