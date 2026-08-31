import { createVeloraApiClient } from '@velora/api-client';

import type {
  Appeal,
  AiSuggestion,
  AiSuggestionBody,
  AppealList,
  Availability,
  Block,
  BlockList,
  CancelSubscriptionBody,
  Call,
  LiveConnectionResult,
  LiveMedium,
  LiveMessageList,
  LiveSimulationScenario,
  LiveState,
  CheckoutResponse,
  ClubAccessList,
  ClubDetail,
  ConsumerAccount,
  ConsumerProfile,
  ConsumerPaymentList,
  ConsumerSubscriptionList,
  ConsumerSubscriptionResponse,
  ConsumerGiftList,
  LeaveClubBody,
  MembershipOfferList,
  PublicClubList,
  StartCheckoutBody,
  GiftCatalog,
  GiftCatalogItem,
  SendGiftBody,
  SendGiftResponse,
  Conversation,
  ConversationList,
  CreateAppealBody,
  CreateCallBody,
  CreateReportBody,
  DiscoveryFeed,
  DiscoveryPerson,
  Introduction,
  IntroductionList,
  JoinAuthorization,
  Message,
  MediaDeliveryList,
  MediaVariant,
  MessageList,
  NotificationList,
  NotificationPreferenceList,
  OnboardingState,
  PolicyDocument,
  ProfileMediaUpload,
  PushDeviceList,
  RegisterPushDeviceBody,
  RedeemClubInviteBody,
  Report,
  ReportList,
  SafetyStanding,
  SaveNotificationPreferenceBody,
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
  /** Creates only an editable draft. It never saves or sends it. */
  suggestAi(
    body: AiSuggestionBody,
    signal?: AbortSignal,
  ): Promise<ApiResult<AiSuggestion>>;
  /** Cancels a caller-owned suggestion run; safe to repeat. */
  cancelAi(
    runId: string,
  ): Promise<
    ApiResult<{ readonly cancelled: boolean; readonly runId: string }>
  >;
  account(signal?: AbortSignal): Promise<ApiResult<ConsumerAccount>>;
  /**
   * The commercial relationships this person is paying for.
   *
   * A read of server truth and nothing else. Virtual gifts are a separate
   * one-time support operation and never appear as a subscription.
   */
  subscriptions(): Promise<ApiResult<ConsumerSubscriptionList>>;
  giftCatalog(input: {
    readonly currency: GiftCatalogItem['price']['currency'];
    readonly handle: string;
  }): Promise<ApiResult<GiftCatalog>>;
  sentGifts(): Promise<ApiResult<ConsumerGiftList>>;
  sendGift(input: {
    readonly body: SendGiftBody;
    readonly idempotencyKey: string;
  }): Promise<ApiResult<SendGiftResponse>>;
  /** Private clubs this person holds or has held. */
  clubAccess(signal?: AbortSignal): Promise<ApiResult<ClubAccessList>>;
  /**
   * One club as its own destination.
   *
   * Safe to call for anybody, including somebody who holds nothing: the server
   * decides on this request whether the feed is theirs to read, and answers
   * with an empty one when it is not.
   */
  club(
    input: { readonly handle: string; readonly slug: string },
    signal?: AbortSignal,
  ): Promise<ApiResult<ClubDetail>>;
  /** Published clubs on a creator's page, with this viewer's own standing. */
  publicClubs(
    handle: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<PublicClubList>>;
  /** What that creator sells, by opaque resource identifier. */
  membershipOffers(
    handle: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<MembershipOfferList>>;
  /**
   * Starts a purchase.
   *
   * A client key is required rather than optional: without one a double-click
   * is two purchases and the server has nothing to recognise the second by. The
   * answer carries the provider-hosted page to send the person to; arriving
   * there is not a purchase and coming back is not a receipt.
   */
  startCheckout(input: {
    readonly body: StartCheckoutBody;
    readonly idempotencyKey: string;
  }): Promise<ApiResult<CheckoutResponse>>;
  /** The state of one of this person's own payments. Nothing here transitions. */
  readCheckout(
    paymentId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<CheckoutResponse>>;
  /**
   * Everything this person has been charged, or nearly charged.
   *
   * A record of attempts rather than a set of receipts: what a receipt must say
   * is unresolved commercial and tax policy, and calling this one would be a
   * claim nobody approved.
   */
  payments(
    query?: { readonly cursor?: string; readonly pageSize?: number },
    signal?: AbortSignal,
  ): Promise<ApiResult<ConsumerPaymentList>>;
  /**
   * Stops a subscription renewing.
   *
   * The paid period is unchanged: access continues to its end and the
   * relationship closes when the period does. There is no immediate option,
   * because ending access early would take back something already bought.
   */
  cancelSubscription(
    body: CancelSubscriptionBody,
  ): Promise<ApiResult<ConsumerSubscriptionResponse>>;
  /**
   * Hands back an invitation.
   *
   * Refused for a membership somebody is paying for: that one ends through
   * cancellation, where the period and the renewal are accounted for.
   */
  leaveClub(body: LeaveClubBody): Promise<ApiResult<ClubAccessList>>;
  /**
   * Presents an invitation.
   *
   * The secret is a bearer credential: it is sent once, settled by the database
   * rather than by a read, and never returned. Presenting the same one twice
   * admits its holder exactly once.
   */
  redeemClubInvite(
    body: RedeemClubInviteBody,
  ): Promise<ApiResult<ClubAccessList>>;
  acknowledgePolicies(
    acknowledgements: readonly PolicyDocument[],
  ): Promise<ApiResult<OnboardingState>>;
  availability(signal?: AbortSignal): Promise<ApiResult<Availability>>;
  block(targetId: string): Promise<ApiResult<Block>>;
  blocks(query: PageQuery, signal?: AbortSignal): Promise<ApiResult<BlockList>>;
  /**
   * Places a call against a mutual introduction.
   *
   * The relationship is what is named; the server derives who the other person
   * is. There is deliberately no way to call somebody by identifier, so this
   * client cannot express one.
   */
  call(body: CreateCallBody): Promise<ApiResult<Call>>;
  /** Answers a ringing call. Only its recipient may. */
  acceptCall(callId: string): Promise<ApiResult<Call>>;
  /** Declines a ringing call. Only its recipient may. */
  rejectCall(callId: string): Promise<ApiResult<Call>>;
  /** Withdraws an invitation before it is answered. Only its caller may. */
  cancelCall(callId: string): Promise<ApiResult<Call>>;
  /** Hangs up. Either participant may, and doing it twice is safe. */
  endCall(callId: string): Promise<ApiResult<Call>>;
  /** Reads one call the caller is a participant of. */
  readCall(callId: string, signal?: AbortSignal): Promise<ApiResult<Call>>;
  /**
   * Obtains this participant's means of joining.
   *
   * Asked for again on every join and on every reconnect rather than held: the
   * server re-composes eligibility each time it issues one, so re-asking is
   * what makes a block landing mid-call take effect.
   */
  joinAuthorization(callId: string): Promise<ApiResult<JoinAuthorization>>;
  /**
   * The one authoritative read behind live discovery.
   *
   * Reading is also how presence is expressed: there is no gateway and no
   * heartbeat endpoint, so a client that is looking at the screen is the client
   * that is reading this. It never allocates anybody — a surface that only
   * wants to know where it stands can call it without being put into an
   * encounter.
   */
  liveState(signal?: AbortSignal): Promise<ApiResult<LiveState>>;
  /**
   * Enters the matching pool, and takes an allocation if one is available.
   *
   * Idempotent, which is what makes it safe to poll while the screen says
   * "Finding someone": entering while already searching refreshes presence and
   * tries again, and entering while already matched returns the encounter
   * rather than opening a second search.
   *
   * It names a medium and never a person. There is deliberately no way to ask
   * for a particular stranger, so this client cannot express one.
   */
  startLiveSearch(medium: LiveMedium): Promise<ApiResult<LiveState>>;
  /**
   * Next: ends the named encounter and resumes searching.
   *
   * The encounter is named so a Next pressed a second too late cannot end the
   * encounter that replaced it. Pressing it twice is safe.
   */
  advanceLiveEncounter(encounterId: string): Promise<ApiResult<LiveState>>;
  /** Leaves live discovery entirely. Safe to repeat. */
  leaveLiveDiscovery(): Promise<ApiResult<LiveState>>;
  /**
   * The messages exchanged inside one encounter.
   *
   * These belong to the encounter and never to a conversation: a temporary
   * meeting does not become Inbox history, and no surface built on this may
   * present it as though it had.
   */
  liveMessages(
    encounterId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<LiveMessageList>>;
  sendLiveMessage(input: {
    readonly body: string;
    readonly clientMessageId: string;
    readonly encounterId: string;
  }): Promise<ApiResult<LiveMessageList>>;
  /**
   * Connect: signals this person's own interest, once.
   *
   * One tap never produces a mutual connection. The answer is `requested`
   * unless the other person had already signalled independently, in which case
   * it is `connected` and names the durable conversation that now exists.
   */
  connectInLiveEncounter(
    encounterId: string,
  ): Promise<ApiResult<LiveConnectionResult>>;
  /**
   * Applies one deterministic local scenario.
   *
   * Local development only. Configuration refuses the simulation adapter
   * outside local and test, so this answers `503` everywhere else — which is
   * why a surface offers it only when `liveState().simulated` is true.
   */
  applyLiveSimulation(
    scenario: LiveSimulationScenario,
  ): Promise<ApiResult<{ readonly applied: boolean }>>;
  candidates(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<DiscoveryFeed>>;
  /**
   * One person, for somebody who holds a reason to look at them.
   *
   * The same projection a card carries. Nobody the caller may see is answered
   * exactly as an account that does not exist, so a surface built on this can
   * never distinguish the two and must not try.
   */
  person(
    personId: string,
    signal?: AbortSignal,
  ): Promise<ApiResult<DiscoveryPerson>>;
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
  /**
   * Exchanges image references for addresses this client may fetch.
   *
   * Every projection that carries somebody's photograph carries a reference
   * rather than a URL, because an address that outlived the decision behind it
   * would be a permission nobody could withdraw. A reference is worth nothing
   * on its own; this call is where it becomes worth something, and the server
   * re-decides the whole question each time.
   *
   * References the caller may not be served are absent from the answer rather
   * than refused, so a surface renders what it got and shows an identity mark
   * for the rest.
   */
  mediaDeliveries(
    input: {
      readonly assetIds: readonly string[];
      readonly variant: MediaVariant;
    },
    signal?: AbortSignal,
  ): Promise<ApiResult<MediaDeliveryList>>;
  messages(
    query: PageQuery & { readonly conversationId: string },
    signal?: AbortSignal,
  ): Promise<ApiResult<MessageList>>;
  notifications(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<NotificationList>>;
  /**
   * The delivery decisions this person can actually make.
   *
   * Only category and channel pairs the platform has an approved template for
   * are returned, so a surface that renders the answer never offers a switch
   * that does nothing.
   */
  notificationPreferences(
    signal?: AbortSignal,
  ): Promise<ApiResult<NotificationPreferenceList>>;
  /**
   * Puts this installation's push token on record, or replaces the one it had.
   *
   * Registering the same token again is a heartbeat rather than a second
   * device, so a client may call this on every launch without accumulating
   * registrations. The token is a bearer credential for reaching a device: it
   * is sent and never read back, because no response in this contract carries
   * one.
   */
  registerPushDevice(
    body: RegisterPushDeviceBody,
  ): Promise<ApiResult<PushDeviceList>>;
  /**
   * Takes this installation off the record, by installation rather than by
   * token.
   *
   * Signing out must be able to stop delivery even when the token that was
   * registered is no longer obtainable — a permission revoked, a keystore that
   * will not open, a provider that has retired the token. Naming the
   * installation is the only identifier that survives all three.
   */
  revokePushDevice(installationId: string): Promise<ApiResult<PushDeviceList>>;
  saveNotificationPreference(
    body: SaveNotificationPreferenceBody,
  ): Promise<ApiResult<NotificationPreferenceList>>;
  onboarding(signal?: AbortSignal): Promise<ApiResult<OnboardingState>>;
  openConversation(introductionId: string): Promise<ApiResult<Conversation>>;
  pass(candidateId: string): Promise<ApiResult<{ suppressedUntil: string }>>;
  profile(signal?: AbortSignal): Promise<ApiResult<ConsumerProfile>>;
  removeProfileMedia(mediaId: string): Promise<ApiResult<ConsumerProfile>>;
  appeals(signal?: AbortSignal): Promise<ApiResult<AppealList>>;
  appeal(body: CreateAppealBody): Promise<ApiResult<Appeal>>;
  report(body: CreateReportBody): Promise<ApiResult<Report>>;
  reports(
    query: PageQuery,
    signal?: AbortSignal,
  ): Promise<ApiResult<ReportList>>;
  /** What is currently in force against the caller, and why. */
  standing(signal?: AbortSignal): Promise<ApiResult<SafetyStanding>>;
  withdrawAppeal(appealId: string): Promise<ApiResult<Appeal>>;
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

  const writing = async (signal?: AbortSignal) => ({
    ...shared,
    headers: await options.transport.headers('write'),
    ...(signal === undefined ? {} : { signal }),
  });

  return {
    suggestAi: async (body, signal) =>
      attempt(async () =>
        api.POST('/v1/ai/suggestions', {
          ...(await writing(signal)),
          body,
        }),
      ),

    cancelAi: async (runId) =>
      attempt(async () =>
        api.POST('/v1/ai/runs/cancellation', {
          ...(await writing()),
          body: { runId },
        }),
      ),

    account: async (signal) =>
      attempt(async () => api.GET('/v1/users/me', await reading(signal))),

    subscriptions: async () =>
      attempt(async () =>
        api.GET('/v1/billing/subscriptions', await reading(undefined)),
      ),

    giftCatalog: async ({ currency, handle }) =>
      attempt(async () =>
        api.GET('/v1/billing/gifts/catalog', {
          ...(await reading(undefined)),
          params: { query: { currency, handle } },
        }),
      ),

    sentGifts: async () =>
      attempt(async () =>
        api.GET('/v1/billing/gifts', await reading(undefined)),
      ),

    sendGift: async ({ body, idempotencyKey }) =>
      attempt(async () => {
        const request = await writing();
        return api.POST('/v1/billing/gifts', {
          ...request,
          body,
          headers: {
            ...request.headers,
            'x-velora-idempotency-key': idempotencyKey,
          },
        });
      }),

    clubAccess: async (signal) =>
      attempt(async () => api.GET('/v1/clubs/access', await reading(signal))),

    club: async ({ handle, slug }, signal) =>
      attempt(async () =>
        api.GET('/v1/clubs', {
          ...(await reading(signal)),
          params: { query: { handle, slug } },
        }),
      ),

    publicClubs: async (handle, signal) =>
      attempt(async () =>
        api.GET('/v1/creators/clubs', {
          ...(await reading(signal)),
          params: { query: { handle } },
        }),
      ),

    membershipOffers: async (handle, signal) =>
      attempt(async () =>
        api.GET('/v1/creators/memberships', {
          ...(await reading(signal)),
          params: { query: { handle } },
        }),
      ),

    startCheckout: async ({ body, idempotencyKey }) =>
      attempt(async () => {
        const request = await writing();
        return api.POST('/v1/billing/checkouts', {
          ...request,
          body,
          headers: {
            ...request.headers,
            'x-velora-idempotency-key': idempotencyKey,
          },
        });
      }),

    readCheckout: async (paymentId, signal) =>
      attempt(async () =>
        api.GET('/v1/billing/checkouts', {
          ...(await reading(signal)),
          params: { query: { paymentId } },
        }),
      ),

    payments: async (query, signal) =>
      attempt(async () =>
        api.GET('/v1/billing/payments', {
          ...(await reading(signal)),
          params: {
            query: {
              ...(query?.cursor === undefined ? {} : { cursor: query.cursor }),
              ...(query?.pageSize === undefined
                ? {}
                : { pageSize: query.pageSize }),
            },
          },
        }),
      ),

    cancelSubscription: async (body) =>
      attempt(async () =>
        api.POST('/v1/billing/subscriptions/cancellation', {
          ...(await writing()),
          body,
        }),
      ),

    leaveClub: async (body) =>
      attempt(async () =>
        api.POST('/v1/clubs/departures', { ...(await writing()), body }),
      ),

    redeemClubInvite: async (body) =>
      attempt(async () =>
        api.POST('/v1/clubs/redemptions', { ...(await writing()), body }),
      ),

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

    person: async (personId, signal) =>
      attempt(async () =>
        api.GET('/v1/discovery/people', {
          ...(await reading(signal)),
          params: { query: { personId } },
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

    mediaDeliveries: async (input, signal) =>
      attempt(async () =>
        api.POST('/v1/media/deliveries', {
          ...(await writing()),
          body: { assetIds: [...input.assetIds], variant: input.variant },
          ...(signal === undefined ? {} : { signal }),
        }),
      ),

    call: async (body) =>
      attempt(async () =>
        api.POST('/v1/rtc/calls', { ...(await writing()), body }),
      ),

    acceptCall: async (callId) =>
      attempt(async () =>
        api.POST('/v1/rtc/calls/acceptance', {
          ...(await writing()),
          body: { callId },
        }),
      ),

    rejectCall: async (callId) =>
      attempt(async () =>
        api.POST('/v1/rtc/calls/rejection', {
          ...(await writing()),
          body: { callId },
        }),
      ),

    cancelCall: async (callId) =>
      attempt(async () =>
        api.POST('/v1/rtc/calls/cancellation', {
          ...(await writing()),
          body: { callId },
        }),
      ),

    endCall: async (callId) =>
      attempt(async () =>
        api.POST('/v1/rtc/calls/termination', {
          ...(await writing()),
          body: { callId },
        }),
      ),

    readCall: async (callId, signal) =>
      attempt(async () =>
        api.GET('/v1/rtc/calls', {
          ...(await reading(signal)),
          params: { query: { callId } },
        }),
      ),

    joinAuthorization: async (callId) =>
      attempt(async () =>
        api.POST('/v1/rtc/calls/join-authorization', {
          ...(await writing()),
          body: { callId },
        }),
      ),

    liveState: async (signal) =>
      attempt(async () => api.GET('/v1/live/sessions', await reading(signal))),

    startLiveSearch: async (medium) =>
      attempt(async () =>
        api.POST('/v1/live/sessions', {
          ...(await writing()),
          body: { medium },
        }),
      ),

    advanceLiveEncounter: async (encounterId) =>
      attempt(async () =>
        api.POST('/v1/live/transitions', {
          ...(await writing()),
          body: { encounterId },
        }),
      ),

    // No body, because there is one place a person can be and the server
    // already knows which. A leave that named the wrong encounter would be a
    // leave that did not leave.
    leaveLiveDiscovery: async () =>
      attempt(async () => api.POST('/v1/live/departures', await writing())),

    liveMessages: async (encounterId, signal) =>
      attempt(async () =>
        api.GET('/v1/live/messages', {
          ...(await reading(signal)),
          params: { query: { encounterId } },
        }),
      ),

    sendLiveMessage: async (input) =>
      attempt(async () =>
        api.POST('/v1/live/messages', {
          ...(await writing()),
          body: {
            body: input.body,
            clientMessageId: input.clientMessageId,
            encounterId: input.encounterId,
          },
        }),
      ),

    connectInLiveEncounter: async (encounterId) =>
      attempt(async () =>
        api.POST('/v1/live/connections', {
          ...(await writing()),
          body: { encounterId },
        }),
      ),

    applyLiveSimulation: async (scenario) =>
      attempt(async () =>
        api.POST('/v1/live/simulation', {
          ...(await writing()),
          body: { scenario },
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

    notificationPreferences: async (signal) =>
      attempt(async () =>
        api.GET('/v1/notifications/preferences', await reading(signal)),
      ),

    saveNotificationPreference: async (body) =>
      attempt(async () =>
        api.POST('/v1/notifications/preferences', {
          ...(await writing()),
          body,
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

    registerPushDevice: async (body) =>
      attempt(async () =>
        api.POST('/v1/notifications/devices', { ...(await writing()), body }),
      ),

    revokePushDevice: async (installationId) =>
      attempt(async () =>
        api.POST('/v1/notifications/devices/revocations', {
          ...(await writing()),
          body: { installationId },
        }),
      ),

    removeProfileMedia: async (mediaId) =>
      attempt(async () =>
        api.POST('/v1/users/me/profile/media/removal', {
          ...(await writing()),
          body: { mediaId },
        }),
      ),

    appeal: async (body) =>
      attempt(async () =>
        api.POST('/v1/safety/appeals', { ...(await writing()), body }),
      ),

    appeals: async (signal) =>
      attempt(async () =>
        api.GET('/v1/safety/appeals', { ...(await reading(signal)) }),
      ),

    report: async (body) =>
      attempt(async () =>
        api.POST('/v1/safety/reports', { ...(await writing()), body }),
      ),

    standing: async (signal) =>
      attempt(async () =>
        api.GET('/v1/safety/standing', { ...(await reading(signal)) }),
      ),

    withdrawAppeal: async (appealId) =>
      attempt(async () =>
        api.POST('/v1/safety/appeals/withdrawal', {
          ...(await writing()),
          body: { appealId },
        }),
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
