import { and, count, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';

import { clubs } from '../clubs/schema.js';
import { creatorAccounts, creatorProfiles } from '../creators/schema.js';
import type { DatabaseHandle } from '../database/executor.js';
import { bounded } from '../database/fan-out.js';
import { growthLiveWindows } from '../growth/schema.js';

/**
 * Whether VELORA has a way in, and what is behind it.
 *
 * The two conditions that decide whether anything is indexable are configured
 * rather than stored, and both are reported here rather than inferred from a
 * page: the environment has to be production, and a canonical public origin has
 * to be configured. An operator who cannot see those two facts has no way to
 * tell "we are not indexed" from "we are indexed and nobody is coming", and
 * those need entirely different responses.
 *
 * Everything else is a count of records that would appear on a sitemap: creator
 * pages actually published by creators whose accounts are actually active, and
 * clubs actually published. They are counted from the same conditions the
 * public reads use, so the number here is the number of addresses that exist —
 * not the number of rows that could theoretically become one.
 *
 * There is no rank, no impression count, no click figure, and no traffic
 * estimate. VELORA has no search console data, no analytics provider, and no
 * budget for either, and a number invented to fill the space would be the one
 * thing on this screen nobody could check.
 */

export interface PublicEntryState {
  /** Creator pages an anonymous visitor can reach right now. */
  readonly publishedCreators: number;
  /** Clubs an anonymous visitor can reach right now. */
  readonly publishedClubs: number;
  /** Scheduled live windows, split by whether they have happened. */
  readonly liveWindows: {
    readonly active: number;
    readonly cancelled: number;
    readonly upcoming: number;
  };
  readonly observedAt: Date;
}

export class AdminPublicEntryDirectory {
  constructor(
    private readonly dependencies: {
      readonly database: DatabaseHandle;
      readonly now: () => Date;
    },
  ) {}

  async state(): Promise<PublicEntryState> {
    const now = this.dependencies.now();
    const [creators, publishedClubs, upcoming, active, cancelled] =
      await bounded([
        // Both conditions, exactly as the public read applies them. A published
        // profile belonging to a suspended creator is not a public address, and
        // counting it here would tell an operator the sitemap is bigger than it is.
        async () =>
          this.dependencies.database
            .select({ total: count() })
            .from(creatorProfiles)
            .innerJoin(
              creatorAccounts,
              eq(creatorAccounts.id, creatorProfiles.creatorId),
            )
            .where(
              and(
                eq(creatorProfiles.publication, 'published'),
                eq(creatorAccounts.status, 'active'),
              ),
            ),
        async () =>
          this.dependencies.database
            .select({ total: count() })
            .from(clubs)
            .where(
              and(eq(clubs.lifecycle, 'published'), isNull(clubs.closedAt)),
            ),
        // Three counts rather than one grouped `case`, because the expression
        // would have had to carry the clock as a parameter and be repeated
        // verbatim in the `group by` — which PostgreSQL cannot type and a reader
        // cannot check. Three indexed counts are cheaper to run and to read.
        async () =>
          this.dependencies.database
            .select({ total: count() })
            .from(growthLiveWindows)
            .where(
              and(
                isNull(growthLiveWindows.cancelledAt),
                gt(growthLiveWindows.startsAt, now),
              ),
            ),
        async () =>
          this.dependencies.database
            .select({ total: count() })
            .from(growthLiveWindows)
            .where(
              and(
                isNull(growthLiveWindows.cancelledAt),
                lte(growthLiveWindows.startsAt, now),
                gt(growthLiveWindows.endsAt, now),
              ),
            ),
        async () =>
          this.dependencies.database
            .select({ total: count() })
            .from(growthLiveWindows)
            .where(isNotNull(growthLiveWindows.cancelledAt)),
      ]);

    return {
      liveWindows: {
        active: active[0]?.total ?? 0,
        cancelled: cancelled[0]?.total ?? 0,
        upcoming: upcoming[0]?.total ?? 0,
      },
      observedAt: now,
      publishedClubs: publishedClubs[0]?.total ?? 0,
      publishedCreators: creators[0]?.total ?? 0,
    };
  }
}
