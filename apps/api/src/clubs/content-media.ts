import type {
  CreatorMediaPort,
  CreatorMediaReadiness,
  CreatorMediaUploadHandoff,
} from '../creators/profile-media.js';
import type { ContentCreatorPort } from './creators.js';
import type { ClubsRepository, CreatorContentRow } from './repository.js';

/**
 * Images attached to a catalog item.
 *
 * PRIVATE CLUBS owns the attachment — which asset sits at which position on
 * which item — and nothing else. Whether the bytes decoded, which derivatives
 * exist, and whether a particular reader may be served them all belong to MEDIA
 * and to the association adapter this domain already publishes.
 *
 * The attachment is what makes an item's images follow the item's own rules: a
 * draft's images are deliverable to nobody, a members-only item's images are
 * deliverable to people who currently hold a membership, and an archived item's
 * images stop being deliverable the moment it is withdrawn. None of that is
 * decided here; all of it is decided at issuance, from this attachment.
 */

/** One attached image, as its creator sees it. */
export interface CreatorContentMediaView {
  readonly id: string;
  readonly position: number;
  readonly rejectionReason: CreatorMediaReadiness['rejection'];
  readonly state: CreatorMediaReadiness['state'];
  readonly uploadExpiresAt: Date | undefined;
}

export type ContentMediaOutcome =
  | {
      readonly capability: CreatorMediaUploadHandoff;
      readonly kind: 'upload_created';
    }
  | { readonly kind: 'accepted'; readonly contentId: string }
  /**
   * One answer for an item that does not exist, an item belonging to somebody
   * else, an item already holding the maximum, and a creator who may not
   * operate. Separating them would let a caller probe another creator's
   * catalog.
   */
  | { readonly kind: 'conflict' }
  | { readonly kind: 'storage_unavailable' };

export class ContentMediaService {
  constructor(
    private readonly dependencies: {
      readonly creators: ContentCreatorPort;
      readonly media: CreatorMediaPort;
      readonly now: () => Date;
      readonly repository: ClubsRepository;
    },
  ) {}

  /**
   * Reserves one image against one item.
   *
   * The attachment is durable before the capability leaves the platform. A
   * crash after the reservation and before the attachment leaves an orphaned
   * asset, which reconciliation is built to find; the other order would leave an
   * item pointing at an asset the media platform never recorded.
   */
  async startUpload(input: {
    readonly contentId: string;
    readonly creatorId: string;
  }): Promise<ContentMediaOutcome> {
    const { media, repository } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return { kind: 'conflict' };
    const item = await repository.findOwn(repository.transactionless, {
      contentId: input.contentId,
      creatorId: input.creatorId,
    });
    if (item === undefined) return { kind: 'conflict' };

    const reserved = await media.createUpload({
      assetClass: 'creator_content_image',
      // A fresh identity per reservation, the same rule every other owning
      // domain uses. It is this domain's rather than a client's, and it makes a
      // request that reaches the media platform twice resolve to one asset
      // rather than reserving storage twice.
      idempotencyKey: `clubs-content-${crypto.randomUUID()}`,
      // This domain, not CREATORS. MEDIA routes a delivery decision by the
      // domain that reserved the asset, and an item attachment is decided by
      // this domain's adapter — a page image is the one CREATORS answers for.
      ownerDomain: 'clubs',
      ownerReference: input.creatorId,
    });
    if (reserved.kind === 'storage_unavailable') {
      return { kind: 'storage_unavailable' };
    }
    if (reserved.kind !== 'upload_ready') return { kind: 'conflict' };

    const attached = await repository.attachContentMedia(
      repository.transactionless,
      {
        assetId: reserved.asset.id,
        contentId: input.contentId,
        now: this.dependencies.now(),
      },
    );
    if (attached === undefined) {
      // The item filled up between the read and here. The asset it reserved is
      // owed a removal rather than left behind.
      await media.requestDeletion({ assetId: reserved.asset.id });
      return { kind: 'conflict' };
    }
    return { capability: reserved.capability, kind: 'upload_created' };
  }

  /** Tells the platform the bytes are there, for one of this creator's items. */
  async completeUpload(input: {
    readonly creatorId: string;
    readonly mediaId: string;
  }): Promise<ContentMediaOutcome> {
    const { media, repository } = this.dependencies;
    const attachment = await repository.findContentMediaByAsset(
      repository.transactionless,
      input.mediaId,
    );
    if (attachment?.creatorId !== input.creatorId) return { kind: 'conflict' };

    const recorded = await media.recordUpload({
      assetId: input.mediaId,
      ownerDomain: 'clubs',
      ownerReference: input.creatorId,
    });
    return recorded.kind === 'storage_unavailable'
      ? { kind: 'storage_unavailable' }
      : { contentId: attachment.contentId, kind: 'accepted' };
  }

  /**
   * Detaches an image from its item.
   *
   * The attachment is this domain's and is removed first; the bytes are the
   * media platform's and are owed a deletion it records durably. Delivery reads
   * the attachment, so an image is unreachable the moment this commits whatever
   * happens to the bytes afterwards.
   */
  async remove(input: {
    readonly creatorId: string;
    readonly mediaId: string;
  }): Promise<ContentMediaOutcome> {
    const { media, repository } = this.dependencies;
    const attachment = await repository.findContentMediaByAsset(
      repository.transactionless,
      input.mediaId,
    );
    if (attachment?.creatorId !== input.creatorId) return { kind: 'conflict' };

    await repository.detachContentMedia(
      repository.transactionless,
      input.mediaId,
    );
    await media.requestDeletion({ assetId: input.mediaId });
    return { contentId: attachment.contentId, kind: 'accepted' };
  }

  /**
   * What the images on a page of items currently are.
   *
   * One batched attachment read and one batched readiness question, however
   * many items the page holds, because a catalog page is the one place this
   * would otherwise become a query per row.
   */
  async describe(
    rows: readonly CreatorContentRow[],
  ): Promise<ReadonlyMap<string, readonly CreatorContentMediaView[]>> {
    const byContent = new Map<string, CreatorContentMediaView[]>();
    if (rows.length === 0) return byContent;

    const { repository } = this.dependencies;
    const attachments = await repository.listContentMedia(
      repository.transactionless,
      rows.map((row) => row.id),
    );
    if (attachments.length === 0) return byContent;

    const readiness = await this.dependencies.media.describeReadiness({
      assetIds: attachments.map((one) => one.mediaAssetId),
    });
    const byAsset = new Map(readiness.map((one) => [one.assetId, one]));
    for (const attachment of attachments) {
      const answer = byAsset.get(attachment.mediaAssetId);
      const existing = byContent.get(attachment.contentId) ?? [];
      existing.push({
        id: attachment.mediaAssetId,
        position: attachment.position,
        rejectionReason: answer?.rejection,
        // An asset MEDIA has never heard of is gone as far as this item is
        // concerned. It cannot be rendered and cannot become ready.
        state: answer?.state ?? 'removed',
        uploadExpiresAt: answer?.uploadExpiresAt,
      });
      byContent.set(attachment.contentId, existing);
    }
    return byContent;
  }

  private async mayOperate(creatorId: string): Promise<boolean> {
    return this.dependencies.creators.mayOperate({
      creatorId,
      executor: this.dependencies.repository.transactionless,
    });
  }
}
