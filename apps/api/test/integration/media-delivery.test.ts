import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import {
  mediaDeliveryCredentialSeconds,
  type MediaAssetClass,
  type MediaOwnerDomain,
} from '../../src/media/policy.js';
import type {
  MediaAssociation,
  MediaAssociationPort,
  MediaSafetyPort,
} from '../../src/media/publication.js';
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
 * Authorized delivery.
 *
 * Two things are being held to account. That nothing is served without the
 * publication authority having said yes at the moment of issuance, and that a
 * credential which was issued is bounded, bound to one thing, and honestly
 * described — including the half of revocation the platform cannot perform.
 */

const databaseUrl = await provisionDatabase('velora_media_delivery');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-delivery-'));

let association: MediaAssociation | undefined = {
  audience: 'restricted',
  published: true,
  viewerEntitled: true,
};
let safetyAllows = true;
let clock = new Date('2026-08-16T12:00:00.000Z');

const associationPort: MediaAssociationPort = {
  describe: () => Promise.resolve(association),
};
const safetyPort: MediaSafetyPort = {
  mayDeliver: () => Promise.resolve(safetyAllows),
};

function runtime(overrides: { readonly signingKey?: string } = {}) {
  return createMediaRuntime({
    association: associationPort,
    config: testServerConfig({
      MEDIA_DELIVERY_SIGNING_KEY:
        overrides.signingKey ?? 'development-only-key',
      MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
      MEDIA_MALWARE_SCANNER: 'local-test',
      MEDIA_STORAGE_PROVIDER: 'local-test',
    }),
    database: database.drizzle,
    logger: silentLogger(),
    now: () => clock,
    performsByteWork: true,
    safety: safetyPort,
  });
}

const media = runtime();
const storage = media.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '11111111-1111-4111-8111-111111111111',
};
const viewer = '33333333-3333-4333-8333-333333333333';
const profileImage: MediaAssetClass = 'consumer_profile_image';
let operation = 0;

