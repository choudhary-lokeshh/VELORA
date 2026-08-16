import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  maximumMediaMetadataBytes,
  mediaObligationLeaseMilliseconds,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import { localTestInfectedMarker } from '../../src/media/scanner.js';
import { sniffMediaFormat } from '../../src/media/sniff.js';
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
 * Authoritative technical inspection, and the quarantine behind it.
 *
 * Every fixture is generated rather than committed, so a hostile input is a
 * description in code instead of an opaque file. None of them is real malware:
 * the scanner case carries a Velora marker string the development scanner
 * refuses on sight, which exercises the refusal path without asking a developer
 * machine's anti-virus to quarantine the repository.
 *
 * The property under test is one sentence. Nothing reaches a state the platform
 * would act on unless the platform derived, from the bytes themselves, that it
 * should — and every way of failing to derive that ends in quarantine rather
 * than in an exception, a retry loop, or a pass.
 */

const databaseUrl = await provisionDatabase('velora_media_inspection');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-inspect-'));

function runtime(scanner: 'local-test' | 'unavailable') {
  return createMediaRuntime({
    config: testServerConfig({
      MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
      MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
      MEDIA_MALWARE_SCANNER: scanner,
      MEDIA_STORAGE_PROVIDER: 'local-test',
    }),
    database: database.drizzle,
    inspects: true,
    logger: silentLogger(),
  });
}

const media = runtime('local-test');
const storage = media.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '11111111-1111-4111-8111-111111111111',
};
const profileImage: MediaAssetClass = 'consumer_profile_image';
let operation = 0;

