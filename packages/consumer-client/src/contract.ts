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

export type ConsumerSubscriptionList = JsonBody<
  '/v1/billing/subscriptions',
  'get',
  200
>;
export type ConsumerSubscription =
  ConsumerSubscriptionList['subscriptions'][number];
