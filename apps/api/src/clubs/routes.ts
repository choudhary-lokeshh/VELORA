import {
  creatorContentLifecycleRequestSchema,
  creatorContentListResponseSchema,
  defaultPageSize,
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
import type { CreatorContentRow } from './repository.js';
import type { ClubsService, ContentPage } from './service.js';

/** The creator's own view of one item, drafts and all. */
function contentBody(row: CreatorContentRow) {
  return {
    ...(row.archivedAt === null
      ? {}
      : { archivedAt: row.archivedAt.toISOString() }),
    ...(row.body === null ? {} : { body: row.body }),
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

function ownListBody(
  page: ContentPage,
): ReturnType<typeof creatorContentListResponseSchema.parse> {
  return creatorContentListResponseSchema.parse({
    content: page.rows.map((row) => contentBody(row)),
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
): ReturnType<typeof publicCreatorCatalogResponseSchema.parse> {
  return publicCreatorCatalogResponseSchema.parse({
    content: page.rows.map((row) => ({
      ...(row.body === null ? {} : { body: row.body }),
      id: row.id,
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
    return { body: ownListBody(page), status: 200 };
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
      body: ownListBody({ nextCursor: undefined, rows: [outcome.row] }),
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
      body: ownListBody({ nextCursor: undefined, rows: [outcome.row] }),
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
    return { body: publicCatalogBody(handle.toLowerCase(), page), status: 200 };
  }
}
