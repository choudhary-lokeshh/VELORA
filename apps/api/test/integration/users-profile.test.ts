import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createApplication } from '../../src/application.js';
import { createAuthRuntime } from '../../src/auth/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { createUsersRuntime } from '../../src/users/composition.js';
import { requiredPolicyDocuments } from '../../src/users/onboarding-policy.js';
import { mediaUploadWindowMilliseconds } from '../../src/media/policy.js';
import {
  connectDatabase,
  execute,
  provisionDatabase,
  refused,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import {
  silentLogger,
  testConsumerOrigin,
  testProductRuntimes,
  testCreatorOrigin,
  testDatabaseAdmission,
  testServerConfig,
  testMediaRuntime,
} from '../support/harness.js';
import { mediaEnvironment } from '../support/profile-media.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import { image } from '../support/media-fixtures.js';

const databaseUrl = await provisionDatabase('velora_users_profile');
const database: TestDatabase = connectDatabase(databaseUrl);

const healthy = {
  close: () => Promise.resolve(),
  isReady: () => Promise.resolve(true),
};

/**
 * Two applications, because the storage adapter is a deployment decision rather
 * than a per-request one. The first runs with the development storage adapter so
 * the whole media lifecycle is exercisable; the second runs on the default,
 * which refuses everything, and proves an environment with no approved provider
 * fails closed instead of accepting images.
 */
const mediaConfig = testServerConfig({
  USERS_ADULT_ASSURANCE_VERIFIER: 'unavailable',
  ...mediaEnvironment,
});
const defaultConfig = testServerConfig();

/** Test-controlled clock, so upload expiry is proven rather than waited for. */
let clockOffsetMilliseconds = 0;
let requesterSequence = 0;
const now = () => new Date(Date.now() + clockOffsetMilliseconds);

function buildHarness(config: typeof mediaConfig) {
  const logs: unknown[] = [];
  const logger = silentLogger(logs);
  const auth = createAuthRuntime({
    config,
    database: database.drizzle,
    logger,
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      // Distinct per request, because this suite is not testing rate limits and
      // a shared bucket makes adding a test somebody else's failure: the
      // sign-in quietly 429s, `signIn` returns an empty cookie, and the
      // symptom surfaces three tests later as an unexplained AUTH_REQUIRED.
      requesterReference: (request) => {
        requesterSequence += 1;
        return (
          request.headers.get('x-velora-device') ??
          `profile-test-${String(requesterSequence)}`
        );
      },
    },
  });
  const mediaRuntime = testMediaRuntime({
    config,
    database: database.drizzle,
    logger,
    now,
  });
  const users = createUsersRuntime({
    caller: auth.caller,
    config,
    database: database.drizzle,
    logger,
    now,
    media: mediaRuntime.service,
  });
  const application = createApplication({
    config,
    dependencies: {
      auth,
      database: healthy,
      databaseAdmission: testDatabaseAdmission(),
      ...testProductRuntimes({
        caller: auth.caller,
        config,
        database: database.drizzle,
        logger,
        now,
        users,
      }),
      ephemeralRedis: healthy,
      logger,
      queueRedis: healthy,
      users,
    },
  });
  return {
    close: () => application.close(),
    handle: (request: Request) => application.app.handle(request),
    logs,
    media: mediaRuntime,
    users,
  };
}

const api = buildHarness(mediaConfig);
const withoutStorage = buildHarness(defaultConfig);

afterAll(async () => {
  await api.close();
  await withoutStorage.close();
  await database.close();
});

beforeEach(async () => {
  clockOffsetMilliseconds = 0;
  await database.truncate();
});

// A real encoded image, because inspection genuinely decodes now. Seven bytes
// with a JPEG header used to pass a magic-byte check and would today be
// quarantined as undecodable — correctly, and a fixture that never noticed
// would have been asserting against a pipeline that no longer exists.
const notAnImage = new TextEncoder().encode('this is not an image at all');

interface Credentials {
  readonly cookie: string;
  readonly csrf: string;
}

