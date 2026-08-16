import type { SafeLogger } from '@velora/observability/server';
import { maximumProfileMedia } from '@velora/validation';

import type { MediaReadiness, MediaUploadHandoff } from '../media/service.js';
import type {
  MediaPublicRejectionReason,
  MediaReadinessState,
} from '../media/policy.js';
import type { OnboardingService } from './onboarding.js';
import { profileMediaReadinessBatchSize } from './profile-policy.js';
import {
  isProfileComplete,
  type ProfileCompleteness,
  type ProfileRepository,
  type UserProfileMediaRow,
  type UserProfileRow,
} from './profile-repository.js';
import type { UserAccountRow, UsersRepository } from './repository.js';

/**
 * Everything the owner of a profile may see about it. It is never rendered for
 * a peer: the projection other consumers receive is built by the domain that
 * owns the relationship, from far less than this.
 */
/**
 * One slot as its owner sees it: the association USERS owns, plus how far the
 * media platform has got with the asset behind it.
 *
 * The state is asked for at read time rather than stored. Two domains holding
 * the same fact is two domains drifting, and the one that would go stale here
 * is the one a person is watching a spinner against.
 */
export interface ProfileMediaView {
  readonly id: string;
  readonly position: number;
  readonly rejectionReason: MediaPublicRejectionReason | undefined;
  readonly state: MediaReadinessState;
  readonly uploadExpiresAt: Date | undefined;
}

export interface ProfileView {
  readonly account: UserAccountRow;
  readonly completeness: ProfileCompleteness;
  readonly discoverable: boolean;
  readonly languages: readonly string[];
  readonly media: readonly ProfileMediaView[];
  /** Absent until the account has saved a preference at least once. */
  readonly preferencesVersion: number | undefined;
  readonly profile: UserProfileRow | undefined;
}

export type ProfileOutcome =
  | { readonly kind: 'saved'; readonly view: ProfileView }
  | {
      readonly kind: 'upload_created';
      readonly mediaId: string;
      readonly upload: MediaUploadHandoff;
    }
  /** A concurrent edit won, or the object is no longer in the expected state. */
  | { readonly kind: 'conflict' }
  /** The account may not edit its profile in its current admission state. */
  | { readonly kind: 'not_eligible' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'limit_reached' }
  | { readonly kind: 'storage_unavailable' };

export interface ProfileServiceDependencies {
  readonly logger: SafeLogger;
  /**
   * The media platform, reached only through its published contracts.
   *
   * USERS asks it for an upload capability and for readiness, and learns
   * nothing else: no object key, no digest, no measured size, no lifecycle
   * value. What it holds is an opaque asset identifier.
   */
  readonly media: ProfileMediaPort;
  readonly now: () => Date;
  readonly onboarding: OnboardingService;
  readonly repository: ProfileRepository;
  readonly users: UsersRepository;
}

/** The slice of the media platform this domain is allowed to use. */
export interface ProfileMediaPort {
  createUpload(input: {
    readonly assetClass: 'consumer_profile_image';
    readonly idempotencyKey: string;
    readonly ownerDomain: 'users';
    readonly ownerReference: string;
  }): Promise<
    | { readonly asset: { readonly id: string }; readonly kind: 'asset' }
    | {
        readonly asset: { readonly id: string };
        readonly capability: MediaUploadHandoff;
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
  }): Promise<readonly MediaReadiness[]>;
  recordUpload(input: {
    readonly assetId: string;
    readonly ownerDomain: 'users';
    readonly ownerReference: string;
  }): Promise<{ readonly kind: string }>;
  requestDeletion(input: { readonly assetId: string }): Promise<unknown>;
}

/**
 * Consumer profile, preferences, and profile media.
 *
 * Two rules run through every method. The acting account comes from the caller's
 * resolved consumer context, never from anything in a request, so a media
 * identifier a client supplies can only ever address an object it already owns.
 * And every write ends by reconciling account status against the admission
 * ladder, because the minimum profile is one of the conditions for being
 * `active`, and an account must not stay active on a profile it no longer has.
 */
