import {
  canonicalCreatorHandle,
  creatorHandleSchema,
  type SaveCreatorProfileRequest,
} from '@velora/validation';

import type { CreatorProfilePublication } from './handle-policy.js';
import type {
  CreatorAccountRow,
  CreatorProfileRecord,
  CreatorProfileRepository,
} from './repository.js';

/**
 * The creator's public identity.
 *
 * Two rules run through everything here. The handle is claimed once and never
 * renamed in this milestone, because a rename without redirects breaks every
 * link anybody ever shared. And publication is always an explicit decision:
 * saving a profile never makes it public, so nothing a creator writes becomes
 * visible to the internet as a side effect of writing it.
 */

export type CreatorProfileOutcome =
  | {
      readonly kind: 'saved';
      readonly created: boolean;
      readonly record: CreatorProfileRecord;
    }
  /**
   * One outcome for a stale version, a taken handle, an attempted rename, and a
   * capability that may not do this. They are deliberately indistinguishable:
   * telling a caller that a handle is taken rather than that their edit was
   * stale would let the endpoint be used to test which names exist.
   */
  | { readonly kind: 'conflict' };

export interface CreatorProfileServiceDependencies {
  readonly now: () => Date;
  readonly profiles: CreatorProfileRepository;
}

/** Capability states in which a creator may edit their own identity. */
const editableStatuses = new Set(['applicant', 'active']);

export class CreatorProfileService {
  constructor(
    private readonly dependencies: CreatorProfileServiceDependencies,
  ) {}

  findOwn(creatorId: string): Promise<CreatorProfileRecord | undefined> {
    return this.dependencies.profiles.findByCreatorId(
      this.dependencies.profiles.transactionless,
      creatorId,
    );
  }

  /**
   * The public projection for a handle, or nothing.
   *
   * A handle that cannot be canonical is answered the same way as one nobody
   * holds. There is no shape of input that produces a different answer from
   * "not found", so the endpoint cannot be used to learn that a name is taken,
   * that a profile exists as a draft, or that a creator has been suspended.
   */
  async findPublic(handle: string): Promise<CreatorProfileRecord | undefined> {
    const canonical = canonicalCreatorHandle(handle);
    if (!creatorHandleSchema.safeParse(canonical).success) return undefined;
    return this.dependencies.profiles.findPublishedByHandle(
      this.dependencies.profiles.transactionless,
      canonical,
    );
  }

  /**
   * Creates or edits the creator's own profile.
   *
   * The first save claims the handle; every later one carries the version the
   * caller read. A save with no version against an existing profile is refused
   * rather than treated as a fresh create, because "I did not know this existed"
   * is exactly the state in which an overwrite destroys somebody's work.
   */
  async save(input: {
    readonly account: CreatorAccountRow;
    readonly request: SaveCreatorProfileRequest;
  }): Promise<CreatorProfileOutcome> {
    if (!editableStatuses.has(input.account.status))
      return { kind: 'conflict' };

    const canonical = canonicalCreatorHandle(input.request.handle);
    if (!creatorHandleSchema.safeParse(canonical).success) {
      return { kind: 'conflict' };
    }
    const profile = {
      bio: input.request.bio ?? null,
      displayName: input.request.displayName,
      links: (input.request.links ?? []).map((link) => ({
        label: link.label ?? null,
        url: link.url,
      })),
    };
    const now = this.dependencies.now();
    const existing = await this.findOwn(input.account.id);

    if (existing === undefined) {
      if (input.request.version !== undefined) return { kind: 'conflict' };
      const record = await this.dependencies.profiles.insertProfile({
        creatorId: input.account.id,
        handle: canonical,
        now,
        profile,
      });
      // Nothing came back, so either the handle is held by somebody else or a
      // profile appeared between the read above and this insert. Both are the
      // same answer to this caller.
      return record === undefined
        ? { kind: 'conflict' }
        : { created: true, kind: 'saved', record };
    }

    // No self-service rename in this milestone. A save naming a different
    // handle is refused rather than silently keeping the old one, so a client
    // that believes it renamed something is told it did not.
    if (
      input.request.version === undefined ||
      existing.profile.handle !== canonical
    ) {
      return { kind: 'conflict' };
    }
    const record = await this.dependencies.profiles.updateProfile({
      creatorId: input.account.id,
      expectedVersion: input.request.version,
      now,
      profile,
    });
    return record === undefined
      ? { kind: 'conflict' }
      : { created: false, kind: 'saved', record };
  }

  /**
   * Publishes or withdraws the profile.
   *
   * Publishing requires an active capability: an applicant has not finished the
   * ladder and a suspended creator has been told to stop, and neither may put a
   * page on the public internet. Withdrawing is allowed from any state a
   * creator can still act in, because taking your own page down should never be
   * the thing the platform refuses.
   */
  async setPublication(input: {
    readonly account: CreatorAccountRow;
    readonly publication: CreatorProfilePublication;
    readonly version: number;
  }): Promise<CreatorProfileOutcome> {
    if (!editableStatuses.has(input.account.status))
      return { kind: 'conflict' };
    if (
      input.publication === 'published' &&
      input.account.status !== 'active'
    ) {
      return { kind: 'conflict' };
    }
    const record = await this.dependencies.profiles.setPublication({
      creatorId: input.account.id,
      expectedVersion: input.version,
      now: this.dependencies.now(),
      publication: input.publication,
    });
    return record === undefined
      ? { kind: 'conflict' }
      : { created: false, kind: 'saved', record };
  }
}