async function signIn(
  subject: string,
  audience: 'consumer_web' | 'creator_studio' = 'consumer_web',
): Promise<Credentials> {
  const origin =
    audience === 'creator_studio' ? testCreatorOrigin : testConsumerOrigin;
  const response = await api.handle(
    new Request('http://api.test/v1/auth/local/web-sessions', {
      body: JSON.stringify({ audience, subject }),
      headers: { 'content-type': 'application/json', origin },
      method: 'POST',
    }),
  );
  expect(response.status, `sign-in for ${subject}`).toBe(201);
  const session = (await response.json()) as { csrfToken: string };
  const cookie = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair.length > 0)
    .join('; ');
  return { cookie, csrf: session.csrfToken };
}

function post(
  path: string,
  credentials: Credentials,
  body: unknown = {},
): Request {
  return new Request(`http://api.test${path}`, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: credentials.cookie,
      origin: testConsumerOrigin,
      'x-velora-csrf': credentials.csrf,
    },
    method: 'POST',
  });
}

function get(path: string, credentials: Credentials): Request {
  return new Request(`http://api.test${path}`, {
    headers: { cookie: credentials.cookie, origin: testConsumerOrigin },
  });
}

const allRequiredPolicies = requiredPolicyDocuments.map((document) => ({
  key: document.key,
  version: document.version,
}));

interface ProfileBody {
  readonly bio?: string;
  readonly complete: boolean;
  readonly discoverable: boolean;
  readonly displayName?: string;
  readonly languages: readonly string[];
  readonly media: readonly {
    readonly contentType?: string;
    readonly id: string;
    readonly position: number;
    readonly rejectionReason?: string;
    readonly state: string;
  }[];
  readonly outstandingRequirements: readonly string[];
  readonly preferencesVersion?: number;
  readonly region?: string;
  readonly version?: number;
}

/** An account that has passed the adult gate and the required notices. */
async function admittedConsumer(subject: string): Promise<Credentials> {
  const caller = await signIn(subject);
  await api.handle(post('/v1/users', caller));
  await api.handle(
    post('/v1/users/me/onboarding/adult-declaration', caller, {
      declaresAdult: true,
      region: 'DE',
    }),
  );
  await api.handle(
    post('/v1/users/me/onboarding/acknowledgements', caller, {
      acknowledgements: allRequiredPolicies,
    }),
  );
  return caller;
}

async function readProfile(credentials: Credentials): Promise<ProfileBody> {
  const response = await api.handle(get('/v1/users/me/profile', credentials));
  expect(response.status).toBe(200);
  return (await response.json()) as ProfileBody;
}

async function accountStatus(credentials: Credentials): Promise<string> {
  const response = await api.handle(get('/v1/users/me', credentials));
  return ((await response.json()) as { status: string }).status;
}

/**
 * Uploads bytes the way a real client would, and lets the platform finish.
 *
 * Completion no longer makes an image ready and is not supposed to: it tells
 * the platform to go and look, and the looking happens on the worker. So this
 * posts the completion, runs the byte work, and then re-reads — which is
 * exactly the sequence a client experiences, with the polling collapsed.
 */
async function attachImage(
  credentials: Credentials,
  bytes?: Uint8Array,
): Promise<{ mediaId: string; profile: ProfileBody }> {
  const created = await api.handle(
    post('/v1/users/me/profile/media', credentials),
  );
  expect(created.status).toBe(201);
  const upload = (await created.json()) as { mediaId: string };
  await placeBytes(upload.mediaId, bytes ?? (await realImage()));
  const completed = await api.handle(
    post('/v1/users/me/profile/media/completion', credentials, {
      mediaId: upload.mediaId,
    }),
  );
  expect(completed.status).toBe(200);
  await settleMedia();
  return {
    mediaId: upload.mediaId,
    profile: await readProfile(credentials),
  };
}

