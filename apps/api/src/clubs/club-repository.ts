import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';

import type { CatalogCursor } from './cursor.js';
import type {
  ClubLifecycle,
  MembershipSource,
  MembershipState,
} from './policy.js';
import type { ClubsDatabase, ClubsExecutor } from './repository.js';
import {
  clubBenefits,
  clubInvites,
  clubMemberships,
  clubs,
  creatorContent,
} from './schema.js';

type AnyExecutor = ClubsDatabase | ClubsExecutor;

export type ClubRow = typeof clubs.$inferSelect;
export type ClubBenefitRow = typeof clubBenefits.$inferSelect;
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

  /** One published club addressed the way a visitor types it. */
  async findPublishedClubBySlug(
    executor: AnyExecutor,
    input: { readonly creatorId: string; readonly slug: string },
  ): Promise<ClubRow | undefined> {
    const rows = await executor
      .select()
      .from(clubs)
      .where(
        and(
          eq(clubs.creatorId, input.creatorId),
          eq(clubs.slug, input.slug),
          eq(clubs.lifecycle, 'published'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  /**
   * Benefit lines for a batch of clubs, in position order.
   *
   * Batched because a creator page renders every club at once, and a list that
   * issued a query per card is the shape that looks fine with two clubs.
   */
  async benefitsFor(
    executor: AnyExecutor,
    clubIds: readonly string[],
  ): Promise<ClubBenefitRow[]> {
    if (clubIds.length === 0) return [];
    return executor
      .select()
      .from(clubBenefits)
      .where(inArray(clubBenefits.clubId, [...clubIds]))
      .orderBy(asc(clubBenefits.clubId), asc(clubBenefits.position));
  }

  /**
   * Replaces a club's benefit lines with exactly what was sent.
   *
   * Delete and insert rather than a positional merge, inside the caller's
   * transaction and behind the same optimistic version check the club row
   * takes. A merge would have to decide what an absent position means, and the
   * two plausible answers — "unchanged" and "removed" — differ by whether a
   * creator's edit silently keeps a line they deleted.
   */
  async replaceBenefits(
    executor: ClubsExecutor,
    input: { readonly clubId: string; readonly texts: readonly string[] },
  ): Promise<void> {
    await executor
      .delete(clubBenefits)
      .where(eq(clubBenefits.clubId, input.clubId));
    if (input.texts.length === 0) return;
    await executor.insert(clubBenefits).values(
      input.texts.map((text, position) => ({
        clubId: input.clubId,
        position,
        text,
      })),
    );
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

  /**
   * Every entitlement one person has ever held, for their own account view.
   *
   * Ended ones are included, because somebody is entitled to see the club they
   * used to be in — and because a subscription that has run out otherwise
   * leaves a row on their Memberships page with nothing to name it. A revoked
   * row grants no read: `readProtected` asks `findMembership`, which is live
   * only.
   *
   * The club's own lifecycle is not in the predicate either. A club that was
   * closed is still a place somebody was a member of, and hiding it would make
   * their own history depend on a creator's later decision.
   */
  async listMemberAccess(
    executor: AnyExecutor,
    input: { readonly limit: number; readonly memberId: string },
  ): Promise<{ club: ClubRow; membership: ClubMembershipRow }[]> {
    const rows = await executor
      .select({ club: clubs, membership: clubMemberships })
      .from(clubMemberships)
      .innerJoin(clubs, eq(clubs.id, clubMemberships.clubId))
      .where(eq(clubMemberships.memberId, input.memberId))
      // Live entitlements first — `active` sorts before `revoked` — then
      // newest, so somebody's own page opens on what they still hold.
      .orderBy(
        asc(clubMemberships.state),
        desc(clubMemberships.grantedAt),
        desc(clubMemberships.id),
      )
      .limit(input.limit);
    return rows;
  }

  /**
   * The live memberships this person holds among a named set of clubs.
   *
   * For a page rendering several clubs at once, so "you are already in this"
   * costs one statement rather than one per card.
   */
  async membershipsAmong(
    executor: AnyExecutor,
    input: { readonly clubIds: readonly string[]; readonly memberId: string },
  ): Promise<ClubMembershipRow[]> {
    if (input.clubIds.length === 0) return [];
    return executor
      .select()
      .from(clubMemberships)
      .where(
        and(
          inArray(clubMemberships.clubId, [...input.clubIds]),
          eq(clubMemberships.memberId, input.memberId),
          eq(clubMemberships.state, 'active'),
        ),
      );
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

  /**
   * One club's published items, newest first.
   *
   * The members-only feed. Nothing about entitlement is in this predicate on
   * purpose: whether the caller may see any of it is decided by the service
   * before this is called, and folding the two together would make the access
   * rule something a future caller could forget to pass.
   */
  async listClubContent(
    executor: AnyExecutor,
    input: {
      readonly after: CatalogCursor | undefined;
      readonly clubId: string;
      readonly limit: number;
    },
  ): Promise<(typeof creatorContent.$inferSelect)[]> {
    const after = input.after;
    return executor
      .select()
      .from(creatorContent)
      .where(
        and(
          eq(creatorContent.clubId, input.clubId),
          eq(creatorContent.lifecycle, 'published'),
          eq(creatorContent.visibility, 'members_only'),
          after === undefined
            ? undefined
            : or(
                lt(creatorContent.publishedAt, after.moment),
                and(
                  eq(creatorContent.publishedAt, after.moment),
                  lt(creatorContent.id, after.id),
                ),
              ),
        ),
      )
      .orderBy(desc(creatorContent.publishedAt), desc(creatorContent.id))
      .limit(input.limit);
  }

  /**
   * Ends one person's own membership, if it is live and theirs.
   *
   * The member is in the predicate, so a departure names a club rather than a
   * membership identifier and cannot address anybody else's. The state is in it
   * too, so leaving twice ends one membership.
   */
  async endOwnMembership(
    executor: AnyExecutor,
    input: {
      readonly clubId: string;
      readonly memberId: string;
      readonly now: Date;
      readonly source: MembershipSource;
    },
  ): Promise<ClubMembershipRow | undefined> {
    const updated = await executor
      .update(clubMemberships)
      .set({ revokedAt: input.now, state: 'revoked' })
      .where(
        and(
          eq(clubMemberships.clubId, input.clubId),
          eq(clubMemberships.memberId, input.memberId),
          eq(clubMemberships.source, input.source),
          eq(clubMemberships.state, 'active'),
        ),
      )
      .returning();
    return updated[0];
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
