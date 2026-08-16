import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  maximumMediaObligationAttempts,
  mediaObligationBackoffMilliseconds,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import * as fixture from '../support/media-fixtures.js';
import {
  connectDatabase,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * Removal, takedown, purge, and legal hold — four things, not one boolean.
 *
 * What these tests hold the platform to is that each behaves differently and
 * that none of them can be lost. A deletion reaches every derivative rather
 * than only the original; a cache that was never told stays a visible
 * obligation rather than a silent success; a worker dying does not discharge a
 * duty; and a hold preserves evidence without making anything deliverable.
 */

const databaseUrl = await provisionDatabase('velora_media_takedown');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-takedown-'));

let clock = new Date('2026-08-16T12:00:00.000Z');

const media = createMediaRuntime({
  config: testServerConfig({
    MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
    MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
    MEDIA_MALWARE_SCANNER: 'local-test',
    MEDIA_STORAGE_PROVIDER: 'local-test',
  }),
  database: database.drizzle,
  logger: silentLogger(),
  now: () => clock,
  performsByteWork: true,
});
const storage = media.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '11111111-1111-4111-8111-111111111111',
};
const profileImage: MediaAssetClass = 'consumer_profile_image';
let operation = 0;

async function readyAsset(): Promise<string> {
  operation += 1;
  const created = await media.service.createUpload({
    assetClass: profileImage,
    idempotencyKey: `takedown-${String(operation).padStart(4, '0')}`,
    ...owner,
  });
  if (created.kind !== 'upload_ready') throw new Error('expected an upload');
  const [session] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${created.asset.id} and state = 'issued'`,
  );
  await storage.putObject(
    session?.object_key ?? '',
    await fixture.image({ format: 'png' }),
  );
  await media.service.recordUpload({ assetId: created.asset.id, ...owner });
  await media.service.runInspections({ owner: 'test' });
  await media.service.runProcessing({ owner: 'test' });
  return created.asset.id;
}

async function objectsOf(assetId: string) {
  return rowsOf<{
    readonly object_key: string;
    readonly purge_outcome: string | null;
    readonly role: string;
    readonly state: string;
  }>(
    database.sql`select object_key, purge_outcome, role, state
                 from media_objects where asset_id = ${assetId}
                 order by role, variant_kind`,
  );
}

async function lifecycleOf(assetId: string): Promise<string> {
  const [row] = await rowsOf<{ readonly lifecycle: string }>(
    database.sql`select lifecycle from media_assets where id = ${assetId}`,
  );
  return row?.lifecycle ?? 'missing';
}

async function obligationsOf(assetId: string) {
  return rowsOf<{
    readonly attempts: number;
    readonly failure_reason: string | null;
    readonly kind: string;
    readonly state: string;
  }>(
    database.sql`select attempts, failure_reason, kind, state
                 from media_obligations where asset_id = ${assetId}
                 order by kind, sequence`,
  );
}

/** Whether the provider still holds the bytes, independent of any record. */
async function existsAtProvider(objectKey: string): Promise<boolean> {
  return (await storage.statObject(objectKey)) !== undefined;
}

beforeEach(async () => {
  clock = new Date('2026-08-16T12:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('deletion reaches every byte, not just the original', () => {
  it('destroys the original and every derivative', async () => {
    const assetId = await readyAsset();
    const before = await objectsOf(assetId);
    expect(before).toHaveLength(4);
    for (const object of before) {
      expect(await existsAtProvider(object.object_key)).toBe(true);
    }

    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });

    expect(await lifecycleOf(assetId)).toBe('deleted');
    for (const object of await objectsOf(assetId)) {
      expect(object.state, object.role).toBe('deleted');
      // The record and the provider agree, which is the only version of this
      // claim worth making.
      expect(await existsAtProvider(object.object_key), object.role).toBe(
        false,
      );
    }
  });

  it('owes a purge for every derivative it destroyed', async () => {
    const assetId = await readyAsset();
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });

    const purges = (await obligationsOf(assetId)).filter(
      (one) => one.kind === 'purge',
    );
    // Three derivatives, three addresses that may be cached. The original was
    // never public, so it has none.
    expect(purges).toHaveLength(3);
  });

  it('is idempotent when the provider has already lost the bytes', async () => {
    const assetId = await readyAsset();
    for (const object of await objectsOf(assetId)) {
      await storage.deleteObject(object.object_key);
    }

    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });

    // `already_absent` counts as deleted. That conclusion is safe against this
    // adapter's documented semantics, and is a question asked of every
    // candidate provider rather than assumed for all of them.
    expect(await lifecycleOf(assetId)).toBe('deleted');
  });

  it('discharges a repeated deletion without doing it twice', async () => {
    const assetId = await readyAsset();
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });
    await media.service.requestDeletion({ assetId });
    const second = await media.service.runDeletions({ owner: 'worker' });

    expect(second.deleted).toBe(0);
    expect(await lifecycleOf(assetId)).toBe('deleted');
  });
});

describe('a cache that was never told stays an obligation', () => {
  it('records `unsupported` as itself rather than as success', async () => {
    const assetId = await readyAsset();
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });
    const outcome = await media.service.runPurges({ owner: 'worker' });

    // The development adapter has no cache in front of it and says so. Writing
    // that down is the difference between an operator knowing the exposure and
    // believing it was handled.
    expect(outcome.unsupported).toBe(3);
    expect(outcome.purged).toBe(0);
    for (const object of await objectsOf(assetId)) {
      if (object.role !== 'variant') continue;
      expect(object.purge_outcome).toBe('unsupported');
    }
  });

  it('keeps a failed purge owed and visible, and backs it off', async () => {
    const assetId = await readyAsset();
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });

    // A delivery layer that refuses. Nothing about this is a success.
    const failing = createMediaRuntime({
      config: testServerConfig({
        MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
        MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
        MEDIA_MALWARE_SCANNER: 'local-test',
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
      database: database.drizzle,
      logger: silentLogger(),
      now: () => clock,
      performsByteWork: true,
    });
    const refusingStorage = failing.storage as LocalTestMediaStorage & {
      purge: () => Promise<{ code: string; kind: 'failed' }>;
    };
    refusingStorage.purge = () =>
      Promise.resolve({
        code: 'provider_unreachable',
        kind: 'failed' as const,
      });

    const outcome = await failing.service.runPurges({ owner: 'worker' });
    expect(outcome.purged).toBe(0);
    expect(outcome.unsupported).toBe(0);

    const purges = (await obligationsOf(assetId)).filter(
      (one) => one.kind === 'purge',
    );
    for (const purge of purges) {
      // Still owed, with the attempt counted and a redacted reason. A provider
      // message would name internals and could echo content.
      expect(purge.state).toBe('pending');
      expect(purge.attempts).toBe(1);
      expect(purge.failure_reason).toBe('purge_failed');
    }
    // And nothing claims the address was forgotten.
    for (const object of await objectsOf(assetId)) {
      expect(object.purge_outcome).toBeNull();
    }
  });

  it('dead-letters a purge that never succeeds, rather than dropping it', async () => {
    const assetId = await readyAsset();
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });

    const failing = createMediaRuntime({
      config: testServerConfig({
        MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
        MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
        MEDIA_MALWARE_SCANNER: 'local-test',
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
      database: database.drizzle,
      logger: silentLogger(),
      now: () => clock,
      performsByteWork: true,
    });
    (failing.storage as LocalTestMediaStorage & { purge: unknown }).purge =
      () =>
        Promise.resolve({
          code: 'provider_unreachable',
          kind: 'failed' as const,
        });

    for (
      let attempt = 0;
      attempt < maximumMediaObligationAttempts;
      attempt += 1
    ) {
      await failing.service.runPurges({ owner: 'worker' });
      clock = new Date(
        clock.getTime() + mediaObligationBackoffMilliseconds + 1,
      );
    }

    const purges = (await obligationsOf(assetId)).filter(
      (one) => one.kind === 'purge',
    );
    for (const purge of purges) {
      // Retained as evidence that the platform could not discharge it, rather
      // than deleted so the backlog looks clean.
      expect(purge.state).toBe('dead_letter');
    }
  });
});

describe('a worker dying does not discharge a duty', () => {
  it('leaves the deletion claimable when the lease expires mid-flight', async () => {
    const assetId = await readyAsset();
    await media.service.requestDeletion({ assetId });

    // A worker claims the obligation and dies before touching a byte.
    const claimed = await media.repository.claimObligations({
      kind: 'delete',
      leaseMilliseconds: 60_000,
      limit: 10,
      now: clock,
      owner: 'worker-that-died',
    });
    expect(claimed).toHaveLength(1);

    // Nothing is deleted, and nothing else can take it while the lease holds.
    expect(
      (await media.service.runDeletions({ owner: 'worker-b' })).deleted,
    ).toBe(0);
    expect(await lifecycleOf(assetId)).toBe('deleting');

    clock = new Date(clock.getTime() + 120_000);
    expect(
      (await media.service.runDeletions({ owner: 'worker-b' })).deleted,
    ).toBe(1);
    expect(await lifecycleOf(assetId)).toBe('deleted');
  });
});

describe('a legal hold preserves evidence without making anything available', () => {
  it('keeps the original, destroys the derivatives, and never says deleted', async () => {
    const assetId = await readyAsset();
    await media.service.setLegalHold({ assetId, held: true });
    await media.service.requestDeletion({ assetId });

    const outcome = await media.service.runDeletions({ owner: 'worker' });
    expect(outcome.held).toBe(1);
    expect(outcome.deleted).toBe(0);

    // Still `deleting`: the removal is owed and deliberately not completed.
    expect(await lifecycleOf(assetId)).toBe('deleting');
    for (const object of await objectsOf(assetId)) {
      if (object.role === 'original') {
        expect(object.state).toBe('present');
        expect(await existsAtProvider(object.object_key)).toBe(true);
      } else {
        expect(object.state).toBe('deleted');
        expect(await existsAtProvider(object.object_key)).toBe(false);
      }
    }
  });

  it('completes the deletion once the hold is lifted', async () => {
    const assetId = await readyAsset();
    await media.service.setLegalHold({ assetId, held: true });
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });
    expect(await lifecycleOf(assetId)).toBe('deleting');

    // Lifting the hold resumes the deferred deletion on its own. Nothing has
    // to remember to ask again.
    await media.service.setLegalHold({ assetId, held: false });
    await media.service.runDeletions({ owner: 'worker' });

    expect(await lifecycleOf(assetId)).toBe('deleted');
    const [original] = (await objectsOf(assetId)).filter(
      (one) => one.role === 'original',
    );
    expect(await existsAtProvider(original?.object_key ?? '')).toBe(false);
  });

  it('will not let the database record a deleted asset that is still held', async () => {
    const assetId = await readyAsset();
    await media.service.setLegalHold({ assetId, held: true });

    // Not a rule a service enforces and a code path could forget.
    expect(
      await refused(() =>
        database.sql.unsafe(
          `update media_assets set lifecycle = 'deleted', deleted_at = now(), deletion_requested_at = now() where id = '${assetId}'`,
        ),
      ),
    ).toBe(true);
  });
});

describe('a takedown owes a purge without deleting anything', () => {
  it('records an obligation per address and is idempotent', async () => {
    const assetId = await readyAsset();

    const first = await media.service.requestPurge({ assetId });
    expect(first.owed).toBe(3);
    // Asking twice owes it once: the partial unique index settles that, not a
    // read.
    expect((await media.service.requestPurge({ assetId })).owed).toBe(0);

    // The bytes are untouched. A takedown is not a deletion, and conflating
    // them would destroy something a case might need.
    expect(await lifecycleOf(assetId)).toBe('ready');
    for (const object of await objectsOf(assetId)) {
      expect(object.state).toBe('present');
    }
  });

  it('survives the worker dying before the purge is carried out', async () => {
    const assetId = await readyAsset();
    await media.service.requestPurge({ assetId });

    // Nothing has run. The duty is a row, so a process that never came back
    // has lost a queue message and not the obligation.
    const owed = (await obligationsOf(assetId)).filter(
      (one) => one.kind === 'purge' && one.state === 'pending',
    );
    expect(owed).toHaveLength(3);

    const outcome = await media.service.runPurges({ owner: 'worker' });
    expect(outcome.unsupported).toBe(3);
  });
});
