import type { paths } from '@velora/api-client';

/**
 * The consumer product shapes, named once and derived from the generated
 * document.
 *
 * Every surface consumes these rather than re-declaring what a candidate or a
 * conversation looks like, so a contract change is a compile error in both
 * clients at once instead of a runtime surprise in whichever one was updated
 * last.
 */

type JsonBody<
  TPath extends keyof paths,
  TMethod extends keyof paths[TPath],
  TStatus extends number,
> = paths[TPath][TMethod] extends {
  responses: Record<TStatus, { content: { 'application/json': infer TBody } }>;
}
  ? TBody
  : never;

type RequestBody<
  TPath extends keyof paths,
  TMethod extends keyof paths[TPath],
> = paths[TPath][TMethod] extends {
  requestBody: { content: { 'application/json': infer TBody } };
}
  ? TBody
  : never;

export type ConsumerAccount = JsonBody<'/v1/users/me', 'get', 200>;
export type OnboardingState = JsonBody<'/v1/users/me/onboarding', 'get', 200>;
export type PolicyDocument = OnboardingState['outstandingPolicies'][number];
export type ConsumerProfile = JsonBody<'/v1/users/me/profile', 'get', 200>;
export type ProfileMediaUpload = JsonBody<
  '/v1/users/me/profile/media',
  'post',
  201
>;
export type Availability = JsonBody<'/v1/users/me/availability', 'get', 200>;
export type DiscoveryFeed = JsonBody<'/v1/discovery/candidates', 'get', 200>;
export type DiscoveryCandidate = DiscoveryFeed['candidates'][number];
export type DiscoveryPerson = JsonBody<'/v1/discovery/people', 'get', 200>;
export type IntroductionList = JsonBody<
  '/v1/discovery/introductions',
  'get',
  200
>;
export type Introduction = IntroductionList['introductions'][number];
export type ConversationList = JsonBody<
  '/v1/messaging/conversations',
  'get',
  200
>;
export type Conversation = ConversationList['conversations'][number];
export type MediaDeliveryList = JsonBody<'/v1/media/deliveries', 'post', 200>;
export type MediaDelivery = MediaDeliveryList['deliveries'][number];
export type MediaVariant = RequestBody<
  '/v1/media/deliveries',
  'post'
>['variant'];
export type MessageList = JsonBody<'/v1/messaging/messages', 'get', 200>;
export type Message = MessageList['messages'][number];
export type NotificationList = JsonBody<'/v1/notifications', 'get', 200>;
export type NotificationEntry = NotificationList['notifications'][number];

/**
 * What a person may decide about, and on what.
 *
 * The vocabulary is the platform's rather than the client's: a surface renders
 * whatever pairs this returns instead of hard-coding a list of switches, so
 * adding a category never means shipping a client to match. Mandatory classes —
 * account security, safety, and legal notices — never appear, because they are
 * not offers.
 */
export type NotificationPreferenceList = JsonBody<
  '/v1/notifications/preferences',
  'get',
  200
>;
export type NotificationPreference =
  NotificationPreferenceList['preferences'][number];
export type SaveNotificationPreferenceBody = RequestBody<
  '/v1/notifications/preferences',
  'post'
>;

/**
 * The devices this account can currently be reached on.
 *
 * Returned by registering and by revoking alike, so a client replaces its idea
 * of the set rather than merging into it and guessing what a revocation left
 * behind. No token and no fingerprint appears here: a client already holds its
 * own token, and echoing one back would put a bearer credential into a
 * response body, a log, and a proxy cache for nothing.
 */
export type PushDeviceList = JsonBody<'/v1/notifications/devices', 'post', 200>;
export type PushDevice = PushDeviceList['devices'][number];
export type PushDevicePlatform = PushDevice['platform'];
export type RegisterPushDeviceBody = RequestBody<
  '/v1/notifications/devices',
  'post'
>;
export type RevokePushDeviceBody = RequestBody<
  '/v1/notifications/devices/revocations',
  'post'
>;
/**
 * One call, as the person in it is allowed to see it.
 *
 * `endReason` is the disclosable vocabulary and not the platform's own: a call
 * ended by a block or an enforcement arrives as `ended_by_platform`, because
 * telling one participant which of the two safety decisions applied would
 * publish the other person's. There is no field here for a provider, a room, a
 * scope, or a credential.
 */
export type Call = JsonBody<'/v1/rtc/calls', 'get', 200>;
export type CreateCallBody = RequestBody<'/v1/rtc/calls', 'post'>;
export type CallMedium = Call['medium'];

