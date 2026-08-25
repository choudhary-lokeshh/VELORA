# Monetisation product architecture

## Purpose

Define monetisable product catalogue and non-negotiable user-protection boundary. Financial lifecycle authority is [BILLING](../domains/billing.md); creator entitlement authority is [PRIVATE CLUBS](../domains/private-clubs.md).

## Consumer catalogue

V1 has no required paid feature. Phase 2 may add limited free usage plus premium subscription, priority/super invites, and boosts. Phase 3 may add advanced filters, coins, gifts, and paid visibility/control features. A payment may grant product entitlement or attempt/visibility mechanism; it must never promise access, attention, introduction, conversation, or relationship from another person.

## Creator catalogue

Phase 2 may add creator-specific monthly subscriptions, locked posts/media, and PPV individual unlocks. Phase 3 may add tips/gifts where allowed, platform commission, earnings and payouts. Each product has explicit eligibility, country/channel availability, refund/cancellation semantics, tax/compliance review, and customer-visible terms before launch.

## Implemented virtual-gift product

Virtual gifting is runnable only in local/test under [ADR-0032](../decisions/ADR-0032-provider-neutral-virtual-gifting.md). A platform-managed, data-driven catalog is projected into ordinary BILLING one-time offers and immutable prices. The first and only allowed context is a published creator profile: the server resolves the recipient from the public handle, refuses self-gifts and ineligible or blocked pairs, and accepts a catalog identity and currency rather than a client-supplied amount.

A gift is durable BILLING state: `pending -> sent | failed`, with `sent -> partially_reversed -> reversed` as verified refund or dispute facts require. Settlement crosses the configured provider adapter, verified webhook inbox, balanced customer-money journal, and creator-revenue event. It deliberately emits no entitlement fact and promises no access, reply, attention, introduction, conversation, or relationship.

Consumer Web exposes the catalog and confirmation on a published creator page and lists the caller's sent history. Creator Studio lists received gifts with sender identity withheld and shows gross plus the creator share posted by the journal, never a fabricated total or payout claim. Consumer Mobile exposes no purchase control. Local USD prices and the deterministic revenue allocation are fixtures, not approved production packaging or commission.

## Lifecycle and error rule

All money paths use an approved provider/product state machine coordinating intent/authorization/payment, entitlement, finalization, and compensation. Provider-specific ordering must prevent unearned charge, unpaid delivery, duplicate money movement, and fabricated success. Retries, webhooks, and duplicate user requests are idempotent. On ambiguous result, mark pending, reconcile from verified provider and entitlement-owner data, and do not double charge, double refund, or silently revoke earned access. See authoritative [payment lifecycle](../flows/payment-lifecycle.md).

## Security and data

BILLING stores provider tokens/references and normalized financial state, never raw card credentials. PRIVATE CLUBS receives verified entitlement inputs, not raw payment secrets. Finance actions require scoped authorization, audit, and approval limits. Pricing changes are versioned/audited; entitlement checks happen at delivery time.

## Open decisions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: product packaging/prices, taxes, refund policy, provider availability, app-store/channel rules, commission, creator payout terms, and any widening of sender visibility. No payment or payout provider is eligible today; [provider eligibility](../compliance/06-payment-provider-eligibility.md) records why, from primary sources. Read [phases](01-product-phases.md), [money flow](../architecture/10-money-flow.md), [payment security](../security/05-payments-webhooks.md), [payment/payout gates](../compliance/04-payments-tax-payout-gates.md), [finance operations](../operations/03-finance-payout-operations.md), [payouts](../domains/payouts.md), [creator clubs](03-creator-private-clubs.md), [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md), and [ADR-0032](../decisions/ADR-0032-provider-neutral-virtual-gifting.md).
