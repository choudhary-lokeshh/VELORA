import { Elysia } from 'elysia';
import { loadServerConfig, type ServerConfig } from '@velora/config/server';
import {
  apiErrorCodes,
  apiErrorSchema,
  apiRoutePaths,
  livenessResponseSchema,
  maximumRequestBodyBytes,
  readinessResponseSchema,
  retryAfterResponseHeader,
  retryAfterSeconds,
} from '@velora/validation';
import {
  correlationHeader,
  createLogger,
  getTracer,
  sanitizeUrlForLogging,
  type SafeLogger,
} from '@velora/observability/server';

import { createAuthRuntime, type AuthRuntime } from './auth/composition.js';
import { createAdminRuntime, type AdminRuntime } from './admin/composition.js';
import {
  createBillingRuntime,
  type BillingRuntime,
} from './billing/composition.js';
import { createClubsRuntime, type ClubsRuntime } from './clubs/composition.js';
import { ClubSafetyDirectory } from './clubs/safety-directory.js';
import {
  createCreatorsRuntime,
  type CreatorsRuntime,
} from './creators/composition.js';
import {
  createDiscoveryRuntime,
  type DiscoveryRuntime,
} from './discovery/composition.js';
import {
  createMessagingRuntime,
  type MessagingRuntime,
} from './messaging/composition.js';
import { ConversationEnforcement } from './messaging/enforcement.js';
import { ConversationParticipation } from './messaging/participation.js';
import {
  createNotificationsApiRuntime,
  type NotificationsApiRuntime,
} from './notifications/composition.js';
import {
  createPayoutsRuntime,
  type PayoutsRuntime,
} from './payouts/composition.js';
import {
  createSafetyRuntime,
  type SafetyRuntime,
} from './safety/composition.js';
import { createUsersRuntime, type UsersRuntime } from './users/composition.js';
import { RedisHealthService } from './cache/redis.service.js';
import {
  DatabaseAdmission,
  DatabaseSaturatedError,
} from './database/admission.js';
import {
  DatabaseService,
  type HealthDependency,
} from './database/database.service.js';
import { normalizeCorrelationId } from './http/correlation.js';
import type { RouteRequest, RouteResult } from './http/route-kit.js';
import { corsHeadersFor, isPreflight, preflightResponse } from './http/cors.js';
import { apiSecurityHeaders } from './http/security-headers.js';
import {
  DenyAllOutboundHttp,
  type OutboundHttpPort,
} from './security/ports.js';

export { maximumRequestBodyBytes } from '@velora/validation';

export interface ApplicationDependencies {
  readonly admin: AdminRuntime;
  readonly auth: AuthRuntime;
  readonly billing: BillingRuntime;
  readonly clubs: ClubsRuntime;
  readonly database: HealthDependency;
  /**
   * The process-local bound on work touching the connection pool. It is
   * resource protection only: PostgreSQL stays the correctness authority, and
   * two replicas hold two independent bounds.
   */
  readonly databaseAdmission: DatabaseAdmission;
  readonly creators: CreatorsRuntime;
  readonly discovery: DiscoveryRuntime;
  readonly ephemeralRedis: HealthDependency;
  readonly logger: SafeLogger;
  readonly messaging: MessagingRuntime;
  readonly notifications: NotificationsApiRuntime;
  readonly outboundHttp: OutboundHttpPort;
  readonly payouts: PayoutsRuntime;
  readonly queueRedis: HealthDependency;
  readonly safety: SafetyRuntime;
  readonly users: UsersRuntime;
}

export interface ApplicationOptions {
  readonly config?: ServerConfig;
  readonly dependencies?: Partial<ApplicationDependencies>;
}

export interface ApplicationRuntime {
  readonly app: {
    handle(request: Request): Promise<Response>;
    listen(options: {
      readonly hostname: string;
      readonly port: number;
    }): unknown;
    readonly routes: readonly {
      readonly method: string;
      readonly path: string;
    }[];
    stop(): Promise<unknown>;
  };
  close(): Promise<void>;
  readonly config: ServerConfig;
  readonly dependencies: ApplicationDependencies;
  /**
   * Opens the connection pool before the process accepts traffic. A caller that
   * injected its own database owns its own warm-up, so this is a no-op there.
   */
  warm(): Promise<void>;
}

