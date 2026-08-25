import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MediaRuntime } from '../../src/media/composition.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import type { UsersRuntime } from '../../src/users/composition.js';
import { image } from './media-fixtures.js';
import { rowsOf, type TestDatabase } from './database.js';

/**
 * The configuration a suite needs for profile media to work at all.
 *
 * One object rather than three keys repeated in a dozen files, so a future
 * change to what the development media platform requires is one edit. Every
 * value here is refused in staging and production by the configuration guard.
 */
export const mediaEnvironment = {
  MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
  MEDIA_LOCAL_STORAGE_DIRECTORY: mkdtempSync(
    join(tmpdir(), 'velora-media-suite-'),
  ),
  MEDIA_MALWARE_SCANNER: 'local-test',
  MEDIA_STORAGE_PROVIDER: 'local-test',
} as const;

/**
 * Carries a reserved profile slot all the way to a discoverable image.
 *
 * Every suite that needs a complete consumer profile used to do this in three
 * lines: read the storage key, drop six bytes at it, and post the completion.
 * That worked while "ready" meant a magic-byte check. It does not now, and the
 * way it fails is instructive — those six bytes are a JPEG header with no image
 * behind it, so the real pipeline decodes them, fails, and quarantines the
 * asset. A profile built that way would never become discoverable.
 *
 * So the bytes here are a genuine encoded image and the work is the real work:
 * the platform verifies the object, inspects it, renders its derivatives, and
 * only then is anything ready. The readiness projection is refreshed at the end
 * because discovery reads the projection rather than asking the media platform
 * per candidate.
 */
/**
 * Serialises the byte work across concurrent callers.
 *
 * Suites create several discoverable consumers with `Promise.all`, and the
 * obligation queue is shared: one caller's cycle claims and leases another's
 * work. The second caller then spins through its attempts in milliseconds while
 * the first is still rendering, and gives up on an asset that was about to
 * become ready.
 *
 * A queue rather than a poll-with-delay, deliberately. Waiting a fixed time for
 * somebody else's rendering is the kind of sleep that hides a race and passes
 * until the machine is busy; running the byte work one caller at a time removes
 * the race instead. It costs nothing real — the work is the same work, and the
 * upload and profile requests around it still run concurrently.
 */
let byteWork: Promise<unknown> = Promise.resolve();

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = byteWork.then(work, work);
  byteWork = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function readyProfileImage(input: {
  readonly bytes?: Uint8Array;
  readonly database: TestDatabase;
  readonly media: MediaRuntime;
  /** The media asset reference the upload route returned. */
  readonly assetId: string;
  readonly users: UsersRuntime;
}): Promise<void> {
  const assetId = input.assetId;
  const [slot] = await rowsOf<{ readonly id: string }>(
    input.database
      .sql`select id from users_profile_media where media_asset_id = ${assetId}`,
  );
  if (slot === undefined) throw new Error('profile media slot not found');

  const [session] = await rowsOf<{ readonly object_key: string }>(
    input.database.sql`select object_key from media_upload_sessions
                       where asset_id = ${assetId} and state = 'issued'`,
  );
  const storage = input.media.storage as LocalTestMediaStorage;
  await storage.putObject(
    session?.object_key ?? '',
    input.bytes ?? (await image({ format: 'jpeg' })),
  );

  await input.media.service.recordUpload({
    assetId,
    ownerDomain: 'users',
    ownerReference: await ownerOf(input.database, assetId),
  });
  // Run the cycles until *this* asset is ready, rather than assuming one pass
  // suffices. Obligations are claimed from a queue shared by every caller, so
  // two helpers running at once can discharge each other's work — and a helper
  // that returned after one cycle could leave its own asset half-processed
  // while having completed somebody else's.
  const settled = await serialize(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await input.media.service.runInspections({ owner: 'test-setup' });
      await input.media.service.runProcessing({ owner: 'test-setup' });
      const [readiness] = await input.media.service.describeReadiness({
        assetIds: [assetId],
      });
      if (readiness?.state === 'ready' || readiness?.state === 'rejected') {
        return readiness.state;
      }
    }
    return undefined;
  });

  // Say so here rather than letting a caller discover it three assertions
  // later as an unexplained "not discoverable". A helper that quietly returns
  // an unready image turns its own failure into somebody else's mystery.
  if (settled !== 'ready') {
    throw new Error(
      `profile media never became ready for asset ${assetId}: ${settled ?? 'unknown'}`,
    );
  }

  // Discovery reads the cached projection, not the media platform, so a test
  // that skipped this would be asserting against a profile the candidate query
  // cannot see yet.
  await input.users.profiles.refreshStaleMediaReadiness();
}

async function ownerOf(
  database: TestDatabase,
  assetId: string,
): Promise<string> {
  const [row] = await rowsOf<{ readonly user_id: string }>(
    database.sql`select user_id from users_profile_media
                 where media_asset_id = ${assetId}`,
  );
  if (row === undefined) throw new Error('profile media slot not found');
  return row.user_id;
}
