import { createVeloraApiClient } from '@velora/api-client';

import type {
  Availability,
  Block,
  BlockList,
  ConsumerAccount,
  ConsumerProfile,
  Conversation,
  ConversationList,
  CreateReportBody,
  DiscoveryFeed,
  Introduction,
  IntroductionList,
  Message,
  MessageList,
  NotificationList,
  OnboardingState,
  PolicyDocument,
  ProfileMediaUpload,
  Report,
  ReportList,
  SaveAvailabilityBody,
  SavePreferencesBody,
  SaveProfileBody,
  SendMessageBody,
} from './contract.js';
import { attempt, type ApiResult } from './result.js';

/**
 * The consumer product surface, once, for every client that has one.
 *
 * Every call goes through the generated client with its literal contract path,
 * so a route, body, or response that changes is a compile error here rather
 * than a runtime surprise in a screen. Nothing in this module knows a table, a
 * repository, or a server-side rule: it moves requests and classifies answers,
 * and every authorization decision belongs to the server.
 *
 * How a request proves who is making it differs by surface and is the only
 * thing injected. Consumer Web sends an `HttpOnly` cookie the script cannot
 * read plus a CSRF echo; Consumer Mobile sends a short-lived bearer token from
 * platform-keystore-backed storage. Neither transport detail leaks into the
 * product methods below, which is what keeps one client architecture rather
 * than two.
 */

export interface ConsumerTransport {
  /**
   * Fetch options every request carries. Consumer Web needs
   * `credentials: 'include'` for its cross-origin cookie; Consumer Mobile needs
   * nothing, and must not send ambient credentials it does not have.
   */
  readonly requestInit?: { readonly credentials?: RequestCredentials };
  /** Headers for a read. Awaited, so a token can be refreshed first. */
  headers(kind: 'read' | 'write'): Promise<Record<string, string>>;
}

