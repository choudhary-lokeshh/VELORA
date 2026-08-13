import { z } from 'zod';

import { appEnvironmentSchema, serviceUrlSchema } from './shared.js';

const clientHttpUrlSchema = serviceUrlSchema('API base URL', [
  'http:',
  'https:',
]);

const clientConfigInputSchema = z
  .object({
    apiBaseUrl: z.string().optional(),
    appEnvironment: appEnvironmentSchema,
    localDefaultApiBaseUrl: clientHttpUrlSchema.optional(),
  })
  .strict();

const clientConfigSchema = z
  .object({
    apiBaseUrl: clientHttpUrlSchema,
    appEnvironment: appEnvironmentSchema,
  })
  .readonly();

export type ClientConfig = z.infer<typeof clientConfigSchema>;

export interface ClientConfigInput {
  readonly apiBaseUrl?: string | undefined;
  readonly appEnvironment: string;
  readonly localDefaultApiBaseUrl?: string | undefined;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  );
}

export function loadClientConfig(input: ClientConfigInput): ClientConfig {
  const parsed = clientConfigInputSchema.parse(input);
  const mayUseLocalDefault =
    parsed.appEnvironment === 'local' || parsed.appEnvironment === 'test';
  const apiBaseUrl =
    parsed.apiBaseUrl ??
    (mayUseLocalDefault ? parsed.localDefaultApiBaseUrl : undefined);

  if (apiBaseUrl === undefined) {
    throw new Error(
      'API base URL is required outside explicit local/test environments',
    );
  }

  const url = new URL(apiBaseUrl);
  if (!mayUseLocalDefault && isLocalHostname(url.hostname)) {
    throw new Error('Staging/production API base URL cannot use localhost');
  }

  return clientConfigSchema.parse({
    apiBaseUrl: url.toString().replace(/\/$/, ''),
    appEnvironment: parsed.appEnvironment,
  });
}

export { appEnvironmentSchema } from './shared.js';
export type { AppEnvironment } from './shared.js';
