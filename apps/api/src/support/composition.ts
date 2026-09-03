import type { SafeLogger } from '@velora/observability/server';

import type { AdminContextResolver } from '../admin/context.js';
import type { DatabaseHandle } from '../database/executor.js';
import type { ConsumerContextResolver } from '../users/context.js';
import { AdminSupportRoutes } from './admin-routes.js';
import { SupportRepository } from './repository.js';
import { SupportRoutes } from './routes.js';
import { SupportService } from './service.js';

export interface SupportRuntime {
  readonly adminRoutes: AdminSupportRoutes;
  readonly repository: SupportRepository;
  readonly routes: SupportRoutes;
  readonly service: SupportService;
}

/**
 * SUPPORT, composed.
 *
 * The shortest composition in the repository, and that is the point. There is
 * no provider, no adapter registry, no configuration value, and no environment
 * in which this domain is unavailable: a support ticket is a row in VELORA's
 * own database, answered by VELORA's own operators through Platform Admin.
 *
 * That was a deliberate choice over any hosted help desk. The one path a person
 * uses when everything else about the product has failed them must not itself
 * depend on something that can fail, cost money, or be switched off — and a
 * support flow that refuses because a vendor is unreachable is the exact
 * failure the reviews this exists for are complaining about.
 */
export function createSupportRuntime(dependencies: {
  readonly adminContext: AdminContextResolver;
  readonly consumerContext: ConsumerContextResolver;
  readonly database: DatabaseHandle;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
}): SupportRuntime {
  const repository = new SupportRepository(dependencies.database);
  const service = new SupportService({
    logger: dependencies.logger,
    now: dependencies.now ?? (() => new Date()),
    repository,
  });
  return {
    adminRoutes: new AdminSupportRoutes({
      adminContext: dependencies.adminContext,
      support: service,
    }),
    repository,
    routes: new SupportRoutes({
      consumerContext: dependencies.consumerContext,
      support: service,
    }),
    service,
  };
}
