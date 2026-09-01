import { z } from 'zod';

import {
  aiRunCancellationRequestSchema,
  aiRunCancellationResponseSchema,
  aiSuggestionRequestSchema,
  aiSuggestionResponseSchema,
} from './ai.js';

import {
  createCreatorAccountRequestSchema,
  creatorAccountResponseSchema,
  creatorHandleSchema,
  creatorOnboardingStateResponseSchema,
  creatorPolicyAcknowledgementRequestSchema,
  creatorMediaReferenceRequestSchema,
  creatorProfileMediaRequestSchema,
  creatorProfilePublicationRequestSchema,
  creatorProfileResponseSchema,
  publicCreatorDirectoryResponseSchema,
  publicCreatorResponseSchema,
  saveCreatorProfileRequestSchema,
} from './creator.js';
import {
  adminDisputeListResponseSchema,
  cancelSubscriptionRequestSchema,
  checkoutResponseSchema,
  consumerPaymentListResponseSchema,
  consumerSubscriptionListResponseSchema,
  consumerSubscriptionResponseSchema,
  publicMembershipOfferListResponseSchema,
  consumerGiftListResponseSchema,
  creatorReceivedGiftListResponseSchema,
  giftCatalogResponseSchema,
  giftCatalogProvisionResponseSchema,
  sendGiftRequestSchema,
  sendGiftResponseSchema,
  creatorEarningsHistoryResponseSchema,
  creatorEarningsResponseSchema,
  creatorPayoutHistoryResponseSchema,
  creatorPayoutReadinessResponseSchema,
  issueRefundRequestSchema,
  payoutOnboardingResponseSchema,
  payoutResponseSchema,
  requestPayoutRequestSchema,
  providerEventAcknowledgementSchema,
  paymentIdSchema,
  refundResponseSchema,
  commercialOfferLifecycleRequestSchema,
  commercialOfferListResponseSchema,
  commercialOfferResponseSchema,
  createCommercialOfferRequestSchema,
  publishCommercialPriceRequestSchema,
  retireCommercialPriceRequestSchema,
  startCheckoutRequestSchema,
} from './billing.js';
import {
  adminAccountListResponseSchema,
  adminAuditResponseSchema,
  adminAuditStreamSchema,
  adminClubListResponseSchema,
  adminCreatorListResponseSchema,
  adminExactActionAuthorizationHeader,
  adminFinancialStateResponseSchema,
  adminOverviewResponseSchema,
  adminPaymentDetailResponseSchema,
  adminPaymentListResponseSchema,
  adminPayoutListResponseSchema,
  adminIdentityStateResponseSchema,
  adminIdentityOwnerDomainSchema,
  adminIdentitySubjectResponseSchema,
  adminCreatorSearchSchema,
  adminMediaAssetResponseSchema,
  adminMediaPurgeRequestSchema,
  adminMediaPurgeResponseSchema,
  adminMediaStateResponseSchema,
  adminNotificationDeliverySchema,
  adminNotificationStateResponseSchema,
  adminRtcCallSchema,
  adminRtcStateResponseSchema,
  adminOperationResponseSchema,
  adminReinstateCreatorRequestSchema,
  adminRemoveObjectRequestSchema,
  adminRevokeMembershipRequestSchema,
  adminSuspendCreatorRequestSchema,
  moderationAppealListResponseSchema,
  moderationAppealOutcomeRequestSchema,
  moderationAppealResponseSchema,
  moderationCaseDetailResponseSchema,
  moderationCaseListResponseSchema,
  moderationCaseRequestSchema,
  moderationCaseResponseSchema,
  moderationDecisionRequestSchema,
  moderationDecisionResponseSchema,
  moderationNoteRequestSchema,
  moderationQueueSchema,
  moderationTriageRequestSchema,
} from './admin.js';
import {
  clubAccessListResponseSchema,
  clubDetailResponseSchema,
  clubIdSchema,
  clubSlugSchema,
  clubInviteIssuedResponseSchema,
  clubInviteListResponseSchema,
  clubLifecycleRequestSchema,
  clubMembershipListResponseSchema,
  contentIdSchema,
  creatorClubListResponseSchema,
  creatorContentLifecycleRequestSchema,
  creatorContentListResponseSchema,
  creatorContentMediaRequestSchema,
  issueClubInviteRequestSchema,
  leaveClubRequestSchema,
  publicClubListResponseSchema,
  publicCreatorCatalogResponseSchema,
  redeemClubInviteRequestSchema,
  revokeClubInviteRequestSchema,
  revokeClubMembershipRequestSchema,
  saveCreatorClubRequestSchema,
  saveCreatorContentRequestSchema,
} from './clubs.js';
import {
  createIntroductionRequestSchema,
  discoveryCandidateSchema,
  discoveryFeedResponseSchema,
  discoveryPassRequestSchema,
  discoveryPassResponseSchema,
  introductionListResponseSchema,
  introductionReferenceRequestSchema,
  introductionSchema,
} from './discovery.js';
import {
  conversationListResponseSchema,
  conversationReadResponseSchema,
  conversationSchema,
  createConversationRequestSchema,
  markConversationReadRequestSchema,
  messageListResponseSchema,
  messageSchema,
  sendMessageRequestSchema,
} from './messaging.js';
import {
  mediaDeliveryListResponseSchema,
  mediaDeliveryRequestSchema,
  mediaUploadCapabilitySchema,
} from './media.js';
import {
  callActionRequestSchema,
  callSchema,
  createCallRequestSchema,
  joinAuthorizationSchema,
} from './realtime.js';
import {
  createLiveInvitationRequestSchema,
  liveConnectionResponseSchema,
  liveEncounterActionRequestSchema,
  liveInvitationListResponseSchema,
  liveMessageListResponseSchema,
  liveSearchRequestSchema,
  respondToLiveInvitationRequestSchema,
  sendLiveReactionRequestSchema,
  liveSimulationRequestSchema,
  liveSimulationResponseSchema,
  liveStateResponseSchema,
  sendLiveMessageRequestSchema,
} from './live.js';
import {
  activateLivePreferenceRequestSchema,
  androidCoinPurchaseRequestSchema,
  broadenLivePreferenceRequestSchema,
  coinGrantRequestSchema,
  walletStateResponseSchema,
} from './wallet.js';
import {
  markNotificationsReadRequestSchema,
  notificationListResponseSchema,
  notificationPreferencesResponseSchema,
  notificationReadResponseSchema,
  pushDeviceListResponseSchema,
  registerPushDeviceRequestSchema,
  revokePushDeviceRequestSchema,
  updateNotificationPreferenceRequestSchema,
} from './notifications.js';
import { currencyCodeSchema } from './money.js';
import {
  conversationIdSchema,
  cursorSchema,
  idempotencyHeader,
  pageSizeSchema,
} from './product.js';
import {
  blockListResponseSchema,
  blockRequestSchema,
  blockSchema,
  createReportRequestSchema,
  appealListResponseSchema,
  appealSchema,
  createAppealRequestSchema,
  creatorMatureReadinessResponseSchema,
  reportListResponseSchema,
  safetyStandingResponseSchema,
  withdrawAppealRequestSchema,
  reportSchema,
} from './safety.js';
import {
  availabilityResponseSchema,
  profileMediaReferenceRequestSchema,
  profileMediaUploadResponseSchema,
  profileResponseSchema,
  saveMatchingGenderRequestSchema,
  savePreferencesRequestSchema,
  saveAvailabilityRequestSchema,
  saveProfileRequestSchema,
} from './profile.js';
import { productErrorCodes } from './product.js';
import {
  adultDeclarationRequestSchema,
  consumerAccountResponseSchema,
  createConsumerAccountRequestSchema,
  onboardingStateResponseSchema,
  policyAcknowledgementRequestSchema,
} from './users.js';
import {
  authAcknowledgementSchema,
  authSessionResponseSchema,
  csrfHeader,
  deviceHeader,
  localAdminSessionRequestSchema,
  localMobileSessionRequestSchema,
  localWebSessionRequestSchema,
  mobileRefreshRequestSchema,
  mobileTokenResponseSchema,
  recoveryCompletionRequestSchema,
  recoveryStartRequestSchema,
} from './auth.js';

export * from './admin.js';
export * from './ai.js';
export * from './auth.js';
export * from './billing.js';
export * from './clubs.js';
export * from './creator.js';
export * from './discovery.js';
export * from './live.js';
export * from './media.js';
export * from './messaging.js';
export * from './realtime.js';
export * from './money.js';
export * from './notifications.js';
export * from './product.js';
export * from './profile.js';
export * from './safety.js';
export * from './users.js';
export * from './wallet.js';

export const dependencyStateSchema = z.enum(['up', 'down']);

export const livenessResponseSchema = z
  .object({
    status: z.literal('ok'),
  })
  .strict();

export const readinessResponseSchema = z
  .object({
    dependencies: z
      .object({
        ephemeralRedis: dependencyStateSchema,
        postgres: dependencyStateSchema,
        queueRedis: dependencyStateSchema,
      })
      .strict(),
    status: z.enum(['ready', 'unavailable']),
  })
  .strict();