function statusForElysiaError(code: string | number | symbol): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'VALIDATION') return 422;
  if (code === 'PARSE') return 400;
  return 500;
}

export function createApplication(
  options: ApplicationOptions = {},
): ApplicationRuntime {
  const config = options.config ?? loadServerConfig(process.env);
  const logger =
    options.dependencies?.logger ??
    createLogger({ level: config.LOG_LEVEL, serviceName: 'velora-api' });
  const ownedDependencies: HealthDependency[] = [];
  const injectedDatabase = options.dependencies?.database;
  const injectedAuth = options.dependencies?.auth;
  const ownsAuth = injectedAuth === undefined;

  const injectedUsers = options.dependencies?.users;
  const injectedCreators = options.dependencies?.creators;
  const injectedClubs = options.dependencies?.clubs;
  const injectedBilling = options.dependencies?.billing;
  const injectedAdmin = options.dependencies?.admin;
  const injectedDiscovery = options.dependencies?.discovery;
  const injectedMessaging = options.dependencies?.messaging;
  const injectedNotifications = options.dependencies?.notifications;
  const injectedPayouts = options.dependencies?.payouts;
  const injectedSafety = options.dependencies?.safety;

  let database: HealthDependency;
  let ownedDatabaseService: DatabaseService | undefined;
  let auth: AuthRuntime;
  let users: UsersRuntime;
  let creators: CreatorsRuntime;
  let clubs: ClubsRuntime;
  let billing: BillingRuntime;
  let admin: AdminRuntime;
  let discovery: DiscoveryRuntime;
  let messaging: MessagingRuntime;
  let notifications: NotificationsApiRuntime;
  let payouts: PayoutsRuntime;
  let safety: SafetyRuntime;
  if (injectedDatabase === undefined) {
    const ownedDatabase = new DatabaseService(config);
    ownedDependencies.push(ownedDatabase);
    ownedDatabaseService = ownedDatabase;
    database = ownedDatabase;
    auth =
      injectedAuth ??
      createAuthRuntime({
        config,
        database: ownedDatabase.database,
        logger,
      });
    users =
      injectedUsers ??
      createUsersRuntime({
        caller: auth.caller,
        config,
        database: ownedDatabase.database,
        logger,
      });
    // Composition order follows the contracts, not the domain list.
    //
    // CREATORS depends on USERS' published adult standing and on AUTH's caller
    // resolver, and on nothing else. It is composed before the consumer product
    // domains because none of them depend on it: a creator capability changes
    // nothing about consumer discovery, messaging, or notifications, which is
    // the separation `AGENTS.md` requires.
    creators =
      injectedCreators ??
      createCreatorsRuntime({
        caller: auth.caller,
        database: ownedDatabase.database,
        eligibility: users.adultStanding,
      });
    // PRIVATE CLUBS depends on CREATORS' published directory and on nothing
    // else, so it is composed immediately after it.
    clubs =
      injectedClubs ??
      createClubsRuntime({
        config,
        consumerContext: users.consumerContext,
        creatorContext: creators.creatorContext,
        creators: creators.directory,
        database: ownedDatabase.database,
        standing: users.adultStanding,
      });
    // TRUST & SAFETY publishes the eligibility answer DISCOVERY and MESSAGING
    // both consume, and the enforcement authority ADMIN calls. It consumes the
    // two narrow enforcement contracts USERS and MESSAGING publish, and four
    // narrow answers about what a report may name — an account exists, a public
    // handle resolves, a published item or club exists, somebody is in a
    // conversation. It is composed after CREATORS and PRIVATE CLUBS because two
    // of those answers are theirs; none of them consumes anything of SAFETY's,
    // so there is still no cycle to break with a late setter.
    safety =
      injectedSafety ??
      createSafetyRuntime({
        accounts: users.enforcement,
        catalog: new ClubSafetyDirectory(),
        config,
        consumerContext: users.consumerContext,
        consumers: users.existence,
        conversations: new ConversationEnforcement(ownedDatabase.database),
        conversationTargets: new ConversationParticipation(),
        creators: creators.directory,
        database: ownedDatabase.database,
        users: users.service,
      });
    // BILLING depends on CREATORS' eligibility answer and on PRIVATE CLUBS'
    // published resource contract, so it is composed after both. Neither of
    // them depends on it: a commercial offer changes nothing about a club, and
    // the commercial fact that grants access travels the other way, through the
    // outbox, rather than as a call back into this domain.
    billing =
      injectedBilling ??
      createBillingRuntime({
        config,
        consumerContext: users.consumerContext,
        consumers: users.adultStanding,
        creatorContext: creators.creatorContext,
        creators: creators.directory,
        database: ownedDatabase.database,
        resources: clubs.commercialDirectory,
      });
    // PAYOUTS depends on CREATORS' request resolver and on nothing else. It
    // learns what a creator is owed from a fact BILLING publishes rather than
    // by reading a `billing_` row, so there is no dependency between the two
    // runtimes in either direction.
    payouts =
      injectedPayouts ??
      createPayoutsRuntime({
        config,
        creatorContext: creators.creatorContext,
        database: ownedDatabase.database,
        logger,
      });
    // ADMIN is composed last because it operates every other domain and owns
    // none of them: it takes their repositories and writes through them.
    admin =
      injectedAdmin ??
      createAdminRuntime({
        caller: auth.caller,
        capabilities: {
          commerceEligibility: config.BILLING_COMMERCE_ELIGIBILITY,
          commercePolicy: config.BILLING_COMMERCE_POLICY,
          paymentProvider: config.BILLING_PAYMENT_PROVIDER,
          payoutPolicy: config.PAYOUTS_POLICY,
          payoutProvider: config.PAYOUTS_PROVIDER,
          taxAuthority: config.BILLING_TAX_AUTHORITY,
        },

        clubs: clubs.clubRepository,
        content: clubs.repository,
        creators: creators.repository,
        database: ownedDatabase.database,
        profiles: creators.profileRepository,
        // ADMIN authorizes a reversal and BILLING decides whether it is one it
        // can make. There is no path from an operator to a financial row that
        // does not go through the domain that owns it.
        refunds: billing.refunds,
        safety: safety.authority,
      });
    discovery =
      injectedDiscovery ??
      createDiscoveryRuntime({
        consumerContext: users.consumerContext,
        database: ownedDatabase.database,
        directory: users.directory,
        logger,
        onboarding: users.onboarding,
        safety: safety.directory,
      });
    messaging =
      injectedMessaging ??
      createMessagingRuntime({
        config,
        connections: discovery.connections,
        consumerContext: users.consumerContext,
        database: ownedDatabase.database,
        directory: users.directory,
        onboarding: users.onboarding,
        safety: safety.directory,
      });
    // The in-app read surface only. Delivery lives in the worker, so this
    // process composes no channel and holds no delivery claim.
    notifications =
      injectedNotifications ??
      createNotificationsApiRuntime({
        consumerContext: users.consumerContext,
        database: ownedDatabase.database,
        safety: safety.directory,
      });
  } else {
    // Domains need typed data access, not a health probe. A caller that
    // substitutes the database dependency must therefore supply the domain
    // runtimes too, rather than silently getting ones wired to a database it
    // did not provide — and the admission bound with them, because a bound is
    // sized against the pool it protects and this composition no longer knows
    // which pool that is.
    if (
      injectedAuth === undefined ||
      injectedUsers === undefined ||
      injectedCreators === undefined ||
      injectedClubs === undefined ||
      injectedBilling === undefined ||
      injectedAdmin === undefined ||
      injectedDiscovery === undefined ||
      injectedMessaging === undefined ||
      injectedNotifications === undefined ||
      injectedPayouts === undefined ||
      injectedSafety === undefined ||
      options.dependencies?.databaseAdmission === undefined
    ) {
      throw new Error(
        'An injected database dependency requires injected AUTH, USERS, CREATORS, PRIVATE CLUBS, BILLING, PAYOUTS, ADMIN, DISCOVERY, MESSAGING, NOTIFICATIONS, and SAFETY runtimes and a database admission bound',
      );
    }
    database = injectedDatabase;
    auth = injectedAuth;
    users = injectedUsers;
    creators = injectedCreators;
    clubs = injectedClubs;
    billing = injectedBilling;
    admin = injectedAdmin;
    discovery = injectedDiscovery;
    messaging = injectedMessaging;
    notifications = injectedNotifications;
    payouts = injectedPayouts;
    safety = injectedSafety;
  }

  const ephemeralRedis =
    options.dependencies?.ephemeralRedis ??
    new RedisHealthService(config.EPHEMERAL_REDIS_URL, 'ephemeral-readiness');
  const queueRedis =
    options.dependencies?.queueRedis ??
    new RedisHealthService(config.QUEUE_REDIS_URL, 'queue-readiness');
  if (options.dependencies?.ephemeralRedis === undefined) {
    ownedDependencies.push(ephemeralRedis);
  }
  if (options.dependencies?.queueRedis === undefined) {
    ownedDependencies.push(queueRedis);
  }

  // The pool this process opened brings its own bound. An injected database
  // brought one too, checked above.
  const databaseAdmission =
    options.dependencies?.databaseAdmission ??
    ownedDatabaseService?.admission ??
    new DatabaseAdmission();

  const dependencies: ApplicationDependencies = {
    admin,
    auth,
    billing,
    clubs,
    creators,
    database,
    databaseAdmission,
    discovery,
    ephemeralRedis,
    logger,
    messaging,
    notifications,
    outboundHttp:
      options.dependencies?.outboundHttp ?? new DenyAllOutboundHttp(),
    payouts,
    queueRedis,
    safety,
    users,
  };
  const correlationIds = new WeakMap<Request, string>();
  const correlationIdFor = (request: Request) =>
    correlationIds.get(request) ?? crypto.randomUUID();

  const requestBodies = new WeakMap<Request, string>();
  const bodyFor = (request: Request) => requestBodies.get(request) ?? '';

  // Elysia emits one `Set-Cookie` header per array entry, which is what the
  // audience-scoped session and CSRF cookies require.
  function applyRouteResult(
    set: { headers: Record<string, unknown>; status?: unknown },
    result: RouteResult,
  ): unknown {
    set.status = result.status;
    if (result.cookies !== undefined && result.cookies.length > 0) {
      set.headers['set-cookie'] = [...result.cookies];
    }
    return result.body;
  }

  /**
   * One request, one database admission permit.
   *
   * Taken here rather than inside a service because this is the only place that
   * knows a request is one unit of work: everything a handler reaches through
   * the executor it was given belongs to the same unit, and taking a second
   * permit further down would let a unit wait on itself.
   *
   * A request that waits out the bound has not begun its business action — no
   * transaction was opened and no external call was made — so the refusal is a
   * capacity answer rather than a decision about the caller, and the client may
   * retry wherever the operation itself is retryable.
   */
  function admitted(
    route: (input: RouteRequest) => Promise<RouteResult>,
  ): (context: {
    request: Request;
    set: { headers: Record<string, unknown>; status?: unknown };
  }) => Promise<unknown> {
    return async ({ request, set }) => {
      const correlationId = correlationIdFor(request);
      try {
        const result = await dependencies.databaseAdmission.run(async () =>
          route({ body: bodyFor(request), correlationId, request }),
        );
        return applyRouteResult(set, result);
      } catch (error) {
        if (!(error instanceof DatabaseSaturatedError)) throw error;
        // Operational fields only. What is saturated is a property of this
        // instance, never of the caller, so nothing identifying is recorded and
        // nothing about the pool reaches the response.
        logger.warn(
          {
            correlationId,
            method: request.method,
            url: sanitizeUrlForLogging(request.url),
            ...dependencies.databaseAdmission.snapshot(),
          },
          'database admission saturated',
        );
        set.status = 503;
        set.headers[retryAfterResponseHeader] = String(retryAfterSeconds);
        return apiErrorSchema.parse({
          code: apiErrorCodes.serviceUnavailable,
          correlationId,
          message: 'Request failed',
        });
      }
    };
  }

  const app = new Elysia({
    serve: {
      hostname: config.HOST,
      maxRequestBodySize: maximumRequestBodyBytes,
      port: config.PORT,
    },
  })
    // The body is read verbatim so AUTH can enforce its own smaller size limit
    // and answer malformed input with one contract-declared status instead of a
    // framework parse error.
    .onParse(async ({ request }) => {
      const raw = await request.text();
      requestBodies.set(request, raw);
      return raw;
    })
    .onRequest(({ request, set }) => {
      const correlationId = normalizeCorrelationId(
        request.headers.get(correlationHeader),
      );
      correlationIds.set(request, correlationId);
      set.headers[correlationHeader] = correlationId;
      for (const [name, value] of Object.entries(apiSecurityHeaders)) {
        set.headers[name] = value;
      }
      for (const [name, value] of Object.entries(
        corsHeadersFor(request.headers.get('origin'), auth.allowedOriginUnion),
      )) {
        set.headers[name] = value;
      }

      if (isPreflight(request)) {
        return preflightResponse(request, auth.allowedOriginUnion, {
          ...apiSecurityHeaders,
          [correlationHeader]: correlationId,
        });
      }

      const contentLength = Number(request.headers.get('content-length') ?? 0);
      if (
        Number.isFinite(contentLength) &&
        contentLength > maximumRequestBodyBytes
      ) {
        set.status = 413;
        return apiErrorSchema.parse({
          code: apiErrorCodes.payloadTooLarge,
          correlationId,
          message: 'Request failed',
        });
      }

      logger.info(
        {
          correlationId,
          method: request.method,
          url: sanitizeUrlForLogging(request.url),
        },
        'request received',
      );
      return undefined;
    })
    .onAfterHandle(({ request, set }) => {
      logger.info(
        {
          correlationId: correlationIdFor(request),
          method: request.method,
          status: set.status,
          url: sanitizeUrlForLogging(request.url),
        },
        'request completed',
      );
    })
    .onError(({ code, error, request, set }) => {
      const correlationId = correlationIdFor(request);
      const status = statusForElysiaError(code);
      set.status = status;
      if (status >= 500) {
        logger.error(
          {
            correlationId,
            error,
            method: request.method,
            url: sanitizeUrlForLogging(request.url),
          },
          'unhandled request error',
        );
      }
      return apiErrorSchema.parse({
        code: status >= 500 ? apiErrorCodes.internal : `HTTP_${String(status)}`,
        correlationId,
        message: status >= 500 ? 'Internal server error' : 'Request failed',
      });
    })
    .get(apiRoutePaths.liveness, () =>
      livenessResponseSchema.parse({ status: 'ok' }),
    )
    .get(apiRoutePaths.readiness, async ({ set }) =>
      getTracer('velora-api').startActiveSpan(
        'health.readiness',
        async (span) => {
          try {
            const [postgres, ephemeralRedisReady, queueRedisReady] =
              await Promise.all([
                dependencies.database.isReady(),
                dependencies.ephemeralRedis.isReady(),
                dependencies.queueRedis.isReady(),
              ]);
            const ready = postgres && ephemeralRedisReady && queueRedisReady;
            if (!ready) set.status = 503;
            return readinessResponseSchema.parse({
              dependencies: {
                ephemeralRedis: ephemeralRedisReady ? 'up' : 'down',
                postgres: postgres ? 'up' : 'down',
                queueRedis: queueRedisReady ? 'up' : 'down',
              },
              status: ready ? 'ready' : 'unavailable',
            });
          } finally {
            span.end();
          }
        },
      ),
    )
    .post(
      apiRoutePaths.localWebSession,
      admitted(async (input) => auth.routes.createLocalWebSession(input)),
    )
    .post(
      apiRoutePaths.localMobileSession,
      admitted(async (input) => auth.routes.createLocalMobileSession(input)),
    )
    .get(
      apiRoutePaths.session,
      admitted(async (input) => auth.routes.getSession(input)),
    )
    .post(
      apiRoutePaths.mobileRefresh,
      admitted(async (input) => auth.routes.refreshMobileSession(input)),
    )
    .post(
      apiRoutePaths.logout,
      admitted(async (input) => auth.routes.logout(input)),
    )
    .post(
      apiRoutePaths.logoutAll,
      admitted(async (input) => auth.routes.logoutAll(input)),
    )
    .post(
      apiRoutePaths.recoveryStart,
      admitted(async (input) => auth.routes.startAccountRecovery(input)),
    )
    .post(
      apiRoutePaths.recoveryCompletion,
      admitted(async (input) => auth.routes.completeAccountRecovery(input)),
    )
    .post(
      apiRoutePaths.consumerAccount,
      admitted(async (input) => users.routes.createAccount(input)),
    )
    .get(
      apiRoutePaths.consumerAccountSelf,
      admitted(async (input) => users.routes.getAccount(input)),
    )
    .get(
      apiRoutePaths.consumerOnboarding,
      admitted(async (input) => users.routes.getOnboarding(input)),
    )
    .post(
      apiRoutePaths.consumerAdultDeclaration,
      admitted(async (input) => users.routes.declareAdult(input)),
    )
    .post(
      apiRoutePaths.consumerPolicyAcknowledgements,
      admitted(async (input) => users.routes.acknowledgePolicies(input)),
    )
    .post(
      apiRoutePaths.consumerProfile,
      admitted(async (input) => users.profileRoutes.saveProfile(input)),
    )
    .get(
      apiRoutePaths.consumerProfile,
      admitted(async (input) => users.profileRoutes.getProfile(input)),
    )
    .post(
      apiRoutePaths.consumerPreferences,
      admitted(async (input) => users.profileRoutes.savePreferences(input)),
    )
    .post(
      apiRoutePaths.consumerProfileMedia,
      admitted(async (input) => users.profileRoutes.createMediaUpload(input)),
    )
    .post(
      apiRoutePaths.consumerProfileMediaCompletion,
      admitted(async (input) => users.profileRoutes.completeMediaUpload(input)),
    )
    .post(
      apiRoutePaths.consumerProfileMediaRemoval,
      admitted(async (input) => users.profileRoutes.removeMedia(input)),
    )
    .get(
      apiRoutePaths.consumerAvailability,
      admitted(async (input) =>
        users.availabilityRoutes.getAvailability(input),
      ),
    )
    .post(
      apiRoutePaths.consumerAvailability,
      admitted(async (input) =>
        users.availabilityRoutes.saveAvailability(input),
      ),
    )
    .post(
      apiRoutePaths.creatorAccount,
      admitted(async (input) => creators.routes.createAccount(input)),
    )
    .get(
      apiRoutePaths.creatorAccountSelf,
      admitted(async (input) => creators.routes.getAccount(input)),
    )
    .get(
      apiRoutePaths.creatorOnboarding,
      admitted(async (input) => creators.routes.getOnboarding(input)),
    )
    .post(
      apiRoutePaths.creatorPolicyAcknowledgements,
      admitted(async (input) => creators.routes.acknowledgePolicies(input)),
    )
    .get(
      apiRoutePaths.creatorProfile,
      admitted(async (input) => creators.profileRoutes.getProfile(input)),
    )
    .post(
      apiRoutePaths.creatorProfile,
      admitted(async (input) => creators.profileRoutes.saveProfile(input)),
    )
    .post(
      apiRoutePaths.creatorProfilePublication,
      admitted(async (input) => creators.profileRoutes.setPublication(input)),
    )
    .get(
      apiRoutePaths.publicCreator,
      admitted(async (input) => creators.profileRoutes.getPublicCreator(input)),
    )
    .get(
      apiRoutePaths.creatorContent,
      admitted(async (input) => clubs.routes.listContent(input)),
    )
    .post(
      apiRoutePaths.creatorContent,
      admitted(async (input) => clubs.routes.saveContent(input)),
    )
    .post(
      apiRoutePaths.creatorContentLifecycle,
      admitted(async (input) => clubs.routes.setContentLifecycle(input)),
    )
    .get(
      apiRoutePaths.publicCreatorCatalog,
      admitted(async (input) => clubs.routes.getPublicCatalog(input)),
    )
    .get(
      apiRoutePaths.creatorClubs,
      admitted(async (input) => clubs.clubRoutes.listClubs(input)),
    )
    .post(
      apiRoutePaths.creatorClubs,
      admitted(async (input) => clubs.clubRoutes.saveClub(input)),
    )
    .post(
      apiRoutePaths.creatorClubLifecycle,
      admitted(async (input) => clubs.clubRoutes.setClubLifecycle(input)),
    )
    .get(
      apiRoutePaths.creatorClubInvites,
      admitted(async (input) => clubs.clubRoutes.listInvites(input)),
    )
    .post(
      apiRoutePaths.creatorClubInvites,
      admitted(async (input) => clubs.clubRoutes.issueInvite(input)),
    )
    .post(
      apiRoutePaths.creatorClubInviteRevocation,
      admitted(async (input) => clubs.clubRoutes.revokeInvite(input)),
    )
    .get(
      apiRoutePaths.creatorClubMembers,
      admitted(async (input) => clubs.clubRoutes.listMemberships(input)),
    )
    .post(
      apiRoutePaths.creatorClubMemberRevocation,
      admitted(async (input) => clubs.clubRoutes.revokeMembership(input)),
    )
    .post(
      apiRoutePaths.clubRedemptions,
      admitted(async (input) => clubs.clubRoutes.redeem(input)),
    )
    .get(
      apiRoutePaths.clubAccess,
      admitted(async (input) => clubs.clubRoutes.listAccess(input)),
    )
    .get(
      apiRoutePaths.clubContent,
      admitted(async (input) => clubs.clubRoutes.getClubContent(input)),
    )
    .get(
      apiRoutePaths.publicCreatorClubs,
      admitted(async (input) => clubs.clubRoutes.getPublicClubs(input)),
    )
    .post(
      apiRoutePaths.checkouts,
      admitted(async (input) => billing.checkoutRoutes.startCheckout(input)),
    )
    .get(
      apiRoutePaths.checkouts,
      admitted(async (input) => billing.checkoutRoutes.readCheckout(input)),
    )
    .post(
      apiRoutePaths.providerEvents,
      admitted(async (input) =>
        billing.webhookRoutes.receiveProviderEvent(input),
      ),
    )
    .get(
      apiRoutePaths.subscriptions,
      admitted(async (input) =>
        billing.checkoutRoutes.listSubscriptions(input),
      ),
    )
    .get(
      apiRoutePaths.creatorEarnings,
      admitted(async (input) => billing.earningsRoutes.getEarnings(input)),
    )
    .get(
      apiRoutePaths.creatorEarningsHistory,
      admitted(async (input) =>
        billing.earningsRoutes.getEarningsHistory(input),
      ),
    )
    .get(
      apiRoutePaths.creatorPayoutReadiness,
      admitted(async (input) => payouts.routes.getReadiness(input)),
    )
    .post(
      apiRoutePaths.creatorPayoutOnboarding,
      admitted(async (input) => payouts.routes.startOnboarding(input)),
    )
    .post(
      apiRoutePaths.creatorPayouts,
      admitted(async (input) => payouts.routes.requestPayout(input)),
    )
    .get(
      apiRoutePaths.creatorPayouts,
      admitted(async (input) => payouts.routes.listPayouts(input)),
    )
    .get(
      apiRoutePaths.creatorOffers,
      admitted(async (input) => billing.offerRoutes.listOffers(input)),
    )
    .post(
      apiRoutePaths.creatorOffers,
      admitted(async (input) => billing.offerRoutes.createOffer(input)),
    )
    .post(
      apiRoutePaths.creatorOfferPrices,
      admitted(async (input) => billing.offerRoutes.publishPrice(input)),
    )
    .post(
      apiRoutePaths.creatorOfferPriceRetirement,
      admitted(async (input) => billing.offerRoutes.retirePrice(input)),
    )
    .post(
      apiRoutePaths.creatorOfferLifecycle,
      admitted(async (input) => billing.offerRoutes.setOfferLifecycle(input)),
    )
    .get(
      apiRoutePaths.adminCreators,
      admitted(async (input) => admin.routes.listCreators(input)),
    )
    .post(
      apiRoutePaths.adminCreatorSuspension,
      admitted(async (input) => admin.routes.suspendCreator(input)),
    )
    .post(
      apiRoutePaths.adminCreatorReinstatement,
      admitted(async (input) => admin.routes.reinstateCreator(input)),
    )
    .post(
      apiRoutePaths.adminCreatorObjectRemoval,
      admitted(async (input) => admin.routes.removeObject(input)),
    )
    .post(
      apiRoutePaths.adminMembershipRevocation,
      admitted(async (input) => admin.routes.revokeMembership(input)),
    )
    .post(
      apiRoutePaths.adminBillingRefunds,
      admitted(async (input) => admin.billingRoutes.issueRefund(input)),
    )
    .get(
      apiRoutePaths.adminBillingState,
      admitted(async (input) => admin.billingRoutes.getFinancialState(input)),
    )
    .get(
      apiRoutePaths.discoveryCandidates,
      admitted(async (input) => discovery.routes.getCandidates(input)),
    )
    .post(
      apiRoutePaths.discoveryPasses,
      admitted(async (input) => discovery.routes.passCandidate(input)),
    )
    .get(
      apiRoutePaths.discoveryIntroductions,
      admitted(async (input) => discovery.routes.listIntroductions(input)),
    )
    .post(
      apiRoutePaths.discoveryIntroductions,
      admitted(async (input) => discovery.routes.createIntroduction(input)),
    )
    .post(
      apiRoutePaths.discoveryIntroductionDecline,
      admitted(async (input) => discovery.routes.declineIntroduction(input)),
    )
    .post(
      apiRoutePaths.discoveryIntroductionWithdrawal,
      admitted(async (input) => discovery.routes.withdrawIntroduction(input)),
    )
    .post(
      apiRoutePaths.messagingConversations,
      admitted(async (input) => messaging.routes.createConversation(input)),
    )
    .get(
      apiRoutePaths.messagingConversations,
      admitted(async (input) => messaging.routes.listConversations(input)),
    )
    .post(
      apiRoutePaths.messagingConversationRead,
      admitted(async (input) => messaging.routes.markConversationRead(input)),
    )
    .get(
      apiRoutePaths.messagingMessages,
      admitted(async (input) => messaging.routes.listMessages(input)),
    )
    .post(
      apiRoutePaths.messagingMessages,
      admitted(async (input) => messaging.routes.sendMessage(input)),
    )
    .post(
      apiRoutePaths.safetyBlocks,
      admitted(async (input) => safety.routes.createBlock(input)),
    )
    .get(
      apiRoutePaths.safetyBlocks,
      admitted(async (input) => safety.routes.listBlocks(input)),
    )
    .post(
      apiRoutePaths.safetyBlockRemoval,
      admitted(async (input) => safety.routes.removeBlock(input)),
    )
    .post(
      apiRoutePaths.safetyReports,
      admitted(async (input) => safety.routes.createReport(input)),
    )
    .get(
      apiRoutePaths.safetyReports,
      admitted(async (input) => safety.routes.listReports(input)),
    )
    .get(
      apiRoutePaths.notifications,
      admitted(async (input) => notifications.routes.listNotifications(input)),
    )
    .post(
      apiRoutePaths.notificationsRead,
      admitted(async (input) =>
        notifications.routes.markNotificationsRead(input),
      ),
    );

  return {
    app,
    async close() {
      if (ownsAuth) await auth.close();
      await Promise.all(
        ownedDependencies.map(async (dependency) => dependency.close()),
      );
    },
    config,
    dependencies,
    async warm() {
      await ownedDatabaseService?.warm();
    },
  };
}
