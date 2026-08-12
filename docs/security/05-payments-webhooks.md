# Payment and webhook security

## Purpose

Security authority for billing/payout provider integration. Provider adapter normalizes payload only after verification; BILLING/PAYOUTS own state transitions.

## Required inbound webhook flow

Receive raw body on isolated endpoint, apply size/rate limit, select configured provider key, verify signature and timestamp before parsing/trusting payload, reject replay using provider event ID/signature window, persist verified receipt idempotently, then enqueue normalized processing. Acknowledge only according to verified durable handling; retries must be safe. Never let client claim provider payment success.

## Payment protection

Use hosted/tokenized provider collection where applicable; do not collect/store/log raw card credentials unless separately approved compliance architecture exists. Secret keys stay runtime-only. Bind operation to authenticated customer/order/price/currency; verify webhook amount/currency/reference against immutable local record. Use idempotency key outgoing and unique provider references incoming.

## Failure and operations

Timeout/unknown outcome becomes pending/reconcile, not assumed success/failure. Signature/replay failure is denied/audited/alerted without state change. Dispute/refund/chargeback arrives as verified state event and uses published entitlement/ledger policy. Finance/Admin actions require scoped RBAC, reason, approval limits, audit, and no raw payment data view.

## Phase/cross-references

Phase 2 payments; Phase 3 payouts. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: providers, secret rotation, webhook retention/replay window, PCI scope, refund/dispute policy. See [payment lifecycle](../flows/payment-lifecycle.md), [payment/payout gates](../compliance/04-payments-tax-payout-gates.md), [finance operations](../operations/03-finance-payout-operations.md), [BILLING](../domains/billing.md), [PAYOUTS](../domains/payouts.md), [jobs](../engineering/03-jobs-idempotency-concurrency.md).
