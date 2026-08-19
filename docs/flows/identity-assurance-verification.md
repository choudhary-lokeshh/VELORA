# Identity assurance verification flow

## Authority and phase

This flow owns provider-neutral verification orchestration and failure recovery. V1 exposes only platform callback and read-only operations contracts. Consumer/Creator initiation is Phase 2; commercial-KYC/payout exposure is Phase 3; mature-content use is conditional and blocked.

Current implementation exposes the start sequence only as an internal contract for an owner application service that already authorized actor, subject, purpose, and jurisdiction. The provider callback route and leased worker sequence below are implemented. USERS consumes current adult-threshold decisions through a published read contract after the transactional legacy cutover. SAFETY consumes the exact depicted-person identity/adult answer through its published reader while retaining only participant linkage and consent; IDENTITY publishes coarse Creator-identity and commercial-KYC readers, but no V1 Creator predicate, Phase 3 payout-readiness predicate, or product surface uses either. Reconciliation and Admin consumption remain unimplemented. There is no Consumer, Creator, Admin, or general-purpose HTTP start route. The default provider/policy configuration refuses before persistence; local/test fixtures exercise recovery without network access or legal/provider claims.

## Start and hosted handoff

1. Owning domain authorizes the actor, subject, purpose, and jurisdiction through a published Identity contract.
2. Jurisdiction policy returns a published version and either `UNKNOWN`, `BLOCKED`, or `ALLOWED_WITH_REQUIREMENTS`. Unknown and blocked stop before an attempt.
3. Server selects required assurance and provider from configuration/policy. Clients cannot select either.
4. IDENTITY canonicalizes the request, takes an operation lock, and creates or resolves an attempt by `(owner, subject, purpose, caller idempotency key)`. Same key with changed canonical input is a conflict.
5. The attempt and platform provider-idempotency key commit.
6. IDENTITY calls the provider outside the transaction. A timeout is ambiguous, not a failure.
7. IDENTITY binds the provider reference and short-lived hosted handoff in a second transaction. Hosted URLs are returned once to the authorized actor and are never persisted as reusable product data.

Fifty equivalent concurrent starts converge on one attempt and at most one external instruction. Provider lookup by the platform idempotency key resolves an ambiguous create before any retry.

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

Reconciliation recovers missing callbacks, ambiguous starts, stuck attempts, expiry, and provider/platform drift. It reads bounded indexed pages, never scans unbounded history, and records findings before repair. Reconciliation cannot make an owner-domain product decision.

## Evidence consumption

An owner asks for current evidence by exact opaque subject, class, threshold/context, jurisdiction, and policy requirement. IDENTITY returns the evidence fact and why it is current; the owner then re-authorizes the caller and computes its own predicate.

- USERS combines current Identity adult-threshold evidence with its own self-declaration/account/profile state.
- CREATORS combines creator-identity evidence with creator capability, policy acknowledgement, safety, and product phase.
- TRUST & SAFETY combines depicted-person identity/adult evidence with its own participant relationship and scoped consent.
- PAYOUTS may later combine commercial-KYC evidence with creator, safety, billing, tax, country, and payout-provider state.

No owner stores a master `verified`, `kycReady`, `commercialEligible`, or `payoutAllowed` boolean.

## Failure and user states

Required states for later approved surfaces are required, starting, provider handoff, pending, verified, failed, refused, expired, revoked, re-verification, unavailable, offline, stale return, and session loss. Exact copy/layout remains `DESIGN REQUIRED` until the approved Identity Assurance Figma handoff.

Provider outage, policy uncertainty, callback authentication failure, inconsistent subject, and ambiguous result fail closed. A retriable technical failure is not a refusal; a refusal does not reveal fraud thresholds or raw provider reasons. Alternate/manual routes exist only when a published jurisdiction policy and approved operation define them.

## Authorization and approvals

Owners authorize every start/read. Consumer and creator credentials can access only their own later-phase routes. Platform Admin receives exact-reference read and aggregate health only. Manual grant, override, provider-dashboard decision, force-retry, evidence revocation, or deletion is not exposed until a separate legal/product/security decision defines actor, evidence standard, exact action, approval, expiry, appeal, and audit under ADR-0017.

## Cross-references

[IDENTITY ASSURANCE](../domains/identity-assurance.md), [jobs/idempotency](../engineering/03-jobs-idempotency-concurrency.md), [API contracts](../engineering/01-api-contracts.md), [privacy](../security/03-privacy-retention.md), [threat model](../security/11-identity-verification-threat-model.md), [adult verification](../compliance/02-adult-age-verification.md).
