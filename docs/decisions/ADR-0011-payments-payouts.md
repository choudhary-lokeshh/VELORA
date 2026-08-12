# ADR-0011: Billing, entitlements, financial journals, and creator payouts

- Decision date: 2026-08-12
- ADR status: Accepted

## Context

Future Velora products may charge consumers and pay creators. Duplicate requests, duplicate/out-of-order webhooks, timeouts after provider success, partial internal failure, refunds, disputes, chargebacks, holds, and reconciliation are normal states. BILLING, PRIVATE CLUBS, and PAYOUTS must remain separate sources of truth. Provider selection and exact capture ordering depend on country/product/channel decisions not yet approved.

## Requirements

- Separate customer charging, product entitlement, and creator disbursement.
- Make every retryable money/provider operation durably idempotent and concurrency safe.
- Preserve immutable price/currency/tax snapshots and append-only audit/journal history.
- Verify and deduplicate webhooks before state progression.
- Reconcile ambiguous or out-of-order provider results without fabricated success.
- Support refunds, disputes, chargebacks, earnings, reserves/holds, reversals, and payouts.
- Keep providers and hosted collection behind adapters.

## Options evaluated

1. Separate BILLING and PAYOUTS modules with owner-specific append-only balanced journals and adapters.
2. One generic `payments` module owning charges, entitlements, and payouts.
3. Provider dashboard/webhook state as source of truth.
4. Mutable balance columns without immutable journal entries.
5. Synchronous charge-and-grant request with no durable reconciliation.
6. Provider-specific capture sequence selected now.

## Decision

- BILLING owns offers/immutable price snapshots, payment intents/attempts, charges, refunds, disputes, customer subscriptions, reconciliation, and an append-only balanced customer-money journal.
- PRIVATE CLUBS or another product owner owns membership/content entitlement. It consumes verified commercial facts and applies its own idempotent grant/revoke policy. Payment success does not itself grant object access.
- PAYOUTS owns creator payable entries, available/pending/reserved/held/reversed balances, recipient readiness reference, payout instructions, disbursement callbacks, reconciliation, and a separate append-only balanced creator-payable/disbursement journal.
- No shared generic payment repository, writable cross-domain ledger, or mutable balance without supporting immutable entries. Cross-domain facts use stable commercial/settlement references and versioned outbox events.
- Represent monetary amount as signed integer minor units plus ISO 4217 currency and explicit precision policy. Never use floating point. Store immutable product, price, currency, tax/fee, country/channel, and terms version per operation.
- Every user/API mutation has a durable idempotency record scoped to actor/action and canonical input. Every provider instruction has a unique platform operation reference and provider idempotency key. Every provider object/event ID has a unique constraint. Same key with different canonical input is conflict.
- Webhook endpoint reads bounded raw body, identifies configured adapter, verifies signature/timestamp before trusting payload, rejects replay, and stores a durable receipt/hash plus minimized verified metadata before asynchronous processing. Provider/client success claims cannot advance money state.
- Model explicit state machines and monotonic/precedence rules. Unknown timeout remains pending/reconciliation. Duplicate, late, or out-of-order event re-evaluates current state and cannot regress a final state improperly.
- Before each payment feature, product/provider integration selects one documented provider-compatible sequence: authorize/reserve then entitlement then capture/finalize, or verified payment then entitlement with explicit void/refund compensation. Every sequence must prevent unearned charge, unpaid delivery, duplicate movement, and fabricated success.
- Reconciliation jobs compare local operation, journal, entitlement-owner fact, and verified provider state. Automated repair is limited to deterministic idempotent transitions. Manual repair/refund/write-off uses scoped Finance role, exact proposal, thresholds, step-up/approval, idempotency, and immutable audit.
- PAYOUTS consumes only eligible settled/reversible revenue facts. Payout reserve/claim is transactional and unique; callback/reconciliation confirms disbursement. Customer refund/chargeback can create explicit payout reversal/negative-balance treatment only under approved policy, never by rewriting history.
- Providers use hosted/tokenized collection and recipient onboarding where applicable. No raw card/bank credentials enter Velora application stores or logs.

