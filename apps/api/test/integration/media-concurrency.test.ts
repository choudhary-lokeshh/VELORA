import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  mediaObligationLeaseMilliseconds,
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
 * Several workers on the same platform at once.
 *
 * The correctness suites prove one worker does the right thing and that a
 * second cannot take a leased row. What is proved here is the property those
 * imply but do not demonstrate: that a *fleet* discharges every duty exactly
 * once and loses none — no duplicate derivative, no double deletion, no
 * obligation that both workers completed and neither performed.
 *
 * Each simulated worker is a separate runtime with its own storage adapter and
 * its own repository over the same database, because that is what two processes
 * actually are. Sharing one service object between "workers" would prove that a
 * loop is sequential.
 *
 * There are no sleeps anywhere in this file. Every ordering that matters is
 * established by a database fact — a lease instant, a unique index, a claimed
 * row — because a test that waits is a test that passes until the machine is
 * busy, which is exactly when concurrency bugs surface.
 */

const databaseUrl = await provisionDatabase('velora_media_concurrency');
// Above the fleet's peak: eight runtimes each with a pool, plus this suite's
// own reads. A pool that has to queue them turns a race into a timeout.
const database: TestDatabase = connectDatabase(databaseUrl, { max: 60 });
const directory = await mkdtemp(join(tmpdir(), 'velora-media-concurrency-'));

let clock = new Date('2026-08-17T09:00:00.000Z');

const config = testServerConfig({
  MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
  MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
  MEDIA_MALWARE_SCANNER: 'local-test',
  MEDIA_STORAGE_PROVIDER: 'local-test',
});

/** One worker process, as far as anything below this line can tell. */
function worker() {
  return createMediaRuntime({
    config,
    database: database.drizzle,
    logger: silentLogger(),
    now: () => clock,
    performsByteWork: true,
  });
}

/**
 * One of the eight, named because the setup has to drive the platform from
 * somewhere. It is an ordinary member of the fleet and races alongside the rest.
 */
const first = worker();
const fleet = [first, ...Array.from({ length: 7 }, () => worker())];
const storage = first.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '55555555-5555-4555-8555-555555555555',
};
const profileImage: MediaAssetClass = 'consumer_profile_image';
let operation = 0;

/** An asset with bytes at the provider and its inspection owed. */
async function uploadedAsset(): Promise<string> {
  operation += 1;
  const created = await first.service.createUpload({
    assetClass: profileImage,
    idempotencyKey: `race-${String(operation).padStart(4, '0')}`,
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
  await first.service.recordUpload({ assetId: created.asset.id, ...owner });
  return created.asset.id;
}

async function countOf(query: unknown): Promise<number> {
  const rows = await rowsOf<{ readonly count: string }>(query);
  return Number(rows[0]?.count ?? '0');
}

beforeEach(async () => {
  clock = new Date('2026-08-17T09:00:00.000Z');
  await database.truncate();
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('a fleet inspects each object once and misses none', () => {
  it('carries twelve uploads to ready with eight workers racing', async () => {
    const assetIds = [];
    for (let index = 0; index < 12; index += 1) {
      assetIds.push(await uploadedAsset());
    }

    // Every worker runs the whole cycle at once, twice, which is what a real
    // fleet does on its poll interval.
    for (let round = 0; round < 2; round += 1) {
      await Promise.all(
        fleet.map(async (one) => {
          await one.service.runInspections({
            owner: `worker-${String(round)}`,
          });
          await one.service.runProcessing({ owner: `worker-${String(round)}` });
        }),
      );
    }

    const readiness = await first.service.describeReadiness({ assetIds });
    expect(readiness).toHaveLength(12);
    for (const one of readiness) {
      expect(one.state, one.assetId).toBe('ready');
    }

    // Three derivatives each and not one more. Fifty concurrent attempts
    // collapse into one durable truth because the partial unique index admits
    // exactly one row per kind per processing version — not because a worker
    // checked first.
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_objects where role = 'variant'`,
      ),
    ).toBe(36);
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_objects where role = 'original'`,
      ),
    ).toBe(12);
  });

  it('leaves no obligation owed and none discharged twice', async () => {
    for (let index = 0; index < 8; index += 1) await uploadedAsset();

    for (let round = 0; round < 2; round += 1) {
      await Promise.all(
        fleet.map(async (one) => {
          await one.service.runInspections({
            owner: `worker-${String(round)}`,
          });
          await one.service.runProcessing({ owner: `worker-${String(round)}` });
        }),
      );
    }

    // Nothing still owed, nothing given up on, and no lease left behind by a
    // worker that finished. A retained lease on a settled row is
    // indistinguishable from a live claim, so the database refuses it — this
    // asserts the fleet never asks.
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_obligations where state = 'pending'`,
      ),
    ).toBe(0);
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_obligations where state = 'dead_letter'`,
      ),
    ).toBe(0);
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_obligations where lease_owner is not null`,
      ),
    ).toBe(0);
    // One inspection and one processing per asset. A second of either would be
    // a duplicate discharge of the same duty.
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_obligations where kind = 'inspect'`,
      ),
    ).toBe(8);
  });
});

