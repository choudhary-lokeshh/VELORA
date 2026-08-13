import { Elysia } from 'elysia';
import { loadServerConfig, type ServerConfig } from '@velora/config/server';
import {
  apiErrorCodes,
  apiErrorSchema,
  apiRoutePaths,
  livenessResponseSchema,
  maximumRequestBodyBytes,
  readinessResponseSchema,
} from '@velora/validation';
import {
  correlationHeader,
  createLogger,
  getTracer,
  sanitizeUrlForLogging,
  type SafeLogger,
} from '@velora/observability/server';

import { RedisHealthService } from './cache/redis.service.js';
import {
  DatabaseService,
  type HealthDependency,
} from './database/database.service.js';
import { normalizeCorrelationId } from './http/correlation.js';
import { apiSecurityHeaders } from './http/security-headers.js';
import {
  DenyAllOutboundHttp,
  type OutboundHttpPort,
} from './security/ports.js';

export { maximumRequestBodyBytes } from '@velora/validation';

export interface ApplicationDependencies {
  readonly database: HealthDependency;
  readonly ephemeralRedis: HealthDependency;
  readonly logger: SafeLogger;
  readonly outboundHttp: OutboundHttpPort;
  readonly queueRedis: HealthDependency;
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
  const database =
    options.dependencies?.database ?? new DatabaseService(config);
  if (options.dependencies?.database === undefined) {
    ownedDependencies.push(database);
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

  const dependencies: ApplicationDependencies = {
    database,
    ephemeralRedis,
    logger,
    outboundHttp:
      options.dependencies?.outboundHttp ?? new DenyAllOutboundHttp(),
    queueRedis,
  };
  const correlationIds = new WeakMap<Request, string>();
  const correlationIdFor = (request: Request) =>
    correlationIds.get(request) ?? crypto.randomUUID();

  const app = new Elysia({
    serve: {
      hostname: config.HOST,
      maxRequestBodySize: maximumRequestBodyBytes,
      port: config.PORT,
    },
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
    );

  return {
    app,
    async close() {
      await Promise.all(
        ownedDependencies.map(async (dependency) => dependency.close()),
      );
    },
    config,
    dependencies,
  };
}
