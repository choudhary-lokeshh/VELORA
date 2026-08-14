import {
  localTestNotificationChannel,
  unavailableNotificationChannel,
  type ServerConfig,
} from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';

import type { DatabaseHandle } from '../database/executor.js';
import type { ConsumerContextResolver } from '../users/context.js';
import {
  LocalTestNotificationChannel,
  UnavailableNotificationChannel,
  type NotificationChannelPort,
} from './channel.js';
import { NotificationDeliveryService } from './delivery.js';
import { NotificationFeedService } from './feed.js';
import {
  createNotificationIntakes,
  type NotificationIntake,
} from './intake.js';
import { NotificationRepository } from './repository.js';
import { NotificationRoutes } from './routes.js';
import type {
  NotificationSafetyPort,
  RecipientStandingPort,
} from './safety.js';

export interface NotificationsRuntime {
  readonly channel: NotificationChannelPort;
  readonly delivery: NotificationDeliveryService;
  /** The outbox consumers that turn published facts into owed notices. */
  readonly intakes: readonly NotificationIntake[];
  readonly repository: NotificationRepository;
}

/**
 * The read surface, and only the read surface.
 *
 * Composed separately because the two processes need different halves of this
 * domain and pretending otherwise costs correctness. The API serves the in-app
 * feed and never delivers; the worker delivers and serves nothing. Splitting
 * the roots means the API never constructs a delivery channel it will not use,
 * and the worker never holds an HTTP handler with no way to authenticate a
 * caller.
 */
export interface NotificationsApiRuntime {
  readonly feed: NotificationFeedService;
  readonly repository: NotificationRepository;
  readonly routes: NotificationRoutes;
}

/**
 * Delivery channel registry. A configured name with no entry is an error rather
 * than a silent default, on the same rule as the USERS registries: a missing
 * delivery adapter must never resolve to one that sends.
 */
const notificationChannels: Readonly<
  Record<string, () => NotificationChannelPort>
> = {
  [localTestNotificationChannel]: () => new LocalTestNotificationChannel(),
  [unavailableNotificationChannel]: () => new UnavailableNotificationChannel(),
};

function selectChannel(config: ServerConfig): NotificationChannelPort {
  const build = notificationChannels[config.NOTIFICATIONS_DELIVERY_CHANNEL];
  if (build === undefined) {
    throw new Error('No approved notification delivery channel is configured');
  }
  return build();
}

/**
 * NOTIFICATIONS composition root.
 *
 * It receives the two published contracts it is allowed to ask — TRUST &
 * SAFETY's eligibility answer and USERS' account standing — rather than reading
 * either domain's tables. This domain writes nothing outside `notifications_`,
 * and it reads no source domain's outbox: the relay hands it facts.
 */
export function createNotificationsRuntime(input: {
  readonly channel?: NotificationChannelPort;
  readonly config: ServerConfig;
  readonly database: DatabaseHandle;
  readonly logger: SafeLogger;
  readonly now?: () => Date;
  /** Identifies this process's claims in the rows it leases. */
  readonly owner?: string;
  readonly safety: NotificationSafetyPort;
  readonly standing: RecipientStandingPort;
  readonly wake?: (intentId: string) => Promise<void>;
}): NotificationsRuntime {
  const now = input.now ?? (() => new Date());
  const repository = new NotificationRepository(input.database);
  const channel = input.channel ?? selectChannel(input.config);
  return {
    channel,
    delivery: new NotificationDeliveryService({
      channel,
      logger: input.logger,
      now,
      owner: input.owner ?? `notifications-${crypto.randomUUID()}`,
      repository,
      safety: input.safety,
      standing: input.standing,
    }),
    intakes: createNotificationIntakes({
      logger: input.logger,
      now,
      repository,
      ...(input.wake === undefined ? {} : { wake: input.wake }),
    }),
    repository,
  };
}

/**
 * NOTIFICATIONS' in-app read surface.
 *
 * It asks TRUST & SAFETY the same eligibility question every other domain does
 * and reads nothing but its own tables. It cannot reach a delivery intent: the
 * feed service it is built on has no method that returns one.
 */
export function createNotificationsApiRuntime(input: {
  readonly consumerContext: ConsumerContextResolver;
  readonly database: DatabaseHandle;
  readonly now?: () => Date;
  readonly safety: NotificationSafetyPort;
}): NotificationsApiRuntime {
  const repository = new NotificationRepository(input.database);
  const feed = new NotificationFeedService({
    now: input.now ?? (() => new Date()),
    repository,
    safety: input.safety,
  });
  return {
    feed,
    repository,
    routes: new NotificationRoutes({
      consumerContext: input.consumerContext,
      feed,
    }),
  };
}
