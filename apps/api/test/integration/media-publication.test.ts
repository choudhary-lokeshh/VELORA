import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { createMediaRuntime } from '../../src/media/composition.js';
import type {
  MediaAssetClass,
  MediaOwnerDomain,
} from '../../src/media/policy.js';
import {
  MediaPublicationAuthority,
  type MediaAssociation,
  type MediaAssociationPort,
  type MediaSafetyPort,
} from '../../src/media/publication.js';
import {
  SafetyBackedMediaSafety,
  type MediaContentSafetyPort,
  type MediaSafetySubject,
  type MediaSafetySubjectResolver,
} from '../../src/media/safety-bridge.js';
import type { LocalTestMediaStorage } from '../../src/media/storage.js';
import type { SafetyEligibilityPort } from '../../src/safety/eligibility.js';
import * as fixture from '../support/media-fixtures.js';
import {
  connectDatabase,
  provisionDatabase,
  rowsOf,
  type TestDatabase,
} from '../support/database.js';
import { silentLogger, testServerConfig } from '../support/harness.js';

/**
 * The bridge between what MEDIA knows and what may actually be shown.
 *
 * MEDIA contributes one term — is the derivative technically there — and asks
 * for every other one. What these tests hold it to is that the term it owns can
 * never carry the decision on its own, and that the answers it is given are
 * re-read at the moment of the decision rather than remembered.
 *
 * The safety doubles here are doubles of the *published contract*, not of the
 * policy engine. Reimplementing safety rules in a test fixture would prove that
 * the fixture agrees with itself.
 */

const databaseUrl = await provisionDatabase('velora_media_publication');
const database: TestDatabase = connectDatabase(databaseUrl);
const directory = await mkdtemp(join(tmpdir(), 'velora-media-publication-'));

const baseConfig = testServerConfig({
  MEDIA_DELIVERY_SIGNING_KEY: 'development-only-key',
  MEDIA_LOCAL_STORAGE_DIRECTORY: directory,
  MEDIA_MALWARE_SCANNER: 'local-test',
  MEDIA_STORAGE_PROVIDER: 'local-test',
});

/** A worker-shaped runtime that can carry an asset to `ready`. */
const pipeline = createMediaRuntime({
  config: baseConfig,
  database: database.drizzle,
  logger: silentLogger(),
  performsByteWork: true,
});
const storage = pipeline.storage as LocalTestMediaStorage;

const owner = {
  ownerDomain: 'users' as MediaOwnerDomain,
  ownerReference: '11111111-1111-4111-8111-111111111111',
};
const viewer = '33333333-3333-4333-8333-333333333333';
const profileImage: MediaAssetClass = 'consumer_profile_image';
let operation = 0;

/** Controllable stand-ins for the two answers MEDIA does not own. */
let association: MediaAssociation | undefined = {
  audience: 'restricted',
  published: true,
  viewerEntitled: true,
};
let safetyAllows = true;

const associationPort: MediaAssociationPort = {
  describe: () => Promise.resolve(association),
};
const safetyPort: MediaSafetyPort = {
  mayDeliver: () => Promise.resolve(safetyAllows),
};

const authority = new MediaPublicationAuthority({
  association: associationPort,
  repository: pipeline.repository,
  safety: safetyPort,
});

async function readyAsset(): Promise<string> {
  operation += 1;
  const created = await pipeline.service.createUpload({
    assetClass: profileImage,
    idempotencyKey: `publication-${String(operation).padStart(4, '0')}`,
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
  await pipeline.service.recordUpload({ assetId: created.asset.id, ...owner });
  await pipeline.service.runInspections({ owner: 'test-worker' });
  await pipeline.service.runProcessing({ owner: 'test-worker' });
  return created.asset.id;
}

function decide(assetId: string) {
  return authority.decide({
    assetId,
    executor: pipeline.repository.transactionless,
    now: new Date(),
    surface: 'web',
    variantKind: 'avatar_small',
    viewerId: viewer,
  });
}

beforeEach(async () => {
  await database.truncate();
  association = {
    audience: 'restricted',
    published: true,
    viewerEntitled: true,
  };
  safetyAllows = true;
});

afterAll(async () => {
  await database.close();
  await rm(directory, { force: true, recursive: true });
});

describe('technical readiness never carries the decision alone', () => {
  it('allows only when every authority agrees', async () => {
    const assetId = await readyAsset();
    expect(await decide(assetId)).toEqual({
      allowed: true,
      variantKind: 'avatar_small',
    });
  });

  it('refuses a ready asset that safety holds', async () => {
    const assetId = await readyAsset();
    safetyAllows = false;

    const decision = await decide(assetId);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reasonCode).toBe('safety_restricted');
  });

  it('refuses a ready asset nobody attaches', async () => {
    const assetId = await readyAsset();
    association = undefined;

    const decision = await decide(assetId);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.closedGates).toContain('not_attached');
  });

  it('refuses a ready, attached asset the owner has not published', async () => {
    const assetId = await readyAsset();
    association = {
      audience: 'restricted',
      published: false,
      viewerEntitled: true,
    };

    const decision = await decide(assetId);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.closedGates).toContain('not_published');
  });

  it('refuses a viewer the owning domain does not recognise', async () => {
    const assetId = await readyAsset();
    association = {
      audience: 'restricted',
      published: true,
      viewerEntitled: false,
    };

    const decision = await decide(assetId);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.closedGates).toContain('not_entitled');
  });
});

