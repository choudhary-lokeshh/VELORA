# Adult age and verification gates

## Purpose and status

Define adult-access and age-assurance architecture without selecting a provider or making country-specific legal conclusions. This is not legal advice. Exact ages, assurance levels, evidence, and recheck rules are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Ownership

AUTH owns authentication assurance and principal linkage; USERS owns account/profile lifecycle and self-declaration; IDENTITY ASSURANCE owns verified adult-threshold, identity, creator-identity, depicted-person, and commercial-KYC evidence; CREATORS owns creator lifecycle; TRUST & SAFETY owns depicted-person relationship/consent. Country policy determines required adult/age assurance. Verification provider is an adapter, never product authority. Each owning domain evaluates current normalized evidence with current country/channel/product policy.

## Assurance model

Do not treat self-declared adult status, authentication success, identity proof, age estimation, creator verification, commercial KYC, or payment method as interchangeable. Policy defines required assurance per capability, country, channel, risk, and actor. Store minimum normalized outcome, explicit evidence class/threshold, method class, policy/provider version, time, validity/expiry, supersession, and opaque evidence reference in IDENTITY ASSURANCE. Do not copy raw documents or store a master verified/eligible boolean.

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

Adult assurance currently exists in a legacy mixed USERS table. [ADR-0024](../decisions/ADR-0024-identity-assurance-architecture.md) requires verified rows to migrate into Identity subjects, attempts, and append-only evidence chains while USERS keeps self-declarations only. Count, order, current-decision equivalence, and rollback safety must be proven before the mixed table is retired.

Classes stay separate and no code widens one into another. Identity evidence uses one-successor supersession so a refusal, expiry, or revocation is a visible fact and stale approval cannot resurrect access. No raw document, image, biometric template, or birth date has a column.

The Identity provider is an adapter selected at the composition root, and the default refuses every request. Staging and production reject the local/test adapter, so no deployed environment can grant verified adult status while provider and jurisdiction decisions remain open.

## Implemented depicted-person seam

The same shape applies to another person depicted in creator content. TRUST & SAFETY owns the participant link, declaration, and scoped consent; IDENTITY ASSURANCE owns the referenced identity/adult evidence. The migration from the current mixed SAFETY record must prove participant linkage and evidence equivalence while moving verifier/subject/evidence facts behind opaque Identity references. No document, image, biometric template, name, or birth date receives a column, and a creator's assertion is never widened into verification.

Provider availability and published consent wording remain independent gates and both refuse in staging and production. A verifier with no approved wording may produce Identity evidence and grants no consent, because identity proof is not agreement. The details are in [TRUST & SAFETY](../domains/trust-safety.md); the primary-source findings behind them are in [surface and distribution eligibility](07-surface-and-distribution-eligibility.md).

## Open decisions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: age per country, assurance tiers, accepted methods, provider/manual route, biometric use, evidence retention, parental/minor handling, retry/appeal, re-verification, false-match response, and accessibility fallback.

See [onboarding](../flows/onboarding.md), [IDENTITY ASSURANCE](../domains/identity-assurance.md), [verification flow](../flows/identity-assurance-verification.md), [AUTH](../domains/auth.md), [CREATORS](../domains/creators.md), [privacy](../security/03-privacy-retention.md), [provider eligibility](09-identity-verification-provider-eligibility.md), and [provider adapters](../architecture/06-provider-adapters.md).
