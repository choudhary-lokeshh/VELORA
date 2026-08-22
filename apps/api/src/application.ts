import { Elysia } from 'elysia';
import {
  loadServerConfig,
  matureContentEnabled,
  type ServerConfig,
} from '@velora/config/server';
import {
  apiErrorCodes,
  apiErrorSchema,
  apiRoutePaths,
  livenessResponseSchema,
  maximumRequestBodyBytes,
  productErrorCodes,
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
import { createMediaRuntime, type MediaRuntime } from './media/composition.js';
import {
  createIdentityRuntime,
  type IdentityRuntime,
} from './identity/composition.js';
import { RoutedMediaAssociation } from './media/publication.js';
import {
  RoutedMediaSafetySubjects,
  SafetyBackedMediaContentSafety,
  SafetyBackedMediaSafety,
} from './media/safety-bridge.js';
import { CreatorContentMediaAssociation } from './clubs/content-media-association.js';
import { CreatorProfileMediaAssociation } from './creators/profile-media-association.js';
import { ConsumerProfileMediaAssociation } from './users/profile-media-association.js';
import { ContentSafetyGate } from './safety/content-safety.js';
import {
  DepictedPersonConsentService,
  UnpublishedConsentPolicy,
} from './safety/consent.js';
import { SafetyEligibility } from './safety/eligibility.js';
import { SafetyRepository } from './safety/repository.js';
import {
  createMessagingRuntime,
  type MessagingRuntime,
} from './messaging/composition.js';
import { RtcCallEnforcement } from './realtime/enforcement.js';
import {
  createRealtimeRuntime,
  type RealtimeRuntime,
} from './realtime/composition.js';
import type { RtcRoutes } from './realtime/routes.js';
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
import { CreatorSafetyRoutes } from './safety/creator-routes.js';
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
import {
  routeFailure,
  type RouteRequest,
  type RouteResult,
} from './http/route-kit.js';
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
  readonly identity: IdentityRuntime;
  readonly media: MediaRuntime;
  readonly messaging: MessagingRuntime;
  /**
   * Present in every composition that owns its database, which is every
   * production one. A test that injects its own runtimes may omit it, and then
   * publishes no RTC routes rather than publishing ones wired to a database it
   * did not supply.
   */
  readonly realtime?: RealtimeRuntime;
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
  const injectedMedia = options.dependencies?.media;
  const injectedIdentity = options.dependencies?.identity;
  const injectedMessaging = options.dependencies?.messaging;
  const injectedRealtime = options.dependencies?.realtime;
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
  let media: MediaRuntime;
  let identity: IdentityRuntime;
  let messaging: MessagingRuntime;
  let realtime: RealtimeRuntime | undefined;
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
    identity =
      injectedIdentity ??
      createIdentityRuntime({
        config,
        database: ownedDatabase.database,
        logger,
        owner: `api-${crypto.randomUUID()}`,
      });
    // MEDIA before USERS, because USERS asks it for upload capabilities and
    // readiness. It asks nothing of USERS in return: the association answer it
    // needs is USERS code reading USERS tables, handed over as a port, so the
    // two compose in one direction with no late setter.
    //
    // Composing it here rather than lazily is what makes an unapproved storage
    // provider a startup failure instead of a failure on the first upload
    // somebody attempts.
    //
    // Three owning domains, routed by the domain that reserved the asset.
    // Each adapter is that domain's own code reading its own tables, handed to
    // MEDIA as a port; a domain with no entry answers nothing, and nothing
    // denies.
    const profileMediaAssociation = new ConsumerProfileMediaAssociation();
    const creatorMediaAssociation = new CreatorProfileMediaAssociation();
    const contentMediaAssociation = new CreatorContentMediaAssociation();
    const mediaAssociationRoutes = {
      clubs: contentMediaAssociation,
      creators: creatorMediaAssociation,
      users: profileMediaAssociation,
    };
    const safetyRepositoryForMedia = new SafetyRepository(
      ownedDatabase.database,
    );
    const safetyEligibilityForMedia = new SafetyEligibility(
      safetyRepositoryForMedia,
    );
    media =
      injectedMedia ??
      createMediaRuntime({
        association: new RoutedMediaAssociation(mediaAssociationRoutes),
        config,
        database: ownedDatabase.database,
        logger,
        safety: new SafetyBackedMediaSafety({
          // The content gate, wired. A content attachment was denied outright
          // until this existed, which was the honest reading of a gate nobody
          // could ask. It enables nothing that was blocked for a policy
          // reason: mature content is refused inside the gate by a capability
          // with one configured value in every environment.
          content: new SafetyBackedMediaContentSafety(
            new ContentSafetyGate({
              consent: new DepictedPersonConsentService({
                copy: new UnpublishedConsentPolicy(),
                identityEvidence: identity.depictedPersonEvidence,
                now: () => new Date(),
                repository: safetyRepositoryForMedia,
              }),
              eligibility: safetyEligibilityForMedia,
              matureContentEnabled: matureContentEnabled(config),
              now: () => new Date(),
              repository: safetyRepositoryForMedia,
            }),
          ),
          eligibility: safetyEligibilityForMedia,
          subjects: new RoutedMediaSafetySubjects(mediaAssociationRoutes),
        }),
      });
    users =
      injectedUsers ??
      createUsersRuntime({
        caller: auth.caller,
        config,
        database: ownedDatabase.database,
        identityAdultAssurance: identity.adultAssurance,
        logger,
        media: media.service,
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
        // Ending a call authorizes nothing, so this contract depends on the
        // call rows and on nothing SAFETY owns. Building it here rather than
        // taking it from the realtime runtime is what keeps the composition
        // acyclic: REALTIME consumes SAFETY's eligibility answer and is
        // therefore composed after it.
        calls: new RtcCallEnforcement(ownedDatabase.database),
        catalog: new ClubSafetyDirectory(),
        config,
        consumerContext: users.consumerContext,
        consumers: users.existence,
        conversations: new ConversationEnforcement(ownedDatabase.database),
        conversationTargets: new ConversationParticipation(),
        creators: creators.directory,
        database: ownedDatabase.database,
        identityEvidence: identity.depictedPersonEvidence,
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
    realtime =
      injectedRealtime ??
      createRealtimeRuntime({
        config,
        connections: discovery.connections,
        consumerContext: users.consumerContext,
        database: ownedDatabase.database,
        directory: users.directory,
        enforcement: safety.eligibility,
        logger,
        onboarding: users.onboarding,
        safety: safety.directory,
        standing: users.standing,
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
        identity: identity.operations,
        // The operational read is MEDIA's own, because nothing outside that
        // domain queries a `media_` table. What ADMIN is handed beside it is a
        // single purge method: taking an object out of public view owes the
        // cache the news, and that is the whole of what a takedown may ask of
        // the bytes.
        media: { operations: media.operations, purge: media.service },
        // REALTIME's own operational read, on the same rule MEDIA follows:
        // nothing outside that domain queries its tables. ADMIN gets the read
        // and no action — ending a call is a safety decision and goes through
        // TRUST & SAFETY, where it acquires a record, a reason, and an appeal.
        rtc: realtime.operations,
        // A sensitive exact-subject read consumes AUTH's existing one-time
        // binding. It is not a substitute for ADMIN role/scope policy.
        privilegedAccess: auth.privilegedAccess,
        profiles: creators.profileRepository,
        // ADMIN authorizes a reversal and BILLING decides whether it is one it
        // can make. There is no path from an operator to a financial row that
        // does not go through the domain that owns it.
        refunds: billing.refunds,
        appeals: safety.appeals,
        moderation: safety.moderation,
        safety: safety.authority,
      });
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
      injectedMedia === undefined ||
      injectedIdentity === undefined ||
      injectedMessaging === undefined ||
      injectedNotifications === undefined ||
      injectedPayouts === undefined ||
      injectedSafety === undefined ||
      options.dependencies?.databaseAdmission === undefined
    ) {
      throw new Error(
        'An injected database dependency requires injected AUTH, USERS, CREATORS, PRIVATE CLUBS, BILLING, PAYOUTS, ADMIN, DISCOVERY, MEDIA, IDENTITY, MESSAGING, NOTIFICATIONS, and SAFETY runtimes and a database admission bound',
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
    media = injectedMedia;
    identity = injectedIdentity;
    messaging = injectedMessaging;
    realtime = injectedRealtime;
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
    identity,
    media,
    messaging,
    notifications,
    outboundHttp:
      options.dependencies?.outboundHttp ?? new DenyAllOutboundHttp(),
    payouts,
    ...(realtime === undefined ? {} : { realtime }),
    queueRedis,
    safety,
    users,
  };
  const correlationIds = new WeakMap<Request, string>();
  const correlationIdFor = (request: Request) =>
    correlationIds.get(request) ?? crypto.randomUUID();

  const requestBodies = new WeakMap<Request, string>();
  const bodyFor = (request: Request) => requestBodies.get(request) ?? '';
  const rawRequestBodies = new WeakMap<Request, Uint8Array>();
  const rawBodyFor = (request: Request) =>
    rawRequestBodies.get(request) ?? new Uint8Array();

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
  /**
   * Wraps one RTC handler so the paths exist even where the runtime does not.
   *
   * A composition that supplied no REALTIME runtime still publishes the paths
   * and answers `503` on them, rather than omitting them: an absent route and a
   * route that cannot serve are different facts, and a client deserves the
   * second one. Every production composition owns its database and therefore
   * always has the runtime, so this refusal is reachable only from a test
   * composition that injected its own.
   */
  function rtcRoute(
    run: (routes: RtcRoutes, input: RouteRequest) => Promise<RouteResult>,
  ): (input: RouteRequest) => Promise<RouteResult> {
    return async (input) => {
      if (realtime === undefined) {
        return routeFailure(
          503,
          productErrorCodes.dependencyUnavailable,
          input.correlationId,
        );
      }
      return run(realtime.routes, input);
    };
  }

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
          route({
            body: bodyFor(request),
            correlationId,
            rawBody: rawBodyFor(request),
            request,
          }),
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

  /**
   * What Creator Studio is told about mature content.
   *
   * Composed here rather than inside the TRUST & SAFETY runtime because it
   * needs CREATORS' session resolver and nothing of SAFETY's persistence: the
   * answer is the same for every creator, and it is no. The policy it reports
   * is SAFETY's; the audience it answers to is CREATORS'.
   */
  const creatorSafetyRoutes = new CreatorSafetyRoutes({
    capabilities: {
      consentPolicy: config.SAFETY_CONSENT_POLICY,
      identityVerificationProvider: config.IDENTITY_VERIFICATION_PROVIDER,
      matureContent: config.SAFETY_MATURE_CONTENT,
    },
    creatorContext: creators.creatorContext,
  });

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
      const bytes = new Uint8Array(await request.arrayBuffer());
      rawRequestBodies.set(request, bytes);
      const raw = new TextDecoder().decode(bytes);
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
    .post(
      apiRoutePaths.identityProviderEvents,
      admitted(async (input) => identity.providerEventRoutes.receive(input)),
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
    .get(
      apiRoutePaths.adminSafetyCases,
      admitted(async (input) => admin.moderationRoutes.listCases(input)),
    )
    .get(
      apiRoutePaths.adminSafetyCase,
      admitted(async (input) => admin.moderationRoutes.getCase(input)),
    )
    .post(
      apiRoutePaths.adminSafetyCaseClaim,
      admitted(async (input) => admin.moderationRoutes.claimCase(input)),
    )
    .post(
      apiRoutePaths.adminSafetyCaseTriage,
      admitted(async (input) => admin.moderationRoutes.triageCase(input)),
    )
    .post(
      apiRoutePaths.adminSafetyCaseNotes,
      admitted(async (input) => admin.moderationRoutes.addNote(input)),
    )
    .post(
      apiRoutePaths.adminSafetyCaseDecisions,
      admitted(async (input) => admin.moderationRoutes.decideCase(input)),
    )
    .get(
      apiRoutePaths.adminSafetyAppeals,
      admitted(async (input) => admin.moderationRoutes.listAppeals(input)),
    )
    .post(
      apiRoutePaths.adminSafetyAppealOutcome,
      admitted(async (input) => admin.moderationRoutes.answerAppeal(input)),
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
      apiRoutePaths.adminIdentityState,
      admitted(async (input) => admin.identityRoutes.getIdentityState(input)),
    )
    .get(
      apiRoutePaths.adminIdentitySubject,
      admitted(async (input) => admin.identityRoutes.getIdentitySubject(input)),
    )
    .get(
      apiRoutePaths.adminRtcState,
      admitted(async (input) => admin.rtcRoutes.getRtcState(input)),
    )
    .get(
      apiRoutePaths.adminRtcCall,
      admitted(async (input) => admin.rtcRoutes.getRtcCall(input)),
    )
    .get(
      apiRoutePaths.adminMediaState,
      admitted(async (input) => admin.mediaRoutes.getMediaState(input)),
    )
    .get(
      apiRoutePaths.adminMediaAsset,
      admitted(async (input) => admin.mediaRoutes.getMediaAsset(input)),
    )
    .post(
      apiRoutePaths.adminMediaPurge,
      admitted(async (input) => admin.mediaRoutes.purgeMediaAsset(input)),
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
      apiRoutePaths.rtcProviderEvents,
      admitted(async (input) =>
        realtime === undefined
          ? routeFailure(
              503,
              productErrorCodes.dependencyUnavailable,
              input.correlationId,
            )
          : realtime.providerEventRoutes.receive(input),
      ),
    )
    .post(
      apiRoutePaths.rtcCalls,
      admitted(rtcRoute(async (routes, input) => routes.createCall(input))),
    )
    .get(
      apiRoutePaths.rtcCalls,
      admitted(rtcRoute(async (routes, input) => routes.getCall(input))),
    )
    .post(
      apiRoutePaths.rtcCallAcceptance,
      admitted(rtcRoute(async (routes, input) => routes.acceptCall(input))),
    )
    .post(
      apiRoutePaths.rtcCallRejection,
      admitted(rtcRoute(async (routes, input) => routes.rejectCall(input))),
    )
    .post(
      apiRoutePaths.rtcCallCancellation,
      admitted(rtcRoute(async (routes, input) => routes.cancelCall(input))),
    )
    .post(
      apiRoutePaths.rtcCallTermination,
      admitted(rtcRoute(async (routes, input) => routes.endCall(input))),
    )
    .post(
      apiRoutePaths.rtcCallJoinAuthorization,
      admitted(
        rtcRoute(async (routes, input) => routes.issueJoinAuthorization(input)),
      ),
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
      apiRoutePaths.consumerSafetyStanding,
      admitted(async (input) => safety.routes.getStanding(input)),
    )
    .post(
      apiRoutePaths.consumerSafetyAppeals,
      admitted(async (input) => safety.routes.createAppeal(input)),
    )
    .get(
      apiRoutePaths.consumerSafetyAppeals,
      admitted(async (input) => safety.routes.listAppeals(input)),
    )
    .post(
      apiRoutePaths.consumerSafetyAppealWithdrawal,
      admitted(async (input) => safety.routes.withdrawAppeal(input)),
    )
    .get(
      apiRoutePaths.creatorMatureReadiness,
      admitted(async (input) => creatorSafetyRoutes.getMatureReadiness(input)),
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
    )
    .get(
      apiRoutePaths.notificationPreferences,
      admitted(async (input) =>
        notifications.routes.listNotificationPreferences(input),
      ),
    )
    .post(
      apiRoutePaths.notificationPreferences,
      admitted(async (input) =>
        notifications.routes.updateNotificationPreference(input),
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
