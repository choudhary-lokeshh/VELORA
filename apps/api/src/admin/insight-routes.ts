import {
  adminAccountDetailResponseSchema,
  adminActivityResponseSchema,
  adminSearchResponseSchema,
  adminSessionRevocationRequestSchema,
  adminSessionRevocationResponseSchema,
  defaultPageSize,
  pageSizeSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import {
  defaultActivityWindowHours,
  isActivityDomain,
  isActivityType,
  maximumActivityRows,
  maximumActivityWindowHours,
  type ActivityDomain,
  type ActivityType,
} from '../operations/policy.js';
import type { OperationsService } from '../operations/service.js';
import type {
  AdminActivityDirectory,
  ActivityEntry,
  ActivityPage,
} from './activity-directory.js';
import type { AdminAccountDirectory } from './account-directory.js';
import type { AdminContextResolver } from './context.js';
import type { AdminSearchDirectory } from './search-directory.js';

/**
 * The reads an operator uses to find out what is going on and who it happened
 * to, plus the one command that follows from them.
 *
 * The activity stream and one person's timeline are the same read with a
 * different filter, deliberately. A timeline that was built separately would
 * eventually show something the stream did not, or the reverse, and the first
 * person to notice would be somebody trying to explain an incident.
 *
 * Every window is bounded and every answer says which window it covered. A
 * count with no window is a count nobody can act on, and a console that assumed
 * "all time" would quietly start lying as the platform aged.
 */

export interface SessionRevocationPort {
  revokeAllAuthority(input: {
    readonly accountId: string;
    readonly audience: 'platform_admin';
    readonly correlationId: string;
    readonly reason: 'administrative';
  }): Promise<{ readonly families: number; readonly sessions: number }>;
}

export interface AdminInsightRoutesDependencies {
  readonly accounts: AdminAccountDirectory;
  readonly activity: AdminActivityDirectory;
  readonly adminContext: AdminContextResolver;
  readonly now: () => Date;
  readonly operations: OperationsService;
  readonly search: AdminSearchDirectory;
  readonly sessions: SessionRevocationPort;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const maximumSearchTermCharacters = 128;

export class AdminInsightRoutes {
  constructor(private readonly dependencies: AdminInsightRoutesDependencies) {}

  async listActivity(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operations.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const bounds = this.activityBounds(query);
    if (bounds === undefined) return this.invalid(input);

    const page = await this.dependencies.activity.list({
      ...(bounds.cursor === undefined ? {} : { cursor: bounds.cursor }),
      ...(bounds.domain === undefined ? {} : { domain: bounds.domain }),
      limit: bounds.limit,
      since: bounds.since,
      ...(bounds.type === undefined ? {} : { type: bounds.type }),
      until: bounds.until,
    });
    return { body: this.activityBody(page), status: 200 };
  }

  /**
   * One person's history, across every domain that recorded something.
   *
   * Both identifiers are resolved first. AUTH keeps its own account identifier
   * and USERS keeps another, and a timeline asked for with only one of them
   * would silently omit every sign-in — which is exactly the half an operator
   * investigating an account compromise came for.
   */
  async getAccountTimeline(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'users.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const accountId = query.get('accountId');
    if (accountId === null || !uuidPattern.test(accountId)) {
      return this.invalid(input);
    }
    const bounds = this.activityBounds(query);
    if (bounds === undefined) return this.invalid(input);

    const authAccountId =
      await this.dependencies.accounts.authAccountOf(accountId);
    if (authAccountId === undefined) return this.notFound(input);

    const page = await this.dependencies.activity.list({
      ...(bounds.cursor === undefined ? {} : { cursor: bounds.cursor }),
      ...(bounds.domain === undefined ? {} : { domain: bounds.domain }),
      limit: bounds.limit,
      since: bounds.since,
      subject: { authAccountId, userId: accountId },
      ...(bounds.type === undefined ? {} : { type: bounds.type }),
      until: bounds.until,
    });
    return { body: this.activityBody(page), status: 200 };
  }

  async findSubject(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operations.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const term = new URL(input.request.url).searchParams.get('term');
    if (
      term === null ||
      term.length === 0 ||
      term.length > maximumSearchTermCharacters
    ) {
      return this.invalid(input);
    }
    const matches = await this.dependencies.search.resolve(term);
    return {
      body: adminSearchResponseSchema.parse({
        matches: matches.map((match) => ({
          ...(match.context === undefined ? {} : { context: match.context }),
          id: match.id,
          kind: match.kind,
        })),
      }),
      status: 200,
    };
  }

  async getAccountDetail(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'users.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const accountId = new URL(input.request.url).searchParams.get('accountId');
    if (accountId === null || !uuidPattern.test(accountId)) {
      return this.invalid(input);
    }
    const detail = await this.dependencies.accounts.detail(accountId);
    if (detail === undefined) return this.notFound(input);

    return {
      body: adminAccountDetailResponseSchema.parse({
        account: {
          createdAt: detail.account.createdAt.toISOString(),
          ...(detail.account.deletionRequestedAt === undefined
            ? {}
            : {
                deletionRequestedAt:
                  detail.account.deletionRequestedAt.toISOString(),
              }),
          id: detail.account.id,
          ...(detail.account.region === undefined
            ? {}
            : { region: detail.account.region }),
          status: detail.account.status,
          statusChangedAt: detail.account.statusChangedAt.toISOString(),
          ...(detail.account.statusReason === undefined
            ? {}
            : { statusReason: detail.account.statusReason }),
        },
        ...(detail.acquisition === undefined
          ? {}
          : {
              acquisition: {
                attributedAt: detail.acquisition.attributedAt.toISOString(),
                ...(detail.acquisition.campaign === undefined
                  ? {}
                  : { campaign: detail.acquisition.campaign }),
                source: detail.acquisition.source,
                viaInvitation: detail.acquisition.viaInvitation,
              },
            }),
        commerce: {
          payments: [...detail.commerce.payments],
          subscriptions: [...detail.commerce.subscriptions],
        },
        connections: {
          conversations: detail.connections.conversations,
          introductions: [...detail.connections.introductions],
        },
        ...(detail.creator === undefined
          ? {}
          : {
              creator: {
                ...(detail.creator.handle === undefined
                  ? {}
                  : { handle: detail.creator.handle }),
                id: detail.creator.id,
                ...(detail.creator.publishedAt === undefined
                  ? {}
                  : { publishedAt: detail.creator.publishedAt.toISOString() }),
                status: detail.creator.status,
              },
            }),
        devices: detail.devices.map((device) => ({
          ...(device.disableReason === undefined
            ? {}
            : { disableReason: device.disableReason }),
          ...(device.disabledAt === undefined
            ? {}
            : { disabledAt: device.disabledAt.toISOString() }),
          id: device.id,
          lastSeenAt: device.lastSeenAt.toISOString(),
          platform: device.platform,
          registeredAt: device.registeredAt.toISOString(),
        })),
        live: {
          encounters: detail.live.encounters.map((encounter) => ({
            ...(encounter.endReason === undefined
              ? {}
              : { endReason: encounter.endReason }),
            ...(encounter.endedAt === undefined
              ? {}
              : { endedAt: encounter.endedAt.toISOString() }),
            id: encounter.id,
            medium: encounter.medium,
            startedAt: encounter.startedAt.toISOString(),
            state: encounter.state,
          })),
          ...(detail.live.participation === undefined
            ? {}
            : {
                participation: {
                  medium: detail.live.participation.medium,
                  since: detail.live.participation.since.toISOString(),
                  state: detail.live.participation.state,
                },
              }),
        },
        profileComplete: detail.profileComplete,
        safety: {
          appeals: detail.safety.appeals,
          blocksMade: detail.safety.blocksMade,
          blocksReceived: detail.safety.blocksReceived,
          enforcements: [...detail.safety.enforcements],
          reportsAbout: detail.safety.reportsAbout,
          reportsMade: detail.safety.reportsMade,
        },
        sessions: detail.sessions.map((session) => ({
          audience: session.audience,
          authenticatedAt: session.authenticatedAt.toISOString(),
          id: session.id,
          lastActiveAt: session.lastActiveAt.toISOString(),
          ...(session.revocationReason === undefined
            ? {}
            : { revocationReason: session.revocationReason }),
          ...(session.revokedAt === undefined
            ? {}
            : { revokedAt: session.revokedAt.toISOString() }),
        })),
        support: [...detail.support],
        ...(detail.wallet === undefined ? {} : { wallet: detail.wallet }),
      }),
      status: 200,
    };
  }

  /**
   * Signs one account out of every device.
   *
   * The revocation goes through AUTH's own service, which writes AUTH's
   * security event in the same transaction as the revocation — so the fact that
   * somebody's sessions ended and the fact that an operator ended them are one
   * commit rather than two that can disagree. The operator action row is
   * written after it settles, with the numbers the database actually changed.
   */
  async revokeSessions(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'sessions.revoke',
    );
    if ('failure' in resolved) return resolved.failure;
    const parsed = parseRouteBody(
      adminSessionRevocationRequestSchema,
      input.body,
    );
    if (!parsed.ok) {
      await this.dependencies.operations.recordAction({
        action: 'sessions.revoked',
        actorReference: resolved.context.actorReference,
        capability: 'sessions.revoke',
        correlationId: input.correlationId,
        failureCode: productErrorCodes.validationFailed,
        outcome: 'refused',
        reason: 'session revocation request failed validation',
        subjectType: 'account',
      });
      return this.invalid(input);
    }

    const authAccountId = await this.dependencies.accounts.authAccountOf(
      parsed.value.accountId,
    );
    if (authAccountId === undefined) {
      await this.dependencies.operations.recordAction({
        action: 'sessions.revoked',
        actorReference: resolved.context.actorReference,
        capability: 'sessions.revoke',
        correlationId: input.correlationId,
        failureCode: productErrorCodes.notFound,
        outcome: 'refused',
        reason: parsed.value.reason,
        subjectId: parsed.value.accountId,
        subjectType: 'account',
      });
      return this.notFound(input);
    }

    const revoked = await this.dependencies.sessions.revokeAllAuthority({
      accountId: authAccountId,
      // The audience the act came *from*, which is what happened. Recording the
      // consumer's audience would say the person signed themselves out.
      audience: 'platform_admin',
      correlationId: input.correlationId,
      reason: 'administrative',
    });

    await this.dependencies.operations.recordAction({
      action: 'sessions.revoked',
      actorReference: resolved.context.actorReference,
      capability: 'sessions.revoke',
      correlationId: input.correlationId,
      outcome: 'applied',
      reason: parsed.value.reason,
      requestedState: `sessions:${String(revoked.sessions)}`,
      subjectId: parsed.value.accountId,
      subjectType: 'account',
    });

    return {
      body: adminSessionRevocationResponseSchema.parse({
        families: revoked.families,
        sessions: revoked.sessions,
      }),
      status: 200,
    };
  }

  private activityBounds(query: URLSearchParams):
    | {
        readonly cursor: string | undefined;
        readonly domain: ActivityDomain | undefined;
        readonly limit: number;
        readonly since: Date;
        readonly type: ActivityType | undefined;
        readonly until: Date;
      }
    | undefined {
    const rawSize = query.get('pageSize');
    const size =
      rawSize === null ? defaultPageSize : pageSizeSchema.safeParse(rawSize);
    if (typeof size !== 'number' && !size.success) return undefined;
    const limit = Math.min(
      typeof size === 'number' ? size : size.data,
      maximumActivityRows,
    );

    const rawHours = query.get('hours');
    let hours = defaultActivityWindowHours;
    if (rawHours !== null) {
      if (!/^[1-9][0-9]{0,3}$/u.test(rawHours)) return undefined;
      hours = Number.parseInt(rawHours, 10);
      if (hours > maximumActivityWindowHours) return undefined;
    }

    const rawDomain = query.get('domain');
    if (rawDomain !== null && !isActivityDomain(rawDomain)) return undefined;
    const rawType = query.get('type');
    if (rawType !== null && !isActivityType(rawType)) return undefined;

    const until = this.dependencies.now();
    return {
      cursor: query.get('cursor') ?? undefined,
      domain: rawDomain ?? undefined,
      limit,
      since: new Date(until.getTime() - hours * 3_600_000),
      type: rawType ?? undefined,
      until,
    };
  }

  private activityBody(page: ActivityPage): unknown {
    return adminActivityResponseSchema.parse({
      entries: page.entries.map((entry: ActivityEntry) => ({
        ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
        ...(entry.correlationId === undefined
          ? {}
          : { correlationId: entry.correlationId }),
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
        domain: entry.domain,
        id: entry.id,
        occurredAt: entry.occurredAt.toISOString(),
        ...(entry.resourceId === undefined
          ? {}
          : { resourceId: entry.resourceId }),
        ...(entry.resourceType === undefined
          ? {}
          : { resourceType: entry.resourceType }),
        ...(entry.subjectId === undefined
          ? {}
          : { subjectId: entry.subjectId }),
        type: entry.type,
      })),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      since: page.since.toISOString(),
      until: page.until.toISOString(),
    });
  }

  private notFound(input: RouteRequest): RouteResult {
    return routeFailure(404, productErrorCodes.notFound, input.correlationId);
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
