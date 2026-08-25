import {
  attempt,
  createVeloraApiClient,
  type ApiResult,
} from '@velora/api-client';

import type {
  ClubInviteIssued,
  ClubInviteList,
  CommercialOfferList,
  ClubLifecycleBody,
  ClubMembershipList,
  CreatorAccount,
  CreatorClubList,
  CreatorContentLifecycleBody,
  CreatorContentList,
  CreatorCurrencyEarnings,
  CreatorEarnings,
  CreatorEarningsHistory,
  CreatorReceivedGiftList,
  CreatorMediaUploadCapability,
  CreatorOnboardingState,
  CreatorPayoutHistory,
  CreatorMatureReadiness,
  CreatorPayoutReadiness,
  PayoutOnboarding,
  RequestPayoutBody,
  CreatorPolicyDocument,
  CreatorProfile,
  CreatorProfileMediaSlot,
  CreatorPublicationBody,
  MediaDeliveryList,
  MediaVariant,
  PublicClubList,
  PublicCreator,
  PublicCreatorCatalog,
  PublicCreatorDirectory,
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
  clubMembers(
    clubId: string,
    query?: {
      readonly cursor?: string | undefined;
      readonly pageSize?: number | undefined;
    },
  ): Promise<ApiResult<ClubMembershipList>>;
  clubs(query?: {
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<CreatorClubList>>;
  /** Currency-separated earnings, every figure derived from server truth. */
  earnings(): Promise<ApiResult<CreatorEarnings>>;
  receivedGifts(): Promise<ApiResult<CreatorReceivedGiftList>>;
  /** One currency's commercial history, keyset paged. */
  earningsHistory(query: {
    readonly currency: CreatorCurrencyEarnings['currency'];
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<CreatorEarningsHistory>>;
  issueClubInvite(clubId: string): Promise<ApiResult<ClubInviteIssued>>;
  /** This creator's commercial offers and what the platform may currently sell. */
  offers(query?: {
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<CommercialOfferList>>;
  onboarding(): Promise<ApiResult<CreatorOnboardingState>>;
  /** This creator's own payout instructions, newest first. */
  payouts(): Promise<ApiResult<CreatorPayoutHistory>>;
  /** Whether this creator could be paid, and what they hold per currency. */
  /** Why mature content is unavailable. It always is. */
  matureReadiness(): Promise<ApiResult<CreatorMatureReadiness>>;
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
  /**
   * Published creator pages, newest first. Carries no credential.
   *
   * The listing somebody browses instead of having to know a handle. It answers
   * identically for everybody, so sending a session with it would attach an
   * identity to a request that has no use for one.
   */
  publicCreatorDirectory(query?: {
    readonly cursor?: string | undefined;
    readonly pageSize?: number | undefined;
  }): Promise<ApiResult<PublicCreatorDirectory>>;
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
  /**
   * Reserves one page image, and the two calls that finish it.
   *
   * The client never declares what it uploaded: it asks for a capability,
   * writes the bytes to the address the platform names, and then asks the
   * platform to look at the object. What the bytes turned out to be is the
   * platform's answer, and it arrives as the image's state on the profile.
   */
  startProfileMediaUpload(
    slot: CreatorProfileMediaSlot,
  ): Promise<ApiResult<CreatorMediaUploadCapability>>;
  completeProfileMediaUpload(
    mediaId: string,
  ): Promise<ApiResult<CreatorProfile>>;
  removeProfileMedia(mediaId: string): Promise<ApiResult<CreatorProfile>>;
  /** The same three steps for an image attached to a catalog item. */
  startContentMediaUpload(
    contentId: string,
  ): Promise<ApiResult<CreatorMediaUploadCapability>>;
  completeContentMediaUpload(
    mediaId: string,
  ): Promise<ApiResult<CreatorContentList>>;
  removeContentMedia(mediaId: string): Promise<ApiResult<CreatorContentList>>;
  /**
   * Exchanges image references for addresses this surface may fetch.
   *
   * Sent with the Studio credential, and the platform decides per asset what
   * that credential is worth: a published page's imagery is public and comes
   * back for anybody, while a draft page's does not come back at all — which is
   * the same answer a visitor would get, and is why the preview screen says so
   * rather than showing a creator something nobody else can see.
   */
  mediaDeliveries(input: {
    readonly assetIds: readonly string[];
    readonly variant: MediaVariant;
  }): Promise<ApiResult<MediaDeliveryList>>;
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
    async publicCreatorDirectory(query) {
      return attempt(async () =>
        api.GET('/v1/creators/directory', {
          ...(await read()),
          params: { query: pageQuery(query) },
        }),
      );
    },

    async startProfileMediaUpload(slot) {
      return attempt(async () =>
        api.POST('/v1/creator/profile/media', {
          ...(await write()),
          body: { slot },
        }),
      );
    },

    async completeProfileMediaUpload(mediaId) {
      return attempt(async () =>
        api.POST('/v1/creator/profile/media/completion', {
          ...(await write()),
          body: { mediaId },
        }),
      );
    },

    async removeProfileMedia(mediaId) {
      return attempt(async () =>
        api.POST('/v1/creator/profile/media/removal', {
          ...(await write()),
          body: { mediaId },
        }),
      );
    },

    async startContentMediaUpload(contentId) {
      return attempt(async () =>
        api.POST('/v1/creator/content/media', {
          ...(await write()),
          body: { contentId },
        }),
      );
    },

    async completeContentMediaUpload(mediaId) {
      return attempt(async () =>
        api.POST('/v1/creator/content/media/completion', {
          ...(await write()),
          body: { mediaId },
        }),
      );
    },

    async removeContentMedia(mediaId) {
      return attempt(async () =>
        api.POST('/v1/creator/content/media/removal', {
          ...(await write()),
          body: { mediaId },
        }),
      );
    },

    async mediaDeliveries(input) {
      return attempt(async () =>
        api.POST('/v1/media/deliveries', {
          ...(await write()),
          body: { assetIds: [...input.assetIds], variant: input.variant },
        }),
      );
    },

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

    async clubMembers(clubId, query) {
      return attempt(async () =>
        api.GET('/v1/creator/clubs/members', {
          ...(await read()),
          params: { query: { clubId, ...pageQuery(query) } },
        }),
      );
    },

    async clubs(query) {
      return attempt(async () =>
        api.GET('/v1/creator/clubs', {
          ...(await read()),
          params: { query: pageQuery(query) },
        }),
      );
    },

    async earnings() {
      return attempt(async () => api.GET('/v1/creator/earnings', await read()));
    },

    async receivedGifts() {
      return attempt(async () => api.GET('/v1/creator/gifts', await read()));
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

    async offers(query) {
      return attempt(async () =>
        api.GET('/v1/creator/offers', {
          ...(await read()),
          params: { query: pageQuery(query) },
        }),
      );
    },

    async payouts() {
      return attempt(async () => api.GET('/v1/creator/payouts', await read()));
    },

    async matureReadiness() {
      return attempt(async () =>
        api.GET('/v1/creator/safety/readiness', await read()),
      );
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
