import {
  attempt,
  createVeloraApiClient,
  type ApiResult,
} from '@velora/api-client';

import type {
  CreatorAccount,
  CreatorOnboardingState,
  CreatorPolicyDocument,
  CreatorProfile,
  CreatorPublicationBody,
  PublicCreator,
  SaveCreatorProfileBody,
} from './contract.js';

/**
 * The creator product surface, once, for every client that has one.
 *
 * Every call goes through the generated client with its literal contract path,
 * so a route, body, or response that changes is a compile error here rather
 * than a runtime surprise in a screen. Nothing in this module knows a table, a
 * repository, or a server-side rule: it moves requests and classifies answers,
 * and every authorization decision belongs to the server.
 *
 * How a request proves who is making it is the only thing injected. Creator
 * Studio sends an `HttpOnly` cookie the script cannot read plus a CSRF echo,
 * exactly as Consumer Web does with its own audience's cookie — and never a
 * bearer token in browser storage, which ADR-0017 forbids.
 */

export interface CreatorTransport {
  /** Headers for a read or a write. Awaited so a token could be refreshed. */
  headers(kind: 'read' | 'write'): Promise<Record<string, string>>;
  /** Fetch options every credentialed request carries. */
  readonly requestInit?: { readonly credentials?: RequestCredentials };
}

export interface CreatorApiOptions {
  readonly apiBaseUrl: string;
  /** Injectable so a surface is testable without a network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly transport: CreatorTransport;
}

export interface CreatorApi {
  acknowledgePolicies(
    documents: readonly CreatorPolicyDocument[],
  ): Promise<ApiResult<CreatorOnboardingState>>;
  account(): Promise<ApiResult<CreatorAccount>>;
  createAccount(): Promise<ApiResult<CreatorAccount>>;
  onboarding(): Promise<ApiResult<CreatorOnboardingState>>;
  profile(): Promise<ApiResult<CreatorProfile>>;
  /**
   * The public projection for a handle. Deliberately on the same client and
   * deliberately without credentials: it is the one creator route that answers
   * identically for everybody, and sending a session with it would attach an
   * identity to a request that has no use for one.
   */
  publicCreator(handle: string): Promise<ApiResult<PublicCreator>>;
  saveProfile(body: SaveCreatorProfileBody): Promise<ApiResult<CreatorProfile>>;
  setPublication(
    body: CreatorPublicationBody,
  ): Promise<ApiResult<CreatorProfile>>;
}

export function createCreatorApi(options: CreatorApiOptions): CreatorApi {
  const api = createVeloraApiClient(options.apiBaseUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const init = options.transport.requestInit ?? {};

  const read = async () => ({
    ...init,
    headers: await options.transport.headers('read'),
  });
  const write = async () => ({
    ...init,
    headers: await options.transport.headers('write'),
  });

  return {
    async acknowledgePolicies(documents) {
      return attempt(async () =>
        api.POST('/v1/creator/onboarding/acknowledgements', {
          ...(await write()),
          body: { acknowledgements: [...documents] },
        }),
      );
    },

    async account() {
      return attempt(async () => api.GET('/v1/creator/me', await read()));
    },

    async createAccount() {
      return attempt(async () =>
        api.POST('/v1/creator', { ...(await write()), body: {} }),
      );
    },

    async onboarding() {
      return attempt(async () =>
        api.GET('/v1/creator/onboarding', await read()),
      );
    },

    async profile() {
      return attempt(async () => api.GET('/v1/creator/profile', await read()));
    },

    async publicCreator(handle) {
      return attempt(async () =>
        api.GET('/v1/creators', { params: { query: { handle } } }),
      );
    },

    async saveProfile(body) {
      return attempt(async () =>
        api.POST('/v1/creator/profile', { ...(await write()), body }),
      );
    },

    async setPublication(body) {
      return attempt(async () =>
        api.POST('/v1/creator/profile/publication', {
          ...(await write()),
          body,
        }),
      );
    },
  };
}
