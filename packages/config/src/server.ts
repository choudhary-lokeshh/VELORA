import { z } from 'zod';

import {
  appEnvironmentSchema,
  logLevelSchema,
  serviceUrlSchema,
} from './shared.js';

const postgresUrlSchema = serviceUrlSchema('DATABASE_URL', [
  'postgres:',
  'postgresql:',
]);
const redisUrlSchema = serviceUrlSchema('Redis URL', ['redis:', 'rediss:']);

/**
 * AUTH adapters currently available. Each name is a development/test
 * implementation: no credential, social, OTP, passkey, or KMS provider has been
 * selected, and every one of them is `DEFER UNTIL PROVIDER INTEGRATION` in
 * `docs/decisions/DECISIONS_REQUIRED.md`. Staging and production reject them,
 * so a surface that needs real authentication fails closed rather than running
 * on a development stand-in.
 */
export const localIdentityProvider = 'local';
export const localAccessTokenSigner = 'local-development-ed25519';
export const localRecoveryDelivery = 'local-test';
export const unavailablePrivilegedVerifier = 'unavailable';

/**
 * Adult-assurance adapters. `unavailable` refuses every request, which is the
 * only behaviour a deployed environment may have while age verification is
 * `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. `local-test` exists so the
 * verified path is exercisable during development and is refused everywhere
 * else by the environment guard below.
 */
export const unavailableBillingEntitlement = 'unavailable';
export const localTestBillingEntitlement = 'local-test';

/**
 * Where BILLING takes approved commercial terms from.
 *
 * Not a provider. This gates *policy*: the currencies commerce may run in, the
 * billing intervals a subscription may use, and the price bounds an offer must
 * sit inside. Every one of those is an unresolved business decision in
 * `docs/decisions/DECISIONS_REQUIRED.md`, so `unpublished` publishes none of
 * them and nothing can be made purchasable. It is not an error state; it is the
 * accurate description of a platform whose commercial terms nobody has approved.
 *
 * `local-test` publishes a deterministic policy so the activation path is
 * exercisable during development, and is named so no test using it can be read
 * as evidence about real terms. Staging and production reject it below.
 */
export const unpublishedCommercePolicy = 'unpublished';
export const localTestCommercePolicy = 'local-test';

/**
 * Which payment provider collects money.
 *
 * `unavailable` refuses every provider operation, which is the only behaviour a
 * deployed environment may have: [provider eligibility](../../../docs/compliance/06-payment-provider-eligibility.md)
 * records, from primary sources, that no assessed provider is eligible for
 * Velora's business model without written approval nobody holds, and that
 * several prohibit it outright.
 *
 * `local-test` is a deterministic in-process adapter for development and tests.
 * It moves no money and reaches no network. Configuration refuses it outside
 * local and test, so there is no route, header, request field, or environment
 * string that reaches it in a deployed environment.
 */
export const unavailablePaymentProvider = 'unavailable';
export const localTestPaymentProvider = 'local-test';

/**
 * The payout adapter, and the terms a disbursement sits inside.
 *
 * Two values rather than one because they refuse for two independent reasons.
 * No assessed payout provider is eligible for Velora's business model — Stripe
 * Connect and PayPal Payouts inherit their platforms' prohibitions, Wise
 * prohibits both the content category and third-party money transmission, and
 * Airwallex lists adult content as unsupported — and separately, no settlement
 * window, reserve, minimum payout, or negative-balance treatment is published.
 * Either alone is enough to stop a payout, and a deployed environment holds
 * both.
 */
/**
 * The country and tax authorities a sale has to pass.
 *
 * Separate from the commerce policy because they answer different questions to
 * different owners. Commercial terms decide what Velora may charge; these
 * decide whether it may charge anybody in this pairing of countries at all, and
 * what a sale owes a government. A platform with published prices and no launch
 * country would sell everywhere, quietly, the first time somebody with an
 * unexpected address completed a checkout.
 */
export const unavailableCommerceEligibility = 'unavailable';
export const localTestCommerceEligibility = 'local-test';
export const unavailableTaxAuthority = 'unavailable';
export const localTestTaxAuthority = 'local-test';

