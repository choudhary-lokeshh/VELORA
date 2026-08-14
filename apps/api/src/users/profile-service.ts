import type { SafeLogger } from '@velora/observability/server';
import {
  maximumProfileMedia,
  maximumProfileMediaBytes,
} from '@velora/validation';

import type {
  ProfileMediaStoragePort,
  ProfileMediaUploadTarget,
} from './media.js';
import type { OnboardingService } from './onboarding.js';
import { profileMediaUploadWindowMilliseconds } from './profile-policy.js';
import {
  isProfileComplete,
  type ProfileCompleteness,
  type ProfileRepository,
  type UserProfileMediaRow,
  type UserProfileRow,
} from './profile-repository.js';
import type { UserAccountRow } from './repository.js';
import type { ProfileMediaRejectionReason } from './schema.js';

/**
 * Everything the owner of a profile may see about it. It is never rendered for
 * a peer: the projection other consumers receive is built by the domain that
 * owns the relationship, from far less than this.
 */
export interface ProfileView {
  readonly account: UserAccountRow;
  readonly completeness: ProfileCompleteness;
  readonly discoverable: boolean;
  readonly languages: readonly string[];
  readonly media: readonly UserProfileMediaRow[];
  /** Absent until the account has saved a preference at least once. */
  readonly preferencesVersion: number | undefined;
  readonly profile: UserProfileRow | undefined;
}

export type ProfileOutcome =
  | { readonly kind: 'saved'; readonly view: ProfileView }
  | {
      readonly kind: 'upload_created';
      readonly media: UserProfileMediaRow;
      readonly upload: ProfileMediaUploadTarget;
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
  readonly now: () => Date;
  readonly onboarding: OnboardingService;
  readonly repository: ProfileRepository;
  readonly storage: ProfileMediaStoragePort;
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

  async readProfile(account: UserAccountRow): Promise<ProfileView> {
    return this.buildView(account);
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
    const { repository, storage } = this.dependencies;
    const now = this.dependencies.now();

    const live = await repository.listLiveMedia(
      repository.transactionless,
      account.id,
    );
    if (live.length >= maximumProfileMedia) return { kind: 'limit_reached' };

    const mediaId = crypto.randomUUID();
    const storageKey = `profile-media/${account.id}/${mediaId}`;
    const uploadExpiresAt = new Date(
      now.getTime() + profileMediaUploadWindowMilliseconds,
    );

    let upload: ProfileMediaUploadTarget;
    try {
      upload = await storage.createUploadTarget({
        expiresAt: uploadExpiresAt,
        maximumBytes: maximumProfileMediaBytes,
        objectKey: storageKey,
      });
    } catch {
      return { kind: 'storage_unavailable' };
    }

    const media = await repository.insertMediaInFreeSlot(
      repository.transactionless,
      { id: mediaId, now, storageKey, uploadExpiresAt, userId: account.id },
    );
    if (media === undefined) return { kind: 'limit_reached' };
    return { kind: 'upload_created', media, upload };
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
    const { repository, storage } = this.dependencies;
    const now = this.dependencies.now();

    const media = await repository.findMedia(repository.transactionless, {
      mediaId,
      userId: account.id,
    });
    if (media === undefined) return { kind: 'not_found' };
    // Repeating a completed upload is a no-op success, so a client that retried
    // a lost response does not turn its own image into a conflict.
    if (media.state === 'ready') {
      return { kind: 'saved', view: await this.buildView(account) };
    }
    if (media.state !== 'pending_upload') return { kind: 'conflict' };

    if (media.uploadExpiresAt.getTime() <= now.getTime()) {
      await this.reject(account, media, 'not_uploaded');
      return { kind: 'saved', view: await this.settle(account) };
    }

    let facts;
    try {
      facts = await storage.inspect(media.storageKey);
    } catch {
      return { kind: 'storage_unavailable' };
    }
    if (facts === undefined) {
      await this.reject(account, media, 'not_uploaded');
      return { kind: 'saved', view: await this.settle(account) };
    }
    if (facts.verdict === 'rejected') {
      await this.reject(account, media, facts.reason);
      return { kind: 'saved', view: await this.settle(account) };
    }

    const promoted = await repository.transitionMedia(
      repository.transactionless,
      {
        byteSize: facts.byteSize,
        checksum: facts.checksum,
        contentType: facts.contentType,
        expectedState: 'pending_upload',
        mediaId: media.id,
        now,
        state: 'ready',
        userId: account.id,
      },
    );
    if (promoted === undefined) return { kind: 'conflict' };
    return { kind: 'saved', view: await this.settle(account) };
  }

  /**
   * Removes an image from the profile.
   *
   * The record is authoritative and is updated first; the bytes are deleted
   * afterwards. If the adapter cannot delete them the image is still gone from
   * the profile, and the orphaned object is recorded for the retention job that
   * an approved storage provider will bring with it.
   */
  async removeMedia(
    account: UserAccountRow,
    mediaId: string,
  ): Promise<ProfileOutcome> {
    if (isDeletionState(account.status)) return { kind: 'not_eligible' };
    const { repository, storage } = this.dependencies;
    const media = await repository.findMedia(repository.transactionless, {
      mediaId,
      userId: account.id,
    });
    if (media === undefined || media.state === 'removed') {
      return { kind: 'not_found' };
    }

    const removed = await repository.transitionMedia(
      repository.transactionless,
      {
        expectedState: media.state,
        mediaId: media.id,
        now: this.dependencies.now(),
        state: 'removed',
        userId: account.id,
      },
    );
    if (removed === undefined) return { kind: 'conflict' };

    try {
      await storage.remove(media.storageKey);
    } catch (error) {
      this.dependencies.logger.warn(
        { error, mediaId: media.id, storage: storage.name },
        'profile media object was not deleted from storage',
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

  private async reject(
    account: UserAccountRow,
    media: UserProfileMediaRow,
    reason: ProfileMediaRejectionReason,
  ): Promise<void> {
    await this.dependencies.repository.transitionMedia(
      this.dependencies.repository.transactionless,
      {
        expectedState: 'pending_upload',
        mediaId: media.id,
        now: this.dependencies.now(),
        rejectionReason: reason,
        state: 'rejected',
        userId: account.id,
      },
    );
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
    const media = await repository.listLiveMedia(executor, account.id);
    const preferences = await repository.findPreferences(executor, account.id);
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
}

function isDeletionState(status: UserAccountRow['status']): boolean {
  return (
    status === 'deletion_pending' ||
    status === 'deactivated' ||
    status === 'erased'
  );
}
