import {
  maximumProfileMedia,
  type ProfileRequirement,
} from '@velora/validation';
import { and, asc, eq, ne, notInArray, sql } from 'drizzle-orm';

import type { UsersDatabase, UsersExecutor } from './repository.js';
import {
  userPreferences,
  userProfileLanguages,
  userProfileMedia,
  userProfiles,
  type ProfileMediaState,
} from './schema.js';

type AnyExecutor = UsersDatabase | UsersExecutor;

export type UserProfileRow = typeof userProfiles.$inferSelect;
export type UserPreferencesRow = typeof userPreferences.$inferSelect;
export type UserProfileMediaRow = typeof userProfileMedia.$inferSelect;

/**
 * What a profile still lacks before it may be shown. Every field is a fact this
 * account owns about itself, so it is safe to return to its owner and is never
 * returned to anybody else.
 */
export interface ProfileCompleteness {
  readonly hasDisplayName: boolean;
  readonly hasLanguage: boolean;
  readonly hasReadyMedia: boolean;
  readonly hasRegion: boolean;
}

export function isProfileComplete(completeness: ProfileCompleteness): boolean {
  return outstandingProfileRequirements(completeness).length === 0;
}

/**
 * Completeness expressed as the list of what is missing. Both the admission
 * ladder and the profile response need it, so it is derived once here rather
 * than assembled separately in each.
 */
export function outstandingProfileRequirements(
  completeness: ProfileCompleteness,
): readonly ProfileRequirement[] {
  const outstanding: ProfileRequirement[] = [];
  if (!completeness.hasDisplayName) outstanding.push('display_name');
  if (!completeness.hasLanguage) outstanding.push('language');
  if (!completeness.hasReadyMedia) outstanding.push('ready_media');
  if (!completeness.hasRegion) outstanding.push('region');
  return outstanding;
}

/**
 * Narrow read the admission ladder needs.
 *
 * `OnboardingService` depends on this rather than on the profile service, which
 * is what keeps the two from depending on each other: profile writes must be
 * gated by the admission step, and the admission step must know whether the
 * profile is complete. Splitting the read out breaks the cycle without a
 * mediator that would own neither concern.
 */
export interface ProfileCompletenessReader {
  readCompleteness(account: {
    readonly id: string;
    readonly region: string | null;
  }): Promise<ProfileCompleteness>;
}

/** Reads and writes for the consumer profile, its media, and its preferences. */
export class ProfileRepository implements ProfileCompletenessReader {
  constructor(private readonly database: UsersDatabase) {}

  get transactionless(): UsersDatabase {
    return this.database;
  }