export const unavailablePayoutProvider = 'unavailable';
export const localTestPayoutProvider = 'local-test';
export const unpublishedPayoutPolicy = 'unpublished';
export const localTestPayoutPolicy = 'local-test';

/**
 * Provider-neutral Identity Assurance gates.
 *
 * Provider and jurisdiction policy are independent: an eligible provider does
 * not publish legal policy, and a published policy does not approve a vendor.
 * Both defaults refuse. `local-test` implementations are deterministic,
 * network-free fixtures and are rejected in staging and production.
 */
export const unavailableIdentityVerificationProvider = 'unavailable';
export const localTestIdentityVerificationProvider = 'local-test';
export const unpublishedIdentityJurisdictionPolicy = 'unpublished';
export const localTestIdentityJurisdictionPolicy = 'local-test';

/**
 * Depicted-person evidence and consent, which are two gates rather than one.
 *
 * The **verifier** produces the references Velora holds about a depicted adult:
 * that somebody examined an identification document, that the person is an
 * adult, and that they consented. Velora holds no document, image, or biometric
 * template — [surface and distribution eligibility](../../../docs/compliance/07-surface-and-distribution-eligibility.md)
 * records why a table of identity documents is the highest-value breach target
 * the platform could build in exchange for evidence Velora is probably not the
 * right party to hold. No provider is approved, so `unavailable` refuses every
 * request.
 *
 * The **policy** carries the approved consent wording and its version. A
 * recorded grant is a claim that a person agreed to specific words, so
 * recording one under wording nobody approved would be manufacturing consent.
 * `unpublished` publishes no wording and refuses every grant.
 *
 * They are separate because they fail for different reasons and are lifted by
 * different people: one is a vendor assessment, the other is legal copy.
 * Satisfying either alone enables nothing.
 */
export const unavailableDepictedPersonVerifier = 'unavailable';
export const localTestDepictedPersonVerifier = 'local-test';
export const unpublishedConsentPolicy = 'unpublished';
export const localTestConsentPolicy = 'local-test';

/**
 * The mature-content capability, and the one value it has.
 *
 * Every other provider gate here offers a development adapter so the path stays
 * exercisable. This one deliberately does not. [ADR-0022](../../../docs/decisions/ADR-0022-trust-safety-policy-enforcement-authority.md)
 * rejects shipping a mature-content workflow behind a feature flag outright: a
 * flag that could be flipped is enablement waiting for an accident, and Apple
 * Guideline 2.3.1(a) treats a dormant remotely-enabled feature as a violation
 * in its own right. So the schema admits exactly one value, in every
 * environment, and any other is a configuration error rather than a switch.
 *
 * The gates around it are individually exercisable — surface eligibility,
 * classification, depicted-person consent, viewer assurance, and enforcement
 * are each tested on their own — and the composition is tested to refuse.
 */
export const disabledMatureContent = 'disabled';

/**
 * Where takedown deadlines come from.
 *
 * Not a provider. This gates *policy*: how long the platform has to
 * acknowledge, triage, and act on a claim that something should come down.
 * Every one of those values is undecided, and inventing one is worse than
 * having none — a hard-coded seven days would look like compliance, would carry
 * no authority, and would be the number an operator later defended in writing.
 * The seven-business-day figure recorded from Mastercard in
 * [surface and distribution eligibility](../../../docs/compliance/07-surface-and-distribution-eligibility.md)
 * is a card-network programme requirement, which is evidence about what a
 * policy will need to say rather than a value to compile in.
 *
 * `unpublished` publishes no deadline, so a claim is recorded with none and
 * nothing computes one. That is not a failure state: it is the accurate
 * description of a platform whose obligations nobody has approved. `local-test`
 * publishes deterministic arithmetic so the engine is exercisable, and is named
 * so no test using it reads as evidence about a real deadline.
 */
export const unpublishedTakedownPolicy = 'unpublished';
export const localTestTakedownPolicy = 'local-test';

/**
 * How long somebody has to complain about a decision.
 *
 * A separate gate from the takedown deadlines, because the two are lifted by
 * different answers: one is how fast the platform must act on a claim, the
 * other is how long a person keeps the right to contest what was already
 * decided. Regulation (EU) 2022/2065 Article 20 states at least six months, and
 * whether it binds Velora is `LEGAL REVIEW REQUIRED` -- so that figure is
 * recorded as evidence about what a policy will need to say rather than
 * compiled in.
 *
 * `unpublished` publishes no window. An appeal is still accepted; what is
 * absent is a date after which it would be refused, which is the safer half of
 * the question to leave open.
 */
