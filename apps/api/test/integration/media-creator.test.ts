import { afterAll, beforeEach, describe, expect, it } from 'bun:test';

import { CreatorContentMediaAssociation } from '../../src/clubs/content-media-association.js';
import { CreatorProfileMediaAssociation } from '../../src/creators/profile-media-association.js';
import { createMediaRuntime } from '../../src/media/composition.js';
import type { MediaAssetClass } from '../../src/media/policy.js';
import { RoutedMediaAssociation } from '../../src/media/publication.js';
import {
  RoutedMediaSafetySubjects,
  SafetyBackedMediaContentSafety,
  SafetyBackedMediaSafety,
} from '../../src/media/safety-bridge.js';
import { ContentSafetyGate } from '../../src/safety/content-safety.js';
import {
  DepictedPersonConsentService,
  UnpublishedConsentPolicy,
} from '../../src/safety/consent.js';
import { IdentityDepictedPersonEvidenceReader } from '../../src/identity/assurance-reader.js';
import { IdentityRepository } from '../../src/identity/repository.js';
import { SafetyEligibility } from '../../src/safety/eligibility.js';
import { SafetyRepository } from '../../src/safety/repository.js';
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
import { mediaEnvironment } from '../support/profile-media.js';

/**
 * Creator media: an avatar on a public page, and images on club content.
 *
 * This is the case the public/restricted split exists for. A creator's page is
 * genuinely public and has no viewer to entitle; a members-only item is
 * genuinely private and its images must never acquire a permanent address. And
 * a content attachment is the first thing on the platform that is
 * **content-gated**, which until now meant denied outright because nothing
 * could ask the gate.
 */

const databaseUrl = await provisionDatabase('velora_media_creator');
const database: TestDatabase = connectDatabase(databaseUrl);
const config = testServerConfig(mediaEnvironment);

const safetyRepository = new SafetyRepository(database.drizzle);
const eligibility = new SafetyEligibility(safetyRepository);
const creatorAssociation = new CreatorProfileMediaAssociation();
const contentAssociation = new CreatorContentMediaAssociation();
const routes = {
  clubs: contentAssociation,
  creators: creatorAssociation,
};

const media = createMediaRuntime({
  association: new RoutedMediaAssociation(routes),
  config,
  database: database.drizzle,
  logger: silentLogger(),
  performsByteWork: true,
  safety: new SafetyBackedMediaSafety({
    content: new SafetyBackedMediaContentSafety(
      new ContentSafetyGate({
        consent: new DepictedPersonConsentService({
          copy: new UnpublishedConsentPolicy(),
          identityEvidence: new IdentityDepictedPersonEvidenceReader(
            new IdentityRepository(database.drizzle),
          ),
          now: () => new Date(),
          repository: safetyRepository,
        }),
        eligibility,
        matureContentEnabled: false,
        now: () => new Date(),
        repository: safetyRepository,
      }),
    ),
    eligibility,
    subjects: new RoutedMediaSafetySubjects(routes),
  }),
});
const storage = media.storage as LocalTestMediaStorage;

const creatorId = '11111111-1111-4111-8111-111111111111';
const memberId = '22222222-2222-4222-8222-222222222222';
const outsiderId = '33333333-3333-4333-8333-333333333333';
let operation = 0;

/** An asset carried all the way to `ready`, owned by the named domain. */
async function readyAsset(
  ownerDomain: 'clubs' | 'creators',
  assetClass: MediaAssetClass,
): Promise<string> {
  operation += 1;
  const created = await media.service.createUpload({
    assetClass,
    idempotencyKey: `creator-media-${String(operation).padStart(4, '0')}`,
    ownerDomain,
    ownerReference: creatorId,
  });
  if (created.kind !== 'upload_ready') throw new Error('expected an upload');
  const [session] = await rowsOf<{ readonly object_key: string }>(
    database.sql`select object_key from media_upload_sessions
                 where asset_id = ${created.asset.id} and state = 'issued'`,
  );
  await storage.putObject(
    session?.object_key ?? '',
    await fixture.image({ format: 'jpeg' }),
  );
  await media.service.recordUpload({
    assetId: created.asset.id,
    ownerDomain,
    ownerReference: creatorId,
  });
  await media.service.runInspections({ owner: 'test' });
  await media.service.runProcessing({ owner: 'test' });
  return created.asset.id;
}