describe('a fleet removes each object once', () => {
  it('deletes eight assets with eight workers racing the same duties', async () => {
    const assetIds = [];
    for (let index = 0; index < 8; index += 1) {
      assetIds.push(await uploadedAsset());
    }
    await Promise.all(
      fleet.map((one) => one.service.runInspections({ owner: 'setup' })),
    );
    await Promise.all(
      fleet.map((one) => one.service.runProcessing({ owner: 'setup' })),
    );
    for (const assetId of assetIds) {
      await first.service.requestDeletion({ assetId });
    }

    const outcomes = await Promise.all(
      fleet.map((one, index) =>
        one.service.runDeletions({ owner: `w-${String(index)}` }),
      ),
    );

    // Eight assets deleted, counted across the fleet rather than by one worker.
    // The sum matters: if two workers both believed they had deleted the same
    // asset it would read nine.
    expect(outcomes.reduce((total, one) => total + one.deleted, 0)).toBe(8);
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_assets where lifecycle = 'deleted'`,
      ),
    ).toBe(8);
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_objects where state <> 'deleted'`,
      ),
    ).toBe(0);
  });

  it('owes each destroyed derivative exactly one purge', async () => {
    const assetId = await uploadedAsset();
    await first.service.runInspections({ owner: 'setup' });
    await first.service.runProcessing({ owner: 'setup' });
    await first.service.requestDeletion({ assetId });

    await Promise.all(
      fleet.map((one, index) =>
        one.service.runDeletions({ owner: `w-${String(index)}` }),
      ),
    );
    // And every worker asks for a purge of the same asset at the same moment.
    await Promise.all(
      fleet.map((one) => one.service.requestPurge({ assetId })),
    );

    // Three addresses, three purges. Asking eight times owes it once, settled
    // by the partial unique index over outstanding object-scoped duties.
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_obligations
                     where kind = 'purge' and asset_id = ${assetId}`,
      ),
    ).toBe(3);
  });
});

describe('a fleet reconciling does not report the same drift twice', () => {
  it('files one finding and performs one repair under eight cycles at once', async () => {
    const assetId = await uploadedAsset();
    await first.service.runInspections({ owner: 'setup' });
    await first.service.runProcessing({ owner: 'setup' });
    const [variant] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects
                   where asset_id = ${assetId} and role = 'variant' limit 1`,
    );
    await storage.deleteObject(variant?.object_key ?? '');
    // Past the grace period, so the audit is due to look.
    clock = new Date(clock.getTime() + 20 * 60_000);

    await Promise.all(
      fleet.map((one, index) => {
        const reconciliation = one.reconciliation;
        if (reconciliation === undefined) {
          throw new Error('expected a reconciler on a byte-working runtime');
        }
        return reconciliation.reconcileOnce({ owner: `w-${String(index)}` });
      }),
    );

    // One fault, observed once, repaired once. The audit cursor is claimed with
    // `for update skip locked` and the finding's partial unique index settles
    // the rest, so eight simultaneous cycles cost one provider round trip's
    // worth of correction rather than eight.
    const findings = await rowsOf<{
      readonly kind: string;
      readonly occurrences: number;
      readonly resolution: string | null;
    }>(
      database.sql`select kind, occurrences, resolution from media_drift_findings
                   where asset_id = ${assetId}`,
    );
    expect(findings).toEqual([
      { kind: 'variant_missing', occurrences: 1, resolution: 'repaired' },
    ]);
    expect(await storage.statObject(variant?.object_key ?? '')).toBeDefined();
  });
});