/**
 * A means of joining, and the whole of it.
 *
 * Short-lived, issued to one participant for one call, and never durable: it
 * belongs in memory for as long as the join takes and nowhere else — not in
 * storage, not in a URL, not in a log. Reconnecting asks for a new one rather
 * than reusing this, which is what lets a block landing mid-call take effect.
 */
export type JoinAuthorization = JsonBody<
  '/v1/rtc/calls/join-authorization',
  'post',
  200
>;

/**
 * Everything a live-discovery surface renders, in one authoritative answer.
 *
 * One shape rather than several, because the states are mutually exclusive and
 * a client assembling them from separate reads could hold a combination the
 * server never had — searching *and* matched, or matched to an encounter that
 * has ended. There is no count of who is waiting or who is online anywhere in
 * it: no presence projection exists, so a number here would be invented.
 */
export type LiveState = JsonBody<'/v1/live/sessions', 'get', 200>;
export type LiveEncounter = NonNullable<LiveState['encounter']>;
export type LiveConnectionState = LiveEncounter['connection']['state'];
export type LiveEndReason = NonNullable<LiveEncounter['endReason']>;
export type LiveMedium = NonNullable<LiveState['medium']>;
export type LiveMessageList = JsonBody<'/v1/live/messages', 'get', 200>;
export type LiveMessage = LiveMessageList['messages'][number];
export type LivePerson = LiveEncounter['peer'];
/** How wide a net the matcher is casting. A preference, never a promise. */
export type LivePreferences = LiveState['preferences'];
export type LiveInvitation = LiveState['invitations'][number];
export type LiveInvitationList = JsonBody<'/v1/live/invitations', 'post', 200>;
/** The paid narrowing in force, when one is. Never shown to the other person. */
export type LivePremiumNarrowing = NonNullable<LiveState['premium']>;

/**
 * Everything a coin surface renders, in one authoritative answer.
 *
 * The balance here is the balance. A client never computes one from a delta:
 * every wallet operation answers with this same shape, so what is rendered
 * after an activation is what a fresh read would say.
 */
export type WalletState = JsonBody<'/v1/wallet', 'get', 200>;
export type CoinBalance = NonNullable<WalletState['balance']>;
/**
 * One selection of premium preferences, as every wallet call carries it.
 *
 * Taken from the activation request rather than declared here, so a preference
 * the server withdraws stops compiling in every surface that offered it.
 */
export type LivePreferenceSelection = RequestBody<
  '/v1/wallet/live-preference',
  'post'
>;
export type LivePreferenceEntitlement = NonNullable<
  WalletState['livePreference']
>;
export type LiveReaction = RequestBody<
  '/v1/live/reactions',
  'post'
>['reaction'];
export type LiveInvitationResponse = RequestBody<
  '/v1/live/invitation-responses',
  'post'
>['response'];
export type LiveConnectionResult = JsonBody<
  '/v1/live/connections',
  'post',
  200
>;
export type LiveSimulationScenario = RequestBody<
  '/v1/live/simulation',
  'post'
>['scenario'];

export type BlockList = JsonBody<'/v1/safety/blocks', 'get', 200>;
export type Block = BlockList['blocks'][number];
export type ReportList = JsonBody<'/v1/safety/reports', 'get', 200>;
export type Report = ReportList['reports'][number];

export type CreateReportBody = RequestBody<'/v1/safety/reports', 'post'>;

/**
 * What the caller may be told about a decision that affected them, and how to
 * contest it. There is no field for the review's finding, the evidence, the
 * reviewer, or anything that could identify a reporter.
 */
export type SafetyStanding = JsonBody<'/v1/safety/standing', 'get', 200>;
export type SafetyStatement = SafetyStanding['statements'][number];
export type AppealList = JsonBody<'/v1/safety/appeals', 'get', 200>;
export type Appeal = AppealList['appeals'][number];
export type CreateAppealBody = RequestBody<'/v1/safety/appeals', 'post'>;
export type SaveProfileBody = RequestBody<'/v1/users/me/profile', 'post'>;
export type SaveAvailabilityBody = RequestBody<
  '/v1/users/me/availability',
  'post'
>;
export type SendMessageBody = RequestBody<'/v1/messaging/messages', 'post'>;
export type SavePreferencesBody = RequestBody<
  '/v1/users/me/preferences',
  'post'
