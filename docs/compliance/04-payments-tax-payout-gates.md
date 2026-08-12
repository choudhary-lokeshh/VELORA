# Payments, tax, and payout gates

## Purpose and status

Define country/channel/provider gates before charging customers, granting paid access, recognizing creator earnings, or sending payouts. This is product/architecture guidance, not legal, tax, accounting, or financial advice. Decisions require `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Ownership and separation

BILLING owns customer money lifecycle and price snapshots. PRIVATE CLUBS or another product owner owns entitlement. PAYOUTS owns earnings, holds, and disbursement. CREATORS owns creator eligibility. ADMIN owns approved privileged workflows. Providers normalize external operations through adapters and never replace these sources of truth.

## Payment launch gates

Before enabling an offer for a country/channel, approve currency, price display, taxes/fees, customer terms, receipt, cancellation/renewal, refund, dispute/chargeback, fraud, payment-method/provider support, channel/platform rules, customer support, reconciliation, data handling/PCI scope, and accounting/reporting obligations.

Every charge uses immutable offer/price/currency/tax snapshot, customer/country/channel eligibility, durable idempotency, provider reference uniqueness, verified webhooks, replay protection, entitlement correlation, reconciliation, and auditable money state. Frontend locks are never financial correctness controls.

## Creator earnings and payout gates

Before accruing available earnings or payout, approve creator/country eligibility, identity/KYC and tax process, commission/fees, settlement and reversal windows, refund/dispute allocation, reserves/holds, negative balance, minimum/maximum payout, method/provider, currency conversion, statement, payout failure/retry, account changes, fraud/safety holds, support/appeal, reconciliation, and separation of duties.

Creator-facing earnings may distinguish estimated, pending, available, reserved/held, reversed, paid, and failed. Estimated analytics is not ledger truth. Provider recipient readiness does not override creator/safety/country policy.

## High-impact operations

Refunds, manual adjustments, payout release/hold, recipient changes, write-offs, and reconciliation repair require scoped role, current-state validation, reason, thresholds, step-up/approval, idempotency, audit, and owner-domain execution. AI may summarize or draft only; it cannot authorize or execute.

## Revocation and country/channel change

Gate loss stops new commercial operations as defined while preserving lawful customer rights and financial records. Existing entitlement, renewal, refund, dispute, reserved earnings, and payout treatment is explicitly documented before launch. Do not reroute transactions through an unsupported country/provider/channel.

## Open decisions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: launch currencies/countries, providers, PCI scope, tax calculation/remittance, receipts, renewal/cancellation/refund/dispute terms, app-store billing, ledger/accounting model, creator commission, reserves, KYC/tax, payout countries, reconciliation, and finance approvals.

See [monetisation](../product/05-monetisation.md), [payment lifecycle](../flows/payment-lifecycle.md), [payment security](../security/05-payments-webhooks.md), [PAYOUTS](../domains/payouts.md), and [finance operations](../operations/03-finance-payout-operations.md).