describe('what MEDIA itself refuses', () => {
  it('refuses an asset that has not been processed', async () => {
    operation += 1;
    const created = await pipeline.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: `publication-${String(operation).padStart(4, '0')}`,
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');

    const decision = await decide(created.asset.id);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.closedGates).toContain('not_technically_ready');
  });

  it('refuses a quarantined asset however permissive everything else is', async () => {
    operation += 1;
    const created = await pipeline.service.createUpload({
      assetClass: profileImage,
      idempotencyKey: `publication-${String(operation).padStart(4, '0')}`,
      ...owner,
    });
    if (created.kind !== 'upload_ready') throw new Error('expected an upload');
    const [session] = await rowsOf<{ readonly object_key: string }>(
      database.sql`select object_key from media_upload_sessions
                   where asset_id = ${created.asset.id} and state = 'issued'`,
    );
    await storage.putObject(session?.object_key ?? '', fixture.svg());
    await pipeline.service.recordUpload({
      assetId: created.asset.id,
      ...owner,
    });
    await pipeline.service.runInspections({ owner: 'test-worker' });

    const decision = await decide(created.asset.id);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reasonCode).toBe('quarantined');
  });

  it('refuses a variant the asset’s class does not have', async () => {
    const assetId = await readyAsset();
    const decision = await authority.decide({
      assetId,
      executor: pipeline.repository.transactionless,
      now: new Date(),
      surface: 'web',
      // A profile image owes avatars and a display, never a card.
      variantKind: 'card',
      viewerId: viewer,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.closedGates).toContain('unknown_variant');
  });

  it('refuses an asset that is being removed', async () => {
    const assetId = await readyAsset();
    await pipeline.service.requestDeletion({ assetId });

    const decision = await decide(assetId);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reasonCode).toBe('removed');
  });

  it('answers an unknown identifier the same way it answers an unattached one', async () => {
    const decision = await decide('44444444-4444-4444-8444-444444444444');
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    // Saying which would tell a stranger whether an identifier they guessed
    // names anything.
    expect(decision.reasonCode).toBe('not_attached');
  });
});

describe('every closed gate is reported, not only the first', () => {
  it('says how many separate things would have to change', async () => {
    const assetId = await readyAsset();
    association = {
      audience: 'restricted',
      published: false,
      viewerEntitled: false,
    };
    safetyAllows = false;

    const decision = await decide(assetId);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.closedGates).toEqual([
      'not_published',
      'not_entitled',
      'safety_restricted',
    ]);
    // Ordered by the vocabulary, so the headline is never whichever gate
    // happened to be evaluated last.
    expect(decision.reasonCode).toBe('not_published');
  });
});

describe('the answer is re-read, never remembered', () => {
  it('stops allowing the instant safety changes its mind', async () => {
    const assetId = await readyAsset();
    expect((await decide(assetId)).allowed).toBe(true);

    // The hold lands between one request and the next. Nothing about the asset
    // changed; the answer did.
    safetyAllows = false;
    expect((await decide(assetId)).allowed).toBe(false);

    safetyAllows = true;
    expect((await decide(assetId)).allowed).toBe(true);
  });

  it('gives two replicas the same answer from the same truth', async () => {
    const assetId = await readyAsset();
    safetyAllows = false;

    const answers = await Promise.all(
      Array.from({ length: 8 }, () => decide(assetId)),
    );
    // No replica gets a stale yes, because no replica is reading a cache.
    expect(answers.every((answer) => !answer.allowed)).toBe(true);
  });
});

