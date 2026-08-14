import {
  createVeloraApiClient,
  type AuthSessionResponse,
} from '@velora/api-client';

/**
 * Consumer Web AUTH transport.
 *
 * The browser holds no token. The session lives in an `HttpOnly` cookie the
 * script cannot read, and the only value the script does read is the CSRF
 * companion cookie, which it echoes on state-changing requests. Nothing here
 * decides authorization: every answer comes from the server.
 */

const consumerWebCsrfCookieName = '__Host-velora_consumer_web_csrf';
const csrfHeaderName = 'x-velora-csrf';

export type AuthOutcome =
  | { readonly kind: 'authenticated'; readonly session: AuthSessionResponse }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'rejected'; readonly code: string }
  | { readonly kind: 'unavailable' };

function readCsrfToken(cookieSource: string): string | undefined {
  for (const part of cookieSource.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== consumerWebCsrfCookieName) continue;
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

export interface ConsumerWebAuthClient {
  logout(): Promise<AuthOutcome>;
  logoutEverywhere(): Promise<AuthOutcome>;
  session(): Promise<AuthOutcome>;
  signIn(subject: string): Promise<AuthOutcome>;
}

export function createConsumerWebAuthClient(options: {
  readonly apiBaseUrl: string;
  readonly cookieSource?: () => string;
  /** Injectable so the session lifecycle is testable without a browser. */
  readonly fetch?: typeof globalThis.fetch;
}): ConsumerWebAuthClient {
  const api = createVeloraApiClient(options.apiBaseUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const cookies =
    options.cookieSource ??
    (() => (typeof document === 'undefined' ? '' : document.cookie));

  const csrfHeaders = (): Record<string, string> => {
    const token = readCsrfToken(cookies());
    return token === undefined ? {} : { [csrfHeaderName]: token };
  };

  const acknowledge = (result: {
    readonly error?: unknown;
    readonly response: Response;
  }): AuthOutcome => {
    if (result.response.ok) return { kind: 'unauthenticated' };
    if (result.response.status === 403) {
      return { code: errorCode(result.error), kind: 'rejected' };
    }
    return { kind: 'unavailable' };
  };

  return {
    async logout() {
      try {
        return acknowledge(
          await api.POST('/v1/auth/logout', {
            credentials: 'include',
            headers: csrfHeaders(),
          }),
        );
      } catch {
        return { kind: 'unavailable' };
      }
    },

    async logoutEverywhere() {
      try {
        const result = await api.POST('/v1/auth/logout-all', {
          credentials: 'include',
          headers: csrfHeaders(),
        });
        // Global logout needs a live session; an expired one is already the
        // outcome the caller wanted.
        if (result.response.status === 401) return { kind: 'unauthenticated' };
        return acknowledge(result);
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
          body: { audience: 'consumer_web', subject },
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

export { readCsrfToken };
export type { AuthSessionResponse };
