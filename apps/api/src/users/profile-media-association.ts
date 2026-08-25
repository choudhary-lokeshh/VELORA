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
 * The relationship answer this domain needs and does not own.
 *
 * Declared here, in the consumer, so USERS depends on a shape rather than on
 * DISCOVERY — the same direction `CandidateSafetyPort` points in. DISCOVERY's
 * implementation satisfies it structurally and neither module imports the
 * other.
 */
export interface ConsumerProfileMediaViewerPort {
  mayViewProfileMedia(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly subjectId: string;
    readonly viewerId: string;
  }): Promise<boolean>;
}

/**
 * The viewer answer used where no relationship authority has been wired.
 *
 * It entitles nobody but the owner. A composition that has not been given a
 * relationship port has not been told that everybody may look; it has been told
 * nothing, and nothing is not permission.
 */
export class OwnerOnlyProfileMediaViewer implements ConsumerProfileMediaViewerPort {
  mayViewProfileMedia(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/**
 * What USERS tells the media platform about a consumer profile image.
 *
 * This is USERS code reading USERS tables, handed to MEDIA as a port
 * implementation. MEDIA never sees the table, the slot, or the ordering — it
 * receives an answer to the one question it is entitled to ask, which is the
 * whole point of the association contract.
 *
 * Composing it needs a database handle and one relationship port, so it can be
 * built before the USERS runtime and given to MEDIA without either domain
 * depending on the other's composition.
 */
export class ConsumerProfileMediaAssociation
  implements MediaAssociationPort, MediaSafetySubjectResolver
{
  constructor(
    private readonly viewers: ConsumerProfileMediaViewerPort = new OwnerOnlyProfileMediaViewer(),
  ) {}

  async describe(input: {
    readonly assetId: string;
    readonly executor: Executor;
    readonly now: Date;
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
      // An anonymous caller is therefore refused before any relationship is
      // considered: there is no relationship a missing credential could hold.
      audience: 'restricted',
      published: true,
      viewerEntitled: await this.entitles(input, slot.userId),
    };
  }

  /**
   * The owner always; anybody else exactly when DISCOVERY says the relationship
   * currently warrants it.
   *
   * The owner case is answered here rather than delegated because it is the one
   * part of this that genuinely is USERS' own: an image belongs to the account
   * whose slot holds it, and that fact needs no relationship.
   */
  private async entitles(
    input: {
      readonly executor: Executor;
      readonly now: Date;
      readonly viewerId: string | undefined;
    },
    ownerId: string,
  ): Promise<boolean> {
    if (input.viewerId === undefined) return false;
    if (input.viewerId === ownerId) return true;
    return this.viewers.mayViewProfileMedia({
      executor: input.executor,
      now: input.now,
      subjectId: ownerId,
      viewerId: input.viewerId,
    });
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