export class ProfileService {
  constructor(private readonly dependencies: ProfileServiceDependencies) {}

  /**
   * The owner's own view, refreshed and reconciled.
   *
   * Reading is not usually a write, and this one is — deliberately. The person
   * looking at this page is the one waiting for an image to become usable, and
   * the projection refresh that tells them so is also what completes their
   * minimum profile. Leaving the consequence to the next sweep would mean
   * showing somebody a ready image above a message saying their profile is
   * incomplete.
   */
  async readProfile(account: UserAccountRow): Promise<ProfileView> {
    const before = await this.dependencies.repository.readCompleteness(account);
    const view = await this.buildView(account);
    if (isProfileComplete(before) === isProfileComplete(view.completeness)) {
      return view;
    }
    return this.settle(account);
  }

  /**
   * Creates or replaces the profile.
   *
   * `expectedVersion` is absent exactly when the caller believes no profile
   * exists. Getting that wrong in either direction is a conflict rather than a
   * silent create-or-overwrite, so a client that raced another device is told to
   * re-read instead of quietly discarding the other edit.
   */
  async saveProfile(
    account: UserAccountRow,
    input: {
      readonly bio: string | undefined;
      readonly displayName: string;
      readonly expectedVersion: number | undefined;
      readonly languages: readonly string[];
    },
  ): Promise<ProfileOutcome> {
    if (!(await this.mayEditProfile(account))) return { kind: 'not_eligible' };
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const bio = input.bio ?? null;

    const saved = await repository.transaction(async (executor) => {
      const profile =
        input.expectedVersion === undefined
          ? await repository.insertProfile(executor, {
              bio,
              displayName: input.displayName,
              now,
              userId: account.id,
            })
          : await repository.updateProfile(executor, {
              bio,
              displayName: input.displayName,
              expectedVersion: input.expectedVersion,
              now,
              userId: account.id,
            });
      if (profile === undefined) return false;
      await repository.replaceLanguages(executor, {
        languages: input.languages,
        now,
        userId: account.id,
      });
      return true;
    });
    if (!saved) return { kind: 'conflict' };

    return { kind: 'saved', view: await this.settle(account) };
  }

  /**
   * Sets discoverability.
   *
   * Turning it on is refused while the minimum profile is incomplete. The
   * eligibility pipeline would exclude the account anyway, but a stored `true`
   * that can never take effect is a preference that lies to the person who set
   * it.
   */
  async savePreferences(
    account: UserAccountRow,
    input: {
      readonly discoverable: boolean;
      readonly expectedVersion: number | undefined;
    },
  ): Promise<ProfileOutcome> {
    if (!(await this.mayEditProfile(account))) return { kind: 'not_eligible' };
    const { repository } = this.dependencies;
    if (input.discoverable) {
      const completeness = await repository.readCompleteness(account);
      if (!isProfileComplete(completeness)) return { kind: 'not_eligible' };
    }

    const now = this.dependencies.now();
    const saved =
      input.expectedVersion === undefined
        ? await repository.insertPreferences(repository.transactionless, {
            discoverable: input.discoverable,
            now,
            userId: account.id,
          })
        : await repository.updatePreferences(repository.transactionless, {
            discoverable: input.discoverable,
            expectedVersion: input.expectedVersion,
            now,
            userId: account.id,
          });
    if (saved === undefined) return { kind: 'conflict' };
    return { kind: 'saved', view: await this.settle(account) };
  }

