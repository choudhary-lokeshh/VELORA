import type { SafeLogger } from '@velora/observability/server';

import type { AuthService } from '../auth/service.js';
import type { NotificationRepository } from '../notifications/repository.js';
import { AccountClosureRoutes } from './closure-routes.js';
import {
  AccountClosureService,
  type ClosureAuthorityPort,
  type ClosureCallPort,
  type ClosureDestinationPort,
  type ClosureLivePort,
} from './closure.js';
import { AvailabilityRepository } from './availability.js';
import type { ConsumerContextResolver } from './context.js';
import type { UsersDatabase, UsersRepository } from './repository.js';

export interface AccountClosureRuntime {
  readonly routes: AccountClosureRoutes;
  readonly service: AccountClosureService;
}

/**
 * Account closure, composed last.
 *
 * It sits outside `createUsersRuntime` for one mechanical reason: closure has
 * to reach AUTH, NOTIFICATIONS, and LIVE, and USERS is composed before all
 * three because each of them consumes something USERS publishes. Composing this
 * separately keeps the direction of every dependency the same as it already is
 * and needs no late setter.
 *
 * The account transition itself is still USERS' own — it writes `users_accounts`
 * through USERS' repository and nothing else does. What the other three provide
 * are their own published contracts over their own rows: AUTH revokes the
 * authority it issued, NOTIFICATIONS retires the registrations it holds, and
 * LIVE ends the encounter it allocated. No domain writes another's table.
 */
export function createAccountClosureRuntime(dependencies: {
  readonly auth: AuthService;
  readonly consumerContext: ConsumerContextResolver;
  /**
   * USERS' own database handle.
   *
   * The availability repository is constructed here rather than taken from the
   * USERS runtime, which does not publish it. It is a stateless query object
   * over the same handle and over this domain's own table, so a second instance
   * is the same reader rather than a second source of truth.
   */
  readonly calls?: ClosureCallPort;
  readonly database: UsersDatabase;
  readonly devices: NotificationRepository;
  readonly live?: ClosureLivePort;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  readonly repository: UsersRepository;
}): AccountClosureRuntime {
  const now = dependencies.now ?? (() => new Date());
  const availability = new AvailabilityRepository(dependencies.database);

  const authority: ClosureAuthorityPort = {
    async revokeAllAuthority(input) {
      await dependencies.auth.revokeAllAuthority({
        accountId: input.accountId,
        // The audience recorded on the security event. `consumer_web` because
        // closure is a consumer act; the revocation itself covers every
        // audience the account holds, which is what the method does.
        audience: 'consumer_web',
        correlationId: input.correlationId,
        reason: 'account_closed',
      });
    },
  };

  const destinations: ClosureDestinationPort = {
    async retireDevices(recipientId) {
      return dependencies.devices.transaction(async (executor) =>
        dependencies.devices.disableDevicesForRecipient(executor, {
          now: now(),
          reason: 'account_closed',
          recipientId,
        }),
      );
    },
  };

  const service = new AccountClosureService({
    authority,
    availability: {
      close: async (input) => {
        await availability.close(input.executor, {
          now: input.now,
          userId: input.userId,
        });
      },
    },
    ...(dependencies.calls === undefined ? {} : { calls: dependencies.calls }),
    destinations,
    ...(dependencies.live === undefined ? {} : { live: dependencies.live }),
    logger: dependencies.logger,
    now,
    repository: dependencies.repository,
  });

  return {
    routes: new AccountClosureRoutes({
      closure: service,
      consumerContext: dependencies.consumerContext,
    }),
    service,
  };
}
