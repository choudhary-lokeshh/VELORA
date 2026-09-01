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
const httpUrlSchema = serviceUrlSchema('VELORA_API_BASE_URL', [
  'http:',
  'https:',
]);

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
 * Deterministic local-test stand-in for a phishing-resistant authenticator
 * verifier. It accepts every assertion, performs no cryptography, and is
 * rejected in staging and production by the `superRefine` guard below.
 * Selecting it is how a developer reaches Platform Admin locally before a real
 * WebAuthn implementation is approved. See ADR-0034.
 */
export const localTestPrivilegedVerifier = 'local-test-privileged';

/** AI stays fail-closed unless local/test explicitly selects both seams. */
export const unavailableAiProvider = 'unavailable';
export const localTestAiProvider = 'local-test';
export const enabledAiKillSwitch = 'enabled';
export const disabledAiKillSwitch = 'disabled';

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
 * Depicted-person consent is a separate gate from IDENTITY evidence.
 *
 * IDENTITY ASSURANCE independently owns the referenced depicted-person
 * identity/adult evidence. This domain never configures an identity provider
 * and never stores provider evidence or a provider subject handle.
 *
 * The **policy** carries the approved consent wording and its version. A
 * recorded grant is a claim that a person agreed to specific words, so
 * recording one under wording nobody approved would be manufacturing consent.
 * `unpublished` publishes no wording and refuses every grant.
 *
 * Satisfying wording alone enables nothing. Current Identity evidence and every
 * other mature-content gate remain independently required.
 */
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
 * Whether anybody may place a call, and which provider would carry it.
 *
 * Two values because they refuse for independent reasons, and either alone is
 * enough to stop a call.
 *
 * `REALTIME_CALL_ELIGIBILITY` gates the *product*. `unavailable` refuses every
 * pair, which is the only behaviour a deployed environment may have while call
 * retention duration, regional availability, recording posture, and operations
 * ownership are undecided. `composed` is the real answer built from DISCOVERY's
 * relationship contract and TRUST & SAFETY's block and enforcement contracts.
 *
 * `REALTIME_RTC_PROVIDER` gates the *transport*. `unavailable` refuses every
 * provider operation: [RTC provider eligibility](../../../docs/compliance/10-rtc-provider-eligibility.md)
 * records, from official sources dated 2026-08-20, that no assessed provider is
 * eligible — one prohibits adult content outright, one offers no media
 * isolation between unrelated calls, two published terms that could not be
 * retrieved, and the rest carry unresolved written-approval gaps. `local-test`
 * is a deterministic in-process adapter that reaches no network and carries no
 * media; it exists so the orchestration around a provider is exercisable before
 * one is approved, and it is named so no passing test can be read as evidence
 * about a real one.
 *
 * Neither value can be reached by a route, header, query parameter, or request
 * field, and both are rejected outside local and test by the guard below.
 */
export const unavailableCallEligibility = 'unavailable';
export const composedCallEligibility = 'composed';
/**
 * How a call's movements reach a connected client.
 *
 * `unavailable` carries nothing, which is the accurate description of a
 * platform with no realtime gateway: the consumer surfaces that would connect
 * to one are deferred, so there is no audience to deliver to. Clients read
 * authoritative state over HTTP either way, which is why this is a complete
 * answer rather than a degraded one.
 *
 * `redis` fans out over ephemeral Redis so two API replicas can reach the same
 * person's connections. It is transport only: it holds no call state, decides
 * nothing, and losing it loses no durable fact.
 */
export const unavailableSignalTransport = 'unavailable';
export const redisSignalTransport = 'redis';

export const unavailableRtcProvider = 'unavailable';
export const localTestRtcProvider = 'local-test';
/**
 * The first adapter that actually carries a packet.
 *
 * `livekit` mints real, per-participant, room-scoped access tokens against a
 * LiveKit project and verifies real callbacks over their exact raw bytes. It is
 * a *transport* selection and nothing else: VELORA still decides who meets
 * whom, who may join, and when a credential stops working.
 *
 * It is refused in staging and production by the guard below, and the reason is
 * recorded rather than implied. `docs/compliance/10-rtc-provider-eligibility.md`
 * assesses LiveKit Cloud as the closest technical fit and **NOT APPROVED**: its
 * acceptable-use policy reserves unbounded discretion over "otherwise
 * objectionable" content, which is exactly what VELORA is, so written use-case
 * confirmation is mandatory and has not been obtained. Selecting it locally is
 * how the integration is proved against a real provider before that answer
 * exists; selecting it in a deployed environment would be reading silence as
 * permission.
 *
 * There is deliberately no fallback. A `livekit` selection whose credentials
 * are absent is a startup failure, never a quiet downgrade to `local-test` —
 * an environment that simulated media while claiming a provider would be the
 * single most misleading state this platform could be in.
 */
