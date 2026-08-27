import {
  canonicalCreatorHandle,
  clubSlugSchema,
  type ClubLifecycleValue,
  type SaveCreatorClubRequest,
} from '@velora/validation';

import type { Executor } from '../database/executor.js';
import type {
  ClubInviteRow,
  ClubMembershipRow,
  ClubRepository,
  ClubRow,
} from './club-repository.js';
import type { ContentCreatorPort } from './creators.js';
import { decodeCatalogCursor, encodeCatalogCursor } from './cursor.js';
import {
  clubInviteLifetimeMilliseconds,
  clubInviteSecretBytes,
  maximumCatalogPageSize,
} from './policy.js';
import type { CreatorContentRow } from './repository.js';

/**
 * Clubs, entitlements, and the invitations that create them.
 *
 * The rule this file exists to enforce is that access is decided at the moment
 * it is used, from current state, and never inferred from something written
 * earlier. A membership is not permission; it is one of several conditions
 * checked together every time somebody asks to read something.
 */

/**
 * Whether a consumer may still be admitted to a creator's space.
 *
 * Deliberately not "is this account fully activated". A complete discoverable
 * consumer profile is a discovery requirement, and
 * `docs/product/03-creator-private-clubs.md` keeps club access and ordinary
 * consumer discovery apart in both directions. What matters here is that the
 * person is an adult the platform recognises and is not under a restriction.
 */
export interface ClubMemberStandingPort {
  standingForUser(input: {
    readonly executor: Executor;
    readonly now: Date;
    readonly userId: string;
  }): Promise<
    | {
        readonly adultAssurance: string;
        readonly inGoodStanding: boolean;
      }
    | undefined
  >;
}

export type ClubOutcome =
  | { readonly kind: 'saved'; readonly created: boolean; readonly row: ClubRow }
  | { readonly kind: 'conflict' };

export type InviteOutcome =
  | {
      readonly kind: 'issued';
      readonly invite: ClubInviteRow;
      readonly secret: string;
    }
  | { readonly kind: 'conflict' };

export type RedemptionOutcome =
  | {
      readonly kind: 'admitted';
      readonly club: ClubRow;
      readonly membership: ClubMembershipRow;
    }
  /**
   * One outcome for an unknown secret, an expired one, one already used, one
   * that was withdrawn, a club that is not published, a creator who is not
   * active, and a consumer who may not be admitted. They are deliberately
   * indistinguishable: a redemption endpoint that told them apart would be an
   * oracle for guessing invitations.
   */
  | { readonly kind: 'refused' };

export interface ClubPage<T> {
  readonly nextCursor: string | undefined;
  readonly rows: readonly T[];
}

/** A club as a visitor's card renders it: identity, promises, and standing. */
export interface ClubPresentation {
  readonly benefits: readonly string[];
  readonly club: ClubRow;
  /** The viewer's own live entitlement, when they hold one. */
  readonly membership: ClubMembershipRow | undefined;
}

export interface ClubPresentationListing {
  readonly clubs: readonly ClubPresentation[];
  readonly handle: string;
}

export interface ClubDetail {
  readonly club: ClubPresentation;
  /** Empty for anybody the entitlement question refuses right now. */
  readonly content: readonly CreatorContentRow[];
  readonly creatorHandle: string;
  readonly nextCursor: string | undefined;
}

export interface ClubServiceDependencies {
  readonly clubs: ClubRepository;
  readonly creators: ContentCreatorPort;
  readonly now: () => Date;
  readonly standing: ClubMemberStandingPort;
}

const allowedClubTransitions: Readonly<
  Record<ClubLifecycleValue, readonly ClubLifecycleValue[]>
> = {
  // Closing is final for this milestone. Reopening a club would put people
  // back inside a space they were removed from without a fresh decision by
  // anybody, and there is no approved policy for what that means.
  closed: [],
  draft: ['published', 'closed'],
  published: ['draft', 'closed'],
};

export class ClubService {
  constructor(private readonly dependencies: ClubServiceDependencies) {}

