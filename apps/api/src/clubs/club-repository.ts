import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import type { CatalogCursor } from './cursor.js';
import type {
  ClubLifecycle,
  MembershipSource,
  MembershipState,
} from './policy.js';
import type { ClubsDatabase, ClubsExecutor } from './repository.js';
import {
  clubInvites,
  clubMemberships,
  clubs,
  creatorContent,
} from './schema.js';

type AnyExecutor = ClubsDatabase | ClubsExecutor;

export type ClubRow = typeof clubs.$inferSelect;
export type ClubMembershipRow = typeof clubMemberships.$inferSelect;
export type ClubInviteRow = typeof clubInvites.$inferSelect;

/**
 * Clubs, the entitlements that admit people to them, and the invitations that
 * create those entitlements.
 *
 * Every read that could reach somebody else's club puts the creator in the
 * predicate, and every write that changes access names the state it expects.
 * Redemption in particular is settled by the database rather than by a read: a
 * secret that two people present at the same instant produces one membership
 * because one update matches and the other does not.
 */
export class ClubRepository {
  constructor(private readonly database: ClubsDatabase) {}

  get transactionless(): ClubsDatabase {
    return this.database;
  }

  transaction<T>(work: (executor: ClubsExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }

  async findOwnClub(
    executor: AnyExecutor,
    input: { readonly clubId: string; readonly creatorId: string },
  ): Promise<ClubRow | undefined> {
    const rows = await executor
      .select()
      .from(clubs)
      .where(
        and(eq(clubs.id, input.clubId), eq(clubs.creatorId, input.creatorId)),
      )
      .limit(1);
    return rows[0];
  }

  async findClub(
    executor: AnyExecutor,
    clubId: string,
  ): Promise<ClubRow | undefined> {
    const rows = await executor
      .select()
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);
    return rows[0];
  }

  async listOwnClubs(
    executor: AnyExecutor,
    input: {
      readonly after: CatalogCursor | undefined;
      readonly creatorId: string;
      readonly limit: number;
    },
  ): Promise<ClubRow[]> {
    const after = input.after;
    return executor
      .select()
      .from(clubs)
      .where(
        and(
          eq(clubs.creatorId, input.creatorId),
          after === undefined
            ? undefined
            : or(
                lt(clubs.createdAt, after.moment),
                and(eq(clubs.createdAt, after.moment), lt(clubs.id, after.id)),
              ),
        ),
      )
      .orderBy(desc(clubs.createdAt), desc(clubs.id))
      .limit(input.limit);
  }

  /** Published clubs for one creator, which is all a visitor may see. */
  async listPublishedClubs(
    executor: AnyExecutor,
    input: { readonly creatorId: string; readonly limit: number },
  ): Promise<ClubRow[]> {
    return executor
      .select()
      .from(clubs)
      .where(
        and(
          eq(clubs.creatorId, input.creatorId),
          eq(clubs.lifecycle, 'published'),
        ),
      )
      .orderBy(asc(clubs.slug))
      .limit(input.limit);
  }

