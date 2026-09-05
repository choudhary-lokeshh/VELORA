import type { SafeLogger } from '@velora/observability/server';

import type { AdminContextResolver } from '../admin/context.js';
import type { DatabaseHandle } from '../database/executor.js';
import type { ConsumerContextResolver } from '../users/context.js';
import { AdminGrowthRoutes } from './admin-routes.js';
import { GrowthRepository } from './repository.js';
import { GrowthRoutes } from './routes.js';
import { GrowthService } from './service.js';

export interface GrowthRuntime {
  readonly adminRoutes: AdminGrowthRoutes;
  readonly repository: GrowthRepository;
  readonly routes: GrowthRoutes;
  readonly service: GrowthService;
}

/**
 * GROWTH, composed.
 *
 * No provider, no adapter, no configuration value, and no environment in which
 * it is unavailable — which is the whole point of the domain. VELORA has no
 * acquisition budget, so every mechanism here had to be one the platform can
 * run on its own database: an invitation is a row, an attribution is a row, and
 * a scheduled time is two instants. Nothing in it can be switched off by a
 * vendor, and nothing in it costs anything to run.
 *
 * The random source is injected for one reason: a test that cannot make an
 * invitation code predictable would have to assert on a value it could not
 * name. Production passes the platform's own.
 */
export function createGrowthRuntime(dependencies: {
  readonly adminContext: AdminContextResolver;
  readonly consumerContext: ConsumerContextResolver;
  readonly database: DatabaseHandle;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  readonly randomBytes?: (size: number) => Uint8Array;
}): GrowthRuntime {
  const repository = new GrowthRepository(dependencies.database);
  const service = new GrowthService({
    logger: dependencies.logger,
    now: dependencies.now ?? (() => new Date()),
    randomBytes:
      dependencies.randomBytes ??
      ((size) => crypto.getRandomValues(new Uint8Array(size))),
    repository,
  });
  return {
    adminRoutes: new AdminGrowthRoutes({
      adminContext: dependencies.adminContext,
      growth: service,
    }),
    repository,
    routes: new GrowthRoutes({
      consumerContext: dependencies.consumerContext,
      growth: service,
    }),
    service,
  };
}