  transaction<T>(work: (executor: UsersExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  /**
   * Three concurrent index probes plus the region the caller already holds.
   *
   * Written as builder queries rather than one correlated subquery on purpose.
   * Drizzle renders bare column names inside a raw `sql` fragment, so
   * `where user_id = id` inside a subquery binds `id` to the *inner* table when
   * that table also has an `id` column, and the predicate silently becomes false
   * instead of failing. One round trip is not worth a class of bug that a test
   * only catches if it happens to assert the right field.
   */
  async readCompleteness(account: {
    readonly id: string;
    readonly region: string | null;
  }): Promise<ProfileCompleteness> {
    // Sequential, not concurrent. Each read takes its own pooled connection, so
    // running them together lets one in-flight request hold three at once — and
    // a handful of concurrent requests then hold every connection while each
    // waits for one more, which is a deadlock the pool cannot break. A request
    // holds at most one pooled connection at a time.
    const profile = await this.database
      .select({ userId: userProfiles.userId })
      .from(userProfiles)
      .where(eq(userProfiles.userId, account.id))
      .limit(1);
    const language = await this.database
      .select({ userId: userProfileLanguages.userId })
      .from(userProfileLanguages)
      .where(eq(userProfileLanguages.userId, account.id))
      .limit(1);
    const media = await this.database
      .select({ id: userProfileMedia.id })
      .from(userProfileMedia)
      .where(
        and(
          eq(userProfileMedia.userId, account.id),
          eq(userProfileMedia.state, 'attached'),
          // MEDIA's cached answer, on the same projection discovery reads. A
          // slot whose asset is still being inspected does not satisfy the
          // minimum profile, which is the behaviour this domain already had
          // when it decided readiness itself.
          eq(userProfileMedia.mediaReady, true),
        ),
      )
      .limit(1);
    return {
      hasDisplayName: profile.length > 0,
      hasLanguage: language.length > 0,
      hasReadyMedia: media.length > 0,
      hasRegion: account.region !== null,
    };
  }

  async findProfile(
    executor: AnyExecutor,
    userId: string,
  ): Promise<UserProfileRow | undefined> {
    const rows = await executor
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    return rows[0];
  }

  /** Creates the profile, or returns nothing when one already exists. */
  async insertProfile(
    executor: AnyExecutor,
    input: {
      readonly bio: string | null;
      readonly displayName: string;
      readonly now: Date;
      readonly userId: string;
    },
  ): Promise<UserProfileRow | undefined> {
    const inserted = await executor
      .insert(userProfiles)
      .values({
        bio: input.bio,
        createdAt: input.now,
        displayName: input.displayName,
        updatedAt: input.now,
        userId: input.userId,
        version: 1,
      })
      .onConflictDoNothing({ target: userProfiles.userId })
      .returning();
    return inserted[0];
  }

  /**
   * Compare-and-set on the version. A stale edit updates nothing and returns
   * nothing, so the caller reports a conflict rather than overwriting a change
   * it never saw.
   */
  async updateProfile(
    executor: AnyExecutor,
    input: {
      readonly bio: string | null;
      readonly displayName: string;
      readonly expectedVersion: number;
      readonly now: Date;
      readonly userId: string;
    },
  ): Promise<UserProfileRow | undefined> {
    const updated = await executor
      .update(userProfiles)
      .set({
        bio: input.bio,
        displayName: input.displayName,
        updatedAt: input.now,
        version: sql`${userProfiles.version} + 1`,
      })
      .where(
        and(
          eq(userProfiles.userId, input.userId),
          eq(userProfiles.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  async findLanguages(
    executor: AnyExecutor,
    userId: string,
  ): Promise<string[]> {
    const rows = await executor
      .select({ language: userProfileLanguages.language })
      .from(userProfileLanguages)
      .where(eq(userProfileLanguages.userId, userId))
      .orderBy(asc(userProfileLanguages.language));
    return rows.map((row) => row.language);
  }

  /**
   * Replaces the language set. Deleting only what is no longer claimed keeps the
   * original `created_at` on languages the person still speaks, so the row is a
   * record of when they said it rather than of when they last saved the form.
   */
  async replaceLanguages(
    executor: AnyExecutor,
    input: {
      readonly languages: readonly string[];
      readonly now: Date;
      readonly userId: string;
    },
  ): Promise<void> {
    const removals =
      input.languages.length === 0
        ? eq(userProfileLanguages.userId, input.userId)
        : and(
            eq(userProfileLanguages.userId, input.userId),
            notInArray(userProfileLanguages.language, [...input.languages]),
          );
    await executor.delete(userProfileLanguages).where(removals);
    if (input.languages.length === 0) return;
    await executor
      .insert(userProfileLanguages)
      .values(
        input.languages.map((language) => ({
          createdAt: input.now,
          language,
          userId: input.userId,
        })),
      )
      .onConflictDoNothing({
        target: [userProfileLanguages.userId, userProfileLanguages.language],
      });
  }

  async findPreferences(
    executor: AnyExecutor,
    userId: string,
  ): Promise<UserPreferencesRow | undefined> {
    const rows = await executor
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);
    return rows[0];
  }

  async insertPreferences(
    executor: AnyExecutor,
    input: {
      readonly discoverable: boolean;
      readonly now: Date;
      readonly userId: string;
    },
  ): Promise<UserPreferencesRow | undefined> {
    const inserted = await executor
      .insert(userPreferences)
      .values({
        createdAt: input.now,
        discoverable: input.discoverable,
        updatedAt: input.now,
        userId: input.userId,
        version: 1,
      })
      .onConflictDoNothing({ target: userPreferences.userId })
      .returning();
    return inserted[0];
  }

  async updatePreferences(
    executor: AnyExecutor,
    input: {
      readonly discoverable: boolean;
      readonly expectedVersion: number;
      readonly now: Date;
      readonly userId: string;
    },
  ): Promise<UserPreferencesRow | undefined> {
    const updated = await executor
      .update(userPreferences)
      .set({
        discoverable: input.discoverable,
        updatedAt: input.now,
        version: sql`${userPreferences.version} + 1`,
      })
      .where(
        and(
          eq(userPreferences.userId, input.userId),
          eq(userPreferences.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Turns discoverability off without a version check.
   *
   * This is not an edit of the person's preference; it is enforcement of the
   * rule that an account which no longer meets the minimum profile cannot be
   * shown. Requiring an expected version here would let a concurrent preference
   * save leave an ineligible account visible.
   */
  async suppressDiscoverability(
    executor: AnyExecutor,
    input: { readonly now: Date; readonly userId: string },
  ): Promise<void> {
    await executor
      .update(userPreferences)
      .set({
        discoverable: false,
        updatedAt: input.now,
        version: sql`${userPreferences.version} + 1`,
      })
      .where(
        and(
          eq(userPreferences.userId, input.userId),
          eq(userPreferences.discoverable, true),
        ),
      );
  }

  /** Media rows that still occupy a slot, in presentation order. */
  async listLiveMedia(
    executor: AnyExecutor,
    userId: string,
  ): Promise<UserProfileMediaRow[]> {
    return executor
      .select()
      .from(userProfileMedia)
      .where(
        and(
          eq(userProfileMedia.userId, userId),
          ne(userProfileMedia.state, 'removed'),
        ),
      )
      .orderBy(asc(userProfileMedia.position));
  }

  async findMedia(
    executor: AnyExecutor,
    input: { readonly mediaId: string; readonly userId: string },
  ): Promise<UserProfileMediaRow | undefined> {
    const rows = await executor
      .select()
      .from(userProfileMedia)
      .where(
        and(
          eq(userProfileMedia.id, input.mediaId),
          // Ownership is part of the predicate, not a check after the read, so
          // there is no window in which another account's row is in hand.
          eq(userProfileMedia.userId, input.userId),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Claims the lowest free slot for a new object.
   *
   * The partial unique index is the authority, so two concurrent creations
   * cannot take the same slot: the loser's insert violates it and retries
   * against the slots it can now see. Attempts are bounded by the number of
   * slots, so a contended account fails cleanly instead of spinning.
   */
  async insertMediaInFreeSlot(
    executor: AnyExecutor,
    input: {
      readonly id: string;
      readonly mediaAssetId: string;
      readonly now: Date;
      readonly userId: string;
    },
  ): Promise<UserProfileMediaRow | undefined> {
    for (let attempt = 0; attempt < maximumProfileMedia; attempt += 1) {
      const taken = new Set(
        (await this.listLiveMedia(executor, input.userId)).map(
          (row) => row.position,
        ),
      );
      if (taken.size >= maximumProfileMedia) return undefined;
      const position = Array.from(
        { length: maximumProfileMedia },
        (_value, index) => index,
      ).find((candidate) => !taken.has(candidate));
      if (position === undefined) return undefined;

      const inserted = await executor
        .insert(userProfileMedia)
        .values({
          createdAt: input.now,
          id: input.id,
          mediaAssetId: input.mediaAssetId,
          position,
          state: 'attached',
          stateChangedAt: input.now,
          updatedAt: input.now,
          userId: input.userId,
        })
        .onConflictDoNothing()
        .returning();
      const row = inserted[0];
      if (row !== undefined) return row;
    }
    return undefined;
  }

  /**
   * Compare-and-set on the current state, so a completion and a removal racing
   * on the same object produce one winner and one caller that is told it lost.
   */
  async transitionMedia(
    executor: AnyExecutor,
    input: {
      readonly expectedState: ProfileMediaState;
      readonly mediaId: string;
      readonly now: Date;
      readonly state: ProfileMediaState;
      readonly userId: string;
    },
  ): Promise<UserProfileMediaRow | undefined> {
    const updated = await executor
      .update(userProfileMedia)
      .set({
        state: input.state,
        stateChangedAt: input.now,
        updatedAt: input.now,
        // A detached slot is not ready for anything. Clearing the projection
        // with the state keeps the two from disagreeing even for the instant
        // before the next sweep.
        ...(input.state === 'removed' ? { mediaReady: false } : {}),
      })
      .where(
        and(
          eq(userProfileMedia.id, input.mediaId),
          eq(userProfileMedia.userId, input.userId),
          eq(userProfileMedia.state, input.expectedState),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Records what MEDIA currently says about a slot's asset.
   *
   * The projection and the instant it was taken move together, so the sweep can
   * order by staleness and a value can never look fresher than it is.
   */
  async recordMediaReadiness(
    executor: AnyExecutor,
    input: {
      readonly mediaId: string;
      readonly now: Date;
      readonly ready: boolean;
    },
  ): Promise<void> {
    await executor
      .update(userProfileMedia)
      .set({
        mediaReady: input.ready,
        readinessCheckedAt: input.now,
        updatedAt: input.now,
      })
      .where(eq(userProfileMedia.id, input.mediaId));
  }

  /**
   * Attached slots whose projection is stalest, oldest first.
   *
   * Never-checked rows sort first, so a freshly attached asset is picked up on
   * the next cycle rather than waiting behind everything else. Bounded, and
   * served by the partial readiness index — which it genuinely is only because
   * that index is declared `nulls first` to match. A b-tree ASC index stores
   * nulls last, so the obvious declaration cannot serve this ordering and the
   * planner falls back to scanning and sorting every attached slot each cycle.
   * That is what it used to do, and this comment used to claim otherwise.
   */
  async listStaleReadiness(
    executor: AnyExecutor,
    input: { readonly limit: number },
  ): Promise<UserProfileMediaRow[]> {
    return (
      executor
        .select()
        .from(userProfileMedia)
        .where(eq(userProfileMedia.state, 'attached'))
        // `asc nulls first` in that order: PostgreSQL takes the direction before
        // the null placement, and drizzle's `asc()` helper wrapped around a raw
        // fragment emits them the other way round.
        .orderBy(
          sql`${userProfileMedia.readinessCheckedAt} asc nulls first`,
          asc(userProfileMedia.id),
        )
        .limit(input.limit)
    );
  }
}
