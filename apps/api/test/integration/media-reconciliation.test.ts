import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  maximumMediaObligationAttempts,
  mediaObligationBackoffMilliseconds,
  mediaStallMilliseconds,
  mediaUploadWindowMilliseconds,
  mediaVerificationGraceMilliseconds,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import * as fixture from '../support/media-fixtures.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * What happens when the record and the provider stop agreeing.
 *
 * Everything else in this domain is written so that a crash leaves a
 * recoverable shape. These tests are about the component that goes and looks,
 * and what they hold it to is narrower than "it fixes things". Three claims
 * matter more than the repairs do.
 *
 * A repair never invents a product conclusion. Bytes the provider has lost mean
 * the record about the bytes is wrong; they do not lift a hold, undo a
 * takedown, or make anything deliverable, and the one place that could go
 * wrong — rebuilding a derivative — refuses outright for an asset that is being
 * removed.
 *
 * A repair never adopts what it did not ask for. Bytes that arrived under a
 * capability that had already lapsed are destroyed rather than accepted.
 *
 * And drift nobody can safely correct is written down rather than swallowed. A
 * sweep that closed the unrepairable cases quietly would be worse than one that
 * never ran.
 */

const databaseUrl = await provisionDatabase('velora_media_reconciliation');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-drift-'));

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

/** Composed only where the process does byte work, and this one does. */
function reconciler() {
  const reconciliation = media.reconciliation;
  if (reconciliation === undefined) {
    throw new Error('expected a reconciler on a byte-working composition');
  }
  return reconciliation;
}

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '22222222-2222-4222-8222-222222222222',
};
const profileImage: MediaAssetClass = 'consumer_profile_image';
let operation = 0;

