import { z } from 'zod';

import { appEnvironmentSchema, serviceUrlSchema } from './shared.js';

const clientHttpUrlSchema = serviceUrlSchema('API base URL', [
  'http:',
  'https:',
]);

/**
 * An origin and nothing else: no path, no query, no fragment.
 *
 * A delivery origin carrying a path would land in a Content-Security-Policy
 * source list, where a path means something different from what whoever wrote
 * it meant, so it is refused here instead of silently narrowing the policy.
 */
const clientOriginSchema = clientHttpUrlSchema.refine(
  (value) => new URL(value).origin === value,
  'Media delivery origin must be an exact scheme://host[:port] value',
);

/**
 * The origin a public address is written against, when one has been declared.
 *
 * Same shape rule as the delivery origin and for a related reason: a canonical
 * URL, a sitemap entry, and a social preview are all absolute addresses built
 * by joining a path onto this, and an origin carrying a path or a trailing
 * slash produces a different address than the one a person would type. It is
 * refused here rather than repaired, because a canonical that disagrees with
 * the address it canonicalises is worse than no canonical at all.
 */
const publicOriginSchema = clientHttpUrlSchema.refine(
  (value) => new URL(value).origin === value,
  'Public web origin must be an exact scheme://host[:port] value',
);

const clientConfigInputSchema = z
  .object({
    apiBaseUrl: z.string().optional(),
    appEnvironment: appEnvironmentSchema,
    localDefaultApiBaseUrl: clientHttpUrlSchema.optional(),
    mediaDeliveryOrigin: clientOriginSchema.optional(),
    publicWebOrigin: publicOriginSchema.optional(),
    realtimeEndpoint: z.string().optional(),
  })
  .strict();

const clientConfigSchema = z
  .object({
    apiBaseUrl: clientHttpUrlSchema,
    appEnvironment: appEnvironmentSchema,
    mediaDeliveryOrigin: clientOriginSchema.optional(),
    /**
     * The origin Consumer Web is reached at from outside, when it is known.
     *
     * Absent is the honest state almost everywhere: a preview deployment, a
     * developer's machine, and a browser suite all serve the same product at an
     * address nobody else can resolve, and writing that address into a canonical
     * tag would publish a link to a host that does not exist. Everything that
     * needs an absolute public address treats absence as "this environment has
     * no public identity", which is also what decides indexability.
     */
    publicWebOrigin: publicOriginSchema.optional(),
    /**
     * The realtime media address a surface's policy must permit.
     *
     * Not validated as an origin here, and deliberately: it is a `ws://` or
     * `wss://` address, `clientOriginSchema` describes an HTTP one, and a
     * schema that accepted both would be a schema that accepted the wrong one
     * for either field. Its shape is checked where it is used, by
     * `realtimeConnectSources`, which contributes nothing for a value it cannot
     * read — so a malformed address narrows the policy rather than widening it.
     */
    realtimeEndpoint: z.string().optional(),
  })
  .readonly();

export type ClientConfig = z.infer<typeof clientConfigSchema>;

export interface ClientConfigInput {
  readonly apiBaseUrl?: string | undefined;
  readonly appEnvironment: string;
  readonly localDefaultApiBaseUrl?: string | undefined;
  readonly mediaDeliveryOrigin?: string | undefined;
  readonly publicWebOrigin?: string | undefined;
  readonly realtimeEndpoint?: string | undefined;
}

/**
 * The loopback address, in the forms `URL` can hand back.
 *
 * One predicate, because there were two and they disagreed. The staging and
 * production guard below tested for `'::1'`, which `URL` never produces — it
 * normalises `http://[::1]:4000` to the hostname `'[::1]'`, brackets included —
 * so the IPv6 loopback passed a check written to refuse it while the
 * `upgrade-insecure-requests` decision, testing the bracketed form, called the
 * same address local. A deployed surface could therefore be pointed at an
 * endpoint that exists nowhere, and have its Content-Security-Policy permit it.
 *
 * `URL` already collapses the IPv4 shorthands (`127.1` and `2130706433` both
 * arrive as `127.0.0.1`), so only the IPv6 spellings need naming here: the
 * loopback itself, the whole `127.0.0.0/8` block, and the IPv4-mapped form,
 * which `URL` prints in hex as `[::ffff:7f00:1]`.
 */