  async listOwn(input: {
    readonly creatorId: string;
    readonly cursor: string | undefined;
    readonly pageSize: number;
  }): Promise<ClubPage<{ club: ClubRow; memberCount: number }>> {
    const { clubs } = this.dependencies;
    const size = Math.min(input.pageSize, maximumCatalogPageSize);
    const rows = await clubs.listOwnClubs(clubs.transactionless, {
      after:
        input.cursor === undefined
          ? undefined
          : decodeCatalogCursor(input.cursor),
      creatorId: input.creatorId,
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    // One count per club rather than one query per row would be the same thing
    // written twice; the page is bounded, so this is bounded with it.
    const counts = await Promise.all(
      page.map(async (club) =>
        clubs.activeMemberCount(clubs.transactionless, club.id),
      ),
    );
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.createdAt })
          : undefined,
      rows: page.map((club, index) => ({
        club,
        memberCount: counts[index] ?? 0,
      })),
    };
  }

  /**
   * Published clubs on a creator's public page, or nothing at all.
   *
   * Benefits travel with them because they are what a visitor reads before
   * deciding, and the viewer's own membership travels with them because a page
   * that offered to sell somebody what they already hold would be a page that
   * had not asked. Neither is money: what a club costs is BILLING's to publish
   * against the same identifier, through its own route.
   */
  async listPublic(input: {
    readonly handle: string;
    readonly memberId: string | undefined;
  }): Promise<ClubPresentationListing | undefined> {
    const { clubs } = this.dependencies;
    const creatorId = await this.dependencies.creators.publishedCreatorFor({
      executor: clubs.transactionless,
      handle: input.handle,
    });
    if (creatorId === undefined) return undefined;
    const rows = await clubs.listPublishedClubs(clubs.transactionless, {
      creatorId,
      limit: maximumCatalogPageSize,
    });
    return {
      clubs: await this.present({ clubs: rows, memberId: input.memberId }),
      handle: canonicalCreatorHandle(input.handle),
    };
  }

  /**
   * One club as its own destination, with its feed when the caller may read it.
   *
   * The entitlement question is asked here, on this request, against current
   * club, creator, standing and membership state — the same question
   * `readProtected` asks, for the same reason. A caller who holds nothing gets
   * the club's public identity and an empty feed, which is what makes a typed
   * address safe: there is no body, summary, or media reference in the answer
   * to fall back on.
   */
  async readClub(input: {
    readonly cursor: string | undefined;
    readonly handle: string;
    readonly memberId: string | undefined;
    readonly pageSize: number;
    readonly slug: string;
  }): Promise<ClubDetail | undefined> {
    const { clubs } = this.dependencies;
    const creatorId = await this.dependencies.creators.publishedCreatorFor({
      executor: clubs.transactionless,
      handle: input.handle,
    });
    if (creatorId === undefined) return undefined;
    const club = await clubs.findPublishedClubBySlug(clubs.transactionless, {
      creatorId,
      slug: input.slug,
    });
    if (club === undefined) return undefined;
    const [presented] = await this.present({
      clubs: [club],
      memberId: input.memberId,
    });
    if (presented === undefined) return undefined;

    const entitled =
      input.memberId !== undefined &&
      presented.membership !== undefined &&
      (await this.membershipIfPermitted({
        clubId: club.id,
        creatorId: club.creatorId,
        memberId: input.memberId,
      }));
    if (!entitled) {
      return {
        club: presented,
        content: [],
        creatorHandle: canonicalCreatorHandle(input.handle),
        nextCursor: undefined,
      };
    }
    const size = Math.min(input.pageSize, maximumCatalogPageSize);
    const rows = await clubs.listClubContent(clubs.transactionless, {
      after:
        input.cursor === undefined
          ? undefined
          : decodeCatalogCursor(input.cursor),
      clubId: club.id,
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      club: presented,
      content: page,
      creatorHandle: canonicalCreatorHandle(input.handle),
      nextCursor:
        rows.length > size && last?.publishedAt != null
          ? encodeCatalogCursor({ id: last.id, moment: last.publishedAt })
          : undefined,
    };
  }

  /**
   * Somebody hands back an invitation.
   *
   * Provenance decides what may be given back. A creator invitation is a gift
   * and ending it is the holder's own business; a commercial entitlement
   * belongs to the subscription that produced it, and revoking it here would
   * end access somebody is still paying for while leaving the money running.
   * That case is refused rather than partially honoured, and the surface sends
   * them to cancellation instead.
   */
  async leave(input: {
    readonly clubId: string;
    readonly memberId: string;
  }): Promise<{ readonly kind: 'left' | 'refused' }> {
    const { clubs } = this.dependencies;
    const ended = await clubs.endOwnMembership(clubs.transactionless, {
      clubId: input.clubId,
      memberId: input.memberId,
      now: this.dependencies.now(),
      // Named rather than read-then-written, so a membership that became
      // commercial between the read and the write is refused by the predicate
      // rather than ended by a stale decision.
      source: 'creator_invite',
    });
    return ended === undefined ? { kind: 'refused' } : { kind: 'left' };
  }

  /**
   * Club rows plus the two things a visitor's card needs.
   *
   * One statement for the benefits and one for the memberships, whatever the
   * number of clubs, because a creator page renders all of them at once.
   *
   * `membership` answers "may this person read this club right now", not "is
   * there a row". They are the same answer almost always and differ in exactly
   * the case that matters: somebody under a restriction still holds every
   * membership they held, and may read none of them. Reporting the row would
   * put "you are in this" above an empty feed, which is a surface contradicting
   * itself about a safety decision. What they hold is still theirs to see on
   * their own Memberships page, which is a different question.
   *
   * The creator side needs no check here. Every caller resolved the club
   * through CREATORS' published contract, which answers nothing for a creator
   * who is not active, so a suspended creator's clubs are already absent.
   */
  private async present(input: {
    readonly clubs: readonly ClubRow[];
    readonly memberId: string | undefined;
  }): Promise<readonly ClubPresentation[]> {
    const { clubs } = this.dependencies;
    const ids = input.clubs.map((club) => club.id);
    const admitted =
      input.memberId === undefined
        ? false
        : await this.mayBeAdmitted(input.memberId);
    const [benefits, held] = await Promise.all([
      clubs.benefitsFor(clubs.transactionless, ids),
      input.memberId === undefined || !admitted
        ? Promise.resolve([])
        : clubs.membershipsAmong(clubs.transactionless, {
            clubIds: ids,
            memberId: input.memberId,
          }),
    ]);
    const byClub = new Map(held.map((row) => [row.clubId, row]));
    return input.clubs.map((club) => ({
      benefits: benefits
        .filter((benefit) => benefit.clubId === club.id)
        .map((benefit) => benefit.text),
      club,
      membership: byClub.get(club.id),
    }));
  }

  async save(input: {
    readonly creatorId: string;
    readonly request: SaveCreatorClubRequest;
  }): Promise<ClubOutcome> {
    const { clubs } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return { kind: 'conflict' };

    const slug = input.request.slug.trim().toLowerCase();
    if (!clubSlugSchema.safeParse(slug).success) return { kind: 'conflict' };
    const description = input.request.description ?? null;
    const now = this.dependencies.now();

    // The benefit lines and the club row move together or not at all. A club
    // whose name was accepted and whose promises were not is a club that says
    // something its creator did not mean, and the optimistic version check is
    // only meaningful if everything it guards commits with it.
    const benefits = input.request.benefits;
    if (input.request.clubId === undefined) {
      if (input.request.version !== undefined) return { kind: 'conflict' };
      return clubs.transaction(async (executor) => {
        const row = await clubs.insertClub(executor, {
          creatorId: input.creatorId,
          description,
          name: input.request.name,
          now,
          slug,
        });
        if (row === undefined) return { kind: 'conflict' };
        if (benefits !== undefined) {
          await clubs.replaceBenefits(executor, {
            clubId: row.id,
            texts: benefits,
          });
        }
        return { created: true, kind: 'saved', row };
      });
    }
    const clubId = input.request.clubId;
    const expectedVersion = input.request.version;
    if (expectedVersion === undefined) return { kind: 'conflict' };

    return clubs.transaction(async (executor) => {
      // No rename in this milestone, for the same reason a creator handle has
      // none: a slug already appears in links people hold.
      const existing = await clubs.findOwnClub(executor, {
        clubId,
        creatorId: input.creatorId,
      });
      if (existing?.slug !== slug) return { kind: 'conflict' };

      const row = await clubs.updateClub(executor, {
        clubId,
        creatorId: input.creatorId,
        description,
        expectedVersion,
        name: input.request.name,
        now,
      });
      if (row === undefined) return { kind: 'conflict' };
      // Absent means unchanged. A creator surface that has no benefit editor
      // yet must not be able to erase what another one wrote by omitting a
      // field it never knew about.
      if (benefits !== undefined) {
        await clubs.replaceBenefits(executor, { clubId, texts: benefits });
      }
      return { created: false, kind: 'saved', row };
    });
  }

  /** Live members of one club, for a response that has just changed it. */
  async memberCount(clubId: string): Promise<number> {
    const { clubs } = this.dependencies;
    return clubs.activeMemberCount(clubs.transactionless, clubId);
  }

  /** Benefit lines for a creator's own clubs, for the Studio list. */
  async benefitsFor(
    clubIds: readonly string[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const { clubs } = this.dependencies;
    const rows = await clubs.benefitsFor(clubs.transactionless, clubIds);
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const lines = grouped.get(row.clubId) ?? [];
      lines.push(row.text);
      grouped.set(row.clubId, lines);
    }
    return grouped;
  }

  async setLifecycle(input: {
    readonly clubId: string;
    readonly creatorId: string;
    readonly lifecycle: ClubLifecycleValue;
    readonly version: number;
  }): Promise<ClubOutcome> {
    const { clubs } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return { kind: 'conflict' };

    const current = await clubs.findOwnClub(clubs.transactionless, {
      clubId: input.clubId,
      creatorId: input.creatorId,
    });
    if (current === undefined) return { kind: 'conflict' };
    if (!allowedClubTransitions[current.lifecycle].includes(input.lifecycle)) {
      return { kind: 'conflict' };
    }

    const row = await clubs.transitionClub(clubs.transactionless, {
      clubId: input.clubId,
      creatorId: input.creatorId,
      expectedVersion: input.version,
      lifecycle: input.lifecycle,
      now: this.dependencies.now(),
    });
    return row === undefined
      ? { kind: 'conflict' }
      : { created: false, kind: 'saved', row };
  }

  /**
   * Issues one complimentary invitation.
   *
   * The secret is generated here, returned once, and stored only as a digest.
   * It is high-entropy random rather than derived from anything, so there is
   * nothing to guess and nothing about the club or the creator to learn from
   * holding one.
   */
  async issueInvite(input: {
    readonly clubId: string;
    readonly creatorId: string;
  }): Promise<InviteOutcome> {
    const { clubs } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return { kind: 'conflict' };
    const club = await clubs.findOwnClub(clubs.transactionless, {
      clubId: input.clubId,
      creatorId: input.creatorId,
    });
    // Only a published club admits anybody, so only a published club may hand
    // out a key to itself.
    if (club?.lifecycle !== 'published') return { kind: 'conflict' };

    const secret = Buffer.from(
      crypto.getRandomValues(new Uint8Array(clubInviteSecretBytes)),
    ).toString('base64url');
    const now = this.dependencies.now();
    const invite = await clubs.insertInvite(clubs.transactionless, {
      clubId: input.clubId,
      expiresAt: new Date(now.getTime() + clubInviteLifetimeMilliseconds),
      now,
      tokenDigest: digestSecret(secret),
    });
    return { invite, kind: 'issued', secret };
  }

  async listInvites(input: {
    readonly clubId: string;
    readonly creatorId: string;
  }): Promise<readonly ClubInviteRow[] | undefined> {
    const { clubs } = this.dependencies;
    const club = await clubs.findOwnClub(clubs.transactionless, {
      clubId: input.clubId,
      creatorId: input.creatorId,
    });
    if (club === undefined) return undefined;
    return clubs.listInvites(clubs.transactionless, {
      clubId: input.clubId,
      limit: maximumCatalogPageSize,
    });
  }

  async revokeInvite(input: {
    readonly clubId: string;
    readonly creatorId: string;
    readonly inviteId: string;
  }): Promise<boolean> {
    const { clubs } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return false;
    const club = await clubs.findOwnClub(clubs.transactionless, {
      clubId: input.clubId,
      creatorId: input.creatorId,
    });
    if (club === undefined) return false;
    const revoked = await clubs.revokeInvite(clubs.transactionless, {
      clubId: input.clubId,
      inviteId: input.inviteId,
      now: this.dependencies.now(),
    });
    return revoked !== undefined;
  }

  async listMemberships(input: {
    readonly clubId: string;
    readonly creatorId: string;
    readonly cursor: string | undefined;
    readonly pageSize: number;
  }): Promise<ClubPage<ClubMembershipRow> | undefined> {
    const { clubs } = this.dependencies;
    const club = await clubs.findOwnClub(clubs.transactionless, {
      clubId: input.clubId,
      creatorId: input.creatorId,
    });
    if (club === undefined) return undefined;
    const size = Math.min(input.pageSize, maximumCatalogPageSize);
    const rows = await clubs.listMemberships(clubs.transactionless, {
      after:
        input.cursor === undefined
          ? undefined
          : decodeCatalogCursor(input.cursor),
      clubId: input.clubId,
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    const last = page.at(-1);
    return {
      nextCursor:
        rows.length > size && last !== undefined
          ? encodeCatalogCursor({ id: last.id, moment: last.grantedAt })
          : undefined,
      rows: page,
    };
  }

  /**
   * Withdraws one entitlement.
   *
   * It takes effect on the next protected read rather than on a schedule,
   * because the read asks whether the membership is live rather than trusting
   * something computed when it was granted.
   */
  async revokeMembership(input: {
    readonly clubId: string;
    readonly creatorId: string;
    readonly membershipId: string;
  }): Promise<boolean> {
    const { clubs } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return false;
    const club = await clubs.findOwnClub(clubs.transactionless, {
      clubId: input.clubId,
      creatorId: input.creatorId,
    });
    if (club === undefined) return false;
    const memberships = await clubs.listMemberships(clubs.transactionless, {
      after: undefined,
      clubId: input.clubId,
      limit: maximumCatalogPageSize,
    });
    // The membership has to belong to this club, which the creator owns. A
    // membership identifier from elsewhere is answered as if it did not exist.
    if (!memberships.some((row) => row.id === input.membershipId)) return false;
    const revoked = await clubs.revokeMembership(clubs.transactionless, {
      membershipId: input.membershipId,
      now: this.dependencies.now(),
      state: 'revoked',
    });
    return revoked !== undefined;
  }

  /**
   * Redeems one invitation for one consumer.
   *
   * The claim happens first and atomically, so a secret presented ten times at
   * once is used once. Everything the claim cannot express — the club still
   * being published, the creator still being active, the consumer still being
   * in good standing — is checked after it, and a failure releases the claim
   * rather than consuming somebody's invitation on a condition they could fix.
   */
  async redeem(input: {
    readonly memberId: string;
    readonly secret: string;
  }): Promise<RedemptionOutcome> {
    const { clubs } = this.dependencies;
    const now = this.dependencies.now();
    const invite = await clubs.claimInvite(clubs.transactionless, {
      memberId: input.memberId,
      now,
      tokenDigest: digestSecret(input.secret),
    });
    if (invite === undefined) return { kind: 'refused' };

    const club = await clubs.findClub(clubs.transactionless, invite.clubId);
    if (club === undefined) {
      await clubs.releaseInvite(clubs.transactionless, invite.id);
      return { kind: 'refused' };
    }
    const admissible =
      club.lifecycle === 'published' &&
      (await this.dependencies.creators.mayOperate({
        creatorId: club.creatorId,
        executor: clubs.transactionless,
      })) &&
      (await this.mayBeAdmitted(input.memberId));
    if (!admissible) {
      // The claim is released rather than spent. A club that was unpublished a
      // second ago, or an account restricted a second ago, is a condition the
      // person may not even know about — consuming their invitation for it
      // would be charging them for somebody else's decision.
      await clubs.releaseInvite(clubs.transactionless, invite.id);
      return { kind: 'refused' };
    }

    const membership = await clubs.insertMembership(clubs.transactionless, {
      clubId: club.id,
      memberId: input.memberId,
      now,
      source: 'creator_invite',
    });
    if (membership !== undefined) {
      return { club, kind: 'admitted', membership };
    }
    // Already a member. The invitation is spent either way — it did admit this
    // person, just not for the first time — and the existing entitlement is the
    // honest answer rather than a second one.
    const existing = await clubs.findMembership(clubs.transactionless, {
      clubId: club.id,
      memberId: input.memberId,
    });
    return existing === undefined
      ? { kind: 'refused' }
      : { club, kind: 'admitted', membership: existing };
  }

  /**
   * Every live entitlement one person holds, with somewhere to go for each.
   *
   * The creator handle comes from CREATORS' published contract rather than a
   * join, because the handle is theirs to publish. An entitlement whose creator
   * has withdrawn their public page is omitted: it still exists and still
   * admits the person to protected reads, but there is no page to point at.
   */
  async listAccess(memberId: string): Promise<
    readonly {
      readonly club: ClubRow;
      readonly creatorHandle: string;
      readonly membership: ClubMembershipRow;
    }[]
  > {
    const { clubs } = this.dependencies;
    const held = await clubs.listMemberAccess(clubs.transactionless, {
      limit: maximumCatalogPageSize,
      memberId,
    });
    const handles = await this.dependencies.creators.handlesFor({
      creatorIds: [...new Set(held.map((entry) => entry.club.creatorId))],
      executor: clubs.transactionless,
    });
    return held.flatMap((entry) => {
      const creatorHandle = handles.get(entry.club.creatorId);
      return creatorHandle === undefined
        ? []
        : [{ club: entry.club, creatorHandle, membership: entry.membership }];
    });
  }

  /**
   * One protected item, if this person may read it right now.
   *
   * Every condition is asked at this moment: the item is published and scoped
   * to a club, the club is published, the creator is active, the consumer is in
   * good standing, and the entitlement is live. Nothing here consults a cached
   * decision, because a cached decision is exactly how a revoked member keeps
   * reading.
   */
  async readProtected(input: {
    readonly contentId: string;
    readonly memberId: string;
  }): Promise<CreatorContentRow | undefined> {
    const { clubs } = this.dependencies;
    const found = await clubs.findClubContent(
      clubs.transactionless,
      input.contentId,
    );
    if (found === undefined) return undefined;
    if (found.content.lifecycle !== 'published') return undefined;
    if (found.club.lifecycle !== 'published') return undefined;

    const membership = await this.membershipIfPermitted({
      clubId: found.club.id,
      creatorId: found.club.creatorId,
      memberId: input.memberId,
    });
    return membership ? found.content : undefined;
  }

  /** Every access condition asked together, at the moment of the read. */
  private async membershipIfPermitted(input: {
    readonly clubId: string;
    readonly creatorId: string;
    readonly memberId: string;
  }): Promise<boolean> {
    const { clubs } = this.dependencies;
    if (!(await this.mayOperate(input.creatorId))) return false;
    if (!(await this.mayBeAdmitted(input.memberId))) return false;
    const membership = await clubs.findMembership(clubs.transactionless, {
      clubId: input.clubId,
      memberId: input.memberId,
    });
    return membership !== undefined;
  }

  /**
   * Whether this consumer may be admitted right now.
   *
   * Adult assurance is required because a creator space is an adults-only part
   * of an adults-only platform, and good standing because a restriction has to
   * mean something everywhere. Fail closed: an account nobody can find is not
   * admitted.
   */
  private async mayBeAdmitted(memberId: string): Promise<boolean> {
    const standing = await this.dependencies.standing.standingForUser({
      executor: this.dependencies.clubs.transactionless,
      now: this.dependencies.now(),
      userId: memberId,
    });
    return (
      standing !== undefined &&
      standing.inGoodStanding &&
      standing.adultAssurance !== 'none'
    );
  }

  private async mayOperate(creatorId: string): Promise<boolean> {
    return this.dependencies.creators.mayOperate({
      creatorId,
      executor: this.dependencies.clubs.transactionless,
    });
  }
}

/**
 * The digest an invitation is stored and compared as.
 *
 * SHA-256 rather than a password hash, deliberately: the secret is 256 bits of
 * server-generated randomness with no structure to guess, so there is no
 * dictionary for work factors to slow down, and a slow hash on a redemption
 * path would only make the endpoint easier to exhaust.
 */
function digestSecret(secret: string): string {
  return Bun.SHA256.hash(secret, 'hex');
}
