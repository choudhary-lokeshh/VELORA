import {
  authErrorCodes,
  browserSessionCookieNames,
  csrfHeader,
  type AuthErrorCode,
  type BrowserAuthAudience,
} from '@velora/validation';

import {
  evaluateBrowserRequest,
  readBrowserRequestFacts,
} from './browser-request.js';
import type { AuthContext } from './context.js';
import {
  clearedSessionCookie,
  presentedSessionCookie,
  readCookie,
} from './cookies.js';
import type { AuthService } from './service.js';
import { digestToken, digestsEqual } from './tokens.js';

/**
 * Credential resolution for every route in the application, AUTH's own included.
 *
 * It lives in AUTH because AUTH owns authentication, and it is exported so a
 * product domain never re-implements cookie parsing, origin validation, CSRF
 * comparison, or bearer verification. A second implementation of any of those
 * is a security defect waiting to diverge from this one.
 */
export type ResolvedCaller =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'stale-cookie'; readonly cookies: readonly string[] }
  | { readonly kind: 'authenticated'; readonly context: AuthContext }
  | { readonly kind: 'csrf-rejected'; readonly code: AuthErrorCode }
  | { readonly kind: 'origin-rejected'; readonly code: AuthErrorCode };

/** CSRF companion cookie: readable by the surface's own script, never HttpOnly. */
export const csrfCookieNames = {
  consumer_web: '__Host-velora_consumer_web_csrf',
  creator_studio: '__Host-velora_creator_studio_csrf',
  platform_admin: '__Host-velora_platform_admin_csrf',
} as const satisfies Record<BrowserAuthAudience, string>;

const csrfCookieAttributes = ['Path=/', 'Secure', 'SameSite=Lax'];

export function csrfCookie(
  audience: BrowserAuthAudience,
  value: string,
  maxAgeSeconds: number,
): string {
  return [
    `${csrfCookieNames[audience]}=${value}`,
    ...csrfCookieAttributes,
    `Max-Age=${String(maxAgeSeconds)}`,
  ].join('; ');
}

export function clearedCsrfCookie(audience: BrowserAuthAudience): string {
  return [
    `${csrfCookieNames[audience]}=`,
    ...csrfCookieAttributes,
    'Max-Age=0',
  ].join('; ');
}

/** Expires whichever audience cookies the caller actually presented. */
export function expiredCookiesFor(request: Request): readonly string[] {
  const header = request.headers.get('cookie');
  const cookies: string[] = [];
  for (const [audience, name] of Object.entries(browserSessionCookieNames)) {
    if (readCookie(header, name) !== undefined) {
      cookies.push(
        clearedSessionCookie(audience as BrowserAuthAudience),
        clearedCsrfCookie(audience as BrowserAuthAudience),
      );
    }
  }
  return cookies;
}

export class CallerResolver {
  constructor(
    private readonly dependencies: {
      readonly allowedOrigins: Readonly<
        Record<BrowserAuthAudience, readonly string[]>
      >;
      readonly authService: AuthService;
    },
  ) {}

  browserVerdict(
    request: Request,
    audience: BrowserAuthAudience,
    cookiePresent: boolean,
  ): AuthErrorCode | undefined {
    const verdict = evaluateBrowserRequest(
      readBrowserRequestFacts(request, { cookiePresent }),
      this.dependencies.allowedOrigins[audience],
    );
    return verdict.allowed ? undefined : verdict.code;
  }

  /**
   * Derives the caller from the credential presented. A cookie session must
   * additionally satisfy origin and CSRF checks on state-changing requests; a
   * bearer access token carries no ambient authority and needs neither.
   */
  async resolve(request: Request): Promise<ResolvedCaller> {
    const cookieHeader = request.headers.get('cookie');
    const presented = presentedSessionCookie(cookieHeader);

    if (presented !== undefined) {
      const rejection = this.browserVerdict(request, presented.audience, true);
      if (rejection !== undefined) {
        return { code: rejection, kind: 'origin-rejected' };
      }
      const resolution =
        await this.dependencies.authService.resolveBrowserSession(
          presented.token,
        );
      // Anything other than an active session means the cookie this browser is
      // carrying is no longer usable, so it is cleared rather than ignored.
      if (resolution.kind !== 'active') {
        return {
          cookies: [
            clearedSessionCookie(presented.audience),
            clearedCsrfCookie(presented.audience),
          ],
          kind: 'stale-cookie',
        };
      }
      const method = request.method.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        const supplied = request.headers.get(csrfHeader);
        if (
          supplied === null ||
          !digestsEqual(digestToken(supplied), resolution.csrfDigest)
        ) {
          return { code: authErrorCodes.csrfRequired, kind: 'csrf-rejected' };
        }
      }
      return { context: resolution.context, kind: 'authenticated' };
    }

    const authorization = request.headers.get('authorization');
    if (authorization !== null) {
      const [scheme, value] = authorization.split(' ');
      if (scheme?.toLowerCase() === 'bearer' && value !== undefined) {
        const context =
          await this.dependencies.authService.resolveAccessToken(value);
        if (context !== undefined) return { context, kind: 'authenticated' };
      }
      return { kind: 'anonymous' };
    }
    return { kind: 'anonymous' };
  }
}
