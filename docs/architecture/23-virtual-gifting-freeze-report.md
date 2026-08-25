# Virtual gifting product freeze report

- Freeze status: Local/test product complete; production blocked
- Freeze date: 2026-08-25
- Architecture authority: [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md)
- Product implementation authority: [ADR-0032](../decisions/ADR-0032-provider-neutral-virtual-gifting.md)

## What is newly runnable

Consumer Web now renders a data-driven, eight-item virtual gift catalog on a published creator page for an authenticated consumer. The consumer chooses a gift, reviews the exact recipient and immutable catalog price, confirms once, receives a settled, pending, or failed server answer, and can read sent-gift history under You. Pending confirmation is never presented as success and retries preserve the original idempotency identity. The picker has keyboard-native controls, a named confirmation dialog, busy and error states, a restrained token-based success treatment, and reduced-motion fallback. Anonymous visitors see a sign-in continuation, not a fake price or action.

Creator Studio now has Received gifts under Money. Every row comes from a real gift operation joined to its settled payment and journal; gross and creator share are separate, sender identity is withheld, and reversal state remains visible. The screen explicitly distinguishes a ledger share from a payout transfer.

The API owns the gift as a durable BILLING object. Catalog identity is repository data; local/test provisioning creates ordinary one-time offers and immutable prices for each eligible creator. Sending re-authorizes current creator standing, published profile, self-gift policy, and the pair's TRUST & SAFETY state before it records or calls anything. The sender supplies a catalog identity and currency, never an amount or recipient identifier.

The deterministic local provider is not a shortcut. It signs a normalized `payment.succeeded` event, submits it through the raw webhook verifier and durable inbox, and lets the worker transaction settle the payment, post the balanced BILLING journal, publish the creator revenue fact, and advance the gift. No entitlement event is published. Refunds and lost disputes advance the gift reversal lifecycle through the existing compensating-money paths.

`bun run dev:seed` provisions the catalog through an authenticated local-only API and sends real gifts between fictional seeded consumers and creators. It has no database connection and remains idempotent. Integration proof covers the catalog, successful settlement, declined and ambiguous outcomes, reconciliation, concurrent replay, direct-checkout bypass, self-gift, blocked pair, missing gift, missing recipient, balanced journal, absent entitlement, histories, full reversal, and production-style provider absence.

## Durable truth and boundaries

- BILLING owns catalog, gift, offer, price, payment, webhook receipt, journal, refund, and dispute state.
- CREATORS resolves a published recipient through its minimal published contract; BILLING never reads `creators_` or `users_` persistence.
- TRUST & SAFETY re-authorizes the pair under the established lock; BILLING never reads safety tables.
- PAYOUTS learns creator revenue only from the existing published settled-revenue event. A BILLING journal share is not a disbursement.
- PRIVATE CLUBS receives no gift entitlement fact. A gift unlocks no content, feature, conversation, attention, or relationship.
- Consumer Mobile has no purchase surface and remains refused by the API's Consumer Web audience gate.

## What remains blocked in production

No payment provider is eligible, no production commerce policy is published, no country/channel/tax/refund/receipt terms are approved, no creator payout provider or settlement policy is approved, and the approved Figma product-screen handoff remains outstanding. Staging and production accept only `BILLING_PAYMENT_PROVIDER=unavailable` and the unpublished commerce policy, so catalog and send operations fail closed before any gift or payment is written. The local adapter cannot be selected by a request and configuration validation forbids it outside local/test.

The eight local USD prices are deterministic fixtures, not proposed production pricing. The local revenue allocation exercises balanced accounting and is not an approved commission. Received-gift amounts demonstrate journal truth and do not claim funds were paid out. Enabling live gifting is a separate provider, legal, product, design, security, and operations change.

## Documentation impact audit

This work changes durable product behavior, BILLING lifecycle/data, published API contracts, cross-domain authorization, reversal behavior, local bootstrap data, and two client surfaces. Those authorities are updated in the monetisation product, BILLING domain, payment flow, surface documents, product gap matrix, README, this report, and ADR-0032. `DOCS_INDEX.md` includes the ADR, report, and billing reading path. ADR-0021 is not amended: virtual gifting instantiates its existing locked architecture and changes none of its decisions.

## Cross-references

[Monetisation](../product/05-monetisation.md), [BILLING](../domains/billing.md), [Consumer Web](../surfaces/01-consumer-web.md), [Creator Studio](../surfaces/03-creator-studio.md), [payment lifecycle](../flows/payment-lifecycle.md), [money flow](10-money-flow.md), [monetization freeze report](11-monetization-freeze-report.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [finance operations](../operations/03-finance-payout-operations.md), [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md), and [ADR-0032](../decisions/ADR-0032-provider-neutral-virtual-gifting.md).