export const livekitRtcProvider = 'livekit';

/**
 * Whether anybody may be admitted to random live discovery, and whether a
 * deterministic peer stands in for a second person.
 *
 * Two values, on the same rule the RTC pair follows: they refuse for
 * independent reasons and either alone is enough to stop a stranger meeting a
 * stranger.
 *
 * `LIVE_DISCOVERY_MODE` gates the *product*. `unavailable` admits nobody to the
 * matching pool, which is the only behaviour a deployed environment may have
 * while the decisions behind live calling are open — no approved RTC provider,
 * no call retention duration, no regional availability, no recording posture,
 * and nobody on call for it. `open` admits accounts that pass every existing
 * consumer eligibility predicate and nothing weaker.
 *
 * `LIVE_DISCOVERY_SIMULATION` gates the *stand-in*. `unavailable` means a match
 * is only ever another real waiting account. `local-test` lets the matcher pair
 * a waiting person with a seeded local account and drive that account's side
 * through the same published service methods a person's client calls — which is
 * what makes the whole loop walkable by one developer, without a single
 * fabricated row, count, or presence. It is refused outside local and test by
 * the guard below, exactly as the RTC and media adapters are.
 *
 * Neither value can be reached by a route, header, query parameter, or request
 * field.
 */
export const unavailableLiveDiscovery = 'unavailable';
export const openLiveDiscovery = 'open';
export const unavailableLiveSimulation = 'unavailable';
export const localTestLiveSimulation = 'local-test';

/**
 * Whether the platform keeps a coin balance for anybody at all.
 *
 * Coins are an entitlement unit, not money: they are counted in whole units,
 * they have no ISO 4217 currency, and they buy nothing outside VELORA. What
 * makes them worth gating is the other half — buying them is a payment, and
 * what a virtual balance is worth, whether it expires, whether it is
 * refundable, and how it is treated for consumer-protection and tax purposes
 * are all undecided commercial and legal questions in `DECISIONS_REQUIRED`.
 *
 * `unavailable` means no account holds a balance, no preference can be paid
 * for, and every wallet operation refuses — which is the only behaviour a
 * deployed environment may have while those answers are missing. `enabled`
 * builds the ledger and is refused outside local and test by the guard below.
 *
 * It gates the *ledger*, not an acquisition channel. How coins are bought is
 * decided separately: on the Web by `BILLING_PAYMENT_PROVIDER`, which refuses
 * in every environment, and on Android by the value below.
 */
export const unavailableCoinLedger = 'unavailable';
export const enabledCoinLedger = 'enabled';

/**
 * How the Android application acquires coins.
 *
 * Deliberately separate from the Web channel rather than sharing it. Google
 * Play requires digital goods consumed inside a Play-distributed application to
 * be sold through Play Billing, and a Play purchase is proved by a server-side
 * verification against Google's own API — never by a client saying it
 * succeeded. Those are different mechanisms with different proofs, so they are
 * different adapters.
 *
 * `unavailable` refuses every acquisition, which is what a deployed
 * environment gets: no Play Console project, no product identifiers, no
 * service-account credentials, and no owner decision about any of them exist.
 * `local-test` credits a fixed grant through the same server-side path a
 * verified purchase would take, so the wallet, the entitlement, and the
 * matching that depends on them are walkable on a device; it is refused
 * outside local and test.
 *
 * A `google-play` adapter is deliberately absent rather than stubbed. The port
 * it would implement is declared in full, so adding one is an adapter and a
 * credential rather than a redesign — but a name that could be selected and
 * could not verify anything would be a channel that mints currency on a
 * client's word.
 */
export const unavailableCoinAcquisition = 'unavailable';
export const localTestCoinAcquisition = 'local-test';

/**
 * How the Web acquires coins.
 *
 * Deliberately a gate of its own rather than an inference from
 * `BILLING_PAYMENT_PROVIDER`. A payment provider being configured says money
 * can move; it does not say VELORA has decided to sell its own currency, at
 * what price, from which country, under whose consumer-protection regime. All
 * of those are undecided, so selling coins is a separate switch that a
 * deployed environment cannot turn on.
 *
 * `local-test` publishes platform-owned coin-pack offers with development
 * prices and lets the local payment provider settle them, so the whole path —
 * checkout, settlement, entitlement fact, idempotent credit — is walkable
 * before any of those decisions exist. It requires the coin ledger and the
 * local payment provider, because it is worth nothing without either, and the
 * guard below refuses it outside local and test.
 */