/** Uploads bytes and records the completion, leaving the asset `uploaded`. */
async function upload(bytes: Uint8Array): Promise<string> {
  operation += 1;
  const created = await media.service.createUpload({
    assetClass: profileImage,
    idempotencyKey: `inspection-${String(operation).padStart(4, '0')}`,
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
  return created.asset.id;
}

async function assetRow(assetId: string) {
  const [row] = await rowsOf<{
    readonly byte_size: number | null;
    readonly detected_format: string | null;
    readonly digest: string | null;
    readonly frame_count: number | null;
    readonly height: number | null;
    readonly lifecycle: string;
    readonly rejection_reason: string | null;
    readonly width: number | null;
  }>(
    database.sql`select byte_size, detected_format, digest, frame_count, height,
                        lifecycle, rejection_reason, width
                 from media_assets where id = ${assetId}`,
  );
  if (row === undefined) throw new Error('asset not found');
  return row;
}

/** Uploads, inspects, and returns the resulting row. */
async function inspected(bytes: Uint8Array) {
  const assetId = await upload(bytes);
  await media.service.runInspections({ owner: 'test-worker' });
  return assetRow(assetId);
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('the allow-list runs before the decoder', () => {
  it('refuses SVG, which the decoder would otherwise render happily', async () => {
    const document = fixture.svg();

    // The control is load-bearing rather than theoretical. libvips reads this
    // document and reports a perfectly sensible image, so an allow-list meaning
    // "whatever the decoder accepts" would accept an XML dialect with script
    // capability on a social platform.
    const asDecoder = await sharp(Buffer.from(document)).metadata();
    expect(asDecoder.format).toBe('svg');
    expect(asDecoder.width).toBe(64);

    // The platform never asks it.
    expect(sniffMediaFormat(document)).toBeUndefined();
    const row = await inspected(document);
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('unsupported_format');
  });

  it('refuses a format that is simply not on the list', async () => {
    // libvips decodes GIF too. Being decodable is not the question.
    const decoded = await sharp(Buffer.from(fixture.gif())).metadata();
    expect(decoded.format).toBe('gif');

    const row = await inspected(fixture.gif());
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('unsupported_format');
  });

  it('treats a header and a decoder disagreeing as the polyglot signal', async () => {
    const file = await fixture.polyglot();
    expect(sniffMediaFormat(file)).toBe('jpeg');

    const row = await inspected(file);
    expect(row.lifecycle).toBe('quarantined');
    // The decoder cannot read the JPEG it was told to expect.
    expect(row.rejection_reason).toBe('undecodable');
  });
});

describe('what the platform records about an accepted object', () => {
  it('derives every fact from the bytes and nothing from a claim', async () => {
    const row = await inspected(
      await fixture.image({ format: 'png', height: 48, width: 96 }),
    );

    expect(row.lifecycle).toBe('inspected');
    expect(row.detected_format).toBe('png');
    expect(row.width).toBe(96);
    expect(row.height).toBe(48);
    expect(row.frame_count).toBe(1);
    expect(row.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(row.byte_size).toBeGreaterThan(0);
    expect(row.rejection_reason).toBeNull();
  });

  it('records the same facts on the stored object', async () => {
    const assetId = await upload(await fixture.image({ format: 'jpeg' }));
    await media.service.runInspections({ owner: 'test-worker' });

    const [object] = await rowsOf<{
      readonly digest: string;
      readonly format: string;
      readonly height: number;
      readonly width: number;
    }>(
      database.sql`select digest, format, height, width from media_objects
                   where asset_id = ${assetId}`,
    );
    expect(object?.format).toBe('jpeg');
    expect(object?.width).toBe(64);
    expect(object?.digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('owes processing next, written by the transaction that justified it', async () => {
    const assetId = await upload(await fixture.image({ format: 'webp' }));
    await media.service.runInspections({ owner: 'test-worker' });

    const obligations = await rowsOf<{
      readonly kind: string;
      readonly state: string;
    }>(
      database.sql`select kind, state from media_obligations
                   where asset_id = ${assetId} order by kind`,
    );
    expect(obligations).toEqual([
      { kind: 'inspect', state: 'completed' },
      { kind: 'process', state: 'pending' },
    ]);
  });

  it('accepts every format on the list and nothing else', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      const row = await inspected(await fixture.image({ format }));
      expect(row.lifecycle, format).toBe('inspected');
      expect(row.detected_format, format).toBe(format);
    }
  });
});

describe('the limits are refusals rather than discoveries', () => {
  it('names a pixel bomb for what it is instead of calling it undecodable', async () => {
    // The distinction matters: with the decoder's own pixel limit applied to
    // the header read, this file throws and every bomb is recorded as merely
    // undecodable. Reading the header without the limit costs nothing and the
    // platform's own ceiling produces the precise reason.
    const row = await inspected(
      await fixture.pixelBombPng({ height: 60_000, width: 60_000 }),
    );
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('dimensions_exceeded');
  });

  it('refuses a pixel count that no single dimension gives away', async () => {
    // Both dimensions are under the per-dimension ceiling; their product is not.
    const row = await inspected(
      await fixture.pixelBombPng({ height: 11_000, width: 11_000 }),
    );
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('pixel_limit_exceeded');
  });

  it('refuses an object that is mostly metadata', async () => {
    const row = await inspected(
      await fixture.imageWithMetadata(maximumMediaMetadataBytes + 16_000),
    );
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('metadata_limit_exceeded');
  });

  it('accepts ordinary camera-sized metadata', async () => {
    const row = await inspected(await fixture.imageWithMetadata(8_000));
    expect(row.lifecycle).toBe('inspected');
  });

  it('refuses an animation, because no accepted format may animate here', async () => {
    const animated = await fixture.animatedWebp();
    expect(sniffMediaFormat(animated)).toBe('webp');
    expect((await sharp(Buffer.from(animated)).metadata()).pages).toBe(2);

    const row = await inspected(animated);
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('frame_limit_exceeded');
  });

  it('refuses a corrupt file of an accepted format', async () => {
    for (const format of ['jpeg', 'png'] as const) {
      const row = await inspected(fixture.corrupt(format));
      expect(row.lifecycle, format).toBe('quarantined');
      expect(row.rejection_reason, format).toBe('undecodable');
    }
  });

  it('refuses an empty object and a missing one', async () => {
    const empty = await inspected(new Uint8Array(0));
    expect(empty.rejection_reason).toBe('empty_object');

    const assetId = await upload(await fixture.image({ format: 'png' }));
    const [object] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects where asset_id = ${assetId}`,
    );
    // The provider lost it between completion and inspection.
    await storage.deleteObject(object?.object_key ?? '');
    await media.service.runInspections({ owner: 'test-worker' });
    expect((await assetRow(assetId)).rejection_reason).toBe('object_missing');
  });
});

describe('scanning is a separate claim from decoding', () => {
  it('quarantines when the scanner refuses the object', async () => {
    const row = await inspected(
      await fixture.markedForScanner(localTestInfectedMarker),
    );
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('scan_refused');
  });

  it('quarantines when no scanner is approved, rather than passing', async () => {
    const unscanned = runtime('unavailable');
    const assetId = await upload(await fixture.image({ format: 'png' }));

    await unscanned.service.runInspections({ owner: 'test-worker' });

    const row = await assetRow(assetId);
    // A decoder succeeding is not a scan verdict. With no scanning position,
    // the honest outcome is a refusal — an unavailable scanner reporting clean
    // would be the single most dangerous line in this domain.
    expect(row.lifecycle).toBe('quarantined');
    expect(row.rejection_reason).toBe('scan_refused');
  });
});

describe('a quarantined object stays quarantined', () => {
  it('cannot be moved to any state a surface would act on', async () => {
    const assetId = await upload(fixture.svg());
    await media.service.runInspections({ owner: 'test-worker' });
    expect((await assetRow(assetId)).lifecycle).toBe('quarantined');

    // Re-running inspection finds nothing to do rather than reconsidering.
    await media.service.runInspections({ owner: 'test-worker' });
    expect((await assetRow(assetId)).lifecycle).toBe('quarantined');

    // And no processing was ever owed for it.
    const obligations = await rowsOf<{ readonly kind: string }>(
      database.sql`select kind from media_obligations where asset_id = ${assetId}`,
    );
    expect(obligations.map((row) => row.kind)).toEqual(['inspect']);
  });
});

describe('inspection is claimed, leased, and reclaimable', () => {
  it('gives one obligation to one worker among several running at once', async () => {
    await upload(await fixture.image({ format: 'png' }));
    await upload(await fixture.image({ format: 'jpeg' }));

    const outcomes = await Promise.all([
      media.service.runInspections({ owner: 'worker-a' }),
      media.service.runInspections({ owner: 'worker-b' }),
      media.service.runInspections({ owner: 'worker-c' }),
    ]);
    const total = outcomes.reduce(
      (sum, outcome) => sum + outcome.inspected + outcome.quarantined,
      0,
    );
    expect(total).toBe(2);

    const states = await rowsOf<{ readonly state: string }>(
      database.sql`select state from media_obligations where kind = 'inspect'`,
    );
    expect(states.every((row) => row.state === 'completed')).toBe(true);
  });

  it('lets another worker take over when a lease expires', async () => {
    const assetId = await upload(await fixture.image({ format: 'png' }));

    // A worker claims the obligation and then dies, leaving the asset mid-flight
    // and the lease held by a process that no longer exists.
    const claimed = await media.repository.claimObligations({
      kind: 'inspect',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: 10,
      now: new Date(),
      owner: 'worker-that-died',
    });
    expect(claimed).toHaveLength(1);
    await media.repository.transitionAsset(media.repository.transactionless, {
      assetId,
      expectedLifecycle: 'uploaded',
      lifecycle: 'inspecting',
      now: new Date(),
    });

    // Nothing is claimable while the lease holds.
    expect(
      await media.repository.claimObligations({
        kind: 'inspect',
        leaseMilliseconds: mediaObligationLeaseMilliseconds,
        limit: 10,
        now: new Date(),
        owner: 'worker-b',
      }),
    ).toHaveLength(0);

    // Once it expires the duty is claimable again, which is the whole reason a
    // lease is a database fact rather than a memory one.
    const reclaimed = await media.repository.claimObligations({
      kind: 'inspect',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: 10,
      now: new Date(Date.now() + mediaObligationLeaseMilliseconds + 1_000),
      owner: 'worker-b',
    });
    expect(reclaimed).toHaveLength(1);
  });

  it('refuses a completion from a worker whose lease was taken away', async () => {
    await upload(await fixture.image({ format: 'png' }));
    const [obligation] = await media.repository.claimObligations({
      kind: 'inspect',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: 1,
      now: new Date(),
      owner: 'worker-a',
    });

    // The lease owner is part of the predicate, so a worker whose row another
    // has since taken cannot report completion on top of the new owner's claim.
    expect(
      await media.repository.completeObligation(
        media.repository.transactionless,
        {
          now: new Date(),
          obligationId: obligation?.id ?? '',
          owner: 'worker-b',
        },
      ),
    ).toBeUndefined();
  });
});
