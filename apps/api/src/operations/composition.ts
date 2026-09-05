import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import { CachedControlReader } from './controls.js';
import { OperationsRepository } from './repository.js';
import { OperationsService } from './service.js';

export interface OperationsRuntime {
  /**
   * The reader every governed feature consults. Published here so LIVE and
   * GROWTH can be handed the one question each of them asks without either
   * learning that a control store exists.
   */
  readonly controls: CachedControlReader;
  readonly repository: OperationsRepository;
  readonly service: OperationsService;
}

/**
 * OPERATIONS, composed.
 *
 * One configuration value, and it decides exactly one thing: whether an
 * operator with no grant is treated as a super administrator. That is the
 * bootstrap a developer needs on a freshly seeded database and the exact thing
 * a deployed environment must never do, which is why configuration refuses it
 * outside local and test rather than this module deciding by environment name.
 *
 * Composed early. ADMIN's context resolver consults the standing this runtime
 * publishes on every operator request, and LIVE and GROWTH consult its control
 * reader on their own paths, so it has to exist before any of the three.
 */
export function createOperationsRuntime(dependencies: {
  /** True only where configuration selected the local-test operator bootstrap. */
  readonly bootstrapOperators: boolean;
  readonly database: DatabaseHandle;
  readonly identifiers?: () => string;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
}): OperationsRuntime {
  const repository = new OperationsRepository(dependencies.database);
  const now = dependencies.now ?? (() => new Date());
  const controls = new CachedControlReader({
    // The control cache measures elapsed time, and a suite that moves an
    // injected clock moves it too — otherwise a test that flips a control and
    // reads it back would be answered from a cache the clock cannot age out.
    monotonic: () => now().getTime(),
    now,
    repository,
  });
  return {
    controls,
    repository,
    service: new OperationsService({
      bootstrapOperators: dependencies.bootstrapOperators,
      controls,
      ...(dependencies.identifiers === undefined
        ? {}
        : { identifiers: dependencies.identifiers }),
      logger: dependencies.logger,
      now,
      repository,
    }),
  };
}
