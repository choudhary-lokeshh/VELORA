# CREATORS domain

## Purpose and scope

CREATORS owns creator application, creator identity/business profile, creator verification status, and creator eligibility to operate platform features. It does not own club memberships/content entitlements, customer charges, payout transfer truth, or ordinary discovery.

A creator is a capability attached to an existing authenticated principal, never a second credential, account, or authentication silo. AUTH keeps the credential and the session; USERS keeps the consumer account; one principal may hold both a consumer and a creator identity, and the two remain separate domain concepts with separate identifiers. V1 supports one creator capability per principal; teams, agencies, and delegated staff access stay `DECISION REQUIRED`.

## Flow and state

User explicitly requests creator capability; CREATORS records it idempotently and applies the activation gates. [ADR-0020](../decisions/ADR-0020-creator-capability-activation.md) locks the implemented ladder as `applicant -> active`, with `suspended` for safety, compliance, or platform action and `closed` for an ended capability. Activation requires a consumer account in good standing, adult assurance at least `self_declared` read from the standing contract USERS publishes, and acknowledgement of every currently required creator policy document at its current version. Nobody becomes a creator by being a consumer.

Admission is derived from stored evidence on every read and reconciled in both directions: a capability whose adult standing lapses, or that faces a newly required policy version, returns from `active` to `applicant`. Suspension and closure are set by decisions this reconciliation does not own and are never lifted by it.

Creator identity and business verification is a separate predicate, not a lifecycle state. No provider is approved and its criteria are open, so it is unsatisfiable today; it gates mature/explicit content and payout readiness, both already deferred, and never the ability to hold the capability. When a provider is approved, its outcome stores provider/reference and policy version, not unnecessary raw documents. No legal name, business registration, tax identifier, bank account, payout credential, or identity document is collected merely because a creator account exists.

CREATORS owns the creator public profile and the canonical handle that addresses it. The handle is lower-case ASCII, canonicalized server-side, unique case-insensitively by construction, checked against a reserved list covering application routes and identity-adjacent words, and claimed once — self-service rename is out of scope for this milestone because no redirect exists for links already shared. Profile edits carry the version the caller read and a stale one is refused rather than applied. Publication is an explicit separate decision: saving never makes a page public, publishing requires an active capability, and every public read rechecks current creator state, so a suspension removes a page without anybody unpublishing it. What a visitor receives is an allow-listed projection built field by field, never a filtered record.

Active creator may manage own approved business profile and request club capability. Revocation/suspension publishes event for PRIVATE CLUBS, PAYOUTS, and Admin to restrict affected operations. Creator suspension does not by itself suspend the person's consumer capability; a global restriction is a separate TRUST & SAFETY decision.

## Security and compliance

Creator role, identity verification, age verification, payout readiness, and content eligibility are separate predicates. Creator authority is carried by the Creator Studio audience alone; a Consumer Web, Consumer Mobile, or Platform Admin credential is refused before any creator lookup happens on its behalf. Least-privilege Studio authorization limits actor to own creator entity, and no creator endpoint accepts a creator identifier from a caller — the acting capability is always the one the presented credential resolves to. Creator status is never trusted from client input. Exactly one capability exists per principal under concurrency, enforced by a database uniqueness constraint rather than a lock. Sensitive evidence has restricted access, purpose limitation, retention, audit, and no consumer exposure. Duplicate verification callbacks are deduped; competing review actions require version/approval guard.

Policy acknowledgement evidence is append-only and versioned: re-submitting an acknowledgement already held never rewrites when the person agreed, and publishing approved copy is a version bump that asks everybody again while preserving what they accepted before.

## Phase/events/open questions

Phase 2 web-first creator identity/business pilot; further capabilities follow product phases. Events: application/status/profile lifecycle, minimized proof reference. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: criteria, manual review, age/identity provider, tax/payout prerequisites, suspension appeal policy, and approved creator legal copy — required creator policy documents are recorded at an explicitly unpublished version until that copy exists. See [ADR-0020](../decisions/ADR-0020-creator-capability-activation.md), [Creator Studio](../surfaces/03-creator-studio.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [creator/content gates](../compliance/03-creator-content-gates.md), [Creator Private Clubs](../product/03-creator-private-clubs.md), [USERS](users.md), [MODERATION](moderation.md), [PAYOUTS](payouts.md).