  /**
   * Reserves a slot and returns a short-lived, object-bound upload capability.
   *
   * The capability is obtained before anything is written, so an environment
   * with no approved storage provider refuses the request without leaving a
   * reserved slot nobody can ever fill.
   */
  async createMediaUpload(account: UserAccountRow): Promise<ProfileOutcome> {
    if (!(await this.mayEditProfile(account))) return { kind: 'not_eligible' };
    const { media, repository } = this.dependencies;
    const now = this.dependencies.now();

    const live = await repository.listLiveMedia(
      repository.transactionless,
      account.id,
    );
    if (live.length >= maximumProfileMedia) return { kind: 'limit_reached' };

    const slotId = crypto.randomUUID();
    // The slot identifier is the operation identity. A retried request that
    // reaches the media platform twice resolves to one asset rather than
    // reserving storage twice, and the identity is this domain's rather than a
    // client's because the slot is this domain's.
    const asset = await media.createUpload({
      assetClass: 'consumer_profile_image',
      idempotencyKey: `users-profile-${slotId}`,
      ownerDomain: 'users',
      ownerReference: account.id,
    });
    if (asset.kind === 'storage_unavailable') {
      return { kind: 'storage_unavailable' };
    }
    if (asset.kind !== 'upload_ready') return { kind: 'conflict' };

    const slot = await repository.insertMediaInFreeSlot(
      repository.transactionless,
      {
        id: slotId,
        mediaAssetId: asset.asset.id,
        now,
        userId: account.id,
      },
    );
    if (slot === undefined) {
      // The account filled its last slot between the count above and here. The
      // asset it reserved is owed a removal rather than left behind.
      await media.requestDeletion({ assetId: asset.asset.id });
      return { kind: 'limit_reached' };
    }
    return {
      kind: 'upload_created',
      mediaId: slot.id,
      upload: asset.capability,
    };
  }

  /**
   * Decides whether uploaded bytes may become a visible image.
   *
   * The decision is the platform's, taken from the stored object itself. A
   * client says only which of its own objects to look at; it never supplies the
   * type, the size, or the verdict.
   */
  async completeMediaUpload(
    account: UserAccountRow,
    mediaId: string,
  ): Promise<ProfileOutcome> {
    if (!(await this.mayEditProfile(account))) return { kind: 'not_eligible' };
    const { media, repository } = this.dependencies;

    const slot = await repository.findMedia(repository.transactionless, {
      mediaId,
      userId: account.id,
    });
    if (slot === undefined || slot.state === 'removed') {
      return { kind: 'not_found' };
    }

    // The client says the bytes are there. That is a hint, and the media
    // platform decides: it asks the provider whether an object exists at the
    // key it issued, and only then does anything become true. This domain does
    // not see the answer's internals, and could not act on them if it did.
    const recorded = await media.recordUpload({
      assetId: slot.mediaAssetId,
      ownerDomain: 'users',
      ownerReference: account.id,
    });
    if (recorded.kind === 'storage_unavailable') {
      return { kind: 'storage_unavailable' };
    }
    // A completion that arrives before the bytes do, or twice, is not an error
    // the person can act on. What they get back is the current truth, which
    // still says the platform is waiting.
    return { kind: 'saved', view: await this.settle(account) };
  }

  /**
   * Removes an image from the profile.
   *
   * The association is this domain's and is detached first; the bytes are the
   * media platform's and are owed a removal it records durably. A failure to
   * reach that platform does not leave the image on the profile — the record
   * here is what a surface reads, and an orphaned asset is a reconciliation
   * concern rather than a reason to keep showing something somebody deleted.
   */
  async removeMedia(
    account: UserAccountRow,
    mediaId: string,
  ): Promise<ProfileOutcome> {
    if (isDeletionState(account.status)) return { kind: 'not_eligible' };
    const { media, repository } = this.dependencies;
    const slot = await repository.findMedia(repository.transactionless, {
      mediaId,
      userId: account.id,
    });
    if (slot === undefined || slot.state === 'removed') {
      return { kind: 'not_found' };
    }

    const removed = await repository.transitionMedia(
      repository.transactionless,
      {
        expectedState: 'attached',
        mediaId: slot.id,
        now: this.dependencies.now(),
        state: 'removed',
        userId: account.id,
      },
    );
    if (removed === undefined) return { kind: 'conflict' };

    try {
      await media.requestDeletion({ assetId: slot.mediaAssetId });
    } catch (error) {
      // Recorded rather than retried here. The deletion is owed by the media
      // platform's own durable work, and this call is only the request.
      this.dependencies.logger.warn(
        { error, mediaId: slot.id },
        'profile media deletion could not be requested',
      );
    }
    return { kind: 'saved', view: await this.settle(account) };
  }

