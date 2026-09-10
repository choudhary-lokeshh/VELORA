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
 * A destination inside the surface that started a sign-in.
 *
 * Every rule here refuses something a browser would otherwise follow off this
 * platform: a value that is not a path at all, a protocol-relative address that
 * looks like a path and is not, a backslash some browsers normalise into a
 * slash, and control characters that can split a redirect header. Nothing here
 * makes a value safe by repairing it — an address that does not already satisfy
 * every rule is dropped, and the person lands on the surface's own home.
 */
export const returnDestinationSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value.startsWith('/'), 'must be a path on this surface')
  .refine((value) => !value.startsWith('//'), 'must not be protocol-relative')
  .refine((value) => !value.includes('\\'), 'must not contain a backslash')
  .refine(hasNoControlCharacters, 'must not contain control characters');

/**
 * Refuses the characters that can split a redirect header.
 *
 * Written as a code-point scan rather than a regular expression because a
 * character class covering the control range is exactly what `no-control-regex`
 * exists to catch, and silencing that rule for the one place it is right would
 * be worse than not needing it.
 */
function hasNoControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

/**
 * Opening a federated sign-in.
 *
 * The audience is named by the caller and then checked against the origin the
 * request actually came from, so naming one is a request rather than a
 * selection. `platform_admin` is admissible here, unlike on the local adapter:
 * a real provider plus a real authenticator is exactly the combination
 * ADR-0017 asks for, and refusing it would leave the console unreachable in the
 * environments it exists for.
 */
export const federatedAuthorizationRequestSchema = z
  .object({
    audience: browserAuthAudienceSchema,
    returnTo: returnDestinationSchema.optional(),
  })
  .strict();
export type FederatedAuthorizationRequest = z.infer<
  typeof federatedAuthorizationRequestSchema
>;

export const federatedAuthorizationResponseSchema = z
  .object({
    /** Where to send the browser. Always the configured provider's own host. */
    authorizationUrl: z.url(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type FederatedAuthorizationResponse = z.infer<
  typeof federatedAuthorizationResponseSchema
>;

export const privilegedChallengePurposes = ['enrolment', 'assertion'] as const;
export const privilegedChallengePurposeSchema = z.enum(
  privilegedChallengePurposes,
);
export type PrivilegedChallengePurpose = z.infer<
  typeof privilegedChallengePurposeSchema
>;

export const privilegedChallengeRequestSchema = z
  .object({ purpose: privilegedChallengePurposeSchema })
  .strict();
export type PrivilegedChallengeRequest = z.infer<
  typeof privilegedChallengeRequestSchema
>;

export const privilegedChallengeResponseSchema = z
  .object({
    challenge: z.string().min(1),
    /** Credentials this operator may present, so a browser can scope the ask. */
    credentialIds: z.array(z.string().min(1)),
    expiresAt: z.iso.datetime(),
    relyingPartyId: z.string().min(1),
  })
  .strict();
export type PrivilegedChallengeResponse = z.infer<
  typeof privilegedChallengeResponseSchema
>;

/** base64url, as every WebAuthn structure crosses the wire. */
const base64UrlSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/u);

export const privilegedEnrolmentRequestSchema = z
  .object({
    /** The COSE algorithm the authenticator chose. */
    algorithm: z.number().int(),
    attachment: z.enum(['platform', 'cross_platform']).optional(),
    authenticatorData: base64UrlSchema,
    challenge: z.string().min(1).max(256),
    clientDataJSON: base64UrlSchema,
    credentialId: base64UrlSchema,
    label: z.string().min(1).max(64),
    /** The credential public key as SPKI. */
    publicKey: base64UrlSchema,
  })
  .strict();
export type PrivilegedEnrolmentRequest = z.infer<
  typeof privilegedEnrolmentRequestSchema
>;

export const privilegedEnrolmentResponseSchema = z
  .object({
    authenticatorId: z.uuid(),
    /** How many live authenticators this operator now holds. */
    enrolled: z.number().int().nonnegative(),
    /** Whether that count satisfies the ADR-0017 production minimum. */
    ready: z.boolean(),
  })
  .strict();
export type PrivilegedEnrolmentResponse = z.infer<
  typeof privilegedEnrolmentResponseSchema
>;

export const privilegedStepUpRequestSchema = z
  .object({
    authenticatorData: base64UrlSchema,
    challenge: z.string().min(1).max(256),
    clientDataJSON: base64UrlSchema,
    credentialId: base64UrlSchema,
    signature: base64UrlSchema,
  })
  .strict();
export type PrivilegedStepUpRequest = z.infer<
  typeof privilegedStepUpRequestSchema
>;

/**
 * The first operator grant in a deployed environment.
 *
 * Three independent things have to be true at once, and the request carries
 * only one of them: the caller already holds a Platform Admin session at
 * phishing-resistant assurance, and separately presents the deployment-time
 * bootstrap secret. Neither is sufficient alone, which is the property that
 * makes this safe to expose at all.
 */
export const operatorBootstrapRequestSchema = z
  .object({
    reason: z.string().min(8).max(280),
    token: z.string().min(16).max(512),
  })
  .strict();
export type OperatorBootstrapRequest = z.infer<
  typeof operatorBootstrapRequestSchema
>;

export const operatorBootstrapResponseSchema = z
  .object({
    grantId: z.uuid(),
    role: z.string().min(1),
    subjectReference: z.string().min(1),
  })
  .strict();
export type OperatorBootstrapResponse = z.infer<
  typeof operatorBootstrapResponseSchema
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
  /** The first operator grant was refused. It never says which condition failed. */
  bootstrapRefused: 'ADMIN_BOOTSTRAP_REFUSED',
  csrfRequired: 'AUTH_CSRF_REQUIRED',
  /** No federated provider is configured, so there is nowhere to send anybody. */
  federatedUnavailable: 'AUTH_FEDERATED_UNAVAILABLE',
  identityDisabled: 'AUTH_IDENTITY_DISABLED',
  invalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  originRejected: 'AUTH_ORIGIN_REJECTED',
  /** A challenge that was never issued, already used, or has expired. */
  privilegedChallengeInvalid: 'AUTH_PRIVILEGED_CHALLENGE_INVALID',
  /** The authenticator's answer did not verify. Nothing says why. */
  privilegedVerificationFailed: 'AUTH_PRIVILEGED_VERIFICATION_FAILED',
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
