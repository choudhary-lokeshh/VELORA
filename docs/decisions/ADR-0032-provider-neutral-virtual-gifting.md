# ADR-0032: Provider-neutral virtual gifting on the frozen money architecture

- Decision date: 2026-08-25
- ADR status: Accepted
- Owners: Founder (decision owner), BILLING, CREATORS, Consumer Web, Creator Studio, security, finance operations

## Context

[ADR-0021](ADR-0021-monetization-money-architecture.md) froze the provider-neutral money architecture: immutable offers and prices, prepare-commit-call-record orchestration, a verified provider-event inbox, a balanced append-only BILLING journal, published revenue facts, reversals, reconciliation, and configuration that makes test commerce impossible in staging and production. It deliberately did not define a gift product.

Virtual gifting now needs a real product object and visible local/test flow without selecting a payment provider, publishing commercial terms, or weakening any production refusal. A gift is support for a creator. It is not access to content, a private club, attention, a reply, or any other interpersonal outcome.

## Decision

BILLING owns the gift operation. A gift records the sender, the CREATORS-published recipient identity snapshot, the platform catalog item, the exact offer and price used by its payment, its restricted context, its lifecycle, its payment reference, timestamps, version, and sender-scoped idempotency identity. The operation and its catalog identity are retained and database-frozen; lifecycle changes are forward-only.

The first allowed context is a published creator profile. The API derives the recipient from the handle through CREATORS' published directory, rechecks the creator's standing and the TRUST & SAFETY pair rule at execution time, and refuses self-gifting. No request may name an amount, a creator identifier, a recipient account identifier, a provider, or an assurance strength. Content and conversation gifting remain absent until their owning domains publish an eligible context contract.

The catalog is data-driven and platform-managed. Catalog identities and code-native visual keys are seeded repository data; local/test provisioning projects them into ordinary BILLING one-time offers and immutable USD prices. Those fixture amounts are test data, not production packaging or approved commercial terms. Creators cannot create, edit, activate, or enumerate gift offers through creator offer routes.

Sending a gift uses the existing checkout service and provider port. In local/test, the deterministic adapter emits a signed provider event through the same raw webhook verification, durable inbox, worker processor, balanced capture journal, revenue-settled outbox, refund, and dispute paths a future eligible adapter must use. Success never emits an entitlement fact. The gift becomes `sent` only in the transaction that accepts verified settlement and posts its journal. Full refund or lost full dispute moves it to `reversed`; a partial reversal is visible without inventing an access consequence.

Consumer Web may render the catalog and send flow on a published creator page and may list the caller's sent gifts. Creator Studio may list received gifts, with sender identity withheld and the creator share derived from the settled BILLING journal entry. Neither surface fabricates an aggregate or calls a gift a payout. Consumer Mobile has no gift purchase path because its channel rules are separately gated.

Staging and production remain unable to send a gift. Their only accepted payment-provider and commerce-policy configurations are the existing refusing values. There is no route, header, query, client field, or database seed that changes the selected adapter. Enabling live gifting still requires an eligible provider ADR, approved country/channel/product terms, tax/refund/dispute and receipt policy, privacy review, production design approval, operations ownership, and the applicable product phase.

## Why

This keeps the new product small while making every financial claim real. The gift object supplies durable product history; the existing payment and journal objects supply money truth; CREATORS supplies recipient truth; TRUST & SAFETY supplies pair eligibility; and no domain reads another's private persistence. The local flow is useful because it exercises the exact seams a production integration must cross, while the production refusal remains configuration-enforced.

## Rejected alternatives

**Frontend-only celebration or development credits held outside BILLING.** Rejected because it would create visible success and creator value with no payment, journal, reversal, or reconciliation fact.

**A gift amount supplied by the client.** Rejected because the catalog's immutable price is the authority and a request amount creates a tampering surface.

**Treating a gift as a club entitlement or unlock.** Rejected because it promises access that was not sold and couples support to PRIVATE CLUBS.

**Reading recipient, block, or creator standing tables from BILLING.** Rejected because those facts belong to CREATORS and TRUST & SAFETY and must arrive through published contracts that their owners re-authorize.

**Exposing sender identity to the creator by default.** Rejected for this release because no product/privacy authority has approved that disclosure. The minimized received-gift projection says `withheld`; changing it requires an explicit product and privacy decision.

## Consequences

- Local/test has an end-to-end Consumer-to-Creator gifting proof with durable history and balanced journal evidence.
- Gift catalog fixture prices and visuals can change only by publishing new immutable catalog/price identities, preserving old receipts.
- A sender can retry safely with one idempotency key; concurrent duplicates converge on one gift and one payment.
- Production has visible code support but no live capability. This ADR does not approve a provider, price, revenue share, country, tax treatment, refund promise, payout, or distribution channel.
- Received-gift creator share is a BILLING settlement projection. Disbursement remains PAYOUTS-owned and unavailable until its independent gates pass.

## Cross-references

[Product phases](../product/01-product-phases.md), [monetisation](../product/05-monetisation.md), [BILLING](../domains/billing.md), [CREATORS](../domains/creators.md), [TRUST & SAFETY](../domains/trust-safety.md), [payment lifecycle](../flows/payment-lifecycle.md), [money flow](../architecture/10-money-flow.md), [provider adapters](../architecture/06-provider-adapters.md), [payment security](../security/05-payments-webhooks.md), [payment, tax, and payout gates](../compliance/04-payments-tax-payout-gates.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [ADR-0011](ADR-0011-payments-payouts.md), [ADR-0021](ADR-0021-monetization-money-architecture.md), and [virtual gifting freeze report](../architecture/23-virtual-gifting-freeze-report.md).

## Status

| Decision | Classification |
|---|---|
| BILLING-owned gift operation and platform catalog | LOCK NOW |
| Published creator-profile context only; self and blocked-pair refusal | LOCK NOW |
| Existing verified provider inbox, journal, revenue, reversal, and reconciliation paths | LOCK NOW |
| Gifts never grant entitlement | LOCK NOW |
| Sender identity withheld from Creator Studio | LOCK NOW for this release; privacy/product review required to widen |
| Deterministic commerce and catalog provisioning | Local/test only |
| Production provider, prices, terms, countries, tax, refund policy, payout, and channels | DEFER UNTIL PROVIDER INTEGRATION / LEGAL REVIEW REQUIRED |
