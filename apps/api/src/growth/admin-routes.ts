import {
  acquisitionSummaryResponseSchema,
  liveWindowCancellationRequestSchema,
  maximumLiveWindows,
  productErrorCodes,
  scheduleLiveWindowRequestSchema,
} from '@velora/validation';

import type { AdminContextResolver } from '../admin/context.js';
import {
  parseRouteBody,
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import { windowListBody } from './routes.js';
import type { GrowthService } from './service.js';

export interface AdminGrowthRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly growth: GrowthService;
}

/**
 * The smallest operator surface acquisition needs.
 *
 * Three routes: schedule a time, withdraw one, and read what the last month
 * looked like in counts. There is deliberately no fourth. An operator cannot
 * see who invited whom, cannot look up one person's invitation, cannot revoke
 * somebody's link, and cannot attribute an account by hand — the first three
 * would hand an operator a social graph they have no decision to make about,
 * and the fourth would make the one number this domain exists to keep honest
 * into a number somebody can type.
 *
 * `docs/decisions/ADR-0036-platform-admin-operations-console.md` is the
 * standard these follow: the operator is resolved first, which refuses a wrong
 * audience and a stale assurance before any lookup happens on the caller's
 * behalf.
 */
export class AdminGrowthRoutes {
  constructor(private readonly dependencies: AdminGrowthRoutesDependencies) {}

  async scheduleWindow(input: RouteRequest): Promise<RouteResult> {
    const operator = await this.dependencies.adminContext.resolve(
      input,
      'growth.manage',
    );
    if ('failure' in operator) return operator.failure;
    const parsed = parseRouteBody(scheduleLiveWindowRequestSchema, input.body);
    if (!parsed.ok) return this.invalid(input);

    const startsAt = new Date(parsed.value.startsAt);
    const endsAt = new Date(parsed.value.endsAt);
    const outcome = await this.dependencies.growth.scheduleWindow({
      endsAt,
      slug: parsed.value.slug,
      startsAt,
      title: parsed.value.title,
    });
    if (outcome.kind === 'refused') return this.invalid(input);
    return this.publishedWindows();
  }

  async cancelWindow(input: RouteRequest): Promise<RouteResult> {
    const operator = await this.dependencies.adminContext.resolve(
      input,
      'growth.manage',
    );
    if ('failure' in operator) return operator.failure;
    const parsed = parseRouteBody(
      liveWindowCancellationRequestSchema,
      input.body,
    );
    if (!parsed.ok) return this.invalid(input);
    // Cancelling one that is already cancelled, or that never existed, answers
    // the same way. An operator learns what is published rather than whether a
    // slug is in use.
    await this.dependencies.growth.cancelWindow(parsed.value.slug);
    return this.publishedWindows();
  }

  async getAcquisitionSummary(input: RouteRequest): Promise<RouteResult> {
    const operator = await this.dependencies.adminContext.resolve(
      input,
      'growth.read',
    );
    if ('failure' in operator) return operator.failure;
    const summary = await this.dependencies.growth.acquisitionSummary();
    return {
      body: acquisitionSummaryResponseSchema.parse({
        invitationsOpened: summary.invitationsOpened,
        invitesCreated: summary.invitesCreated,
        signupsAttributed: summary.signupsAttributed,
        since: summary.since.toISOString(),
        sources: summary.sources.map((entry) => ({
          signups: entry.signups,
          source: entry.source,
        })),
      }),
      status: 200,
    };
  }

  private async publishedWindows(): Promise<RouteResult> {
    const windows =
      await this.dependencies.growth.publishableWindows(maximumLiveWindows);
    return { body: windowListBody(windows), status: 200 };
  }

  private invalid(input: RouteRequest): RouteResult {
    return routeFailure(
      422,
      productErrorCodes.validationFailed,
      input.correlationId,
    );
  }
}
