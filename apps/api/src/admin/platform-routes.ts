import {
  adminLiveEncounterResponseSchema,
  adminLiveStateResponseSchema,
  adminOperationsStateResponseSchema,
  adminPublicEntryResponseSchema,
  adminReconciliationResponseSchema,
  adminWalletResponseSchema,
  productErrorCodes,
} from '@velora/validation';

import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from '../http/route-kit.js';
import type { JobQueueInspectionPort } from '../jobs/inspection.js';
import type { OperationalControlReader } from '../operations/controls.js';
import type { AdminContextResolver } from './context.js';
import type { AdminLiveDirectory } from './live-directory.js';
import type { AdminOperationsHealthDirectory } from './operations-health-directory.js';
import type { AdminPublicEntryDirectory } from './public-entry-directory.js';
import type { AdminReconciliationDirectory } from './reconciliation-directory.js';

/**
 * What the platform is doing, and whether its money adds up.
 *
 * Five reads, no commands. Every one of them answers a question an operator
 * would otherwise answer with a database shell, and every one of them is
 * bounded — a window, a page, a capped list of examples — so a platform in
 * trouble produces a screen rather than a response nobody can load.
 *
 * Nothing here is a rate, a score, or a percentage. Each figure is a count of
 * rows an operator can go and open, and each finding carries the definition
 * that produced it, because a number nobody can define is a number nobody
 * should act on.
 */

/**
 * One dependency's readiness, resolved where configuration and health handles
 * actually live rather than guessed at from a table.
 *
 * A closure rather than an interface with ten methods, because what counts as a
 * dependency changes with the composition — a runtime assembled without LIVE
 * has no live seam to report — and the composition is the only place that knows.
 */
export type DependencyReadinessPort = () => Promise<
  readonly {
    readonly adapter?: string | undefined;
    readonly name: string;
    readonly state: 'healthy' | 'unavailable' | 'unconfigured' | 'unknown';
  }[]
>;

export interface AdminPlatformRoutesDependencies {
  readonly adminContext: AdminContextResolver;
  readonly controls: OperationalControlReader;
  readonly environment: 'local' | 'test' | 'staging' | 'production';
  readonly health: AdminOperationsHealthDirectory;
  readonly jobs: JobQueueInspectionPort;
  readonly live: AdminLiveDirectory;
  readonly now: () => Date;
  readonly publicEntry: AdminPublicEntryDirectory;
  /** The canonical public web origin, when this environment has one at all. */
  readonly publicWebOrigin?: string | undefined;
  readonly readiness: DependencyReadinessPort;
  readonly reconciliation: AdminReconciliationDirectory;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const maximumWindowHours = 24 * 30;
const defaultWindowHours = 24;

export class AdminPlatformRoutes {
  constructor(private readonly dependencies: AdminPlatformRoutesDependencies) {}

  async getOperationsState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'operations.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const since = this.windowFrom(new URL(input.request.url).searchParams);
    if (since === undefined) return this.invalid(input);

    const [snapshot, queues, dependencies] = await Promise.all([
      this.dependencies.health.snapshot(since),
      this.dependencies.jobs.inspect(),
      this.dependencies.readiness(),
    ]);

    return {
      body: adminOperationsStateResponseSchema.parse({
        dependencies: dependencies.map((entry) => ({
          ...(entry.adapter === undefined ? {} : { adapter: entry.adapter }),
          name: entry.name,
          state: entry.state,
        })),
        failures: snapshot.failures.map((failure) => ({
          category: failure.category,
          domain: failure.domain,
          latestAt: failure.latestAt.toISOString(),
          total: failure.total,
        })),
        observedAt: this.dependencies.now().toISOString(),
        outboxes: snapshot.outboxes.map((outbox) => ({
          deadLettered: outbox.deadLettered,
          domain: outbox.domain,
          ...(outbox.oldestPendingAt === undefined
            ? {}
            : { oldestPendingAt: outbox.oldestPendingAt.toISOString() }),
          pending: outbox.pending,
        })),
        queues: queues.map((queue) => ({
          ...(queue.active === undefined ? {} : { active: queue.active }),
          ...(queue.completed === undefined
            ? {}
            : { completed: queue.completed }),
          ...(queue.delayed === undefined ? {} : { delayed: queue.delayed }),
          ...(queue.failed === undefined ? {} : { failed: queue.failed }),
          name: queue.name,
          reachable: queue.reachable,
          ...(queue.waiting === undefined ? {} : { waiting: queue.waiting }),
        })),
        since: snapshot.since.toISOString(),
      }),
      status: 200,
    };
  }