async function seedCreator(publication: string): Promise<void> {
  await execute(
    database.sql`insert into creators_accounts (activated_at, auth_account_id, created_at, id, status, status_changed_at, updated_at)
      values (now(), ${crypto.randomUUID()}, now(), ${creatorId}, 'active', now(), now())`,
  );
  await execute(
    database.sql`insert into creators_profiles (created_at, creator_id, display_name, handle, publication, published_at, updated_at)
      values (now(), ${creatorId}, 'Ada', ${'ada' + String(operation)}, ${publication},
              ${publication === 'published' ? new Date() : null}, now())`,
  );
}

async function attachToProfile(
  column: 'avatar_media_asset_id' | 'cover_media_asset_id',
  assetId: string,
): Promise<void> {
  await database.sql.unsafe(
    `update creators_profiles set ${column} = '${assetId}' where creator_id = '${creatorId}'`,
  );
}

async function seedContent(input: {
  readonly clubId: string | null;
  readonly lifecycle: string;
  readonly visibility: string;
}): Promise<string> {
  const contentId = crypto.randomUUID();
  await execute(
    database.sql`insert into clubs_content (club_id, created_at, creator_id, id, lifecycle, published_at, title, updated_at, visibility)
      values (${input.clubId}, now(), ${creatorId}, ${contentId}, ${input.lifecycle},
              ${input.lifecycle === 'published' ? new Date() : null}, 'An item', now(), ${input.visibility})`,
  );
  return contentId;
}

async function seedClub(): Promise<string> {
  const clubId = crypto.randomUUID();
  await execute(
    database.sql`insert into clubs_clubs (created_at, creator_id, id, lifecycle, name, published_at, slug, updated_at)
      values (now(), ${creatorId}, ${clubId}, 'published', 'The Club', now(), ${'club-' + String(operation)}, now())`,
  );
  return clubId;
}

async function attachToContent(
  contentId: string,
  assetId: string,
): Promise<void> {
  await execute(
    database.sql`insert into clubs_content_media (content_id, created_at, id, media_asset_id, position, updated_at)
      values (${contentId}, now(), ${crypto.randomUUID()}, ${assetId}, 0, now())`,
  );
}

function authorize(assetId: string, viewerId: string | undefined) {
  return media.delivery.authorize({
    assetId,
    executor: media.repository.transactionless,
    surface: 'web',
    variantKind: 'card',
    viewerId,
  });
}

beforeEach(async () => {
  await database.truncate();
});

afterAll(async () => {
  await database.close();
});