export const apiErrorSchema = z
  .object({
    code: z.string().min(1),
    correlationId: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export type LivenessResponse = z.infer<typeof livenessResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiRoutePaths = {
  aiRunCancellation: '/v1/ai/runs/cancellation',
  aiSuggestions: '/v1/ai/suggestions',
  consumerAccount: '/v1/users',
  consumerAccountSelf: '/v1/users/me',
  consumerAdultDeclaration: '/v1/users/me/onboarding/adult-declaration',
  consumerOnboarding: '/v1/users/me/onboarding',
  consumerPolicyAcknowledgements: '/v1/users/me/onboarding/acknowledgements',
  consumerAvailability: '/v1/users/me/availability',
  creatorAccount: '/v1/creator',
  creatorAccountSelf: '/v1/creator/me',
  creatorEarnings: '/v1/creator/earnings',
  creatorEarningsHistory: '/v1/creator/earnings/history',
  creatorReceivedGifts: '/v1/creator/gifts',
  creatorGiftCatalogProvision: '/v1/creator/gifts/catalog/provision',
  creatorPayoutOnboarding: '/v1/creator/payouts/onboarding',
  creatorPayoutReadiness: '/v1/creator/payouts/readiness',
  creatorPayouts: '/v1/creator/payouts',
  creatorOfferLifecycle: '/v1/creator/offers/lifecycle',
  creatorOfferPriceRetirement: '/v1/creator/offers/prices/retirement',
  creatorOfferPrices: '/v1/creator/offers/prices',
  creatorOffers: '/v1/creator/offers',
  creatorOnboarding: '/v1/creator/onboarding',
  creatorPolicyAcknowledgements: '/v1/creator/onboarding/acknowledgements',
  adminAccounts: '/v1/admin/accounts',
  adminAudit: '/v1/admin/audit',
  adminBillingDisputes: '/v1/admin/billing/disputes',
  adminBillingPayment: '/v1/admin/billing/payment',
  adminBillingPayments: '/v1/admin/billing/payments',
  adminBillingRefunds: '/v1/admin/billing/refunds',
  adminBillingState: '/v1/admin/billing/state',
  adminClubs: '/v1/admin/clubs',
  adminCreatorObjectRemoval: '/v1/admin/creators/object-removal',
  adminCreatorReinstatement: '/v1/admin/creators/reinstatement',
  adminCreatorSuspension: '/v1/admin/creators/suspension',
  adminCreators: '/v1/admin/creators',
  adminIdentityState: '/v1/admin/identity/state',
  adminIdentitySubject: '/v1/admin/identity/subject',
  adminMediaAsset: '/v1/admin/media/asset',
  adminMediaPurge: '/v1/admin/media/purge',
  adminMediaState: '/v1/admin/media/state',
  adminMembershipRevocation: '/v1/admin/creators/membership-revocation',
  adminNotificationDelivery: '/v1/admin/notifications/delivery',
  adminOverview: '/v1/admin/overview',
  adminPayouts: '/v1/admin/payouts',
  adminNotificationState: '/v1/admin/notifications/state',
  adminRtcCall: '/v1/admin/rtc/call',
  adminRtcState: '/v1/admin/rtc/state',
  adminSafetyAppealOutcome: '/v1/admin/safety/appeals/outcome',
  adminSafetyAppeals: '/v1/admin/safety/appeals',
  adminSafetyCase: '/v1/admin/safety/case',
  adminSafetyCaseClaim: '/v1/admin/safety/cases/claim',
  adminSafetyCaseDecisions: '/v1/admin/safety/cases/decisions',
  adminSafetyCaseNotes: '/v1/admin/safety/cases/notes',
  adminSafetyCaseTriage: '/v1/admin/safety/cases/triage',
  adminSafetyCases: '/v1/admin/safety/cases',
  consumerSafetyAppealWithdrawal: '/v1/safety/appeals/withdrawal',
  consumerSafetyAppeals: '/v1/safety/appeals',
  consumerSafetyStanding: '/v1/safety/standing',
  creatorMatureReadiness: '/v1/creator/safety/readiness',
  checkouts: '/v1/billing/checkouts',
  gifts: '/v1/billing/gifts',
  giftCatalog: '/v1/billing/gifts/catalog',
  identityProviderEvents: '/v1/identity/provider-events',
  providerEvents: '/v1/billing/provider-events',
  payments: '/v1/billing/payments',
  subscriptionCancellation: '/v1/billing/subscriptions/cancellation',
  subscriptions: '/v1/billing/subscriptions',
  club: '/v1/clubs',
  clubAccess: '/v1/clubs/access',
  clubDepartures: '/v1/clubs/departures',
  clubContent: '/v1/clubs/content',
  clubRedemptions: '/v1/clubs/redemptions',
  creatorClubInviteRevocation: '/v1/creator/clubs/invites/revocation',
  creatorClubInvites: '/v1/creator/clubs/invites',
  creatorClubLifecycle: '/v1/creator/clubs/lifecycle',
  creatorClubMemberRevocation: '/v1/creator/clubs/members/revocation',
  creatorClubMembers: '/v1/creator/clubs/members',
  creatorClubs: '/v1/creator/clubs',
  creatorContent: '/v1/creator/content',
  creatorContentLifecycle: '/v1/creator/content/lifecycle',
  creatorContentMedia: '/v1/creator/content/media',
  creatorContentMediaCompletion: '/v1/creator/content/media/completion',
  creatorContentMediaRemoval: '/v1/creator/content/media/removal',
  creatorProfile: '/v1/creator/profile',
  creatorProfileMedia: '/v1/creator/profile/media',
  creatorProfileMediaCompletion: '/v1/creator/profile/media/completion',
  creatorProfileMediaRemoval: '/v1/creator/profile/media/removal',
  creatorProfilePublication: '/v1/creator/profile/publication',
  publicCreator: '/v1/creators',
  publicCreatorDirectory: '/v1/creators/directory',
  publicCreatorCatalog: '/v1/creators/catalog',
  publicCreatorClubs: '/v1/creators/clubs',
  publicCreatorMemberships: '/v1/creators/memberships',
  discoveryCandidates: '/v1/discovery/candidates',
  discoveryPerson: '/v1/discovery/people',
  discoveryIntroductionDecline: '/v1/discovery/introductions/decline',
  discoveryIntroductionWithdrawal: '/v1/discovery/introductions/withdrawal',
  discoveryIntroductions: '/v1/discovery/introductions',
  discoveryPasses: '/v1/discovery/passes',
  consumerMatchingGender: '/v1/users/me/matching-gender',
  consumerPreferences: '/v1/users/me/preferences',
  consumerProfile: '/v1/users/me/profile',
  consumerProfileMedia: '/v1/users/me/profile/media',
  consumerProfileMediaCompletion: '/v1/users/me/profile/media/completion',
  consumerProfileMediaRemoval: '/v1/users/me/profile/media/removal',
  liveness: '/v1/health/live',
  mediaDeliveries: '/v1/media/deliveries',
  localAdminSession: '/v1/auth/local/admin-sessions',
  localMobileSession: '/v1/auth/local/mobile-sessions',
  localWebSession: '/v1/auth/local/web-sessions',
  messagingConversationRead: '/v1/messaging/conversations/read',
  messagingConversations: '/v1/messaging/conversations',
  messagingMessages: '/v1/messaging/messages',
  rtcCallAcceptance: '/v1/rtc/calls/acceptance',
  rtcCallCancellation: '/v1/rtc/calls/cancellation',
  rtcCallJoinAuthorization: '/v1/rtc/calls/join-authorization',
  rtcCallRejection: '/v1/rtc/calls/rejection',
  rtcCallTermination: '/v1/rtc/calls/termination',
  rtcCalls: '/v1/rtc/calls',
  rtcProviderEvents: '/v1/rtc/provider-events',
  liveConnections: '/v1/live/connections',
  liveDepartures: '/v1/live/departures',
  liveInvitationResponses: '/v1/live/invitation-responses',
  liveInvitations: '/v1/live/invitations',
  liveMessages: '/v1/live/messages',
  liveReactions: '/v1/live/reactions',
  liveSessions: '/v1/live/sessions',
  liveSimulation: '/v1/live/simulation',
  liveTransitions: '/v1/live/transitions',
  wallet: '/v1/wallet',
  walletAndroidPurchases: '/v1/wallet/android-purchases',
  walletGrants: '/v1/wallet/grants',
  walletLivePreference: '/v1/wallet/live-preference',
  walletLivePreferenceBroadening: '/v1/wallet/live-preference/broadening',
  walletLivePreferenceCancellation: '/v1/wallet/live-preference/cancellation',
  notifications: '/v1/notifications',
  notificationDeviceRevocations: '/v1/notifications/devices/revocations',
  notificationDevices: '/v1/notifications/devices',
  notificationProviderEvents: '/v1/notifications/provider-events',
  notificationPreferences: '/v1/notifications/preferences',
  notificationsRead: '/v1/notifications/read',
  safetyBlockRemoval: '/v1/safety/blocks/removal',
  safetyBlocks: '/v1/safety/blocks',
  safetyReports: '/v1/safety/reports',
  logout: '/v1/auth/logout',
  logoutAll: '/v1/auth/logout-all',
  mobileRefresh: '/v1/auth/mobile/refresh',
  readiness: '/v1/health/ready',
  recoveryCompletion: '/v1/auth/recovery/completion',
  recoveryStart: '/v1/auth/recovery',
  session: '/v1/auth/session',
} as const;

/**
 * The single source for the request body limit. The runtime enforces it and the
 * generated contract documents the resulting response, so the two cannot drift.
 */
export const maximumRequestBodyBytes = 1_048_576;

export const correlationResponseHeader = 'x-correlation-id';

/** Standard header telling a client how long to wait before retrying. */
export const retryAfterResponseHeader = 'retry-after';

/** How long a client waits after a capacity refusal, in seconds. */
export const retryAfterSeconds = 1;

const retryAfterHeader = {
  description:
    'Seconds to wait before retrying. Present on a capacity refusal.',
  required: false,
  schema: { type: 'integer' },
} as const;

/**
 * Error codes the API returns. They are deliberately generic: a caller learns
 * what failed at the protocol level and nothing about the implementation.
 */
export const apiErrorCodes = {
  internal: 'INTERNAL_ERROR',
  notFound: 'HTTP_404',
  payloadTooLarge: 'PAYLOAD_TOO_LARGE',
  /**
   * Temporary capacity refusal. The instance declined to begin the request, so
   * nothing was written and nothing was attempted. It says nothing about the
   * caller, the target, or the action — deliberately, because a client must not
   * be able to read infrastructure state out of an error body.
   */
  serviceUnavailable: 'SERVICE_UNAVAILABLE',
} as const;

/**
 * Every schema the published contract may reference. Generation reads this
 * registry, so a response cannot name a schema the document does not define.
 */
export const apiSchemas = {
  AiRunCancellationRequest: aiRunCancellationRequestSchema,
  AiRunCancellationResponse: aiRunCancellationResponseSchema,
  AiSuggestionRequest: aiSuggestionRequestSchema,
  AiSuggestionResponse: aiSuggestionResponseSchema,
  AdultDeclarationRequest: adultDeclarationRequestSchema,
  ApiError: apiErrorSchema,
  ConsumerAccountResponse: consumerAccountResponseSchema,
  CreateConsumerAccountRequest: createConsumerAccountRequestSchema,
  CreateCreatorAccountRequest: createCreatorAccountRequestSchema,
  CreatorAccountResponse: creatorAccountResponseSchema,
  CreatorOnboardingStateResponse: creatorOnboardingStateResponseSchema,
  CreatorPolicyAcknowledgementRequest:
    creatorPolicyAcknowledgementRequestSchema,
  CheckoutResponse: checkoutResponseSchema,
  ConsumerGiftListResponse: consumerGiftListResponseSchema,
  CreatorReceivedGiftListResponse: creatorReceivedGiftListResponseSchema,
  GiftCatalogResponse: giftCatalogResponseSchema,
  GiftCatalogProvisionResponse: giftCatalogProvisionResponseSchema,
  SendGiftRequest: sendGiftRequestSchema,
  SendGiftResponse: sendGiftResponseSchema,
  ConsumerPaymentListResponse: consumerPaymentListResponseSchema,
  ConsumerSubscriptionListResponse: consumerSubscriptionListResponseSchema,
  ConsumerSubscriptionResponse: consumerSubscriptionResponseSchema,
  CancelSubscriptionRequest: cancelSubscriptionRequestSchema,
  PublicMembershipOfferListResponse: publicMembershipOfferListResponseSchema,
  AdminDisputeListResponse: adminDisputeListResponseSchema,
  CreatorEarningsHistoryResponse: creatorEarningsHistoryResponseSchema,
  CreatorEarningsResponse: creatorEarningsResponseSchema,
  CreatorPayoutHistoryResponse: creatorPayoutHistoryResponseSchema,
  CreatorPayoutReadinessResponse: creatorPayoutReadinessResponseSchema,
  IssueRefundRequest: issueRefundRequestSchema,
  PayoutOnboardingResponse: payoutOnboardingResponseSchema,
  PayoutResponse: payoutResponseSchema,
  RequestPayoutRequest: requestPayoutRequestSchema,
  ProviderEventAcknowledgement: providerEventAcknowledgementSchema,
  RefundResponse: refundResponseSchema,
  StartCheckoutRequest: startCheckoutRequestSchema,
  CommercialOfferLifecycleRequest: commercialOfferLifecycleRequestSchema,
  CommercialOfferListResponse: commercialOfferListResponseSchema,
  CommercialOfferResponse: commercialOfferResponseSchema,
  CreateCommercialOfferRequest: createCommercialOfferRequestSchema,
  PublishCommercialPriceRequest: publishCommercialPriceRequestSchema,
  RetireCommercialPriceRequest: retireCommercialPriceRequestSchema,
  AdminAccountListResponse: adminAccountListResponseSchema,
  AdminAuditResponse: adminAuditResponseSchema,
  AdminClubListResponse: adminClubListResponseSchema,
  AdminCreatorListResponse: adminCreatorListResponseSchema,
  AdminFinancialStateResponse: adminFinancialStateResponseSchema,
  AdminOverviewResponse: adminOverviewResponseSchema,
  AdminPaymentDetailResponse: adminPaymentDetailResponseSchema,
  AdminPaymentListResponse: adminPaymentListResponseSchema,
  AdminPayoutListResponse: adminPayoutListResponseSchema,
  AdminMediaAssetResponse: adminMediaAssetResponseSchema,
  AdminMediaPurgeRequest: adminMediaPurgeRequestSchema,
  AdminMediaPurgeResponse: adminMediaPurgeResponseSchema,
  AdminMediaStateResponse: adminMediaStateResponseSchema,
  AdminNotificationDelivery: adminNotificationDeliverySchema,
  AdminNotificationStateResponse: adminNotificationStateResponseSchema,
  AdminOperationResponse: adminOperationResponseSchema,
  AdminRtcCall: adminRtcCallSchema,
  AdminRtcStateResponse: adminRtcStateResponseSchema,
  AdminReinstateCreatorRequest: adminReinstateCreatorRequestSchema,
  AdminRemoveObjectRequest: adminRemoveObjectRequestSchema,
  AdminRevokeMembershipRequest: adminRevokeMembershipRequestSchema,
  AdminSuspendCreatorRequest: adminSuspendCreatorRequestSchema,
  ModerationAppealListResponse: moderationAppealListResponseSchema,
  ModerationAppealOutcomeRequest: moderationAppealOutcomeRequestSchema,
  ModerationAppealResponse: moderationAppealResponseSchema,
  ModerationCaseDetailResponse: moderationCaseDetailResponseSchema,
  ModerationCaseListResponse: moderationCaseListResponseSchema,
  ModerationCaseRequest: moderationCaseRequestSchema,
  ModerationCaseResponse: moderationCaseResponseSchema,
  ModerationDecisionRequest: moderationDecisionRequestSchema,
  ModerationDecisionResponse: moderationDecisionResponseSchema,
  ModerationNoteRequest: moderationNoteRequestSchema,
  ModerationTriageRequest: moderationTriageRequestSchema,
  ClubAccessListResponse: clubAccessListResponseSchema,
  ClubDetailResponse: clubDetailResponseSchema,
  LeaveClubRequest: leaveClubRequestSchema,
  ClubInviteIssuedResponse: clubInviteIssuedResponseSchema,
  ClubInviteListResponse: clubInviteListResponseSchema,
  ClubLifecycleRequest: clubLifecycleRequestSchema,
  ClubMembershipListResponse: clubMembershipListResponseSchema,
  CreatorClubListResponse: creatorClubListResponseSchema,
  CreatorContentLifecycleRequest: creatorContentLifecycleRequestSchema,
  IssueClubInviteRequest: issueClubInviteRequestSchema,
  PublicClubListResponse: publicClubListResponseSchema,
  RedeemClubInviteRequest: redeemClubInviteRequestSchema,
  RevokeClubInviteRequest: revokeClubInviteRequestSchema,
  RevokeClubMembershipRequest: revokeClubMembershipRequestSchema,
  SaveCreatorClubRequest: saveCreatorClubRequestSchema,
  CreatorContentListResponse: creatorContentListResponseSchema,
  CreatorProfilePublicationRequest: creatorProfilePublicationRequestSchema,
  PublicCreatorCatalogResponse: publicCreatorCatalogResponseSchema,
  SaveCreatorContentRequest: saveCreatorContentRequestSchema,
  CreatorProfileResponse: creatorProfileResponseSchema,
  PublicCreatorDirectoryResponse: publicCreatorDirectoryResponseSchema,
  PublicCreatorResponse: publicCreatorResponseSchema,
  SaveCreatorProfileRequest: saveCreatorProfileRequestSchema,
  OnboardingStateResponse: onboardingStateResponseSchema,
  PolicyAcknowledgementRequest: policyAcknowledgementRequestSchema,
  AvailabilityResponse: availabilityResponseSchema,
  DiscoveryFeedResponse: discoveryFeedResponseSchema,
  DiscoveryPersonResponse: discoveryCandidateSchema,
  DiscoveryPassRequest: discoveryPassRequestSchema,
  DiscoveryPassResponse: discoveryPassResponseSchema,
  CreateIntroductionRequest: createIntroductionRequestSchema,
  Introduction: introductionSchema,
  IntroductionListResponse: introductionListResponseSchema,
  IntroductionReferenceRequest: introductionReferenceRequestSchema,
  Call: callSchema,
  CallActionRequest: callActionRequestSchema,
  CreateLiveInvitationRequest: createLiveInvitationRequestSchema,
  LiveConnectionResponse: liveConnectionResponseSchema,
  LiveEncounterActionRequest: liveEncounterActionRequestSchema,
  LiveInvitationListResponse: liveInvitationListResponseSchema,
  LiveMessageListResponse: liveMessageListResponseSchema,
  LiveSearchRequest: liveSearchRequestSchema,
  RespondToLiveInvitationRequest: respondToLiveInvitationRequestSchema,
  SendLiveReactionRequest: sendLiveReactionRequestSchema,
  LiveSimulationRequest: liveSimulationRequestSchema,
  LiveSimulationResponse: liveSimulationResponseSchema,
  LiveStateResponse: liveStateResponseSchema,
  ActivateLivePreferenceRequest: activateLivePreferenceRequestSchema,
  AndroidCoinPurchaseRequest: androidCoinPurchaseRequestSchema,
  BroadenLivePreferenceRequest: broadenLivePreferenceRequestSchema,
  CoinGrantRequest: coinGrantRequestSchema,
  WalletStateResponse: walletStateResponseSchema,
  SendLiveMessageRequest: sendLiveMessageRequestSchema,
  Conversation: conversationSchema,
  CreateCallRequest: createCallRequestSchema,
  JoinAuthorization: joinAuthorizationSchema,
  ConversationListResponse: conversationListResponseSchema,
  ConversationReadResponse: conversationReadResponseSchema,
  CreateConversationRequest: createConversationRequestSchema,
  MarkConversationReadRequest: markConversationReadRequestSchema,
  Message: messageSchema,
  MessageListResponse: messageListResponseSchema,
  SendMessageRequest: sendMessageRequestSchema,
  CreatorContentMediaRequest: creatorContentMediaRequestSchema,
  CreatorMediaReferenceRequest: creatorMediaReferenceRequestSchema,
  CreatorProfileMediaRequest: creatorProfileMediaRequestSchema,
  MediaDeliveryListResponse: mediaDeliveryListResponseSchema,
  MediaDeliveryRequest: mediaDeliveryRequestSchema,
  MediaUploadCapability: mediaUploadCapabilitySchema,
  MarkNotificationsReadRequest: markNotificationsReadRequestSchema,
  NotificationListResponse: notificationListResponseSchema,
  NotificationPreferencesResponse: notificationPreferencesResponseSchema,
  NotificationReadResponse: notificationReadResponseSchema,
  PushDeviceListResponse: pushDeviceListResponseSchema,
  RegisterPushDeviceRequest: registerPushDeviceRequestSchema,
  RevokePushDeviceRequest: revokePushDeviceRequestSchema,
  UpdateNotificationPreferenceRequest:
    updateNotificationPreferenceRequestSchema,
  Block: blockSchema,
  BlockListResponse: blockListResponseSchema,
  BlockRequest: blockRequestSchema,
  CreateReportRequest: createReportRequestSchema,
  Report: reportSchema,
  ReportListResponse: reportListResponseSchema,
  Appeal: appealSchema,
  AppealListResponse: appealListResponseSchema,
  CreateAppealRequest: createAppealRequestSchema,
  CreatorMatureReadinessResponse: creatorMatureReadinessResponseSchema,
  SafetyStandingResponse: safetyStandingResponseSchema,
  WithdrawAppealRequest: withdrawAppealRequestSchema,
  ProfileMediaReferenceRequest: profileMediaReferenceRequestSchema,
  SaveAvailabilityRequest: saveAvailabilityRequestSchema,
  ProfileMediaUploadResponse: profileMediaUploadResponseSchema,
  ProfileResponse: profileResponseSchema,
  SaveMatchingGenderRequest: saveMatchingGenderRequestSchema,
  SavePreferencesRequest: savePreferencesRequestSchema,
  SaveProfileRequest: saveProfileRequestSchema,
  AuthAcknowledgement: authAcknowledgementSchema,
  AuthSessionResponse: authSessionResponseSchema,
  LivenessResponse: livenessResponseSchema,
  LocalAdminSessionRequest: localAdminSessionRequestSchema,
  LocalMobileSessionRequest: localMobileSessionRequestSchema,
  LocalWebSessionRequest: localWebSessionRequestSchema,
  MobileRefreshRequest: mobileRefreshRequestSchema,
  MobileTokenResponse: mobileTokenResponseSchema,
  ReadinessResponse: readinessResponseSchema,
  RecoveryCompletionRequest: recoveryCompletionRequestSchema,
  RecoveryStartRequest: recoveryStartRequestSchema,
  AdminIdentityStateResponse: adminIdentityStateResponseSchema,
  AdminIdentitySubjectResponse: adminIdentitySubjectResponseSchema,
} as const;

/**
 * Query parameters the contract may publish, defined once so the runtime and
 * the document validate the same bounds. They carry paging position and bounded
 * filters only; a credential never appears in a URL.
 */
export const apiQueryParameters = {
  callId: z.uuid(),
  conversationId: conversationIdSchema,
  cursor: cursorSchema,
  adminSearch: adminCreatorSearchSchema,
  assetId: z.uuid(),
  caseId: z.uuid(),
  deliveryId: z.uuid(),
  encounterId: z.uuid(),
  moderationQueue: moderationQueueSchema,
  ownerDomain: adminIdentityOwnerDomainSchema,
  ownerReference: z.uuid(),
  clubId: clubIdSchema,
  /** Restricts a queue read to claims still awaiting an answer. */
  open: z.enum(['true', 'false']),
  personId: z.uuid(),
  slug: clubSlugSchema,
  contentId: contentIdSchema,
  currency: currencyCodeSchema,
  handle: creatorHandleSchema,
  pageSize: pageSizeSchema,
  paymentId: paymentIdSchema,
  /** One consumer account by identifier, for an operator who holds one. */
  accountId: z.uuid(),
  creatorId: z.uuid(),
  /**
   * One record lifecycle state. The vocabulary is the owning domain's and is
   * checked against it in the handler, so a value this schema admits and the
   * domain does not is a refusal rather than a query that matches nothing.
   */
  state: z.string().min(1).max(32),
  /** One account lifecycle status, on the same terms as `state`. */
  status: z.string().min(1).max(32),
  stream: adminAuditStreamSchema,
} as const;
export type ApiQueryParameterName = keyof typeof apiQueryParameters;

/**
 * Transport-level credential each operation accepts. `public` means the
 * operation carries its own credential in the body or none at all; it never
 * means unauthenticated access to another actor's state.
 */
export const apiSecurityRequirements = {
  bearerAccessToken: 'bearerAccessToken',
  cookieOrBearer: 'cookieOrBearer',
  cookieSession: 'cookieSession',
  public: 'public',
} as const;

/**
 * Durable failures every operation can produce, because they are enforced
 * before or around routing rather than inside a handler.
 */
export const sharedErrorResponses = {
  '404': {
    description:
      'No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError.',
    schemaName: 'ApiError',
  },
  '413': {
    description:
      'Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE.',
    schemaName: 'ApiError',
  },
  '500': {
    description:
      'Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR.',
    schemaName: 'ApiError',
  },
  '503': {
    description: `The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code ${apiErrorCodes.serviceUnavailable}, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies.`,
    headers: { [retryAfterResponseHeader]: retryAfterHeader },
    schemaName: 'ApiError',
  },
} as const;

const invalidAuthInputResponse = {
  description:
    'Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED.',
  schemaName: 'ApiError',
} as const;

const authRateLimitedResponse = {
  description:
    'Too many attempts from this caller. The body is an ApiError with code AUTH_RATE_LIMITED.',
  schemaName: 'ApiError',
} as const;

const authBrowserOriginResponse = {
  description:
    'The browser origin, Fetch Metadata, or CSRF evidence for this state-changing request was rejected, or the requested identity adapter is not enabled. The body is an ApiError.',
  schemaName: 'ApiError',
} as const;

const authRequiredResponse = {
  description:
    'No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED.',
  schemaName: 'ApiError',
} as const;

/**
 * Rejections every authenticated consumer operation can produce. They are
 * declared once so a new operation cannot quietly document a different
 * authorization story than the one the runtime enforces.
 */
const consumerAuthenticationResponses = {
  '401': {
    description:
      'No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED.',
    schemaName: 'ApiError',
  },
  '403': {
    description: `The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code ${productErrorCodes.consumerSurfaceRequired} in the audience case.`,
    schemaName: 'ApiError',
  },
} as const;

/**
 * Rejections every authenticated creator operation can produce. Creator Studio
 * is the only audience that carries creator authority: `AGENTS.md` forbids
 * consumer functionality leaking into that surface, and the reverse holds just
 * as strictly — a consumer session must never become a creator actor by calling
 * a creator endpoint.
 */
const creatorAuthenticationResponses = {
  '401': {
    description:
      'No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED.',
    schemaName: 'ApiError',
  },
  '403': {
    description: `The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code ${productErrorCodes.creatorSurfaceRequired} in the audience case.`,
    schemaName: 'ApiError',
  },
} as const;

/**
 * Rejections every Admin operation can produce.
 *
 * The audience is `platform_admin` and nothing else reaches these routes: a
 * consumer session and a Creator Studio session are refused before any lookup
 * happens on their behalf. Step-up is separate from audience: an operator who
 * is signed in but has not proved a phishing-resistant authenticator recently
 * enough is refused as well, which is why these routes are unreachable in a
 * deployed environment until such a verifier is approved.
 */
const adminAuthenticationResponses = {
  '401': {
    description:
      'No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED.',
    schemaName: 'ApiError',
  },
  '403': {
    description: `The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ${productErrorCodes.actionNotPermitted} in the audience and step-up cases.`,
    schemaName: 'ApiError',
  },
} as const;

const creatorProfileConflictResponse = {
  description: `A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code ${productErrorCodes.conflict}. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see.`,
  schemaName: 'ApiError',
} as const;

const creatorNotEligibleResponse = {
  description: `Creator capability may not be established or advanced: the principal has no consumer account, has not declared adult status, or is not in good standing. The body is an ApiError with code ${productErrorCodes.accountNotEligible}. It never says which condition failed — the onboarding state does, and only to the person it describes.`,
  schemaName: 'ApiError',
} as const;

const invalidProductInputResponse = {
  description: `Request body failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
  schemaName: 'ApiError',
} as const;

const profileConflictResponse = {
  description: `A concurrent edit won, or the addressed object is no longer in a state that allows this. The body is an ApiError with code ${productErrorCodes.conflict}. The caller should re-read and decide again.`,
  schemaName: 'ApiError',
} as const;

const profileNotEligibleResponse = {
  description: `The account has not reached the profile step of admission, or is in a lifecycle state that does not permit profile edits, or asked to become discoverable without a complete minimum profile. The body is an ApiError with code ${productErrorCodes.accountNotEligible}.`,
  schemaName: 'ApiError',
} as const;

const introductionNotEligibleResponse = {
  description: `The caller is not eligible to act on introductions: the account is not active or the minimum discoverable profile is incomplete. The body is an ApiError with code ${productErrorCodes.accountNotEligible}.`,
  schemaName: 'ApiError',
} as const;

const messagingNotPermittedResponse = {
  description: `The caller may not communicate here: the account is not active, the conversation is closed, or current safety eligibility denies the pair. The body is an ApiError with code ${productErrorCodes.accountNotEligible} or ${productErrorCodes.actionNotPermitted}. Nothing in it says which, or why.`,
  schemaName: 'ApiError',
} as const;

const messageSendConflictResponse = {
  description: `The caller may not send here — account, conversation state, or current safety eligibility — or the same client message identifier was already used for a different body. The body is an ApiError with code ${productErrorCodes.accountNotEligible}, ${productErrorCodes.actionNotPermitted}, or ${productErrorCodes.idempotencyMismatch}.`,
  schemaName: 'ApiError',
} as const;

const commerceConflictResponse = {
  description: `A concurrent change won, the offer is not in a state that allows this, a live offer already covers this resource and mode, or a live price already exists in this currency. The body is an ApiError with code ${productErrorCodes.conflict}. The caller should re-read and decide again.`,
  schemaName: 'ApiError',
} as const;

const commerceNotEligibleResponse = {
  description: `The commercial action is not permitted: the creator may not operate, the resource does not exist or does not belong to them, activation was attempted against a resource that is not published, or the amount, currency, or cadence is outside approved commercial terms. The body is an ApiError with code ${productErrorCodes.accountNotEligible} or ${productErrorCodes.actionNotPermitted}. It never says which — an offer endpoint that distinguished "no such club" from "not yours" would let one creator enumerate another's catalog.`,
  schemaName: 'ApiError',
} as const;

const commerceUnavailableResponse = {
  description: `No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code ${apiErrorCodes.serviceUnavailable}; the code tells the two apart.`,
  headers: { [retryAfterResponseHeader]: retryAfterHeader },
  schemaName: 'ApiError',
} as const;

const mediaStorageUnavailableResponse = {
  description: `No approved media storage provider is configured for this environment, so the object could not be stored or inspected. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}. This status is also the shared capacity refusal, with code ${apiErrorCodes.serviceUnavailable}; the code tells the two apart.`,
  headers: { [retryAfterResponseHeader]: retryAfterHeader },
  schemaName: 'ApiError',
} as const;

const mediaDeliveryUnavailableResponse = {
  description: `No approved media delivery provider is configured for this environment, so no address can be produced for anything. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}. It is a statement about the platform rather than about any asset named in the request, which is why it is one answer for the whole call rather than a per-asset omission. This status is also the shared capacity refusal, with code ${apiErrorCodes.serviceUnavailable}; the code tells the two apart.`,
  headers: { [retryAfterResponseHeader]: retryAfterHeader },
  schemaName: 'ApiError',
} as const;

const liveDiscoveryUnavailableResponse = {
  description: `Live discovery is not switched on in this environment, so nobody is admitted to the matching pool. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}. It is a truthful statement about the platform rather than about the caller: no RTC provider is approved to carry a call between two strangers, and call retention, regional availability, and recording posture are undecided. This status is also the shared capacity refusal, with code ${apiErrorCodes.serviceUnavailable}; the code tells the two apart.`,
  headers: { [retryAfterResponseHeader]: retryAfterHeader },
  schemaName: 'ApiError',
} as const;

const liveEncounterNotFoundResponse = {
  description:
    'No encounter of the caller matches that identifier. Somebody else\u2019s encounter, an encounter that never existed, and one the caller has already left are deliberately indistinguishable. The body is an ApiError.',
  schemaName: 'ApiError',
} as const;

export const apiOperations = [
  {
    method: 'post',
    operationId: 'createAiSuggestion',
    path: apiRoutePaths.aiSuggestions,
    requestHeaders: [csrfHeader],
    requestSchemaName: 'AiSuggestionRequest',
    responses: {
      '200': {
        description:
          'A labeled, editable suggestion. It has not saved, sent, published, approved, or executed anything.',
        schemaName: 'AiSuggestionResponse',
      },
      '401': authRequiredResponse,
      '403': {
        description:
          'Browser integrity, audience/capability admission, capability activation, or the AI kill switch refused the run. The body is an ApiError.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      '429': {
        description: `The actor's deterministic AI budget is exhausted. The body is an ApiError with code ${productErrorCodes.rateLimited}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Creates a suggestion through the provider-neutral AI Gateway. Clients cannot choose a provider, model, prompt, tool, or action.',
  },
  {
    method: 'post',
    operationId: 'cancelAiRun',
    path: apiRoutePaths.aiRunCancellation,
    requestHeaders: [csrfHeader],
    requestSchemaName: 'AiRunCancellationRequest',
    responses: {
      '200': {
        description:
          'Whether the caller-owned run was transitioned from an active state to cancelled. Repeating cancellation is safe.',
        schemaName: 'AiRunCancellationResponse',
      },
      '401': authRequiredResponse,
      '403': authBrowserOriginResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'getLiveness',
    path: apiRoutePaths.liveness,
    responses: {
      '200': {
        description: 'Process is alive',
        schemaName: 'LivenessResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'get',
    operationId: 'getReadiness',
    path: apiRoutePaths.readiness,
    responses: {
      '200': {
        description: 'Dependencies are ready',
        schemaName: 'ReadinessResponse',
      },
      ...sharedErrorResponses,
      // Declared after the shared set on purpose. A readiness probe reports the
      // dependency verdict rather than an ApiError, and it is never subject to
      // database admission — an instance at its limit must still be able to say
      // what it thinks of its dependencies.
      '503': {
        description: 'A required dependency is unavailable',
        schemaName: 'ReadinessResponse',
      },
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'post',
    operationId: 'createLocalWebSession',
    path: apiRoutePaths.localWebSession,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'LocalWebSessionRequest',
    responses: {
      '201': {
        description:
          'A browser session was established and its audience-scoped cookie was set',
        schemaName: 'AuthSessionResponse',
      },
      '403': authBrowserOriginResponse,
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'Development and test identity adapter. It is refused outside the local and test application environments and can never mint Platform Admin authority.',
  },
  {
    method: 'post',
    operationId: 'createLocalAdminSession',
    path: apiRoutePaths.localAdminSession,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'LocalAdminSessionRequest',
    responses: {
      '201': {
        description:
          'A platform_admin browser session was established with phishing_resistant assurance and its audience-scoped cookie was set',
        schemaName: 'AuthSessionResponse',
      },
      '403': authBrowserOriginResponse,
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'Development and test only. Issues a platform_admin session with phishing_resistant assurance using the local-test-privileged authenticator adapter. Refused outside local and test environments, and refused whenever the configured verifier is not local-test-privileged. See ADR-0034.',
  },
  {
    method: 'post',
    operationId: 'createLocalMobileSession',
    path: apiRoutePaths.localMobileSession,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'LocalMobileSessionRequest',
    responses: {
      '201': {
        description: 'An access token and a new refresh family were issued',
        schemaName: 'MobileTokenResponse',
      },
      '403': authBrowserOriginResponse,
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'Development and test identity adapter for Consumer Mobile. It is refused outside the local and test application environments.',
  },
  {
    method: 'get',
    operationId: 'getAuthSession',
    path: apiRoutePaths.session,
    responses: {
      '200': {
        description: 'The server-derived authentication context for the caller',
        schemaName: 'AuthSessionResponse',
      },
      '401': authRequiredResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'refreshMobileSession',
    path: apiRoutePaths.mobileRefresh,
    requestSchemaName: 'MobileRefreshRequest',
    responses: {
      '200': {
        description:
          'The presented refresh token was consumed and its successor issued',
        schemaName: 'MobileTokenResponse',
      },
      '401': {
        description:
          'The refresh token is unknown, expired, already rotated, or its family is revoked, and a token that was already rotated additionally revokes its family. The body is an ApiError with code AUTH_REFRESH_INVALID.',
        schemaName: 'ApiError',
      },
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'post',
    operationId: 'logout',
    path: apiRoutePaths.logout,
    requestHeaders: [csrfHeader],
    responses: {
      '200': {
        description:
          'The current authority is revoked. The operation is idempotent and succeeds when there is nothing to revoke.',
        schemaName: 'AuthAcknowledgement',
      },
      '403': authBrowserOriginResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'logoutAll',
    path: apiRoutePaths.logoutAll,
    requestHeaders: [csrfHeader],
    responses: {
      '200': {
        description:
          'Every browser session and refresh family for the account is revoked',
        schemaName: 'AuthAcknowledgement',
      },
      '401': authRequiredResponse,
      '403': authBrowserOriginResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'startAccountRecovery',
    path: apiRoutePaths.recoveryStart,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'RecoveryStartRequest',
    responses: {
      '202': {
        description:
          'The request was accepted. The response is identical whether or not an account exists.',
        schemaName: 'AuthAcknowledgement',
      },
      '403': authBrowserOriginResponse,
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'post',
    operationId: 'completeAccountRecovery',
    path: apiRoutePaths.recoveryCompletion,
    requestHeaders: [deviceHeader],
    requestSchemaName: 'RecoveryCompletionRequest',
    responses: {
      '200': {
        description:
          'Recovery completed. Prior authority is revoked and a new Consumer Web session was established.',
        schemaName: 'AuthSessionResponse',
      },
      '401': {
        description:
          'The recovery token is unknown, expired, or already consumed. The body is an ApiError with code AUTH_RECOVERY_INVALID.',
        schemaName: 'ApiError',
      },
      '403': {
        description:
          'The request was rejected by browser origin policy, or the recovery is high risk and requires a second independent signal or reviewed handling. The body is an ApiError.',
        schemaName: 'ApiError',
      },
      '422': invalidAuthInputResponse,
      '429': authRateLimitedResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
  },
  {
    method: 'post',
    operationId: 'createConsumerAccount',
    path: apiRoutePaths.consumerAccount,
    requestSchemaName: 'CreateConsumerAccountRequest',
    responses: {
      '200': {
        description:
          'A consumer account already existed for the caller and was returned unchanged.',
        schemaName: 'ConsumerAccountResponse',
      },
      '201': {
        description: 'A consumer account was created for the caller.',
        schemaName: 'ConsumerAccountResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Idempotent. The AUTH account is derived from the presented credential, so the request body can never name another account. A repeated call returns the existing account unchanged, whatever its lifecycle state.',
  },
  {
    method: 'get',
    operationId: 'getConsumerAccount',
    path: apiRoutePaths.consumerAccountSelf,
    responses: {
      '200': {
        description: "The caller's own consumer account.",
        schemaName: 'ConsumerAccountResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'getConsumerOnboarding',
    path: apiRoutePaths.consumerOnboarding,
    responses: {
      '200': {
        description:
          "The caller's admission state, derived from stored evidence rather than from any client-supplied step.",
        schemaName: 'OnboardingStateResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'declareAdult',
    path: apiRoutePaths.consumerAdultDeclaration,
    requestSchemaName: 'AdultDeclarationRequest',
    responses: {
      '200': {
        description:
          'The declaration was recorded and the resulting admission state is returned.',
        schemaName: 'OnboardingStateResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The account declared that it is not an adult, or is otherwise not eligible to continue. The body is an ApiError with code ${productErrorCodes.accountNotEligible}. The declaration is recorded either way.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Self-declared adult status and the region whose rules apply. This is the weakest assurance class and is never equivalent to a verified adult check. No birth date is collected.',
  },
  {
    method: 'post',
    operationId: 'acknowledgeConsumerPolicies',
    path: apiRoutePaths.consumerPolicyAcknowledgements,
    requestSchemaName: 'PolicyAcknowledgementRequest',
    responses: {
      '200': {
        description:
          'Acknowledgement evidence was recorded and the resulting admission state is returned. Re-acknowledging a version already held changes nothing.',
        schemaName: 'OnboardingStateResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `An earlier admission step is outstanding, or a version was submitted that is not the one currently required. The body is an ApiError with code ${productErrorCodes.accountNotEligible}.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'getConsumerProfile',
    path: apiRoutePaths.consumerProfile,
    responses: {
      '200': {
        description:
          "The caller's own profile, its images, and what the minimum discoverable profile still lacks.",
        schemaName: 'ProfileResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'saveConsumerProfile',
    path: apiRoutePaths.consumerProfile,
    requestSchemaName: 'SaveProfileRequest',
    responses: {
      '200': {
        description: 'The profile was created or updated and is returned.',
        schemaName: 'ProfileResponse',
      },
      ...consumerAuthenticationResponses,
      '409': profileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'expectedVersion is absent exactly when no profile exists yet. Being wrong in either direction is a conflict rather than a silent create or overwrite.',
  },
  {
    method: 'post',
    operationId: 'saveConsumerMatchingGender',
    path: apiRoutePaths.consumerMatchingGender,
    requestSchemaName: 'SaveMatchingGenderRequest',
    responses: {
      '200': {
        description:
          'The declaration was recorded and the profile is returned. It takes effect on the next candidate the matcher considers and changes nothing about an encounter already allocated.',
        schemaName: 'ProfileResponse',
      },
      ...consumerAuthenticationResponses,
      '409': profileNotEligibleResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Declares what the caller says about themselves for matching. It is optional, it is never inferred, it is never shown to anybody else, and it is always about the caller: there is no shape here that names another account.',
  },
  {
    method: 'post',
    operationId: 'saveConsumerPreferences',
    path: apiRoutePaths.consumerPreferences,
    requestSchemaName: 'SavePreferencesRequest',
    responses: {
      '200': {
        description: 'The preference was recorded and the profile is returned.',
        schemaName: 'ProfileResponse',
      },
      ...consumerAuthenticationResponses,
      '409': profileNotEligibleResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'A new consumer is not discoverable. Discoverability is off until it is turned on here, and it cannot be turned on while the minimum discoverable profile is incomplete.',
  },
  {
    method: 'post',
    operationId: 'createConsumerProfileMediaUpload',
    path: apiRoutePaths.consumerProfileMedia,
    responses: {
      '201': {
        description:
          'A slot was reserved and a short-lived, object-bound upload capability was issued.',
        schemaName: 'ProfileMediaUploadResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The account may not edit its profile, or already holds the maximum number of images. The body is an ApiError with code ${productErrorCodes.accountNotEligible} or ${productErrorCodes.limitReached}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
      '503': mediaStorageUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'completeConsumerProfileMediaUpload',
    path: apiRoutePaths.consumerProfileMediaCompletion,
    requestSchemaName: 'ProfileMediaReferenceRequest',
    responses: {
      '200': {
        description:
          'The stored object was inspected and the image is now ready or rejected. The resulting profile is returned either way.',
        schemaName: 'ProfileResponse',
      },
      ...consumerAuthenticationResponses,
      '409': profileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': mediaStorageUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      "The platform decides the object's type, size, and acceptability from the stored bytes. A client never declares what it uploaded.",
  },
  {
    method: 'post',
    operationId: 'removeConsumerProfileMedia',
    path: apiRoutePaths.consumerProfileMediaRemoval,
    requestSchemaName: 'ProfileMediaReferenceRequest',
    responses: {
      '200': {
        description:
          'The image no longer belongs to the profile. The resulting profile is returned.',
        schemaName: 'ProfileResponse',
      },
      ...consumerAuthenticationResponses,
      '409': profileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'createMediaDeliveries',
    path: apiRoutePaths.mediaDeliveries,
    requestSchemaName: 'MediaDeliveryRequest',
    responses: {
      '200': {
        description:
          'Addresses for the named assets this caller may currently be served, in the requested variant. An asset that does not exist, is not technically ready, is not published by its owning domain, is not this caller’s to see, or is restricted by Trust and Safety is absent from the response rather than refused, so the operation cannot be used to test whether somebody’s image exists. An address carrying an expiry is a bearer credential valid until that instant and must not outlive it in a cache, a link, or a page.',
        schemaName: 'MediaDeliveryListResponse',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': mediaDeliveryUnavailableResponse,
    },
    // Deliberately not a consumer-only operation. A published creator page is
    // answered without a session and its imagery is public, so a caller with no
    // credential may ask; a caller with one is shown whatever that credential
    // additionally entitles them to. Authorization is per asset, taken from the
    // owning domain at the moment of issuance, and never from the audience.
    security: apiSecurityRequirements.public,
    summary:
      'Turns opaque asset references a caller already holds into addresses it can fetch. Every reference is re-authorized here rather than when it was published, so an image stops being addressable the moment its owning domain, its safety state, or the relationship behind it changes.',
  },
  {
    method: 'get',
    operationId: 'getConsumerAvailability',
    path: apiRoutePaths.consumerAvailability,
    responses: {
      '200': {
        description:
          "The caller's own availability, with an expired window already resolved to unavailable.",
        schemaName: 'AvailabilityResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'saveConsumerAvailability',
    path: apiRoutePaths.consumerAvailability,
    requestSchemaName: 'SaveAvailabilityRequest',
    responses: {
      '200': {
        description:
          'Availability was recorded and the resulting state is returned.',
        schemaName: 'AvailabilityResponse',
      },
      ...consumerAuthenticationResponses,
      '409': profileNotEligibleResponse,
      '422': {
        description: `The body failed contract validation, or the requested window has already closed or is longer than policy allows. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'A bounded, user-managed preference. It is not presence, not consent to be contacted, not a guarantee of appearing in discovery, and never an override of a block or an enforcement decision. Being available always carries an end.',
  },
  {
    method: 'post',
    operationId: 'createCreatorAccount',
    path: apiRoutePaths.creatorAccount,
    requestSchemaName: 'CreateCreatorAccountRequest',
    responses: {
      '200': {
        description:
          'Creator capability already existed for the caller and was returned unchanged.',
        schemaName: 'CreatorAccountResponse',
      },
      '201': {
        description:
          'Creator capability was established for the caller, as an applicant.',
        schemaName: 'CreatorAccountResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorNotEligibleResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Idempotent, and explicit: nobody becomes a creator by being a consumer. The principal is derived from the presented credential, so the body can never name another account, and exactly one creator account exists per principal however many concurrent calls arrive. No legal name, business registration, tax identifier, payout credential, or identity document is collected — those belong to a later verification and payout architecture that does not exist yet.',
  },
  {
    method: 'get',
    operationId: 'getCreatorAccount',
    path: apiRoutePaths.creatorAccountSelf,
    responses: {
      '200': {
        description: "The caller's own creator capability.",
        schemaName: 'CreatorAccountResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A caller with no creator capability receives the same answer as a caller addressing a route that does not exist, so probing this endpoint reveals nothing.',
  },
  {
    method: 'get',
    operationId: 'getCreatorOnboarding',
    path: apiRoutePaths.creatorOnboarding,
    responses: {
      '200': {
        description:
          'What creator activation still requires, derived from stored evidence.',
        schemaName: 'CreatorOnboardingStateResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'acknowledgeCreatorPolicies',
    path: apiRoutePaths.creatorPolicyAcknowledgements,
    requestSchemaName: 'CreatorPolicyAcknowledgementRequest',
    responses: {
      '200': {
        description:
          'Acknowledgement evidence was recorded and the resulting activation state is returned. Re-acknowledging a version already held changes nothing.',
        schemaName: 'CreatorOnboardingStateResponse',
      },
      ...creatorAuthenticationResponses,
      '409': {
        description: `The adult gate is unmet, the capability is not in a state that accepts acknowledgement, or a version was submitted that is not the one currently required. The body is an ApiError with code ${productErrorCodes.accountNotEligible}.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Acknowledgement evidence is append-only and versioned. When approved creator legal copy replaces the unpublished version, the version string changes, every creator is asked again, and the evidence that they accepted the earlier version is preserved rather than rewritten.',
  },
  {
    method: 'get',
    operationId: 'getCreatorProfile',
    path: apiRoutePaths.creatorProfile,
    responses: {
      '200': {
        description:
          "The creator's own profile, including a draft nobody else can see.",
        schemaName: 'CreatorProfileResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'saveCreatorProfile',
    path: apiRoutePaths.creatorProfile,
    requestSchemaName: 'SaveCreatorProfileRequest',
    responses: {
      '200': {
        description:
          'The profile was updated and is returned with a new version.',
        schemaName: 'CreatorProfileResponse',
      },
      '201': {
        description:
          'The profile was created as a draft and the handle was claimed.',
        schemaName: 'CreatorProfileResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'The handle is canonicalized server-side and claimed on the first save; database uniqueness decides who gets it, so fifty simultaneous claims of the same name settle on exactly one owner. It is immutable afterwards — this milestone has no self-service rename, and a save naming a different handle is refused rather than quietly ignored. A profile is created as a draft: publishing is a separate, explicit decision.',
  },
  {
    method: 'post',
    operationId: 'setCreatorProfilePublication',
    path: apiRoutePaths.creatorProfilePublication,
    requestSchemaName: 'CreatorProfilePublicationRequest',
    responses: {
      '200': {
        description:
          'The publication state was set and the profile is returned with a new version.',
        schemaName: 'CreatorProfileResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Publishing is what makes a creator page reachable without a session, so it is never a side effect of saving. Only an active creator may publish; unpublishing takes the page down immediately for every later read.',
  },
  {
    method: 'get',
    operationId: 'getPublicCreator',
    path: apiRoutePaths.publicCreator,
    requestQuery: [{ description: 'Canonical creator handle', name: 'handle' }],
    responses: {
      '200': {
        description:
          'The explicitly public projection of a published creator profile.',
        schemaName: 'PublicCreatorResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'The only creator route a visitor with no session may call, and it answers with an allow-listed projection rather than a filtered record: no creator identifier, no AUTH subject, no consumer identifier, no lifecycle or moderation state, no counts, and nothing purchasable. An unknown handle, a draft profile, and a creator who is not active are all the same 404, so the endpoint cannot be used to discover that somebody exists.',
  },
  {
    method: 'get',
    operationId: 'listCreatorContent',
    path: apiRoutePaths.creatorContent,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum items to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "The creator's own catalog, newest first, including drafts and archived items nobody else can see.",
        schemaName: 'CreatorContentListResponse',
      },
      ...creatorAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'saveCreatorContent',
    path: apiRoutePaths.creatorContent,
    requestSchemaName: 'SaveCreatorContentRequest',
    responses: {
      '200': {
        description: 'The item was updated and is returned with a new version.',
        schemaName: 'CreatorContentListResponse',
      },
      '201': {
        description: 'The item was created as a draft.',
        schemaName: 'CreatorContentListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Everything starts as a draft and nothing a creator writes becomes visible by being written. An edit carries the version it was read at, so a second tab cannot overwrite work it never saw, and an item identifier that belongs to another creator is answered exactly as one that does not exist.',
  },
  {
    method: 'post',
    operationId: 'startCreatorProfileMediaUpload',
    path: apiRoutePaths.creatorProfileMedia,
    requestSchemaName: 'CreatorProfileMediaRequest',
    responses: {
      '201': {
        description:
          'A short-lived capability to write one object, and the reference the image will be known by.',
        schemaName: 'MediaUploadCapability',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': mediaStorageUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Reserves one image for one page slot. A slot that already holds an image is replaced immediately and the bytes it held are owed a deletion, so the slot is empty on the page until the new image is ready — which is the honest state rather than showing the old one while its replacement is still being decided.',
  },
  {
    method: 'post',
    operationId: 'completeCreatorProfileMediaUpload',
    path: apiRoutePaths.creatorProfileMediaCompletion,
    requestSchemaName: 'CreatorMediaReferenceRequest',
    responses: {
      '200': {
        description:
          'The bytes were accepted for inspection. The profile is returned.',
        schemaName: 'CreatorProfileResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': mediaStorageUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      "The platform decides the object's type, size, and acceptability from the stored bytes. A client never declares what it uploaded.",
  },
  {
    method: 'post',
    operationId: 'removeCreatorProfileMedia',
    path: apiRoutePaths.creatorProfileMediaRemoval,
    requestSchemaName: 'CreatorMediaReferenceRequest',
    responses: {
      '200': {
        description:
          'The image no longer belongs to the page. The profile is returned.',
        schemaName: 'CreatorProfileResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Detaching is immediate and the bytes are owed a deletion the media platform records durably. A published page loses the image at the next delivery decision rather than at the next cache expiry, because there is no durable address to expire.',
  },
  {
    method: 'post',
    operationId: 'startCreatorContentMediaUpload',
    path: apiRoutePaths.creatorContentMedia,
    requestSchemaName: 'CreatorContentMediaRequest',
    responses: {
      '201': {
        description:
          'A short-lived capability to write one object, and the reference the image will be known by.',
        schemaName: 'MediaUploadCapability',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': mediaStorageUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Reserves one image against one item, in the next free position. An item identifier belonging to another creator is answered exactly as one that does not exist, and an item already holding the maximum is refused rather than silently reordered.',
  },
  {
    method: 'post',
    operationId: 'completeCreatorContentMediaUpload',
    path: apiRoutePaths.creatorContentMediaCompletion,
    requestSchemaName: 'CreatorMediaReferenceRequest',
    responses: {
      '200': {
        description:
          'The bytes were accepted for inspection. The item is returned.',
        schemaName: 'CreatorContentListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': mediaStorageUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      "The platform decides the object's type, size, and acceptability from the stored bytes. A client never declares what it uploaded.",
  },
  {
    method: 'post',
    operationId: 'removeCreatorContentMedia',
    path: apiRoutePaths.creatorContentMediaRemoval,
    requestSchemaName: 'CreatorMediaReferenceRequest',
    responses: {
      '200': {
        description:
          'The image no longer belongs to the item. The item is returned.',
        schemaName: 'CreatorContentListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Detaching frees the position it held without renumbering the others, and the bytes are owed a deletion the media platform records durably.',
  },
  {
    method: 'post',
    operationId: 'setCreatorContentLifecycle',
    path: apiRoutePaths.creatorContentLifecycle,
    requestSchemaName: 'CreatorContentLifecycleRequest',
    responses: {
      '200': {
        description:
          'The lifecycle transition was applied and the item is returned with a new version.',
        schemaName: 'CreatorContentListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Publishing is a decision about who may see something, so it is never a side effect of saving. Only an active creator may publish; archiving withdraws an item without destroying the record, and a concurrent transition is refused rather than applied twice.',
  },
  {
    method: 'get',
    operationId: 'getPublicCreatorDirectory',
    path: apiRoutePaths.publicCreatorDirectory,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this listing',
        name: 'cursor',
      },
      { description: 'Maximum creators to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          'Published pages of active creators, most recently published first.',
        schemaName: 'PublicCreatorDirectoryResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'The listing a person browses instead of having to know a handle. It carries exactly what a row needs — a name, a handle, a portrait reference, and a bio — and applies the same conditions the page itself does, so a draft page, a suspended creator, and a handle nobody holds are all simply absent rather than listed and then refused. Ordering is publication order and nothing else: no popularity, no follower count, and nothing purchasable participates, in the response or in the schema behind it.',
  },
  {
    method: 'get',
    operationId: 'getPublicCreatorCatalog',
    path: apiRoutePaths.publicCreatorCatalog,
    requestQuery: [
      { description: 'Canonical creator handle', name: 'handle' },
      {
        description: 'Opaque forward-only position in this catalog',
        name: 'cursor',
      },
      { description: 'Maximum items to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          'Published public items for an active creator whose profile is published, newest first.',
        schemaName: 'PublicCreatorCatalogResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'The catalog half of the public creator page, and the same rule: a handle nobody holds, a profile that is a draft, a creator who is not active, and a creator with nothing published are one indistinguishable 404. Drafts, archived items, and members-only items never appear, and paging is bounded and keyed on the publication instant so a page boundary cannot move.',
  },
  {
    method: 'get',
    operationId: 'listCreatorClubs',
    path: apiRoutePaths.creatorClubs,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum clubs to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "The creator's own clubs with a live member count computed from current entitlements.",
        schemaName: 'CreatorClubListResponse',
      },
      ...creatorAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'saveCreatorClub',
    path: apiRoutePaths.creatorClubs,
    requestSchemaName: 'SaveCreatorClubRequest',
    responses: {
      '200': {
        description: 'The club was updated and is returned with a new version.',
        schemaName: 'CreatorClubListResponse',
      },
      '201': {
        description:
          'The club was created as a draft, with no members and no public presence.',
        schemaName: 'CreatorClubListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A club starts as a draft with nobody in it. The slug is unique within the creator rather than globally, is canonicalized server-side, and is not renameable in this milestone because it already appears in links people hold.',
  },
  {
    method: 'post',
    operationId: 'setCreatorClubLifecycle',
    path: apiRoutePaths.creatorClubLifecycle,
    requestSchemaName: 'ClubLifecycleRequest',
    responses: {
      '200': {
        description: 'The club lifecycle transition was applied.',
        schemaName: 'CreatorClubListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Only a published club appears publicly or admits anybody. Closing is final in this milestone: reopening would put people back inside a space they were removed from with nobody deciding it, and no approved policy says what that means.',
  },
  {
    method: 'get',
    operationId: 'listClubInvites',
    path: apiRoutePaths.creatorClubInvites,
    requestQuery: [{ description: 'Which club', name: 'clubId' }],
    responses: {
      '200': {
        description:
          'Invitations for one club, with no secret in any of them. A secret is returned once, when it is created.',
        schemaName: 'ClubInviteListResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'issueClubInvite',
    path: apiRoutePaths.creatorClubInvites,
    requestSchemaName: 'IssueClubInviteRequest',
    responses: {
      '201': {
        description:
          'A complimentary invitation was created. The secret is in this response and nowhere else.',
        schemaName: 'ClubInviteIssuedResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A complimentary invitation and never a purchase: the membership it creates records that it came from a creator invite. The secret is 256 bits of server-generated randomness, stored only as a digest, bounded by an expiry, revocable, and usable once.',
  },
  {
    method: 'post',
    operationId: 'revokeClubInvite',
    path: apiRoutePaths.creatorClubInviteRevocation,
    requestQuery: [{ description: 'Which club', name: 'clubId' }],
    requestSchemaName: 'RevokeClubInviteRequest',
    responses: {
      '200': {
        description: 'The invitation is withdrawn and can no longer be used.',
        schemaName: 'ClubInviteListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'get',
    operationId: 'listClubMemberships',
    path: apiRoutePaths.creatorClubMembers,
    requestQuery: [
      { description: 'Which club', name: 'clubId' },
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum memberships to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          'Entitlements to one club, with where each came from and whether it is live.',
        schemaName: 'ClubMembershipListResponse',
      },
      ...creatorAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A creator learns how many people hold access and can withdraw one, and nothing else: no name, no consumer identifier, no contact detail, and no behaviour. Subscriber private behaviour stays out of creator views entirely.',
  },
  {
    method: 'post',
    operationId: 'revokeClubMembership',
    path: apiRoutePaths.creatorClubMemberRevocation,
    requestQuery: [{ description: 'Which club', name: 'clubId' }],
    requestSchemaName: 'RevokeClubMembershipRequest',
    responses: {
      '200': {
        description: 'The entitlement is withdrawn.',
        schemaName: 'ClubMembershipListResponse',
      },
      ...creatorAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Withdrawal takes effect on the next protected read rather than on a schedule, because every read asks whether the entitlement is live rather than trusting something computed when it was granted.',
  },
  {
    method: 'post',
    operationId: 'redeemClubInvite',
    path: apiRoutePaths.clubRedemptions,
    requestSchemaName: 'RedeemClubInviteRequest',
    responses: {
      '200': {
        description:
          'The invitation admitted the caller, and the access they now hold is returned.',
        schemaName: 'ClubAccessListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The invitation could not admit the caller. The body is an ApiError with code ${productErrorCodes.actionNotPermitted}. It never says which condition failed: an unknown secret, an expired one, one already used, one withdrawn, a club that is not published, a creator who is not active, and an account that may not be admitted are deliberately one answer, because anything finer is an oracle for guessing invitations.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Redemption is single-use and settled by the database rather than by a read, so a secret presented many times at once admits its holder exactly once. A claim that cannot be completed is released rather than spent.',
  },
  {
    method: 'get',
    operationId: 'listClubAccess',
    path: apiRoutePaths.clubAccess,
    responses: {
      '200': {
        description: 'Every live entitlement the caller holds.',
        schemaName: 'ClubAccessListResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'getClubContent',
    path: apiRoutePaths.clubContent,
    requestQuery: [{ description: 'Which item', name: 'contentId' }],
    responses: {
      '200': {
        description:
          'The protected item, because every condition currently permits it.',
        schemaName: 'CreatorContentListResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Every condition is asked at the moment of the read: the item is published and club-scoped, the club is published, the creator is active, the account is in good standing, and the entitlement is live. Nothing consults a cached decision, because a cached decision is how a revoked member keeps reading. An item the caller may not read is the same 404 as one that does not exist.',
  },
  {
    method: 'get',
    operationId: 'getClub',
    path: apiRoutePaths.club,
    requestQuery: [
      { description: 'Canonical creator handle', name: 'handle' },
      { description: "The club's slug within that creator", name: 'slug' },
    ],
    responses: {
      '200': {
        description:
          "The club's public identity, plus the caller's own membership and the members-only feed when they hold one. A caller who holds nothing gets the identity and an empty feed — never a protected body, summary, or media reference.",
        schemaName: 'ClubDetailResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'Safe to reach by typed address. Entitlement is re-derived on this request from current club, creator, standing and membership state rather than from anything cached, so a revoked, blocked, or suspended reader loses the feed on their next load rather than at the next sweep.',
  },
  {
    method: 'post',
    operationId: 'leaveClub',
    path: apiRoutePaths.clubDepartures,
    requestSchemaName: 'LeaveClubRequest',
    responses: {
      '200': {
        description:
          'The invitation-based membership was ended, and the access the caller still holds is returned.',
        schemaName: 'ClubAccessListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The membership could not be ended here. The body is an ApiError with code ${productErrorCodes.actionNotPermitted}. A paid membership is refused deliberately: ending it is a billing decision with a period and a renewal attached, and it is cancelled through the subscription route instead.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Leaving is provenance-aware. A creator invitation is a gift and giving it back ends it; a commercial entitlement belongs to the subscription that produced it and is never ended by a membership action.',
  },
  {
    method: 'get',
    operationId: 'getPublicCreatorClubs',
    path: apiRoutePaths.publicCreatorClubs,
    requestQuery: [{ description: 'Canonical creator handle', name: 'handle' }],
    responses: {
      '200': {
        description: 'Published clubs on a published creator page.',
        schemaName: 'PublicClubListResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      "Presentation only: an identifier, a name, a description, the benefits its creator wrote, the slug, and — for a caller who already holds one — their own membership. No member count, no member list, no invitation, no content, and no price: what a club costs is BILLING's to publish against the same identifier, through its own route.",
  },
  {
    method: 'get',
    operationId: 'getPublicCreatorMemberships',
    path: apiRoutePaths.publicCreatorMemberships,
    requestQuery: [{ description: 'Canonical creator handle', name: 'handle' }],
    responses: {
      '200': {
        description:
          "This creator's active offers with their live prices, the platform's current commercial readiness, and the caller's own subscriptions against those offers. An empty list under `enabled: false` means VELORA cannot transact; an empty list under `enabled: true` means the creator has published nothing.",
        schemaName: 'PublicMembershipOfferListResponse',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      "What something costs, by opaque resource identifier. Which club that identifier names, what it is called, and what is inside it are PRIVATE CLUBS' to publish; the two answers are joined by the surface that asked for both, and neither domain reads the other.",
  },
  {
    method: 'post',
    operationId: 'receiveProviderEvent',
    path: apiRoutePaths.providerEvents,
    responses: {
      '202': {
        description:
          'The event was verified and a durable receipt exists. A redelivery is acknowledged identically to a first delivery, because a provider that got a different answer for a repeat would learn which of its events Velora had already seen. Nothing about the business is decided on this request: a worker drains the receipts afterwards.',
        schemaName: 'ProviderEventAcknowledgement',
      },
      '401': {
        description:
          'The signature over the raw body did not verify. Nothing was written, nothing was decided, and the refusal is audited. This is also the answer when the payload is malformed after verification, so a caller learns nothing about how close a forged signature was.',
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      "The provider's signature over the exact bytes is the entire credential: there is no session, no audience, and no CSRF token here. Size is bounded before the body is read as data, and the signature is checked before it is parsed as anything.",
  },
  {
    method: 'post',
    operationId: 'receiveRtcProviderEvent',
    path: apiRoutePaths.rtcProviderEvents,
    responses: {
      '202': {
        description:
          'The RTC-provider event was verified and its minimized durable receipt exists. Exact redeliveries receive the same acknowledgement. Nothing is applied on the request thread; a worker applies what a verified event is allowed to change, which is what the platform observes about a call and never who may take part in one.',
        schemaName: 'ProviderEventAcknowledgement',
      },
      '401': {
        description:
          'The exact raw body could not be authenticated. Nothing was written, and the response does not reveal which check failed — a bad signature, a mutated body, and a wrong account answer identically.',
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
      '413': {
        description:
          'The body exceeded the callback limit and was refused before anything parsed it.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.public,
    summary:
      'The configured provider signature over exact bytes is the credential. The endpoint stores provider/account/environment identity, event metadata, a body digest, and a room reference; never the callback body, SDP, ICE candidates, addresses, or credentials.',
  },
  {
    method: 'post',
    operationId: 'receiveIdentityProviderEvent',
    path: apiRoutePaths.identityProviderEvents,
    responses: {
      '202': {
        description:
          'The identity-provider event was verified and its minimized durable receipt exists. Exact redeliveries receive the same acknowledgement. Assurance evidence is never applied on the request thread; a worker retrieves current provider state and applies it later.',
        schemaName: 'ProviderEventAcknowledgement',
      },
      '401': {
        description:
          'The exact raw body could not be authenticated and normalized, or reused an event identity inconsistently. Nothing was written and the response does not reveal which check failed.',
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.public,
    summary:
      'The configured provider signature over exact bytes is the credential. The endpoint stores only provider/account/environment identity, event metadata, a body digest, and a provider reference; never callback contents, documents, biometrics, or hosted URLs.',
  },
  {
    method: 'get',
    operationId: 'listConsumerSubscriptions',
    path: apiRoutePaths.subscriptions,
    responses: {
      '200': {
        description:
          "The caller's own subscriptions. `past_due` appears and grants nothing: whether a lapsed payment keeps access is grace policy nobody has approved, and the fail-closed reading of an unresolved policy is no access.",
        schemaName: 'ConsumerSubscriptionListResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'listConsumerPayments',
    path: apiRoutePaths.payments,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this history',
        name: 'cursor',
      },
      { description: 'Maximum payments to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          'Everything the caller has been charged or nearly charged, newest first. A record of attempts rather than a set of receipts: what a receipt must say is unresolved commercial and tax policy, and calling this one would be a claim nobody approved.',
        schemaName: 'ConsumerPaymentListResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'cancelSubscription',
    path: apiRoutePaths.subscriptionCancellation,
    requestSchemaName: 'CancelSubscriptionRequest',
    responses: {
      '200': {
        description:
          'Renewal is scheduled to stop. The paid period is unchanged and access continues to its end, because withdrawing it at the moment somebody cancels would take back something already bought. Repeating the request is safe and returns the same state.',
        schemaName: 'ConsumerSubscriptionResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The subscription is not in a state that can be cancelled — it has already ended, or it never started. The body is an ApiError with code ${productErrorCodes.actionNotPermitted}. A subscription belonging to somebody else is the shared 404 instead, indistinguishable from one that does not exist.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Cancellation schedules the end of renewal and nothing else. There is no immediate option and no field that could become one: a refund is a separate, operator-authorized reversal, and this route never issues one. Unlike starting a purchase, it is open to every consumer surface: beginning a subscription from a mobile application is a different commercial arrangement, and ending one is not an arrangement at all.',
  },
  {
    method: 'post',
    operationId: 'startCheckout',
    path: apiRoutePaths.checkouts,
    requestHeaders: [idempotencyHeader],
    requestSchemaName: 'StartCheckoutRequest',
    responses: {
      '201': {
        description:
          'The payment operation exists. It is committed before any provider is contacted, so a process that dies between the two leaves something reconciliation can resolve rather than a charge nobody has a record of. A redirect URL is present when this call created one and absent on a replay.',
        schemaName: 'CheckoutResponse',
      },
      ...consumerAuthenticationResponses,
      '403': {
        description: `The caller may not buy this: the account is not in good standing, the offer is not active, no live price exists in the requested currency, or the audience is Consumer Mobile. The body is an ApiError with code ${productErrorCodes.accountNotEligible} or ${productErrorCodes.actionNotPermitted}. Purchases are Consumer Web only in this milestone.`,
        schemaName: 'ApiError',
      },
      '409': {
        description: `The same idempotency key was reused for a different purchase. The body is an ApiError with code ${productErrorCodes.idempotencyMismatch}.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'The request names an offer, a currency, and — where the offer publishes more than one cadence — which cadence. The amount is read from the price row inside the transaction that records the operation, so no client can propose what it pays, and an unnamed cadence against two published ones refuses rather than choosing. A client idempotency key is required, scoped by consumer and offer, so a double-click resolves to one purchase.',
  },
  {
    method: 'get',
    operationId: 'readCheckout',
    path: apiRoutePaths.checkouts,
    requestQuery: [{ description: 'Which payment', name: 'paymentId' }],
    responses: {
      '200': {
        description:
          "One of the caller's own payments. This is what a provider return URL reads: an ordinary authorized read of server state, with no transition on the path, so arriving at a success URL by hand tells somebody exactly what the platform already believed.",
        schemaName: 'CheckoutResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'get',
    operationId: 'getGiftCatalog',
    path: apiRoutePaths.giftCatalog,
    requestQuery: [
      { description: 'Published creator handle', name: 'handle' },
      { description: 'Requested catalog currency', name: 'currency' },
    ],
    responses: {
      '200': {
        description:
          "Active platform gift items with this creator's immutable active price in the requested currency.",
        schemaName: 'GiftCatalogResponse',
      },
      ...consumerAuthenticationResponses,
      '403': commerceNotEligibleResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'sendGift',
    path: apiRoutePaths.gifts,
    requestHeaders: [idempotencyHeader],
    requestSchemaName: 'SendGiftRequest',
    responses: {
      '201': {
        description:
          'The gift and payment are durable and, in local/test, settlement passed through the signed provider inbox and balanced journal.',
        schemaName: 'SendGiftResponse',
      },
      ...consumerAuthenticationResponses,
      '403': commerceNotEligibleResponse,
      '409': {
        description: 'The idempotency key names different gift inputs.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Consumer Web only. A gift sends value, never access or entitlement.',
  },
  {
    method: 'get',
    operationId: 'listSentGifts',
    path: apiRoutePaths.gifts,
    responses: {
      '200': {
        description: "The consumer's own sent-gift history.",
        schemaName: 'ConsumerGiftListResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'get',
    operationId: 'listReceivedGifts',
    path: apiRoutePaths.creatorReceivedGifts,
    responses: {
      '200': {
        description:
          'Received gifts with gross and journal-derived creator earning. Sender identity is withheld.',
        schemaName: 'CreatorReceivedGiftListResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'provisionLocalGiftCatalog',
    path: apiRoutePaths.creatorGiftCatalogProvision,
    responses: {
      '200': {
        description:
          'Fixed platform gift offers exist for the acting creator in local/test only.',
        schemaName: 'GiftCatalogProvisionResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Local/test seed support. No request field can choose catalog terms or enable a deployed environment.',
  },
  {
    method: 'get',
    operationId: 'getCreatorEarnings',
    path: apiRoutePaths.creatorEarnings,
    responses: {
      '200': {
        description:
          'Every currency this creator has been paid in, with what was grossed, what the platform kept, what has been returned, what is currently claimed back, and what the platform owes them. One set of figures per currency and never a total: a sum across currencies is a number with no meaning. `payable` is the only authoritative figure — it is a ledger balance derived on read — and the rest are projections over the commercial records that produced it.',
        schemaName: 'CreatorEarningsResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Nothing here is a forecast, a trend, or a projection of future income. Every figure describes money that has already moved, and `tax` is zero everywhere because no tax authority is configured — which is a statement about what Velora withheld rather than about what anybody owes.',
  },
  {
    method: 'get',
    operationId: 'getCreatorEarningsHistory',
    path: apiRoutePaths.creatorEarningsHistory,
    requestQuery: [
      { description: 'Which currency', name: 'currency' },
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum entries to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "One currency's commercial history, newest first: captures, reversals, and cardholder claims in one sequence, because reading them apart turns one story into three lists nobody can line up. It carries no consumer identifier, name, or contact detail — who bought something is not the seller's to know.",
        schemaName: 'CreatorEarningsHistoryResponse',
      },
      ...creatorAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'The currency is required rather than defaulted, because defaulting would pick one of a creator\u2019s currencies for them and show it as though it were all of their money. Paging is keyset rather than offset, so a settlement landing mid-read cannot shift a page boundary.',
  },
  {
    method: 'get',
    operationId: 'getMatureContentReadiness',
    path: apiRoutePaths.creatorMatureReadiness,
    responses: {
      '200': {
        description:
          'Whether mature creator content is available to this creator, and what stands in the way. It is not available, in any environment, and the blockers say why rather than leaving a creator to assume the remaining work is theirs.',
        schemaName: 'CreatorMatureReadinessResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Reports the configured source by name rather than a boolean, because "off" and "off because nobody has approved one" are different facts. Surface ineligibility is reported separately from the blockers: both app stores prohibit the class outright with no published approval path, so it is a permanent property of those surfaces rather than something anybody is working on.',
  },
  {
    method: 'get',
    operationId: 'getPayoutReadiness',
    path: apiRoutePaths.creatorPayoutReadiness,
    responses: {
      '200': {
        description:
          'Whether this creator could be paid, and what they hold in each currency. The two refusal reasons are separate fields on purpose: a creator whose provider record is fine but whose platform has published no settlement terms is in a different position from one who has not finished onboarding. `releasable` is what approved terms would let go right now, and it is zero wherever no terms are published.',
        schemaName: 'CreatorPayoutReadinessResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'In a deployed environment this always answers that payouts are unavailable, for two independent reasons: no assessed payout provider is eligible for Velora\u2019s business model, and no settlement window, reserve, or minimum payout is published. The balances are still shown, because the money is real whatever the platform can currently do with it.',
  },
  {
    method: 'post',
    operationId: 'startPayoutOnboarding',
    path: apiRoutePaths.creatorPayoutOnboarding,
    responses: {
      '201': {
        description:
          "A link into the payout provider's own hosted onboarding, and what the provider currently says about the record it created.",
        schemaName: 'PayoutOnboardingResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Velora collects nothing. There is no field in this API, and no column in this domain, for a bank account number, a routing number, a government identifier, or an identity document \u2014 not encrypted, not tokenized, not redacted: absent. The provider gathers, verifies, and retains all of it under its own compliance obligations, and Velora keeps a reference to the record plus a normalized capability answer.',
  },
  {
    method: 'post',
    operationId: 'requestPayout',
    path: apiRoutePaths.creatorPayouts,
    requestHeaders: [idempotencyHeader],
    requestSchemaName: 'RequestPayoutRequest',
    responses: {
      '201': {
        description:
          'The instruction exists and its reservation is posted. The reservation is an accounting transaction rather than a lock, so it is visible to every replica that reads the book, and it is committed before any provider is contacted.',
        schemaName: 'PayoutResponse',
      },
      ...creatorAuthenticationResponses,
      '409': {
        description: `The payout could not be made: the provider does not say this recipient can be paid, the amount exceeds what approved terms currently release, or the same idempotency key was reused for a different amount. The body is an ApiError with code ${productErrorCodes.conflict} or ${productErrorCodes.idempotencyMismatch}.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'No payout exceeds the amount derived from journal entries, and the database refuses a posting that would overdraw a creator whatever the service believes. An ambiguous provider answer leaves the instruction submitted with its reservation intact rather than retried, because a payout whose answer was lost has either moved money or not.',
  },
  {
    method: 'get',
    operationId: 'listCreatorPayouts',
    path: apiRoutePaths.creatorPayouts,
    responses: {
      '200': {
        description: "This creator's own payout instructions, newest first.",
        schemaName: 'CreatorPayoutHistoryResponse',
      },
      ...creatorAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'get',
    operationId: 'listCommercialOffers',
    path: apiRoutePaths.creatorOffers,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum offers to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "The creator's own commercial offers with their price history, and a readiness statement describing what the platform may currently sell. Readiness is returned whether or not anything is sellable, because a creator is entitled to know that monetisation is unavailable rather than meeting a form that refuses.",
        schemaName: 'CommercialOfferListResponse',
      },
      ...creatorAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'createCommercialOffer',
    path: apiRoutePaths.creatorOffers,
    requestSchemaName: 'CreateCommercialOfferRequest',
    responses: {
      '201': {
        description:
          'Draft commercial terms were opened against a resource the creator owns. A draft carries no price and nothing can be bought under it.',
        schemaName: 'CommercialOfferResponse',
      },
      ...creatorAuthenticationResponses,
      '403': commerceNotEligibleResponse,
      '409': commerceConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'An offer points at a resource another domain owns and says what kind of commercial relationship it would create. It does not say what it costs and it is not purchasable.',
  },
  {
    method: 'post',
    operationId: 'publishCommercialPrice',
    path: apiRoutePaths.creatorOfferPrices,
    requestSchemaName: 'PublishCommercialPriceRequest',
    responses: {
      '201': {
        description:
          'A price was published against the offer and is frozen from this moment.',
        schemaName: 'CommercialOfferResponse',
      },
      ...creatorAuthenticationResponses,
      '403': commerceNotEligibleResponse,
      '409': commerceConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A price is never edited. The amount is an integer count of minor units carried beside its currency, and changing what something costs means retiring one price and publishing another, because a purchase references the exact row it was made against.',
  },
  {
    method: 'post',
    operationId: 'retireCommercialPrice',
    path: apiRoutePaths.creatorOfferPriceRetirement,
    requestSchemaName: 'RetireCommercialPriceRequest',
    responses: {
      '200': {
        description:
          'The price was withdrawn. It is retained in full, and any purchase made under it is unaffected.',
        schemaName: 'CommercialOfferResponse',
      },
      ...creatorAuthenticationResponses,
      '403': commerceNotEligibleResponse,
      '409': commerceConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
  },
  {
    method: 'post',
    operationId: 'setCommercialOfferLifecycle',
    path: apiRoutePaths.creatorOfferLifecycle,
    requestSchemaName: 'CommercialOfferLifecycleRequest',
    responses: {
      '200': {
        description: 'The offer lifecycle transition was applied.',
        schemaName: 'CommercialOfferResponse',
      },
      ...creatorAuthenticationResponses,
      '403': commerceNotEligibleResponse,
      '409': commerceConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Activation re-reads every authority inside the transaction that performs it: approved commercial terms, the creator standing, the resource being owned and published, and at least one live price in a currency still approved. Retiring withdraws the offer and every live price on it, and deletes nothing.',
  },
  {
    method: 'get',
    operationId: 'listAdminCreators',
    path: apiRoutePaths.adminCreators,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum creators to return', name: 'pageSize' },
      {
        description: 'Public handle prefix to search for',
        name: 'adminSearch',
      },
    ],
    responses: {
      '200': {
        description:
          'Creators in operational terms, newest first, bounded and paged.',
        schemaName: 'AdminCreatorListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Operational state only: no AUTH subject, no consumer identifier, no contact detail, no financial data, and no moderation narrative. Search is a bounded prefix over the public handle, which is already public.',
  },
  {
    method: 'post',
    operationId: 'suspendCreator',
    path: apiRoutePaths.adminCreatorSuspension,
    requestSchemaName: 'AdminSuspendCreatorRequest',
    responses: {
      '200': {
        description:
          'The capability is suspended and the enforcement record that says so is returned.',
        schemaName: 'AdminOperationResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      "Stops the creator operating and takes their public surfaces down immediately, because every public read rechecks current creator state. It does not touch the person's consumer account: a creator suspension and a global restriction are different decisions with different scopes, and conflating them would ban somebody from a product they were not accused of anything in.",
  },
  {
    method: 'post',
    operationId: 'reinstateCreator',
    path: apiRoutePaths.adminCreatorReinstatement,
    requestSchemaName: 'AdminReinstateCreatorRequest',
    responses: {
      '200': {
        description: 'The capability is restored and the record is returned.',
        schemaName: 'AdminOperationResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Restoration is its own record rather than an edit of the suspension, because the question an audit asks is what was done and by whom, not only what is in force now. Nothing a creator had published comes back automatically: publication is their decision to take again.',
  },
  {
    method: 'post',
    operationId: 'removeCreatorObject',
    path: apiRoutePaths.adminCreatorObjectRemoval,
    requestSchemaName: 'AdminRemoveObjectRequest',
    responses: {
      '200': {
        description:
          'The object is no longer public and the enforcement record is returned.',
        schemaName: 'AdminOperationResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Takes one profile, item, or club out of public view without destroying it. Removal and deletion are different acts, and an object that is merely unpublished remains evidence and remains the creator\u2019s. The object must belong to the named creator; one that does not is answered exactly as one that does not exist.',
  },
  {
    method: 'post',
    operationId: 'revokeMembershipAsAdmin',
    path: apiRoutePaths.adminMembershipRevocation,
    requestSchemaName: 'AdminRevokeMembershipRequest',
    responses: {
      '200': {
        description: 'The entitlement is withdrawn and the record is returned.',
        schemaName: 'AdminOperationResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Withdraws one entitlement as a platform action. It takes effect on the next protected read, because every read asks whether the entitlement is live rather than trusting anything computed earlier.',
  },
  {
    method: 'get',
    operationId: 'listModerationCases',
    path: apiRoutePaths.adminSafetyCases,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this queue',
        name: 'cursor',
      },
      { description: 'Maximum cases to return', name: 'pageSize' },
      { description: 'Operator queue to read', name: 'moderationQueue' },
    ],
    responses: {
      '200': {
        description:
          'Open cases, oldest first, bounded and keyset paged. Ordered by when a case was opened rather than by how many reports it carries, because a queue sorted by complaint count is a queue anybody with several accounts can steer.',
        schemaName: 'ModerationCaseListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A case is about a target and never about who reported it. There is no reporter field in this response and no report count, so no operator view can group people by who they complained about or act on how many people did.',
  },
  {
    method: 'get',
    operationId: 'getModerationCase',
    path: apiRoutePaths.adminSafetyCase,
    requestQuery: [{ description: 'Case to read', name: 'caseId' }],
    responses: {
      '200': {
        description:
          'One case with the reports that are evidence in it, everything recorded as evidence, and every decision taken on it in order.',
        schemaName: 'ModerationCaseDetailResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'The reporter narrative is here because a reviewer cannot judge an allegation without it. The reporter is not: there is no field for one, so no response this contract can produce carries a reporter identity even to an operator.',
  },
  {
    method: 'post',
    operationId: 'claimModerationCase',
    path: apiRoutePaths.adminSafetyCaseClaim,
    requestSchemaName: 'ModerationCaseRequest',
    responses: {
      '200': {
        description: 'The case is held by the caller and the lease is running.',
        schemaName: 'ModerationCaseResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A lease rather than an assignment: a reviewer whose session ends mid-review releases the case when the lease lapses instead of holding it out of the queue for ever. Claiming a case somebody else currently holds is refused, so a claim is not a way to take a review out from under whoever is doing it.',
  },
  {
    method: 'post',
    operationId: 'triageModerationCase',
    path: apiRoutePaths.adminSafetyCaseTriage,
    requestSchemaName: 'ModerationTriageRequest',
    responses: {
      '200': {
        description: "The reviewer's judgement is recorded and the case moved.",
        schemaName: 'ModerationCaseResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Priority is an input here and nowhere else. Nothing computes it and nothing raises it because a second report arrived, because making report volume an input to urgency would let twenty coordinated accounts escalate anybody.',
  },
  {
    method: 'post',
    operationId: 'addModerationNote',
    path: apiRoutePaths.adminSafetyCaseNotes,
    requestSchemaName: 'ModerationNoteRequest',
    responses: {
      '200': {
        description: 'The note is recorded as evidence in the case.',
        schemaName: 'ModerationCaseResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      "A reviewer's own words, recorded as evidence and readable only through the case. Evidence is appended and never edited or removed, so a note is a fact about what somebody thought at a moment rather than a field somebody keeps current.",
  },
  {
    method: 'post',
    operationId: 'decideModerationCase',
    path: apiRoutePaths.adminSafetyCaseDecisions,
    requestSchemaName: 'ModerationDecisionRequest',
    responses: {
      '200': {
        description:
          'The decision is recorded, any enforcement it produced is applied through the domain that owns what changed, and every still-open report in the case is resolved.',
        schemaName: 'ModerationDecisionResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'An explicit command with a closed action vocabulary, and the only way a decision is ever recorded. There is no endpoint anywhere in this API that edits one: a correction is a superseding decision that names the original, and the original stays exactly as written.',
  },
  {
    method: 'get',
    operationId: 'listModerationAppeals',
    path: apiRoutePaths.adminSafetyAppeals,
    requestQuery: [
      { description: 'Maximum appeals to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description: 'Complaints still owed an answer, oldest first.',
        schemaName: 'ModerationAppealListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      "The appellant's own words are absent from this queue. An operator reads a complaint through the case it belongs to; a list shape carrying prose is a shape a log line or a metric label eventually carries too.",
  },
  {
    method: 'post',
    operationId: 'answerModerationAppeal',
    path: apiRoutePaths.adminSafetyAppealOutcome,
    requestSchemaName: 'ModerationAppealOutcomeRequest',
    responses: {
      '200': {
        description: 'The complaint is answered and the record says by whom.',
        schemaName: 'ModerationAppealResponse',
      },
      ...adminAuthenticationResponses,
      '409': creatorProfileConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Upholding a complaint names the superseding decision that replaced the original, and the server refuses one that does not genuinely replace it. Every outcome records the operator who reached it, because a complaint may not be decided solely by automated means and a column only a person fills is how that stops being a promise.',
  },
  {
    method: 'get',
    operationId: 'getAdminNotificationState',
    path: apiRoutePaths.adminNotificationState,
    responses: {
      '200': {
        description:
          'Notification delivery in operational terms: how many notices are in each state, how many attempts ended each way, failures by the class that decided what happened next, why notices were suppressed, how many verified provider events are waiting to be applied, how many device registrations are live and why the rest were retired, and how long the oldest owed thing in each class has been waiting. Counts, ages, and the adapter name only: no notice identifier, no account, and no device.',
        schemaName: 'AdminNotificationStateResponse',
      },
      ...adminAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A read and only a read. There is no list of notices and no search anywhere in this contract: an operator able to page through them would have a browsing surface over who is told about whom. The failure row is the one that separates an outage on this side from a problem with a destination, and the adapter is named rather than reported as a boolean so that "off" and "off because no delivery provider has been approved" stay distinguishable.',
  },
  {
    method: 'get',
    operationId: 'getAdminNotificationDelivery',
    path: apiRoutePaths.adminNotificationDelivery,
    requestQuery: [
      { description: 'The delivery to describe', name: 'deliveryId' },
    ],
    responses: {
      '200': {
        description:
          'One delivery\u2019s lifecycle: its state, channel, template, timings, how many attempts it has spent, whether a worker currently holds it, why it last failed, and why it was suppressed if it was.',
        schemaName: 'AdminNotificationDelivery',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No delivery matches that identifier. Answered the same way for one that never existed, so guessing identifiers is not productive here either.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Answers about one delivery whose identifier the operator already holds from a report or a reconciliation finding. It carries the technical lifecycle every consumer surface is deliberately denied, and it carries no recipient, no subject, and no payload \u2014 the question is why a notice did not go, and none of those three answer it. It reports that a worker holds the notice without naming which, because an operator cannot act on a process identifier.',
  },
  {
    method: 'get',
    operationId: 'getAdminRtcState',
    path: apiRoutePaths.adminRtcState,
    responses: {
      '200': {
        description:
          'Calling in operational terms: how many calls are in each state, how much provider teardown and how many verified provider events are owed, how long the oldest owed thing in each class has been waiting and whether that is past the age at which it becomes an alert, and how many calls finished while their teardown did not \u2014 the one disagreement where the platform believes a call is over and a provider may still be holding the room open. Counts, ages, and adapter names only: no call identifier, no account, and no provider room reference.',
        schemaName: 'AdminRtcStateResponse',
      },
      ...adminAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A read and only a read. There is no list of calls and no search anywhere in this contract: an operator able to page through calls would have a browsing surface over who contacts whom, and unlike an asset with one owner, a call is a relationship neither person published. The adapters are the ones this process actually composed rather than the configuration meant to select them, and naming them rather than reporting a boolean is what makes "off" and "off because no RTC provider has been approved" distinguishable.',
  },
  {
    method: 'get',
    operationId: 'getAdminRtcCall',
    path: apiRoutePaths.adminRtcCall,
    requestQuery: [{ description: 'The call to describe', name: 'callId' }],
    responses: {
      '200': {
        description:
          'One call\u2019s lifecycle: its state, medium, timings, why it ended, the authorization generation in force, how many join credentials have been minted for it, and the teardown owed against it by state.',
        schemaName: 'AdminRtcCall',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No call matches that identifier. Answered the same way for a call that never existed, so guessing identifiers is not productive here either.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Answers about one call whose identifier the operator already holds from a report or a reconciliation finding. It carries the technical lifecycle that every product surface is deliberately denied, and it carries no participant, no credential, no provider room reference, no address, and nothing about media \u2014 none of which exists anywhere in the domain to carry.',
  },
  {
    method: 'get',
    operationId: 'getAdminMediaState',
    path: apiRoutePaths.adminMediaState,
    responses: {
      '200': {
        description:
          'The media platform in operational terms: how many assets are in each technical state, how many stored objects are present or destroyed, how much work is owed and how much of it the platform gave up on, how long the oldest owed thing in each class has been waiting and whether that is past the age at which it becomes an alert, and which disagreements with the storage provider nobody could safely correct. Counts, ages, and adapter names only \u2014 no asset identifier, no owner, no object key, and no digest.',
        schemaName: 'AdminMediaStateResponse',
      },
      ...adminAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A read and only a read. The adapters are the ones this process actually composed rather than the configuration meant to select them, so the screen cannot report one thing while the process runs another, and naming them rather than reporting a boolean is what makes "off" and "off because no storage provider or malware scanner has been approved" distinguishable. Availability needs both halves: an approved store with no scanner accepts bytes nobody vetted, and a scanner with no store has nothing to vet.',
  },
  {
    method: 'get',
    operationId: 'getAdminMediaAsset',
    path: apiRoutePaths.adminMediaAsset,
    requestQuery: [
      { description: 'The media asset to describe', name: 'assetId' },
    ],
    responses: {
      '200': {
        description:
          "One asset's technical truth: its lifecycle, every object stored for it, and a bounded, newest-first window onto the duties owed against it and the disagreements with the provider recorded about it. Both of those are retained history rather than current state, so the response says when it cut something off instead of letting a reader believe they have all of it.",
        schemaName: 'AdminMediaAssetResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'There is no list of assets and no search anywhere in this contract. An operator who could page through everybody\u2019s media would have a browsing surface over private images however it was labelled, so this answers about one asset whose identifier the operator already has from a finding or a report. It carries the technical lifecycle that every product surface is deliberately denied, and no owner identifier at all.',
  },
  {
    method: 'post',
    operationId: 'purgeAdminMediaAsset',
    path: apiRoutePaths.adminMediaPurge,
    requestSchemaName: 'AdminMediaPurgeRequest',
    responses: {
      '200': {
        description:
          'A cache purge is now owed for every public address of the asset, and the asset comes back so the purge state is visible on the objects themselves.',
        schemaName: 'AdminMediaPurgeResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'The one media action an operator has, and it is safe in both directions: a purge asks a delivery layer to forget an address, destroys nothing, and denies nothing the origin was not already refusing. Asking twice owes it once. There is deliberately no deletion and no legal hold here \u2014 destroying bytes would destroy what an appeal needs, and a hold placed with no enforcement record behind it would be an unaudited action on evidence.',
  },
  {
    method: 'get',
    operationId: 'getAdminOverview',
    path: apiRoutePaths.adminOverview,
    responses: {
      '200': {
        description:
          'What is waiting for somebody right now, counted by the platform over whole tables rather than over a page: unclaimed and open cases, appeals awaiting an answer, creators under suspension, accounts under restriction, commercial records needing a person, live claims, and payouts awaiting a provider answer. Plus open cases by queue and by priority, and when the oldest unsettled case was opened.',
        schemaName: 'AdminOverviewResponse',
      },
      ...adminAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Every figure is a total over the whole table, which is the reason this route exists rather than the console adding up what a paged list happened to return. A zero is published rather than omitted, because "nothing is waiting" and "the signal stopped arriving" are different answers. There is no rate, no trend, no growth figure, and no derived metric anywhere in the response.',
  },
  {
    method: 'get',
    operationId: 'listAdminAccounts',
    path: apiRoutePaths.adminAccounts,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum accounts to return', name: 'pageSize' },
      {
        description:
          'Restrict to one account lifecycle status; omit for every account not in good standing',
        name: 'status',
      },
      {
        description:
          'One account by its exact identifier, for an operator who already holds one',
        name: 'accountId',
      },
    ],
    responses: {
      '200': {
        description:
          'Consumer accounts in operational terms, newest first, with the whole population counted by status. Lifecycle, the coarse reason USERS publishes for it, and region \u2014 no name, no handle, no contact detail, no profile, and no locale.',
        schemaName: 'AdminAccountListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Not a people browser. With no status asked for, this returns only accounts the platform has itself decided are not in good standing \u2014 an enforcement work list bounded by the platform\u2019s own decisions rather than by a search box \u2014 and there is no search over anything a person wrote or is called. An operator who already holds an identifier may read that one account exactly.',
  },
  {
    method: 'get',
    operationId: 'listAdminPayments',
    path: apiRoutePaths.adminBillingPayments,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum payments to return', name: 'pageSize' },
      { description: 'Restrict to one payment state', name: 'state' },
    ],
    responses: {
      '200': {
        description:
          'Payments newest first, with amount, currency, state, what was sold, the provider that holds it, and the reference that provider quotes.',
        schemaName: 'AdminPaymentListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'No payer. A payment list keyed by who paid would be a purchase history for every person on the platform; what an operator answering for a payment actually turns on is the payment\u2019s own identifier and the provider\u2019s reference.',
  },
  {
    method: 'get',
    operationId: 'getAdminPayment',
    path: apiRoutePaths.adminBillingPayment,
    requestQuery: [{ description: 'The payment to read', name: 'paymentId' }],
    responses: {
      '200': {
        description:
          'One payment with every reversal and every claim recorded against it, so the money that came in and the money that went back are on one screen.',
        schemaName: 'AdminPaymentDetailResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'An exact-reference read for an operator who already holds a payment identifier. It publishes provenance \u2014 what was charged, what went back, and what somebody\u2019s bank is claiming \u2014 and nothing about the payer.',
  },
  {
    method: 'get',
    operationId: 'listAdminPayouts',
    path: apiRoutePaths.adminPayouts,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      {
        description: 'Maximum payout instructions to return',
        name: 'pageSize',
      },
      { description: 'Restrict to one payout state', name: 'state' },
      { description: 'Restrict to one creator', name: 'creatorId' },
    ],
    responses: {
      '200': {
        description:
          'Payout instructions newest first, with amount, currency, state, the creator whose book they left, the provider holding them, and the reference that provider quotes.',
        schemaName: 'AdminPayoutListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A read and only a read: nothing in this API releases, retries, or cancels a payout on an operator\u2019s word. No recipient reference, no bank detail, and no account name appears \u2014 all three are forbidden in an operational view and none of them helps answer why a payout is stuck.',
  },
  {
    method: 'get',
    operationId: 'listAdminClubs',
    path: apiRoutePaths.adminClubs,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum clubs to return', name: 'pageSize' },
      { description: 'Restrict to one creator', name: 'creatorId' },
      {
        description:
          'One club by identifier, which also returns that club\u2019s memberships',
        name: 'clubId',
      },
    ],
    responses: {
      '200': {
        description:
          'Clubs newest first, with the creator that owns each, its lifecycle, and how many memberships are in each state. Asking for one club by identifier also returns that club\u2019s memberships, by identifier and state.',
        schemaName: 'AdminClubListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A membership is published by its own identifier and its state, and never by who holds it. This exists so the one membership operation an operator has has a target they can find: before it, the console asked for an identifier it could not show them, which is a capability that is real in the API and unreachable in the product.',
  },
  {
    method: 'get',
    operationId: 'listAdminAudit',
    path: apiRoutePaths.adminAudit,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this record',
        name: 'cursor',
      },
      { description: 'Maximum entries to return', name: 'pageSize' },
      {
        description:
          'Which record to read: security for AUTH\u2019s event log, decision for settled moderation decisions',
        name: 'stream',
      },
    ],
    responses: {
      '200': {
        description:
          'What has happened, newest first, from one of the two records that keep such things: AUTH\u2019s enumerated security event log, or TRUST & SAFETY\u2019s settled decisions with the operator session that made each.',
        schemaName: 'AdminAuditResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'Append-only records, read only. A security event carries no account, because an operator reading an authentication trail does not need to know whose it is and a console that joined it would be an account browser. A decision carries the session that made it rather than a person\u2019s name.',
  },
  {
    method: 'get',
    operationId: 'getAdminFinancialState',
    path: apiRoutePaths.adminBillingState,
    responses: {
      '200': {
        description:
          "The platform's money in operational terms: how many operations, reversals, claims, subscriptions, and payout instructions are in each state; what is currently being claimed back and what is still owed to creators, per currency; what needs a person to look at it; and which capability seams are open. Counts and per-currency totals only — no provider reference, no recipient reference, no bank detail, no identity document, and no consumer contact detail.",
        schemaName: 'AdminFinancialStateResponse',
      },
      ...adminAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A read and only a read. There is no operation anywhere in this API that edits a financial row; the one financial action an operator has is issuing a refund, and that goes through BILLING\u2019s own service with an operator\u2019s authority. Reporting the configured adapter name rather than a boolean is what makes "off" and "off because nobody has approved one" distinguishable.',
  },
  {
    method: 'get',
    operationId: 'listAdminDisputes',
    path: apiRoutePaths.adminBillingDisputes,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this queue',
        name: 'cursor',
      },
      { description: 'Maximum disputes to return', name: 'pageSize' },
      {
        description:
          'Restrict to live claims awaiting an answer, or omit for the whole history',
        name: 'open',
      },
    ],
    responses: {
      '200': {
        description:
          'Disputes an operator has to answer, soonest deadline first, with the provider reference each claim has to be quoted by.',
        schemaName: 'AdminDisputeListResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A read and only a read. There is no evidence submission here: whether VELORA may submit evidence, in what form, and through which provider is unresolved, and a control that accepted a file and did nothing with it would be worse than its absence.',
  },
  {
    method: 'post',
    operationId: 'issueRefund',
    path: apiRoutePaths.adminBillingRefunds,
    requestHeaders: [idempotencyHeader],
    requestSchemaName: 'IssueRefundRequest',
    responses: {
      '201': {
        description:
          'The refund operation exists. It is committed before the provider is contacted, so a process that dies between the two leaves something reconciliation can resolve rather than a reversal nobody has a record of. A replayed idempotency key answers with the operation it already created.',
        schemaName: 'RefundResponse',
      },
      ...adminAuthenticationResponses,
      '409': {
        description: `The reversal could not be recorded: the payment did not settle, the currency is not the currency it was captured in, the refunds outstanding against it would exceed what was captured, or the same idempotency key was reused for a different amount. The body is an ApiError with code ${productErrorCodes.conflict} or ${productErrorCodes.idempotencyMismatch}.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': commerceUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'There is no consumer-facing refund path anywhere in the API, because refund eligibility is unresolved commercial policy and a self-service control would be a promise nobody approved. This operator route exists so the accounting is exercisable; in a deployed environment it refuses, because no payment provider is approved and no Platform Admin session can hold the assurance it requires.',
  },
  {
    method: 'get',
    operationId: 'getDiscoveryCandidates',
    path: apiRoutePaths.discoveryCandidates,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this feed',
        name: 'cursor',
      },
      { description: 'Maximum candidates to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          'Candidates the caller is currently eligible to see, in the deterministic V1 order.',
        schemaName: 'DiscoveryFeedResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The caller is not eligible to browse: the account is not active, or the minimum discoverable profile is incomplete. The body is an ApiError with code ${productErrorCodes.accountNotEligible}.`,
        schemaName: 'ApiError',
      },
      '422': {
        description: `The cursor or page size failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Eligibility is a fixed conjunction of account, adult, profile, discoverability, availability, pair, and language conditions. Ordering is deterministic and explainable, and nothing purchasable affects either.',
  },
  {
    method: 'get',
    operationId: 'getDiscoveryPerson',
    path: apiRoutePaths.discoveryPerson,
    requestQuery: [{ description: 'The person to read', name: 'personId' }],
    responses: {
      '200': {
        description:
          'The same minimized projection a card carries, for somebody the caller currently holds a reason to see.',
        schemaName: 'DiscoveryPersonResponse',
      },
      ...consumerAuthenticationResponses,
      '409': introductionNotEligibleResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Opens one person, on exactly the rule that decides whether their photograph may be shown: a live introduction in either direction, or somebody the caller may currently be shown, both conditioned on current safety eligibility. It publishes nothing a discovery card does not already publish — a page about somebody else is not a licence to say more about them — and an account nobody may see answers exactly as one that does not exist.',
  },
  {
    method: 'post',
    operationId: 'passDiscoveryCandidate',
    path: apiRoutePaths.discoveryPasses,
    requestSchemaName: 'DiscoveryPassRequest',
    responses: {
      '200': {
        description:
          'The pair is suppressed from ordinary discovery until the returned instant. Repeating the call renews the window.',
        schemaName: 'DiscoveryPassResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The caller is not eligible to act on candidates. The body is an ApiError with code ${productErrorCodes.accountNotEligible}.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Private. The other person is never notified, no reputation is derived from it, and it is not a block: a block is a stronger, indefinite suppression owned by Trust and Safety.',
  },
  {
    method: 'get',
    operationId: 'listIntroductions',
    path: apiRoutePaths.discoveryIntroductions,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum introductions to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "The caller's own live introductions, newest first, with the other person in the same minimized shape discovery uses.",
        schemaName: 'IntroductionListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': introductionNotEligibleResponse,
      '422': {
        description: `The cursor or page size failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'createIntroductionSignal',
    path: apiRoutePaths.discoveryIntroductions,
    requestSchemaName: 'CreateIntroductionRequest',
    responses: {
      '200': {
        description:
          'The signal was recorded. The introduction is mutual when the other person had already signalled, and pending otherwise. Repeating the call returns the same introduction unchanged.',
        schemaName: 'Introduction',
      },
      ...consumerAuthenticationResponses,
      '409': introductionNotEligibleResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'The candidate is not currently introducible by this caller. Absent and not-permitted are deliberately indistinguishable, so nothing is disclosed about another account.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'A mutual introduction requires both people to opt in independently. Two simultaneous reciprocal signals produce exactly one introduction.',
  },
  {
    method: 'get',
    operationId: 'getLiveState',
    path: apiRoutePaths.liveSessions,
    responses: {
      '200': {
        description:
          'Everything a live surface renders, in one authoritative answer: admission, whether the caller is idle, searching, matched, or ended, and the current encounter when there is one. It carries no count of who is waiting or who is online, because no presence projection exists and a number here would be invented.',
        schemaName: 'LiveStateResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'The one authoritative read behind live discovery. A client that missed a change asks this rather than assembling state from several endpoints.',
  },
  {
    method: 'post',
    operationId: 'startLiveSearch',
    path: apiRoutePaths.liveSessions,
    requestSchemaName: 'LiveSearchRequest',
    responses: {
      '200': {
        description:
          'Live state after entering the pool: searching, or matched when somebody eligible was already waiting. Repeating the request while already searching or matched returns the current state rather than opening a second search.',
        schemaName: 'LiveStateResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The account may not take part in live discovery right now, or a live-discovery bound has been reached — code ${productErrorCodes.rateLimited} in that last case. Which eligibility predicate refused is deliberately not disclosed.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': liveDiscoveryUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Enters the random matching pool. The request names a medium and never a person; the server decides who, if anybody, the caller meets.',
  },
  {
    method: 'post',
    operationId: 'advanceLiveEncounter',
    path: apiRoutePaths.liveTransitions,
    requestSchemaName: 'LiveEncounterActionRequest',
    responses: {
      '200': {
        description:
          'Live state after the named encounter was ended and searching resumed. An encounter that had already ended is not an error: the answer is current state, because pressing Next twice is ordinary.',
        schemaName: 'LiveStateResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The account may not take part in live discovery right now. The body is an ApiError.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': liveDiscoveryUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Next: ends the named encounter and resumes searching. Naming the encounter is what stops a late Next ending the encounter that replaced it.',
  },
  {
    method: 'post',
    operationId: 'leaveLiveDiscovery',
    path: apiRoutePaths.liveDepartures,
    responses: {
      '200': {
        description:
          'Live state after leaving: idle, with any live encounter ended and any live session terminated. Repeating it is safe.',
        schemaName: 'LiveStateResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Leaves live discovery entirely. It takes no body: there is one place a person can be, and the server already knows which.',
  },
  {
    method: 'get',
    operationId: 'getWallet',
    path: apiRoutePaths.wallet,
    responses: {
      '200': {
        description:
          'Everything a wallet surface renders: whether this environment has a coin ledger at all, what the caller holds and what is committed, the paid matching window they currently hold if any, and what one costs. It carries no count of matching people, no estimated wait, and no probability, because none of those is a number this platform has.',
        schemaName: 'WalletStateResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'The one authoritative read behind coins. The balance a client holds is a rendering; this is the balance.',
  },
  {
    method: 'post',
    operationId: 'activateLivePreference',
    path: apiRoutePaths.walletLivePreference,
    requestSchemaName: 'ActivateLivePreferenceRequest',
    responses: {
      '200': {
        description:
          'Wallet state after opening a bounded window in which the matcher narrows to the named declared region. The coins it costs move from available to reserved; they are charged when the window produces an encounter and returned in full when it does not. Repeating the request while a window is open returns the open one rather than charging again. It narrows a search and authorizes nothing: every eligibility, standing, block, and enforcement predicate is asked identically whether or not anybody paid.',
        schemaName: 'WalletStateResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `A window is already open, the balance will not cover it — code ${productErrorCodes.insufficientFunds} in that case — or an activation bound has been reached, code ${productErrorCodes.rateLimited}. A refusal for balance says only that: how much is missing is not disclosed, because a sequence of refusals would otherwise read somebody's balance.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': {
        description: `No coin ledger exists in this environment, so nothing can be activated. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}.`,
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Opens a paid, bounded window of narrowed matching. The request names declared preferences and never a price, a duration, or a person.',
  },
  {
    method: 'post',
    operationId: 'broadenLivePreference',
    path: apiRoutePaths.walletLivePreferenceBroadening,
    requestSchemaName: 'BroadenLivePreferenceRequest',
    responses: {
      '200': {
        description:
          'Wallet state after widening the window already in force. Nothing is charged and nothing is refunded: a wider search cannot cost more than the one already paid for, and the window keeps the time it has left. The body names the preferences that should remain.',
        schemaName: 'WalletStateResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `No window is currently in force. The body is an ApiError with code ${productErrorCodes.conflict}.`,
        schemaName: 'ApiError',
      },
      '422': {
        description:
          'The request is not a widening. Adding a preference, or swapping one value for another, could cost more than what was paid and is sold as a new window instead; emptying the selection entirely is a cancellation and has its own operation.',
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
      '503': {
        description: `No coin ledger exists in this environment. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}.`,
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Widens the window already in force, at no charge. It can only ever ask for less, which is why it is free.',
  },
  {
    method: 'post',
    operationId: 'cancelLivePreference',
    path: apiRoutePaths.walletLivePreferenceCancellation,
    responses: {
      '200': {
        description:
          'Wallet state after closing the window in force. A window that never found anybody returns its coins in full: changing your mind before it produced anything is not a consumption of it. A window that already found somebody was charged then, returns nothing now, and gives up only the time it had left. Repeating it is safe and cancelling nothing is not an error.',
        schemaName: 'WalletStateResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
      '503': {
        description: `No coin ledger exists in this environment. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}.`,
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Closes the caller\u2019s open matching window and returns the coins it held.',
  },
  {
    method: 'post',
    operationId: 'redeemAndroidCoinPurchase',
    path: apiRoutePaths.walletAndroidPurchases,
    requestSchemaName: 'AndroidCoinPurchaseRequest',
    responses: {
      '200': {
        description:
          'Wallet state after a purchase the server verified with the store. The token is evidence and never authority: the coin amount comes from the platform\u2019s own catalogue keyed by the product the store confirmed, and the credit is idempotent on the store\u2019s own purchase identity, so a redelivered acknowledgement or a reinstall credits once.',
        schemaName: 'WalletStateResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The store did not confirm a completed purchase of that product for that token. The body is an ApiError, and it does not say which part failed.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': {
        description: `No Android acquisition channel is configured for this environment, so no purchase can be verified. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}. This is the deployed answer: no Play Console project, product identifier, or service-account credential exists.`,
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Redeems a verified Android store purchase for coins. There is no field in which a client can say what a purchase was worth.',
  },
  {
    method: 'post',
    operationId: 'grantCoins',
    path: apiRoutePaths.walletGrants,
    requestSchemaName: 'CoinGrantRequest',
    responses: {
      '200': {
        description:
          'Wallet state after a development grant. It posts to the same ledger a purchase does and is idempotent on the supplied reference, so a retry credits once; what makes it a grant rather than a purchase is the reason recorded against the transaction.',
        schemaName: 'WalletStateResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': {
        description: `Refused. This operation exists for local development and is answered with an ApiError carrying code ${productErrorCodes.dependencyUnavailable} in every environment other than local and test, and wherever no coin ledger exists.`,
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Credits coins without a purchase. Available only where the environment is local or test; refused everywhere else.',
  },
  {
    method: 'get',
    operationId: 'getLiveMessages',
    path: apiRoutePaths.liveMessages,
    requestQuery: [
      {
        description: 'The encounter whose messages to read',
        name: 'encounterId',
        required: true,
      },
    ],
    responses: {
      '200': {
        description:
          'Messages exchanged inside that encounter, oldest first. These belong to the encounter and never to a conversation: a temporary meeting does not become Inbox history.',
        schemaName: 'LiveMessageListResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': liveEncounterNotFoundResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'sendLiveMessage',
    path: apiRoutePaths.liveMessages,
    requestSchemaName: 'SendLiveMessageRequest',
    responses: {
      '200': {
        description:
          'The encounter\u2019s messages after the send, including the one just written. A repeated client message identifier returns the same message rather than writing a second.',
        schemaName: 'LiveMessageListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The encounter is over, or the pair may no longer interact. The body is an ApiError, and it never says which.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': liveEncounterNotFoundResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Writes into the live encounter. Nothing written here reaches the Inbox; durable messaging begins at mutual connection and not before.',
  },
  {
    method: 'post',
    operationId: 'sendLiveReaction',
    path: apiRoutePaths.liveReactions,
    requestSchemaName: 'SendLiveReactionRequest',
    responses: {
      '200': {
        description:
          'The encounter\u2019s lines after the reaction, in the same shape a message is read in. A reaction is one of a small closed set and never free text.',
        schemaName: 'LiveMessageListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The encounter is over, or the pair may no longer interact. The body is an ApiError, and it never says which.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': liveEncounterNotFoundResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Sends one of the six reactions into the live encounter. It costs nothing and credits nobody: gifting is deliberately not attached to a random encounter.',
  },
  {
    method: 'post',
    operationId: 'createLiveInvitation',
    path: apiRoutePaths.liveInvitations,
    requestSchemaName: 'CreateLiveInvitationRequest',
    responses: {
      '200': {
        description:
          'This person\u2019s requests to meet after the new one was recorded, in both directions. Repeating it against the same person returns the existing request rather than writing a second.',
        schemaName: 'LiveInvitationListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The pair may not meet right now, or a bound was reached. The body is an ApiError, and it never says which.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No such person, or nobody this caller holds a reason to ask. Deliberately the same answer, so an identifier cannot be probed.',
        schemaName: 'ApiError',
      },
      '503': liveDiscoveryUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Asks one person to meet live. It promises a request, never a connection: the two still have to be here at the same time, and every eligibility, standing, and safety predicate is asked again when they are.',
  },
  {
    method: 'post',
    operationId: 'respondToLiveInvitation',
    path: apiRoutePaths.liveInvitationResponses,
    requestSchemaName: 'RespondToLiveInvitationRequest',
    responses: {
      '200': {
        description:
          'This person\u2019s requests to meet after the answer. Accepting does not itself open a live session; it makes the pair the matcher\u2019s first choice once both are here.',
        schemaName: 'LiveInvitationListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The request is no longer answerable, or this caller is not the side entitled to that answer. The body is an ApiError, and it never says which.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No such request, or one belonging to two other people. Deliberately the same answer.',
        schemaName: 'ApiError',
      },
      '503': liveDiscoveryUnavailableResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Accepts, declines, or withdraws a request to meet live. Accept is only the recipient\u2019s to send and cancel only the sender\u2019s.',
  },
  {
    method: 'post',
    operationId: 'connectInLiveEncounter',
    path: apiRoutePaths.liveConnections,
    requestSchemaName: 'LiveEncounterActionRequest',
    responses: {
      '200': {
        description:
          'The relationship after this person signalled: requested, or connected when the other person had already signalled independently. A single tap never produces a mutual connection.',
        schemaName: 'LiveConnectionResponse',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The pair may not be introduced right now, or the caller\u2019s own standing does not permit it. The body is an ApiError, and it never says which.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': liveEncounterNotFoundResponse,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Connect: signals this person\u2019s own interest through the same introduction contract Discover uses, so a live meeting and a browsed one produce one relationship and one conversation.',
  },
  {
    method: 'post',
    operationId: 'applyLiveSimulation',
    path: apiRoutePaths.liveSimulation,
    requestSchemaName: 'LiveSimulationRequest',
    responses: {
      '200': {
        description:
          'Whether the deterministic stand-in applied the named scenario. Each scenario drives a seeded local account through the same published service methods a person\u2019s client calls.',
        schemaName: 'LiveSimulationResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '503': {
        description: `No live-discovery simulation adapter is configured, which is the only behaviour staging and production may have. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}. This status is also the shared capacity refusal, with code ${apiErrorCodes.serviceUnavailable}; the code tells the two apart.`,
        headers: { [retryAfterResponseHeader]: retryAfterHeader },
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Local development only. Configuration refuses the simulation adapter outside local and test, so this endpoint answers 503 everywhere else.',
  },
  {
    method: 'post',
    operationId: 'createCall',
    path: apiRoutePaths.rtcCalls,
    requestSchemaName: 'CreateCallRequest',
    responses: {
      '200': {
        description:
          'The call this invitation opened, or the live call the pair already had. A second invitation while one is live returns that one rather than opening a second.',
        schemaName: 'Call',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The pair may not talk right now, the caller\u2019s own standing does not permit calling, or a calling bound has been reached — code ${productErrorCodes.rateLimited} in that last case. Which of the first two it is, is deliberately not disclosed, and a bound never reports how much of it remains.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No mutual introduction of the caller matches that identifier. A pending, closed, expired, or someone else\u2019s introduction is indistinguishable from one that does not exist.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'A call is placed against a mutual introduction and against nothing else. The request names the relationship; the server decides who the other person is, so no caller can choose whom it calls.',
  },
  {
    method: 'get',
    operationId: 'getCall',
    path: apiRoutePaths.rtcCalls,
    requestQuery: [
      { description: 'The call to read', name: 'callId', required: true },
    ],
    responses: {
      '200': {
        description: 'The call, as one of its two participants sees it.',
        schemaName: 'Call',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No call of the caller\u2019s matches that identifier. A call between two other people is indistinguishable from one that does not exist.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary: 'Reads one call the caller is a participant of.',
  },
  {
    method: 'post',
    operationId: 'acceptCall',
    path: apiRoutePaths.rtcCallAcceptance,
    requestSchemaName: 'CallActionRequest',
    responses: {
      '200': {
        description: 'The answered call.',
        schemaName: 'Call',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The invitation is no longer answerable: it expired, it was withdrawn, the caller is not its recipient, or the pair may no longer talk. Eligibility is composed again at this moment rather than inherited from the invitation.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description: 'No call of the caller\u2019s matches that identifier.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Answers a ringing call. Only its recipient may, and only while the invitation stands.',
  },
  {
    method: 'post',
    operationId: 'rejectCall',
    path: apiRoutePaths.rtcCallRejection,
    requestSchemaName: 'CallActionRequest',
    responses: {
      '200': { description: 'The declined call.', schemaName: 'Call' },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The invitation is no longer answerable, or the caller is not its recipient.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description: 'No call of the caller\u2019s matches that identifier.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary: 'Declines a ringing call. Only its recipient may.',
  },
  {
    method: 'post',
    operationId: 'cancelCall',
    path: apiRoutePaths.rtcCallCancellation,
    requestSchemaName: 'CallActionRequest',
    responses: {
      '200': { description: 'The withdrawn call.', schemaName: 'Call' },
      ...consumerAuthenticationResponses,
      '409': {
        description:
          'The call has already been answered or ended, or the caller did not place it.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description: 'No call of the caller\u2019s matches that identifier.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Withdraws an invitation before it is answered. Only the person who placed it may.',
  },
  {
    method: 'post',
    operationId: 'endCall',
    path: apiRoutePaths.rtcCallTermination,
    requestSchemaName: 'CallActionRequest',
    responses: {
      '200': {
        description:
          'The ended call. Repeating the call returns the same ending rather than an error, because a retried hang-up is the ordinary case.',
        schemaName: 'Call',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: 'The call was never answered, so there is nothing to end.',
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description: 'No call of the caller\u2019s matches that identifier.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary: 'Hangs up. Either participant may, and doing it twice is safe.',
  },
  {
    method: 'post',
    operationId: 'issueJoinAuthorization',
    path: apiRoutePaths.rtcCallJoinAuthorization,
    requestSchemaName: 'CallActionRequest',
    responses: {
      '200': {
        description:
          'This participant\u2019s means of joining, for this call only, expiring in minutes. It is a secret: it is not stored by the server, must not be persisted by a client beyond the call, and must never be logged.',
        schemaName: 'JoinAuthorization',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The call does not admit anybody right now. Three different facts share this status and are told apart by their code. ${productErrorCodes.actionNotPermitted}: the call was never answered, it has ended, or the pair may no longer talk — a decision, and asking again will not change it. ${productErrorCodes.conflict}: this caller may join and the provider room does not exist yet, which is not about them and does differ moments later, so a client re-reads and asks again. ${productErrorCodes.rateLimited}: a minting bound has been reached. Eligibility is composed again at issuance rather than inherited from the acceptance, the readiness answer is reachable only after every eligibility predicate has passed, and a bound never reports how much of it remains.`,
        schemaName: 'ApiError',
      },
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description: 'No call of the caller\u2019s matches that identifier.',
        schemaName: 'ApiError',
      },
      '503': {
        description:
          'No RTC provider is approved, so there is nothing to join. Nothing about the caller or the call is wrong, and the answer may differ later.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Issues one participant\u2019s short-lived means of joining. The participant is derived from the authenticated principal, so nobody can obtain another person\u2019s credential.',
  },
  {
    method: 'post',
    operationId: 'createConversation',
    path: apiRoutePaths.messagingConversations,
    requestSchemaName: 'CreateConversationRequest',
    responses: {
      '200': {
        description:
          'The conversation authorized by that mutual introduction. Repeating the call returns the same conversation rather than creating a second one.',
        schemaName: 'Conversation',
      },
      ...consumerAuthenticationResponses,
      '409': messagingNotPermittedResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No mutual introduction of the caller matches that identifier. A pending, closed, expired, or someone else’s introduction is indistinguishable from one that does not exist.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'A conversation is created from a mutual introduction and from nothing else. There is no other route into messaging a stranger.',
  },
  {
    method: 'get',
    operationId: 'listConversations',
    path: apiRoutePaths.messagingConversations,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum conversations to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "The caller's own conversations, most recently active first. A conversation the caller is no longer permitted to communicate in is absent.",
        schemaName: 'ConversationListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': messagingNotPermittedResponse,
      '422': {
        description: `The cursor or page size failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'listMessages',
    path: apiRoutePaths.messagingMessages,
    requestQuery: [
      { description: 'Conversation to read', name: 'conversationId' },
      {
        description: 'Opaque backward position in this conversation',
        name: 'cursor',
      },
      { description: 'Maximum messages to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          'Messages in the conversation, newest first. Paging is keyset on the server-assigned sequence, so a page boundary cannot move.',
        schemaName: 'MessageListResponse',
      },
      ...consumerAuthenticationResponses,
      '409': messagingNotPermittedResponse,
      '422': {
        description: `The conversation identifier, cursor, or page size failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
      '404': {
        description:
          'The caller is not a participant in that conversation, or it does not exist. The two are deliberately indistinguishable.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Message bodies are stored in a form the server can read so moderation and reporting are possible. Messaging is not end-to-end encrypted and is never described as such.',
  },
  {
    method: 'post',
    operationId: 'sendMessage',
    path: apiRoutePaths.messagingMessages,
    requestSchemaName: 'SendMessageRequest',
    responses: {
      '200': {
        description:
          'The message as it was persisted, with its server-assigned sequence. Repeating a send with the same client message identifier returns the original message and creates nothing.',
        schemaName: 'Message',
      },
      ...consumerAuthenticationResponses,
      '409': messageSendConflictResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'The caller is not a participant in that conversation, or it does not exist.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Membership and current safety eligibility are revalidated at the moment of the send, never taken from the page the client is holding.',
  },
  {
    method: 'post',
    operationId: 'blockConsumer',
    path: apiRoutePaths.safetyBlocks,
    requestSchemaName: 'BlockRequest',
    responses: {
      '200': {
        description:
          'The block that now stands. Repeating the call returns the same block and changes nothing. The other person is never told.',
        schemaName: 'Block',
      },
      ...consumerAuthenticationResponses,
      '422': {
        description: `The target is the caller, or is not an account this platform has. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Available to every authenticated consumer regardless of admission standing. A person must be able to stop somebody contacting them even when their own account is restricted.',
  },
  {
    method: 'get',
    operationId: 'listBlocks',
    path: apiRoutePaths.safetyBlocks,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum blocks to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "The caller's own live blocks, newest first. It never shows who has blocked the caller.",
        schemaName: 'BlockListResponse',
      },
      ...consumerAuthenticationResponses,
      '422': {
        description: `The cursor or page size failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'removeBlock',
    path: apiRoutePaths.safetyBlockRemoval,
    requestSchemaName: 'BlockRequest',
    responses: {
      '200': {
        description:
          'The block is withdrawn. The record that it was made and withdrawn stays, and the other person is not told either way.',
        schemaName: 'Block',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'The caller holds no live block of that account. Absent and never-made are indistinguishable.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'getSafetyStanding',
    path: apiRoutePaths.consumerSafetyStanding,
    responses: {
      '200': {
        description:
          'What is currently in force against the caller and why, with the redress available. Only decisions that imposed something and that nothing has replaced: a restriction that was lifted is not something somebody is under.',
        schemaName: 'SafetyStandingResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      "The category and the scope, and nothing else. The review's finding, the evidence, the reviewer, and anything that could identify a reporter have no field in this response, so nothing can carry them.",
  },
  {
    method: 'post',
    operationId: 'createAppeal',
    path: apiRoutePaths.consumerSafetyAppeals,
    requestSchemaName: 'CreateAppealRequest',
    responses: {
      '200': {
        description:
          'The complaint as its own appellant may see it. Its state and its dates, and never the reviewer, the outcome record, or the statement they wrote.',
        schemaName: 'Appeal',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The caller already has a live complaint about this decision, or the published window has closed. The body is an ApiError with code ${productErrorCodes.conflict}. Withdrawing an existing complaint frees the caller to make another; what is refused is contesting one decision twice at once.`,
        schemaName: 'ApiError',
      },
      '422': {
        description: `The body failed contract validation, or this caller may not complain about this decision. The body is an ApiError with code ${productErrorCodes.validationFailed}. A decision about somebody else, a dismissal of somebody else's report, and a decision of a kind nobody may contest answer identically, so probing this path enumerates nothing.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'There is no field saying which kind of appellant the caller is. Who they are to this decision — the person it was about, or the person whose report was dismissed — is derived on the server from the decision and the case, because a client-declared role is a client-authoritative fact about entitlement.',
  },
  {
    method: 'get',
    operationId: 'listOwnAppeals',
    path: apiRoutePaths.consumerSafetyAppeals,
    responses: {
      '200': {
        description:
          "Complaints the caller made, newest first. There is no route to anybody else's.",
        schemaName: 'AppealListResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'The state and the dates. An appellant already knows what they wrote, and echoing stored text back over the API turns a record into a readable store.',
  },
  {
    method: 'post',
    operationId: 'withdrawAppeal',
    path: apiRoutePaths.consumerSafetyAppealWithdrawal,
    requestSchemaName: 'WithdrawAppealRequest',
    responses: {
      '200': {
        description:
          'The complaint is withdrawn and the record of it stays. The caller is free to complain about the same decision again.',
        schemaName: 'Appeal',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `The complaint has already been answered or already withdrawn. The body is an ApiError with code ${productErrorCodes.conflict}.`,
        schemaName: 'ApiError',
      },
      '422': {
        description: `The body failed contract validation, or the complaint is not the caller's. The body is an ApiError with code ${productErrorCodes.validationFailed}. Somebody else's complaint is answered exactly as one that does not exist.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Withdrawing leaves the record. Both facts matter: a complaint was made, and the person decided not to pursue it.',
  },
  {
    method: 'post',
    operationId: 'createReport',
    path: apiRoutePaths.safetyReports,
    requestSchemaName: 'CreateReportRequest',
    responses: {
      '200': {
        description:
          'The report as its own reporter may see it. Repeating the call with the same client report identifier returns the original and creates nothing.',
        schemaName: 'Report',
      },
      ...consumerAuthenticationResponses,
      '409': {
        description: `Too many reports from this account in the current window. The body is an ApiError with code ${productErrorCodes.rateLimited}. No report already made is removed or altered.`,
        schemaName: 'ApiError',
      },
      '422': {
        description: `The body failed contract validation, or the subject is the caller or is not an account this platform has. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
    summary:
      'Reporter identity, narrative, and every internal rationale are absent from every response this API can produce. The person reported is never told that a report exists.',
  },
  {
    method: 'get',
    operationId: 'listOwnReports',
    path: apiRoutePaths.safetyReports,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum reports to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "Reports the caller filed, newest first. There is no route to anybody else's, and no route that returns a reporter.",
        schemaName: 'ReportListResponse',
      },
      ...consumerAuthenticationResponses,
      '422': {
        description: `The cursor or page size failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'markConversationRead',
    path: apiRoutePaths.messagingConversationRead,
    requestSchemaName: 'MarkConversationReadRequest',
    responses: {
      '200': {
        description:
          'The read position after the update. It is monotonic: a position below the one already recorded is accepted and changes nothing.',
        schemaName: 'ConversationReadResponse',
      },
      ...consumerAuthenticationResponses,
      '409': messagingNotPermittedResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'The caller is not a participant in that conversation, or it does not exist.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'declineIntroduction',
    path: apiRoutePaths.discoveryIntroductionDecline,
    requestSchemaName: 'IntroductionReferenceRequest',
    responses: {
      '200': {
        description:
          'The pending introduction is closed. The other person is not told why, and the pair is suppressed from ordinary discovery for the usual window.',
        schemaName: 'Introduction',
      },
      ...consumerAuthenticationResponses,
      '409': introductionNotEligibleResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No pending introduction of the caller matches that identifier. Absent and not-permitted are indistinguishable.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'withdrawIntroduction',
    path: apiRoutePaths.discoveryIntroductionWithdrawal,
    requestSchemaName: 'IntroductionReferenceRequest',
    responses: {
      '200': {
        description:
          'The caller withdrew their own pending signal. Nothing is disclosed to the other person and no suppression is recorded.',
        schemaName: 'Introduction',
      },
      ...consumerAuthenticationResponses,
      '409': introductionNotEligibleResponse,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
      '404': {
        description:
          'No pending introduction the caller initiated matches that identifier.',
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'listNotifications',
    path: apiRoutePaths.notifications,
    requestQuery: [
      {
        description: 'Opaque forward-only position in this list',
        name: 'cursor',
      },
      { description: 'Maximum notifications to return', name: 'pageSize' },
    ],
    responses: {
      '200': {
        description:
          "The caller's own in-app notifications, newest first. Notices about a person the caller may no longer interact with are absent, and nothing about external delivery — attempts, provider state, or why a notice was suppressed — appears in this response.",
        schemaName: 'NotificationListResponse',
      },
      ...consumerAuthenticationResponses,
      '422': {
        description: `The cursor or page size failed contract validation. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'listNotificationPreferences',
    path: apiRoutePaths.notificationPreferences,
    responses: {
      '200': {
        description:
          "The caller's own effective notification preferences, one per category and channel the platform has an approved template for. A category nobody has expressed a preference about reports its default rather than being absent, and mandatory categories never appear because they are not offers.",
        schemaName: 'NotificationPreferencesResponse',
      },
      ...consumerAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'updateNotificationPreference',
    path: apiRoutePaths.notificationPreferences,
    requestSchemaName: 'UpdateNotificationPreferenceRequest',
    responses: {
      '200': {
        description:
          'The complete effective preference set after the change, so a client never has to merge one.',
        schemaName: 'NotificationPreferencesResponse',
      },
      ...consumerAuthenticationResponses,
      '422': {
        description: `The category and channel pairing is not one the platform sends on, or the category is mandatory and cannot be silenced. The body is an ApiError with code ${productErrorCodes.validationFailed}.`,
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'receiveNotificationProviderEvent',
    path: apiRoutePaths.notificationProviderEvents,
    responses: {
      '202': {
        description:
          'Recorded, not applied. Applying happens on a worker against a lease, so a provider\u2019s retry budget is never spent waiting for work this platform chose to do later. A redelivery gets the same answer as a first delivery, so a provider learns nothing about which of its events were already seen.',
        schemaName: 'ProviderEventAcknowledgement',
      },
      '401': {
        description:
          'One answer for a bad signature, a mutated body, an unknown event type, and an unparseable payload. Telling them apart would tell a forger which part to fix next.',
        schemaName: 'ApiError',
      },
      ...sharedErrorResponses,
      '503': {
        description: `Either no delivery provider is approved — in which case nothing is entitled to be calling this at all — or the instance has no capacity to begin the request. The body is an ApiError; ${apiErrorCodes.serviceUnavailable} distinguishes the capacity case, which carries Retry-After.`,
        schemaName: 'ApiError',
      },
    },
    security: apiSecurityRequirements.public,
    summary:
      'The configured provider signature over exact bytes is the credential. The endpoint stores provider/account/environment identity, a normalized feedback type, a body digest, and at most a receipt or device fingerprint; never the callback body, an address, or a device token.',
  },
  {
    method: 'post',
    operationId: 'registerPushDevice',
    path: apiRoutePaths.notificationDevices,
    requestSchemaName: 'RegisterPushDeviceRequest',
    responses: {
      '200': {
        description:
          "The registration now in force for this installation. The device token is never echoed back: the caller already has it, and a response carrying one would put a bearer credential into a log and a proxy cache. Registering the same token again is a heartbeat rather than a second device, and registering a token another account holds retires that account's registration, because a device can only be addressed for one person.",
        schemaName: 'PushDeviceListResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'revokePushDevice',
    path: apiRoutePaths.notificationDeviceRevocations,
    requestSchemaName: 'RevokePushDeviceRequest',
    responses: {
      '200': {
        description:
          "Everything still registered for the caller. Revoking an installation that was never registered succeeds silently, so this operation cannot be used to test whether one exists, and only the caller's own registrations are ever reachable.",
        schemaName: 'PushDeviceListResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'post',
    operationId: 'markNotificationsRead',
    path: apiRoutePaths.notificationsRead,
    requestSchemaName: 'MarkNotificationsReadRequest',
    responses: {
      '200': {
        description:
          'The identifiers that were the caller’s own and are now read. An identifier belonging to somebody else, or to nothing, is absent rather than refused, so this operation cannot be used to test whether a notification exists.',
        schemaName: 'NotificationReadResponse',
      },
      ...consumerAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieOrBearer,
  },
  {
    method: 'get',
    operationId: 'getAdminIdentityState',
    path: apiRoutePaths.adminIdentityState,
    responses: {
      '200': {
        description:
          'Identity Assurance platform health: configured adapter name and aggregate attempt, verified-inbox, current-expiry, reconciliation, and outbox state only. No subject identifier, owner reference, provider reference, provider payload, jurisdiction, document, biometric, or hosted URL appears here.',
        schemaName: 'AdminIdentityStateResponse',
      },
      ...adminAuthenticationResponses,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A privacy-minimized read for operational health. It is not a provider dashboard, does not begin or repair a verification, and does not make a verification, authorization, privacy, or retention decision.',
  },
  {
    method: 'get',
    operationId: 'getAdminIdentitySubject',
    path: apiRoutePaths.adminIdentitySubject,
    requestHeaders: [
      { name: adminExactActionAuthorizationHeader, required: true },
    ],
    requestQuery: [
      {
        description:
          'Identity subject owner domain; an exact opaque owner reference is required beside it.',
        name: 'ownerDomain',
        required: true,
      },
      {
        description:
          'Already-known opaque owner reference. This endpoint has no list, cursor, filter, or search parameter.',
        name: 'ownerReference',
        required: true,
      },
    ],
    responses: {
      '200': {
        description:
          'One exact subject: owner domain, bounded attempt/finding lifecycle, and current normalized evidence tips. The request reference is not echoed; the response excludes subject IDs, provider facts/references, callback bodies, reasons, jurisdiction, policy/threshold detail, documents, biometrics, and hosted URLs.',
        schemaName: 'AdminIdentitySubjectResponse',
      },
      ...adminAuthenticationResponses,
      '422': invalidProductInputResponse,
      ...sharedErrorResponses,
    },
    security: apiSecurityRequirements.cookieSession,
    summary:
      'A one-time, ADR-0017 exact-action-authorized read. The header binds only this owner domain/reference and the read is consumed once. There is no counterpart for identity search, list, export, raw evidence/provider payload, grant, refusal, override, revocation, deletion, or retry.',
  },
] as const;
