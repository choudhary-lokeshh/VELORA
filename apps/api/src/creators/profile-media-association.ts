import { and, eq, or } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import type {
  MediaAssociation,
  MediaAssociationPort,
} from '../media/publication.js';
import type {
  MediaSafetySubject,
  MediaSafetySubjectResolver,
} from '../media/safety-bridge.js';
import { creatorProfiles } from './schema.js';

/**
 * What CREATORS tells the media platform about an avatar or a cover.
 *
 * A creator's avatar and cover are **public** when the profile is published,
 * and that is the one place in this milestone where media genuinely reaches the
 * open internet. `/c/{handle}` is answered without a session, so an image on it
 * has no viewer to be entitled — the audience is everybody or nobody.
 *
 * A draft profile has neither. An unpublished creator page is not a page yet,
 * and an avatar attached to one is not published media awaiting a viewer; it is
 * a file its owner has not yet decided to show.
 */
export class CreatorProfileMediaAssociation
  implements MediaAssociationPort, MediaSafetySubjectResolver
{
  async describe(input: {
    readonly assetId: string;
    readonly executor: Executor;
  }): Promise<MediaAssociation | undefined> {
    const profile = await this.findProfile(input.executor, input.assetId);
    if (profile === undefined) return undefined;

    const published = profile.publication === 'published';
    return {
      // Public only once the creator published the page it appears on.
      audience: published ? 'public' : 'restricted',
      published,
      // Nobody but the creator may fetch an unpublished one, and a published
      // one needs no viewer at all.
      viewerEntitled: published,
    };
  }

  /**
   * A creator's own profile media rides on `creator_publication`, and names the
   * profile as the object a takedown would reach.
   *
   * Not content-gated: an avatar is not a content item, so it carries no
   * classification, no depicted-person consent scope, and no mature-content
   * question in this milestone. A creator whose *profile* is taken down loses
   * both images with it, because the object restriction names the profile.
   */
  async resolve(input: {
    readonly assetId: string;
    readonly executor: Executor;
  }): Promise<MediaSafetySubject | undefined> {
    const profile = await this.findProfile(input.executor, input.assetId);
    if (profile === undefined) return undefined;
    return {
      capability: 'creator_publication',
      contentGated: false,
      objectId: profile.creatorId,
      objectType: 'creator_profile',
      subjectId: profile.creatorId,
    };
  }

  private async findProfile(
    executor: Executor,
    assetId: string,
  ): Promise<
    { readonly creatorId: string; readonly publication: string } | undefined
  > {
    const rows = await executor
      .select({
        creatorId: creatorProfiles.creatorId,
        publication: creatorProfiles.publication,
      })
      .from(creatorProfiles)
      .where(
        or(
          and(eq(creatorProfiles.avatarMediaAssetId, assetId)),
          and(eq(creatorProfiles.coverMediaAssetId, assetId)),
        ),
      )
      .limit(1);
    return rows[0];
  }
}