const mappedIpv4LoopbackPattern = /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/u;
const ipv4LoopbackPattern = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    ipv4LoopbackPattern.test(hostname) ||
    mappedIpv4LoopbackPattern.test(hostname)
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
  if (!mayUseLocalDefault && isLoopbackHostname(url.hostname)) {
    throw new Error('Staging/production API base URL cannot use localhost');
  }

  const { mediaDeliveryOrigin } = parsed;
  if (
    mediaDeliveryOrigin !== undefined &&
    !mayUseLocalDefault &&
    isLoopbackHostname(new URL(mediaDeliveryOrigin).hostname)
  ) {
    throw new Error(
      'Staging/production media delivery origin cannot use localhost',
    );
  }

  const { publicWebOrigin } = parsed;
  if (
    publicWebOrigin !== undefined &&
    !mayUseLocalDefault &&
    isLoopbackHostname(new URL(publicWebOrigin).hostname)
  ) {
    throw new Error(
      'Staging/production public web origin cannot use localhost',
    );
  }

  return clientConfigSchema.parse({
    apiBaseUrl: url.toString().replace(/\/$/, ''),
    appEnvironment: parsed.appEnvironment,
    ...(mediaDeliveryOrigin === undefined ? {} : { mediaDeliveryOrigin }),
    ...(publicWebOrigin === undefined ? {} : { publicWebOrigin }),
    ...(parsed.realtimeEndpoint === undefined ||
    parsed.realtimeEndpoint.length === 0
      ? {}
      : { realtimeEndpoint: parsed.realtimeEndpoint }),
  });
}

/**
 * The loopback API every surface falls back to in local development.
 *
 * Declared once. It used to be written out in each surface's own resolver,
 * which is survivable, and in none of their middlewares, which was not: the
 * header layer read the raw environment while the page layer applied this
 * default, so a local surface advertised `connect-src 'self'` and then served a
 * page that called this address. Every request the browser made was refused by
 * the policy the same process had just set.
 */
export const loopbackApiBaseUrl = 'http://127.0.0.1:4000';

/** The server environment a Next.js surface reads at request time. */
export interface SurfaceEnvironment {
  readonly NODE_ENV?: string | undefined;
  readonly VELORA_API_BASE_URL?: string | undefined;
  readonly VELORA_APP_ENV?: string | undefined;
  readonly VELORA_MEDIA_DELIVERY_ORIGIN?: string | undefined;
  readonly VELORA_REALTIME_ENDPOINT?: string | undefined;
  readonly VELORA_WEB_PUBLIC_ORIGIN?: string | undefined;
}

/**
 * One resolution of a Next.js surface's environment, for every consumer of it.
 *
 * The origin a page calls and the origin its Content-Security-Policy permits
 * are the same fact, so they are derived together rather than separately. An
 * absent `VELORA_APP_ENV` falls back to the runtime's own signal, which is the
 * only inference here; everything else, including the refusal of a loopback
 * endpoint outside local and test, belongs to `loadClientConfig`.
 */
