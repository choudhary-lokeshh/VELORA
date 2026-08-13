import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  apiOperations,
  apiSchemas,
  apiSecurityRequirements,
  browserSessionCookieNames,
  correlationResponseHeader,
} from '../src/index.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(packageRoot, 'openapi/velora.v1.json');

function schema(value: z.ZodType) {
  const generated = z.toJSONSchema(value, { target: 'draft-2020-12' });
  return Object.fromEntries(
    Object.entries(generated).filter(([key]) => key !== '$schema'),
  );
}

const correlationHeader = {
  description: 'Request correlation identifier',
  required: false,
  schema: { type: 'string' },
};

/**
 * Transport credentials the contract publishes. The cookie scheme names the
 * Consumer Web cookie; the same opaque mechanism is issued under an
 * audience-scoped name for every other browser surface so one browser cannot
 * present a Creator Studio or Platform Admin session as a consumer one.
 */
const securitySchemes = {
  bearerAccessToken: {
    bearerFormat: 'JWT',
    description:
      'Short-lived, audience-bound signed access token issued to Consumer Mobile.',
    scheme: 'bearer',
    type: 'http',
  },
  cookieSession: {
    description:
      'Opaque browser session. The cookie name is audience-scoped; Consumer Web uses the name below.',
    in: 'cookie',
    name: browserSessionCookieNames.consumer_web,
    type: 'apiKey',
  },
} as const;

function securityFor(requirement: string) {
  if (requirement === apiSecurityRequirements.public) return [];
  if (requirement === apiSecurityRequirements.cookieOrBearer) {
    return [{ cookieSession: [] }, { bearerAccessToken: [] }];
  }
  return [{ [requirement]: [] }];
}

interface ResponseDefinition {
  readonly description: string;
  readonly schemaName: keyof typeof apiSchemas;
}

function operation(operationDefinition: (typeof apiOperations)[number]) {
  const responses = Object.fromEntries(
    (
      Object.entries(operationDefinition.responses) as [
        string,
        ResponseDefinition,
      ][]
    ).map(([status, responseDefinition]) => [
      status,
      {
        content: {
          'application/json': {
            schema: {
              $ref: `#/components/schemas/${responseDefinition.schemaName}`,
            },
          },
        },
        description: responseDefinition.description,
        headers: { [correlationResponseHeader]: correlationHeader },
      },
    ]),
  );

  const declaredHeaders =
    'requestHeaders' in operationDefinition
      ? operationDefinition.requestHeaders
      : [];
  const parameters = [
    {
      description: 'Caller-provided correlation identifier',
      in: 'header',
      name: correlationResponseHeader,
      required: false,
      schema: { maxLength: 128, type: 'string' },
    },
    ...declaredHeaders.map((name) => ({
      description: `Contract header ${name}`,
      in: 'header',
      name,
      required: false,
      schema: { maxLength: 200, type: 'string' },
    })),
  ];

  const requestSchemaName =
    'requestSchemaName' in operationDefinition
      ? operationDefinition.requestSchemaName
      : undefined;
  const requestBody =
    requestSchemaName === undefined
      ? {}
      : {
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${requestSchemaName}` },
              },
            },
            required: true,
          },
        };
  const summary =
    'summary' in operationDefinition
      ? { summary: operationDefinition.summary }
      : {};

  return {
    [operationDefinition.method]: {
      operationId: operationDefinition.operationId,
      parameters,
      ...requestBody,
      responses,
      security: securityFor(operationDefinition.security),
      ...summary,
    },
  };
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'VELORA API',
    version: '1.0.0-auth',
  },
  paths: Object.fromEntries(
    apiOperations.map((item) => [item.path, operation(item)]),
  ),
  components: {
    schemas: Object.fromEntries(
      Object.entries(apiSchemas).map(([name, value]) => [name, schema(value)]),
    ),
    securitySchemes,
  },
} as const;

const output = `${JSON.stringify(document, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '');
  if (current !== output) {
    console.error(
      'OpenAPI output is missing or stale. Run pnpm contracts:generate.',
    );
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');
}
