import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  apiOperations,
  correlationResponseHeader,
  livenessResponseSchema,
  maximumRequestBodyBytes,
  readinessResponseSchema,
  sharedErrorResponses,
} from '../src/index.js';

interface OpenApiResponse {
  readonly content: Record<string, { readonly schema: { $ref: string } }>;
  readonly description: string;
  readonly headers: Record<string, unknown>;
}
interface OpenApiDocument {
  readonly paths: Record<
    string,
    Record<string, { readonly responses: Record<string, OpenApiResponse> }>
  >;
}

const document = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../openapi/velora.v1.json',
    ),
    'utf8',
  ),
) as OpenApiDocument;

describe('bootstrap API contracts', () => {
  it('accepts only truthful liveness state', () => {
    expect(livenessResponseSchema.parse({ status: 'ok' })).toEqual({
      status: 'ok',
    });
    expect(() => livenessResponseSchema.parse({ status: 'ready' })).toThrow();
  });

  it('requires all readiness dependencies', () => {
    expect(
      readinessResponseSchema.parse({
        dependencies: {
          ephemeralRedis: 'up',
          postgres: 'up',
          queueRedis: 'up',
        },
        status: 'ready',
      }),
    ).toBeDefined();
  });

  it('registers explicit HTTP methods for deterministic generation', () => {
    expect(apiOperations.map(({ method }) => method)).toEqual(['get', 'get']);
  });

  it('requires safe correlated errors', () => {
    expect(
      apiErrorSchema.parse({
        code: 'INTERNAL_ERROR',
        correlationId: 'test-correlation',
        message: 'Request failed',
      }),
    ).toBeDefined();
  });

  it('documents the durable failures every operation can produce', () => {
    for (const operation of apiOperations) {
      expect(Object.keys(operation.responses)).toEqual(
        expect.arrayContaining(Object.keys(sharedErrorResponses)),
      );
    }
  });

  it('publishes every registered operation, status, schema, and correlation header', () => {
    for (const operation of apiOperations) {
      const published = document.paths[operation.path]?.[operation.method];
      expect(published, `${operation.method} ${operation.path}`).toBeDefined();

      const declared = operation.responses as Record<
        string,
        { readonly description: string; readonly schemaName: string }
      >;
      expect(Object.keys(published?.responses ?? {}).sort()).toEqual(
        Object.keys(declared).sort(),
      );
      for (const [status, definition] of Object.entries(declared)) {
        const response = published?.responses[status];
        expect(
          response?.content['application/json']?.schema.$ref,
          `${operation.path} ${status}`,
        ).toBe(`#/components/schemas/${definition.schemaName}`);
        expect(response?.description).toBe(definition.description);
        expect(
          Object.keys(response?.headers ?? {}),
          `${operation.path} ${status} correlation header`,
        ).toContain(correlationResponseHeader);
      }
    }
  });

  it('publishes no operation the registry does not declare', () => {
    const published = Object.entries(document.paths).flatMap(
      ([path, methods]) =>
        Object.keys(methods).map((method) => `${method} ${path}`),
    );
    expect(published.sort()).toEqual(
      apiOperations.map((item) => `${item.method} ${item.path}`).sort(),
    );
  });

  it('pins the request body limit the runtime enforces', () => {
    expect(maximumRequestBodyBytes).toBe(1_048_576);
  });
});
