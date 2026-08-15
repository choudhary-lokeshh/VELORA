import {
  adminCreatorListResponseSchema,
  adminCreatorSearchSchema,
  adminOperationResponseSchema,
  adminReinstateCreatorRequestSchema,
  adminRemoveObjectRequestSchema,
  adminRevokeMembershipRequestSchema,
  adminSuspendCreatorRequestSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
} from '@velora/validation';

import type { CreatorAccountRow } from '../creators/repository.js';
import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { EnforcementRow } from '../safety/repository.js';
import type { AdminContextResolver } from './context.js';
import type { AdminCreatorDirectory } from './directory.js';
import type { AdminCreatorService, AdminOutcome } from './service.js';

/**
 * One creator in operational terms.
 *
 * Deliberately thin. An operator needs to know what a capability is doing and
 * be able to act on it; they do not need the AUTH subject, the consumer
 * identifier, a contact detail, or anything financial, and
 * `docs/product/04-platform-admin.md` keeps Admin from accumulating them.
 */
function creatorBody(input: {
  readonly creator: CreatorAccountRow;
  readonly handle: string | undefined;
  readonly profilePublished: boolean;
}) {
  return {
    ...(input.creator.activatedAt === null
      ? {}
      : { activatedAt: input.creator.activatedAt.toISOString() }),
    createdAt: input.creator.createdAt.toISOString(),
    ...(input.handle === undefined ? {} : { handle: input.handle }),
    id: input.creator.id,
    profilePublished: input.profilePublished,
    status: input.creator.status,
    ...(input.creator.statusReason === null
      ? {}
      : { statusReason: input.creator.statusReason }),
    ...(input.creator.suspendedAt === null
      ? {}
      : { suspendedAt: input.creator.suspendedAt.toISOString() }),
  };
}

export interface AdminRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly directory: AdminCreatorDirectory;
  readonly service: AdminCreatorService;
}

export class AdminRoutes {
  constructor(private readonly dependencies: AdminRoutesDependencies) {}

  async listCreators(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const rawSize = query.get('pageSize');
    const size =
      rawSize === null ? defaultPageSize : pageSizeSchema.safeParse(rawSize);
    if (typeof size !== 'number' && !size.success) return this.invalid(input);
    const rawSearch = query.get('adminSearch');
    const search =
      rawSearch === null
        ? undefined
        : adminCreatorSearchSchema.safeParse(rawSearch);
    if (search !== undefined && !search.success) return this.invalid(input);

    const page = await this.dependencies.directory.list({
      cursor: query.get('cursor') ?? undefined,
      pageSize: typeof size === 'number' ? size : size.data,
      ...(search === undefined ? {} : { search: search.data }),
    });
    return {
      body: adminCreatorListResponseSchema.parse({
        creators: page.rows.map((row) => creatorBody(row)),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      }),
      status: 200,
    };
  }

  async suspendCreator(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(adminSuspendCreatorRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    return this.settle(
      input,
      await this.dependencies.service.suspend({
        actorReference: resolved.context.actorReference,
        creatorId: parsed.value.creatorId,
        reasonCode: parsed.value.reasonCode,
      }),
      parsed.value.reasonCode,
    );
  }

  async reinstateCreator(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      adminReinstateCreatorRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    return this.settle(
      input,
      await this.dependencies.service.reinstate({
        actorReference: resolved.context.actorReference,
        creatorId: parsed.value.creatorId,
        reasonCode: parsed.value.reasonCode,
      }),
      parsed.value.reasonCode,
    );
  }

  async removeObject(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(adminRemoveObjectRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    return this.settle(
      input,
      await this.dependencies.service.removeObject({
        actorReference: resolved.context.actorReference,
        creatorId: parsed.value.creatorId,
        objectId: parsed.value.objectId,
        objectType: parsed.value.objectType,
        reasonCode: parsed.value.reasonCode,
      }),
      parsed.value.reasonCode,
    );
  }

  async revokeMembership(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(input);
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      adminRevokeMembershipRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);

    return this.settle(
      input,
      await this.dependencies.service.revokeMembership({
        actorReference: resolved.context.actorReference,
        creatorId: parsed.value.creatorId,
        membershipId: parsed.value.membershipId,
        reasonCode: parsed.value.reasonCode,
      }),
      parsed.value.reasonCode,
    );
  }

  /**
   * Answers with the record that was written rather than with an
   * acknowledgement, so an operator sees what an audit will show.
   */
  private async settle(
    input: RouteRequest,
    outcome: AdminOutcome,
    reasonCode: string,
  ): Promise<RouteResult> {
    if (outcome.kind === 'refused') {
      return routeFailure(409, productErrorCodes.conflict, input.correlationId);
    }
    const view = await this.dependencies.directory.describe(outcome.creator);
    return {
      body: adminOperationResponseSchema.parse({
        creator: creatorBody(view),
        // What was written, including whether it imposed or lifted. A
        // reinstatement and a suspension now share a scope, so the disposition
        // is what tells an operator which one they just made.
        disposition: (outcome.enforcement satisfies EnforcementRow).disposition,
        enforcementId: outcome.enforcement.id,
        reasonCode,
        recordedAt: outcome.enforcement.effectiveAt.toISOString(),
        scope: outcome.enforcement.scope,
      }),
      status: 200,
    };
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
