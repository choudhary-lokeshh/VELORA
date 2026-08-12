# Account deletion and retention flow

## Purpose

Define user-initiated account deletion while preserving strictly necessary lawful financial, fraud, safety, and audit evidence. USERS coordinates request; each domain deletes/de-identifies its data it owns.

## Preconditions

Authenticated subject passes re-authentication where risk policy requires. UI explains access loss, pending transactions/subscriptions, retention exceptions, and cancellation consequences. Deletion request is not a mechanism to evade active safety/legal review.

## Main flow

1. USERS records idempotent deletion request and transitions account to `deletion_pending`; consumer access is limited/removed under policy.
2. USERS queries owner domains for documented holds and consequences; active commercial product cancellation follows BILLING terms.
3. After grace/required processing, publish account deletion lifecycle event via outbox.
4. Owners delete or irreversibly de-identify personal data, revoke sessions/media tokens/entitlements where appropriate, and clear projections/search/notifications.
5. USERS records completion plus retained-exception categories, not unnecessary copied data.

## Alternate/failure flow

User may cancel during defined grace only if no irreversible action/hold prevents it. Legal/security/financial hold delays erasure of narrowly required data, not unrestricted account access. Job failure retries durably and exposes operational status; duplicate events are harmless. Deletion from one client affects shared consumer account across Web/Mobile and creator capability where policy requires.

## Security, data, audit

Verify requester, prevent account enumeration, revoke sessions, suppress marketing, and restrict residual records. Retained records remain access-controlled, purpose-limited, retention-expiring, and audit logged. No raw deletion evidence in analytics. Admin cannot casually undo erased data.

## Phase/open questions

V1 baseline. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: grace period, export-before-delete, hold categories/durations, regional requirements, creator/payout consequences. See [USERS](../domains/users.md), [data ownership](../architecture/05-data-ownership.md), [privacy](../security/03-privacy-retention.md), [data residency/retention](../compliance/05-data-residency-retention.md).
