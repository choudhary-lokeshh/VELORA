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
 * A private club this person may currently read, as they may see it.
 *
 * `source` records what created the entitlement rather than whether it was
 * paid: `creator_invite` is the only one anything can carry today, because the
 * commercial seam refuses in every environment. There is no member count and no
 * member list, because a club is not a public place.
 */
export type ClubAccessList = JsonBody<'/v1/clubs/access', 'get', 200>;
export type ClubAccess = ClubAccessList['access'][number];
export type RedeemClubInviteBody = RequestBody<'/v1/clubs/redemptions', 'post'>;

export type ConsumerSubscriptionList = JsonBody<
  '/v1/billing/subscriptions',
  'get',
  200
>;
export type ConsumerSubscription =
  ConsumerSubscriptionList['subscriptions'][number];
