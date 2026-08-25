import {
  defaultPageSize,
  pageSizeSchema,
  publicCreatorDirectoryResponseSchema,
  creatorMediaReferenceRequestSchema,
  creatorProfileMediaRequestSchema,
  creatorProfilePublicationRequestSchema,
  creatorProfileResponseSchema,
  creatorPublicPath,
  mediaUploadCapabilitySchema,
  productErrorCodes,
  publicCreatorResponseSchema,
  saveCreatorProfileRequestSchema,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import { requireCreator, type CreatorContextResolver } from './context.js';
import { decodeDirectoryCursor, encodeDirectoryCursor } from './cursor.js';
import type {
  CreatorProfileMediaService,
  CreatorProfileMediaView,
} from './profile-media.js';
import type { CreatorProfileService } from './profile-service.js';
import type { CreatorAccountRow, CreatorProfileRecord } from './repository.js';

/**
 * The creator's own view of their profile. It includes the draft nobody else
 * can see and the version a later edit must carry, and it still carries no
 * capability identifier, no AUTH subject, and no consumer identifier.
 */
function ownProfileBody(
  record: CreatorProfileRecord,
  media: readonly CreatorProfileMediaView[],
): ReturnType<typeof creatorProfileResponseSchema.parse> {
  return creatorProfileResponseSchema.parse({
    ...(record.profile.bio === null ? {} : { bio: record.profile.bio }),
    displayName: record.profile.displayName,
    handle: record.profile.handle,
    media: media.map((item) => ({
      id: item.id,
      ...(item.rejectionReason === undefined
        ? {}
        : { rejectionReason: item.rejectionReason }),
      slot: item.slot,
      state: item.state,
      ...(item.uploadExpiresAt === undefined
        ? {}
        : { uploadExpiresAt: item.uploadExpiresAt.toISOString() }),
    })),
    links: record.links.map((link) => ({
      ...(link.label === null ? {} : { label: link.label }),
      url: link.url,
    })),
    publicPath: creatorPublicPath(record.profile.handle),
    publication: record.profile.publication,
    ...(record.profile.publishedAt === null
      ? {}
      : { publishedAt: record.profile.publishedAt.toISOString() }),
    updatedAt: record.profile.updatedAt.toISOString(),
    version: record.profile.version,
  });
}

/**
 * What a visitor sees.
 *
 * Built field by field from an allow-list rather than by removing things from
 * the stored record, so a column added to `creators_profiles` later is invisible
 * here until somebody decides it should be public. That is the difference
 * between a projection and a filter: a filter fails open when the row grows.
 */
function publicProfileBody(
  record: CreatorProfileRecord,
  media: readonly CreatorProfileMediaView[],
): ReturnType<typeof publicCreatorResponseSchema.parse> {
  // Ready only. A visitor is owed a page, not its author's pipeline, and an
  // image that is still being decided has nothing to render.
  const ready = new Map(
    media
      .filter((item) => item.state === 'ready')
      .map((item) => [item.slot, item]),
  );
  const avatar = ready.get('avatar');
  const cover = ready.get('cover');
  return publicCreatorResponseSchema.parse({
    ...(avatar === undefined ? {} : { avatar: { id: avatar.id } }),
    ...(cover === undefined ? {} : { cover: { id: cover.id } }),
    ...(record.profile.bio === null ? {} : { bio: record.profile.bio }),
    displayName: record.profile.displayName,
    handle: record.profile.handle,
    links: record.links.map((link) => ({
      ...(link.label === null ? {} : { label: link.label }),
      url: link.url,
    })),
    // A published record always has one; the database constraint is what makes
    // that true rather than this assertion.
    publishedAt: (record.profile.publishedAt ?? new Date()).toISOString(),
  });
}

export interface CreatorProfileRoutesDependencies {
  readonly creatorContext: CreatorContextResolver;
  readonly media: CreatorProfileMediaService;
  readonly profiles: CreatorProfileService;
}

export class CreatorProfileRoutes {
  constructor(
    private readonly dependencies: CreatorProfileRoutesDependencies,
  ) {}

  async getProfile(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const record = await this.dependencies.profiles.findOwn(
      resolved.context.creatorId,
    );
    if (record === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return { body: await this.ownBody(record), status: 200 };
  }

  async saveProfile(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(saveCreatorProfileRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.profiles.save({
      account: resolved.context.account,
      request: parsed.value,
    });
    if (outcome.kind === 'conflict') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    return {
      body: await this.ownBody(outcome.record),
      status: outcome.created ? 201 : 200,
    };
  }

  async setPublication(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      creatorProfilePublicationRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.profiles.setPublication({
      account: resolved.context.account,
      publication: parsed.value.publication,
      version: parsed.value.version,
    });
    if (outcome.kind === 'conflict') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    return { body: await this.ownBody(outcome.record), status: 200 };
  }

  /**
   * The one creator route a visitor with no session may call.
   *
   * It resolves no caller at all — not to be permissive, but because there is
   * nothing to authorize: the answer is identical for every requester, so
   * reading a credential here would collect one for no purpose. Every failure
   * is the same 404, so an unknown handle, a draft profile, and a suspended
   * creator are indistinguishable.
   */
  async getPublicCreator(input: RouteRequest): Promise<RouteResult> {
    const handle = new URL(input.request.url).searchParams.get('handle');
    const record =
      handle === null
        ? undefined
        : await this.dependencies.profiles.findPublic(handle);
    if (record === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: publicProfileBody(
        record,
        await this.dependencies.media.describe(record),
      ),
      status: 200,
    };
  }

  /**
   * The listing a person browses instead of having to know a handle.
   *
   * It resolves no caller, because the answer is identical for everybody, and
   * it applies the same conditions the page itself does — so a draft page, a
   * suspended creator, and a handle nobody holds are absent rather than listed
   * and then refused. A malformed cursor or page size is refused as malformed
   * input rather than quietly treated as the first page: a caller that mangled
   * a cursor is better told so than silently sent back to the top of a listing
   * it thought it was part-way through.
   */
  async getPublicDirectory(input: RouteRequest): Promise<RouteResult> {
    const query = new URL(input.request.url).searchParams;
    const rawPageSize = query.get('pageSize');
    const parsedPageSize =
      rawPageSize === null ? undefined : pageSizeSchema.safeParse(rawPageSize);
    if (parsedPageSize !== undefined && !parsedPageSize.success) {
      return this.invalid(input);
    }
    const size = parsedPageSize?.data ?? defaultPageSize;
    const rawCursor = query.get('cursor');
    const cursor =
      rawCursor === null ? undefined : decodeDirectoryCursor(rawCursor);
    if (rawCursor !== null && cursor === undefined) return this.invalid(input);

    const page = await this.dependencies.profiles.listPublished({
      cursor,
      pageSize: size,
    });
    const media = await this.dependencies.media.describeMany(page.rows);
    return {
      body: publicCreatorDirectoryResponseSchema.parse({
        creators: page.rows.map((profile) => {
          const avatar = media.get(profile.creatorId);
          return {
            ...(avatar === undefined ? {} : { avatar: { id: avatar } }),
            ...(profile.bio === null ? {} : { bio: profile.bio }),
            displayName: profile.displayName,
            handle: profile.handle,
          };
        }),
        ...(page.next === undefined
          ? {}
          : { nextCursor: encodeDirectoryCursor(page.next) }),
      }),
      status: 200,
    };
  }

  /**
   * Reserves one page image.
   *
   * Refusals collapse deliberately: a capability that may not edit, a profile
   * that does not exist yet, and a reservation the media platform refused are
   * one answer, because the only one a creator can act on is the last and the
   * surface already knows the first two from state it holds.
   */
  async startMediaUpload(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(creatorProfileMediaRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.media.startUpload({
      account: resolved.context.account,
      slot: parsed.value.slot,
    });
    if (outcome.kind === 'storage_unavailable') {
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (outcome.kind !== 'upload_created') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    return {
      body: mediaUploadCapabilitySchema.parse({
        expiresAt: outcome.capability.expiresAt.toISOString(),
        maximumBytes: outcome.capability.maximumBytes,
        mediaId: outcome.capability.assetId,
        method: outcome.capability.method,
        uploadHeaders: outcome.capability.headers,
        uploadUrl: outcome.capability.url,
      }),
      status: 201,
    };
  }

  async completeMediaUpload(input: RouteRequest): Promise<RouteResult> {
    return this.mediaAction(input, async (account, mediaId) =>
      this.dependencies.media.completeUpload({ account, mediaId }),
    );
  }

  async removeMedia(input: RouteRequest): Promise<RouteResult> {
    return this.mediaAction(input, async (account, mediaId) =>
      this.dependencies.media.remove({ account, mediaId }),
    );
  }

  /** Both image actions name one image and answer with the whole profile. */
  private async mediaAction(
    input: RouteRequest,
    work: (
      account: CreatorAccountRow,
      mediaId: string,
    ) => Promise<{ readonly kind: string }>,
  ): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      creatorMediaReferenceRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    const outcome = await work(resolved.context.account, parsed.value.mediaId);
    if (outcome.kind === 'storage_unavailable') {
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (outcome.kind !== 'accepted') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    const record = await this.dependencies.profiles.findOwn(
      resolved.context.creatorId,
    );
    if (record === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return { body: await this.ownBody(record), status: 200 };
  }

  private async ownBody(
    record: CreatorProfileRecord,
  ): Promise<ReturnType<typeof creatorProfileResponseSchema.parse>> {
    return ownProfileBody(
      record,
      await this.dependencies.media.describe(record),
    );
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
