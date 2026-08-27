import {
  adminExactActionAuthorizationHeader,
  correlationResponseHeader,
  csrfHeader,
  deviceHeader,
  idempotencyHeader,
} from '@velora/validation';

/**
 * Cross-origin policy for the API.
 *
 * ADR-0009 permits relaxing CORS only for a documented, reviewed need. The need
 * here is structural: Consumer Web, Creator Studio, and Platform Admin are
 * separate origins from the API, so a browser session cannot work without an
 * exact-origin credentialed CORS reply. The allowlist is exact origins from
 * configuration, never a wildcard and never a pattern, and credentials are
 * permitted only for an origin already on that list.
 */

/**
 * Exported so the `local-test` storage transport can allow exactly these and
 * its own two upload headers, rather than inventing a second list that drifts.
 * It shares this origin in local development, so a browser talking to it sends
 * whatever it sends the API.
 */
export const allowedRequestHeaderNames = [
  'content-type',
  'authorization',
  adminExactActionAuthorizationHeader,
  correlationResponseHeader,
  csrfHeader,
  deviceHeader,
  /*
   * The client key on every operation that must not happen twice.
   *
   * It was absent, and its absence was invisible: a custom header makes a POST
   * preflighted, so a browser never sent the request at all and the surface
   * reported that VELORA could not be reached. Every jsdom suite passed, because
   * a fetch double has no preflight — the only thing that catches this is a real
   * browser talking to a real API across two origins.
   */
  idempotencyHeader,
] as const;

const allowedRequestHeaders = allowedRequestHeaderNames.join(', ');

const allowedMethods = 'GET, POST, OPTIONS';
const preflightMaximumAgeSeconds = '600';

export function corsHeadersFor(
  origin: string | null,
  allowedOrigins: readonly string[],
): Readonly<Record<string, string>> {
  // `Vary: Origin` is emitted whether or not the origin matched, so a shared
  // cache can never serve one origin's credentialed reply to another.
  if (origin === null || !allowedOrigins.includes(origin)) {
    return { vary: 'origin' };
  }
  return {
    'access-control-allow-credentials': 'true',
    'access-control-allow-origin': origin,
    'access-control-expose-headers': correlationResponseHeader,
    vary: 'origin',
  };
}

export function isPreflight(request: Request): boolean {
  return (
    request.method === 'OPTIONS' &&
    request.headers.get('access-control-request-method') !== null
  );
}

export function preflightResponse(
  request: Request,
  allowedOrigins: readonly string[],
  extraHeaders: Readonly<Record<string, string>>,
): Response {
  const origin = request.headers.get('origin');
  const cors = corsHeadersFor(origin, allowedOrigins);
  if (!('access-control-allow-origin' in cors)) {
    // Unknown origin: answer without any allowance so the browser blocks it.
    return new Response(null, {
      headers: { ...extraHeaders, ...cors },
      status: 403,
    });
  }
  return new Response(null, {
    headers: {
      ...extraHeaders,
      ...cors,
      'access-control-allow-headers': allowedRequestHeaders,
      'access-control-allow-methods': allowedMethods,
      'access-control-max-age': preflightMaximumAgeSeconds,
    },
    status: 204,
  });
}