  /**
   * Profile editing is open from the `profile` admission step onward. Before
   * that the account has not passed the adult gate or accepted the notices, and
   * an account in a deletion or restricted state is not editing anything.
   */
  private async mayEditProfile(account: UserAccountRow): Promise<boolean> {
    if (account.status !== 'pending_profile' && account.status !== 'active') {
      return false;
    }
    const eligibility = await this.dependencies.onboarding.evaluate(account);
    return eligibility.step === 'profile' || eligibility.step === 'completed';
  }

  /**
   * Applies the consequences a profile write can have beyond the profile: the
   * account may become active or stop being active, and an account that stops
   * meeting the minimum profile stops being discoverable.
   */
  private async settle(account: UserAccountRow): Promise<ProfileView> {
    const reconciled =
      await this.dependencies.onboarding.reconcileActivation(account);
    if (reconciled.eligibility.outstandingProfile.length > 0) {
      await this.dependencies.repository.suppressDiscoverability(
        this.dependencies.repository.transactionless,
        { now: this.dependencies.now(), userId: account.id },
      );
    }
    return this.buildView(reconciled.account);
  }

  private async buildView(account: UserAccountRow): Promise<ProfileView> {
    const { repository } = this.dependencies;
    const executor = repository.transactionless;
    // Sequential, not concurrent. Each of these reads takes its own pooled
    // connection, so running them together lets one in-flight request hold
    // several at once — and a handful of concurrent requests then hold every
    // connection while each waits for one more, which is a deadlock the pool
    // cannot break. A request holds at most one pooled connection at a time.
    const profile = await repository.findProfile(executor, account.id);
    const languages = await repository.findLanguages(executor, account.id);
    const slots = await repository.listLiveMedia(executor, account.id);
    const preferences = await repository.findPreferences(executor, account.id);

    // Ask the media platform where its assets have got to, and record what it
    // says. The refresh is here as well as on the sweep because the person
    // reading their own profile is the one watching a spinner: waiting up to a
    // sweep interval to learn their image is ready would be a worse answer than
    // one extra query on a page they explicitly asked for.
    const media = await this.refreshReadiness(slots);
    const completeness = await repository.readCompleteness(account);
    return {
      account,
      completeness,
      discoverable: preferences?.discoverable ?? false,
      languages,
      media,
      preferencesVersion: preferences?.version,
      profile,
    };
  }

  /**
   * Projects the media platform's answer onto the slots, and caches it.
   *
   * The cached value is what discovery reads, so it is written here rather than
   * only returned. A slot whose asset the media platform no longer recognises
   * is reported as removed and its projection cleared: an asset that vanished
   * is not a ready one.
   */
  private async refreshReadiness(
    slots: readonly UserProfileMediaRow[],
  ): Promise<readonly ProfileMediaView[]> {
    if (slots.length === 0) return [];
    const { media, repository } = this.dependencies;
    const now = this.dependencies.now();

    const readiness = await media.describeReadiness({
      assetIds: slots.map((slot) => slot.mediaAssetId),
    });
    const byAsset = new Map(readiness.map((one) => [one.assetId, one]));

    const views: ProfileMediaView[] = [];
    for (const slot of slots) {
      const answer = byAsset.get(slot.mediaAssetId);
      const ready = answer?.state === 'ready';
      if (ready !== slot.mediaReady || slot.readinessCheckedAt === null) {
        await repository.recordMediaReadiness(repository.transactionless, {
          mediaId: slot.id,
          now,
          ready,
        });
      }
      views.push({
        id: slot.id,
        position: slot.position,
        rejectionReason: answer?.rejection,
        state: answer?.state ?? 'removed',
        uploadExpiresAt: answer?.uploadExpiresAt,
      });
    }
    return views;
  }

