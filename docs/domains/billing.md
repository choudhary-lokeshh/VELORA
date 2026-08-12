# BILLING domain

## Purpose and scope

BILLING owns platform customer money lifecycle: commercial offers, pricing snapshots, payment intents/reservations, charges, refunds, provider reconciliation, and platform subscription state. It does not own club content access decision, creator payout transfer, provider secrets in UI, or guaranteed interpersonal outcomes.

## Main flow/state

Create immutable order/attempt with idempotency key: `created -> provider_pending -> financially_verified -> entitlement_pending -> finalized` or `reconciliation_pending/compensating/failed/cancelled/refunded/disputed`. Exact provider/product transitions may authorize/reserve before entitlement or verify payment before entitlement with compensation. Verify provider result/webhook before financial progression. Publish normalized financial fact; entitlement owner grants/revokes product-specific access. Sequencing and compensation are set per payment capability under [payment lifecycle](../flows/payment-lifecycle.md).

## Failure/concurrency/security

Same idempotency key returns same operation; provider correlation/reference unique constraints prevent duplicate charges. Webhooks verify signature, timestamp and replay key before state transition. Ambiguous timeout stays pending and reconciles, never treated as both paid and failed. No raw card credentials; use provider tokens/references. Refunds and manual adjustments require authorization, limits, audit, and reason.

## Permissions/data/events/phase

Consumer sees own customer-safe receipts/status; creators see only approved aggregate earnings views; finance/admin scope is least privilege. Events: intent, charge, refund, dispute, reconciliation changes, redacted. Phase 2 consumer premium/club charges; Phase 3 coins/gifts. `DECISION REQUIRED`: provider, currency/country, tax, receipt/refund/dispute policy.

## Cross-references

[monetisation](../product/05-monetisation.md), [payment lifecycle](../flows/payment-lifecycle.md), [payment security](../security/05-payments-webhooks.md), [payment compliance](../compliance/04-payments-tax-payout-gates.md), [finance operations](../operations/03-finance-payout-operations.md), [PAYOUTS](payouts.md).