export interface ConsumerApiOptions {
  readonly apiBaseUrl: string;
  /** Injectable so a surface is testable without a network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly transport: ConsumerTransport;
}

export interface PageQuery {
  readonly cursor?: string | undefined;
  readonly pageSize?: number | undefined;
}

/**
 * Paging parameters with absent values genuinely absent.
 *
 * The generated types distinguish "no cursor" from "a cursor that is
 * undefined", and so does the server: an explicit empty parameter is a
 * validation failure rather than the first page. Building the object this way
 * means a caller can hold `cursor: undefined` and still ask a well-formed
 * question.
 */
function pageParameters(query: PageQuery): {
  cursor?: string;
  pageSize?: number;
} {
  return {
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
  };
}

/**
 * One method per contract operation, named for the product action rather than
 * the path, so a screen asks for what it wants and never assembles a URL.
 */
export interface ConsumerApi {
  account(signal?: AbortSignal): Promise<ApiResult<ConsumerAccount>>;
  acknowledgePolicies(
    acknowledgements: readonly PolicyDocument[],
  ): Promise<ApiResult<OnboardingState>>;
  availability(signal?: AbortSignal): Promise<ApiResult<Availability>>;
  block(targetId: string): Promise<ApiResult<Block>>;
  blocks(query: PageQuery, signal?: AbortSignal): Promise<ApiResult<BlockList>>;
  candidates(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<DiscoveryFeed>>;
  completeProfileMediaUpload(
    mediaId: string,
  ): Promise<ApiResult<ConsumerProfile>>;
  conversations(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<ConversationList>>;
  createAccount(): Promise<ApiResult<ConsumerAccount>>;
  createProfileMediaUpload(): Promise<ApiResult<ProfileMediaUpload>>;
  declareAdult(region: string): Promise<ApiResult<OnboardingState>>;
  declineIntroduction(introductionId: string): Promise<ApiResult<Introduction>>;
  introductions(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<IntroductionList>>;
  markConversationRead(input: {
    readonly conversationId: string;
    readonly sequence: number;
  }): Promise<ApiResult<{ readonly lastReadSequence: number }>>;
  markNotificationsRead(
    notificationIds: readonly string[],
  ): Promise<ApiResult<{ readonly readIds: string[] }>>;
  messages(
    query: PageQuery & { readonly conversationId: string },
    signal?: AbortSignal,
  ): Promise<ApiResult<MessageList>>;
  notifications(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<NotificationList>>;
  onboarding(signal?: AbortSignal): Promise<ApiResult<OnboardingState>>;
  openConversation(introductionId: string): Promise<ApiResult<Conversation>>;
  pass(candidateId: string): Promise<ApiResult<{ suppressedUntil: string }>>;
  profile(signal?: AbortSignal): Promise<ApiResult<ConsumerProfile>>;
  removeProfileMedia(mediaId: string): Promise<ApiResult<ConsumerProfile>>;
  report(body: CreateReportBody): Promise<ApiResult<Report>>;
  reports(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<ReportList>>;
  saveAvailability(
    body: SaveAvailabilityBody,
  ): Promise<ApiResult<Availability>>;
  savePreferences(
    body: SavePreferencesBody,
  ): Promise<ApiResult<ConsumerProfile>>;
  saveProfile(body: SaveProfileBody): Promise<ApiResult<ConsumerProfile>>;
  sendMessage(body: SendMessageBody): Promise<ApiResult<Message>>;
  signalIntroduction(candidateId: string): Promise<ApiResult<Introduction>>;
  unblock(targetId: string): Promise<ApiResult<Block>>;
  withdrawIntroduction(
    introductionId: string,
  ): Promise<ApiResult<Introduction>>;
}

export function createConsumerApi(options: ConsumerApiOptions): ConsumerApi {
  const api = createVeloraApiClient(options.apiBaseUrl, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  const shared = options.transport.requestInit ?? {};

  const reading = async (signal: AbortSignal | undefined) => ({
    ...shared,
    headers: await options.transport.headers('read'),
    ...(signal === undefined ? {} : { signal }),
  });

  const writing = async () => ({
    ...shared,
    headers: await options.transport.headers('write'),
  });

  return {
    account: async (signal) =>
      attempt(async () => api.GET('/v1/users/me', await reading(signal))),

    acknowledgePolicies: async (acknowledgements) =>
      attempt(async () =>
        api.POST('/v1/users/me/onboarding/acknowledgements', {
          ...(await writing()),
          body: { acknowledgements: [...acknowledgements] },
        }),
      ),

    availability: async (signal) =>
      attempt(async () =>
        api.GET('/v1/users/me/availability', await reading(signal)),
      ),

    block: async (targetId) =>
      attempt(async () =>
        api.POST('/v1/safety/blocks', {
          ...(await writing()),
          body: { targetId },
        }),
      ),

    blocks: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/safety/blocks', {
          ...(await reading(signal)),
          params: { query: pageParameters(query) },
        }),
      ),

    candidates: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/discovery/candidates', {
          ...(await reading(signal)),
          params: { query: pageParameters(query) },
        }),
      ),

    completeProfileMediaUpload: async (mediaId) =>
      attempt(async () =>
        api.POST('/v1/users/me/profile/media/completion', {
          ...(await writing()),
          body: { mediaId },
        }),
      ),

    conversations: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/messaging/conversations', {
          ...(await reading(signal)),
          params: { query: pageParameters(query) },
        }),
      ),

    createAccount: async () =>
      attempt(async () =>
        api.POST('/v1/users', { ...(await writing()), body: {} }),
      ),

    // The capability is asked for, not described: the request carries no body
    // because a client never declares what it is about to upload.
    createProfileMediaUpload: async () =>
      attempt(async () =>
        api.POST('/v1/users/me/profile/media', await writing()),
      ),

    declareAdult: async (region) =>
      attempt(async () =>
        api.POST('/v1/users/me/onboarding/adult-declaration', {
          ...(await writing()),
          body: { declaresAdult: true, region },
        }),
      ),

    declineIntroduction: async (introductionId) =>
      attempt(async () =>
        api.POST('/v1/discovery/introductions/decline', {
          ...(await writing()),
          body: { introductionId },
        }),
      ),

    introductions: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/discovery/introductions', {
          ...(await reading(signal)),
          params: { query: pageParameters(query) },
        }),
      ),

    markConversationRead: async (input) =>
      attempt(async () =>
        api.POST('/v1/messaging/conversations/read', {
          ...(await writing()),
          body: input,
        }),
      ),

    markNotificationsRead: async (notificationIds) =>
      attempt(async () =>
        api.POST('/v1/notifications/read', {
          ...(await writing()),
          body: { notificationIds: [...notificationIds] },
        }),
      ),

    messages: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/messaging/messages', {
          ...(await reading(signal)),
          params: {
            query: {
              conversationId: query.conversationId,
              ...pageParameters(query),
            },
          },
        }),
      ),

    notifications: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/notifications', {
          ...(await reading(signal)),
          params: { query: pageParameters(query) },
        }),
      ),

    onboarding: async (signal) =>
      attempt(async () =>
        api.GET('/v1/users/me/onboarding', await reading(signal)),
      ),

    openConversation: async (introductionId) =>
      attempt(async () =>
        api.POST('/v1/messaging/conversations', {
          ...(await writing()),
          body: { introductionId },
        }),
      ),

    pass: async (candidateId) =>
      attempt(async () =>
        api.POST('/v1/discovery/passes', {
          ...(await writing()),
          body: { candidateId },
        }),
      ),

    profile: async (signal) =>
      attempt(async () =>
        api.GET('/v1/users/me/profile', await reading(signal)),
      ),

    removeProfileMedia: async (mediaId) =>
      attempt(async () =>
        api.POST('/v1/users/me/profile/media/removal', {
          ...(await writing()),
          body: { mediaId },
        }),
      ),

    report: async (body) =>
      attempt(async () =>
        api.POST('/v1/safety/reports', { ...(await writing()), body }),
      ),

    reports: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/safety/reports', {
          ...(await reading(signal)),
          params: { query: pageParameters(query) },
        }),
      ),

    saveAvailability: async (body) =>
      attempt(async () =>
        api.POST('/v1/users/me/availability', {
          ...(await writing()),
          body,
        }),
      ),

    savePreferences: async (body) =>
      attempt(async () =>
        api.POST('/v1/users/me/preferences', { ...(await writing()), body }),
      ),

    saveProfile: async (body) =>
      attempt(async () =>
        api.POST('/v1/users/me/profile', { ...(await writing()), body }),
      ),

    sendMessage: async (body) =>
      attempt(async () =>
        api.POST('/v1/messaging/messages', { ...(await writing()), body }),
      ),

    signalIntroduction: async (candidateId) =>
      attempt(async () =>
        api.POST('/v1/discovery/introductions', {
          ...(await writing()),
          body: { candidateId },
        }),
      ),

    unblock: async (targetId) =>
      attempt(async () =>
        api.POST('/v1/safety/blocks/removal', {
          ...(await writing()),
          body: { targetId },
        }),
      ),

    withdrawIntroduction: async (introductionId) =>
      attempt(async () =>
        api.POST('/v1/discovery/introductions/withdrawal', {
          ...(await writing()),
          body: { introductionId },
        }),
      ),
  };
}
