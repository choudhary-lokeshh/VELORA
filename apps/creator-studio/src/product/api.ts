import { createCreatorApi, type CreatorApi } from '@velora/creator-client';

import { readCreatorCsrfToken } from '../auth/client';

/**
 * Creator Studio's transport for the creator API.
 *
 * The browser holds no token. The session is a `__Host-` `HttpOnly` cookie the
 * script cannot read, sent because this surface and the API are different
 * origins and the request is credentialed; the only value the script reads is
 * the CSRF companion cookie, which it echoes on writes. A read carries no CSRF
 * header because a read changes nothing, and sending one anyway would spread a
 * value the server does not want spread.
 */
export function createStudioCreatorApi(options: {
  readonly apiBaseUrl: string;
  readonly cookieSource?: () => string;
  /** Injected by tests so the surface runs without a network. */
  readonly fetch?: typeof globalThis.fetch;
}): CreatorApi {
  const cookies =
    options.cookieSource ??
    (() => (typeof document === 'undefined' ? '' : document.cookie));

  return createCreatorApi({
    apiBaseUrl: options.apiBaseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    transport: {
      headers: (kind) => {
        if (kind === 'read') return Promise.resolve({});
        const token = readCreatorCsrfToken(cookies());
        return Promise.resolve(
          token === undefined ? {} : { 'x-velora-csrf': token },
        );
      },
      requestInit: { credentials: 'include' },
    },
  });
}
