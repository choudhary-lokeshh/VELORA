import { z } from 'zod';

import {
  createCreatorAccountRequestSchema,
  creatorAccountResponseSchema,
  creatorHandleSchema,
  creatorOnboardingStateResponseSchema,
  creatorPolicyAcknowledgementRequestSchema,
  creatorProfilePublicationRequestSchema,
  creatorProfileResponseSchema,
  publicCreatorResponseSchema,
  saveCreatorProfileRequestSchema,
} from './creator.js';
import {
  createIntroductionRequestSchema,
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
  markNotificationsReadRequestSchema,
  notificationListResponseSchema,
  notificationReadResponseSchema,
} from './notifications.js';
import {
  conversationIdSchema,
  cursorSchema,
  pageSizeSchema,
} from './product.js';
import {
  blockListResponseSchema,
  blockRequestSchema,
  blockSchema,
  createReportRequestSchema,
  reportListResponseSchema,
  reportSchema,
} from './safety.js';
import {
  availabilityResponseSchema,
  profileMediaReferenceRequestSchema,
  profileMediaUploadResponseSchema,
  profileResponseSchema,
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
  localMobileSessionRequestSchema,
  localWebSessionRequestSchema,
  mobileRefreshRequestSchema,
  mobileTokenResponseSchema,
  recoveryCompletionRequestSchema,
  recoveryStartRequestSchema,
} from './auth.js';

