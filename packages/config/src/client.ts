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

/**
 * Baseline browser security headers for the Next.js surfaces.
 *
 * No deployment edge owns headers yet (ADR-0014 leaves the CDN/DNS vendor
 * deferred), so each application sets them. They are built here once rather
 * than restated per surface, and they are applied at request time so the API
 * origin a browser is allowed to reach comes from the environment instead of
 * being baked into the build artifact. `script-src 'unsafe-inline'` remains
 * required by Next.js hydration payloads; a nonce-based policy is deferred with
 * the edge decision.
 */
export interface BrowserSecurityHeaderOptions {
  /** Exact API origin the surface may call. Omitted means same-origin only. */
  readonly apiBaseUrl?: string | undefined;
  readonly appEnvironment?: string | undefined;
  readonly referrerPolicy: 'no-referrer' | 'same-origin';
  readonly robots?: string | undefined;
}

function connectSources(apiBaseUrl: string | undefined): string {
  if (apiBaseUrl === undefined || apiBaseUrl.length === 0) return "'self'";
  try {
    const { origin } = new URL(apiBaseUrl);
    return `'self' ${origin}`;
  } catch {
    return "'self'";
  }
}

function isLoopbackApi(apiBaseUrl: string | undefined): boolean {
  if (apiBaseUrl === undefined || apiBaseUrl.length === 0) return false;
  try {
    const url = new URL(apiBaseUrl);
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

/**
 * `upgrade-insecure-requests` is unconditional for every deployed environment.
 * It is omitted only when the application environment is explicitly local or
 * test *and* the configured API is a plain-HTTP loopback address — a
 * combination `loadClientConfig` refuses outside those environments, so no
 * deployment can reach it. The omission exists because WebKit applies the
 * directive to loopback origins that Chromium and Firefox exempt, which makes a
 * plain-HTTP local API unreachable and takes Safari out of local development and
 * out of browser test coverage. Production is HTTPS end to end, where the
 * directive has nothing to upgrade and stays on regardless.
 */
function upgradesInsecureRequests(
  options: BrowserSecurityHeaderOptions,
): boolean {
  const local =
    options.appEnvironment === 'local' || options.appEnvironment === 'test';
  return !(local && isLoopbackApi(options.apiBaseUrl));
}

export function browserSecurityHeaders(
  options: BrowserSecurityHeaderOptions,
): Readonly<Record<string, string>> {
  return {
    'content-security-policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      `connect-src ${connectSources(options.apiBaseUrl)}`,
      "img-src 'self' data:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      ...(upgradesInsecureRequests(options)
        ? ['upgrade-insecure-requests']
        : []),
    ].join('; '),
    'permissions-policy': 'camera=(), geolocation=(), microphone=()',
    'referrer-policy': options.referrerPolicy,
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...(options.robots === undefined ? {} : { 'x-robots-tag': options.robots }),
  };
}

export { appEnvironmentSchema } from './shared.js';
export type { AppEnvironment } from './shared.js';
