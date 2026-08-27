import {
  clubAccessListResponseSchema,
  clubDetailResponseSchema,
  clubIdSchema,
  clubInviteIssuedResponseSchema,
  clubInviteListResponseSchema,
  clubLifecycleRequestSchema,
  clubMembershipListResponseSchema,
  clubSlugSchema,
  contentIdSchema,
  creatorClubListResponseSchema,
  creatorHandleSchema,
  defaultPageSize,
  issueClubInviteRequestSchema,
  leaveClubRequestSchema,
  pageSizeSchema,
  productErrorCodes,
  publicClubListResponseSchema,
  redeemClubInviteRequestSchema,
  revokeClubInviteRequestSchema,
  revokeClubMembershipRequestSchema,
  saveCreatorClubRequestSchema,
} from '@velora/validation';

import {
  requireConsumerAccount,
  type ConsumerContextResolver,
} from '../users/context.js';
import {
  requireCreator,
  type CreatorContextResolver,
} from '../creators/context.js';
import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type {
  ClubInviteRow,
  ClubMembershipRow,
  ClubRow,
} from './club-repository.js';
import type { ClubPresentation, ClubService } from './club-service.js';
import type { ContentMediaService } from './content-media.js';
import type { CreatorContentRow } from './repository.js';

function clubBody(
  club: ClubRow,
  memberCount: number,
  benefits: readonly string[],
) {
  return {
    benefits: [...benefits],
    createdAt: club.createdAt.toISOString(),
    ...(club.description === null ? {} : { description: club.description }),
    id: club.id,
    lifecycle: club.lifecycle,
    memberCount,
    name: club.name,
    ...(club.publishedAt === null
      ? {}
      : { publishedAt: club.publishedAt.toISOString() }),
    slug: club.slug,
    updatedAt: club.updatedAt.toISOString(),
    version: club.version,
  };
}

/**
 * A club as a visitor sees it.
 *
 * An allow-list, not a filtered record. No lifecycle, no member count, no
 * version, no creator identifier, and no price — a visitor learns what the club
 * is, what its creator promises, and whether they are already in it.
 */
function publicClubBody(presented: ClubPresentation) {
  const { club } = presented;
  return {
    benefits: [...presented.benefits],
    ...(club.description === null ? {} : { description: club.description }),
    id: club.id,
    ...(presented.membership === undefined
      ? {}
      : {
          membership: {
            grantedAt: presented.membership.grantedAt.toISOString(),
            source: presented.membership.source,
          },
        }),
    name: club.name,
    slug: club.slug,
  };
}

/**
 * A membership as its creator may see it.
 *
 * No member identifier, no name, no contact detail, no behaviour. The
 * membership identifier is the handle for withdrawing access and says nothing
 * about who holds it.
 */
function membershipBody(row: ClubMembershipRow) {
  return {
    clubId: row.clubId,
    grantedAt: row.grantedAt.toISOString(),
    id: row.id,
    ...(row.revokedAt === null
      ? {}
      : { revokedAt: row.revokedAt.toISOString() }),
    source: row.source,
    state: row.state,
  };
}

/** An invitation record, which never carries the secret. */
function inviteBody(row: ClubInviteRow) {
  return {
    clubId: row.clubId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    id: row.id,
    ...(row.redeemedAt === null
      ? {}
      : { redeemedAt: row.redeemedAt.toISOString() }),
    ...(row.revokedAt === null
      ? {}
      : { revokedAt: row.revokedAt.toISOString() }),
  };
}

