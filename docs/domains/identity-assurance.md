# IDENTITY ASSURANCE domain

## Purpose and ownership

IDENTITY ASSURANCE owns provider-neutral evidence that an opaque subject met a defined assurance requirement. It is not a second authentication system and never decides product access.

- AUTH owns principals, credentials, sessions, recovery, and authentication assurance. IDENTITY links to an AUTH principal by opaque reference only.
- USERS owns consumer account/profile state and self-declared adult status. Self-declaration is not verified evidence.
- CREATORS owns creator capability and business profile. IDENTITY owns creator-identity evidence.
- TRUST & SAFETY owns depicted-person relationships, declarations, consent, enforcement, and content eligibility. IDENTITY owns referenced depicted-person identity/adult evidence.
- BILLING and PAYOUTS own commercial and disbursement decisions. IDENTITY may own commercial-KYC evidence, but neither evidence nor a provider decision is payment, entitlement, or payout authorization.
- ADMIN receives privacy-minimized read contracts only. It does not verify, override, revoke, search, export, or mutate identity evidence.

IDENTITY writes only `identity_`-prefixed tables. It never reads or writes another domain's private tables. Owner domains authorize subjects and purposes through published contracts, and re-evaluate current evidence whenever they make a product decision.

## Subject and evidence model

A verification subject is `(owner_domain, owner_reference)` where the reference is opaque outside its owner. Initial subject kinds are AUTH principal, Creator capability, and TRUST & SAFETY depicted participant. One owner reference maps to at most one live Identity subject.

An attempt records purpose, required assurance, policy version, jurisdiction, server-selected provider, lifecycle, canonical input digest, caller idempotency key, platform provider-idempotency key, provider reference when known, and bounded timestamps. No client selects provider, assurance strength, workflow, or policy version.

Evidence is append-only. Each row records an explicit class, normalized result, threshold/context, opaque provider fact reference, validity interval, expiry when applicable, policy version, and the prior evidence it supersedes. Grant, refusal, expiry, and revocation are facts; none updates or deletes an earlier fact. A current answer is the non-stale tip of a valid supersession chain, evaluated against current owner policy.

Initial evidence classes are:

- `adult_threshold`
- `identity`
- `creator_identity`
- `commercial_kyc`
- `depicted_person_identity`
- `depicted_person_adult_threshold`

Classes never widen into each other. A verified identity is not automatically adult assurance, creator eligibility, KYC readiness, commercial eligibility, payout permission, or content consent.

## Attempt lifecycle

The durable lifecycle is:

`created -> provider_starting -> provider_pending -> processing -> terminal`

Terminal outcomes are `succeeded`, `refused`, `failed`, `expired`, `cancelled`, and `unavailable`. Provider I/O never occurs inside a database transaction.

1. Owner authorizes the actor, subject, purpose, and jurisdiction.
2. Server policy selects the required evidence classes and threshold.
3. IDENTITY commits the attempt and its stable provider-idempotency identity.
4. Provider adapter is called outside the transaction.
5. Provider reference or normalized failure is bound in a second transaction.
6. Verified callbacks or reconciliation advance the attempt and append evidence.

A timeout after step 3 is recoverable. Redirect return is an authorized read hint only; it never grants evidence. Competing terminal facts use lifecycle precedence and evidence supersession so a stale success cannot resurrect revoked or expired evidence.

## Provider event inbox, reconciliation, and outbox

The provider-event endpoint verifies raw bytes before parsing. Only verified events enter `identity_provider_events`, unique by provider, account, environment, and event identity. The row stores a body digest, normalized type/reference, delivery timestamps, lease/retry/dead-letter state, and no raw callback body.

Reconciliation records bounded, durable findings for missing references, provider/platform state drift, stuck attempts, expiry, callback gaps, and deletion/retention obligations. A finding is evidence of drift, not permission to overwrite owner-domain truth.

IDENTITY emits minimized lifecycle facts through its own transactional outbox. Facts carry opaque subject/evidence references, class, normalized lifecycle, policy version, validity/expiry, and correlation identity. They never carry names, exact birth dates, addresses, document numbers, images, biometrics, tax IDs, bank data, hosted URLs, or provider payloads.

