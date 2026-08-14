# ADR-0020: Creator capability, activation gates, and the verification predicate

- Decision date: 2026-08-15
- ADR status: Accepted
- Owners: Founder (decision owner), CREATORS, USERS, security

## Context

[Product phases](../product/01-product-phases.md) classifies creator identity and the web-first club pilot as Phase 2, to be built after V1 learning and stability using V1 seams. Consumer Core V1 is frozen and green, so that work is now in scope.

[The creator lifecycle flow](../flows/creator-lifecycle-content.md) draws the creator ladder as `Applicant -> UnderReview -> Verified -> Active`, with `Declined` and `Revoked`. Two of those transitions cannot be built:

- `UnderReview -> Verified` is a creator identity and business verification decision. No verification provider is approved, the criteria are `DECISION REQUIRED`, and the age and identity verification row in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md) is explicitly open.
- `Verified -> Active` additionally requires country, content-category, provider, and operations gates that are open in [creator and content gates](../compliance/03-creator-content-gates.md).

Implementing them anyway would put states in the schema that no code could ever move a row out of, and a `verified` value that nothing is entitled to write is worse than no value at all: it invites a later change to set it for convenience.

At the same time the platform does hold a real adult answer. USERS records adult assurance as append-only evidence with distinct classes, and V1 consumer core already runs on `self_declared` because no age-verification provider is approved.

## Requirements

- A creator is a capability on an existing authenticated principal, never a second credential, account, or authentication silo.
- Creator activation consults the platform's adult authority through a published contract; CREATORS does not decide age and does not read `users_` tables.
- Nobody becomes a creator by being a consumer. The capability is established by an explicit request and by nothing else.
- Required creator policy acknowledgement is stored durably, versioned, and append-only.
- No legal name, business registration, tax identifier, bank account, payout credential, or identity document is collected merely because a creator account exists.
- Every state a row can hold must be reachable and leavable by code that exists.
- Identity verification must remain a separate predicate that a later provider can satisfy without rewriting creator authorization.
- Exactly one creator capability per principal, under concurrency, without a lock.

## Decision

Creator capability is a CREATORS-owned row keyed by the AUTH account identifier, with the lifecycle `applicant -> active`, plus `suspended` and `closed`.

Activation requires, at the time it is evaluated:

1. the principal has a consumer account,
2. that account is in good standing — not restricted, deleting, deactivated, or erased,
3. its adult assurance is at least `self_declared`, read from USERS' published standing contract, and
4. every currently required creator policy document is acknowledged at its current version.

`under_review`, `verified`, and `declined` are **not** creator lifecycle states. Creator identity and business verification is a separate predicate with no approved provider, recorded as its own fact when one exists. It gates mature or explicit content and payout readiness — both already deferred — and never the ability to hold the capability.

Required creator policy documents are `creator_terms` and `creator_content_policy`, both at version `0-unpublished`, matching how USERS records consumer policy versions.

Creator authority is carried by the `creator_studio` audience alone. A Consumer Web, Consumer Mobile, or Platform Admin credential is refused before any creator lookup happens on its behalf.

Admission is derived from stored evidence on every read rather than cached in a column, and reconciled in both directions: a capability whose adult standing lapses, or that faces a newly required policy version, returns from `active` to `applicant`.

## Why

The four gates above are the ones the platform can actually decide today, each from an authority that owns it. Adding a fifth that no provider can answer would not make the product safer; it would make the capability unreachable in every environment, which is a different thing from being strict.

Separating verification from lifecycle is what [creator and content gates](../compliance/03-creator-content-gates.md) already requires — "passing one predicate never implies another" — and it is what lets a verification provider be added later as a new fact rather than as a migration of every creator row through states that had no meaning when they were written.

`self_declared` matches the bar V1 consumer core runs on. It is deliberately a separate constant from the consumer one, so raising the creator bar once a provider exists is one decision rather than two coupled ones.

Deriving the step rather than storing it removes the class of bug where a stored ladder position disagrees with the evidence behind it. Reconciling downward matters more than upward: without it a creator would stay `active`, and therefore able to operate, on evidence they no longer hold.

One capability per principal is enforced by a unique index on the AUTH account identifier rather than by an advisory lock, because a unique constraint already expresses the invariant. Concurrent first calls all attempt the insert, PostgreSQL admits one, and the losers read the winner's row — so a caller never receives an error for having been a microsecond late. The adult gate is evaluated outside the insert, because it calls another domain's contract and [jobs, idempotency and concurrency](../engineering/03-jobs-idempotency-concurrency.md) forbids holding a transaction open across work this domain does not own.

There is deliberately no foreign key from `creators_accounts` to `auth_accounts` or `users_accounts`. [Data ownership](../architecture/05-data-ownership.md) requires cross-domain references to be stable identifiers rather than shared schema, and a cascade from another domain would let a deletion there silently erase creator state that [account deletion](../flows/account-deletion.md) says the owning domain must coordinate.

## Rejected alternatives

**Implement the documented `UnderReview`/`Verified`/`Declined` states now, with a provider-refusing verifier.** It reads as more faithful to the flow document and is worse in practice: every creator would sit permanently in `under_review`, the whole Phase 2 pilot would be unreachable, and the states would exist purely as decoration. The seam this ADR keeps — verification as a separate predicate — is what the compliance authority actually asks for.

**Grant creator capability automatically to any adult consumer.** Rejected outright. It would make a creator capability something a person acquired without asking, and no policy acknowledgement evidence would exist for anybody.

**Require a complete discoverable consumer profile.** That is a discovery requirement, not an adult one. A person who has not finished a consumer profile has done nothing wrong, and coupling the two would make creator capability depend on a product decision that has nothing to do with it.

**Let USERS answer "may operate as a creator".** That would put a CREATORS rule inside USERS. USERS publishes facts — assurance level, standing — and CREATORS applies its own bar to them, so the two can move independently.

**A second creator credential or sign-in.** Forbidden by [AUTH](../domains/auth.md) and [ADR-0009](ADR-0009-auth-authorization.md); AUTH owns credentials and sessions, and a parallel silo would be a second authority over the same person.

## Consequences

- Creator capability is reachable in development and test, and in any deployed environment where the adult declaration path works, without inventing verification.
- Mature and explicit creator content stays `Conditional / Compliance-Gated` and payouts stay deferred; both now have a named predicate to depend on rather than an implied one.
- When creator legal copy is approved, the version string changes in one place, every creator is asked again, and the evidence that they accepted the earlier version is preserved.
- When a verification provider is approved, it lands as a new CREATORS-owned fact plus a gate on the capabilities that need it. The creator lifecycle, the activation code, and existing rows do not change.
- [The creator lifecycle flow](../flows/creator-lifecycle-content.md) and [CREATORS](../domains/creators.md) are updated to state this ladder and to name verification as a separate predicate.

## Cross-references

[CREATORS](../domains/creators.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [creator and content gates](../compliance/03-creator-content-gates.md), [adult age verification](../compliance/02-adult-age-verification.md), [USERS](../domains/users.md), [domain boundaries](../architecture/03-domain-boundaries.md), [data ownership](../architecture/05-data-ownership.md), [Creator Studio](../surfaces/03-creator-studio.md), [ADR-0009](ADR-0009-auth-authorization.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