function contentBody(row: CreatorContentRow) {
  return {
    ...(row.archivedAt === null
      ? {}
      : { archivedAt: row.archivedAt.toISOString() }),
    ...(row.body === null ? {} : { body: row.body }),
    ...(row.clubId === null ? {} : { clubId: row.clubId }),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    lifecycle: row.lifecycle,
    ...(row.publishedAt === null
      ? {}
      : { publishedAt: row.publishedAt.toISOString() }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    visibility: row.visibility,
  };
}

function readPageSize(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get('pageSize');
  if (raw === null) return defaultPageSize;
  const parsed = pageSizeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function readClubId(request: Request): string | undefined {
  const raw = new URL(request.url).searchParams.get('clubId');
  if (raw === null) return undefined;
  const parsed = clubIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export interface ClubRoutesDependencies {
  readonly consumerContext: ConsumerContextResolver;
  readonly creatorContext: CreatorContextResolver;
  readonly media: ContentMediaService;
  readonly service: ClubService;
}

/**
 * Club, invitation, membership, and protected-read handlers.
 *
 * Two audiences meet here and stay apart. A creator operates their own clubs
 * through Creator Studio; a member redeems an invitation and reads what it
 * admits them to through a consumer surface. Neither resolver will answer for
 * the other, so a creator session cannot redeem and a consumer session cannot
 * administer.
 */
export class ClubRoutes {
  constructor(private readonly dependencies: ClubRoutesDependencies) {}

  async listClubs(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const pageSize = readPageSize(input.request);
    if (pageSize === undefined) return this.invalid(input);
    const page = await this.dependencies.service.listOwn({
      creatorId: resolved.context.creatorId,
      cursor:
        new URL(input.request.url).searchParams.get('cursor') ?? undefined,
      pageSize,
    });
    const benefits = await this.dependencies.service.benefitsFor(
      page.rows.map((entry) => entry.club.id),
    );
    return {
      body: creatorClubListResponseSchema.parse({
        clubs: page.rows.map((entry) =>
          clubBody(
            entry.club,
            entry.memberCount,
            benefits.get(entry.club.id) ?? [],
          ),
        ),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      }),
      status: 200,
    };
  }

  async saveClub(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(saveCreatorClubRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.service.save({
      creatorId: resolved.context.creatorId,
      request: parsed.value,
    });
    if (outcome.kind === 'conflict') return this.conflict(input);
    const benefits = await this.dependencies.service.benefitsFor([
      outcome.row.id,
    ]);
    return {
      body: creatorClubListResponseSchema.parse({
        clubs: [
          clubBody(
            outcome.row,
            outcome.created
              ? 0
              : await this.dependencies.service.memberCount(outcome.row.id),
            benefits.get(outcome.row.id) ?? [],
          ),
        ],
      }),
      status: outcome.created ? 201 : 200,
    };
  }

  async setClubLifecycle(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(clubLifecycleRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.service.setLifecycle({
      clubId: parsed.value.clubId,
      creatorId: resolved.context.creatorId,
      lifecycle: parsed.value.lifecycle,
      version: parsed.value.version,
    });
    if (outcome.kind === 'conflict') return this.conflict(input);
    return {
      body: creatorClubListResponseSchema.parse({
        clubs: [
          clubBody(
            outcome.row,
            await this.dependencies.service.memberCount(outcome.row.id),
            (await this.dependencies.service.benefitsFor([outcome.row.id])).get(
              outcome.row.id,
            ) ?? [],
          ),
        ],
      }),
      status: 200,
    };
  }

  async listInvites(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const clubId = readClubId(input.request);
    if (clubId === undefined) return this.notFound(input);
    const invites = await this.dependencies.service.listInvites({
      clubId,
      creatorId: resolved.context.creatorId,
    });
    if (invites === undefined) return this.notFound(input);
    return {
      body: clubInviteListResponseSchema.parse({
        invites: invites.map((row) => inviteBody(row)),
      }),
      status: 200,
    };
  }

  /**
   * Issues one invitation and returns its secret exactly once.
   *
   * The secret is in this response and in no stored row. A creator who loses it
   * issues another; nobody, including an operator with database access, can
   * recover this one.
   */
  async issueInvite(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(issueClubInviteRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.service.issueInvite({
      clubId: parsed.value.clubId,
      creatorId: resolved.context.creatorId,
    });
    if (outcome.kind === 'conflict') return this.conflict(input);
    return {
      body: clubInviteIssuedResponseSchema.parse({
        invite: inviteBody(outcome.invite),
        secret: outcome.secret,
      }),
      status: 201,
    };
  }

  async revokeInvite(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(revokeClubInviteRequestSchema, input.body);
    const clubId = readClubId(input.request);
    if (!parsed.ok || clubId === undefined) return this.invalid(input);

    const revoked = await this.dependencies.service.revokeInvite({
      clubId,
      creatorId: resolved.context.creatorId,
      inviteId: parsed.value.inviteId,
    });
    if (!revoked) return this.conflict(input);
    const invites = await this.dependencies.service.listInvites({
      clubId,
      creatorId: resolved.context.creatorId,
    });
    return {
      body: clubInviteListResponseSchema.parse({
        invites: (invites ?? []).map((row) => inviteBody(row)),
      }),
      status: 200,
    };
  }

  async listMemberships(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const clubId = readClubId(input.request);
    const pageSize = readPageSize(input.request);
    if (clubId === undefined || pageSize === undefined) {
      return this.notFound(input);
    }
    const page = await this.dependencies.service.listMemberships({
      clubId,
      creatorId: resolved.context.creatorId,
      cursor:
        new URL(input.request.url).searchParams.get('cursor') ?? undefined,
      pageSize,
    });
    if (page === undefined) return this.notFound(input);
    return {
      body: clubMembershipListResponseSchema.parse({
        memberships: page.rows.map((row) => membershipBody(row)),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      }),
      status: 200,
    };
  }

  async revokeMembership(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      revokeClubMembershipRequestSchema,
      input.body,
    );
    const clubId = readClubId(input.request);
    if (!parsed.ok || clubId === undefined) return this.invalid(input);

    const revoked = await this.dependencies.service.revokeMembership({
      clubId,
      creatorId: resolved.context.creatorId,
      membershipId: parsed.value.membershipId,
    });
    if (!revoked) return this.conflict(input);
    const page = await this.dependencies.service.listMemberships({
      clubId,
      creatorId: resolved.context.creatorId,
      cursor: undefined,
      pageSize: defaultPageSize,
    });
    return {
      body: clubMembershipListResponseSchema.parse({
        memberships: (page?.rows ?? []).map((row) => membershipBody(row)),
      }),
      status: 200,
    };
  }

  /** Redeems an invitation as the acting consumer. */
  async redeem(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(redeemClubInviteRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.service.redeem({
      memberId: resolved.context.userId,
      secret: parsed.value.secret,
    });
    if (outcome.kind === 'refused') {
      return routeFailure(
        409,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }
    return this.accessResult(resolved.context.userId);
  }

  async listAccess(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    return this.accessResult(resolved.context.userId);
  }

  /** One protected item, or the same answer as one that does not exist. */
  async getClubContent(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const raw = new URL(input.request.url).searchParams.get('contentId');
    const parsed = raw === null ? undefined : contentIdSchema.safeParse(raw);
    if (parsed?.success !== true) return this.notFound(input);

    const row = await this.dependencies.service.readProtected({
      contentId: parsed.data,
      memberId: resolved.context.userId,
    });
    if (row === undefined) return this.notFound(input);
    return {
      body: { content: [contentBody(row)] },
      status: 200,
    };
  }

  /**
   * Published clubs on a creator's public page.
   *
   * Open to a caller with no credential, because a creator page is public. A
   * session adds exactly one thing — whether this viewer already holds each
   * club — and it comes from the session rather than from anything in the
   * request, because a parameter naming a member would be a way to ask about
   * somebody else.
   */
  async getPublicClubs(input: RouteRequest): Promise<RouteResult> {
    const handle = new URL(input.request.url).searchParams.get('handle');
    if (handle === null) return this.notFound(input);
    const viewer = await this.viewer(input);
    if ('failure' in viewer) return viewer.failure;
    const listing = await this.dependencies.service.listPublic({
      handle,
      memberId: viewer.memberId,
    });
    if (listing === undefined) return this.notFound(input);
    return {
      body: publicClubListResponseSchema.parse({
        clubs: listing.clubs.map(publicClubBody),
        handle: listing.handle,
      }),
      status: 200,
    };
  }

  /**
   * One club as its own destination, safe to reach by typed address.
   *
   * The feed is present only for somebody the entitlement question permits on
   * this request. Everybody else gets the club's public identity and an empty
   * list — never a body, a summary, or a media reference belonging to a
   * protected item, because a locked state built by hiding fields on the client
   * is not a locked state.
   */
  async getClub(input: RouteRequest): Promise<RouteResult> {
    const query = new URL(input.request.url).searchParams;
    const handle = creatorHandleSchema.safeParse(query.get('handle'));
    const slug = clubSlugSchema.safeParse(query.get('slug')?.toLowerCase());
    const pageSize = readPageSize(input.request);
    if (!handle.success || !slug.success || pageSize === undefined) {
      return this.notFound(input);
    }
    const viewer = await this.viewer(input);
    if ('failure' in viewer) return viewer.failure;

    const detail = await this.dependencies.service.readClub({
      cursor: query.get('cursor') ?? undefined,
      handle: handle.data,
      memberId: viewer.memberId,
      pageSize,
      slug: slug.data,
    });
    if (detail === undefined) return this.notFound(input);
    const media = await this.dependencies.media.describe(detail.content);
    return {
      body: clubDetailResponseSchema.parse({
        club: publicClubBody(detail.club),
        content: detail.content.map((row) => ({
          ...(row.body === null ? {} : { body: row.body }),
          id: row.id,
          // Ready only. A member is owed the item, not its author's pipeline.
          media: [...(media.get(row.id) ?? [])]
            .filter((item) => item.state === 'ready')
            .sort((left, right) => left.position - right.position)
            .map((item) => ({ id: item.id, position: item.position })),
          publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
          ...(row.summary === null ? {} : { summary: row.summary }),
          title: row.title,
        })),
        creatorHandle: detail.creatorHandle,
        ...(detail.nextCursor === undefined
          ? {}
          : { nextCursor: detail.nextCursor }),
      }),
      status: 200,
    };
  }

  /** Somebody hands back an invitation they were given. */
  async leaveClub(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireConsumerAccount(
      this.dependencies.consumerContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(leaveClubRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.service.leave({
      clubId: parsed.value.clubId,
      memberId: resolved.context.userId,
    });
    if (outcome.kind === 'refused') {
      // One answer for a club they were never in, one they have already left,
      // and one they hold commercially. The surface knows which of those it is
      // looking at; an endpoint that told them apart would say whether somebody
      // else's club exists.
      return routeFailure(
        409,
        productErrorCodes.actionNotPermitted,
        input.correlationId,
      );
    }
    return this.accessResult(resolved.context.userId);
  }

  /**
   * The acting consumer, when there is one, for a route open to everybody.
   *
   * A session belonging to another surface acts as no consumer rather than
   * being refused: a creator looking at their own public page is a visitor to
   * it. A rejected origin or a failed CSRF echo stays a refusal, because those
   * are a browser doing something wrong rather than an absent session.
   */
  private async viewer(
    input: RouteRequest,
  ): Promise<
    | { readonly memberId: string | undefined }
    | { readonly failure: RouteResult }
  > {
    const resolution = await this.dependencies.consumerContext.resolveOptional(
      input.request,
      input.correlationId,
    );
    if (resolution.kind === 'denied') return { failure: resolution.result };
    return {
      memberId:
        resolution.kind === 'resolved' ? resolution.context.userId : undefined,
    };
  }

  private async accessResult(memberId: string): Promise<RouteResult> {
    const held = await this.dependencies.service.listAccess(memberId);
    return {
      body: clubAccessListResponseSchema.parse({
        access: held.map((entry) => ({
          clubId: entry.club.id,
          clubName: entry.club.name,
          clubSlug: entry.club.slug,
          // The creator's public address rather than an internal identifier,
          // because a member needs somewhere to go and nothing else.
          creatorHandle: entry.creatorHandle,
          ...(entry.membership.revokedAt === null
            ? {}
            : { endedAt: entry.membership.revokedAt.toISOString() }),
          grantedAt: entry.membership.grantedAt.toISOString(),
          source: entry.membership.source,
          state: entry.membership.state,
        })),
      }),
      status: 200,
    };
  }

  private conflict(input: RouteRequest): RouteResult {
    return routeFailure(409, productErrorCodes.conflict, input.correlationId);
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }

  private notFound(input: RouteRequest): RouteResult {
    return routeFailure(404, productErrorCodes.notFound, input.correlationId);
  }
}
