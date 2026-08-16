import { loadServerConfig, type ServerConfig } from '@velora/config/server';
import type { SafeLogger } from '@velora/observability/server';
import { drizzle } from 'drizzle-orm/bun-sql';

import {
  createAuthRuntime,
  type AuthRuntime,
} from '../../src/auth/composition.js';
import {
  createAdminRuntime,
  type AdminRuntime,
} from '../../src/admin/composition.js';
import type { CallerResolver } from '../../src/auth/caller.js';
import {
  createBillingRuntime,
  type BillingRuntime,
} from '../../src/billing/composition.js';
import {
  createClubsRuntime,
  type ClubsRuntime,
} from '../../src/clubs/composition.js';
import { ClubSafetyDirectory } from '../../src/clubs/safety-directory.js';
import {
  createCreatorsRuntime,
  type CreatorsRuntime,
} from '../../src/creators/composition.js';
import { InMemoryRateLimiter } from '../../src/auth/rate-limit.js';
import { DatabaseAdmission } from '../../src/database/admission.js';
import type { AuthDatabase } from '../../src/auth/repository.js';
import {
  createUsersRuntime,
  type UsersRuntime,
} from '../../src/users/composition.js';
import {
  createDiscoveryRuntime,
  type DiscoveryRuntime,
} from '../../src/discovery/composition.js';
import {
  createMessagingRuntime,
  type MessagingRuntime,
} from '../../src/messaging/composition.js';
import { ConversationEnforcement } from '../../src/messaging/enforcement.js';
import { ConversationParticipation } from '../../src/messaging/participation.js';
import {
  createNotificationsApiRuntime,
  type NotificationsApiRuntime,
} from '../../src/notifications/composition.js';
import {
  createPayoutsRuntime,
  type PayoutsRuntime,
} from '../../src/payouts/composition.js';
import {
  createMediaRuntime,
  type MediaRuntime,
} from '../../src/media/composition.js';
import {
  createSafetyRuntime,
  type SafetyRuntime,
} from '../../src/safety/composition.js';
import type { SafetyEligibilityPort } from '../../src/messaging/safety.js';
import type { UsersDatabase } from '../../src/users/repository.js';

export const testConsumerOrigin = 'http://127.0.0.1:3000';
export const testCreatorOrigin = 'http://127.0.0.1:3001';
export const testAdminOrigin = 'http://127.0.0.1:3002';
export const testForeignOrigin = 'https://evil.test';

/**
 * The admission bound a suite's own pool wants.
 *
 * Production admits eight against a pool of ten; `connectDatabase` opens twenty
 * for a suite, so the same ratio is sixteen. The wait is long because these
 * suites fire far more simultaneous requests at one pair than a person could,
 * and what they are testing is idempotency and serialization rather than what
 * an instance says when it runs out of room. The production values — eight, and
 * a 250 ms wait ending in a 503 — are exercised against the real
 * `DatabaseService` in `test/integration/database-pool-hardening.test.ts`.
 */
export function testDatabaseAdmission(): DatabaseAdmission {
  return new DatabaseAdmission({ limit: 16, waitMilliseconds: 15_000 });
}

export function silentLogger(records: unknown[] = []): SafeLogger {
  const record = (
    fields: Readonly<Record<string, unknown>>,
    message: string,
  ) => {
    records.push({ fields, message });
  };
  return {
    debug: record,
    error: record,
    fatal: record,
    info: record,
    trace: record,
    warn: record,
  };
}

/**
 * Builds a configuration through the real schema, so a test can never assert
 * against a shape the production loader would refuse.
 */
export function testServerConfig(
  overrides: Readonly<Record<string, string | undefined>> = {},
): ServerConfig {
  return loadServerConfig({
    APP_ENV: 'test',
    AUTH_BROWSER_ORIGINS_CONSUMER_WEB: testConsumerOrigin,
    AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: testCreatorOrigin,
    AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: testAdminOrigin,
    DATABASE_URL: 'postgresql://local:local@127.0.0.1:1/velora',
    EPHEMERAL_REDIS_URL: 'redis://127.0.0.1:1/0',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    PORT: '4000',
    QUEUE_REDIS_URL: 'redis://127.0.0.1:1/1',
    ...overrides,
  });
}