describe('a lease is the only thing that stops a second worker', () => {
  it('lets the fleet reclaim work from one that died mid-flight', async () => {
    const assetId = await uploadedAsset();

    // A worker claims the inspection and dies holding it.
    const claimed = await first.repository.claimObligations({
      kind: 'inspect',
      leaseMilliseconds: mediaObligationLeaseMilliseconds,
      limit: 10,
      now: clock,
      owner: 'worker-that-died',
    });
    expect(claimed).toHaveLength(1);

    // Nothing else can take it while the lease stands, however many try.
    const blocked = await Promise.all(
      fleet.map((one, index) =>
        one.service.runInspections({ owner: `blocked-${String(index)}` }),
      ),
    );
    expect(blocked.reduce((total, one) => total + one.inspected, 0)).toBe(0);

    // The lease expires on a database instant rather than in the dead worker's
    // memory, which is the whole reason the duty survives the process.
    clock = new Date(
      clock.getTime() + mediaObligationLeaseMilliseconds + 1_000,
    );
    const reclaimed = await Promise.all(
      fleet.map((one, index) =>
        one.service.runInspections({ owner: `reclaimer-${String(index)}` }),
      ),
    );

    // Exactly one of the eight got it.
    expect(reclaimed.reduce((total, one) => total + one.inspected, 0)).toBe(1);
    const [asset] = await rowsOf<{ readonly lifecycle: string }>(
      database.sql`select lifecycle from media_assets where id = ${assetId}`,
    );
    expect(asset?.lifecycle).toBe('inspected');
  });
});

describe('one upload window per asset, whatever races for it', () => {
  it('admits one window when the whole fleet reissues at once', async () => {
    operation += 1;
    const created = await first.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: `reissue-${String(operation).padStart(4, '0')}`,
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');
    const assetId = created.asset.id;

    // The window lapses and every worker tries to open a new one.
    clock = new Date(clock.getTime() + 20 * 60_000);
    await execute(
      database.sql`update media_upload_sessions set state = 'expired'
                   where asset_id = ${assetId} and state = 'issued'`,
    );
    const outcomes = await Promise.all(
      fleet.map(() => first.service.reissueUpload({ assetId, ...owner })),
    );

    for (const outcome of outcomes) {
      expect(outcome.kind).toBe('upload_ready');
    }
    // One live capability, however many callers asked. The advisory lock
    // serialises them before either unique index is reached, so a double
    // submission is a repeat rather than a raised constraint violation.
    expect(
      await countOf(
        database.sql`select count(*)::text as count from media_upload_sessions
                     where asset_id = ${assetId} and state = 'issued'`,
      ),
    ).toBe(1);
    // And every window ever opened has its own object key, so bytes written
    // late under a lapsed capability land where nothing will look.
    const keys = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_upload_sessions where asset_id = ${assetId}`,
    );
    expect(new Set(keys.map((row) => row.object_key)).size).toBe(keys.length);
  });
});