/** Writes bytes to wherever the media platform issued a capability for. */
async function placeBytes(slotId: string, bytes: Uint8Array): Promise<void> {
  const [slot] = await rowsOf<{ media_asset_id: string }>(
    database.sql`select media_asset_id from users_profile_media where id = ${slotId}`,
  );
  const [session] = await rowsOf<{ object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${slot?.media_asset_id ?? ''} and state = 'issued'`,
  );
  const storage = api.media.storage as LocalTestMediaStorage;
  await storage.putObject(session?.object_key ?? '', bytes);
}

/** Runs the byte work a worker would, so a test does not have to wait. */
async function settleMedia(): Promise<void> {
  await api.media.service.runInspections({ owner: 'profile-test' });
  await api.media.service.runProcessing({ owner: 'profile-test' });
}

const realImage = () => image({ format: 'jpeg' });

describe('profile editing and optimistic concurrency', () => {
  it('refuses profile edits before the adult gate and the notices are passed', async () => {
    const caller = await signIn('profile-too-early@velora.test');
    await api.handle(post('/v1/users', caller));

    const refused = await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Too Early',
        languages: ['de'],
      }),
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe(
      'ACCOUNT_NOT_ELIGIBLE',
    );

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_profiles`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('creates a profile at version one and requires that version to edit it', async () => {
    const caller = await admittedConsumer('profile-versions@velora.test');

    const created = await api.handle(
      post('/v1/users/me/profile', caller, {
        bio: 'Reads maps for fun.',
        displayName: 'Ada',
        languages: ['de', 'en'],
      }),
    );
    expect(created.status).toBe(200);
    const first = (await created.json()) as ProfileBody;
    expect(first.version).toBe(1);
    expect(first.displayName).toBe('Ada');
    expect(first.languages).toEqual(['de', 'en']);

    // Creating again, as though no profile existed, must not overwrite.
    const recreated = await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Someone Else',
        languages: ['fr'],
      }),
    );
    expect(recreated.status).toBe(409);
    expect(((await recreated.json()) as { code: string }).code).toBe(
      'STATE_CONFLICT',
    );

    const stale = await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Stale',
        expectedVersion: 99,
        languages: ['fr'],
      }),
    );
    expect(stale.status).toBe(409);

    const updated = await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Ada L',
        expectedVersion: 1,
        languages: ['en'],
      }),
    );
    expect(updated.status).toBe(200);
    const second = (await updated.json()) as ProfileBody;
    expect(second.version).toBe(2);
    expect(second.displayName).toBe('Ada L');
    // The removed language is gone, not merged.
    expect(second.languages).toEqual(['en']);
    expect(second.bio).toBeUndefined();
  });

  it('lets exactly one of many simultaneous edits win', async () => {
    const caller = await admittedConsumer('profile-race@velora.test');
    await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Start',
        languages: ['en'],
      }),
    );

    const attempts = 12;
    const responses = await Promise.all(
      Array.from({ length: attempts }, (_value, index) =>
        api.handle(
          post('/v1/users/me/profile', caller, {
            displayName: `Edit ${String(index)}`,
            expectedVersion: 1,
            languages: ['en'],
          }),
        ),
      ),
    );
    const accepted = responses.filter((response) => response.status === 200);
    expect(accepted).toHaveLength(1);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(attempts - 1);

    const profile = await readProfile(caller);
    expect(profile.version).toBe(2);
  });

  it('refuses profile input outside the published contract', async () => {
    const caller = await admittedConsumer('profile-input@velora.test');
    const cases: Record<string, unknown>[] = [
      { displayName: 'A', languages: ['en'] },
      { displayName: 'a'.repeat(33), languages: ['en'] },
      { displayName: ' Padded ', languages: ['en'] },
      { displayName: 'Ada', languages: [] },
      { displayName: 'Ada', languages: ['en', 'en'] },
      { displayName: 'Ada', languages: ['english'] },
      { displayName: 'Ada', languages: ['EN'] },
      { displayName: 'Ada', languages: ['en'], region: 'DE' },
      { bio: 'x'.repeat(501), displayName: 'Ada', languages: ['en'] },
      { displayName: 'Ada', expectedVersion: 0, languages: ['en'] },
      { languages: ['en'] },
    ];
    for (const body of cases) {
      const response = await api.handle(
        post('/v1/users/me/profile', caller, body),
      );
      expect(response.status, JSON.stringify(body)).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe(
        'VALIDATION_FAILED',
      );
    }
  });
});

