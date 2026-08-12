# PRIVATE CLUBS domain

## Purpose and scope

PRIVATE CLUBS owns creator club configuration, membership, permitted content metadata/status, and creator-specific access entitlements. It does not own creator verification, charge/refund truth, general discovery, raw media storage, or payout transfers.

## Main flow/state

Eligible verified creator opens policy-permitted club. Content moves `draft -> submitted/processing -> published -> restricted/removed`; only eligible published content can be offered. A club membership/content entitlement moves `pending -> active -> suspended/revoked/expired`. BILLING financial confirmation plus policy checks drives grant; content delivery checks entitlement and current content/creator/country/enforcement status every request.

## Alternates/failure/concurrency

Duplicate financial event or user purchase request resolves one entitlement operation by unique commercial reference/idempotency key. If final charge outcome is ambiguous, entitlement remains policy-defined pending or constrained, then reconciles; never blindly duplicate or grant permanent access. Refund/chargeback, creator suspension, content removal, block, geographic gate, or compliance disable may revoke access under published terms. Visitor URL never bypasses check.

## Security/data/permissions

Creator manages only own club/content/pricing within policy; subscriber sees own valid access; moderator/admin uses scoped audited actions. Store access decisions/entitlement version, not payment credentials. Media is private validated object with short-lived object-bound signed access. Mature/explicit content stays disabled until all compliance gates in product authority pass.

## Phase/events/open questions

Phase 2 pilot: club/subscription/locked content/PPV only after decisions. Events: club/content/membership/entitlement lifecycle. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: subscription grace/cancellation/refund linkage, tiering, audience limits, content taxonomy and country rules. See [creator lifecycle](../flows/creator-lifecycle-content.md), [creator entitlement](../flows/creator-entitlement.md), [creator/content gates](../compliance/03-creator-content-gates.md), [BILLING](billing.md), [media security](../security/04-media-upload-delivery.md).