export * from './auth.js';
export * from './creator.js';
export * from './discovery.js';
export * from './messaging.js';
export * from './notifications.js';
export * from './product.js';
export * from './profile.js';
export * from './safety.js';
export * from './users.js';

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
  consumerAccount: '/v1/users',
  consumerAccountSelf: '/v1/users/me',
  consumerAdultDeclaration: '/v1/users/me/onboarding/adult-declaration',
  consumerOnboarding: '/v1/users/me/onboarding',
  consumerPolicyAcknowledgements: '/v1/users/me/onboarding/acknowledgements',
  consumerAvailability: '/v1/users/me/availability',
  creatorAccount: '/v1/creator',
  creatorAccountSelf: '/v1/creator/me',
  creatorOnboarding: '/v1/creator/onboarding',
  creatorPolicyAcknowledgements: '/v1/creator/onboarding/acknowledgements',
  creatorProfile: '/v1/creator/profile',
  creatorProfilePublication: '/v1/creator/profile/publication',
  publicCreator: '/v1/creators',
  discoveryCandidates: '/v1/discovery/candidates',
  discoveryIntroductionDecline: '/v1/discovery/introductions/decline',
  discoveryIntroductionWithdrawal: '/v1/discovery/introductions/withdrawal',
  discoveryIntroductions: '/v1/discovery/introductions',
  discoveryPasses: '/v1/discovery/passes',
  consumerPreferences: '/v1/users/me/preferences',
  consumerProfile: '/v1/users/me/profile',
  consumerProfileMedia: '/v1/users/me/profile/media',
  consumerProfileMediaCompletion: '/v1/users/me/profile/media/completion',
  consumerProfileMediaRemoval: '/v1/users/me/profile/media/removal',
  liveness: '/v1/health/live',
  localMobileSession: '/v1/auth/local/mobile-sessions',
  localWebSession: '/v1/auth/local/web-sessions',
  messagingConversationRead: '/v1/messaging/conversations/read',
  messagingConversations: '/v1/messaging/conversations',
  messagingMessages: '/v1/messaging/messages',
  notifications: '/v1/notifications',
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
  AdultDeclarationRequest: adultDeclarationRequestSchema,
  ApiError: apiErrorSchema,
  ConsumerAccountResponse: consumerAccountResponseSchema,
  CreateConsumerAccountRequest: createConsumerAccountRequestSchema,
  CreateCreatorAccountRequest: createCreatorAccountRequestSchema,
  CreatorAccountResponse: creatorAccountResponseSchema,
  CreatorOnboardingStateResponse: creatorOnboardingStateResponseSchema,
  CreatorPolicyAcknowledgementRequest:
    creatorPolicyAcknowledgementRequestSchema,
  CreatorProfilePublicationRequest: creatorProfilePublicationRequestSchema,
  CreatorProfileResponse: creatorProfileResponseSchema,
  PublicCreatorResponse: publicCreatorResponseSchema,
  SaveCreatorProfileRequest: saveCreatorProfileRequestSchema,
  OnboardingStateResponse: onboardingStateResponseSchema,
  PolicyAcknowledgementRequest: policyAcknowledgementRequestSchema,
  AvailabilityResponse: availabilityResponseSchema,
  DiscoveryFeedResponse: discoveryFeedResponseSchema,
  DiscoveryPassRequest: discoveryPassRequestSchema,
  DiscoveryPassResponse: discoveryPassResponseSchema,
  CreateIntroductionRequest: createIntroductionRequestSchema,
  Introduction: introductionSchema,
  IntroductionListResponse: introductionListResponseSchema,
  IntroductionReferenceRequest: introductionReferenceRequestSchema,
  Conversation: conversationSchema,
  ConversationListResponse: conversationListResponseSchema,
  ConversationReadResponse: conversationReadResponseSchema,
  CreateConversationRequest: createConversationRequestSchema,
  MarkConversationReadRequest: markConversationReadRequestSchema,
  Message: messageSchema,
  MessageListResponse: messageListResponseSchema,
  SendMessageRequest: sendMessageRequestSchema,
  MarkNotificationsReadRequest: markNotificationsReadRequestSchema,
  NotificationListResponse: notificationListResponseSchema,
  NotificationReadResponse: notificationReadResponseSchema,
  Block: blockSchema,
  BlockListResponse: blockListResponseSchema,
  BlockRequest: blockRequestSchema,
  CreateReportRequest: createReportRequestSchema,
  Report: reportSchema,
  ReportListResponse: reportListResponseSchema,
  ProfileMediaReferenceRequest: profileMediaReferenceRequestSchema,
  SaveAvailabilityRequest: saveAvailabilityRequestSchema,
  ProfileMediaUploadResponse: profileMediaUploadResponseSchema,
  ProfileResponse: profileResponseSchema,
  SavePreferencesRequest: savePreferencesRequestSchema,
  SaveProfileRequest: saveProfileRequestSchema,
  AuthAcknowledgement: authAcknowledgementSchema,
  AuthSessionResponse: authSessionResponseSchema,
  LivenessResponse: livenessResponseSchema,
  LocalMobileSessionRequest: localMobileSessionRequestSchema,
  LocalWebSessionRequest: localWebSessionRequestSchema,
  MobileRefreshRequest: mobileRefreshRequestSchema,
  MobileTokenResponse: mobileTokenResponseSchema,
  ReadinessResponse: readinessResponseSchema,
  RecoveryCompletionRequest: recoveryCompletionRequestSchema,
  RecoveryStartRequest: recoveryStartRequestSchema,
} as const;

/**
 * Query parameters the contract may publish, defined once so the runtime and
 * the document validate the same bounds. They carry paging position and bounded
 * filters only; a credential never appears in a URL.
 */
export const apiQueryParameters = {
  conversationId: conversationIdSchema,
  cursor: cursorSchema,
  handle: creatorHandleSchema,
  pageSize: pageSizeSchema,
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

const mediaStorageUnavailableResponse = {
  description: `No approved media storage provider is configured for this environment, so the object could not be stored or inspected. The body is an ApiError with code ${productErrorCodes.dependencyUnavailable}. This status is also the shared capacity refusal, with code ${apiErrorCodes.serviceUnavailable}; the code tells the two apart.`,
  headers: { [retryAfterResponseHeader]: retryAfterHeader },
  schemaName: 'ApiError',
} as const;

export const apiOperations = [
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
] as const;