describe('profile media lifecycle', () => {
  it('reserves a slot, inspects the stored bytes, and only then shows the image', async () => {
    const caller = await admittedConsumer('media-happy@velora.test');
    const created = await api.handle(
      post('/v1/users/me/profile/media', caller),
    );
    expect(created.status).toBe(201);
    const upload = (await created.json()) as {
      readonly expiresAt: string;
      readonly maximumBytes: number;
      readonly mediaId: string;
      readonly method: string;
      readonly uploadUrl: string;
    };
    expect(upload.method).toBe('PUT');
    expect(upload.maximumBytes).toBe(8 * 1024 * 1024);

    const pending = await readProfile(caller);
    expect(pending.media).toHaveLength(1);
    expect(pending.media[0]?.state).toBe('pending_upload');
    // Nothing is discoverable-ready until the platform has seen the bytes.
    expect(pending.outstandingRequirements).toContain('ready_media');

    await placeBytes(upload.mediaId, await realImage());

    const completed = await api.handle(
      post('/v1/users/me/profile/media/completion', caller, {
        mediaId: upload.mediaId,
      }),
    );
    expect(completed.status).toBe(200);
    // Completion is a signal, not a promotion. The platform has the bytes and
    // is working out what they are, and saying "ready" here would be the fake
    // success this whole pipeline exists to avoid.
    const checking = (await completed.json()) as ProfileBody;
    expect(checking.media[0]?.state).toBe('checking');
    expect(checking.outstandingRequirements).toContain('ready_media');

    await settleMedia();
    const ready = await readProfile(caller);
    expect(ready.media[0]?.state).toBe('ready');
    expect(ready.outstandingRequirements).not.toContain('ready_media');
  });

  it('records the type from the bytes, never from what a client claims', async () => {
    const caller = await admittedConsumer('media-sniff@velora.test');
    const created = await api.handle(
      post('/v1/users/me/profile/media', caller),
    );
    const upload = (await created.json()) as { mediaId: string };
    // A text file, whatever a client might have called it.
    await placeBytes(upload.mediaId, notAnImage);

    const completed = await api.handle(
      post('/v1/users/me/profile/media/completion', caller, {
        mediaId: upload.mediaId,
      }),
    );
    expect(completed.status).toBe(200);
    await settleMedia();

    const profile = await readProfile(caller);
    expect(profile.media[0]?.state).toBe('rejected');
    // Coarse on purpose: what the uploader needs is enough to fix the file,
    // and the internal distinction between undecodable and unsupported is
    // useful to somebody probing what the platform accepts.
    expect(profile.media[0]?.rejectionReason).toBe('unsupported_type');
    expect(profile.complete).toBe(false);
  });

  it('does not accept a completion for bytes that never arrived', async () => {
    const caller = await admittedConsumer('media-missing@velora.test');

    const first = await api.handle(post('/v1/users/me/profile/media', caller));
    const missing = (await first.json()) as { mediaId: string };
    const completed = await api.handle(
      post('/v1/users/me/profile/media/completion', caller, {
        mediaId: missing.mediaId,
      }),
    );
    expect(completed.status).toBe(200);

    // Still waiting, because the platform asked the provider and there was
    // nothing there. A client saying it uploaded does not make it so.
    const profile = (await completed.json()) as ProfileBody;
    expect(profile.media[0]?.state).toBe('pending_upload');
    expect(profile.outstandingRequirements).toContain('ready_media');
  });

  it('will not accept bytes written after the window closed', async () => {
    const caller = await admittedConsumer('media-expired@velora.test');
    const created = await api.handle(
      post('/v1/users/me/profile/media', caller),
    );
    const expiring = (await created.json()) as { mediaId: string };
    await placeBytes(expiring.mediaId, await realImage());

    clockOffsetMilliseconds = mediaUploadWindowMilliseconds + 1_000;
    // The sweep closes the spent window, exactly as the worker would.
    await api.media.service.sweepExpiredUploads();

    const completed = await api.handle(
      post('/v1/users/me/profile/media/completion', caller, {
        mediaId: expiring.mediaId,
      }),
    );
    expect(completed.status).toBe(200);
    await settleMedia();

    // The bytes were there; the capability to use them was not.
    const profile = await readProfile(caller);
    expect(profile.media[0]?.state).toBe('pending_upload');
    expect(profile.complete).toBe(false);
  });

  it('treats a repeated completion as the same success', async () => {
    const caller = await admittedConsumer('media-idempotent@velora.test');
    const attached = await attachImage(caller);

    const repeated = await api.handle(
      post('/v1/users/me/profile/media/completion', caller, {
        mediaId: attached.mediaId,
      }),
    );
    expect(repeated.status).toBe(200);
    const profile = (await repeated.json()) as ProfileBody;
    expect(profile.media).toHaveLength(1);
    expect(profile.media[0]?.state).toBe('ready');

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_profile_media
                   where state = 'attached'`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('bounds the number of images and keeps concurrent creations on distinct slots', async () => {
    const caller = await admittedConsumer('media-slots@velora.test');

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        api.handle(post('/v1/users/me/profile/media', caller)),
      ),
    );
    const created = responses.filter((response) => response.status === 201);
    const refused = responses.filter((response) => response.status === 409);
    expect(created).toHaveLength(6);
    expect(refused).toHaveLength(4);
    for (const response of refused) {
      expect(((await response.json()) as { code: string }).code).toBe(
        'LIMIT_REACHED',
      );
    }

    const positions = await rowsOf<{ position: number }>(
      database.sql`select position from users_profile_media order by position`,
    );
    expect(positions.map((row) => row.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('frees a slot when an image is removed and keeps the removed record', async () => {
    const caller = await admittedConsumer('media-removal@velora.test');
    const attached = await attachImage(caller);

    const removed = await api.handle(
      post('/v1/users/me/profile/media/removal', caller, {
        mediaId: attached.mediaId,
      }),
    );
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as ProfileBody).media).toHaveLength(0);

    const repeated = await api.handle(
      post('/v1/users/me/profile/media/removal', caller, {
        mediaId: attached.mediaId,
      }),
    );
    expect(repeated.status).toBe(404);

    const rows = await rowsOf<{ state: string }>(
      database.sql`select state from users_profile_media where id = ${attached.mediaId}`,
    );
    expect(rows[0]?.state).toBe('removed');

    // The freed slot is reusable without renumbering anything.
    const next = await api.handle(post('/v1/users/me/profile/media', caller));
    expect(next.status).toBe(201);
    const live = await rowsOf<{ position: number }>(
      database.sql`select position from users_profile_media where state <> 'removed'`,
    );
    expect(live).toHaveLength(1);
    expect(live[0]?.position).toBe(0);
  });

  it('never exposes storage keys, checksums, or the adapter to a client', async () => {
    const caller = await admittedConsumer('media-privacy@velora.test');
    const attached = await attachImage(caller);
    const serialized = JSON.stringify(attached.profile);

    expect(serialized).not.toContain('local-test');
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('checksum');
    // No content type any more, and that is the point rather than an
    // omission: what format some bytes turned out to be is the media
    // platform's answer, no surface renders it, and restating it here would be
    // this domain publishing a fact it no longer holds. No upload expiry
    // either, because the window has closed.
    expect(Object.keys(attached.profile.media[0] ?? {}).sort()).toEqual([
      'id',
      'position',
      'state',
    ]);
    // Nothing about the media platform's internals reaches a client.
    expect(serialized).not.toContain('media/');
    expect(serialized).not.toContain('objectKey');
    expect(serialized).not.toContain('digest');
  });

  it('fails closed where no storage provider is approved', async () => {
    const caller = await signIn('media-unavailable@velora.test');
    await withoutStorage.handle(post('/v1/users', caller));
    await withoutStorage.handle(
      post('/v1/users/me/onboarding/adult-declaration', caller, {
        declaresAdult: true,
        region: 'DE',
      }),
    );
    await withoutStorage.handle(
      post('/v1/users/me/onboarding/acknowledgements', caller, {
        acknowledgements: allRequiredPolicies,
      }),
    );

    const refused = await withoutStorage.handle(
      post('/v1/users/me/profile/media', caller),
    );
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { code: string }).code).toBe(
      'DEPENDENCY_UNAVAILABLE',
    );

    // No slot was reserved, so nothing is left behind that nobody can fill.
    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_profile_media`,
    );
    expect(rows[0]?.count).toBe('0');
  });
});

