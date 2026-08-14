import {
  createConsumerApi,
  type ConsumerApi,
  type ConsumerTransport,
} from '@velora/consumer-client';

import type { MobileAuthManager } from '../auth/session';

/**
 * Consumer Mobile's transport.
 *
 * The token comes from the session manager on every request rather than being
 * captured once. That is what makes a rotation transparent: a request issued
 * while the access token is expiring waits for the single in-flight refresh and
 * then goes out with the new token, instead of failing and asking the person to
 * sign in again.
 *
 * No ambient credential is sent. The device holds a bearer token in
 * platform-keystore-backed storage, and a cookie the app never sees plays no
 * part; `credentials` is deliberately left at the platform default so a
 * misconfigured proxy cannot turn this into a cookie-authenticated client.
 *
 * A request made with no token is sent without an `authorization` header and is
 * refused by the server with a 401, which the shared client turns into
 * `unauthenticated`. Guessing a header, retrying silently, or treating "no
 * token" as "anonymous access" would each hide the one condition the surface
 * must react to.
 */
export function createMobileTransport(
  auth: MobileAuthManager,
): ConsumerTransport {
  return {
    async headers() {
      const token = await auth.accessToken();
      return token === undefined ? {} : { authorization: `Bearer ${token}` };
    },
  };
}

export function createMobileConsumerApi(options: {
  readonly apiBaseUrl: string;
  readonly auth: MobileAuthManager;
  readonly fetch?: typeof globalThis.fetch;
}): ConsumerApi {
  return createConsumerApi({
    apiBaseUrl: options.apiBaseUrl,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    transport: createMobileTransport(options.auth),
  });
}
