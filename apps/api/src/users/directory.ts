import { and, asc, desc, eq, exists, gt, inArray, ne, sql } from 'drizzle-orm';

import type { IdentityAdultAssuranceReaderPort } from '../identity/assurance-reader.js';
import { adultAssuranceDecisionOf } from './onboarding.js';
import type { UsersDatabase } from './repository.js';
import {
  userAccounts,
  userAdultDeclarations,
  userAvailability,
  userPreferences,
  userProfileLanguages,
  userProfileMedia,
  userProfiles,
} from './schema.js';

/**
 * The consumer directory USERS publishes to other domains.
 *
 * `docs/architecture/03-domain-boundaries.md` lets another domain reference
 * opaque identifiers, subscribe to published events, or call an approved
 * service contract — and nothing else. So the query over `users_` tables lives
 * here, in the domain that owns them, and DISCOVERY calls it with the policy it
 * owns rather than reaching into this schema itself.
 *
 * Everything this returns is minimized. A caller receives what a peer is
 * allowed to see and no more: no status, no assurance, no preference, no
 * availability window, no counts, and nothing about why anybody else is absent.
 */

/** A consumer another consumer may be shown, with its ordering key. */
export interface DirectoryCandidate {
  readonly bio: string | null;
  readonly displayName: string;
  readonly id: string;
  readonly region: string | null;
  readonly sharedLanguages: string[];
  /**
   * Opaque total-order key. The caller pages by comparing against the last one
   * it received; it is not required to understand how it is composed.
   */
  readonly sortKey: string;
}

/** The same minimized shape, for people the caller already has a pair with. */
export type DirectoryProfile = Omit<DirectoryCandidate, 'sortKey'>;

/** The minimum a connected peer may render about somebody. */
export interface DirectoryName {
  readonly displayName: string;
  readonly id: string;
}

export interface DirectoryCandidateMedia {
  readonly id: string;
  readonly position: number;
  readonly userId: string;
}

/**
 * Criteria a caller supplies. They are values, never SQL: a domain that could
 * hand this service a predicate would be reaching into the schema through a
 * longer route rather than not reaching into it.
 */
export interface DirectoryCriteria {
  /** Sort key of the last candidate already seen, for forward-only paging. */
  readonly after: string | undefined;
  /**
   * Restricts the answer to one consumer. Used to revalidate a target at the
   * moment an action is taken, rather than trusting that a page a client is
   * still holding was accurate when it was produced.
   */
  readonly onlyId?: string | undefined;
  /** How coarsely availability recency is compared. Caller-owned policy. */
  readonly freshnessBucketSeconds: number;
  /** Languages a candidate must share at least one of. */
  readonly languages: readonly string[];
  readonly limit: number;
  readonly now: Date;
  /** Rotation seed for the caller's tie-break. Opaque to this service. */
  readonly seed: string;
  readonly viewerId: string;
  readonly viewerRegion: string | null;
}

/**
 * Qualified column reference for the few places raw SQL is unavoidable.
 *
 * Drizzle renders an interpolated column inside a `sql` template as a bare name,
 * which resolves against whichever table in scope happens to have it. Writing
 * the qualification explicitly removes that guesswork; the alternative is a
 * predicate that silently binds to the wrong table.
 */
const column = (table: string, name: string) => sql.raw(`"${table}"."${name}"`);

export class ConsumerDirectory {
  constructor(
    private readonly database: UsersDatabase,
    private readonly identityAdultAssurance: IdentityAdultAssuranceReaderPort,
  ) {}

  /**
   * The end of the caller's own open availability window, if one is open.
   *
   * Deliberately answerable only about oneself. Availability is a preference
   * USERS owns, and when another person's window closes is presence information
   * this service never publishes — which is why `findDiscoverable` returns a
   * candidate without one. A caller passing somebody else's identifier learns
   * nothing it did not already supply, because the answer is used to bound how
   * long that caller's own outbound signal stays valid and nothing else.
   */
  async openAvailabilityWindow(
    userId: string,
    now: Date,
  ): Promise<Date | undefined> {
    const rows = await this.database
      .select({ availableUntil: userAvailability.availableUntil })
      .from(userAvailability)
      .where(
        and(
          eq(userAvailability.userId, userId),
          eq(userAvailability.state, 'available'),
          gt(userAvailability.availableUntil, now),
        ),
      )
      .limit(1);
    return rows[0]?.availableUntil ?? undefined;
  }

  /** Languages the viewer speaks, which every candidate must share one of. */
  async languagesOf(userId: string): Promise<string[]> {
    const rows = await this.database
      .select({ language: userProfileLanguages.language })
      .from(userProfileLanguages)
      .where(eq(userProfileLanguages.userId, userId))
      .orderBy(asc(userProfileLanguages.language));
    return rows.map((row) => row.language);
  }