describe('media ownership', () => {
  it('gives one account no way to address another account object', async () => {
    const owner = await admittedConsumer('media-owner@velora.test');
    const attacker = await admittedConsumer('media-attacker@velora.test');
    const attached = await attachImage(owner);

    for (const path of [
      '/v1/users/me/profile/media/completion',
      '/v1/users/me/profile/media/removal',
    ]) {
      const response = await api.handle(
        post(path, attacker, { mediaId: attached.mediaId }),
      );
      // Indistinguishable from an identifier that does not exist.
      expect(response.status, path).toBe(404);
      expect(((await response.json()) as { code: string }).code).toBe(
        'RESOURCE_NOT_FOUND',
      );
    }

    // The owner's slot is untouched. `attached` is USERS' answer about the
    // association, which is the only state this table holds now; whether the
    // bytes are usable is the media platform's, and the profile read below is
    // what asks it.
    const rows = await rowsOf<{ state: string }>(
      database.sql`select state from users_profile_media where id = ${attached.mediaId}`,
    );
    expect(rows[0]?.state).toBe('attached');
    expect((await readProfile(owner)).media[0]?.state).toBe('ready');
  });

  it('refuses every profile operation to a caller with no consumer credential', async () => {
    const paths: [string, 'get' | 'post'][] = [
      ['/v1/users/me/profile', 'get'],
      ['/v1/users/me/profile', 'post'],
      ['/v1/users/me/preferences', 'post'],
      ['/v1/users/me/profile/media', 'post'],
      ['/v1/users/me/profile/media/completion', 'post'],
      ['/v1/users/me/profile/media/removal', 'post'],
    ];
    for (const [path, method] of paths) {
      const response = await api.handle(
        new Request(`http://api.test${path}`, {
          ...(method === 'post'
            ? { body: '{}', method: 'POST' }
            : { method: 'GET' }),
          headers: { 'content-type': 'application/json' },
        }),
      );
      expect(response.status, `${method} ${path}`).toBe(401);
    }

    const creator = await signIn('media-creator@velora.test', 'creator_studio');
    const refused = await api.handle(
      new Request('http://api.test/v1/users/me/profile', {
        headers: { cookie: creator.cookie, origin: testCreatorOrigin },
      }),
    );
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe(
      'CONSUMER_SURFACE_REQUIRED',
    );
  });
});

