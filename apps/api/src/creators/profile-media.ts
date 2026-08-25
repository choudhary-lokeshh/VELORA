import type { CreatorProfileMediaSlot } from '@velora/validation';

import type {
  CreatorAccountRow,
  CreatorProfileRecord,
  CreatorProfileRepository,
} from './repository.js';

/**
 * The two images a creator page has.
 *
 * CREATORS decides which asset plays which part and nothing else. What the
 * bytes are, whether they decoded, which derivatives exist, and whether anybody
 * may be served them all belong to MEDIA, and this module never asks. The
 * association adapter this domain already publishes is what MEDIA consults at
 * delivery time; the columns here are the only fact it reads.
 *
 * ## Replacing rather than removing first
 *
 * Reserving a slot that already holds an image points the slot at the new asset
 * immediately and owes the old bytes a deletion. The alternative — keeping the
 * old image visible until the new one is ready — needs a second column per slot
 * and a rule for what happens when the replacement is refused, and it would
 * leave a creator looking at an avatar they have already replaced. What this
 * does instead is honest and briefly empty: the page has no image for that slot
 * while the platform decides what the new bytes are.
 */

/**
 * The slice of the media platform a creator surface is allowed to use.
 *
 * Declared here and shared with PRIVATE CLUBS, which attaches images to catalog
 * items on behalf of the same creators. One shape rather than two identical
 * ones, so a change to what MEDIA offers is a change in one place.
 */
export interface CreatorMediaPort {
  createUpload(input: {
    readonly assetClass:
      'creator_avatar_image' | 'creator_content_image' | 'creator_cover_image';
    readonly idempotencyKey: string;
    readonly ownerDomain: 'creators';
    readonly ownerReference: string;
  }): Promise<
    | { readonly asset: { readonly id: string }; readonly kind: 'asset' }
    | {
        readonly asset: { readonly id: string };
        readonly capability: CreatorMediaUploadHandoff;
        readonly kind: 'upload_ready';
      }
    | { readonly kind: 'conflict' }
    | { readonly kind: 'idempotency_conflict' }
    | { readonly kind: 'invalid_idempotency_key' }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'storage_unavailable' }
  >;
  describeReadiness(input: {
    readonly assetIds: readonly string[];
  }): Promise<readonly CreatorMediaReadiness[]>;
  recordUpload(input: {
    readonly assetId: string;
    readonly ownerDomain: 'creators';
    readonly ownerReference: string;
  }): Promise<{ readonly kind: string }>;
  requestDeletion(input: { readonly assetId: string }): Promise<unknown>;
}

export interface CreatorMediaUploadHandoff {
  readonly assetId: string;
  readonly expiresAt: Date;
  readonly headers: Readonly<Record<string, string>>;
  readonly maximumBytes: number;
  readonly method: 'PUT';
  readonly url: string;
}

export interface CreatorMediaReadiness {
  readonly assetId: string;
  readonly rejection?:
    | 'unsupported_type'
    | 'too_large'
    | 'not_uploaded'
    | 'content_rejected'
    | undefined;
  readonly state:
    | 'pending_upload'
    | 'checking'
    | 'preparing'
    | 'ready'
    | 'rejected'
    | 'removed';
  readonly uploadExpiresAt?: Date | undefined;
}

/** One page image, as its creator sees it. */
export interface CreatorProfileMediaView {
  readonly id: string;
  readonly rejectionReason: CreatorMediaReadiness['rejection'];
  readonly slot: CreatorProfileMediaSlot;
  readonly state: CreatorMediaReadiness['state'];
  readonly uploadExpiresAt: Date | undefined;
}

export type CreatorProfileMediaOutcome =
  | {
      readonly capability: CreatorMediaUploadHandoff;
      readonly kind: 'upload_created';
    }
  | { readonly kind: 'accepted' }
  /** Deliberately indistinguishable from an image belonging to somebody else. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'storage_unavailable' };

/** Capability states in which a creator may change their own page images. */
const editableStatuses = new Set(['applicant', 'active']);

const assetClassFor = (slot: CreatorProfileMediaSlot) =>
  slot === 'avatar'
    ? ('creator_avatar_image' as const)
    : ('creator_cover_image' as const);

export class CreatorProfileMediaService {
  constructor(
    private readonly dependencies: {
      readonly media: CreatorMediaPort;
      readonly now: () => Date;
      readonly profiles: CreatorProfileRepository;
    },
  ) {}

  /**
   * Reserves one image for one slot.
   *
   * The reservation is durable before the capability leaves the platform, in
   * the order that makes a crash survivable: MEDIA records the asset, the slot
   * points at it, and only then does the old asset get a deletion request. A
   * process killed between the second and third steps leaves an orphaned asset,
   * which reconciliation is built to find; killed the other way round it would
   * leave a slot pointing at bytes somebody has asked to destroy.
   */
  async startUpload(input: {
    readonly account: CreatorAccountRow;
    readonly slot: CreatorProfileMediaSlot;
  }): Promise<CreatorProfileMediaOutcome> {
    if (!editableStatuses.has(input.account.status)) {
      return { kind: 'not_eligible' };
    }
    const { media, profiles } = this.dependencies;
    const existing = await profiles.findByCreatorId(
      profiles.transactionless,
      input.account.id,
    );
    // A page image with no page is a file nobody chose. The profile is what
    // publication, delivery, and the association adapter all hang off.
    if (existing === undefined) return { kind: 'not_found' };

    const reserved = await media.createUpload({
      assetClass: assetClassFor(input.slot),
      // A fresh identity per reservation, the same rule USERS uses for a
      // profile slot. It is this domain's rather than a client's, and it makes
      // a request that reaches the media platform twice resolve to one asset
      // rather than reserving storage twice.
      idempotencyKey: `creators-${input.slot}-${crypto.randomUUID()}`,
      ownerDomain: 'creators',
      ownerReference: input.account.id,
    });
    if (reserved.kind === 'storage_unavailable') {
      return { kind: 'storage_unavailable' };
    }
    if (reserved.kind !== 'upload_ready') return { kind: 'not_eligible' };

    const applied = await profiles.setMediaAsset(profiles.transactionless, {
      assetId: reserved.asset.id,
      creatorId: input.account.id,
      now: this.dependencies.now(),
      slot: input.slot,
    });
    if (applied === undefined) {
      await media.requestDeletion({ assetId: reserved.asset.id });
      return { kind: 'not_found' };
    }
    if (applied.previousAssetId !== null) {
      await media.requestDeletion({ assetId: applied.previousAssetId });
    }
    return { capability: reserved.capability, kind: 'upload_created' };
  }