export const unpublishedAppealPolicy = 'unpublished';
export const localTestAppealPolicy = 'local-test';

/**
 * MEDIA platform storage adapters.
 *
 * No object-storage, CDN, or media provider is approved. The eligibility
 * register in `docs/compliance/08-media-provider-eligibility.md` records why:
 * five assessed providers are *silent* on the content Velora serves, which is
 * the absence of a written answer rather than permission, and the two most
 * obvious processing platforms prohibit it outright. So `unavailable` refuses
 * every upload, read, write, deletion, delivery authorization, and purge, and
 * it is the only value a deployed environment may hold.
 *
 * `local-test` is filesystem-backed, so the API and the worker see the same
 * objects. It performs no malware scanning and no content moderation, and
 * nothing it accepts is evidence about real user content. The environment guard
 * below refuses it outside local and test.
 */
export const unavailableMediaStorage = 'unavailable';
export const localTestMediaStorage = 'local-test';

/**
 * MEDIA malware scanners.
 *
 * No scanner is approved, and the scanning *position* is itself undecided:
 * whether stored media must be scanned before it may ever be delivered, and
 * whether submitting user content to a third party is a disclosure under the
 * privacy authority, are both recorded in
 * `docs/decisions/DECISIONS_REQUIRED.md`.
 *
 * `unavailable` refuses, and inspection treats a refusal as a quarantine rather
 * than as a pass. That is the fail-closed reading of an undecided question: an
 * environment with no scanning position accepts no media at all. An unavailable
 * scanner reporting `clean` would be the single most dangerous line in this
 * domain, so there is no configuration under which it can.
 */
export const unavailableMediaScanner = 'unavailable';
export const localTestMediaScanner = 'local-test';

/**
 * Where messaging takes its "may these two people still interact" answer from.
 *
 * `trust-and-safety` is the real block store TRUST & SAFETY owns. It is refused
 * in deployed environments anyway, because messaging is blocked on two open
 * legal decisions rather than on a missing capability: message retention
 * duration and post-block history visibility. `unavailable` denies every pair,
 * so staging and production carry no message at all rather than carrying one
 * under a retention policy nobody has approved.
 */
export const unavailableSafetyEligibility = 'unavailable';
export const trustAndSafetyEligibility = 'trust-and-safety';

/**
 * Notification delivery channels. No email, push, or SMS provider is approved —
 * country coverage, consent, deliverability, and privacy review are all pending
 * in `docs/decisions/DECISIONS_REQUIRED.md` — so `unavailable` is the only
 * behaviour a deployed environment may have.
 *
 * `unavailable` does not discard a notice. It reports that no attempt was made,
 * which leaves the notice owed in PostgreSQL and deliverable on the day a
 * provider is approved. `local-test` records deliveries in process memory for
 * development and is refused everywhere else by the environment guard below.
 */
export const unavailableNotificationChannel = 'unavailable';
export const localTestNotificationChannel = 'local-test';

// A browser only ever sends a concrete host, so anything that is not a real
// hostname or IP literal is refused. That keeps a wildcard-looking entry such
// as `https://*.velora.test` out of the allowlist, where it would read as a
// pattern and silently match nothing.
const originHostPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$|^\[[0-9a-f:.]+\]$/u;

function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '' &&
      originHostPattern.test(url.hostname)
    );
  } catch {
    return false;
  }
}

const originListSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine(
    (origins) => origins.every(isExactOrigin),
    'Allowed browser origins must be exact scheme://host[:port] values',
  )
  .transform((origins): readonly string[] => [...new Set(origins)]);

/**
 * Key material is only shape-checked here. Whether the bytes are a usable
 * Ed25519 key is decided by the signing authority at composition, which fails
 * closed; duplicating that parse in configuration would put a second, weaker
 * opinion about key validity in the trust boundary.
 */
const minimumKeyMaterialBytes = 32;

function decodedLength(value: string): number | undefined {
  try {
    return atob(value.replaceAll('-', '+').replaceAll('_', '/')).length;
  } catch {
    return undefined;
  }
}

