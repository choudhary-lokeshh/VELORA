import {
  disabledAiKillSwitch,
  localTestAiProvider,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { CallerResolver } from '../auth/caller.js';
import type { DatabaseHandle } from '../database/executor.js';
import type { CreatorsService } from '../creators/service.js';
import type { UsersService } from '../users/service.js';
import { AiGateway } from './gateway.js';
import { LocalTestAiProvider } from './local-test-provider.js';
import { UnavailableAiProvider, type AiProvider } from './provider.js';
import { registeredModelFor } from './registry.js';
import { AiRepository } from './repository.js';
import { AiRoutes } from './routes.js';

export interface AiRuntime {
  readonly gateway: AiGateway;
  readonly repository: AiRepository;
  readonly routes: AiRoutes;
}

export function createAiRuntime(input: {
  readonly caller: CallerResolver;
  readonly config: ServerConfig;
  readonly creators: CreatorsService;
  readonly database: DatabaseHandle;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  /** Test seam: production selects only through validated configuration. */
  readonly provider?: AiProvider;
  /** Test seam for deterministic timeout coverage. */
  readonly timeoutMilliseconds?: number;
  readonly users: UsersService;
}): AiRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new AiRepository(input.database);
  const provider =
    input.provider ??
    (input.config.AI_PROVIDER === localTestAiProvider
      ? new LocalTestAiProvider()
      : new UnavailableAiProvider());
  if (
    input.provider === undefined &&
    provider.id !== 'unavailable' &&
    registeredModelFor(provider) === undefined
  ) {
    throw new Error('AI_PROVIDER_MODEL_ROUTE_NOT_REGISTERED');
  }
  const gateway = new AiGateway({
    enabled: input.config.AI_KILL_SWITCH === disabledAiKillSwitch,
    environment: input.config.APP_ENV,
    logger: input.logger,
    now,
    provider,
    repository,
    ...(input.timeoutMilliseconds === undefined
      ? {}
      : { timeoutMilliseconds: input.timeoutMilliseconds }),
  });
  return {
    gateway,
    repository,
    routes: new AiRoutes({
      caller: input.caller,
      creators: input.creators,
      gateway,
      now,
      users: input.users,
    }),
  };
}
