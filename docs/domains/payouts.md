# PAYOUTS domain

## Purpose and scope

PAYOUTS owns creator payable balance, holds/reserves, payout readiness, disbursement lifecycle, and payout reconciliation. It does not charge customers, decide club content entitlement, or validate creator identity itself.

## Flow and state

Consume eligible settled/reversible revenue facts and produce immutable earnings entries. Balance is `pending -> available -> reserved -> paid` or `held/reversed/failed`. Creator can request payout only when CREATORS verification, country, tax/compliance, risk/hold, and provider recipient readiness pass. Adapter execution is idempotent by payout instruction reference; verified callback/reconciliation finalizes state.

## Failure/security/permissions

Refund, chargeback, fraud hold, or policy action can reserve/reverse only under explicit ledger rules; never mutate historical entries invisibly. Creator sees own balances/payout status. Finance/Admin can operate under scoped role, approval thresholds, audit, and separation of duties. Store provider recipient tokens/references only; do not expose bank/payout credentials broadly.

## Phase/events/open questions

Phase 3 and only after real payout infrastructure approval. Events: earnings eligibility, hold/release, payout state. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: payout countries, KYC/tax, commission, rolling reserve, negative balance, dispute window, provider. See [Creator Private Clubs](../product/03-creator-private-clubs.md), [BILLING](billing.md), [payment compliance](../compliance/04-payments-tax-payout-gates.md), [finance operations](../operations/03-finance-payout-operations.md), [payment security](../security/05-payments-webhooks.md).
