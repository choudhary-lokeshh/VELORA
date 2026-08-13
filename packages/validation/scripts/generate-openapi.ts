import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  apiErrorSchema,
  apiOperations,
  livenessResponseSchema,
  readinessResponseSchema,
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

function operation(operationDefinition: (typeof apiOperations)[number]) {
  interface ResponseDefinition {
    readonly description: string;
    readonly schemaName: 'ApiError' | 'LivenessResponse' | 'ReadinessResponse';
  }
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
        headers: { 'x-correlation-id': correlationHeader },
      },
    ]),
  );
  return {
    [operationDefinition.method]: {
      operationId: operationDefinition.operationId,
      parameters: [
        {
          description: 'Caller-provided correlation identifier',
          in: 'header',
          name: 'x-correlation-id',
          required: false,
          schema: { maxLength: 128, type: 'string' },
        },
      ],
      responses,
    },
  };
}

const document = {
  openapi: '3.1.0',
  info: {
    title: 'VELORA API',
    version: '1.0.0-bootstrap',
  },
  paths: Object.fromEntries(
    apiOperations.map((item) => [item.path, operation(item)]),
  ),
  components: {
    schemas: {
      ApiError: schema(apiErrorSchema),
      LivenessResponse: schema(livenessResponseSchema),
      ReadinessResponse: schema(readinessResponseSchema),
    },
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