  /**
   * One page of consumers who are currently discoverable to the viewer.
   *
   * Every eligibility condition USERS owns is in this one statement. A condition
   * applied after paging would change how many results a page holds, and a
   * condition a caller forgets to apply is a person shown to somebody who should
   * never have seen them.
   *
   * What this deliberately does not take is a list of identifiers to exclude.
   * The caller's own suppression relationships are unbounded — an active account
   * accumulates them for as long as it is active — and carrying them here would
   * have made an unbounded parameter part of a hot query, with an arbitrary cap
   * as the only thing standing between that and a broken plan. DISCOVERY instead
   * pages through this ordering and filters each bounded batch against its own
   * tables, so the number of relationships an account has stops being an input
   * to anything. See `docs/domains/discovery.md`.
   *
   * Nothing purchasable participates. There is no spend, subscription,
   * popularity, follower, or boost column in the predicate, in the ordering, or
   * in the schema behind either.
   */
  async findDiscoverable(
    criteria: DirectoryCriteria,
  ): Promise<DirectoryCandidate[]> {
    if (criteria.languages.length === 0) return [];

    const latestDeclaration = this.database
      .selectDistinctOn([userAdultDeclarations.userId], {
        outcome: userAdultDeclarations.outcome,
        recordedAt: userAdultDeclarations.recordedAt,
        userId: userAdultDeclarations.userId,
      })
      .from(userAdultDeclarations)
      .orderBy(
        userAdultDeclarations.userId,
        desc(userAdultDeclarations.recordedAt),
        desc(userAdultDeclarations.id),
      )
      .as('latest_declaration');

    const sortKey = sql<string>`concat(
      case when ${column('users_accounts', 'region')} is not distinct from ${criteria.viewerRegion} then '0' else '1' end,
      '-',
      lpad((99 - count(${column('users_profile_languages', 'language')}))::text, 2, '0'),
      '-',
      lpad((9999999999 - floor(extract(epoch from ${column('users_availability', 'available_since')}) / ${criteria.freshnessBucketSeconds}))::text, 10, '0'),
      '-',
      md5(${column('users_accounts', 'id')}::text || ${criteria.seed}),
      '-',
      ${column('users_accounts', 'id')}::text
    )`;

    const ranked = this.database
      .select({
        authAccountId: userAccounts.authAccountId,
        bio: userProfiles.bio,
        declarationOutcome: latestDeclaration.outcome,
        declarationRecordedAt: latestDeclaration.recordedAt,
        displayName: userProfiles.displayName,
        id: userAccounts.id,
        region: userAccounts.region,
        sharedLanguages: sql<
          string[]
        >`array_agg(distinct ${column('users_profile_languages', 'language')})`.as(
          'shared_languages',
        ),
        sortKey: sortKey.as('sort_key'),
      })
      .from(userAccounts)
      .innerJoin(userProfiles, eq(userProfiles.userId, userAccounts.id))
      .innerJoin(
        userPreferences,
        and(
          eq(userPreferences.userId, userAccounts.id),
          eq(userPreferences.discoverable, true),
        ),
      )
      .innerJoin(
        userAvailability,
        and(
          eq(userAvailability.userId, userAccounts.id),
          eq(userAvailability.state, 'available'),
          gt(userAvailability.availableUntil, criteria.now),
        ),
      )
      .leftJoin(
        latestDeclaration,
        eq(latestDeclaration.userId, userAccounts.id),
      )
      .innerJoin(
        userProfileLanguages,
        and(
          eq(userProfileLanguages.userId, userAccounts.id),
          inArray(userProfileLanguages.language, [...criteria.languages]),
        ),
      )
      .where(
        and(
          ne(userAccounts.id, criteria.viewerId),
          eq(userAccounts.status, 'active'),
          exists(
            this.database
              .select({ present: userProfileMedia.id })
              .from(userProfileMedia)
              .where(
                and(
                  eq(userProfileMedia.userId, userAccounts.id),
                  eq(userProfileMedia.state, 'attached'),
                  // MEDIA's cached answer. Discovery stays one indexed query
                  // rather than a per-candidate call into another domain, and
                  // a stale projection delays discoverability rather than
                  // granting it.
                  eq(userProfileMedia.mediaReady, true),
                ),
              ),
          ),
          criteria.onlyId === undefined
            ? undefined
            : eq(userAccounts.id, criteria.onlyId),
        ),
      )
      .groupBy(
        userAccounts.id,
        latestDeclaration.outcome,
        latestDeclaration.recordedAt,
        userAccounts.region,
        userProfiles.displayName,
        userProfiles.bio,
        userAvailability.availableSince,
      )
      .as('ranked');

    const accepted: DirectoryCandidate[] = [];
    const batchSize = Math.max(criteria.limit, 50);
    let after = criteria.after;
    while (accepted.length < criteria.limit) {
      const page = this.database
        .select({
          authAccountId: ranked.authAccountId,
          bio: ranked.bio,
          declarationOutcome: ranked.declarationOutcome,
          declarationRecordedAt: ranked.declarationRecordedAt,
          displayName: ranked.displayName,
          id: ranked.id,
          region: ranked.region,
          sharedLanguages: ranked.sharedLanguages,
          sortKey: ranked.sortKey,
        })
        .from(ranked)
        .orderBy(asc(ranked.sortKey))
        .limit(batchSize);
      const rows = await (after === undefined
        ? page
        : page.where(gt(ranked.sortKey, after)));
      if (rows.length === 0) break;
      after = rows.at(-1)?.sortKey;

      const decisions = await Promise.all(
        rows.map(async (row) => {
          const identity =
            await this.identityAdultAssurance.currentForAuthAccount({
              authAccountId: row.authAccountId,
              executor: this.database,
              now: criteria.now,
            });
          const declaration =
            row.declarationOutcome === null ||
            row.declarationRecordedAt === null
              ? undefined
              : {
                  outcome: row.declarationOutcome,
                  recordedAt: row.declarationRecordedAt,
                };
          return adultAssuranceDecisionOf(declaration, identity);
        }),
      );
      for (const [index, row] of rows.entries()) {
        if (decisions[index]?.adultAssurance === 'none') continue;
        accepted.push({
          bio: row.bio,
          displayName: row.displayName,
          id: row.id,
          region: row.region,
          sharedLanguages: row.sharedLanguages,
          sortKey: row.sortKey,
        });
        if (accepted.length === criteria.limit) break;
      }
      if (rows.length < batchSize || criteria.onlyId !== undefined) break;
    }
    return accepted;
  }