  /**
   * Creates a club, or reports that the slug is taken within this creator.
   *
   * The unique index decides a contested slug; the conflict clause is what
   * turns losing that race into an ordinary answer rather than an error.
   */
  async insertClub(
    executor: AnyExecutor,
    input: {
      readonly creatorId: string;
      readonly description: string | null;
      readonly name: string;
      readonly now: Date;
      readonly slug: string;
    },
  ): Promise<ClubRow | undefined> {
    const inserted = await executor
      .insert(clubs)
      .values({
        createdAt: input.now,
        creatorId: input.creatorId,
        description: input.description,
        id: crypto.randomUUID(),
        lifecycle: 'draft',
        name: input.name,
        slug: input.slug,
        updatedAt: input.now,
        version: 1,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  async updateClub(
    executor: AnyExecutor,
    input: {
      readonly clubId: string;
      readonly creatorId: string;
      readonly description: string | null;
      readonly expectedVersion: number;
      readonly name: string;
      readonly now: Date;
    },
  ): Promise<ClubRow | undefined> {
    const updated = await executor
      .update(clubs)
      .set({
        description: input.description,
        name: input.name,
        updatedAt: input.now,
        version: sql`${clubs.version} + 1`,
      })
      .where(
        and(
          eq(clubs.id, input.clubId),
          eq(clubs.creatorId, input.creatorId),
          eq(clubs.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  async transitionClub(
    executor: AnyExecutor,
    input: {
      readonly clubId: string;
      readonly creatorId: string;
      readonly expectedVersion: number;
      readonly lifecycle: ClubLifecycle;
      readonly now: Date;
    },
  ): Promise<ClubRow | undefined> {
    const updated = await executor
      .update(clubs)
      .set({
        closedAt: input.lifecycle === 'closed' ? input.now : null,
        lifecycle: input.lifecycle,
        publishedAt: input.lifecycle === 'published' ? input.now : null,
        updatedAt: input.now,
        version: sql`${clubs.version} + 1`,
      })
      .where(
        and(
          eq(clubs.id, input.clubId),
          eq(clubs.creatorId, input.creatorId),
          eq(clubs.version, input.expectedVersion),
        ),
      )
      .returning();
    return updated[0];
  }

  /** Live members of one club. Computed on demand; never a stored counter. */
  async activeMemberCount(
    executor: AnyExecutor,
    clubId: string,
  ): Promise<number> {
    const rows = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(clubMemberships)
      .where(
        and(
          eq(clubMemberships.clubId, clubId),
          eq(clubMemberships.state, 'active'),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  async listMemberships(
    executor: AnyExecutor,
    input: {
      readonly after: CatalogCursor | undefined;
      readonly clubId: string;
      readonly limit: number;
    },
  ): Promise<ClubMembershipRow[]> {
    const after = input.after;
    return executor
      .select()
      .from(clubMemberships)
      .where(
        and(
          eq(clubMemberships.clubId, input.clubId),
          after === undefined
            ? undefined
            : or(
                lt(clubMemberships.grantedAt, after.moment),
                and(
                  eq(clubMemberships.grantedAt, after.moment),
                  lt(clubMemberships.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(clubMemberships.grantedAt), desc(clubMemberships.id))
      .limit(input.limit);
  }

  async findMembership(
    executor: AnyExecutor,
    input: { readonly clubId: string; readonly memberId: string },
  ): Promise<ClubMembershipRow | undefined> {
    const rows = await executor
      .select()
      .from(clubMemberships)
      .where(
        and(
          eq(clubMemberships.clubId, input.clubId),
          eq(clubMemberships.memberId, input.memberId),
          eq(clubMemberships.state, 'active'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /** One entitlement by identifier, for an operator acting on a named one. */
  async findMembershipById(
    executor: AnyExecutor,
    membershipId: string,
  ): Promise<ClubMembershipRow | undefined> {
    const rows = await executor
      .select()
      .from(clubMemberships)
      .where(eq(clubMemberships.id, membershipId))
      .limit(1);
    return rows[0];
  }

  /** Every live entitlement one person holds, for their own account view. */
  async listMemberAccess(
    executor: AnyExecutor,
    input: { readonly limit: number; readonly memberId: string },
  ): Promise<{ club: ClubRow; membership: ClubMembershipRow }[]> {
    const rows = await executor
      .select({ club: clubs, membership: clubMemberships })
      .from(clubMemberships)
      .innerJoin(clubs, eq(clubs.id, clubMemberships.clubId))
      .where(
        and(
          eq(clubMemberships.memberId, input.memberId),
          eq(clubMemberships.state, 'active'),
          eq(clubs.lifecycle, 'published'),
        ),
      )
      .orderBy(desc(clubMemberships.grantedAt))
      .limit(input.limit);
    return rows;
  }

  /**
   * Admits one person to one club, or returns nothing when they already hold a
   * live entitlement.
   *
   * The partial unique index is what makes a duplicate grant a no-op rather
   * than a second row: two callers granting the same person at once both
   * insert, and one is discarded by the conflict clause.
   */
  async insertMembership(
    executor: AnyExecutor,
    input: {
      readonly clubId: string;
      readonly memberId: string;
      readonly now: Date;
      readonly source: MembershipSource;
    },
  ): Promise<ClubMembershipRow | undefined> {
    const inserted = await executor
      .insert(clubMemberships)
      .values({
        clubId: input.clubId,
        grantedAt: input.now,
        id: crypto.randomUUID(),
        memberId: input.memberId,
        source: input.source,
        state: 'active',
        updatedAt: input.now,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0];
  }

  /**
   * Ends one entitlement.
   *
   * The state predicate makes revocation idempotent: a second revocation of the
   * same membership changes nothing and cannot rewrite when the first happened.
   */
  async revokeMembership(
    executor: AnyExecutor,
    input: {
      readonly membershipId: string;
      readonly now: Date;
      readonly state: MembershipState;
    },
  ): Promise<ClubMembershipRow | undefined> {
    const updated = await executor
      .update(clubMemberships)
      .set({
        revokedAt: input.now,
        state: input.state,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(clubMemberships.id, input.membershipId),
          eq(clubMemberships.state, 'active'),
        ),
      )
      .returning();
    return updated[0];
  }

  async insertInvite(
    executor: AnyExecutor,
    input: {
      readonly clubId: string;
      readonly expiresAt: Date;
      readonly now: Date;
      readonly tokenDigest: string;
    },
  ): Promise<ClubInviteRow> {
    const inserted = await executor
      .insert(clubInvites)
      .values({
        clubId: input.clubId,
        createdAt: input.now,
        expiresAt: input.expiresAt,
        id: crypto.randomUUID(),
        tokenDigest: input.tokenDigest,
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) throw new Error('Invite insert returned no row');
    return row;
  }

  async listInvites(
    executor: AnyExecutor,
    input: { readonly clubId: string; readonly limit: number },
  ): Promise<ClubInviteRow[]> {
    return executor
      .select()
      .from(clubInvites)
      .where(eq(clubInvites.clubId, input.clubId))
      .orderBy(desc(clubInvites.createdAt), desc(clubInvites.id))
      .limit(input.limit);
  }

  /** Withdraws an unused invitation. A redeemed one is left exactly as it is. */
  async revokeInvite(
    executor: AnyExecutor,
    input: {
      readonly clubId: string;
      readonly inviteId: string;
      readonly now: Date;
    },
  ): Promise<ClubInviteRow | undefined> {
    const updated = await executor
      .update(clubInvites)
      .set({ revokedAt: input.now })
      .where(
        and(
          eq(clubInvites.id, input.inviteId),
          eq(clubInvites.clubId, input.clubId),
          isNull(clubInvites.redeemedAt),
          isNull(clubInvites.revokedAt),
        ),
      )
      .returning();
    return updated[0];
  }

  /**
   * Claims one invitation for one person, atomically.
   *
   * The predicate is the whole redemption rule: this digest, not already
   * redeemed, not revoked, not expired. Ten callers presenting the same secret
   * at once all run this update; PostgreSQL serializes them and exactly one
   * finds the row still unredeemed, so replay is settled by the database rather
   * than by a read the callers could interleave around.
   */
  async claimInvite(
    executor: AnyExecutor,
    input: {
      readonly memberId: string;
      readonly now: Date;
      readonly tokenDigest: string;
    },
  ): Promise<ClubInviteRow | undefined> {
    const claimed = await executor
      .update(clubInvites)
      .set({ redeemedAt: input.now, redeemedBy: input.memberId })
      .where(
        and(
          eq(clubInvites.tokenDigest, input.tokenDigest),
          isNull(clubInvites.redeemedAt),
          isNull(clubInvites.revokedAt),
          sql`${clubInvites.expiresAt} > ${input.now}`,
        ),
      )
      .returning();
    return claimed[0];
  }

  /** Releases a claim whose admission could not be completed. */
  async releaseInvite(executor: AnyExecutor, inviteId: string): Promise<void> {
    await executor
      .update(clubInvites)
      .set({ redeemedAt: null, redeemedBy: null })
      .where(eq(clubInvites.id, inviteId));
  }

  /** One club-scoped item, with the club it belongs to, for a protected read. */
  async findClubContent(
    executor: AnyExecutor,
    contentId: string,
  ): Promise<
    { club: ClubRow; content: typeof creatorContent.$inferSelect } | undefined
  > {
    const rows = await executor
      .select({ club: clubs, content: creatorContent })
      .from(creatorContent)
      .innerJoin(clubs, eq(clubs.id, creatorContent.clubId))
      .where(eq(creatorContent.id, contentId))
      .limit(1);
    return rows[0];
  }
}
