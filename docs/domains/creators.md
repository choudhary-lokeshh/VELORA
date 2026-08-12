# CREATORS domain

## Purpose and scope

CREATORS owns creator application, creator identity/business profile, creator verification status, and creator eligibility to operate platform features. It does not own club memberships/content entitlements, customer charges, payout transfer truth, or ordinary discovery.

## Flow and state

User requests creator role; required checks transition `applicant -> under_review -> verified/declined/suspended/revoked`. Verification outcome stores provider/reference and policy version, not unnecessary raw documents. Verified creator may manage own approved business profile and request club capability. Revocation/suspension publishes event for PRIVATE CLUBS, PAYOUTS, and Admin to restrict affected operations.

## Security and compliance

Creator role, identity verification, age verification, payout readiness, and content eligibility are separate predicates. Least-privilege Studio authorization limits actor to own creator entity. Sensitive evidence has restricted access, purpose limitation, retention, audit, and no consumer exposure. Duplicate verification callbacks are deduped; competing review actions require version/approval guard.

## Phase/events/open questions

Phase 2 web-first creator identity/business pilot; further capabilities follow product phases. Events: application/status/profile lifecycle, minimized proof reference. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: criteria, manual review, age/identity provider, tax/payout prerequisites, suspension appeal policy. See [Creator Studio](../surfaces/03-creator-studio.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [creator/content gates](../compliance/03-creator-content-gates.md), [Creator Private Clubs](../product/03-creator-private-clubs.md), [MODERATION](moderation.md), [PAYOUTS](payouts.md).
