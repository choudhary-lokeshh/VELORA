# Identity assurance verification flow

## Authority and phase

This flow owns provider-neutral verification orchestration and failure recovery. V1 exposes only platform callback and read-only operations contracts. Consumer/Creator initiation is Phase 2; commercial-KYC/payout exposure is Phase 3; mature-content use is conditional and blocked.

Current implementation exposes the start sequence only as an internal contract for an owner application service that already authorized actor, subject, purpose, and jurisdiction. The provider callback route, leased worker sequence, and bounded provider-truth reconciliation below are implemented. USERS consumes current adult-threshold decisions through a published read contract after the transactional legacy cutover. SAFETY consumes the exact depicted-person identity/adult answer through its published reader while retaining only participant linkage and consent; IDENTITY publishes coarse Creator-identity and commercial-KYC readers, but no V1 Creator predicate, Phase 3 payout-readiness predicate, or product surface uses either. Admin consumption remains unimplemented. There is no Consumer, Creator, Admin, or general-purpose HTTP start route. The default provider/policy configuration refuses before persistence; local/test fixtures exercise recovery without network access or legal/provider claims.

## Start and hosted handoff

1. Owning domain authorizes the actor, subject, purpose, and jurisdiction through a published Identity contract.
2. Jurisdiction policy returns a published version and either `UNKNOWN`, `BLOCKED`, or `ALLOWED_WITH_REQUIREMENTS`. Unknown and blocked stop before an attempt.
3. Server selects required assurance and provider from configuration/policy. Clients cannot select either.
4. IDENTITY canonicalizes the request, takes an operation lock, and creates or resolves an attempt by `(owner, subject, purpose, caller idempotency key)`. Same key with changed canonical input is a conflict.
5. The attempt and platform provider-idempotency key commit.
6. IDENTITY calls the provider outside the transaction. A timeout is ambiguous, not a failure.
7. IDENTITY binds the provider reference and short-lived hosted handoff in a second transaction. Hosted URLs are returned once to the authorized actor and are never persisted as reusable product data.

Fifty equivalent concurrent starts converge on one attempt and at most one external instruction. Provider lookup by the platform idempotency key resolves an ambiguous create before any retry.

## Current-policy and re-verification assessment

IDENTITY can compare a minimized current evidence fact with the currently evaluated policy for the same documented owner/purpose pairing and jurisdiction. The comparison returns only `current`, `no_current_grant`, `policy_unknown`, `policy_blocked`, or `reverification_due` because an evidence expiry, policy-version change, or requirement change is observed. Unknown and blocked are fail-closed.

This comparison is not an authorization decision and has no side effect: it does not start a provider session, append evidence, revoke evidence, change an attempt state, enqueue a job, or expose a route. It records no re-verification window or country rule. V1 owner predicates do not consume it. A later approved owner workflow must re-authorize its actor, apply an approved jurisdiction/legal policy, and create an idempotent start through the normal internal contract; no automatic re-verification is implied.

## Return, callback, and reconciliation

Browser/app redirect return performs an authorized read of the attempt. Redirect parameters never constitute completion or evidence.

The callback sequence is:

1. Enforce a strict body limit against raw bytes.
2. Resolve configured provider/account/environment without a client-selected adapter.
3. Verify authenticity over the raw body before JSON parsing, apply any provider-supported freshness rule, and bind replay handling to the provider event identity.
4. Normalize the minimal event identity and reference.
5. Commit first or duplicate verified receipt and answer `202` quickly.
6. A worker claims the inbox row under a lease, retrieves current provider state when required, verifies subject/reference/environment consistency, applies lifecycle precedence, appends evidence, writes minimized outbox facts, and settles the inbox row.

Fifty duplicates converge on one receipt and one state transition. Events may be duplicated, delayed, reordered, or concurrent. A stale approval cannot supersede a later refusal, expiry, or revocation. A worker crash before commit repeats safely; after commit it cannot duplicate evidence.

Reconciliation recovers missing callbacks, ambiguous starts, stuck attempts, later expiry/revocation of a succeeded attempt, and provider/platform drift. It takes a bounded indexed page of due attempts under `for update skip locked`, advances only a technical `reconciliation_checked_at` marker, then performs provider I/O after the transaction commits. A crashed worker either leaves the row immediately due or delays only the next provider read until the next cadence; it cannot lose or mutate an evidence fact. A matching missing provider state records a normalized `callback_gap` finding before the existing callback-application path appends evidence/outbox facts; the finding settles only after that path commits. A `created` attempt records a stuck finding and is never started autonomously. Retrieval failure, invalid normalized output, identity mismatch, and invalid state progression produce no evidence and no owner-domain effect. Reconciliation cannot make an owner-domain product or privacy decision, execute deletion/retention/provider erasure, or perform manual repair.

## Evidence consumption

An owner asks for current evidence by exact opaque subject, class, threshold/context, jurisdiction, and policy requirement. IDENTITY returns the evidence fact and why it is current; the owner then re-authorizes the caller and computes its own predicate.

- USERS combines current Identity adult-threshold evidence with its own self-declaration/account/profile state.
- CREATORS combines creator-identity evidence with creator capability, policy acknowledgement, safety, and product phase.
- TRUST & SAFETY combines depicted-person identity/adult evidence with its own participant relationship and scoped consent.
- PAYOUTS may later combine commercial-KYC evidence with creator, safety, billing, tax, country, and payout-provider state.

No owner stores a master `verified`, `kycReady`, `commercialEligible`, or `payoutAllowed` boolean.

## Failure and user states

Required states for later approved surfaces are required, starting, provider handoff, pending, verified, failed, refused, expired, revoked, re-verification, unavailable, offline, stale return, and session loss. Exact copy/layout remains `DESIGN REQUIRED` until the approved Identity Assurance Figma handoff.

Provider outage, policy uncertainty, callback authentication failure, inconsistent subject, and ambiguous result fail closed. A current-policy comparison may make a future approved workflow re-evaluate evidence, but never initiates it itself. A retriable technical failure is not a refusal; a refusal does not reveal fraud thresholds or raw provider reasons. Alternate/manual routes exist only when a published jurisdiction policy and approved operation define them.

## Authorization and approvals

Owners authorize every start/read. Consumer and creator credentials can access only their own later-phase routes. Platform Admin receives exact-reference read and aggregate health only. Manual grant, override, provider-dashboard decision, force-retry, evidence revocation, or deletion is not exposed until a separate legal/product/security decision defines actor, evidence standard, exact action, approval, expiry, appeal, and audit under ADR-0017.

## Cross-references

[IDENTITY ASSURANCE](../domains/identity-assurance.md), [jobs/idempotency](../engineering/03-jobs-idempotency-concurrency.md), [API contracts](../engineering/01-api-contracts.md), [privacy](../security/03-privacy-retention.md), [threat model](../security/11-identity-verification-threat-model.md), [adult verification](../compliance/02-adult-age-verification.md).