  /** Delegates to the shared sweep, so both paths use one implementation. */
  async refreshStaleMediaReadiness(input?: {
    readonly limit?: number;
  }): Promise<number> {
    return new ProfileMediaReadinessSweep({
      media: this.dependencies.media,
      now: this.dependencies.now,
      onboarding: this.dependencies.onboarding,
      repository: this.dependencies.repository,
      users: this.dependencies.users,
    }).run(input);
  }
}

function isDeletionState(status: UserAccountRow['status']): boolean {
  return (
    status === 'deletion_pending' ||
    status === 'deactivated' ||
    status === 'erased'
  );
}

/**
 * Refreshes the stalest readiness projections, wherever they are.
 *
 * The interactive path only covers accounts somebody is looking at. A profile
 * nobody has opened since its asset was taken down would otherwise keep a stale
 * `true` and stay discoverable on an image that can no longer be delivered.
 * Ordering by staleness means every slot is revisited within a bounded period
 * rather than whichever ones happen to be read.
 *
 * Delivery never reads this projection — every issuance re-derives readiness,
 * safety, and entitlement — so the exposure is bounded to discoverability
 * rather than to bytes reaching anybody.
 *
 * It needs a repository and the media contract and nothing else, which is why
 * it is a class of its own: the worker composes no consumer context, no caller
 * resolver, and no HTTP surface, and should not have to in order to run this.
 */
export class ProfileMediaReadinessSweep {
  constructor(
    private readonly dependencies: {
      readonly media: Pick<ProfileMediaPort, 'describeReadiness'>;
      readonly now: () => Date;
      /**
       * Admission, so a projection that changes takes its consequence with it.
       *
       * An image becoming ready is what completes somebody's minimum profile,
       * and completion is what activates the account. That used to happen on
       * the write that made the image ready; readiness is asynchronous now, so
       * an account would otherwise sit at `pending_profile` until its owner
       * happened to save something else. Reconciling here is what keeps the
       * behaviour the same as it was.
       */
      readonly onboarding: OnboardingService;
      readonly repository: ProfileRepository;
      readonly users: UsersRepository;
    },
  ) {}

  async run(input?: { readonly limit?: number }): Promise<number> {
    const { media, repository } = this.dependencies;
    const slots = await repository.listStaleReadiness(
      repository.transactionless,
      { limit: input?.limit ?? profileMediaReadinessBatchSize },
    );
    if (slots.length === 0) return 0;

    const readiness = await media.describeReadiness({
      assetIds: slots.map((slot) => slot.mediaAssetId),
    });
    const readyAssets = new Set(
      readiness
        .filter((one) => one.state === 'ready')
        .map((one) => one.assetId),
    );
    const now = this.dependencies.now();
    const changed = new Set<string>();
    for (const slot of slots) {
      const ready = readyAssets.has(slot.mediaAssetId);
      if (ready !== slot.mediaReady) changed.add(slot.userId);
      await repository.recordMediaReadiness(repository.transactionless, {
        mediaId: slot.id,
        now,
        ready,
      });
    }

    // Only accounts whose answer actually moved. A sweep that reconciled every
    // account it looked at would do the admission work of the whole platform
    // every cycle.
    for (const userId of changed) {
      const account = await this.dependencies.users.findById(
        this.dependencies.users.transactionless,
        userId,
      );
      if (account === undefined) continue;
      await this.dependencies.onboarding.reconcileActivation(account);
    }
    return slots.length;
  }
}
