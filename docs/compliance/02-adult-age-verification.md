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

## Open decisions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: age per country, assurance tiers, accepted methods, provider/manual route, biometric use, evidence retention, parental/minor handling, retry/appeal, re-verification, false-match response, and accessibility fallback.

See [onboarding](../flows/onboarding.md), [AUTH](../domains/auth.md), [CREATORS](../domains/creators.md), [privacy](../security/03-privacy-retention.md), and [provider adapters](../architecture/06-provider-adapters.md).