/** An asset with a live upload window and bytes already at the provider. */
async function uploadedBytes(): Promise<{
  readonly assetId: string;
  readonly objectKey: string;
}> {
  operation += 1;
  const created = await media.service.createUpload({
    assetClass: profileImage,
    idempotencyKey: `drift-${String(operation).padStart(4, '0')}`,
    ...owner,
  });
  if (created.kind !== 'upload_ready') throw new Error('expected an upload');
  const [session] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${created.asset.id} and state = 'issued'`,
  );
  const objectKey = session?.object_key ?? '';
  await storage.putObject(objectKey, await fixture.image({ format: 'png' }));
  return { assetId: created.asset.id, objectKey };
}

/** An asset carried all the way to `ready`, with its four objects present. */
async function readyAsset(): Promise<string> {
  const { assetId } = await uploadedBytes();
  await media.service.recordUpload({ assetId, ...owner });
  await media.service.runInspections({ owner: 'test' });
  await media.service.runProcessing({ owner: 'test' });
  return assetId;
}

async function objectsOf(assetId: string) {
  return rowsOf<{
    readonly byte_size: number | null;
    readonly id: string;
    readonly object_key: string;
    readonly role: string;
    readonly state: string;
    readonly variant_kind: string | null;
  }>(
    database.sql`select byte_size, id, object_key, role, state, variant_kind
                 from media_objects where asset_id = ${assetId}
                 order by role, variant_kind`,
  );
}

async function variantOf(assetId: string) {
  const [variant] = (await objectsOf(assetId)).filter(
    (object) => object.role === 'variant',
  );
  if (variant === undefined) throw new Error('expected a derivative');
  return variant;
}

async function originalOf(assetId: string) {
  const [original] = (await objectsOf(assetId)).filter(
    (object) => object.role === 'original',
  );
  if (original === undefined) throw new Error('expected an original');
  return original;
}

async function findingsOf(assetId: string) {
  return rowsOf<{
    readonly kind: string;
    readonly occurrences: number;
    readonly resolution: string | null;
  }>(
    database.sql`select kind, occurrences, resolution
                 from media_drift_findings where asset_id = ${assetId}
                 order by kind, created_at`,
  );
}

async function obligationsOf(assetId: string) {
  return rowsOf<{ readonly kind: string; readonly state: string }>(
    database.sql`select kind, state from media_obligations
                 where asset_id = ${assetId} order by kind, sequence`,
  );
}

async function lifecycleOf(assetId: string): Promise<string> {
  const [row] = await rowsOf<{ readonly lifecycle: string }>(
    database.sql`select lifecycle from media_assets where id = ${assetId}`,
  );
  return row?.lifecycle ?? 'missing';
}

async function sizeAtProvider(objectKey: string): Promise<number | undefined> {
  return (await storage.statObject(objectKey))?.byteSize;
}

/** Far enough forward that every stored object is due an audit. */
function passTheGracePeriod(): void {
  clock = new Date(
    clock.getTime() + mediaVerificationGraceMilliseconds + 1_000,
  );
}

beforeEach(async () => {
  clock = new Date('2026-08-16T12:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('a platform that agrees with its provider is left alone', () => {
  it('finds nothing, repairs nothing, and destroys nothing', async () => {
    const assetId = await readyAsset();
    const before = await objectsOf(assetId);
    passTheGracePeriod();

    const report = await reconciler().reconcileOnce({ owner: 'worker' });

    expect(report.found).toBe(0);
    expect(report.outstanding).toBe(0);
    // Four objects examined and four still there. A reconciler that could not
    // tell agreement from drift would be worse than none.
    expect(report.examined).toBe(4);
    expect(await findingsOf(assetId)).toHaveLength(0);
    for (const object of before) {
      expect(await sizeAtProvider(object.object_key)).toBeDefined();
    }
    expect(await lifecycleOf(assetId)).toBe('ready');
  });

  it('does not audit an object young enough to still be being written', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    await storage.deleteObject(variant.object_key);

    // No clock advance. A variant's row is written before its bytes are, on
    // purpose, so this shape is the ordinary pipeline mid-stride rather than
    // drift — and reporting it would be reporting correct behaviour.
    const report = await reconciler().reconcileOnce({ owner: 'worker' });

    expect(report.examined).toBe(0);
    expect(await findingsOf(assetId)).toHaveLength(0);
  });
});

describe('bytes nobody asked for do not become platform content', () => {
  it('destroys what arrived under a capability that had already lapsed', async () => {
    const { assetId, objectKey } = await uploadedBytes();
    expect(await sizeAtProvider(objectKey)).toBeDefined();

    // The window closes with nothing verified. Whatever is at that key was
    // written under an authorization that has lapsed, and the platform will not
    // adopt it: a reissue would get a fresh key precisely so a late upload
    // describes nothing.
    clock = new Date(clock.getTime() + mediaUploadWindowMilliseconds + 1_000);
    await media.service.sweepExpiredUploads();

    const report = await reconciler().reconcileOnce({ owner: 'worker' });

    expect(report.found).toBe(1);
    expect(report.repaired).toBe(1);
    expect(await sizeAtProvider(objectKey)).toBeUndefined();
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'orphaned_object', occurrences: 1, resolution: 'repaired' },
    ]);
  });

  it('leaves an upload in progress alone', async () => {
    const { assetId, objectKey } = await uploadedBytes();

    // The window is still open, so these bytes are somebody's upload rather
    // than an orphan.
    await reconciler().reconcileOnce({ owner: 'worker' });

    expect(await sizeAtProvider(objectKey)).toBeDefined();
    expect(await findingsOf(assetId)).toHaveLength(0);
  });

  it('never destroys bytes an object record claims', async () => {
    const assetId = await readyAsset();
    const original = await originalOf(assetId);
    // The completed window's key belongs to the original now. Closing over
    // every closed window without checking would delete it.
    await execute(
      database.sql`update media_upload_sessions
                   set state = 'abandoned', completed_at = null
                   where asset_id = ${assetId}`,
    );
    passTheGracePeriod();

    await reconciler().reconcileOnce({ owner: 'worker' });

    expect(await sizeAtProvider(original.object_key)).toBeDefined();
    expect(await findingsOf(assetId)).toHaveLength(0);
  });
});

describe('a derivative the provider lost is rendered again', () => {
  it('restores it at the address the record already names', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    await storage.deleteObject(variant.object_key);
    passTheGracePeriod();

    const report = await reconciler().reconcileOnce({ owner: 'worker' });

    expect(report.repaired).toBe(1);
    // The same key, so a client or cache holding the address finds the right
    // picture there, and no second row was created.
    expect(await sizeAtProvider(variant.object_key)).toBe(
      variant.byte_size ?? -1,
    );
    expect(await objectsOf(assetId)).toHaveLength(4);
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'variant_missing', occurrences: 1, resolution: 'repaired' },
    ]);
  });

  it('overwrites a derivative whose bytes changed under the platform', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    // Something that is not what this platform produced, at an address this
    // platform serves.
    await storage.putObject(variant.object_key, new Uint8Array(64).fill(7));
    passTheGracePeriod();

    const report = await reconciler().reconcileOnce({ owner: 'worker' });

    expect(report.repaired).toBe(1);
    expect(await sizeAtProvider(variant.object_key)).not.toBe(64);
    const [repaired] = (await objectsOf(assetId)).filter(
      (object) => object.id === variant.id,
    );
    // The record and the bytes agree again, and the record was updated from
    // what was actually written rather than left describing the old rendition.
    expect(await sizeAtProvider(variant.object_key)).toBe(
      repaired?.byte_size ?? -1,
    );
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'variant_size_mismatch', occurrences: 1, resolution: 'repaired' },
    ]);
  });

  it('refuses to rebuild anything for an asset that is being removed', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    await storage.deleteObject(variant.object_key);
    await media.service.requestDeletion({ assetId });
    passTheGracePeriod();

    await reconciler().reconcileOnce({ owner: 'worker' });

    // Resurrecting bytes a takedown destroyed is the single worst thing this
    // component could do, so removal is checked before the repair rather than
    // being left to the ordering of two sweeps.
    expect(await sizeAtProvider(variant.object_key)).toBeUndefined();
    const findings = await findingsOf(assetId);
    expect(
      findings.find((one) => one.kind === 'variant_missing')?.resolution,
    ).toBeNull();
  });
});

describe('an original the provider lost cannot be conjured', () => {
  it('owes the ordinary pipeline the refusal rather than guessing at one', async () => {
    const { assetId, objectKey } = await uploadedBytes();
    await media.service.recordUpload({ assetId, ...owner });
    await storage.deleteObject(objectKey);
    passTheGracePeriod();

    await reconciler().reconcileOnce({ owner: 'worker' });

    expect(await findingsOf(assetId)).toEqual([
      { kind: 'original_missing', occurrences: 1, resolution: 'owed' },
    ]);

    // And the pipeline reaches the right conclusion on its own. Inspection
    // already knows an object that is not there is `object_missing`; a
    // reconciler writing that verdict itself would be a second opinion about a
    // decision it does not own.
    await media.service.runInspections({ owner: 'worker' });
    expect(await lifecycleOf(assetId)).toBe('quarantined');
    const [readiness] = await media.service.describeReadiness({
      assetIds: [assetId],
    });
    expect(readiness?.state).toBe('rejected');
    expect(readiness?.rejection).toBe('not_uploaded');
  });

  it('leaves a ready asset outstanding rather than closing it quietly', async () => {
    const assetId = await readyAsset();
    const original = await originalOf(assetId);
    await storage.deleteObject(original.object_key);
    passTheGracePeriod();

    const report = await reconciler().reconcileOnce({ owner: 'worker' });

    // Nothing can be done: the derivatives are fine and serving, and the source
    // they were made from is gone, so no future processing version can ever be
    // produced. That is exactly the fact an operator has to be told.
    expect(report.repaired).toBe(0);
    expect(report.outstanding).toBe(1);
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'original_missing', occurrences: 1, resolution: null },
    ]);
    expect(await lifecycleOf(assetId)).toBe('ready');
  });

  it('counts a repeat observation rather than filing it twice', async () => {
    const assetId = await readyAsset();
    await storage.deleteObject((await originalOf(assetId)).object_key);
    passTheGracePeriod();
    await reconciler().reconcileOnce({ owner: 'worker' });
    passTheGracePeriod();

    await reconciler().reconcileOnce({ owner: 'worker' });

    // One fault seen twice, not two faults. An operator reading a list of
    // findings needs the first of those.
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'original_missing', occurrences: 2, resolution: null },
    ]);
  });
});

describe('bytes that outlived the decision to destroy them', () => {
  it('destroys them again, and says so', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });
    expect(await sizeAtProvider(variant.object_key)).toBeUndefined();

    // A provider that acknowledged a deletion and did not perform one. The
    // record says these bytes are gone; until they actually are, the removal
    // has not happened however the row reads.
    await storage.putObject(variant.object_key, new Uint8Array(32).fill(3));
    passTheGracePeriod();

    const report = await reconciler().reconcileOnce({ owner: 'worker' });

    expect(report.repaired).toBe(1);
    expect(await sizeAtProvider(variant.object_key)).toBeUndefined();
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'undeleted_object', occurrences: 1, resolution: 'repaired' },
    ]);
  });
});

describe('work the platform took on and stopped carrying', () => {
  it('owes the duty again rather than leaving the asset stuck', async () => {
    const { assetId } = await uploadedBytes();
    await media.service.recordUpload({ assetId, ...owner });
    // A worker that took the state and never reached a conclusion, and an
    // obligation that is no longer owed. Nothing is carrying this asset.
    await execute(
      database.sql`update media_assets set lifecycle = 'inspecting'
                   where id = ${assetId}`,
    );
    await execute(
      database.sql`update media_obligations
                   set state = 'completed', completed_at = now(),
                       lease_owner = null, lease_expires_at = null
                   where asset_id = ${assetId} and kind = 'inspect'`,
    );
    clock = new Date(clock.getTime() + mediaStallMilliseconds + 1_000);

    await reconciler().reconcileOnce({ owner: 'worker' });

    expect(await findingsOf(assetId)).toEqual([
      { kind: 'stalled_lifecycle', occurrences: 1, resolution: 'owed' },
    ]);
    // The remedy is the ordinary duty, discharged by the code that owns it.
    await media.service.runInspections({ owner: 'worker' });
    await media.service.runProcessing({ owner: 'worker' });
    expect(await lifecycleOf(assetId)).toBe('ready');
  });

  it('does not resurrect a duty that was already given up on', async () => {
    const { assetId } = await uploadedBytes();
    await media.service.recordUpload({ assetId, ...owner });
    await execute(
      database.sql`update media_assets set lifecycle = 'inspecting'
                   where id = ${assetId}`,
    );
    await execute(
      database.sql`update media_obligations set state = 'dead_letter',
                       lease_owner = null, lease_expires_at = null
                   where asset_id = ${assetId} and kind = 'inspect'`,
    );
    clock = new Date(clock.getTime() + mediaStallMilliseconds + 1_000);

    await reconciler().reconcileOnce({ owner: 'worker' });

    // Owing it again would reset its attempts and it would dead-letter again,
    // for ever, one cycle at a time. Outstanding is the honest description of a
    // duty the platform could not discharge.
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'stalled_lifecycle', occurrences: 1, resolution: null },
    ]);
    const inspections = (await obligationsOf(assetId)).filter(
      (one) => one.kind === 'inspect',
    );
    expect(inspections).toEqual([{ kind: 'inspect', state: 'dead_letter' }]);
  });

  it('does not call an asset under legal hold stalled', async () => {
    const assetId = await readyAsset();
    await media.service.setLegalHold({ assetId, held: true });
    await media.service.requestDeletion({ assetId });
    await media.service.runDeletions({ owner: 'worker' });
    expect(await lifecycleOf(assetId)).toBe('deleting');
    clock = new Date(clock.getTime() + mediaStallMilliseconds + 1_000);

    await reconciler().reconcileOnce({ owner: 'worker' });

    // Sitting in `deleting` is exactly what a hold means. Owing another
    // deletion would discharge against the hold and come straight back.
    const stalls = (await findingsOf(assetId)).filter(
      (one) => one.kind === 'stalled_lifecycle',
    );
    expect(stalls).toHaveLength(0);
    expect(await lifecycleOf(assetId)).toBe('deleting');
  });

  it('owes a purge that was asked for and never answered', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    // Asked for, and no outcome ever recorded — a worker that died between
    // marking the request and hearing back. Seeded from the test's clock and
    // not the database's: the two are different instants, and a fixture that
    // mixes them decides whether it passes by how long the suite has been
    // running.
    await execute(
      database.sql`update media_objects
                   set purge_requested_at = ${new Date(clock.getTime() - 3_600_000)}
                   where id = ${variant.id}`,
    );
    clock = new Date(clock.getTime() + mediaStallMilliseconds + 1_000);

    await reconciler().reconcileOnce({ owner: 'worker' });

    expect(
      (await findingsOf(assetId)).filter((one) => one.kind === 'stale_purge'),
    ).toEqual([{ kind: 'stale_purge', occurrences: 1, resolution: 'owed' }]);
    const outcome = await media.service.runPurges({ owner: 'worker' });
    expect(outcome.unsupported).toBe(1);
  });
});

describe('a reclaimed lease finishes the work rather than discharging it', () => {
  it('inspects an asset a dead worker left mid-inspection', async () => {
    const { assetId } = await uploadedBytes();
    await media.service.recordUpload({ assetId, ...owner });

    // A worker claims the duty, takes the state, and dies. This is the exact
    // shape a crash between the transition and the conclusion leaves.
    const claimed = await media.repository.claimObligations({
      kind: 'inspect',
      leaseMilliseconds: 60_000,
      limit: 10,
      now: clock,
      owner: 'worker-that-died',
    });
    expect(claimed).toHaveLength(1);
    await media.repository.transitionAsset(media.repository.transactionless, {
      assetId,
      expectedLifecycle: 'uploaded',
      lifecycle: 'inspecting',
      now: clock,
    });

    clock = new Date(clock.getTime() + 120_000);
    const outcome = await media.service.runInspections({ owner: 'worker-b' });

    // Before this was fixed the reclaiming worker saw an asset that was no
    // longer `uploaded`, concluded the work no longer existed, and discharged
    // the duty — leaving the asset in `inspecting` for ever with nothing owed
    // against it. Re-inspecting is safe: it reads bytes and measures them, and
    // the lease is what stops two workers doing it at once.
    expect(outcome.inspected).toBe(1);
    expect(await lifecycleOf(assetId)).toBe('inspected');
  });
});

describe('what reconciliation says out loud', () => {
  it('names no object key, no asset, and no signed address', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    await storage.deleteObject(variant.object_key);
    passTheGracePeriod();

    const records: unknown[] = [];
    const talkative = createMediaRuntime({
      config: testServerConfig({
        MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
        MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
        MEDIA_MALWARE_SCANNER: 'local-test',
        MEDIA_STORAGE_PROVIDER: 'local-test',
      }),
      database: database.drizzle,
      logger: silentLogger(records),
      now: () => clock,
      performsByteWork: true,
    });
    // A provider that fails mid-repair is the case most likely to put
    // provider detail into a log line, so it is the one that gets checked.
    (
      talkative.storage as LocalTestMediaStorage & { writeObject: unknown }
    ).writeObject = () =>
      Promise.reject(new Error(`refused ${variant.object_key}`));
    const reconciliation = talkative.reconciliation;
    if (reconciliation === undefined) throw new Error('expected a reconciler');

    await reconciliation.reconcileOnce({ owner: 'worker' });

    // The error object itself is passed to the logger and its serialiser
    // decides what survives; what this asserts is that nothing in this module
    // *puts* an identifier or a key into a log line's own fields.
    const fields = records.map((entry) =>
      JSON.stringify((entry as { readonly fields: unknown }).fields),
    );
    expect(fields.length).toBeGreaterThan(0);
    for (const line of fields) {
      expect(line).not.toContain(assetId);
      expect(line).not.toContain(variant.object_key);
      expect(line).not.toContain('media/');
    }
  });
});

describe('reconciliation is safe to run from more than one worker', () => {
  it('files one finding and performs one repair under concurrent cycles', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    await storage.deleteObject(variant.object_key);
    passTheGracePeriod();

    const reports = await Promise.all([
      reconciler().reconcileOnce({ owner: 'worker-a' }),
      reconciler().reconcileOnce({ owner: 'worker-b' }),
    ]);

    // Between them, once. The audit cursor is claimed with `for update skip
    // locked` and the finding's partial unique index settles the rest.
    expect(reports.reduce((total, one) => total + one.found, 0)).toBe(1);
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'variant_missing', occurrences: 1, resolution: 'repaired' },
    ]);
    expect(await sizeAtProvider(variant.object_key)).toBe(
      variant.byte_size ?? -1,
    );
  });

  it('keeps a repair owed when it cannot be finished, and bounds the retries', async () => {
    const assetId = await readyAsset();
    const variant = await variantOf(assetId);
    await storage.deleteObject(variant.object_key);
    passTheGracePeriod();

    // A provider that accepts nothing. The repair is a leased obligation like
    // every other piece of work here, so a failure is owed again rather than
    // lost — and bounded rather than retried for ever.
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
    (
      failing.storage as LocalTestMediaStorage & { writeObject: unknown }
    ).writeObject = () => Promise.reject(new Error('provider unreachable'));
    const stubborn = failing.reconciliation;
    if (stubborn === undefined) throw new Error('expected a reconciler');

    for (
      let attempt = 0;
      attempt < maximumMediaObligationAttempts;
      attempt += 1
    ) {
      await stubborn.reconcileOnce({ owner: 'worker' });
      clock = new Date(
        clock.getTime() + mediaObligationBackoffMilliseconds + 1_000,
      );
    }

    const reconciles = (await obligationsOf(assetId)).filter(
      (one) => one.kind === 'reconcile',
    );
    expect(reconciles).toEqual([{ kind: 'reconcile', state: 'dead_letter' }]);
    // And the finding is still outstanding, because nothing was repaired.
    expect(await findingsOf(assetId)).toEqual([
      { kind: 'variant_missing', occurrences: 1, resolution: null },
    ]);
  });
});
