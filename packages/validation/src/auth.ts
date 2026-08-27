import { z } from 'zod';

/**
 * AUTH wire vocabulary. These are contract values shared by the API and every
 * client, so they live here rather than inside the API application. Session
 * lifetimes, cookie attributes, and recovery limits are policy and stay in
 * ADR-0017; nothing in this file restates them.
 */

export const authAudiences = [
  'consumer_web',
  'creator_studio',
  'consumer_mobile',
  'platform_admin',
] as const;
export const authAudienceSchema = z.enum(authAudiences);
export type AuthAudience = z.infer<typeof authAudienceSchema>;

/** Audiences carried by an opaque browser session cookie. */
export const browserAuthAudiences = [
  'consumer_web',
  'creator_studio',
  'platform_admin',
] as const;
export const browserAuthAudienceSchema = z.enum(browserAuthAudiences);
export type BrowserAuthAudience = z.infer<typeof browserAuthAudienceSchema>;

/**
 * Audiences the development/test identity adapter is permitted to mint. The
 * Platform Admin audience is absent by construction: ADR-0017 requires
 * phishing-resistant authenticators for privileged access, and no such provider
 * exists, so no local adapter may produce Admin authority.
 */
export const localIdentityBrowserAudiences = [
  'consumer_web',
  'creator_studio',
] as const;
export const localIdentityBrowserAudienceSchema = z.enum(
  localIdentityBrowserAudiences,
);
export type LocalIdentityBrowserAudience = z.infer<
  typeof localIdentityBrowserAudienceSchema
>;

/**
 * Minimal assurance ladder. Each level has a trigger named by an accepted
 * authority: ordinary authentication, an additional independent signal, and the
 * phishing-resistant authenticator ADR-0017 mandates for privileged access.
 */
export const authAssuranceLevels = [
  'single_factor',
  'multi_factor',
  'phishing_resistant',
] as const;
export const authAssuranceSchema = z.enum(authAssuranceLevels);
export type AuthAssurance = z.infer<typeof authAssuranceSchema>;

/** Bounded free text a caller may supply. Kept small so auth is cheap to reject. */
const identitySubjectSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._@+-]+$/u);
const installationSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/u);
const opaqueTokenSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9._-]+$/u);

export const localWebSessionRequestSchema = z
  .object({
    audience: localIdentityBrowserAudienceSchema,
    deviceId: installationSchema.optional(),
    subject: identitySubjectSchema,
  })
  .strict();
export type LocalWebSessionRequest = z.infer<
  typeof localWebSessionRequestSchema
>;

/**
 * Request body for the local-test `platform_admin` session issuance route.
 *
 * No audience field: the audience is always `platform_admin` and the route
 * only exists so the condition can be verified server-side before the audience
 * is committed, without the client being able to select it. The verifier must
 * be `local-test-privileged` (ADR-0034) and the environment must be local or
 * test; staging and production cannot reach this route at all.
 */
export const localAdminSessionRequestSchema = z
  .object({
    deviceId: installationSchema.optional(),
    subject: identitySubjectSchema,
  })
  .strict();
export type LocalAdminSessionRequest = z.infer<
  typeof localAdminSessionRequestSchema
>;

export const localMobileSessionRequestSchema = z
  .object({
    deviceId: installationSchema.optional(),
    installationId: installationSchema,
    subject: identitySubjectSchema,
  })
  .strict();
export type LocalMobileSessionRequest = z.infer<
  typeof localMobileSessionRequestSchema
>;

export const mobileRefreshRequestSchema = z
  .object({ refreshToken: opaqueTokenSchema })
  .strict();
export type MobileRefreshRequest = z.infer<typeof mobileRefreshRequestSchema>;

export const recoveryStartRequestSchema = z
  .object({
    channel: z.literal('email'),
    deviceId: installationSchema.optional(),
    subject: identitySubjectSchema,
  })
  .strict();
export type RecoveryStartRequest = z.infer<typeof recoveryStartRequestSchema>;

export const recoveryCompletionRequestSchema = z
  .object({
    deviceId: installationSchema.optional(),
    token: opaqueTokenSchema,
  })
  .strict();
export type RecoveryCompletionRequest = z.infer<
  typeof recoveryCompletionRequestSchema
>;

/**
 * The server-derived view of the caller. It deliberately carries no credential,
 * no token, and no role: authorization truth stays in the owning domain.
 */
export const authSessionResponseSchema = z
  .object({
    absoluteExpiresAt: z.iso.datetime(),
    accountId: z.uuid(),
    assurance: authAssuranceSchema,
    assuranceEstablishedAt: z.iso.datetime(),
    audience: authAudienceSchema,
    authenticatedAt: z.iso.datetime(),
    /**
     * Present only for cookie-authenticated audiences. It is bound to the
     * session record on the server and must be echoed in the CSRF header on
     * every state-changing cookie-authenticated request.
     */
    csrfToken: z.string().min(1).optional(),
    idleExpiresAt: z.iso.datetime(),
  })
  .strict();
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const mobileTokenResponseSchema = z
  .object({
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.iso.datetime(),
    accountId: z.uuid(),
    assurance: authAssuranceSchema,
    audience: z.literal('consumer_mobile'),
    refreshToken: z.string().min(1),
    refreshTokenAbsoluteExpiresAt: z.iso.datetime(),
    refreshTokenIdleExpiresAt: z.iso.datetime(),
  })
  .strict();
export type MobileTokenResponse = z.infer<typeof mobileTokenResponseSchema>;

export const authAcknowledgementSchema = z
  .object({ status: z.enum(['accepted', 'revoked']) })
  .strict();
export type AuthAcknowledgement = z.infer<typeof authAcknowledgementSchema>;

/**
 * Stable, deliberately uninformative failure codes. A caller learns what to do
 * next and nothing about accounts, tokens, providers, or storage.
 */
export const authErrorCodes = {
  csrfRequired: 'AUTH_CSRF_REQUIRED',
  identityDisabled: 'AUTH_IDENTITY_DISABLED',
  invalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  originRejected: 'AUTH_ORIGIN_REJECTED',
  rateLimited: 'AUTH_RATE_LIMITED',
  recoveryInvalid: 'AUTH_RECOVERY_INVALID',
  recoveryReviewRequired: 'AUTH_RECOVERY_REVIEW_REQUIRED',
  refreshInvalid: 'AUTH_REFRESH_INVALID',
  required: 'AUTH_REQUIRED',
  validationFailed: 'VALIDATION_FAILED',
} as const;
export type AuthErrorCode =
  (typeof authErrorCodes)[keyof typeof authErrorCodes];

/** Request headers the AUTH contract defines. */
export const csrfHeader = 'x-velora-csrf';
export const deviceHeader = 'x-velora-device';

/** Cookie names are audience-scoped so one browser cannot confuse two surfaces. */
export const browserSessionCookieNames = {
  consumer_web: '__Host-velora_consumer_web_session',
  creator_studio: '__Host-velora_creator_studio_session',
  platform_admin: '__Host-velora_platform_admin_session',
} as const satisfies Record<BrowserAuthAudience, string>;

/** Largest AUTH request body accepted, so malformed input is rejected cheaply. */
export const maximumAuthRequestBodyBytes = 4_096;
