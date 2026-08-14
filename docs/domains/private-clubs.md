# PRIVATE CLUBS domain

## Purpose and scope

PRIVATE CLUBS owns creator club configuration, membership, permitted content metadata/status, and creator-specific access entitlements. It does not own creator verification, charge/refund truth, general discovery, raw media storage, or payout transfers.

## Implemented today

The creator content catalog exists under the `clubs_` prefix and is owned here rather than by CREATORS, because what a creator *is* and what a creator *publishes* have different owners, lifecycles, and audiences. An item moves `draft -> published -> archived`, with `archived -> draft` the only way back: archiving withdraws without destroying the record, and returning something to public view is a fresh decision rather than an undo. Every transition names the version it expects, so two simultaneous publications of one item settle as one.

Visibility is `public` or `members_only` from the start. `members_only` is deliberately unreachable by anybody today — no club, membership, or entitlement exists yet, so the read path has nobody to admit and refuses. That is fail-closed by construction rather than by a filter somebody has to remember.

The public catalog is a bounded, keyset-paged projection of published public items for an active creator whose profile is published, ordered by the publication instant, which never moves once set. Lifecycle, visibility, creator identifier, and version are in the predicate and never in the response. A creator who stops being active takes their whole catalog down without anybody unpublishing anything, because the read rechecks current creator state rather than trusting the flag.

The creator a row belongs to is an opaque CREATORS identifier with no foreign key, and this domain reaches CREATORS only through its published directory contract.

Content facts are not yet published through the outbox. The relay dead-letters an event no consumer is registered for, and no consumer for creator content exists: inventing a notification nobody has specified would be inventing product behaviour, so the events arrive with the domain that needs them.

## Main flow/state

Eligible verified creator opens policy-permitted club. Content moves `draft -> submitted/processing -> published -> restricted/removed`; only eligible published content can be offered. A club membership/content entitlement moves `pending -> active -> suspended/revoked/expired`. BILLING financial confirmation plus policy checks drives grant; content delivery checks entitlement and current content/creator/country/enforcement status every request.

## Alternates/failure/concurrency

Duplicate financial event or user purchase request resolves one entitlement operation by unique commercial reference/idempotency key. If final charge outcome is ambiguous, entitlement remains policy-defined pending or constrained, then reconciles; never blindly duplicate or grant permanent access. Refund/chargeback, creator suspension, content removal, block, geographic gate, or compliance disable may revoke access under published terms. Visitor URL never bypasses check.

## Security/data/permissions

Creator manages only own club/content/pricing within policy; subscriber sees own valid access; moderator/admin uses scoped audited actions. Store access decisions/entitlement version, not payment credentials. Media is private validated object with short-lived object-bound signed access. Mature/explicit content stays disabled until all compliance gates in product authority pass.

## Phase/events/open questions

Phase 2 pilot: club/subscription/locked content/PPV only after decisions. Events: club/content/membership/entitlement lifecycle. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: subscription grace/cancellation/refund linkage, tiering, audience limits, content taxonomy and country rules. See [creator lifecycle](../flows/creator-lifecycle-content.md), [creator entitlement](../flows/creator-entitlement.md), [creator/content gates](../compliance/03-creator-content-gates.md), [BILLING](billing.md), [media security](../security/04-media-upload-delivery.md).