describe('the safety bridge asks rather than decides', () => {
  const subject: MediaSafetySubject = {
    capability: 'creator_publication',
    contentGated: false,
    objectId: undefined,
    objectType: undefined,
    subjectId: '55555555-5555-4555-8555-555555555555',
  };
  const subjects: MediaSafetySubjectResolver = {
    resolve: () => Promise.resolve(subject),
  };

  function eligibility(
    overrides: Partial<SafetyEligibilityPort> = {},
  ): SafetyEligibilityPort {
    return {
      decide: () =>
        Promise.resolve({
          allowed: true,
          policyVersion: 'test',
          reasonCode: undefined,
          scope: undefined,
        }),
      isObjectRestricted: () => Promise.resolve(false),
      ...overrides,
    };
  }

  const ask = (bridge: SafetyBackedMediaSafety) =>
    bridge.mayDeliver({
      assetId: '66666666-6666-4666-8666-666666666666',
      executor: pipeline.repository.transactionless,
      now: new Date(),
      ownerDomain: 'users',
      surface: 'web',
    });

  it('denies when the subject cannot exercise the capability', async () => {
    expect(
      await ask(
        new SafetyBackedMediaSafety({
          eligibility: eligibility({
            decide: () =>
              Promise.resolve({
                allowed: false,
                policyVersion: 'test',
                reasonCode: 'creator_capability_suspended',
                scope: 'creator_suspension',
              }),
          }),
          subjects,
        }),
      ),
    ).toBe(false);
  });

  it('denies when the named object is held out of view', async () => {
    expect(
      await ask(
        new SafetyBackedMediaSafety({
          eligibility: eligibility({
            isObjectRestricted: () => Promise.resolve(true),
          }),
          subjects: {
            resolve: () =>
              Promise.resolve({
                ...subject,
                objectId: '77777777-7777-4777-8777-777777777777',
                objectType: 'creator_content',
              }),
          },
        }),
      ),
    ).toBe(false);
  });

  it('denies when nobody claims the asset', async () => {
    expect(
      await ask(
        new SafetyBackedMediaSafety({
          eligibility: eligibility(),
          subjects: { resolve: () => Promise.resolve(undefined) },
        }),
      ),
    ).toBe(false);
  });

  it('denies a content-gated asset when no content gate is wired', async () => {
    // The gap is represented rather than assumed away. An asset that needs a
    // gate nobody asked is not an asset that passed it, and this is what stops
    // Phase 8's missing wiring from reading as permission.
    expect(
      await ask(
        new SafetyBackedMediaSafety({
          eligibility: eligibility(),
          subjects: {
            resolve: () =>
              Promise.resolve({
                ...subject,
                contentGated: true,
                objectId: '77777777-7777-4777-8777-777777777777',
                objectType: 'creator_content',
              }),
          },
        }),
      ),
    ).toBe(false);
  });

  it('consults the content gate when one is wired, and obeys it', async () => {
    const content = (allowed: boolean): MediaContentSafetyPort => ({
      mayDeliverContent: () => Promise.resolve(allowed),
    });
    const gated: MediaSafetySubjectResolver = {
      resolve: () =>
        Promise.resolve({
          ...subject,
          contentGated: true,
          objectId: '77777777-7777-4777-8777-777777777777',
          objectType: 'creator_content',
        }),
    };

    expect(
      await ask(
        new SafetyBackedMediaSafety({
          content: content(true),
          eligibility: eligibility(),
          subjects: gated,
        }),
      ),
    ).toBe(true);
    expect(
      await ask(
        new SafetyBackedMediaSafety({
          content: content(false),
          eligibility: eligibility(),
          subjects: gated,
        }),
      ),
    ).toBe(false);
  });
});

describe('a composition nobody wired refuses', () => {
  it('denies delivery when no owning domain and no safety answer exist', async () => {
    const unwired = createMediaRuntime({
      config: baseConfig,
      database: database.drizzle,
      logger: silentLogger(),
    });
    const assetId = await readyAsset();

    const decision = await unwired.publication.decide({
      assetId,
      executor: pipeline.repository.transactionless,
      now: new Date(),
      surface: 'web',
      variantKind: 'avatar_small',
      viewerId: viewer,
    });

    // Not "no restrictions found". Nothing was asked, and nothing is not
    // permission.
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.closedGates).toEqual(['not_attached', 'safety_restricted']);
  });
});