## Why

Separate ownership prevents customer charge state, content access, and creator liabilities from collapsing into one ambiguous model. Append-only balanced journals provide reconstructable financial history and controlled corrections. Durable idempotency, verified webhooks, and reconciliation handle unavoidable distributed ambiguity. Deferring provider/capture choice preserves country and channel fit without deferring correctness architecture.

## Rejected alternatives

- Generic payments dumping ground: obscures ownership and couples entitlements, customer money, and payouts.
- Provider as source of truth: provider data must be verified/reconciled but cannot own product entitlement, internal approval, or domain audit.
- Mutable balance only: loses history, correction provenance, and reliable reconciliation.
- Frontend button locks or process locks: do not protect concurrent replicas/retries.
- Synchronous success-only flow: cannot safely represent timeout, webhook lag, or partial failure.
- Selecting payment/payout vendor now: country, currency, tax, channel, compliance, and product policies remain unresolved.

## Consequences

Financial implementation requires more state and operations than a simple checkout integration. Entitlement may be pending while money reconciles. Finance/Admin needs explicit repair workflows. Journals are source records inside their owner domain and require accounting review before real money.

## Risks

- Cross-domain event lag can produce temporary money/entitlement mismatch.
- Incorrect journal posting rules can preserve balanced but semantically wrong entries.
- Provider retries may repeat external effects after local timeout.
- Refund/chargeback/payout races can overpay or revoke access incorrectly.
- App-store or country rules may force different provider sequences.

## Mitigations

Use unique constraints, transactions, durable claims, state versions, owner outbox/inbox, separate provider idempotency, double-entry invariants, reconciliation, item-level approval, operations dashboards, chaos/failure tests, provider sandbox conformance, and accounting/legal review before live money.

## Scaling path

Phase 2 introduces BILLING for approved products with one provider adapter and reconciliation workers. Scale API/workers horizontally, partition high-volume journal/event tables only after evidence, and isolate provider adapters by queue. Phase 3 activates PAYOUTS only after its policy/provider gates. Extract financial services only for security/team/load reasons while retaining separate contracts and journals.

## Security implications

Use hosted/tokenized collection, TLS, secret-manager keys, raw-body webhook verification, replay protection, least-privilege provider credentials, PCI scope review, field redaction, encryption where applicable, Finance RBAC, step-up/dual control, append-protected audit, and no AI authority. Provider dashboards/screenshots never authorize internal state.

## Testing implications

Test duplicate requests/webhooks, same key different input, timeout after provider success, out-of-order events, signature/replay failure, amount/currency mismatch, charge-entitlement partial failure, refund/dispute/chargeback races, reconciliation, journal balance/invariants, payout claim concurrency, callback duplication, negative balance/hold, Admin approvals, and provider adapter contract behavior against real PostgreSQL.

## Migration/reversibility

Provider-native identifiers stay inside adapters/owner records. A provider migration uses new-operation routing, dual reconciliation, callback coexistence, settlement drain, and rollback; historical entries remain immutable. Journal schema migration follows expand/backfill/verify/contract with accounting totals and no destructive rewrite.

## Status

| Decision | Classification |
|---|---|
| Separate BILLING, PRIVATE CLUBS entitlement, and PAYOUTS ownership | LOCK NOW |
| Owner-specific append-only balanced journals | LOCK NOW |
| Durable idempotency, verified webhooks, and reconciliation | LOCK NOW |
| Integer minor-unit money representation | LOCK NOW |
| Payment and payout providers | DEFER UNTIL PROVIDER INTEGRATION |
| Capture/entitlement sequence per provider/product | DECISION REQUIRED BEFORE FEATURE |
| Tax, refund, dispute, reserve, and payout policy | DECISION REQUIRED BEFORE FEATURE |
| Generic payments domain or mutable-balance-only model | REJECTED |