describe('discoverability and activation', () => {
  it('leaves a new consumer non-discoverable and refuses to turn it on early', async () => {
    const caller = await admittedConsumer('discover-default@velora.test');
    const initial = await readProfile(caller);
    expect(initial.discoverable).toBe(false);
    expect(initial.complete).toBe(false);

    const refused = await api.handle(
      post('/v1/users/me/preferences', caller, { discoverable: true }),
    );
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { code: string }).code).toBe(
      'ACCOUNT_NOT_ELIGIBLE',
    );

    const rows = await rowsOf<{ count: string }>(
      database.sql`select count(*)::text as count from users_preferences where discoverable`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('activates the account only once the minimum profile is complete', async () => {
    const caller = await admittedConsumer('discover-activation@velora.test');
    expect(await accountStatus(caller)).toBe('pending_profile');

    await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Complete',
        languages: ['de'],
      }),
    );
    expect(await accountStatus(caller)).toBe('pending_profile');

    const attached = await attachImage(caller);
    expect(attached.profile.complete).toBe(true);
    expect(attached.profile.outstandingRequirements).toEqual([]);
    expect(await accountStatus(caller)).toBe('active');

    const enabled = await api.handle(
      post('/v1/users/me/preferences', caller, { discoverable: true }),
    );
    expect(enabled.status).toBe(200);
    const withPreference = (await enabled.json()) as ProfileBody;
    expect(withPreference.discoverable).toBe(true);
    expect(withPreference.preferencesVersion).toBe(1);
  });

  it('withdraws activation and discoverability when the profile stops qualifying', async () => {
    const caller = await admittedConsumer('discover-withdrawn@velora.test');
    await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Briefly Visible',
        languages: ['de'],
      }),
    );
    const attached = await attachImage(caller);
    await api.handle(
      post('/v1/users/me/preferences', caller, { discoverable: true }),
    );
    expect(await accountStatus(caller)).toBe('active');

    const removed = await api.handle(
      post('/v1/users/me/profile/media/removal', caller, {
        mediaId: attached.mediaId,
      }),
    );
    expect(removed.status).toBe(200);
    const after = (await removed.json()) as ProfileBody;

    // Losing the last image must not leave a visible account behind.
    expect(after.complete).toBe(false);
    expect(after.discoverable).toBe(false);
    expect(after.outstandingRequirements).toEqual(['ready_media']);
    expect(await accountStatus(caller)).toBe('pending_profile');
  });

  it('requires the preference version once a preference has been saved', async () => {
    const caller = await admittedConsumer('discover-versions@velora.test');
    await api.handle(
      post('/v1/users/me/profile', caller, {
        displayName: 'Versioned',
        languages: ['de'],
      }),
    );
    await attachImage(caller);

    const first = await api.handle(
      post('/v1/users/me/preferences', caller, { discoverable: true }),
    );
    expect(first.status).toBe(200);

    const withoutVersion = await api.handle(
      post('/v1/users/me/preferences', caller, { discoverable: false }),
    );
    expect(withoutVersion.status).toBe(409);

    const withVersion = await api.handle(
      post('/v1/users/me/preferences', caller, {
        discoverable: false,
        expectedVersion: 1,
      }),
    );
    expect(withVersion.status).toBe(200);
    expect(((await withVersion.json()) as ProfileBody).discoverable).toBe(
      false,
    );
  });

  it('reports the outstanding profile requirements on the admission state', async () => {
    const caller = await admittedConsumer('discover-admission@velora.test');
    const response = await api.handle(get('/v1/users/me/onboarding', caller));
    const body = (await response.json()) as {
      readonly outstandingProfile: readonly string[];
      readonly step: string;
    };
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.step).toBe('profile');
    // The region was set by the adult declaration, so it is not outstanding.
    expect(body.outstandingProfile).toEqual([
      'display_name',
      'language',
      'ready_media',
    ]);
  });
});

