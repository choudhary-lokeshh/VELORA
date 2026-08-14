import {
  creatorProfilePublicationRequestSchema,
  creatorProfileResponseSchema,
  creatorPublicPath,
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
import type { CreatorProfileService } from './profile-service.js';
import type { CreatorProfileRecord } from './repository.js';

/**
 * The creator's own view of their profile. It includes the draft nobody else
 * can see and the version a later edit must carry, and it still carries no
 * capability identifier, no AUTH subject, and no consumer identifier.
 */
function ownProfileBody(
  record: CreatorProfileRecord,
): ReturnType<typeof creatorProfileResponseSchema.parse> {
  return creatorProfileResponseSchema.parse({
    ...(record.profile.bio === null ? {} : { bio: record.profile.bio }),
    displayName: record.profile.displayName,
    handle: record.profile.handle,
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
): ReturnType<typeof publicCreatorResponseSchema.parse> {
  return publicCreatorResponseSchema.parse({
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
    return { body: ownProfileBody(record), status: 200 };
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
      body: ownProfileBody(outcome.record),
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
    return { body: ownProfileBody(outcome.record), status: 200 };
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
    return { body: publicProfileBody(record), status: 200 };
  }
}
