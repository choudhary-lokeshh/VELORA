import { authErrorCodes, type AuthErrorCode } from '@velora/validation';

/**
 * Browser-origin defences for cookie-carrying requests: exact `Origin`
 * validation, Fetch Metadata validation where the browser supplies it, and a
 * server-bound CSRF token. ADR-0009 and ADR-0017 require all three for
 * state-changing requests on a cookie session.
 *
 * Nothing here is relaxed for local development. A caller that presents no
 * `Origin` and no session cookie is not a browser, so it is not a cross-site
 * request forgery vector and is judged only by the credential it carries.
 */

export interface BrowserRequestFacts {
  readonly cookiePresent: boolean;
  readonly origin: string | null;
  readonly secFetchMode: string | null;
  readonly secFetchSite: string | null;
  readonly stateChanging: boolean;
}

export type BrowserRequestVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: AuthErrorCode };

const rejectedFetchSites = new Set(['cross-site']);

export function evaluateBrowserRequest(
  facts: BrowserRequestFacts,
  allowedOrigins: readonly string[],
): BrowserRequestVerdict {
  // A malformed Origin is never treated as absent: `null`, an opaque origin,
  // or anything not on the allowlist is refused outright.
  if (facts.origin !== null && !allowedOrigins.includes(facts.origin)) {
    return { allowed: false, code: authErrorCodes.originRejected };
  }
  if (!facts.stateChanging) return { allowed: true };

  if (
    facts.secFetchSite !== null &&
    rejectedFetchSites.has(facts.secFetchSite)
  ) {
    return { allowed: false, code: authErrorCodes.originRejected };
  }
  // A browser navigation cannot produce a JSON API call, so `no-cors` and
  // `navigate` modes on a state-changing AUTH request are refused.
  if (
    facts.secFetchMode !== null &&
    facts.secFetchMode !== 'cors' &&
    facts.secFetchMode !== 'same-origin'
  ) {
    return { allowed: false, code: authErrorCodes.originRejected };
  }
  // An ambient credential without a provable origin is exactly the shape of a
  // forged request, so it is refused even when Fetch Metadata is missing.
  if (facts.cookiePresent && facts.origin === null) {
    return { allowed: false, code: authErrorCodes.originRejected };
  }
  return { allowed: true };
}

export function readBrowserRequestFacts(
  request: Request,
  options: { readonly cookiePresent: boolean },
): BrowserRequestFacts {
  const method = request.method.toUpperCase();
  return {
    cookiePresent: options.cookiePresent,
    origin: request.headers.get('origin'),
    secFetchMode: request.headers.get('sec-fetch-mode'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    stateChanging:
      method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS',
  };
}
