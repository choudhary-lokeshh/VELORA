import { z } from 'zod';

import {
  authAcknowledgementSchema,
  authSessionResponseSchema,
  csrfHeader,
  deviceHeader,
  localMobileSessionRequestSchema,
  localWebSessionRequestSchema,
  mobileRefreshRequestSchema,
  mobileTokenResponseSchema,
  recoveryCompletionRequestSchema,
  recoveryStartRequestSchema,
} from './auth.js';

export * from './auth.js';

export const dependencyStateSchema = z.enum(['up', 'down']);

export const livenessResponseSchema = z
  .object({
    status: z.literal('ok'),
  })
  .strict();

export const readinessResponseSchema = z
  .object({
    dependencies: z
      .object({
        ephemeralRedis: dependencyStateSchema,
        postgres: dependencyStateSchema,
        queueRedis: dependencyStateSchema,
      })
      .strict(),
    status: z.enum(['ready', 'unavailable']),
  })
  .strict();

export const apiErrorSchema = z
  .object({
    code: z.string().min(1),
    correlationId: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiRoutePaths = {
  liveness: '/v1/health/live',
  localMobileSession: '/v1/auth/local/mobile-sessions',
  localWebSession: '/v1/auth/local/web-sessions',
  logout: '/v1/auth/logout',
  logoutAll: '/v1/auth/logout-all',
  mobileRefresh: '/v1/auth/mobile/refresh',
  readiness: '/v1/health/ready',
  recoveryCompletion: '/v1/auth/recovery/completion',
  recoveryStart: '/v1/auth/recovery',
  session: '/v1/auth/session',
} as const;

/**
 * The single source for the request body limit. The runtime enforces it and the
 * generated contract documents the resulting response, so the two cannot drift.
 */
export const maximumRequestBodyBytes = 1_048_576;

export const correlationResponseHeader = 'x-correlation-id';

/**
 * Error codes the API returns. They are deliberately generic: a caller learns
 * what failed at the protocol level and nothing about the implementation.
 */
export const apiErrorCodes = {
  internal: 'INTERNAL_ERROR',
  notFound: 'HTTP_404',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
} as const;

/**
 * Every schema the published contract may reference. Generation reads this
 * registry, so a response cannot name a schema the document does not define.
 */
export const apiSchemas = {
  ApiError: apiErrorSchema,
  AuthAcknowledgement: authAcknowledgementSchema,
  AuthSessionResponse: authSessionResponseSchema,
  LivenessResponse: livenessResponseSchema,
  LocalMobileSessionRequest: localMobileSessionRequestSchema,
  LocalWebSessionRequest: localWebSessionRequestSchema,
  MobileRefreshRequest: mobileRefreshRequestSchema,
  MobileTokenResponse: mobileTokenResponseSchema,
  ReadinessResponse: readinessResponseSchema,
  RecoveryCompletionRequest: recoveryCompletionRequestSchema,
  RecoveryStartRequest: recoveryStartRequestSchema,
} as const;

/**
 * Transport-level credential each operation accepts. `public` means the
 * operation carries its own credential in the body or none at all; it never
 * means unauthenticated access to another actor's state.
 */
export const apiSecurityRequirements = {
  bearerAccessToken: 'bearerAccessToken',
  cookieOrBearer: 'cookieOrBearer',
  cookieSession: 'cookieSession',
  public: 'public',
} as const;

/**
 * Durable failures every operation can produce, because they are enforced
 * before or around routing rather than inside a handler.
 */
export const sharedErrorResponses = {
  '404': {
    description:
      'No operation matches the requested path and method. The body is an ApiError with code HTTP_404.',
    schemaName: 'ApiError',
  },
  '413': {
    description:
      'Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE.',
    schemaName: 'ApiError',
  },
  '500': {
    description:
      'Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR.',
    schemaName: 'ApiError',
  },
} as const;

const invalidAuthInputResponse = {
  description:
    'Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED.',
  schemaName: 'ApiError',
} as const;

const authRateLimitedResponse = {
  description:
    'Too many attempts from this caller. The body is an ApiError with code AUTH_RATE_LIMITED.',
  schemaName: 'ApiError',
} as const;

const authBrowserOriginResponse = {
  description:
    'The browser origin, Fetch Metadata, or CSRF evidence for this state-changing request was rejected, or the requested identity adapter is not enabled. The body is an ApiError.',
  schemaName: 'ApiError',
} as const;

const authRequiredResponse = {
  description:
    'No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED.',
  schemaName: 'ApiError',
} as const;

export const apiOperations = [
  {
    method: 'get',
    operationId: 'getLiveness',
    path: apiRoutePaths.liveness,
    responses: {
      '200': {
        description: 'Process is alive',
        schemaName: 'LivenessResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'get',
    operationId: 'getReadiness',
    path: apiRoutePaths.readiness,
    responses: {
      '200': {
        description: 'Dependencies are ready',
        schemaName: 'ReadinessResponse',
      },
      '503': {
        description: 'A required dependency is unavailable',
        schemaName: 'ReadinessResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'post',
    operationId: 'createLocalWebSession',
    path: apiRoutePaths.localWebSession,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'LocalWebSessionRequest',
    responses: {
      '201': {
        description:
          'A browser session was established and its audience-scoped cookie was set',
        schemaName: 'AuthSessionResponse',
      },
      '403': authBrowserOriginResponse,
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'Development and test identity adapter. It is refused outside the local and test application environments and can never mint Platform Admin authority.',
  },
  {
    method: 'post',
    operationId: 'createLocalMobileSession',
    path: apiRoutePaths.localMobileSession,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'LocalMobileSessionRequest',
    responses: {
      '201': {
        description: 'An access token and a new refresh family were issued',
        schemaName: 'MobileTokenResponse',
      },
      '403': authBrowserOriginResponse,
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'Development and test identity adapter for Consumer Mobile. It is refused outside the local and test application environments.',
  },
  {
    method: 'get',
    operationId: 'getAuthSession',
    path: apiRoutePaths.session,
    responses: {
      '200': {
        description: 'The server-derived authentication context for the caller',
        schemaName: 'AuthSessionResponse',
      },
      '401': authRequiredResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'refreshMobileSession',
    path: apiRoutePaths.mobileRefresh,
    requestSchemaName: 'MobileRefreshRequest',
    responses: {
      '200': {
        description:
          'The presented refresh token was consumed and its successor issued',
        schemaName: 'MobileTokenResponse',
      },
      '401': {
        description:
          'The refresh token is unknown, expired, already rotated, or its family is revoked, and a token that was already rotated additionally revokes its family. The body is an ApiError with code AUTH_REFRESH_INVALID.',
        schemaName: 'ApiError',
      },
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'post',
    operationId: 'logout',
    path: apiRoutePaths.logout,
    requestHeaders: [csrfHeader],
    responses: {
      '200': {
        description:
          'The current authority is revoked. The operation is idempotent and succeeds when there is nothing to revoke.',
        schemaName: 'AuthAcknowledgement',
      },
      '403': authBrowserOriginResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'logoutAll',
    path: apiRoutePaths.logoutAll,
    requestHeaders: [csrfHeader],
    responses: {
      '200': {
        description:
          'Every browser session and refresh family for the account is revoked',
        schemaName: 'AuthAcknowledgement',
      },
      '401': authRequiredResponse,
      '403': authBrowserOriginResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'startAccountRecovery',
    path: apiRoutePaths.recoveryStart,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'RecoveryStartRequest',
    responses: {
      '202': {
        description:
          'The request was accepted. The response is identical whether or not an account exists.',
        schemaName: 'AuthAcknowledgement',
      },
      '403': authBrowserOriginResponse,
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'post',
    operationId: 'completeAccountRecovery',
    path: apiRoutePaths.recoveryCompletion,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'RecoveryCompletionRequest',
    responses: {
      '200': {
        description:
          'Recovery completed. Prior authority is revoked and a new Consumer Web session was established.',
        schemaName: 'AuthSessionResponse',
      },
      '401': {
        description:
          'The recovery token is unknown, expired, or already consumed. The body is an ApiError with code AUTH_RECOVERY_INVALID.',
        schemaName: 'ApiError',
      },
      '403': {
        description:
          'The request was rejected by browser origin policy, or the recovery is high risk and requires a second independent signal or reviewed handling. The body is an ApiError.',
        schemaName: 'ApiError',
      },
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
] as const;