function isKeyMaterial(value: string): boolean {
  const length = decodedLength(value);
  return length !== undefined && length >= minimumKeyMaterialBytes;
}

// An empty value is the documented way to say "no key configured"; it must not
// be mistaken for a key that fails validation.
const signingKeySchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value.length === 0 ? undefined : value,
  )
  .refine(
    (value) => value === undefined || isKeyMaterial(value),
    'AUTH_ACCESS_TOKEN_SIGNING_KEY must be base64 PKCS8 Ed25519 key material',
  );

/**
 * Public keys retired from signing whose tokens must still verify. Listing a
 * key here is how a signing key is rotated without invalidating live access
 * tokens; removing one is how its tokens are revoked immediately.
 */
const verificationKeysSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine(
    (keys) => keys.every(isKeyMaterial),
    'AUTH_ACCESS_TOKEN_VERIFICATION_KEYS must be base64 SPKI Ed25519 public keys',
  )
  .transform((keys): readonly string[] => [...new Set(keys)]);

/**
 * An optional value where an empty string means "not configured".
 *
 * Container platforms inject absent variables as empty strings routinely, and
 * treating `''` as a configured value is how an adapter ends up holding a
 * zero-length signing key it believes is real.
 */
const optionalTextSchema = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value.trim().length === 0 ? undefined : value,
  );

