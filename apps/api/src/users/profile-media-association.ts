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
import { userProfileMedia } from './schema.js';

/**
 * What USERS tells the media platform about a consumer profile image.
 *
 * This is USERS code reading USERS tables, handed to MEDIA as a port
 * implementation. MEDIA never sees the table, the slot, or the ordering — it
 * receives an answer to the one question it is entitled to ask, which is the
 * whole point of the association contract.
 *
 * Composing it needs only a database handle, so it can be built before the
 * USERS runtime and given to MEDIA without either domain depending on the
 * other's composition.
 */
export class ConsumerProfileMediaAssociation
  implements MediaAssociationPort, MediaSafetySubjectResolver
{
  async describe(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly viewerId: string | undefined;
  }): Promise<MediaAssociation | undefined> {
    const slot = await this.findSlot(input.executor, input.assetId);
    // No live slot points at this asset, so as far as this domain is concerned
    // it is attached to nothing.
    if (slot === undefined) return undefined;

    return {
      // Never public. A consumer's profile image is shown inside authenticated
      // consumer surfaces and a profile is never a public internet page, which
      // `docs/flows/consumer-account-profile.md` already fixes as V1 policy.
      audience: 'restricted',
      published: true,
      // Only the owner, for now, and that is a real limit rather than an
      // oversight. Whether a *peer* may see somebody's profile image is a
      // question about the relationship between two accounts, which DISCOVERY
      // owns and this domain cannot answer. Until a surface needs peer
      // delivery, answering it here would mean inventing the rule.
      viewerEntitled:
        input.viewerId !== undefined && input.viewerId === slot.userId,
    };
  }

  /**
   * Who Trust and Safety would be asked about, and under which capability.
   *
   * A consumer's own profile image rides on `consumer_interaction`: the
   * capability that decides whether this account takes part in discovery,
   * introductions, and messaging at all. It is not content-gated — a profile
   * image is not a content item, so there is no classification, no
   * depicted-person consent scope, and no mature-content question attached to
   * it in this milestone.
   */
  async resolve(input: {
    readonly assetId: string;
    readonly executor: Executor;
  }): Promise<MediaSafetySubject | undefined> {
    const slot = await this.findSlot(input.executor, input.assetId);
    if (slot === undefined) return undefined;
    return {
      capability: 'consumer_interaction',
      contentGated: false,
      objectId: undefined,
      objectType: undefined,
      subjectId: slot.userId,
    };
  }

  private async findSlot(
    executor: Executor,
    assetId: string,
  ): Promise<{ readonly userId: string } | undefined> {
    const rows = await executor
      .select({ userId: userProfileMedia.userId })
      .from(userProfileMedia)
      .where(
        and(
          eq(userProfileMedia.mediaAssetId, assetId),
          // A detached slot is not an association. Removing an image stops
          // delivery at the next issuance, with nothing to invalidate.
          eq(userProfileMedia.state, 'attached'),
        ),
      )
      .limit(1);
    return rows[0];
  }
}
