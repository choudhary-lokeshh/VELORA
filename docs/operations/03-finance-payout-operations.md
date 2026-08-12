# Finance and payout operations

## Purpose and authority

Define scoped operational handling for payments, refunds, disputes, reconciliation, creator earnings, holds, and payouts. BILLING and PAYOUTS own financial truth; Finance/Admin uses published workflows and cannot directly edit ledgers or provider state.

## Roles and separation of duties

Finance roles are scoped by country, currency, product, operation, and amount. Requester, approver, and executor are separate where risk/threshold requires. Support may collect case context but does not receive finance permission by default. Owner/Super Admin remains subject to secrets minimization, approval, and audit.

## Operational lifecycles

- Refund: case/request -> eligibility and original charge check -> amount/reason/entitlement impact -> approval -> idempotent provider/domain execution -> verified result -> customer communication/reconciliation.
- Dispute/chargeback: verified provider notice -> case and evidence deadline -> response/acceptance -> financial/entitlement treatment -> provider decision -> reconciliation and audit.
- Reconciliation: scheduled comparison -> mismatch classification -> owner/provider investigation -> approved repair/compensation -> re-run and sign-off.
- Payout: available balance and creator readiness -> request/schedule -> risk/tax/hold checks -> approval/reserve -> idempotent provider instruction -> verified paid/failed/reversed result -> reconciliation.
- Hold/release: documented trigger and scope -> approval where required -> PAYOUTS transition -> creator-safe communication/appeal -> timed review/release or escalation.

Unknown provider outcome remains pending. Operator cannot mark charge/refund/payout complete from a screenshot, client claim, or AI summary.

## Controls and security

Use immutable amount/currency/price references, unique operation/provider IDs, verified webhooks, replay protection, state versions, durable jobs, provider reconciliation, and append-protected audit. No raw card, bank credential, signing secret, or unrestricted tax/identity document in operational views.

Manual adjustment requires typed reason/category, linked evidence, exact before/after proposal, limit, approval, owner-domain validation, and post-operation review. Bulk operations apply item-level authorization/idempotency and show item outcomes.

AI may summarize reconciliations, explain authorized metrics, or draft requests in Phase 3. It cannot authorize, approve, release, refund, pay, hold, or repair financial state.

## Failure, incidents, and open decisions

Provider outage, webhook lag, duplicate event, inconsistent currency/amount, negative balance, or ledger mismatch suspends unsafe execution and alerts. Preserve evidence, limit further impact, reconcile through owner process, and use incident response for material events.

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: role matrix, thresholds/dual control, refund and dispute policy, reconciliation frequency/tolerance, ledger repair process, reserves/holds, payout schedule/methods, tax documents, statements, fraud escalation, and finance incident SLA.

## Cross-references

See [payment lifecycle](../flows/payment-lifecycle.md), [payment security](../security/05-payments-webhooks.md), [payments/tax/payout gates](../compliance/04-payments-tax-payout-gates.md), [BILLING](../domains/billing.md), and [PAYOUTS](../domains/payouts.md).
