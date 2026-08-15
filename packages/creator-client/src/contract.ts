import type { paths } from '@velora/api-client';

/**
 * The creator product shapes, named once and derived from the generated
 * document.
 *
 * Creator Studio consumes these rather than re-declaring what a profile or an
 * onboarding state looks like, so a contract change is a compile error here
 * instead of a runtime surprise in a screen. Nothing in this package knows a
 * table, a repository, or a server-side rule.
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

export type CreatorAccount = JsonBody<'/v1/creator/me', 'get', 200>;
export type CreatorOnboardingState = JsonBody<
  '/v1/creator/onboarding',
  'get',
  200
>;
export type CreatorPolicyDocument =
  CreatorOnboardingState['outstandingPolicies'][number];
export type CreatorProfile = JsonBody<'/v1/creator/profile', 'get', 200>;
export type SaveCreatorProfileBody = RequestBody<'/v1/creator/profile', 'post'>;
export type CreatorProfileLink = NonNullable<
  SaveCreatorProfileBody['links']
>[number];
export type CreatorPublicationBody = RequestBody<
  '/v1/creator/profile/publication',
  'post'
>;

/**
 * The projection a visitor with no session receives. It is deliberately a
 * different type from {@link CreatorProfile}: a surface that could pass one
 * where the other is expected could render a draft, a version, or a publication
 * state on a public page.
 */
export type PublicCreator = JsonBody<'/v1/creators', 'get', 200>;

export type CreatorContentList = JsonBody<'/v1/creator/content', 'get', 200>;
export type CreatorContent = CreatorContentList['content'][number];
export type SaveCreatorContentBody = RequestBody<'/v1/creator/content', 'post'>;
export type CreatorContentLifecycleBody = RequestBody<
  '/v1/creator/content/lifecycle',
  'post'
>;

/**
 * The catalog a visitor sees. A different type from {@link CreatorContent} on
 * purpose: a surface that could pass one where the other is expected could
 * render a draft, a lifecycle, or a visibility on a public page.
 */
export type PublicCreatorCatalog = JsonBody<'/v1/creators/catalog', 'get', 200>;
export type PublicCreatorContent = PublicCreatorCatalog['content'][number];

export type CreatorClubList = JsonBody<'/v1/creator/clubs', 'get', 200>;
export type CreatorClub = CreatorClubList['clubs'][number];
export type SaveCreatorClubBody = RequestBody<'/v1/creator/clubs', 'post'>;
export type ClubLifecycleBody = RequestBody<
  '/v1/creator/clubs/lifecycle',
  'post'
>;
export type ClubInviteList = JsonBody<'/v1/creator/clubs/invites', 'get', 200>;
export type ClubInviteIssued = JsonBody<
  '/v1/creator/clubs/invites',
  'post',
  201
>;
export type ClubMembershipList = JsonBody<
  '/v1/creator/clubs/members',
  'get',
  200
>;
export type PublicClubList = JsonBody<'/v1/creators/clubs', 'get', 200>;

export type CreatorEarnings = JsonBody<'/v1/creator/earnings', 'get', 200>;
export type CreatorCurrencyEarnings = CreatorEarnings['currencies'][number];
export type CreatorEarningsHistory = JsonBody<
  '/v1/creator/earnings/history',
  'get',
  200
>;
export type CreatorEarningsEntry = CreatorEarningsHistory['entries'][number];

export type CreatorPayoutReadiness = JsonBody<
  '/v1/creator/payouts/readiness',
  'get',
  200
>;
export type CreatorPayoutBalance = CreatorPayoutReadiness['balances'][number];
export type PayoutOnboarding = JsonBody<
  '/v1/creator/payouts/onboarding',
  'post',
  201
>;
export type CreatorPayoutHistory = JsonBody<'/v1/creator/payouts', 'get', 200>;
export type CreatorPayout = CreatorPayoutHistory['payouts'][number];
export type RequestPayoutBody = RequestBody<'/v1/creator/payouts', 'post'>;
export type CommercialOfferList = JsonBody<'/v1/creator/offers', 'get', 200>;
export type CommercialOffer = CommercialOfferList['offers'][number];
export type MonetisationReadiness = CommercialOfferList['readiness'];