  /**
   * Minimized profiles for identified consumers.
   *
   * Used where a relationship already exists, so eligibility for discovery no
   * longer decides visibility: somebody who has turned discoverability off does
   * not vanish from an introduction they already accepted. It is still the same
   * minimized shape — nothing about status, preference, or availability.
   */
  async profilesFor(input: {
    readonly ids: readonly string[];
    readonly viewerLanguages: readonly string[];
  }): Promise<DirectoryProfile[]> {
    if (input.ids.length === 0 || input.viewerLanguages.length === 0) return [];
    return this.database
      .select({
        bio: userProfiles.bio,
        displayName: userProfiles.displayName,
        id: userAccounts.id,
        region: userAccounts.region,
        // The join is already restricted to the viewer's languages, so the
        // aggregate needs no filter of its own. Binding the language list
        // through the query builder also keeps a single-element list a list
        // rather than a scalar.
        sharedLanguages: sql<
          string[]
        >`coalesce(array_agg(distinct ${column('users_profile_languages', 'language')}) filter (where ${column('users_profile_languages', 'language')} is not null), '{}')`.as(
          'shared_languages',
        ),
      })
      .from(userAccounts)
      .innerJoin(userProfiles, eq(userProfiles.userId, userAccounts.id))
      .leftJoin(
        userProfileLanguages,
        and(
          eq(userProfileLanguages.userId, userAccounts.id),
          inArray(userProfileLanguages.language, [...input.viewerLanguages]),
        ),
      )
      .where(inArray(userAccounts.id, [...input.ids]))
      .groupBy(
        userAccounts.id,
        userAccounts.region,
        userProfiles.displayName,
        userProfiles.bio,
      );
  }

  /**
   * The name a connected peer may render, for a set of accounts.
   *
   * Separate from {@link ConsumerDirectory.profilesFor} because that answers a
   * discovery question — what these candidates look like to a particular viewer,
   * including the language overlap that made them candidates at all. A
   * conversation asks nothing of the sort: the two people are already connected,
   * and what a client needs is a name to put above a thread. Reusing the
   * discovery shape here would have meant handing it a viewer's languages that
   * play no part in the answer.
   */
  async namesFor(ids: readonly string[]): Promise<DirectoryName[]> {
    if (ids.length === 0) return [];
    return this.database
      .select({
        displayName: userProfiles.displayName,
        id: userAccounts.id,
      })
      .from(userAccounts)
      .innerJoin(userProfiles, eq(userProfiles.userId, userAccounts.id))
      .where(inArray(userAccounts.id, [...ids]));
  }

  /**
   * Ready images for a page of candidates, in one query rather than per row.
   *
   * The identifier published is the MEDIA asset reference rather than this
   * table's own key, because a peer's only use for it is to ask the media
   * platform for an address, and the media platform has never heard of a USERS
   * slot.
   */
  async mediaFor(
    candidateIds: readonly string[],
  ): Promise<DirectoryCandidateMedia[]> {
    if (candidateIds.length === 0) return [];
    return this.database
      .select({
        id: userProfileMedia.mediaAssetId,
        position: userProfileMedia.position,
        userId: userProfileMedia.userId,
      })
      .from(userProfileMedia)
      .where(
        and(
          inArray(userProfileMedia.userId, [...candidateIds]),
          eq(userProfileMedia.state, 'attached'),
          eq(userProfileMedia.mediaReady, true),
        ),
      )
      .orderBy(asc(userProfileMedia.userId), asc(userProfileMedia.position));
  }
}