export function testAuthRuntime(input: {
  readonly config: ServerConfig;
  readonly database?: AuthDatabase;
  readonly logger?: SafeLogger;
  readonly now?: () => Date;
}): AuthRuntime {
  return createAuthRuntime({
    config: input.config,
    // `drizzle.mock()` has no connection, so any query throws. Tests that only
    // exercise pre-database rejections use it; behaviour that touches storage
    // runs against real PostgreSQL in the integration suite.
    database: input.database ?? drizzle.mock(),
    logger: input.logger ?? silentLogger(),
    options: {
      rateLimiter: new InMemoryRateLimiter(),
      ...(input.now === undefined ? {} : { now: input.now }),
      requesterReference: (request) =>
        request.headers.get('x-velora-device') ?? 'test-requester',
    },
  });
}

export function testUsersRuntime(input: {
  readonly auth: AuthRuntime;
  readonly config: ServerConfig;
  readonly database?: UsersDatabase;
  readonly logger?: SafeLogger;
  readonly now?: () => Date;
}): UsersRuntime {
  return createUsersRuntime({
    caller: input.auth.caller,
    config: input.config,
    // As above: a mock database throws on any query, so only tests that stop
    // before storage use the default.
    database: input.database ?? drizzle.mock(),
    logger: input.logger ?? silentLogger(),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/**
 * DISCOVERY wired to the same database and USERS runtime the caller is using,
 * so a test never ends up with two views of the same data.
 */
export function testDiscoveryRuntime(input: {
  readonly database?: UsersDatabase;
  readonly logger?: SafeLogger;
  readonly now?: () => Date;
  readonly safety: SafetyRuntime;
  readonly users: UsersRuntime;
}): DiscoveryRuntime {
  return createDiscoveryRuntime({
    consumerContext: input.users.consumerContext,
    database: input.database ?? drizzle.mock(),
    directory: input.users.directory,
    logger: input.logger ?? silentLogger(),
    ...(input.now === undefined ? {} : { now: input.now }),
    onboarding: input.users.onboarding,
    safety: input.safety.directory,
  });
}

/**
 * TRUST & SAFETY wired to the same database and USERS runtime. Its two
 * enforcement contracts are the real ones; nothing here reaches past a
 * published contract into another domain's tables.
 */
export function testSafetyRuntime(input: {
  readonly config: ServerConfig;
  readonly creators: CreatorsRuntime;
  readonly database?: UsersDatabase;
  readonly now?: () => Date;
  readonly users: UsersRuntime;
}): SafetyRuntime {
  const database = input.database ?? drizzle.mock();
  return createSafetyRuntime({
    accounts: input.users.enforcement,
    catalog: new ClubSafetyDirectory(),
    config: input.config,
    consumerContext: input.users.consumerContext,
    consumers: input.users.existence,
    conversations: new ConversationEnforcement(database),
    conversationTargets: new ConversationParticipation(),
    creators: input.creators.directory,
    database,
    ...(input.now === undefined ? {} : { now: input.now }),
    users: input.users.service,
  });
}

/**
 * MESSAGING wired to the same database, USERS runtime, and DISCOVERY connection
 * contract the caller is using.
 *
 * The safety adapter comes from configuration, exactly as it does in
 * production. A test that wants a blocked pair supplies its own port rather
 * than reaching past the registry, so no test can accidentally exercise a
 * combination configuration would refuse.
 */
export function testMessagingRuntime(input: {
  readonly config: ServerConfig;
  readonly database?: UsersDatabase;
  readonly discovery: DiscoveryRuntime;
  readonly now?: () => Date;
  readonly safety?: SafetyEligibilityPort;
  readonly users: UsersRuntime;
}): MessagingRuntime {
  return createMessagingRuntime({
    config: input.config,
    connections: input.discovery.connections,
    consumerContext: input.users.consumerContext,
    database: input.database ?? drizzle.mock(),
    directory: input.users.directory,
    ...(input.now === undefined ? {} : { now: input.now }),
    onboarding: input.users.onboarding,
    ...(input.safety === undefined ? {} : { safety: input.safety }),
  });
}

/**
 * NOTIFICATIONS' in-app read surface, wired to the same database and the real
 * TRUST & SAFETY eligibility contract. Delivery is not composed here: it lives
 * in the worker, and a suite that wants it builds the worker runtime instead.
 */
export function testNotificationsApiRuntime(input: {
  readonly database?: UsersDatabase;
  readonly now?: () => Date;
  readonly safety: SafetyRuntime;
  readonly users: UsersRuntime;
}): NotificationsApiRuntime {
  return createNotificationsApiRuntime({
    consumerContext: input.users.consumerContext,
    database: input.database ?? drizzle.mock(),
    ...(input.now === undefined ? {} : { now: input.now }),
    safety: input.safety.directory,
  });
}

/**
 * CREATORS wired to the same database, taking USERS' real published adult
 * standing contract. A suite that wants an ineligible principal makes them
 * ineligible in USERS rather than substituting the port, so no test can prove a
 * gate that production would decide differently.
 */
export function testCreatorsRuntime(input: {
  readonly caller: CallerResolver;
  readonly database?: UsersDatabase;
  readonly now?: () => Date;
  readonly users: UsersRuntime;
}): CreatorsRuntime {
  return createCreatorsRuntime({
    caller: input.caller,
    database: input.database ?? drizzle.mock(),
    eligibility: input.users.adultStanding,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

/**
 * PRIVATE CLUBS wired to the same database, taking CREATORS' real published
 * directory. A suite that wants a suspended creator suspends them in CREATORS
 * rather than substituting the port, so no test can prove a gate that
 * production would decide differently.
 */
export function testClubsRuntime(input: {
  readonly config: ServerConfig;
  readonly creators: CreatorsRuntime;
  readonly database?: UsersDatabase;
  readonly now?: () => Date;
  readonly users: UsersRuntime;
}): ClubsRuntime {
  return createClubsRuntime({
    config: input.config,
    consumerContext: input.users.consumerContext,
    creatorContext: input.creators.creatorContext,
    creators: input.creators.directory,
    database: input.database ?? drizzle.mock(),
    ...(input.now === undefined ? {} : { now: input.now }),
    standing: input.users.adultStanding,
  });
}

/**
 * ADMIN wired to the repositories of the domains it operates. It owns no
 * database of its own, so there is nothing here to substitute: an operation
 * either goes through the owning domain or it does not happen.
 */
export function testAdminRuntime(input: {
  readonly billing: BillingRuntime;
  readonly caller: CallerResolver;
  readonly config: ServerConfig;
  readonly clubs: ClubsRuntime;
  readonly creators: CreatorsRuntime;
  readonly database?: UsersDatabase;
  readonly now?: () => Date;
  readonly safety: SafetyRuntime;
}): AdminRuntime {
  const database = input.database ?? drizzle.mock();
  return createAdminRuntime({
    caller: input.caller,
    capabilities: {
      commerceEligibility: input.config.BILLING_COMMERCE_ELIGIBILITY,
      commercePolicy: input.config.BILLING_COMMERCE_POLICY,
      paymentProvider: input.config.BILLING_PAYMENT_PROVIDER,
      payoutPolicy: input.config.PAYOUTS_POLICY,
      payoutProvider: input.config.PAYOUTS_PROVIDER,
      taxAuthority: input.config.BILLING_TAX_AUTHORITY,
    },
    clubs: input.clubs.clubRepository,
    content: input.clubs.repository,
    creators: input.creators.repository,
    database,
    ...(input.now === undefined ? {} : { now: input.now }),
    profiles: input.creators.profileRepository,
    refunds: input.billing.refunds,
    appeals: input.safety.appeals,
    moderation: input.safety.moderation,
    safety: input.safety.authority,
  });
}

/**
 * Every product domain built together over one database and one USERS runtime,
 * for suites that only need the domains present rather than exercised.
 *
 * An injected database requires every product runtime, because the application
 * refuses to wire domains to a database it was not given — so this returns the
 * whole set rather than only the consumer half.
 */
/**
 * BILLING wired to the same database, taking CREATORS' real eligibility answer
 * and PRIVATE CLUBS' real resource contract. A suite that wants an unpublished
 * club unpublishes it rather than substituting the port, so no test can prove a
 * gate that production would decide differently. The commerce policy comes from
 * configuration exactly as it does in production.
 */
export function testBillingRuntime(input: {
  readonly clubs: ClubsRuntime;
  readonly config: ServerConfig;
  readonly creators: CreatorsRuntime;
  readonly database?: UsersDatabase;
  readonly now?: () => Date;
  readonly users: UsersRuntime;
}): BillingRuntime {
  return createBillingRuntime({
    config: input.config,
    consumerContext: input.users.consumerContext,
    consumers: input.users.adultStanding,
    creatorContext: input.creators.creatorContext,
    creators: input.creators.directory,
    database: input.database ?? drizzle.mock(),
    ...(input.now === undefined ? {} : { now: input.now }),
    resources: input.clubs.commercialDirectory,
  });
}

/**
 * PAYOUTS wired to the same database and CREATORS runtime. Both adapters come
 * from configuration exactly as they do in production, so no test can exercise
 * a combination configuration would refuse.
 */
export function testPayoutsRuntime(input: {
  readonly config: ServerConfig;
  readonly creators: CreatorsRuntime;
  readonly database?: UsersDatabase;
  readonly logger?: SafeLogger;
  readonly now?: () => Date;
}): PayoutsRuntime {
  return createPayoutsRuntime({
    config: input.config,
    creatorContext: input.creators.creatorContext,
    database: input.database ?? drizzle.mock(),
    logger: input.logger ?? silentLogger(),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export function testMediaRuntime(input: {
  readonly config: ServerConfig;
  readonly database?: UsersDatabase;
  readonly logger?: SafeLogger;
  readonly now?: () => Date;
}): MediaRuntime {
  return createMediaRuntime({
    config: input.config,
    database: input.database ?? drizzle.mock(),
    logger: input.logger ?? silentLogger(),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
}

export function testProductRuntimes(input: {
  readonly caller: CallerResolver;
  readonly config: ServerConfig;
  readonly database?: UsersDatabase;
  readonly logger?: SafeLogger;
  readonly now?: () => Date;
  readonly users: UsersRuntime;
}): {
  readonly admin: AdminRuntime;
  readonly billing: BillingRuntime;
  readonly clubs: ClubsRuntime;
  readonly creators: CreatorsRuntime;
  readonly discovery: DiscoveryRuntime;
  readonly media: MediaRuntime;
  readonly messaging: MessagingRuntime;
  readonly notifications: NotificationsApiRuntime;
  readonly payouts: PayoutsRuntime;
  readonly safety: SafetyRuntime;
} {
  // CREATORS and PRIVATE CLUBS first: TRUST & SAFETY consumes two narrow
  // answers from them about what a report may name, and neither consumes
  // anything of SAFETY's, so the order is the contract direction.
  const creators = testCreatorsRuntime(input);
  const clubs = testClubsRuntime({ ...input, creators });
  const safety = testSafetyRuntime({ ...input, creators });
  const discovery = testDiscoveryRuntime({ ...input, safety });
  // BILLING before ADMIN, exactly as the application composes them: an operator
  // reversal is BILLING's decision taken with an operator's authority, so ADMIN
  // receives the service rather than a database of its own.
  const billing = testBillingRuntime({ ...input, clubs, creators });
  return {
    admin: testAdminRuntime({ ...input, billing, clubs, creators, safety }),
    billing,
    clubs,
    creators,
    discovery,
    // MEDIA consumes nothing and is consumed by nothing yet, so its position
    // here is alphabetical rather than meaningful.
    media: testMediaRuntime(input),
    messaging: testMessagingRuntime({
      ...input,
      discovery,
      safety: safety.directory,
    }),
    notifications: testNotificationsApiRuntime({ ...input, safety }),
    payouts: testPayoutsRuntime({ ...input, creators }),
    safety,
  };
}
