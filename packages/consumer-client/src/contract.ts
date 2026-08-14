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
export type BlockList = JsonBody<'/v1/safety/blocks', 'get', 200>;
export type Block = BlockList['blocks'][number];
export type ReportList = JsonBody<'/v1/safety/reports', 'get', 200>;
export type Report = ReportList['reports'][number];

export type CreateReportBody = RequestBody<'/v1/safety/reports', 'post'>;
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
