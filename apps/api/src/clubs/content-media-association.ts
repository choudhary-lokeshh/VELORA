import { and, eq } from 'drizzle-orm';

import type { Executor } from '../database/executor.js';
import type {
  MediaAssociation,
  MediaAssociationPort,
} from '../media/publication.js';
import type {
  MediaSafetySubject,
  MediaSafetySubjectResolver,
} from '../media/safety-bridge.js';
import {
  clubMemberships,
  creatorContent,
  creatorContentMedia,
} from './schema.js';

/**
 * What PRIVATE CLUBS tells the media platform about an attached image.
 *
 * This is the case the whole delivery split exists for. An image on a published
 * public item is public; an image on a members-only item is restricted to
 * people who currently hold a live membership of that club; an image on a draft
 * or archived item is neither, whatever it was yesterday.
 *
 * Every one of those is re-read at issuance. A membership revoked a second ago
 * denies the next credential, and the one already issued expires on its own
 * bounded window — which is the honest half of revocation that the delivery
 * service reports rather than hides.
 */
export class CreatorContentMediaAssociation
  implements MediaAssociationPort, MediaSafetySubjectResolver
{
  async describe(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly viewerId: string | undefined;
  }): Promise<MediaAssociation | undefined> {
    const item = await this.findItem(input.executor, input.assetId);
    if (item === undefined) return undefined;

    // A draft is not published media awaiting a viewer, and an archived item
    // has been withdrawn. Neither is deliverable to anybody, including its own
    // creator through this path.
    if (item.lifecycle !== 'published') {
      return {
        audience: 'restricted',
        published: false,
        viewerEntitled: false,
      };
    }

    if (item.visibility === 'public') {
      return { audience: 'public', published: true, viewerEntitled: true };
    }

    // Members only. An item with no club has nobody to admit, so it stays
    // unreachable however it is marked — the same rule the catalog already
    // applies to the item itself.
    if (item.clubId === null || input.viewerId === undefined) {
      return { audience: 'restricted', published: true, viewerEntitled: false };
    }
    return {
      audience: 'restricted',
      published: true,
      viewerEntitled: await this.holdsMembership(
        input.executor,
        item.clubId,
        input.viewerId,
      ),
    };
  }

  /**
   * A content attachment is content-gated, and that is the point.
   *
   * It names the item as the object a takedown reaches, and it tells the bridge
   * that the enforcement answer alone is not enough: classification,
   * depicted-person consent, surface eligibility, and the mature-content gate
   * all have to be asked, and Trust and Safety is the only authority that can
   * answer them.
   */
  async resolve(input: {
    readonly assetId: string;
    readonly executor: Executor;
  }): Promise<MediaSafetySubject | undefined> {
    const item = await this.findItem(input.executor, input.assetId);
    if (item === undefined) return undefined;
    return {
      capability: 'creator_publication',
      contentGated: true,
      objectId: item.contentId,
      objectType: 'creator_content',
      subjectId: item.creatorId,
    };
  }

  private async findItem(
    executor: Executor,
    assetId: string,
  ): Promise<
    | {
        readonly clubId: string | null;
        readonly contentId: string;
        readonly creatorId: string;
        readonly lifecycle: string;
        readonly visibility: string;
      }
    | undefined
  > {
    const rows = await executor
      .select({
        clubId: creatorContent.clubId,
        contentId: creatorContent.id,
        creatorId: creatorContent.creatorId,
        lifecycle: creatorContent.lifecycle,
        visibility: creatorContent.visibility,
      })
      .from(creatorContentMedia)
      .innerJoin(
        creatorContent,
        eq(creatorContent.id, creatorContentMedia.contentId),
      )
      .where(eq(creatorContentMedia.mediaAssetId, assetId))
      .limit(1);
    return rows[0];
  }

  private async holdsMembership(
    executor: Executor,
    clubId: string,
    viewerId: string,
  ): Promise<boolean> {
    const rows = await executor
      .select({ id: clubMemberships.id })
      .from(clubMemberships)
      .where(
        and(
          eq(clubMemberships.clubId, clubId),
          eq(clubMemberships.memberId, viewerId),
          // Live now, not ever. A revoked or lapsed membership is exactly the
          // case this check exists for.
          eq(clubMemberships.state, 'active'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
