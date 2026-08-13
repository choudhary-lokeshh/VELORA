import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  apiErrorSchema,
  apiOperations,
  apiSchemas,
  authErrorCodes,
  browserSessionCookieNames,
  correlationResponseHeader,
  localWebSessionRequestSchema,
  maximumAuthRequestBodyBytes,
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
interface OpenApiOperation {
  readonly parameters: { readonly in: string; readonly name: string }[];
  readonly requestBody?: {
    readonly content: Record<string, { readonly schema: { $ref: string } }>;
    readonly required: boolean;
  };
  readonly responses: Record<string, OpenApiResponse>;
  readonly security: Record<string, string[]>[];
}
interface OpenApiDocument {
  readonly components: {
    readonly schemas: Record<string, unknown>;
    readonly securitySchemes: Record<string, unknown>;
  };
  readonly paths: Record<string, Record<string, OpenApiOperation>>;
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
    expect(
      apiOperations.every(
        (operation) =>
          operation.method === 'get' || operation.method === 'post',
      ),
    ).toBe(true);
    expect(new Set(apiOperations.map((item) => item.operationId)).size).toBe(
      apiOperations.length,
    );
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

describe('AUTH contract publication', () => {
  it('publishes the transport credential each operation accepts', () => {
    for (const operation of apiOperations) {
      const published = document.paths[operation.path]?.[operation.method];
      const security = published?.security ?? [];
      const names = security.flatMap((entry) => Object.keys(entry)).sort();
      // Compared as plain strings so the assertion keeps working when a future
      // operation adds a requirement the current union does not contain.
      const requirement: string = operation.security;
      const expected =
        requirement === 'public'
          ? []
          : requirement === 'cookieOrBearer'
            ? ['bearerAccessToken', 'cookieSession']
            : [requirement];
      expect(names, operation.operationId).toEqual(expected);
      for (const name of names) {
        expect(Object.keys(document.components.securitySchemes)).toContain(
          name,
        );
      }
    }
  });

  it('publishes a request body exactly when the registry declares one', () => {
    for (const operation of apiOperations) {
      const published = document.paths[operation.path]?.[operation.method];
      const declared =
        'requestSchemaName' in operation
          ? operation.requestSchemaName
          : undefined;
      if (declared === undefined) {
        expect(published?.requestBody, operation.operationId).toBeUndefined();
        continue;
      }
      expect(
        published?.requestBody?.content['application/json']?.schema.$ref,
        operation.operationId,
      ).toBe(`#/components/schemas/${declared}`);
      expect(published?.requestBody?.required).toBe(true);
      expect(Object.keys(apiSchemas)).toContain(declared);
    }
  });

  it('publishes every contract header the registry declares and no other', () => {
    for (const operation of apiOperations) {
      const published = document.paths[operation.path]?.[operation.method];
      const declared =
        'requestHeaders' in operation ? [...operation.requestHeaders] : [];
      expect(
        published?.parameters
          .filter((parameter) => parameter.in === 'header')
          .map((parameter) => parameter.name),
        operation.operationId,
      ).toEqual([correlationResponseHeader, ...declared]);
    }
  });

  it('defines every schema a response or request references', () => {
    const referenced = new Set<string>();
    for (const operation of apiOperations) {
      for (const response of Object.values(operation.responses)) {
        referenced.add((response as { schemaName: string }).schemaName);
      }
      if ('requestSchemaName' in operation) {
        referenced.add(operation.requestSchemaName);
      }
    }
    for (const name of referenced) {
      expect(Object.keys(document.components.schemas)).toContain(name);
    }
    // Nothing is published that no operation uses.
    expect(Object.keys(document.components.schemas).sort()).toEqual(
      [...referenced].sort(),
    );
  });

  it('never places a credential in a URL path or query parameter', () => {
    for (const operation of apiOperations) {
      expect(operation.path).not.toMatch(/token|secret|password/iu);
      const published = document.paths[operation.path]?.[operation.method];
      for (const parameter of published?.parameters ?? []) {
        expect(parameter.in).toBe('header');
      }
    }
  });

  it('keeps AUTH error codes stable, generic, and free of internal detail', () => {
    expect(Object.values(authErrorCodes).sort()).toEqual([
      'AUTH_CSRF_REQUIRED',
      'AUTH_IDENTITY_DISABLED',
      'AUTH_INVALID_CREDENTIALS',
      'AUTH_ORIGIN_REJECTED',
      'AUTH_RATE_LIMITED',
      'AUTH_RECOVERY_INVALID',
      'AUTH_RECOVERY_REVIEW_REQUIRED',
      'AUTH_REFRESH_INVALID',
      'AUTH_REQUIRED',
      'VALIDATION_FAILED',
    ]);
    for (const code of Object.values(authErrorCodes)) {
      expect(code).toMatch(/^[A-Z_]+$/u);
    }
  });

  it('names every browser session cookie with the __Host- prefix', () => {
    for (const name of Object.values(browserSessionCookieNames)) {
      expect(name.startsWith('__Host-')).toBe(true);
    }
    expect(new Set(Object.values(browserSessionCookieNames)).size).toBe(3);
  });

  it('bounds an AUTH request body well below the global limit', () => {
    expect(maximumAuthRequestBodyBytes).toBeLessThan(maximumRequestBodyBytes);
    expect(maximumAuthRequestBodyBytes).toBe(4_096);
  });

  it('refuses contract input outside its declared shape', () => {
    expect(
      localWebSessionRequestSchema.safeParse({
        audience: 'platform_admin',
        subject: 'person@velora.test',
      }).success,
    ).toBe(false);
    expect(
      localWebSessionRequestSchema.safeParse({
        audience: 'consumer_web',
        extra: true,
        subject: 'person@velora.test',
      }).success,
    ).toBe(false);
    expect(
      localWebSessionRequestSchema.safeParse({
        audience: 'consumer_web',
        subject: 'a'.repeat(201),
      }).success,
    ).toBe(false);
    expect(
      localWebSessionRequestSchema.safeParse({
        audience: 'consumer_web',
        subject: 'person@velora.test',
      }).success,
    ).toBe(true);
  });
});