describe('a creator page is genuinely public', () => {
  it('gives a published avatar a permanent immutable address', async () => {
    const assetId = await readyAsset('creators', 'creator_avatar_image');
    await seedCreator('published');
    await attachToProfile('avatar_media_asset_id', assetId);

    const outcome = await media.delivery.authorize({
      assetId,
      executor: media.repository.transactionless,
      surface: 'web',
      variantKind: 'avatar_small',
      // Nobody is signed in. A public creator page has no viewer to entitle.
      viewerId: undefined,
    });
    expect(outcome.kind).toBe('public');
    if (outcome.kind !== 'public') return;
    expect(outcome.cacheControl).toContain('immutable');
  });

  it('refuses an avatar on a page the creator has not published', async () => {
    const assetId = await readyAsset('creators', 'creator_avatar_image');
    await seedCreator('draft');
    await attachToProfile('avatar_media_asset_id', assetId);

    const outcome = await media.delivery.authorize({
      assetId,
      executor: media.repository.transactionless,
      surface: 'web',
      variantKind: 'avatar_small',
      viewerId: undefined,
    });
    // A draft page is not a page yet, and an avatar on one is a file its owner
    // has not decided to show.
    expect(outcome.kind).toBe('denied');
  });

  it('refuses every creator asset once the creator is suspended', async () => {
    const assetId = await readyAsset('creators', 'creator_avatar_image');
    await seedCreator('published');
    await attachToProfile('avatar_media_asset_id', assetId);
    // Effective a minute ago, not "now". A restriction seeded with SQL `now()`
    // can carry an instant later than the JS `new Date()` the read passes, and
    // an already-effective enforcement then looks pending on a fast machine —
    // which is a race in the test, not in the gate.
    await execute(
      database.sql`insert into safety_enforcements (actor_reference, created_at, disposition, effective_at, id, policy_version, reason_code, scope, subject_id)
        values ('operator', now(), 'restrict', now() - interval '1 minute', ${crypto.randomUUID()}, 'v1', 'platform_integrity', 'creator_suspension', ${creatorId})`,
    );

    const outcome = await media.delivery.authorize({
      assetId,
      executor: media.repository.transactionless,
      surface: 'web',
      variantKind: 'avatar_small',
      viewerId: undefined,
    });
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.closedGates).toContain('safety_restricted');
  });
});

describe('club media never acquires a public address', () => {
  it('serves a members-only image only to a live member, and privately', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const clubId = await seedClub();
    const contentId = await seedContent({
      clubId,
      lifecycle: 'published',
      visibility: 'members_only',
    });
    await attachToContent(contentId, assetId);
    await execute(
      database.sql`insert into clubs_memberships (club_id, granted_at, id, member_id, source, state, updated_at)
        values (${clubId}, now(), ${crypto.randomUUID()}, ${memberId}, 'creator_invite', 'active', now())`,
    );

    const member = await authorize(assetId, memberId);
    expect(member.kind).toBe('private');
    if (member.kind !== 'private') return;
    // Never shareable, and never a permanent address.
    expect(member.cacheControl).toBe('private, no-store');
    expect(member.maximumRevocationExposureSeconds).toBe(300);

    // An outsider and an anonymous reader get nothing.
    expect((await authorize(assetId, outsiderId)).kind).toBe('denied');
    expect((await authorize(assetId, undefined)).kind).toBe('denied');
  });

  it('stops issuing the moment a membership is revoked', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const clubId = await seedClub();
    const contentId = await seedContent({
      clubId,
      lifecycle: 'published',
      visibility: 'members_only',
    });
    await attachToContent(contentId, assetId);
    const membershipId = crypto.randomUUID();
    await execute(
      database.sql`insert into clubs_memberships (club_id, granted_at, id, member_id, source, state, updated_at)
        values (${clubId}, now(), ${membershipId}, ${memberId}, 'creator_invite', 'active', now())`,
    );
    expect((await authorize(assetId, memberId)).kind).toBe('private');

    await execute(
      database.sql`update clubs_memberships set state = 'revoked', revoked_at = now() where id = ${membershipId}`,
    );
    // New authorizations stop at once. The credential already minted expires
    // on its own bounded window, which the grant reports rather than hides.
    expect((await authorize(assetId, memberId)).kind).toBe('denied');
  });

  it('refuses an image on a draft item to everybody, including its creator', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const contentId = await seedContent({
      clubId: null,
      lifecycle: 'draft',
      visibility: 'public',
    });
    await attachToContent(contentId, assetId);

    expect((await authorize(assetId, undefined)).kind).toBe('denied');
    expect((await authorize(assetId, creatorId)).kind).toBe('denied');
  });

  it('refuses a members-only item that has no club to admit anybody to', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const contentId = await seedContent({
      clubId: null,
      lifecycle: 'published',
      visibility: 'members_only',
    });
    await attachToContent(contentId, assetId);

    expect((await authorize(assetId, memberId)).kind).toBe('denied');
  });

  it('gives a published public item a public address', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const contentId = await seedContent({
      clubId: null,
      lifecycle: 'published',
      visibility: 'public',
    });
    await attachToContent(contentId, assetId);

    expect((await authorize(assetId, undefined)).kind).toBe('public');
  });
});