describe('database constraints protect profile invariants', () => {
  async function seedAccount(): Promise<string> {
    const id = crypto.randomUUID();
    await execute(
      database.sql`insert into users_accounts (auth_account_id, created_at, id, region, status, status_changed_at, updated_at)
        values (${crypto.randomUUID()}, now(), ${id}, 'DE', 'pending_profile', now(), now())`,
    );
    return id;
  }

  it('refuses a display name that renders as another one', async () => {
    const userId = await seedAccount();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_profiles (display_name, user_id) values (' Padded ', ${userId})`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_profiles (display_name, user_id) values (E'Ada\\u0007', ${userId})`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_profiles (display_name, user_id) values ('A', ${userId})`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a language outside the accepted shape', async () => {
    const userId = await seedAccount();
    for (const language of ['EN', 'english', 'e', '']) {
      expect(
        await refused(() =>
          execute(
            database.sql`insert into users_profile_languages (language, user_id) values (${language}, ${userId})`,
          ),
        ),
      ).toBe(true);
    }
  });

  it('refuses a ready image the platform never measured', async () => {
    const userId = await seedAccount();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_profile_media (id, position, state, state_changed_at, storage_key, upload_expires_at, user_id)
          values (${crypto.randomUUID()}, 0, 'ready', now(), 'key-a', now(), ${userId})`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses a rejection with no reason and a reason with no rejection', async () => {
    const userId = await seedAccount();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_profile_media (id, position, state, state_changed_at, storage_key, upload_expires_at, user_id)
          values (${crypto.randomUUID()}, 0, 'rejected', now(), 'key-b', now(), ${userId})`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_profile_media (id, position, rejection_reason, state, state_changed_at, storage_key, upload_expires_at, user_id)
          values (${crypto.randomUUID()}, 0, 'too_large', 'pending_upload', now(), 'key-c', now(), ${userId})`,
        ),
      ),
    ).toBe(true);
  });

  it('refuses two live images in the same slot but allows a removed one to share it', async () => {
    const userId = await seedAccount();
    const slot = (position: number, state: string) =>
      database.sql`insert into users_profile_media (id, media_asset_id, position, state, state_changed_at, user_id)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${position}, ${state}, now(), ${userId})`;

    await execute(slot(0, 'attached'));
    expect(await refused(() => execute(slot(0, 'attached')))).toBe(true);
    // Removing an image frees its slot without renumbering anything and
    // without losing the record that it was there.
    await execute(slot(0, 'removed'));
  });

  it('refuses a slot outside the published maximum and a state it does not own', async () => {
    const userId = await seedAccount();
    const slot = (position: number, state: string) =>
      database.sql`insert into users_profile_media (id, media_asset_id, position, state, state_changed_at, user_id)
        values (${crypto.randomUUID()}, ${crypto.randomUUID()}, ${position}, ${state}, now(), ${userId})`;

    expect(await refused(() => execute(slot(6, 'attached')))).toBe(true);
    // `ready` was never this domain's answer and is no longer a value it can
    // hold. What the platform worked out about some bytes lives in MEDIA.
    expect(await refused(() => execute(slot(1, 'ready')))).toBe(true);
  });

  it('gives one asset to at most one slot', async () => {
    const userId = await seedAccount();
    const assetId = crypto.randomUUID();
    const slot = (position: number) =>
      database.sql`insert into users_profile_media (id, media_asset_id, position, state, state_changed_at, user_id)
        values (${crypto.randomUUID()}, ${assetId}, ${position}, 'attached', now(), ${userId})`;

    await execute(slot(0));
    // One asset cannot be spent twice across a profile, however many slots are
    // free.
    expect(await refused(() => execute(slot(1)))).toBe(true);
  });

  it('refuses a preference or profile version below one', async () => {
    const userId = await seedAccount();
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_preferences (user_id, version) values (${userId}, 0)`,
        ),
      ),
    ).toBe(true);
    expect(
      await refused(() =>
        execute(
          database.sql`insert into users_profiles (display_name, user_id, version) values ('Ada', ${userId}, 0)`,
        ),
      ),
    ).toBe(true);
  });
});

describe('the readiness sweep reads its index rather than the table', () => {
  it('serves `asc nulls first` from an index declared the same way', async () => {
    // No volume needed, and that is the point of asking it this way. A b-tree
    // ASC index stores nulls **last**, so an index declared `(checked_at, id)`
    // cannot serve `order by checked_at asc nulls first` at any size — the
    // planner must sort. With sequential scans off, a matching index answers
    // with a plain index scan and a mismatched one still sorts, so the
    // assertion catches the defect without seeding a hundred thousand rows to
    // make a cost comparison tip.
    //
    // This was real: the index was declared without `nulls first`, the sweep
    // scanned and sorted every attached slot on every cycle, and the comment
    // above the query claimed the index served it. Measured at two hundred
    // thousand rows before the fix: parallel sequential scan plus sort.
    const plan = await database.sql.begin(async (connection: Bun.SQL) => {
      // Bitmap scans too, and not as belt and braces: a bitmap scan discards
      // index order by construction, so at any volume small enough for the
      // planner to prefer one it would sort regardless of how the index is
      // declared, and the assertion would fail against a correct schema. With
      // both off the planner must reach for an ordered index scan, which a
      // matching index can satisfy without a sort and a mismatched one cannot.
      await execute(
        connection.unsafe(
          'set local enable_seqscan = off; set local enable_bitmapscan = off',
        ),
      );
      const rows = await rowsOf<Record<string, string>>(
        connection.unsafe(
          `explain select id from users_profile_media where state = 'attached'
           order by readiness_checked_at asc nulls first, id asc limit 100`,
        ),
      );
      return rows.map((row) => Object.values(row).join(' ')).join('\n');
    });

    expect(plan).toContain('users_profile_media_readiness_idx');
    // The ordering comes from the index. A sort here would mean the sweep pays
    // for every attached slot on the platform to find the twenty it wants.
    expect(plan).not.toContain('Sort');
  });
});