  async getLiveState(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'live.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const since = this.windowFrom(new URL(input.request.url).searchParams);
    if (since === undefined) return this.invalid(input);

    const [state, searchAdmitted] = await Promise.all([
      this.dependencies.live.state(since),
      // The control's current value, read the same way LIVE reads it, so the
      // screen showing whether searches are admitted and the code admitting
      // them cannot disagree about it.
      this.dependencies.controls.isEnabled('live.search'),
    ]);

    return {
      body: adminLiveStateResponseSchema.parse({
        encounterStarts: [...state.encounterStarts],
        endReasons: [...state.endReasons],
        liveEncounters: state.liveEncounters,
        observedAt: state.observedAt.toISOString(),
        ...(state.oldestSearchSince === undefined
          ? {}
          : { oldestSearchSince: state.oldestSearchSince.toISOString() }),
        participations: [...state.participations],
        premiumWindows: [...state.premiumWindows],
        searchAdmitted,
        since: state.since.toISOString(),
      }),
      status: 200,
    };
  }

  async getLiveEncounter(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'live.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const encounterId = new URL(input.request.url).searchParams.get(
      'encounterId',
    );
    if (encounterId === null || !uuidPattern.test(encounterId)) {
      return this.invalid(input);
    }
    const detail = await this.dependencies.live.encounter(encounterId);
    if (detail === undefined) return this.notFound(input);

    return {
      body: adminLiveEncounterResponseSchema.parse({
        createdAt: detail.createdAt.toISOString(),
        ...(detail.endReason === undefined
          ? {}
          : { endReason: detail.endReason }),
        ...(detail.endedAt === undefined
          ? {}
          : { endedAt: detail.endedAt.toISOString() }),
        id: detail.id,
        ...(detail.introduction === undefined
          ? {}
          : {
              introduction: {
                createdAt: detail.introduction.createdAt.toISOString(),
                state: detail.introduction.state,
              },
            }),
        medium: detail.medium,
        participants: [...detail.participants],
        premiumWindows: detail.premiumWindows,
        ...(detail.realtimeSessionId === undefined
          ? {}
          : { realtimeSessionId: detail.realtimeSessionId }),
        safety: {
          blocks: detail.safety.blocks,
          reports: detail.safety.reports,
        },
        state: detail.state,
      }),
      status: 200,
    };
  }

  async getWallet(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'wallet.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const query = new URL(input.request.url).searchParams;
    const accountId = query.get('accountId');
    if (accountId === null || !uuidPattern.test(accountId)) {
      return this.invalid(input);
    }
    const rawCursor = query.get('cursor');
    if (rawCursor !== null && !/^\d{1,19}$/u.test(rawCursor)) {
      return this.invalid(input);
    }

    const detail = await this.dependencies.reconciliation.wallet({
      ...(rawCursor === null ? {} : { cursor: rawCursor }),
      userId: accountId,
    });
    if (detail === undefined) return this.notFound(input);

    return {
      body: adminWalletResponseSchema.parse({
        available: detail.available,
        entries: detail.entries.map((entry) => ({
          amount: entry.amount,
          businessType: entry.businessType,
          direction: entry.direction,
          occurredAt: entry.occurredAt.toISOString(),
          reason: entry.reason,
          transactionId: entry.transactionId,
        })),
        entriesTotal: detail.entriesTotal,
        ...(detail.nextCursor === undefined
          ? {}
          : { nextCursor: detail.nextCursor }),
        reserved: detail.reserved,
        userId: detail.userId,
      }),
      status: 200,
    };
  }

  async getReconciliation(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'billing.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const findings = await this.dependencies.reconciliation.findings();
    return {
      body: adminReconciliationResponseSchema.parse({
        findings: findings.map((finding) => ({
          definition: finding.definition,
          examples: [...finding.examples],
          key: finding.key,
          total: finding.total,
        })),
        observedAt: this.dependencies.now().toISOString(),
      }),
      status: 200,
    };
  }

  async getPublicEntry(input: RouteRequest): Promise<RouteResult> {
    const resolved = await this.dependencies.adminContext.resolve(
      input,
      'growth.read',
    );
    if ('failure' in resolved) return resolved.failure;

    const state = await this.dependencies.publicEntry.state();
    const origin = this.dependencies.publicWebOrigin;
    return {
      body: adminPublicEntryResponseSchema.parse({
        ...(origin === undefined ? {} : { canonicalOrigin: origin }),
        environment: this.dependencies.environment,
        // The same two conditions Consumer Web applies, stated here so an
        // operator can see *which* of them is missing rather than only that
        // nothing is indexed.
        indexable:
          this.dependencies.environment === 'production' &&
          origin !== undefined,
        liveWindows: state.liveWindows,
        observedAt: state.observedAt.toISOString(),
        publishedClubs: state.publishedClubs,
        publishedCreators: state.publishedCreators,
      }),
      status: 200,
    };
  }

  private windowFrom(query: URLSearchParams): Date | undefined {
    const raw = query.get('hours');
    const now = this.dependencies.now();
    if (raw === null) {
      return new Date(now.getTime() - defaultWindowHours * 3_600_000);
    }
    if (!/^[1-9][0-9]{0,3}$/u.test(raw)) return undefined;
    const hours = Number.parseInt(raw, 10);
    if (hours > maximumWindowHours) return undefined;
    return new Date(now.getTime() - hours * 3_600_000);
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