describe('the content gate is asked, and it decides', () => {
  it('refuses a taken-down item however public it was', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const contentId = await seedContent({
      clubId: null,
      lifecycle: 'published',
      visibility: 'public',
    });
    await attachToContent(contentId, assetId);
    expect((await authorize(assetId, undefined)).kind).toBe('public');

    // Effective a minute ago, not "now". A restriction seeded with SQL `now()`
    // can carry an instant later than the JS `new Date()` the read passes, and
    // an already-effective enforcement then looks pending on a fast machine —
    // which is a race in the test, not in the gate.
    await execute(
      database.sql`insert into safety_enforcements (actor_reference, created_at, disposition, effective_at, id, policy_version, reason_code, scope, subject_id, target_object_id, target_object_type)
        values ('operator', now(), 'restrict', now() - interval '1 minute', ${crypto.randomUUID()}, 'v1', 'platform_integrity', 'creator_object_removal', ${creatorId}, ${contentId}, 'creator_content')`,
    );

    const outcome = await authorize(assetId, undefined);
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.closedGates).toContain('safety_restricted');
  });

  it('refuses an item declared mature, because the capability is off', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const contentId = await seedContent({
      clubId: null,
      lifecycle: 'published',
      visibility: 'public',
    });
    await attachToContent(contentId, assetId);
    await execute(
      database.sql`insert into safety_content_classifications (classification, content_id, creator_id, declared_at, policy_version, updated_at)
        values ('mature_actual', ${contentId}, ${creatorId}, now() - interval '1 minute', 'v1', now())`,
    );

    // Declaring an item mature enables nothing. It makes the item refusable for
    // a reason rather than for a missing declaration, and the reason is a
    // capability with one configured value in every environment.
    const outcome = await authorize(assetId, undefined);
    expect(outcome.kind).toBe('denied');
    if (outcome.kind !== 'denied') return;
    expect(outcome.closedGates).toContain('safety_restricted');
  });

  it('denies a content attachment when no content gate is wired at all', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const contentId = await seedContent({
      clubId: null,
      lifecycle: 'published',
      visibility: 'public',
    });
    await attachToContent(contentId, assetId);

    const ungated = createMediaRuntime({
      association: new RoutedMediaAssociation(routes),
      config,
      database: database.drizzle,
      logger: silentLogger(),
      safety: new SafetyBackedMediaSafety({
        eligibility,
        subjects: new RoutedMediaSafetySubjects(routes),
      }),
    });

    // The Phase 5 position, still true: an asset that needs a gate nobody asked
    // is not an asset that passed it.
    const outcome = await ungated.delivery.authorize({
      assetId,
      executor: ungated.repository.transactionless,
      surface: 'web',
      variantKind: 'card',
      viewerId: undefined,
    });
    expect(outcome.kind).toBe('denied');
  });
});

describe('an asset is not spendable twice', () => {
  it('refuses one asset as both an avatar and a cover', async () => {
    const assetId = await readyAsset('creators', 'creator_avatar_image');
    await seedCreator('published');
    await attachToProfile('avatar_media_asset_id', assetId);

    let refused = false;
    try {
      await attachToProfile('cover_media_asset_id', assetId);
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  it('refuses one asset on two content items', async () => {
    const assetId = await readyAsset('clubs', 'creator_content_image');
    await seedCreator('published');
    const first = await seedContent({
      clubId: null,
      lifecycle: 'published',
      visibility: 'public',
    });
    const second = await seedContent({
      clubId: null,
      lifecycle: 'draft',
      visibility: 'public',
    });
    await attachToContent(first, assetId);

    let refused = false;
    try {
      await attachToContent(second, assetId);
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });
});