export const serverConfigSchema = z
  .object({
    APP_ENV: appEnvironmentSchema.default('local'),
    AUTH_ACCESS_TOKEN_SIGNER: z
      .enum([localAccessTokenSigner])
      .default(localAccessTokenSigner),
    AUTH_ACCESS_TOKEN_SIGNING_KEY: signingKeySchema,
    AUTH_ACCESS_TOKEN_VERIFICATION_KEYS: verificationKeysSchema,
    AUTH_BROWSER_ORIGINS_CONSUMER_WEB: originListSchema,
    AUTH_BROWSER_ORIGINS_CREATOR_STUDIO: originListSchema,
    AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN: originListSchema,
    AUTH_IDENTITY_PROVIDER: z
      .enum([localIdentityProvider])
      .default(localIdentityProvider),
    AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER: z
      .enum([unavailablePrivilegedVerifier])
      .default(unavailablePrivilegedVerifier),
    AUTH_RECOVERY_DELIVERY: z
      .enum([localRecoveryDelivery])
      .default(localRecoveryDelivery),
    AUTH_TOKEN_ISSUER: z.url().default('https://auth.velora.invalid'),
    BILLING_COMMERCE_ELIGIBILITY: z
      .enum([unavailableCommerceEligibility, localTestCommerceEligibility])
      .default(unavailableCommerceEligibility),
    BILLING_COMMERCE_POLICY: z
      .enum([unpublishedCommercePolicy, localTestCommercePolicy])
      .default(unpublishedCommercePolicy),
    BILLING_PAYMENT_PROVIDER: z
      .enum([unavailablePaymentProvider, localTestPaymentProvider])
      .default(unavailablePaymentProvider),
    BILLING_TAX_AUTHORITY: z
      .enum([unavailableTaxAuthority, localTestTaxAuthority])
      .default(unavailableTaxAuthority),
    DATABASE_URL: postgresUrlSchema,
    EPHEMERAL_REDIS_URL: redisUrlSchema,
    HOST: z.string().min(1).optional(),
    IDENTITY_JURISDICTION_POLICY: z
      .enum([
        unpublishedIdentityJurisdictionPolicy,
        localTestIdentityJurisdictionPolicy,
      ])
      .default(unpublishedIdentityJurisdictionPolicy),
    IDENTITY_VERIFICATION_PROVIDER: z
      .enum([
        unavailableIdentityVerificationProvider,
        localTestIdentityVerificationProvider,
      ])
      .default(unavailableIdentityVerificationProvider),
    LOG_LEVEL: logLevelSchema.default('info'),
    MESSAGING_SAFETY_ELIGIBILITY: z
      .enum([unavailableSafetyEligibility, trustAndSafetyEligibility])
      .default(unavailableSafetyEligibility),
    CLUBS_BILLING_ENTITLEMENT: z
      .enum([unavailableBillingEntitlement, localTestBillingEntitlement])
      .default(unavailableBillingEntitlement),
    NOTIFICATIONS_DELIVERY_CHANNEL: z
      .enum([unavailableNotificationChannel, localTestNotificationChannel])
      .default(unavailableNotificationChannel),
    PAYOUTS_POLICY: z
      .enum([unpublishedPayoutPolicy, localTestPayoutPolicy])
      .default(unpublishedPayoutPolicy),
    PAYOUTS_PROVIDER: z
      .enum([unavailablePayoutProvider, localTestPayoutProvider])
      .default(unavailablePayoutProvider),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    QUEUE_REDIS_URL: redisUrlSchema,
    SAFETY_CONSENT_POLICY: z
      .enum([unpublishedConsentPolicy, localTestConsentPolicy])
      .default(unpublishedConsentPolicy),
    SAFETY_MATURE_CONTENT: z
      .enum([disabledMatureContent])
      .default(disabledMatureContent),
    SAFETY_APPEAL_POLICY: z
      .enum([unpublishedAppealPolicy, localTestAppealPolicy])
      .default(unpublishedAppealPolicy),
    SAFETY_TAKEDOWN_POLICY: z
      .enum([unpublishedTakedownPolicy, localTestTakedownPolicy])
      .default(unpublishedTakedownPolicy),
    SAFETY_DEPICTED_PERSON_VERIFIER: z
      .enum([
        unavailableDepictedPersonVerifier,
        localTestDepictedPersonVerifier,
      ])
      .default(unavailableDepictedPersonVerifier),
    MEDIA_STORAGE_PROVIDER: z
      .enum([unavailableMediaStorage, localTestMediaStorage])
      .default(unavailableMediaStorage),
    MEDIA_MALWARE_SCANNER: z
      .enum([unavailableMediaScanner, localTestMediaScanner])
      .default(unavailableMediaScanner),
    /** Where the `local-test` adapter keeps objects. Required when it is used. */
    MEDIA_LOCAL_STORAGE_DIRECTORY: optionalTextSchema,
    /**
     * HMAC material for `local-test` delivery grants. Configured rather than
     * generated per process, because two API replicas that generated their own
     * would each reject the other's credentials — which would hide, in
     * development, exactly the multi-instance bug this platform must not have.
     */
    MEDIA_DELIVERY_SIGNING_KEY: optionalTextSchema,
  })
  .superRefine((config, context) => {
    if (config.APP_ENV !== 'staging' && config.APP_ENV !== 'production') return;
    // Fail closed. A development identity adapter, a development signing key,
    // a test recovery sink, or an absent privileged authenticator verifier must
    // never carry real authentication authority, and no replacement provider is
    // approved yet, so these environments refuse to start at all.
    if (
      config.IDENTITY_VERIFICATION_PROVIDER !==
      unavailableIdentityVerificationProvider
    ) {
      context.addIssue({
        code: 'custom',
        message: `IDENTITY_VERIFICATION_PROVIDER is not usable in ${config.APP_ENV}: no identity verification provider is approved; see the provider eligibility record and DECISIONS_REQUIRED`,
        path: ['IDENTITY_VERIFICATION_PROVIDER'],
      });
    }
    if (
      config.IDENTITY_JURISDICTION_POLICY !==
      unpublishedIdentityJurisdictionPolicy
    ) {
      context.addIssue({
        code: 'custom',
        message: `IDENTITY_JURISDICTION_POLICY is not usable in ${config.APP_ENV}: no launch jurisdiction, assurance threshold, retention rule, or biometric basis is approved; see DECISIONS_REQUIRED`,
        path: ['IDENTITY_JURISDICTION_POLICY'],
      });
    }
    if (
      config.SAFETY_DEPICTED_PERSON_VERIFIER !==
      unavailableDepictedPersonVerifier
    ) {
      context.addIssue({
        code: 'custom',
        message: `SAFETY_DEPICTED_PERSON_VERIFIER is not usable in ${config.APP_ENV}: no identity, age, or consent verification provider is approved, and whether Velora is the party obliged to hold depicted-person records at all is unresolved; see DECISIONS_REQUIRED`,
        path: ['SAFETY_DEPICTED_PERSON_VERIFIER'],
      });
    }
    if (config.SAFETY_APPEAL_POLICY !== unpublishedAppealPolicy) {
      context.addIssue({
        code: 'custom',
        message: `SAFETY_APPEAL_POLICY is not usable in ${config.APP_ENV}: how long somebody keeps the right to contest a decision is undecided, and a window invented here would carry no authority; see DECISIONS_REQUIRED`,
        path: ['SAFETY_APPEAL_POLICY'],
      });
    }
    if (config.SAFETY_TAKEDOWN_POLICY !== unpublishedTakedownPolicy) {
      context.addIssue({
        code: 'custom',
        message: `SAFETY_TAKEDOWN_POLICY is not usable in ${config.APP_ENV}: no acknowledgement, triage, or action deadline is approved, and a deadline invented here would carry no authority; see DECISIONS_REQUIRED`,
        path: ['SAFETY_TAKEDOWN_POLICY'],
      });
    }
    if (config.SAFETY_CONSENT_POLICY !== unpublishedConsentPolicy) {
      context.addIssue({
        code: 'custom',
        message: `SAFETY_CONSENT_POLICY is not usable in ${config.APP_ENV}: the wording a depicted adult would agree to, the scopes it covers, and what a revocation withdraws are all undecided; see DECISIONS_REQUIRED`,
        path: ['SAFETY_CONSENT_POLICY'],
      });
    }
    if (config.CLUBS_BILLING_ENTITLEMENT !== unavailableBillingEntitlement) {
      context.addIssue({
        code: 'custom',
        message: `CLUBS_BILLING_ENTITLEMENT is not usable in ${config.APP_ENV}: no payment provider is approved and creator subscriptions are a later phase; see DECISIONS_REQUIRED`,
        path: ['CLUBS_BILLING_ENTITLEMENT'],
      });
    }
    if (config.BILLING_COMMERCE_POLICY !== unpublishedCommercePolicy) {
      context.addIssue({
        code: 'custom',
        message: `BILLING_COMMERCE_POLICY is not usable in ${config.APP_ENV}: platform fee, revenue share, currencies, price bounds, billing intervals, refund and cancellation terms are all undecided; see DECISIONS_REQUIRED`,
        path: ['BILLING_COMMERCE_POLICY'],
      });
    }
    if (
      config.BILLING_COMMERCE_ELIGIBILITY !== unavailableCommerceEligibility
    ) {
      context.addIssue({
        code: 'custom',
        message: `BILLING_COMMERCE_ELIGIBILITY is not usable in ${config.APP_ENV}: no launch country, no creator country, and no country-currency pairing is approved; see the market entry gates and DECISIONS_REQUIRED`,
        path: ['BILLING_COMMERCE_ELIGIBILITY'],
      });
    }
    if (config.BILLING_TAX_AUTHORITY !== unavailableTaxAuthority) {
      context.addIssue({
        code: 'custom',
        message: `BILLING_TAX_AUTHORITY is not usable in ${config.APP_ENV}: no tax engine, registration, merchant-of-record position, or remittance process is approved, and an assumed zero is an unremitted liability nobody decided to accrue; see DECISIONS_REQUIRED`,
        path: ['BILLING_TAX_AUTHORITY'],
      });
    }
    if (config.BILLING_PAYMENT_PROVIDER !== unavailablePaymentProvider) {
      context.addIssue({
        code: 'custom',
        message: `BILLING_PAYMENT_PROVIDER is not usable in ${config.APP_ENV}: no payment provider is eligible for Velora's business model without written approval nobody holds; see the provider eligibility record and DECISIONS_REQUIRED`,
        path: ['BILLING_PAYMENT_PROVIDER'],
      });
    }
    if (config.PAYOUTS_PROVIDER !== unavailablePayoutProvider) {
      context.addIssue({
        code: 'custom',
        message: `PAYOUTS_PROVIDER is not usable in ${config.APP_ENV}: no payout provider is eligible for Velora's business model, and creator payouts remain a later product phase; see the provider eligibility record and DECISIONS_REQUIRED`,
        path: ['PAYOUTS_PROVIDER'],
      });
    }
    if (config.PAYOUTS_POLICY !== unpublishedPayoutPolicy) {
      context.addIssue({
        code: 'custom',
        message: `PAYOUTS_POLICY is not usable in ${config.APP_ENV}: settlement window, rolling reserve, minimum payout, negative-balance treatment, and payout countries are all undecided; see DECISIONS_REQUIRED`,
        path: ['PAYOUTS_POLICY'],
      });
    }
    if (config.MESSAGING_SAFETY_ELIGIBILITY !== unavailableSafetyEligibility) {
      context.addIssue({
        code: 'custom',
        message: `MESSAGING_SAFETY_ELIGIBILITY is not usable in ${config.APP_ENV}: message retention duration and post-block history visibility are undecided; see DECISIONS_REQUIRED`,
        path: ['MESSAGING_SAFETY_ELIGIBILITY'],
      });
    }
    if (
      config.NOTIFICATIONS_DELIVERY_CHANNEL !== unavailableNotificationChannel
    ) {
      context.addIssue({
        code: 'custom',
        message: `NOTIFICATIONS_DELIVERY_CHANNEL is not usable in ${config.APP_ENV}: no email, push, or SMS provider is approved; see DECISIONS_REQUIRED`,
        path: ['NOTIFICATIONS_DELIVERY_CHANNEL'],
      });
    }
    if (config.MEDIA_STORAGE_PROVIDER !== unavailableMediaStorage) {
      context.addIssue({
        code: 'custom',
        message: `MEDIA_STORAGE_PROVIDER is not usable in ${config.APP_ENV}: no object-storage, CDN, or scanning provider is approved, and a provider whose policy is silent about what Velora serves has given no answer rather than permission; see the media provider eligibility record and DECISIONS_REQUIRED`,
        path: ['MEDIA_STORAGE_PROVIDER'],
      });
    }
    if (config.MEDIA_MALWARE_SCANNER !== unavailableMediaScanner) {
      context.addIssue({
        code: 'custom',
        message: `MEDIA_MALWARE_SCANNER is not usable in ${config.APP_ENV}: no scanner is approved and the scanning position is undecided, so a refusal is the only honest answer; see DECISIONS_REQUIRED`,
        path: ['MEDIA_MALWARE_SCANNER'],
      });
    }
    for (const [path, message] of [
      [
        'AUTH_IDENTITY_PROVIDER',
        'no production identity provider is approved; see DECISIONS_REQUIRED',
      ],
      [
        'AUTH_ACCESS_TOKEN_SIGNER',
        'no production signing authority is approved; see DECISIONS_REQUIRED',
      ],
      [
        'AUTH_RECOVERY_DELIVERY',
        'no production recovery delivery channel is approved; see DECISIONS_REQUIRED',
      ],
      [
        'AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER',
        'no phishing-resistant authenticator verifier is approved; see DECISIONS_REQUIRED',
      ],
    ] as const) {
      context.addIssue({
        code: 'custom',
        message: `${path} is not usable in ${config.APP_ENV}: ${message}`,
        path: [path],
      });
    }
  })
  .superRefine((config, context) => {
    // Runs in every environment, unlike the guard above. Selecting the
    // development media adapter without telling it where to keep objects or
    // what to sign with must fail at startup: an adapter that quietly fell back
    // to a temporary directory or a generated key would work on one process and
    // fail across two, which is the failure mode hardest to find later.
    if (config.MEDIA_STORAGE_PROVIDER !== localTestMediaStorage) return;
    if (config.MEDIA_LOCAL_STORAGE_DIRECTORY === undefined) {
      context.addIssue({
        code: 'custom',
        message:
          'MEDIA_LOCAL_STORAGE_DIRECTORY is required when MEDIA_STORAGE_PROVIDER is local-test',
        path: ['MEDIA_LOCAL_STORAGE_DIRECTORY'],
      });
    }
    if (config.MEDIA_DELIVERY_SIGNING_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        message:
          'MEDIA_DELIVERY_SIGNING_KEY is required when MEDIA_STORAGE_PROVIDER is local-test',
        path: ['MEDIA_DELIVERY_SIGNING_KEY'],
      });
    }
  })
  .transform((config) => ({
    ...config,
    HOST:
      config.HOST ??
      (config.APP_ENV === 'local' || config.APP_ENV === 'test'
        ? '127.0.0.1'
        : '0.0.0.0'),
  }))
  .readonly();

