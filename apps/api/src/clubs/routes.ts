import {
  creatorContentLifecycleRequestSchema,
  creatorContentListResponseSchema,
  creatorContentMediaRequestSchema,
  creatorMediaReferenceRequestSchema,
  defaultPageSize,
  mediaUploadCapabilitySchema,
  pageSizeSchema,
  productErrorCodes,
  publicCreatorCatalogResponseSchema,
  saveCreatorContentRequestSchema,
} from '@velora/validation';

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
  ContentMediaService,
  CreatorContentMediaView,
} from './content-media.js';
import type { CreatorContentRow } from './repository.js';
import type { ClubsService, ContentPage } from './service.js';

/** Images for one item, empty when it has none. */
type MediaByContent = ReadonlyMap<string, readonly CreatorContentMediaView[]>;

/**
 * The creator's own view of one item, drafts and all.
 *
 * `clubId` is here and deliberately absent from the visitor's view below. It is
 * the difference between a members-only item that has somebody to admit and one
 * that reaches nobody, which is a fact its own creator has to be able to read
 * back; a visitor learning which room an item belongs to would be learning
 * about a room they are not in.
 */
function contentBody(row: CreatorContentRow, media: MediaByContent) {
  return {
    ...(row.archivedAt === null
      ? {}
      : { archivedAt: row.archivedAt.toISOString() }),
    ...(row.body === null ? {} : { body: row.body }),
    ...(row.clubId === null ? {} : { clubId: row.clubId }),
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    lifecycle: row.lifecycle,
    media: [...(media.get(row.id) ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((item) => ({
        id: item.id,
        position: item.position,
        ...(item.rejectionReason === undefined
          ? {}
          : { rejectionReason: item.rejectionReason }),
        state: item.state,
        ...(item.uploadExpiresAt === undefined
          ? {}
          : { uploadExpiresAt: item.uploadExpiresAt.toISOString() }),
      })),
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

function ownListBody(
  page: ContentPage,
  media: MediaByContent,
): ReturnType<typeof creatorContentListResponseSchema.parse> {
  return creatorContentListResponseSchema.parse({
    content: page.rows.map((row) => contentBody(row, media)),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  });
}

/**
 * What a visitor sees, built field by field from an allow-list.
 *
 * No creator identifier, no lifecycle, no visibility, no version, no edit
 * timestamp, and nothing purchasable. A published item's own words and when it
 * appeared, and nothing else.
 */
function publicCatalogBody(
  handle: string,
  page: ContentPage,
  media: MediaByContent,
): ReturnType<typeof publicCreatorCatalogResponseSchema.parse> {
  return publicCreatorCatalogResponseSchema.parse({
    content: page.rows.map((row) => ({
      ...(row.body === null ? {} : { body: row.body }),
      id: row.id,
      // Ready only. A reader is owed the item, not its author's pipeline, and
      // an image still being decided has nothing to render.
      media: [...(media.get(row.id) ?? [])]
        .filter((item) => item.state === 'ready')
        .sort((left, right) => left.position - right.position)
        .map((item) => ({ id: item.id, position: item.position })),
      // A published row always has one; the database constraint is what makes
      // that true rather than this fallback.
      publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
      ...(row.summary === null ? {} : { summary: row.summary }),
      title: row.title,
    })),
    handle,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  });
}

function readPageSize(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get('pageSize');
  if (raw === null) return defaultPageSize;
  const parsed = pageSizeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export interface ClubsRoutesDependencies {
  readonly creatorContext: CreatorContextResolver;
  readonly media: ContentMediaService;
  readonly service: ClubsService;
}

export class ClubsRoutes {
  constructor(private readonly dependencies: ClubsRoutesDependencies) {}

  async listContent(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const pageSize = readPageSize(input.request);
    if (pageSize === undefined) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }
    const query = new URL(input.request.url).searchParams;
    const page = await this.dependencies.service.listOwn({
      creatorId: resolved.context.creatorId,
      cursor: query.get('cursor') ?? undefined,
      pageSize,
    });
    return { body: await this.ownBody(page), status: 200 };
  }

  async saveContent(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(saveCreatorContentRequestSchema, input.body);
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.service.save({
      creatorId: resolved.context.creatorId,
      request: parsed.value,
    });
    if (outcome.kind === 'conflict') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    return {
      body: await this.ownBody({ nextCursor: undefined, rows: [outcome.row] }),
      status: outcome.created ? 201 : 200,
    };
  }

  async setContentLifecycle(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      creatorContentLifecycleRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      return routeFailure(
        422,
        productErrorCodes.validationFailed,
        input.correlationId,
      );
    }

    const outcome = await this.dependencies.service.setLifecycle({
      contentId: parsed.value.contentId,
      creatorId: resolved.context.creatorId,
      lifecycle: parsed.value.lifecycle,
      version: parsed.value.version,
    });
    if (outcome.kind === 'conflict') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    return {
      body: await this.ownBody({ nextCursor: undefined, rows: [outcome.row] }),
      status: 200,
    };
  }

  /**
   * The catalog half of the public creator page.
   *
   * It resolves no caller, because the answer is identical for everybody. A
   * handle nobody holds, a profile still in draft, a creator who is not active,
   * and a malformed cursor are all one 404 or one empty page — never a
   * different shape a visitor could read a fact out of.
   */
  async getPublicCatalog(input: RouteRequest): Promise<RouteResult> {
    const query = new URL(input.request.url).searchParams;
    const handle = query.get('handle');
    const pageSize = readPageSize(input.request);
    if (handle === null || pageSize === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    const page = await this.dependencies.service.listPublic({
      cursor: query.get('cursor') ?? undefined,
      handle,
      pageSize,
    });
    if (page === undefined) {
      return routeFailure(404, productErrorCodes.notFound, input.correlationId);
    }
    return {
      body: publicCatalogBody(
        handle.toLowerCase(),
        page,
        await this.dependencies.media.describe(page.rows),
      ),
      status: 200,
    };
  }

  /**
   * Reserves one image against one item.
   *
   * Every refusal is one answer, because the only one a creator can act on is
   * "this item is full" and the surface already knows that from what it is
   * showing. An item belonging to somebody else is indistinguishable from one
   * that does not exist.
   */
  async startMediaUpload(input: RouteRequest): Promise<RouteResult> {
    const resolved = await requireCreator(
      this.dependencies.creatorContext,
      input,
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(creatorContentMediaRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const outcome = await this.dependencies.media.startUpload({
      contentId: parsed.value.contentId,
      creatorId: resolved.context.creatorId,
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
    return this.mediaAction(input, async (creatorId, mediaId) =>
      this.dependencies.media.completeUpload({ creatorId, mediaId }),
    );
  }

  async removeMedia(input: RouteRequest): Promise<RouteResult> {
    return this.mediaAction(input, async (creatorId, mediaId) =>
      this.dependencies.media.remove({ creatorId, mediaId }),
    );
  }

  /** Both image actions name one image and answer with the item it is on. */
  private async mediaAction(
    input: RouteRequest,
    work: (
      creatorId: string,
      mediaId: string,
    ) => Promise<
      | { readonly kind: 'accepted'; readonly contentId: string }
      | { readonly kind: 'conflict' }
      | { readonly kind: 'storage_unavailable' }
      | { readonly kind: string }
    >,
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

    const outcome = await work(
      resolved.context.creatorId,
      parsed.value.mediaId,
    );
    if (outcome.kind === 'storage_unavailable') {
      return routeFailure(
        503,
        productErrorCodes.dependencyUnavailable,
        input.correlationId,
      );
    }
    if (!('contentId' in outcome)) {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    const row = await this.dependencies.service.findOwn({
      contentId: outcome.contentId,
      creatorId: resolved.context.creatorId,
    });
    if (row === undefined) {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    return {
      body: await this.ownBody({ nextCursor: undefined, rows: [row] }),
      status: 200,
    };
  }

  private async ownBody(
    page: ContentPage,
  ): Promise<ReturnType<typeof creatorContentListResponseSchema.parse>> {
    return ownListBody(page, await this.dependencies.media.describe(page.rows));
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
