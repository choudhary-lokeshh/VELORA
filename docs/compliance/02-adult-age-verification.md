# Adult age and verification gates

## Purpose and status

Define adult-access and age-assurance architecture without selecting a provider or making country-specific legal conclusions. This is not legal advice. Exact ages, assurance levels, evidence, and recheck rules are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Ownership

AUTH owns authentication assurance and verification-session references; USERS owns account/profile lifecycle; CREATORS owns creator verification status; country policy determines required adult/age assurance. Verification provider is an adapter, not authority for product access by itself. Owning domain evaluates normalized result with current country/channel/product policy.

## Assurance model

Do not treat self-declared birth date, authentication success, identity proof, age estimation, creator verification, or payment method as interchangeable. Policy defines required assurance per capability, country, channel, risk, and actor. Store minimum normalized outcome, method class, policy/provider version, time, expiry/recheck trigger, and evidence reference; avoid copying raw documents.

## Lifecycle

1. Determine supported country/channel and required adult assurance before protected access.
2. Present notices/consent and start approved verification path.
3. Provider/manual process returns signed or otherwise verified normalized result through adapter.
4. Owning policy evaluates pass, retry, review, restricted, expired, or denied without exposing sensitive reason broadly.
5. Recheck on expiry, policy/country change, suspicious state, creator transition, account recovery risk, or other approved trigger.
6. Revocation/failed recheck restricts affected capabilities and propagates minimized eligibility facts.

Duplicate callbacks are deduplicated; concurrent outcomes use version and precedence rules. Ambiguous provider result remains pending/review, never assumed adult-eligible.

## Privacy, security, and user experience

Use least-data provider and route eligible for country. Protect document/selfie/biometric or other sensitive evidence with restricted access, encryption, purpose, retention, deletion, audit, and provider-deletion rules. No raw evidence in analytics, AI, generic logs, notifications, or consumer/Admin views without justified role.

Provide accessible explanation, retry/alternate/manual review where policy permits, support route, and appeal/correction rights as legally required. Do not reveal detection thresholds or create account enumeration. Failed verification cannot be bypassed through another surface, stale session, link, or client flag.

## Creator and Conditional-content rules

Creator identity, creator age, consumer adult access, payout KYC, and content-performer/participant verification are separate predicates. Conditional mature/explicit content may require stricter, repeated, or participant-specific evidence and consent/ownership records. Nothing in this document enables that content.

## Implemented assurance seam

Adult assurance is recorded as append-only assessments carrying the assurance class, the normalized outcome, the method, the eligibility policy version the outcome was judged against, the declared region, and an optional expiry. The current assurance is the most recent assessment, so an expired or revoked outcome is a visible event rather than the absence of an earlier pass, and an expired pass is not treated as a pass.

The classes are separate values that no code widens into each other, and a database constraint refuses a self-declaration that carries provider evidence. No raw document, image, or birth date has a column. The only provider-linked field is an opaque digest.

The provider is an adapter selected by configuration, and the default refuses every request. Staging and production reject any other selection, so no deployed environment can grant verified adult status while the decisions below are open. A development and test adapter exists so the path is exercisable and is named so that no test using it reads as evidence about a real provider.

## Implemented depicted-person seam

The same shape, applied to the other person a content item can be about. A depicted adult's identity and age evidence are references to an approved verifier's outcome, held by TRUST & SAFETY alongside scoped consent records; no document, image, biometric template, name, or birth date has a column, and a constraint refuses a creator's assertion that carries an evidence reference. A creator's word is recorded as `asserted` and never widened into `verified` by any code path.

Two independent configuration values gate it and both refuse in staging and production: one selects the verifier, the other publishes the wording a depicted person would be agreeing to. A verifier with no approved wording records identity and age and records no consent at all, because a grant under unpublished wording would be a claim that somebody agreed to words that do not exist. The details are in [TRUST & SAFETY](../domains/trust-safety.md); the primary-source findings behind them are in [surface and distribution eligibility](07-surface-and-distribution-eligibility.md).

## Open decisions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: age per country, assurance tiers, accepted methods, provider/manual route, biometric use, evidence retention, parental/minor handling, retry/appeal, re-verification, false-match response, and accessibility fallback.

See [onboarding](../flows/onboarding.md), [AUTH](../domains/auth.md), [CREATORS](../domains/creators.md), [privacy](../security/03-privacy-retention.md), and [provider adapters](../architecture/06-provider-adapters.md).