export type ServerConfig = z.infer<typeof serverConfigSchema>;
/**
 * The configured values that would enable mature content. There are none.
 *
 * Written as an empty set rather than as a comparison, because a comparison
 * against a one-value union is a condition the compiler can prove and a reader
 * cannot act on. This says the thing directly: nothing enables it, and adding
 * something here would be a deliberate, reviewable act rather than a typo in an
 * environment file.
 */
const enablingMatureContentValues: readonly string[] = [];

export function matureContentEnabled(config: ServerConfig): boolean {
  return enablingMatureContentValues.includes(config.SAFETY_MATURE_CONTENT);
}

export function loadServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  return serverConfigSchema.parse(environment);
}

const migrationConfigSchema = z
  .object({
    DATABASE_URL: postgresUrlSchema,
  })
  .readonly();

export type MigrationConfig = z.infer<typeof migrationConfigSchema>;

export function loadMigrationConfig(
  environment: Readonly<Record<string, string | undefined>>,
): MigrationConfig {
  return migrationConfigSchema.parse(environment);
}

export function redactServerConfig(config: ServerConfig) {
  return {
    accessTokenSigner: config.AUTH_ACCESS_TOKEN_SIGNER,
    billingEntitlement: config.CLUBS_BILLING_ENTITLEMENT,
    consentPolicy: config.SAFETY_CONSENT_POLICY,
    depictedPersonVerifier: config.SAFETY_DEPICTED_PERSON_VERIFIER,
    matureContent: config.SAFETY_MATURE_CONTENT,
    appealPolicy: config.SAFETY_APPEAL_POLICY,
    takedownPolicy: config.SAFETY_TAKEDOWN_POLICY,
    commerceEligibility: config.BILLING_COMMERCE_ELIGIBILITY,
    commercePolicy: config.BILLING_COMMERCE_POLICY,
    taxAuthority: config.BILLING_TAX_AUTHORITY,
    paymentProvider: config.BILLING_PAYMENT_PROVIDER,
    payoutPolicy: config.PAYOUTS_POLICY,
    payoutProvider: config.PAYOUTS_PROVIDER,
    mediaMalwareScanner: config.MEDIA_MALWARE_SCANNER,
    mediaStorageProvider: config.MEDIA_STORAGE_PROVIDER,
    mediaDeliverySigningKeyConfigured:
      config.MEDIA_DELIVERY_SIGNING_KEY !== undefined,
    accessTokenSigningKeyConfigured:
      config.AUTH_ACCESS_TOKEN_SIGNING_KEY !== undefined,
    accessTokenVerificationKeyCount:
      config.AUTH_ACCESS_TOKEN_VERIFICATION_KEYS.length,
    appEnvironment: config.APP_ENV,
    browserOriginCount:
      config.AUTH_BROWSER_ORIGINS_CONSUMER_WEB.length +
      config.AUTH_BROWSER_ORIGINS_CREATOR_STUDIO.length +
      config.AUTH_BROWSER_ORIGINS_PLATFORM_ADMIN.length,
    databaseConfigured: config.DATABASE_URL.length > 0,
    ephemeralRedisConfigured: config.EPHEMERAL_REDIS_URL.length > 0,
    host: config.HOST,
    identityProvider: config.AUTH_IDENTITY_PROVIDER,
    identityJurisdictionPolicy: config.IDENTITY_JURISDICTION_POLICY,
    identityVerificationProvider: config.IDENTITY_VERIFICATION_PROVIDER,
    logLevel: config.LOG_LEVEL,
    notificationDeliveryChannel: config.NOTIFICATIONS_DELIVERY_CHANNEL,
    port: config.PORT,
    safetyEligibility: config.MESSAGING_SAFETY_ELIGIBILITY,
    privilegedAuthenticatorVerifier:
      config.AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER,
    queueRedisConfigured: config.QUEUE_REDIS_URL.length > 0,
    recoveryDelivery: config.AUTH_RECOVERY_DELIVERY,
    tokenIssuer: config.AUTH_TOKEN_ISSUER,
  } as const;
}

export { appEnvironmentSchema, logLevelSchema } from './shared.js';
export type { AppEnvironment } from './shared.js';
