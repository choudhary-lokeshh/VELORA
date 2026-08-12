# Creator content entitlement flow

## Purpose

Define authorization required before private/paid creator content delivery. PRIVATE CLUBS owns entitlement; BILLING owns financial state; CREATORS owns creator eligibility; MODERATION/Trust & Safety constrain content and actor access.

## Preconditions

Creator is currently eligible, club/content is policy-eligible and published, visitor has adult/channel/country eligibility, no relevant enforcement/block restriction applies, and request references exact content/version.

## Main flow

1. Visitor initiates subscription or PPV unlock through BILLING or opens already entitled content.
2. BILLING creates/reuses idempotent commercial operation and verifies provider outcome.
3. PRIVATE CLUBS atomically grants/reuses entitlement keyed to commercial reference and content/club scope, if policy permits.
4. On each delivery request, PRIVATE CLUBS rechecks entitlement, content status, creator status, country/channel, and safety rules.
5. Authorized storage adapter returns short-lived, object-bound signed delivery; never a permanent public URL.

## Alternate/failure/revocation

Payment ambiguous: show pending and reconcile; no duplicate charge or uncontrolled delivery. Payment fail/cancel: no entitlement. Refund/chargeback/expiry/content removal/creator suspension/gate revocation: entitlement changes according to published terms and access recheck stops delivery. Duplicate webhook/action returns same state. Content processing/moderation failure stays unavailable.

Subscription lifecycle is explicit: `pending -> active -> renewal_pending/grace -> active` or `cancel_at_period_end -> expired`, with `suspended/revoked` for policy/financial state. Cancellation, renewal failure, grace, refund, dispute, and chargeback do not infer access locally; PRIVATE CLUBS evaluates the current versioned commercial fact and published customer terms. PPV entitlement is separately scoped to exact content/product and may be revoked only under approved refund, dispute, content, safety, or compliance policy.

## Security/data/concurrency/events

Clients never decide entitlement. Unique entitlement grant key, transactional version/check, verified webhook, audit record, and revocation event protect races. Store payment reference not raw payment data; record access decision without media payload. Events: commercial confirmed, entitlement granted/revoked, delivery authorization, content status.

## Phase/cross-references

Phase 2. Mature/explicit content is Conditional / Compliance-Gated. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: renewal/grace/cancellation/refund/dispute access policy and customer communication. See [PRIVATE CLUBS](../domains/private-clubs.md), [Creator Private Clubs](../product/03-creator-private-clubs.md), [payment lifecycle](payment-lifecycle.md), [payment/payout gates](../compliance/04-payments-tax-payout-gates.md), [media security](../security/04-media-upload-delivery.md).
