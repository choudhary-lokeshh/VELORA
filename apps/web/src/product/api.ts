'use client';

import {
  createConsumerApi,
  type ConsumerApi,
  type ConsumerTransport,
} from '@velora/consumer-client';

/**
 * Consumer Web's transport.
 *
 * The browser holds no token. The session lives in an `HttpOnly` cookie the
 * script cannot read, and the only value the script does read is the CSRF
 * companion cookie, which it echoes on state-changing requests. Everything
 * above this file is the shared consumer client, so there is one client
 * architecture rather than one per surface.
 */

const consumerWebCsrfCookieName = '__Host-velora_consumer_web_csrf';
const csrfHeaderName = 'x-velora-csrf';

export function readCsrfToken(cookieSource: string): string | undefined {
  for (const part of cookieSource.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== consumerWebCsrfCookieName) continue;
    const value = part.slice(separator + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}

export function createWebTransport(options: {
  readonly cookieSource?: () => string;
}): ConsumerTransport {
  const cookies =
    options.cookieSource ??
    (() => (typeof document === 'undefined' ? '' : document.cookie));
  return {
    headers(kind) {
      // The CSRF echo goes on state-changing requests only, which is exactly
      // where the server requires it. Sending it on reads would put a value the
      // script can read onto every request for no benefit.
      if (kind === 'read') return Promise.resolve({});
      const token = readCsrfToken(cookies());
      return Promise.resolve(
        token === undefined ? {} : { [csrfHeaderName]: token },
      );
    },
    requestInit: { credentials: 'include' },
  };
}

export function createWebConsumerApi(options: {
  readonly apiBaseUrl: string;
  readonly cookieSource?: () => string;
  readonly fetch?: typeof globalThis.fetch;
}): ConsumerApi {
  return createConsumerApi({
    apiBaseUrl: options.apiBaseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    transport: createWebTransport({
      ...(options.cookieSource === undefined
        ? {}
        : { cookieSource: options.cookieSource }),
    }),
  });
}