>;
/**
 * What somebody declares about themselves for matching.
 *
 * Its own body rather than a field on {@link SaveProfileBody}, so a surface
 * changing only this cannot resend — and silently revert — a name, a bio, or a
 * language list it happened to be holding.
 */
export type SaveMatchingGenderBody = RequestBody<
  '/v1/users/me/matching-gender',
  'post'
>;
/**
 * One page of somebody's own coin history, and one line of it.
 *
 * A record of what happened to their coins in product terms — never the ledger
 * behind it. There is no provider name, no payment identifier, no store token,
 * and no transaction identifier in this shape.
 */
export type WalletActivityList = JsonBody<'/v1/wallet/activity', 'get', 200>;
export type WalletActivity = WalletActivityList['activity'][number];

/** The closed set of declarations, as the server publishes it. */
export type MatchingGender = NonNullable<ConsumerProfile['matchingGender']>;

/**
 * A private club this person holds or has held, as they may see it.
 *
 * `source` records what created the entitlement rather than whether it was paid
 * for: an invitation and a purchase are different things, and a `paid` boolean
 * would have made them indistinguishable. Ended entitlements appear with
 * `state: 'revoked'` so somebody's own history is theirs to see; nothing about
 * a revoked row grants a read. There is no member count and no member list,
 * because a club is not a public place.
 */
export type ClubAccessList = JsonBody<'/v1/clubs/access', 'get', 200>;
export type ClubAccess = ClubAccessList['access'][number];
export type RedeemClubInviteBody = RequestBody<'/v1/clubs/redemptions', 'post'>;
export type LeaveClubBody = RequestBody<'/v1/clubs/departures', 'post'>;

/**
 * One club as its own destination: identity, the viewer's standing, and the
 * members-only feed when they may read it.
 */
export type ClubDetail = JsonBody<'/v1/clubs', 'get', 200>;
export type MemberClubContent = ClubDetail['content'][number];
export type PublicClubList = JsonBody<'/v1/creators/clubs', 'get', 200>;
export type PublicClub = PublicClubList['clubs'][number];

/**
 * What a creator sells, joined to their clubs by opaque resource identifier.
 *
 * The money half of a membership card. What the identifier names and what a
 * member gets come from the PRIVATE CLUBS route under the same identifier; the
 * surface holds both and joins them, which is where a join between two owners
 * belongs.
 */
export type MembershipOfferList = JsonBody<
  '/v1/creators/memberships',
  'get',
  200
>;
export type MembershipOffer = MembershipOfferList['offers'][number];
export type MembershipPrice = MembershipOffer['prices'][number];
export type MonetisationReadiness = MembershipOfferList['readiness'];
export type CommerceGate = NonNullable<MembershipOfferList['gates']>[number];

export type ConsumerSubscriptionList = JsonBody<
  '/v1/billing/subscriptions',
  'get',
  200
>;
export type ConsumerSubscription =
  ConsumerSubscriptionList['subscriptions'][number];
export type ConsumerPaymentList = JsonBody<'/v1/billing/payments', 'get', 200>;
export type StartCheckoutBody = RequestBody<'/v1/billing/checkouts', 'post'>;
export type CheckoutResponse = JsonBody<'/v1/billing/checkouts', 'post', 201>;
export type ConsumerPayment = CheckoutResponse['payment'];
export type CancelSubscriptionBody = RequestBody<
  '/v1/billing/subscriptions/cancellation',
  'post'
>;
export type ConsumerSubscriptionResponse = JsonBody<
  '/v1/billing/subscriptions/cancellation',
  'post',
  200
>;
export type GiftCatalog = JsonBody<'/v1/billing/gifts/catalog', 'get', 200>;
export type GiftCatalogItem = GiftCatalog['items'][number];
export type ConsumerGiftList = JsonBody<'/v1/billing/gifts', 'get', 200>;
export type ConsumerGift = ConsumerGiftList['gifts'][number];
export type SendGiftBody = RequestBody<'/v1/billing/gifts', 'post'>;
export type SendGiftResponse = JsonBody<'/v1/billing/gifts', 'post', 201>;

/** A labeled, editable suggestion; it has no product side effect. */
export type AiSuggestionBody = RequestBody<'/v1/ai/suggestions', 'post'>;
export type AiSuggestion = JsonBody<'/v1/ai/suggestions', 'post', 200>;
export type AiSuggestionCapability = AiSuggestionBody['capability'];
export type AiSuggestionTone = AiSuggestionBody['tone'];
