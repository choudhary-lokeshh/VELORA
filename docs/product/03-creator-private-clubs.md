# Creator Private Clubs

## Purpose and boundary

Define future web-first Creator Private Clubs. Creator identity/business profile belongs to CREATORS; club membership, paid/private content catalog, and access entitlements belong to PRIVATE CLUBS; financial source of truth belongs to BILLING/PAYOUTS. Club access never changes ordinary consumer discovery eligibility.

## Actors

Visitor views public creator surface subject to policy. Subscriber holds valid club entitlement. Creator manages verified creator profile, permitted club, pricing/content, and subscriber-facing experience. Moderator handles safety workflow. Finance/Admin handles limited financial operations. Owner/Super Admin governs platform configuration under audit.

## Phase 2 baseline flow

Creator satisfies required onboarding/verification gate, opens club if policy allows, publishes eligible content metadata, and offers a subscription or eligible individual unlock. Billing reports confirmed financial state; PRIVATE CLUBS grants/revokes creator-specific entitlement. Delivery authorization checks entitlement, country/channel policy, content status, enforcement, and signed-media permission every time before issuing access. Creator sees only authorized operational club-management views. Creator analytics and earnings views are Phase 3.

## Non-goals and constraints

Not a consumer dating/discovery feature, payment-provider bypass, or universal creator market. No visitor gets private/paid content from a URL alone. No payout until payout infrastructure, identity/tax/compliance, dispute treatment, and operational controls are approved. Mobile availability may differ from web and cannot be assumed.

## Conditional mature/explicit content

This capability is disabled by default and is **Conditional / Compliance-Gated**, never globally enabled. Enable only per country/channel/content category after all gates: adults-only access; creator identity verification; required age verification; consent and ownership controls; moderation and prohibited-content controls; compatible payment/provider; country-level feature enablement; legal/compliance review; operations escalation; auditability and removal workflow. Failure or revoked gate removes availability and active delivery immediately where lawful.

## Security/concurrency/events

Separate creator role from creator verification and club eligibility. Private media uses validated quarantined uploads and short-lived object-bound signed delivery. Entitlement grant/revoke is idempotent and versioned against payment/content state. Audit creator pricing, content status, access policy, moderation, refunds, and privileged overrides. Events include club membership/content/entitlement lifecycle, never raw media or sensitive verification material.

## Creator AI boundary

Phase 3 AI may assist with drafts, organization, policy-aware preparation, and explanation of creator-authorized analytics. It may not publish content, change pricing, grant/revoke entitlement, charge/refund, initiate payout, assert compliance eligibility, or bypass moderation without explicit registered workflow, creator/human approval, and owning-domain authorization. AI memory and RAG cannot expose subscriber/private content beyond current authorization. AI support never enables mature/explicit content outside all Conditional / Compliance-Gated controls.

## Open questions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: creator launch countries, onboarding criteria, content taxonomy, taxes, provider/channel compatibility, subscription lifecycle, revocation grace policy. See [Creator Studio](../surfaces/03-creator-studio.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [PRIVATE CLUBS](../domains/private-clubs.md), [creator entitlement](../flows/creator-entitlement.md), [creator/content gates](../compliance/03-creator-content-gates.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [monetisation](05-monetisation.md), [media security](../security/04-media-upload-delivery.md), [payouts](../domains/payouts.md).