export const unavailableWebCoinAcquisition = 'unavailable';
export const localTestWebCoinAcquisition = 'local-test';

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
    AI_KILL_SWITCH: z
      .enum([enabledAiKillSwitch, disabledAiKillSwitch])
      .default(enabledAiKillSwitch),
    AI_PROVIDER: z
      .enum([unavailableAiProvider, localTestAiProvider])
      .default(unavailableAiProvider),
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
      .enum([unavailablePrivilegedVerifier, localTestPrivilegedVerifier])
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
    LIVE_DISCOVERY_MODE: z
      .enum([unavailableLiveDiscovery, openLiveDiscovery])
      .default(unavailableLiveDiscovery),
    LIVE_DISCOVERY_SIMULATION: z
      .enum([unavailableLiveSimulation, localTestLiveSimulation])
      .default(unavailableLiveSimulation),
    WALLET_COIN_LEDGER: z
      .enum([unavailableCoinLedger, enabledCoinLedger])
      .default(unavailableCoinLedger),
    WALLET_ANDROID_ACQUISITION: z
      .enum([unavailableCoinAcquisition, localTestCoinAcquisition])
      .default(unavailableCoinAcquisition),
    WALLET_WEB_ACQUISITION: z
      .enum([unavailableWebCoinAcquisition, localTestWebCoinAcquisition])
      .default(unavailableWebCoinAcquisition),
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
    REALTIME_CALL_ELIGIBILITY: z
      .enum([unavailableCallEligibility, composedCallEligibility])
      .default(unavailableCallEligibility),
    REALTIME_RTC_PROVIDER: z
      .enum([unavailableRtcProvider, localTestRtcProvider, livekitRtcProvider])
      .default(unavailableRtcProvider),
    /**
     * Where a LiveKit project answers, as a client reaches it.
     *
     * Not a secret: it is handed to browsers and to the Android application so
     * they know where to present the credential the server minted for them.
     * Required when, and only when, the `livekit` adapter is selected.
     */
    REALTIME_LIVEKIT_URL: optionalTextSchema,
    /**
     * The LiveKit API key and secret, which sign every participant token and
     * verify every callback.
     *
     * **Backend only, both of them.** Neither carries a client-public prefix,
     * neither is returned by any route, neither appears in
     * {@link redactServerConfig}, and `pnpm env:check` refuses a public prefix
     * on either. The secret is the whole of the platform's authority over a
     * LiveKit project: anybody holding it can mint a token for any room.
     */
    REALTIME_LIVEKIT_API_KEY: optionalTextSchema,
    REALTIME_LIVEKIT_API_SECRET: optionalTextSchema,
    REALTIME_SIGNAL_TRANSPORT: z
      .enum([unavailableSignalTransport, redisSignalTransport])
      .default(unavailableSignalTransport),
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
    /**
     * Where this API answers, as a client reaches it.
     *
     * The Next.js surfaces already read it to resolve their API origin at
     * request time. The server reads the same value for one reason: the
     * `local-test` storage adapter has no provider origin of its own, so the
     * absolute upload and delivery addresses it issues have to name this API.
     * No approved provider will ever need it — every one of them names itself.
     *
     * Optional, and defaulted below from this process's own bind address rather
     * than demanded. A worker that issues a public address is a second process
     * with no port of its own, so a deployment where the two disagree must set
     * this explicitly; a developer on loopback should not have to.
     */
    VELORA_API_BASE_URL: httpUrlSchema.optional(),
  })
  .superRefine((config, context) => {
    if (config.APP_ENV !== 'staging' && config.APP_ENV !== 'production') return;
    // Fail closed. A development identity adapter, a development signing key,
    // a test recovery sink, or an absent privileged authenticator verifier must
    // never carry real authentication authority, and no replacement provider is
    // approved yet, so these environments refuse to start at all.
    if (config.AI_PROVIDER !== unavailableAiProvider) {
      context.addIssue({
        code: 'custom',
        message: `AI_PROVIDER is not usable in ${config.APP_ENV}: no live model/provider route is approved or evaluated`,
        path: ['AI_PROVIDER'],
      });
    }
    if (config.AI_KILL_SWITCH !== enabledAiKillSwitch) {
      context.addIssue({
        code: 'custom',
        message: `AI_KILL_SWITCH must remain enabled in ${config.APP_ENV}: no live AI route is approved`,
        path: ['AI_KILL_SWITCH'],
      });
    }
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
    if (config.REALTIME_CALL_ELIGIBILITY !== unavailableCallEligibility) {
      context.addIssue({
        code: 'custom',
        message: `REALTIME_CALL_ELIGIBILITY is not usable in ${config.APP_ENV}: call retention duration, regional availability, recording posture, and RTC operations ownership are all undecided; see DECISIONS_REQUIRED`,
        path: ['REALTIME_CALL_ELIGIBILITY'],
      });
    }
    if (config.LIVE_DISCOVERY_MODE !== unavailableLiveDiscovery) {
      context.addIssue({
        code: 'custom',
        message: `LIVE_DISCOVERY_MODE is not usable in ${config.APP_ENV}: random live discovery puts two strangers into a call, and no RTC provider is approved to carry one, no call retention duration exists, regional availability and recording posture are undecided, and RTC operations ownership is unassigned; see DECISIONS_REQUIRED`,
        path: ['LIVE_DISCOVERY_MODE'],
      });
    }
    if (config.LIVE_DISCOVERY_SIMULATION !== unavailableLiveSimulation) {
      context.addIssue({
        code: 'custom',
        message: `LIVE_DISCOVERY_SIMULATION is not usable in ${config.APP_ENV}: it stands a seeded local account in for a second person so one developer can walk the whole loop, and an environment with real people in it must never match somebody with one`,
        path: ['LIVE_DISCOVERY_SIMULATION'],
      });
    }
    if (config.REALTIME_RTC_PROVIDER !== unavailableRtcProvider) {
      context.addIssue({
        code: 'custom',
        message: `REALTIME_RTC_PROVIDER is not usable in ${config.APP_ENV}: no RTC provider is approved, and a provider whose terms prohibit what Velora is, offers no isolation between unrelated calls, reserves unbounded discretion over "otherwise objectionable" content, or cannot be read at all has given no answer rather than permission; see the RTC provider eligibility record and DECISIONS_REQUIRED`,
        path: ['REALTIME_RTC_PROVIDER'],
      });
    }
    if (config.WALLET_COIN_LEDGER !== unavailableCoinLedger) {
      context.addIssue({
        code: 'custom',
        message: `WALLET_COIN_LEDGER is not usable in ${config.APP_ENV}: what a coin is worth, whether a balance expires, whether it is refundable, and how a virtual balance is treated for consumer-protection and tax purposes are all undecided; see DECISIONS_REQUIRED`,
        path: ['WALLET_COIN_LEDGER'],
      });
    }
    if (config.WALLET_ANDROID_ACQUISITION !== unavailableCoinAcquisition) {
      context.addIssue({
        code: 'custom',
        message: `WALLET_ANDROID_ACQUISITION is not usable in ${config.APP_ENV}: it credits coins without verifying a purchase against Google Play, and no Play Console project, product identifier, or service-account credential exists to verify one against; see DECISIONS_REQUIRED`,
        path: ['WALLET_ANDROID_ACQUISITION'],
      });
    }
    if (config.WALLET_WEB_ACQUISITION !== unavailableWebCoinAcquisition) {
      context.addIssue({
        code: 'custom',
        message: `WALLET_WEB_ACQUISITION is not usable in ${config.APP_ENV}: what a coin is worth, what a pack costs, which country VELORA sells its own products from, and how a virtual balance is treated for consumer-protection and tax purposes are all undecided; see DECISIONS_REQUIRED`,
        path: ['WALLET_WEB_ACQUISITION'],
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
    // Runs in every environment, unlike the guard above. A `livekit` selection
    // with any of its three values missing is a startup failure rather than a
    // downgrade: an adapter that fell back to simulation would present "no
    // approved provider exists" to one developer and a working call to the
    // next, from the same commit, with nothing saying which they had.
    //
    // The key and the secret are read here and nowhere else. Nothing in the
    // application reads `process.env` for either, so there is one place that
    // decides whether they are present and one place that hands them to the
    // adapter.
    if (config.REALTIME_RTC_PROVIDER === livekitRtcProvider) {
      for (const path of [
        'REALTIME_LIVEKIT_URL',
        'REALTIME_LIVEKIT_API_KEY',
        'REALTIME_LIVEKIT_API_SECRET',
      ] as const) {
        if (config[path] === undefined) {
          context.addIssue({
            code: 'custom',
            message: `${path} is required when REALTIME_RTC_PROVIDER is ${livekitRtcProvider}`,
            path: [path],
          });
        }
      }
      const url = config.REALTIME_LIVEKIT_URL;
      // A LiveKit project is reached over a WebSocket. Refusing anything else
      // here means a browser is never handed an address it will fail on after
      // the user has already granted a camera.
      if (
        url !== undefined &&
        !url.startsWith('wss://') &&
        !url.startsWith('ws://')
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'REALTIME_LIVEKIT_URL must be a WebSocket address beginning ws:// or wss://',
          path: ['REALTIME_LIVEKIT_URL'],
        });
      }
    }
    // A coin acquisition channel with no ledger behind it would credit a
    // balance nothing holds. Selecting one without the other is a
    // configuration error rather than a channel that quietly does nothing.
    if (
      config.WALLET_ANDROID_ACQUISITION !== unavailableCoinAcquisition &&
      config.WALLET_COIN_LEDGER === unavailableCoinLedger
    ) {
      context.addIssue({
        code: 'custom',
        message: `WALLET_ANDROID_ACQUISITION requires WALLET_COIN_LEDGER to be ${enabledCoinLedger}`,
        path: ['WALLET_ANDROID_ACQUISITION'],
      });
    }
    // Web acquisition needs both halves and is worth nothing without either: a
    // ledger for the coins to land in, and a provider that can take the money.
    // A channel selected without one of them would publish a purchase control
    // for a product that cannot complete.
    if (config.WALLET_WEB_ACQUISITION !== unavailableWebCoinAcquisition) {
      if (config.WALLET_COIN_LEDGER === unavailableCoinLedger) {
        context.addIssue({
          code: 'custom',
          message: `WALLET_WEB_ACQUISITION requires WALLET_COIN_LEDGER to be ${enabledCoinLedger}`,
          path: ['WALLET_WEB_ACQUISITION'],
        });
      }
      if (config.BILLING_PAYMENT_PROVIDER === unavailablePaymentProvider) {
        context.addIssue({
          code: 'custom',
          message: `WALLET_WEB_ACQUISITION requires BILLING_PAYMENT_PROVIDER to be ${localTestPaymentProvider}`,
          path: ['WALLET_WEB_ACQUISITION'],
        });
      }
    }
    // Selecting the development media adapter without telling it where to keep
    // objects or what to sign with must fail at startup: an adapter that
    // quietly fell back to a temporary directory or a generated key would work
    // on one process and fail across two, which is the failure mode hardest to
    // find later.
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
  .transform((config) => {
    const host =
      config.HOST ??
      (config.APP_ENV === 'local' || config.APP_ENV === 'test'
        ? '127.0.0.1'
        : '0.0.0.0');
    return {
      ...config,
      HOST: host,
      // The address this process itself answers on, which for a single API on
      // loopback is exactly the address a client reaches it at. An explicit
      // value always wins, and outside local and test nothing reads this.
      VELORA_API_BASE_URL:
        config.VELORA_API_BASE_URL ?? `http://${host}:${String(config.PORT)}`,
    };
  })
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
    aiKillSwitch: config.AI_KILL_SWITCH,
    aiProvider: config.AI_PROVIDER,
    accessTokenSigner: config.AUTH_ACCESS_TOKEN_SIGNER,
    billingEntitlement: config.CLUBS_BILLING_ENTITLEMENT,
    consentPolicy: config.SAFETY_CONSENT_POLICY,
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
    liveDiscoveryMode: config.LIVE_DISCOVERY_MODE,
    liveDiscoverySimulation: config.LIVE_DISCOVERY_SIMULATION,
    notificationDeliveryChannel: config.NOTIFICATIONS_DELIVERY_CHANNEL,
    port: config.PORT,
    rtcCallEligibility: config.REALTIME_CALL_ELIGIBILITY,
    rtcProvider: config.REALTIME_RTC_PROVIDER,
    // Whether the three LiveKit values are present, never any of them. The URL
    // is not itself a secret, but reporting it here would put a project
    // address into every startup log for no operational gain, and the key and
    // the secret must never be rendered anywhere at all.
    rtcProviderCredentialsConfigured:
      config.REALTIME_LIVEKIT_URL !== undefined &&
      config.REALTIME_LIVEKIT_API_KEY !== undefined &&
      config.REALTIME_LIVEKIT_API_SECRET !== undefined,
    rtcSignalTransport: config.REALTIME_SIGNAL_TRANSPORT,
    walletAndroidAcquisition: config.WALLET_ANDROID_ACQUISITION,
    walletCoinLedger: config.WALLET_COIN_LEDGER,
    walletWebAcquisition: config.WALLET_WEB_ACQUISITION,
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