  /**
   * Tells the platform the bytes are there.
   *
   * The client says only which of its own images to look at; the platform asks
   * the provider whether an object exists at the key it issued and decides from
   * the object itself. An asset that is not in one of this creator's slots is
   * answered exactly as one that does not exist.
   */
  async completeUpload(input: {
    readonly account: CreatorAccountRow;
    readonly mediaId: string;
  }): Promise<CreatorProfileMediaOutcome> {
    if (!editableStatuses.has(input.account.status)) {
      return { kind: 'not_eligible' };
    }
    const { media, profiles } = this.dependencies;
    const owner = await profiles.findByMediaAsset(
      profiles.transactionless,
      input.mediaId,
    );
    if (owner?.creatorId !== input.account.id) return { kind: 'not_found' };

    const recorded = await media.recordUpload({
      assetId: input.mediaId,
      ownerDomain: 'creators',
      ownerReference: input.account.id,
    });
    return recorded.kind === 'storage_unavailable'
      ? { kind: 'storage_unavailable' }
      : { kind: 'accepted' };
  }

  /**
   * Detaches an image from the page.
   *
   * The association is this domain's and is cleared first; the bytes are the
   * media platform's and are owed a removal it records durably. A failure to
   * reach that platform does not leave the image on the page — the column here
   * is what delivery reads, and an orphaned asset is a reconciliation concern
   * rather than a reason to keep showing something somebody deleted.
   */
  async remove(input: {
    readonly account: CreatorAccountRow;
    readonly mediaId: string;
  }): Promise<CreatorProfileMediaOutcome> {
    if (!editableStatuses.has(input.account.status)) {
      return { kind: 'not_eligible' };
    }
    const { media, profiles } = this.dependencies;
    const owner = await profiles.findByMediaAsset(
      profiles.transactionless,
      input.mediaId,
    );
    if (owner?.creatorId !== input.account.id) return { kind: 'not_found' };

    await profiles.setMediaAsset(profiles.transactionless, {
      assetId: null,
      creatorId: input.account.id,
      now: this.dependencies.now(),
      slot: owner.slot,
    });
    await media.requestDeletion({ assetId: input.mediaId });
    return { kind: 'accepted' };
  }

  /**
   * What the creator's own page images currently are.
   *
   * One batched question to the media platform rather than a cached projection:
   * a page renders one creator, so there is nothing here to amortise, and a
   * stored answer would be a second source of truth about somebody else's
   * domain.
   */
  async describe(
    record: CreatorProfileRecord,
  ): Promise<readonly CreatorProfileMediaView[]> {
    const slots: {
      readonly id: string;
      readonly slot: CreatorProfileMediaSlot;
    }[] = [];
    if (record.profile.avatarMediaAssetId !== null) {
      slots.push({ id: record.profile.avatarMediaAssetId, slot: 'avatar' });
    }
    if (record.profile.coverMediaAssetId !== null) {
      slots.push({ id: record.profile.coverMediaAssetId, slot: 'cover' });
    }
    if (slots.length === 0) return [];

    const readiness = await this.dependencies.media.describeReadiness({
      assetIds: slots.map((one) => one.id),
    });
    const byAsset = new Map(readiness.map((one) => [one.assetId, one]));
    return slots.map((one) => {
      const answer = byAsset.get(one.id);
      return {
        id: one.id,
        rejectionReason: answer?.rejection,
        slot: one.slot,
        // An asset MEDIA has never heard of is gone as far as this page is
        // concerned. It cannot be rendered and cannot become ready.
        state: answer?.state ?? 'removed',
        uploadExpiresAt: answer?.uploadExpiresAt,
      };
    });
  }
}

/**
 * The media answer used where no platform has been wired.
 *
 * It refuses. A composition that has not been given a media port has not been
 * told storage is unavailable; it has been told nothing, and the honest
 * rendering of nothing is a refusal rather than a crash on the first upload
 * somebody attempts.
 */
export class UnavailableCreatorMedia implements CreatorMediaPort {
  createUpload(): Promise<{ readonly kind: 'storage_unavailable' }> {
    return Promise.resolve({ kind: 'storage_unavailable' });
  }

  describeReadiness(): Promise<readonly CreatorMediaReadiness[]> {
    return Promise.resolve([]);
  }

  recordUpload(): Promise<{ readonly kind: string }> {
    return Promise.resolve({ kind: 'storage_unavailable' });
  }

  requestDeletion(): Promise<unknown> {
    return Promise.resolve(undefined);
  }
}
