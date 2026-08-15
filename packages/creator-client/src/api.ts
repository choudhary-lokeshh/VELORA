import {
  attempt,
  createVeloraApiClient,
  type ApiResult,
} from '@velora/api-client';

import type {
  ClubInviteIssued,
  ClubInviteList,
  ClubLifecycleBody,
  ClubMembershipList,
  CreatorAccount,
  CreatorClubList,
  CreatorContentLifecycleBody,
  CreatorContentList,
  CreatorCurrencyEarnings,
  CreatorEarnings,
  CreatorEarningsHistory,
  CreatorOnboardingState,
  CreatorPayoutHistory,
  CreatorPayoutReadiness,
  PayoutOnboarding,
  RequestPayoutBody,
  CreatorPolicyDocument,
  CreatorProfile,
  CreatorPublicationBody,
  PublicClubList,
  PublicCreator,
  PublicCreatorCatalog,
  SaveCreatorClubBody,
  SaveCreatorContentBody,
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
  content(query?: {
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<CreatorContentList>>;
  clubInvites(clubId: string): Promise<ApiResult<ClubInviteList>>;
  clubMembers(clubId: string): Promise<ApiResult<ClubMembershipList>>;
  clubs(): Promise<ApiResult<CreatorClubList>>;
  /** Currency-separated earnings, every figure derived from server truth. */
  earnings(): Promise<ApiResult<CreatorEarnings>>;
  /** One currency's commercial history, keyset paged. */
  earningsHistory(query: {
    readonly currency: CreatorCurrencyEarnings['currency'];
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<CreatorEarningsHistory>>;
  issueClubInvite(clubId: string): Promise<ApiResult<ClubInviteIssued>>;
  onboarding(): Promise<ApiResult<CreatorOnboardingState>>;
  /** This creator's own payout instructions, newest first. */
  payouts(): Promise<ApiResult<CreatorPayoutHistory>>;
  /** Whether this creator could be paid, and what they hold per currency. */
  payoutReadiness(): Promise<ApiResult<CreatorPayoutReadiness>>;
  /** Opens the payout provider's own hosted onboarding. Collects nothing here. */
  startPayoutOnboarding(): Promise<ApiResult<PayoutOnboarding>>;
  requestPayout(input: {
    readonly body: RequestPayoutBody;
    readonly idempotencyKey: string;
  }): Promise<ApiResult<CreatorPayoutHistory['payouts'][number] | undefined>>;
  /** Published clubs on a creator's public page. Carries no credential. */
  publicClubs(handle: string): Promise<ApiResult<PublicClubList>>;
  revokeClubInvite(input: {
    readonly clubId: string;
    readonly inviteId: string;
  }): Promise<ApiResult<ClubInviteList>>;
  revokeClubMembership(input: {
    readonly clubId: string;
    readonly membershipId: string;
  }): Promise<ApiResult<ClubMembershipList>>;
  saveClub(body: SaveCreatorClubBody): Promise<ApiResult<CreatorClubList>>;
  setClubLifecycle(
    body: ClubLifecycleBody,
  ): Promise<ApiResult<CreatorClubList>>;
  /** The catalog half of a creator's public page. Carries no credential. */
  publicCatalog(query: {
    readonly cursor?: string | undefined;
    readonly handle: string;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<PublicCreatorCatalog>>;
  profile(): Promise<ApiResult<CreatorProfile>>;
  /**
   * The public projection for a handle. Deliberately on the same client and
   * deliberately without credentials: it is the one creator route that answers
   * identically for everybody, and sending a session with it would attach an
   * identity to a request that has no use for one.
   */
  publicCreator(handle: string): Promise<ApiResult<PublicCreator>>;
  saveContent(
    body: SaveCreatorContentBody,
  ): Promise<ApiResult<CreatorContentList>>;
  saveProfile(body: SaveCreatorProfileBody): Promise<ApiResult<CreatorProfile>>;
  setContentLifecycle(
    body: CreatorContentLifecycleBody,
  ): Promise<ApiResult<CreatorContentList>>;
  setPublication(
    body: CreatorPublicationBody,
  ): Promise<ApiResult<CreatorProfile>>;
}

/** Only the paging values a caller actually supplied travel on the wire. */
function pageQuery(query?: {
  readonly cursor?: string | undefined;
  readonly pageSize?: number | undefined;
}): { cursor?: string; pageSize?: number } {
  return {
    ...(query?.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query?.pageSize === undefined ? {} : { pageSize: query.pageSize }),
  };
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

    async content(query) {
      return attempt(async () =>
        api.GET('/v1/creator/content', {
          ...(await read()),
          params: { query: pageQuery(query) },
        }),
      );
    },

    async clubInvites(clubId) {
      return attempt(async () =>
        api.GET('/v1/creator/clubs/invites', {
          ...(await read()),
          params: { query: { clubId } },
        }),
      );
    },

    async clubMembers(clubId) {
      return attempt(async () =>
        api.GET('/v1/creator/clubs/members', {
          ...(await read()),
          params: { query: { clubId } },
        }),
      );
    },

    async clubs() {
      return attempt(async () => api.GET('/v1/creator/clubs', await read()));
    },

    async earnings() {
      return attempt(async () => api.GET('/v1/creator/earnings', await read()));
    },

    async earningsHistory(query) {
      return attempt(async () =>
        api.GET('/v1/creator/earnings/history', {
          ...(await read()),
          params: {
            query: { currency: query.currency, ...pageQuery(query) },
          },
        }),
      );
    },

    async issueClubInvite(clubId) {
      return attempt(async () =>
        api.POST('/v1/creator/clubs/invites', {
          ...(await write()),
          body: { clubId },
        }),
      );
    },

    async publicClubs(handle) {
      return attempt(async () =>
        api.GET('/v1/creators/clubs', { params: { query: { handle } } }),
      );
    },

    async revokeClubInvite(input) {
      return attempt(async () =>
        api.POST('/v1/creator/clubs/invites/revocation', {
          ...(await write()),
          body: { inviteId: input.inviteId },
          params: { query: { clubId: input.clubId } },
        }),
      );
    },

    async revokeClubMembership(input) {
      return attempt(async () =>
        api.POST('/v1/creator/clubs/members/revocation', {
          ...(await write()),
          body: { membershipId: input.membershipId },
          params: { query: { clubId: input.clubId } },
        }),
      );
    },

    async saveClub(body) {
      return attempt(async () =>
        api.POST('/v1/creator/clubs', { ...(await write()), body }),
      );
    },

    async setClubLifecycle(body) {
      return attempt(async () =>
        api.POST('/v1/creator/clubs/lifecycle', { ...(await write()), body }),
      );
    },

    async onboarding() {
      return attempt(async () =>
        api.GET('/v1/creator/onboarding', await read()),
      );
    },

    async payouts() {
      return attempt(async () => api.GET('/v1/creator/payouts', await read()));
    },

    async payoutReadiness() {
      return attempt(async () =>
        api.GET('/v1/creator/payouts/readiness', await read()),
      );
    },

    async requestPayout(input) {
      const result = await attempt(async () =>
        api.POST('/v1/creator/payouts', {
          ...(await write()),
          body: input.body,
          headers: {
            ...(await options.transport.headers('write')),
            'x-velora-idempotency-key': input.idempotencyKey,
          },
        }),
      );
      return result.kind === 'ok'
        ? { kind: 'ok' as const, value: result.value.payout }
        : result;
    },

    async startPayoutOnboarding() {
      return attempt(async () =>
        api.POST('/v1/creator/payouts/onboarding', await write()),
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

    async publicCatalog(query) {
      return attempt(async () =>
        api.GET('/v1/creators/catalog', {
          params: {
            query: { handle: query.handle, ...pageQuery(query) },
          },
        }),
      );
    },

    async saveContent(body) {
      return attempt(async () =>
        api.POST('/v1/creator/content', { ...(await write()), body }),
      );
    },

    async saveProfile(body) {
      return attempt(async () =>
        api.POST('/v1/creator/profile', { ...(await write()), body }),
      );
    },

    async setContentLifecycle(body) {
      return attempt(async () =>
        api.POST('/v1/creator/content/lifecycle', {
          ...(await write()),
          body,
        }),
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