export function resolveSurfaceConfig(
  environment: SurfaceEnvironment,
): ClientConfig {
  // Blank and absent are the same statement — no separate delivery origin —
  // and an environment file writes the blank form, so they resolve alike here
  // rather than failing an origin parse on the empty string.
  const mediaDeliveryOrigin = environment.VELORA_MEDIA_DELIVERY_ORIGIN;
  const realtimeEndpoint = environment.VELORA_REALTIME_ENDPOINT;
  const publicWebOrigin = environment.VELORA_WEB_PUBLIC_ORIGIN;
  return loadClientConfig({
    apiBaseUrl: environment.VELORA_API_BASE_URL,
    appEnvironment:
      environment.VELORA_APP_ENV ??
      (environment.NODE_ENV === 'production' ? 'production' : 'local'),
    localDefaultApiBaseUrl: loopbackApiBaseUrl,
    ...(mediaDeliveryOrigin === undefined || mediaDeliveryOrigin.length === 0
      ? {}
      : { mediaDeliveryOrigin }),
    ...(publicWebOrigin === undefined || publicWebOrigin.length === 0
      ? {}
      : { publicWebOrigin }),
    ...(realtimeEndpoint === undefined || realtimeEndpoint.length === 0
      ? {}
      : { realtimeEndpoint }),
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
  /** True only for `next dev`; never inferred from the product environment. */
  readonly developmentRuntime?: boolean | undefined;
  /**
   * Exact origin that serves media bytes, when it is not the API's own.
   *
   * Omitted means the API origin serves them, which is every environment that
   * has no approved storage or delivery provider. Named separately because the
   * two are separate facts: a surface reached at its own hostname calls the API
   * on that hostname, while the bytes come from wherever delivery issues them.
   */
  readonly mediaDeliveryOrigin?: string | undefined;
  /**
   * Exact address of the realtime media project this surface may reach, when
   * one is configured.
   *
   * Named separately from the API and from delivery because it is a third,
   * genuinely different fact: a provider's media endpoint is not this
   * platform's origin, and a `connect-src` that did not name it would refuse
   * the WebSocket *after* somebody had already granted a camera. Both schemes
   * derived from the one value are permitted — the socket carries the session
   * and the same host answers the provider's own HTTP setup calls — so there is
   * one thing to configure and no way for the two to disagree.
   *
   * Omitted in every environment with no approved provider, which is every
   * deployed one, and the resulting policy is then exactly what it was before
   * this option existed.
   */
  readonly realtimeEndpoint?: string | undefined;
  /**
   * Whether this surface may open a camera and a microphone at all.
   *
   * `denied` is the default and what every surface had until ADR-0040: a
   * `Permissions-Policy` that names no allow-list for a capability disables it
   * for the document, and a surface that never captures should not be able to
   * start. `self` permits capture on this origin only, and never in a frame.
   *
   * It is opt-in per surface rather than a blanket relaxation because the three
   * browser surfaces have genuinely different needs: Consumer Web opens a
   * camera for live discovery, and Creator Studio and Platform Admin have no
   * reason to and must keep being unable to. It is also the reason live
   * discovery could not work in a browser at all until it was added — the
   * header refused the capture before any permission prompt was reached, which
   * is a refusal no amount of user consent could have overridden.
   *
   * Geolocation stays denied on every surface. Nothing in this product asks for
   * a location, and a capability that is only ever going to be refused belongs
   * in the header rather than in a code review.
   */
  readonly mediaCapture?: 'denied' | 'self' | undefined;
  readonly referrerPolicy: 'no-referrer' | 'same-origin';
  readonly robots?: string | undefined;
}

/**
 * The extra origins a surface is allowed to reach, when it has any.
 *
 * The same list serves `connect-src` and `img-src`, because a photograph is
 * asked for and then rendered and both halves have to be permitted. Usually
 * there is one origin — the API's, since the development storage adapter has no
 * origin of its own and answers on the API's. A second appears when the bytes
 * come from somewhere else: an approved storage or delivery provider, or a
 * local development topology where each surface calls the API on its own
 * hostname while delivery issues addresses on one. Exact origins either way,
 * never a wildcard.
 *
 * A malformed value contributes nothing rather than throwing: a configuration
 * mistake must not turn every route into a 500, and a policy that names one
 * fewer origin fails closed.
 */
function withOrigins(
  baseline: string,
  ...urls: readonly (string | undefined)[]
): string {
  const origins: string[] = [];
  for (const url of urls) {
    if (url === undefined || url.length === 0) continue;
    try {
      const { origin } = new URL(url);
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      continue;
    }
  }
  return [baseline, ...origins].join(' ');
}

function isLoopbackApi(apiBaseUrl: string | undefined): boolean {
  if (apiBaseUrl === undefined || apiBaseUrl.length === 0) return false;
  try {
    const url = new URL(apiBaseUrl);
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Names reserved for a developer's own machine, which no deployment can hold.
 *
 * `.localhost` is reserved for the loopback interface by RFC 6761 and
 * `.local` for link-local multicast DNS by RFC 6762. Neither is delegable, so
 * neither can ever resolve to a Velora deployment — which is what makes them
 * safe to name here alongside the loopback addresses.
 */
function isLocalDevelopmentHostname(hostname: string): boolean {
  return (
    isLoopbackHostname(hostname) ||
    hostname === 'local' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  );
}

/**
 * Whether the configured API is one a developer is running on this machine.
 *
 * Wider than `isLoopbackApi` by exactly the reserved names above, and used only
 * for the `next dev` allowance below. The two are deliberately separate: a
 * plain-HTTP loopback endpoint is the one thing
 * `upgrade-insecure-requests` must not be applied to, whereas a local
 * development domain is served over TLS and wants the directive left on.
 */
function isLocalDevelopmentApi(apiBaseUrl: string | undefined): boolean {
  if (apiBaseUrl === undefined || apiBaseUrl.length === 0) return false;
  try {
    const url = new URL(apiBaseUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLocalDevelopmentHostname(url.hostname)
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

/**
 * React's development runtime uses `eval` to reconstruct component stacks.
 * Permit that debugging primitive only for `next dev` against an API this
 * machine is itself running. A production Next.js server using local/test data
 * remains on the deployed CSP.
 *
 * The address, not only the loopback address. Local development also runs the
 * surfaces behind their own reserved hostnames over TLS, and a policy that
 * dropped `'unsafe-eval'` there would leave a developer with a broken hot
 * reload and a console full of policy violations for a topology that is still
 * entirely on their own machine. All three conditions still have to hold, and
 * `isLocalDevelopmentApi` admits only names no deployment can ever hold.
 */
function permitsDevelopmentEval(
  options: BrowserSecurityHeaderOptions,
): boolean {
  const local =
    options.appEnvironment === 'local' || options.appEnvironment === 'test';
  return (
    options.developmentRuntime === true &&
    local &&
    isLocalDevelopmentApi(options.apiBaseUrl)
  );
}

/**
 * The capability allow-list this surface publishes.
 *
 * Written as an allow-list with an empty default rather than as a set of
 * relaxations, so a capability nobody has thought about is disabled: a name
 * absent from this header is not permitted for the document, and adding one
 * means writing it down here.
 *
 * Geolocation is `()` unconditionally. `camera` and `microphone` are `()` for
 * every surface that has not asked for them, and `(self)` — this origin, never
 * a frame — for the one that has.
 */
/**
 * The two addresses a realtime media endpoint is reached at, from the one that
 * is configured.
 *
 * A malformed value contributes nothing rather than throwing, on the same rule
 * `withOrigins` follows: a configuration mistake must not turn every route into
 * a 500, and a policy naming one fewer origin fails closed.
 */
function realtimeConnectSources(
  endpoint: string | undefined,
): readonly string[] {
  if (endpoint === undefined || endpoint.length === 0) return [];
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return [];
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return [];
  const secure = parsed.protocol === 'wss:';
  return [
    `${secure ? 'wss' : 'ws'}://${parsed.host}`,
    `${secure ? 'https' : 'http'}://${parsed.host}`,
  ];
}

function permissionsPolicy(options: BrowserSecurityHeaderOptions): string {
  const capture = options.mediaCapture === 'self' ? '(self)' : '()';
  return `camera=${capture}, geolocation=(), microphone=${capture}`;
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
      `connect-src ${withOrigins(
        "'self'",
        options.apiBaseUrl,
        options.mediaDeliveryOrigin,
        // Both, from one configured address. A media provider negotiates over a
        // socket and reads its own settings over HTTP on the same host, and a
        // policy naming only the socket fails at a point where the person has
        // already been asked for their camera.
        ...realtimeConnectSources(options.realtimeEndpoint),
      )}`,
      // The API origin is named here as well as in `connect-src`, because a
      // consumer photograph is fetched from it: delivery issues a signed,
      // short-lived address on the origin that serves the bytes, and a policy
      // that allowed the surface to *ask* for one but not to *render* it would
      // leave every person on the platform as an identity mark for a reason no
      // developer tool would explain.
      `img-src ${withOrigins("'self' data:", options.apiBaseUrl, options.mediaDeliveryOrigin)}`,
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${
        permitsDevelopmentEval(options) ? " 'unsafe-eval'" : ''
      }`,
      ...(upgradesInsecureRequests(options)
        ? ['upgrade-insecure-requests']
        : []),
    ].join('; '),
    'permissions-policy': permissionsPolicy(options),
    'referrer-policy': options.referrerPolicy,
    'strict-transport-security': 'max-age=63072000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...(options.robots === undefined ? {} : { 'x-robots-tag': options.robots }),
  };
}

/**
 * Whether a surface's public pages may be indexed by a search engine at all.
 *
 * Two conditions, both required, and neither of them a preference. An
 * environment that is not production is serving fixtures, seeded people, and
 * local-test providers, and every one of those would be indexed as though it
 * were the product. An environment with no declared public origin cannot write
 * a canonical URL, and a page indexed without one competes with itself under
 * every address it happens to be reachable at.
 *
 * The default is therefore "no", and it is the safe direction: a page that is
 * crawlable and should not be cannot be un-indexed by changing this later,
 * while a page that is not crawlable and should be becomes so the moment the
 * origin is configured.
 */
export function publicIndexingAllowed(config: {
  readonly appEnvironment: string;
  readonly publicWebOrigin?: string | undefined;
}): boolean {
  return (
    config.appEnvironment === 'production' &&
    config.publicWebOrigin !== undefined
  );
}

export { appEnvironmentSchema } from './shared.js';
export type { AppEnvironment } from './shared.js';