async function readyAsset(): Promise<string> {
  operation += 1;
  const created = await media.service.createUpload({
    assetClass: profileImage,
    idempotencyKey: `delivery-${String(operation).padStart(4, '0')}`,
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
  await media.service.runInspections({ owner: 'test-worker' });
  await media.service.runProcessing({ owner: 'test-worker' });
  return created.asset.id;
}

function authorize(
  assetId: string,
  variantKind: 'avatar_small' | 'display' = 'avatar_small',
) {
  return media.delivery.authorize({
    assetId,
    executor: media.repository.transactionless,
    surface: 'web',
    variantKind,
    viewerId: viewer,
  });
}

/** Pulls the signed parts out of a grant so they can be checked and tampered. */
function grantParts(url: string) {
  const parsed = new URL(url);
  const objectKey = parsed.pathname.replace('/local-test/', '');
  return {
    expires: Number(parsed.searchParams.get('expires')),
    objectKey,
    signature: parsed.searchParams.get('signature') ?? '',
  };
}

beforeEach(async () => {
  await database.truncate();
  association = {
    audience: 'restricted',
    published: true,
    viewerEntitled: true,
  };
  safetyAllows = true;
  clock = new Date('2026-08-16T12:00:00.000Z');
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('nothing is served without a decision', () => {
  it('refuses when safety holds the asset', async () => {
    const assetId = await readyAsset();
    safetyAllows = false;

    const outcome = await authorize(assetId);
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.reasonCode).toBe('safety_restricted');
  });

  it('refuses a viewer with no entitlement', async () => {
    const assetId = await readyAsset();
    association = {
      audience: 'restricted',
      published: true,
      viewerEntitled: false,
    };

    expect((await authorize(assetId)).kind).toBe('denied');
  });

  it('refuses an asset that never finished processing', async () => {
    operation += 1;
    const created = await media.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: `delivery-${String(operation).padStart(4, '0')}`,
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    const outcome = await authorize(created.asset.id);
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.closedGates).toContain('not_technically_ready');
  });

  it('refuses a variant the class does not own before minting anything', async () => {
    const assetId = await readyAsset();
    const outcome = await media.delivery.authorize({
      assetId,
      executor: media.repository.transactionless,
      surface: 'web',
      variantKind: 'card',
      viewerId: viewer,
    });
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.closedGates).toContain('unknown_variant');
  });
});

describe('public and restricted are different things', () => {
  it('gives a public derivative an immutable, shareable address', async () => {
    const assetId = await readyAsset();
    association = { audience: 'public', published: true, viewerEntitled: true };

    const outcome = await authorize(assetId);
    expect(outcome.kind).toBe('public');
    if (outcome.kind !== 'public') return;
    expect(outcome.cacheControl).toBe('public, max-age=31536000, immutable');
    // No expiry and no signature: it is genuinely public, and its address
    // changes when its content does rather than being reused behind a cache.
    expect(outcome.url).not.toContain('signature=');
    expect(outcome.url).not.toContain('expires=');
  });

  it('never marks a restricted response shareable', async () => {
    const assetId = await readyAsset();

    const outcome = await authorize(assetId);
    expect(outcome.kind).toBe('private');
    if (outcome.kind !== 'private') return;
    expect(outcome.cacheControl).toBe('private, no-store');
  });

  it('serves a derivative and never the original', async () => {
    const assetId = await readyAsset();
    association = { audience: 'public', published: true, viewerEntitled: true };
    const [original] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects
                   where asset_id = ${assetId} and role = 'original'`,
    );

    const outcome = await authorize(assetId);
    expect(outcome.kind).toBe('public');
    if (outcome.kind !== 'public') return;
    expect(outcome.url).not.toContain(original?.object_key ?? 'absent');
    expect(outcome.url).toContain('/variant/');
  });
});

describe('a credential is bounded and bound', () => {
  it('reports the exposure a revocation cannot close', async () => {
    const assetId = await readyAsset();

    const outcome = await authorize(assetId);
    expect(outcome.kind).toBe('private');
    if (outcome.kind !== 'private') return;
    // Reported on the grant so that no caller can describe delivery without
    // naming the window. New authorizations stop immediately; this one does
    // not, and saying otherwise would be false.
    expect(outcome.maximumRevocationExposureSeconds).toBe(
      mediaDeliveryCredentialSeconds,
    );
    expect(outcome.maximumRevocationExposureSeconds).toBe(300);
    expect(outcome.expiresAt.getTime() - clock.getTime()).toBe(
      mediaDeliveryCredentialSeconds * 1000,
    );
  });

  it('stops working the moment it expires', async () => {
    const assetId = await readyAsset();
    const outcome = await authorize(assetId);
    if (outcome.kind !== 'private') throw new Error('expected a credential');
    const parts = grantParts(outcome.url);

    expect(await storage.verifyDelivery({ at: clock, ...parts })).toBe(true);
    expect(
      await storage.verifyDelivery({
        at: new Date(outcome.expiresAt.getTime() + 1),
        ...parts,
      }),
    ).toBe(false);
  });

  it('does not open a different variant of the same asset', async () => {
    const assetId = await readyAsset();
    const small = await authorize(assetId, 'avatar_small');
    const large = await authorize(assetId, 'display');
    if (small.kind !== 'private' || large.kind !== 'private') {
      throw new Error('expected credentials');
    }

    const smallParts = grantParts(small.url);
    const largeParts = grantParts(large.url);
    expect(smallParts.objectKey).not.toBe(largeParts.objectKey);

    // The signature is over the object, so carrying one across does nothing.
    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: smallParts.expires,
        objectKey: largeParts.objectKey,
        signature: smallParts.signature,
      }),
    ).toBe(false);
  });

  it('does not open another asset', async () => {
    const mine = await readyAsset();
    const theirs = await readyAsset();
    const grant = await authorize(mine);
    const other = await authorize(theirs);
    if (grant.kind !== 'private' || other.kind !== 'private') {
      throw new Error('expected credentials');
    }

    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: grantParts(grant.url).expires,
        objectKey: grantParts(other.url).objectKey,
        signature: grantParts(grant.url).signature,
      }),
    ).toBe(false);
  });

  it('refuses a request that never went through the authority', async () => {
    const assetId = await readyAsset();
    const [variant] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_objects
                   where asset_id = ${assetId} and role = 'variant' limit 1`,
    );

    // Somebody who learned an object key and went straight at the origin. Key
    // knowledge is not the authorization model, so it buys nothing.
    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: Math.floor(clock.getTime() / 1000) + 3600,
        objectKey: variant?.object_key ?? '',
        signature: 'f'.repeat(64),
      }),
    ).toBe(false);
    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: Math.floor(clock.getTime() / 1000) + 3600,
        objectKey: variant?.object_key ?? '',
        signature: '',
      }),
    ).toBe(false);
  });

  it('refuses an extended expiry, because the instant is signed too', async () => {
    const assetId = await readyAsset();
    const outcome = await authorize(assetId);
    if (outcome.kind !== 'private') throw new Error('expected a credential');
    const parts = grantParts(outcome.url);

    expect(
      await storage.verifyDelivery({
        at: clock,
        expires: parts.expires + 86_400,
        objectKey: parts.objectKey,
        signature: parts.signature,
      }),
    ).toBe(false);
  });
});

