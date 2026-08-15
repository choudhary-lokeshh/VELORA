import {
  clubAccessListResponseSchema,
  clubIdSchema,
  clubInviteIssuedResponseSchema,
  clubInviteListResponseSchema,
  clubLifecycleRequestSchema,
  clubMembershipListResponseSchema,
  contentIdSchema,
  creatorClubListResponseSchema,
  defaultPageSize,
  issueClubInviteRequestSchema,
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
import type { ClubService } from './club-service.js';
import type { CreatorContentRow } from './repository.js';

function clubBody(club: ClubRow, memberCount: number) {
  return {
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
    return {
      body: creatorClubListResponseSchema.parse({
        clubs: page.rows.map((entry) =>
          clubBody(entry.club, entry.memberCount),
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
    return {
      body: creatorClubListResponseSchema.parse({
        clubs: [clubBody(outcome.row, 0)],
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
        clubs: [clubBody(outcome.row, 0)],
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

  /** Published clubs on a creator's public page. Metadata and nothing else. */
  async getPublicClubs(input: RouteRequest): Promise<RouteResult> {
    const handle = new URL(input.request.url).searchParams.get('handle');
    const listing =
      handle === null
        ? undefined
        : await this.dependencies.service.listPublic(handle);
    if (listing === undefined) return this.notFound(input);
    return {
      body: publicClubListResponseSchema.parse({
        clubs: listing.clubs.map((club) => ({
          ...(club.description === null
            ? {}
            : { description: club.description }),
          name: club.name,
          slug: club.slug,
        })),
        handle: listing.handle,
      }),
      status: 200,
    };
  }

  private async accessResult(memberId: string): Promise<RouteResult> {
    const held = await this.dependencies.service.listAccess(memberId);
    return {
      body: clubAccessListResponseSchema.parse({
        access: held.map((entry) => ({
          clubId: entry.club.id,
          clubName: entry.club.name,
          // The creator's public address rather than an internal identifier,
          // because a member needs somewhere to go and nothing else.
          creatorHandle: entry.creatorHandle,
          grantedAt: entry.membership.grantedAt.toISOString(),
          source: entry.membership.source,
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
