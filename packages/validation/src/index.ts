import { z } from 'zod';

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
  readiness: '/v1/health/ready',
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
  },
] as const;
