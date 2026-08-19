# ADR-0024: Identity Assurance domain and provider-neutral verification core

- Decision date: 2026-08-18
- ADR status: Accepted
- Owners: Founder (decision owner), AUTH, USERS, IDENTITY ASSURANCE, CREATORS, TRUST & SAFETY, BILLING, PAYOUTS, ADMIN, security, privacy, compliance, operations

## Context

At decision time, VELORA had three partial verification concepts with different owners: USERS stored self-declaration and verified-adult assessments together, CREATORS described a future creator-verification predicate, and TRUST & SAFETY stored depicted-person identity/adult verifier references beside consent. The subsequent `0047` and `0050` owner cutovers enact this ADR; Phase 3 still needs commercial-KYC evidence without letting PAYOUTS or a provider become the authority for payout permission.

Leaving these as owner-specific provider integrations would create multiple raw-document surfaces, incompatible callback handling, duplicated subject records, and several booleans called `verified` that mean different things. Moving them into AUTH would create a second error: authentication success and product/commercial identity evidence are not interchangeable, and AUTH must not become a general KYC store.

## Decision

### Separate domain; no second authentication system

IDENTITY ASSURANCE is a bounded domain owning verification subjects, attempts, normalized assurance evidence, provider-event inbox, reconciliation findings, and minimized outbox facts. AUTH remains the sole authentication identity/session authority. Identity subjects link to AUTH principals, Creator capabilities, or TRUST & SAFETY depicted participants through opaque owner references only.

IDENTITY never authenticates a request, issues a session, assigns a role, or grants product access. An owner domain re-authorizes every request and re-evaluates current evidence under its policy.

### Ownership split

- USERS owns self-declaration only.
- IDENTITY owns verified adult-threshold, identity, creator-identity, depicted-person identity/adult, and commercial-KYC evidence.
- TRUST & SAFETY owns depicted-person relationship, declaration, scoped consent, content policy, and enforcement.
- CREATORS owns creator lifecycle/business profile and decides whether current evidence satisfies creator predicates.
- BILLING/PAYOUTS own money/commercial/payout decisions and compose evidence with their own truths.

No domain stores a master `verified`, `kycReady`, `commercialEligible`, or `payoutAllowed` boolean.

### Append-only evidence with supersession

Assurance evidence is immutable and append-only. Grant, refusal, expiry, and revocation are explicit results linked through one-successor supersession chains. A current answer is derived from the chain and current policy; stale evidence cannot supersede a newer decision.

### Hosted provider orchestration

Providers remain behind a capability-declaring port. VELORA creates a durable attempt and stable provider-idempotency identity, commits, performs provider I/O outside the transaction, then binds the result in a second transaction. Ambiguous results are recovered by provider-idempotency lookup and reconciliation.

Only verified raw callback receipts enter a durable inbox. The body is discarded after a digest and normalized allow-list fields are recorded. Workers claim through PostgreSQL leases; BullMQ/pollers wake work and are never business truth.

### Versioned, fail-closed jurisdiction policy

Jurisdiction policy returns versioned `UNKNOWN`, `BLOCKED`, or `ALLOWED_WITH_REQUIREMENTS`. Production has no published bundle by default. Unknown, absent, stale, or unsupported policy refuses the verification path. Local/test policy fixtures make policy changes testable but make no legal claim.

### Production-unavailable configuration

`unavailable` is the default provider adapter. `local-test` is deterministic, network-free, and rejected at startup in staging/production. No route, header, query, client field, or caller domain selects provider or assurance strength. No provider is selected by this ADR.

### Privacy-minimized storage

IDENTITY stores no raw documents, exact DOB, names, addresses, selfies, video, biometrics, tax IDs, bank data, raw callback bodies, or reusable hosted URLs. Provider fact references are opaque. Retention, residency, deletion, biometric processing, and provider-controller/processor roles require country/provider approval before live traffic.

### Phase and surface boundary

V1 contains the provider-neutral core, fail-closed contracts, migration of existing verified evidence, reconciliation, and read-only operations. Phase 2 contains Consumer stronger-assurance and Creator verification workflows. Phase 3 contains commercial-KYC/payout-readiness exposure. Mature-content use remains conditional and blocked.

The V1 core publishes no Consumer/Creator initiation routes. Platform Admin receives aggregate health and exact-reference read only. Manual verification/override/revocation is absent until a separate decision defines evidence, actor, approval, expiry, appeal, and ADR-0017 exact-action authorization.

## Consequences

- Verification implementation is portable across providers and evidence uses.
- AUTH stays narrow and USERS keeps self-declaration semantics.
- Provider result is never authorization.
- Evidence history and ambiguous external effects are recoverable and auditable.
- Owner integrations require migrations and compatibility adapters while current evidence moves.
- Live verification remains unavailable until provider, policy, privacy/legal, operations, and product/design gates pass.

## Rejected alternatives

- Keep provider integration in USERS/CREATORS/SAFETY: duplicates high-risk storage and lifecycle rules.
- Put all evidence in AUTH: conflates authentication with age, creator, depicted-person, and KYC evidence.
- Store a provider `verified` boolean: loses purpose, threshold, policy, expiry, revocation, and provenance.
- Let callbacks mutate owner domains: bypasses owner authorization and couples providers to private persistence.
- Store provider payloads or documents for convenience: unnecessary breach and retention surface.
- Use queue/Redis state as completion truth: cannot survive loss or reconcile ambiguity.

## Unresolved decisions

Provider/model/vendor selection is `DEFER UNTIL PROVIDER INTEGRATION`. Launch jurisdictions, required methods/thresholds, biometric and privacy basis, notices/consent, residency, retention/deletion, re-verification, alternative/manual route, appeal/correction, KYC/sanctions scope, and production operations are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Cross-references

[IDENTITY ASSURANCE](../domains/identity-assurance.md), [verification flow](../flows/identity-assurance-verification.md), [provider eligibility](../compliance/09-identity-verification-provider-eligibility.md), [threat model](../security/11-identity-verification-threat-model.md), [product phases](../product/01-product-phases.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md).