describe('new authorizations stop immediately', () => {
  it('refuses the next issuance the moment safety changes its answer', async () => {
    const assetId = await readyAsset();
    const before = await authorize(assetId);
    expect(before.kind).toBe('private');

    safetyAllows = false;
    expect((await authorize(assetId)).kind).toBe('denied');

    // And the credential minted before the hold still verifies, which is
    // exactly the exposure the grant reports rather than hides.
    if (before.kind !== 'private') return;
    expect(
      await storage.verifyDelivery({ at: clock, ...grantParts(before.url) }),
    ).toBe(true);
    expect(
      await storage.verifyDelivery({
        at: new Date(before.expiresAt.getTime() + 1),
        ...grantParts(before.url),
      }),
    ).toBe(false);
  });

  it('refuses once the asset is being removed', async () => {
    const assetId = await readyAsset();
    await media.service.requestDeletion({ assetId });

    const outcome = await authorize(assetId);
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.reasonCode).toBe('removed');
  });
});

describe('two replicas, one answer', () => {
  it('accepts a credential minted by another replica sharing the key', async () => {
    const assetId = await readyAsset();
    const other = runtime();

    const outcome = await other.delivery.authorize({
      assetId,
      executor: other.repository.transactionless,
      surface: 'web',
      variantKind: 'avatar_small',
      viewerId: viewer,
    });
    if (outcome.kind !== 'private') throw new Error('expected a credential');

    // Issued on one replica, verified on another. This is why the signing key
    // is configured rather than generated per process.
    expect(
      await storage.verifyDelivery({ at: clock, ...grantParts(outcome.url) }),
    ).toBe(true);
  });

  it('rejects one minted under a different key', async () => {
    const assetId = await readyAsset();
    const stranger = runtime({ signingKey: 'a-different-development-key' });

    const outcome = await stranger.delivery.authorize({
      assetId,
      executor: stranger.repository.transactionless,
      surface: 'web',
      variantKind: 'avatar_small',
      viewerId: viewer,
    });
    if (outcome.kind !== 'private') throw new Error('expected a credential');

    expect(
      await storage.verifyDelivery({ at: clock, ...grantParts(outcome.url) }),
    ).toBe(false);
  });
});

describe('no approved provider serves nothing', () => {
  it('reports unavailable rather than denying for a policy reason', async () => {
    const assetId = await readyAsset();
    const unavailable = createMediaRuntime({
      association: associationPort,
      config: testServerConfig(),
      database: database.drizzle,
      logger: silentLogger(),
      now: () => clock,
      safety: safetyPort,
    });

    const outcome = await unavailable.delivery.authorize({
      assetId,
      executor: unavailable.repository.transactionless,
      surface: 'web',
      variantKind: 'avatar_small',
      viewerId: viewer,
    });
    // A distinct outcome from a refusal: nothing about this viewer or this
    // asset is wrong, there is simply no approved way to serve bytes.
    expect(outcome.kind).toBe('unavailable');
  });
});
