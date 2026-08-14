import {
  createVeloraApiClient,
  type AuthSessionResponse,
} from '@velora/api-client';

/**
 * Creator Studio AUTH transport.
 *
 * The same architecture as Consumer Web and a different audience, which is the
 * point: the session lives in a `__Host-` `HttpOnly` cookie scoped to this
 * surface, the script reads only the CSRF companion, and a consumer cookie is
 * never accepted here because it is a different cookie name entirely. Nothing
 * in this module decides authorization; every answer comes from the server.
 *
 * No bearer token is stored in browser storage. ADR-0017 forbids it, and a
 * privileged-adjacent surface is the last place to make an exception.
 */

const creatorStudioCsrfCookieName = '__Host-velora_creator_studio_csrf';
const csrfHeaderName = 'x-velora-csrf';

export type CreatorAuthOutcome =
  | { readonly kind: 'authenticated'; readonly session: AuthSessionResponse }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'unavailable' };

export function readCreatorCsrfToken(cookieSource: string): string | undefined {
  for (const part of cookieSource.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== creatorStudioCsrfCookieName) {
      continue;
    }
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

function errorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return 'AUTH_UNAVAILABLE';
  }
  const { code }: { code: unknown } = error;
  return typeof code === 'string' ? code : 'AUTH_UNAVAILABLE';
}

export interface CreatorAuthClient {
  logout(): Promise<CreatorAuthOutcome>;
  session(): Promise<CreatorAuthOutcome>;
  signIn(subject: string): Promise<CreatorAuthOutcome>;
}

export function createCreatorStudioAuthClient(options: {
  readonly apiBaseUrl: string;
  readonly cookieSource?: () => string;
  /** Injectable so the session lifecycle is testable without a browser. */
  readonly fetch?: typeof globalThis.fetch;
}): CreatorAuthClient {
  const api = createVeloraApiClient(options.apiBaseUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const cookies =
    options.cookieSource ??
    (() => (typeof document === 'undefined' ? '' : document.cookie));

  const csrfHeaders = (): Record<string, string> => {
    const token = readCreatorCsrfToken(cookies());
    return token === undefined ? {} : { [csrfHeaderName]: token };
  };

  return {
    async logout() {
      try {
        const result = await api.POST('/v1/auth/logout', {
          credentials: 'include',
          headers: csrfHeaders(),
        });
        if (result.response.ok) return { kind: 'unauthenticated' };
        if (result.response.status === 403) {
          return { code: errorCode(result.error), kind: 'rejected' };
        }
        return { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },

    async session() {
      try {
        const result = await api.GET('/v1/auth/session', {
          credentials: 'include',
        });
        if (result.data !== undefined) {
          return { kind: 'authenticated', session: result.data };
        }
        if (result.response.status === 401) return { kind: 'unauthenticated' };
        return { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },

    async signIn(subject) {
      try {
        const result = await api.POST('/v1/auth/local/web-sessions', {
          body: { audience: 'creator_studio', subject },
          credentials: 'include',
        });
        if (result.data !== undefined) {
          return { kind: 'authenticated', session: result.data };
        }
        if (result.response.status >= 400 && result.response.status < 500) {
          return { code: errorCode(result.error), kind: 'rejected' };
        }
        return { kind: 'unavailable' };
      } catch {
        return { kind: 'unavailable' };
      }
    },
  };
}

export type { AuthSessionResponse };