## Provider and policy ports

`IdentityVerificationProvider` declares capabilities and supports hosted-session creation, lookup by provider reference or provider-idempotency key, raw callback verification/normalization, current-state retrieval, and cancellation/expiry only when declared. Domain code sees normalized types only.

Adapters are:

- `unavailable`: default in every environment; refuses external work.
- `local-test`: deterministic and network-free; allowed only in local/test. Configuration fails if selected in staging or production.

No real adapter or SDK is approved. Provider selection remains `DEFER UNTIL PROVIDER INTEGRATION`.

`IdentityJurisdictionPolicy` returns a versioned `UNKNOWN`, `BLOCKED`, or `ALLOWED_WITH_REQUIREMENTS` result. Unknown, unpublished, unsupported, or stale policy fails closed. Local/test bundles exercise version changes without claiming legal truth. Production publishes no jurisdiction policy until legal/privacy/compliance approval.

## Contracts

Core V1 platform routes are limited to:

- `POST /v1/identity/provider-events`: raw-body authenticated receipt; verified first or duplicate receipt returns `202`; opaque authentication failure returns `401`; oversized input returns `413`; unavailable provider configuration returns `503`.
- `GET /v1/admin/identity/state`: privacy-minimized provider, backlog, expiry, and reconciliation aggregates.
- `GET /v1/admin/identity/subject`: exact opaque-reference read only; no search, list, export, mutation, or raw provider evidence.

The consumer onboarding response remains compatible. USERS resolves verified adult assurance through an Identity reader contract while self-declaration remains USERS truth.

Consumer and Creator attempt routes are Phase 2. Commercial/KYC and payout-readiness product exposure are Phase 3. Contract existence does not advance either phase.

## Security and privacy invariants

- No raw documents, exact DOB, names, addresses, selfies, videos, biometric templates, tax IDs, bank data, callback bodies, or reusable hosted URLs are stored.
- Hosted URLs are secrets, short-lived, returned only to the authorized actor, never logged, and never placed in outbox or analytics.
- Callback verification covers provider, account, environment, signature/authentication, replay window, raw body, and bounded size before parsing or persistence.
- Logs contain IDs/digests, lifecycle, latency, and error class only. Free-form provider reasons and evidence never enter logs or traces.
- Cross-subject and cross-Creator reads are refused identically to absent records. Admin exact-reference reads require the Platform Admin audience, an explicit scoped read permission, and current Admin authentication assurance under ADR-0017; they are not a mutation or approval path.
- Evidence cannot authorize authentication, account recovery, creator activation, mature content, billing, entitlement, enforcement, payout, or privileged action by itself.

## Phase and unresolved decisions

V1 builds only the provider-neutral core, migration of existing verified evidence, fail-closed owner contracts, reconciliation, and read-only operations. Phase 2 owns consumer stronger-assurance and creator-verification workflows. Phase 3 owns commercial-KYC and payout-readiness exposure. Mature-content use remains conditional and blocked.

Foundation status: migration `0046_identity-assurance-foundation` establishes the Identity-owned subjects, attempts, append-only evidence, verified-receipt inbox, reconciliation findings, and outbox. No provider adapter, orchestration route, owner migration, or product surface is enabled by that migration. Existing USERS and SAFETY compatibility storage remains authoritative until its separately tested backfill/cutover migration lands.

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: launch jurisdictions, accepted methods and assurance thresholds, alternatives/manual review, provider, biometric/legal basis and notices, residency, retention/deletion, re-verification triggers, appeal/correction, sanctions/PEP requirements, commercial-KYC scope, and production operations.

See [verification flow](../flows/identity-assurance-verification.md), [threat model](../security/11-identity-verification-threat-model.md), [provider eligibility](../compliance/09-identity-verification-provider-eligibility.md), [operations](../operations/07-identity-verification-operations.md), and [ADR-0024](../decisions/ADR-0024-identity-assurance-architecture.md).
