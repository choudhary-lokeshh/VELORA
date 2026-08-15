# Payment and webhook security

## Purpose

Security authority for billing/payout provider integration. Provider adapter normalizes payload only after verification; BILLING/PAYOUTS own state transitions.

## Required inbound webhook flow

Receive raw body on isolated endpoint, apply size/rate limit, select configured provider key, verify signature and timestamp before parsing/trusting payload, reject replay using provider event ID/signature window, persist verified receipt idempotently, then enqueue normalized processing. Acknowledge only according to verified durable handling; retries must be safe. Never let client claim provider payment success.

## Payment protection

Use hosted/tokenized provider collection where applicable; do not collect/store/log raw card credentials unless separately approved compliance architecture exists. Secret keys stay runtime-only. Bind operation to authenticated customer/order/price/currency; verify webhook amount/currency/reference against immutable local record. Use idempotency key outgoing and unique provider references incoming.

## Failure and operations

Timeout/unknown outcome becomes pending/reconcile, not assumed success/failure. Signature/replay failure is denied/audited/alerted without state change. Dispute/refund/chargeback arrives as verified state event and uses published entitlement/ledger policy. Finance/Admin actions require scoped RBAC, reason, approval limits, audit, and no raw payment data view.

## Audited: the hostile pass over the money core

Everything below was attacked deliberately rather than reviewed. What it found is recorded whether or not it turned into a change, because "we looked and it held" is only worth something if the looking is written down.

**What held.** A caller cannot set what they are charged: a checkout names an offer and a currency, and the amount comes from the price snapshot the transaction reads. One person's idempotency key cannot resolve to another person's purchase — identity is the consumer, the offer, and the key together, and two people sending one key get two operations and two payment links. A refund amount is strictly positive at the contract boundary, so a negative reversal is a validation failure rather than something a policy bound catches later. Cross-currency reversal, reversal of an unsettled charge, a claim whose amount disagrees with the capture, an unsigned or replayed provider event, and a consumer-facing refund path all refuse.

**The operator surface.** `/v1/admin/billing/state` reads across every consumer and creator at once, which makes it the one screen where a leak is everybody's rather than one person's. It had no test at all. It now refuses an unauthenticated caller, a consumer session, an operator who proved only one factor, and an operator whose step-up has gone stale — and its response is asserted to contain no consumer identifier, creator identifier, payment identifier, provider reference, or provider idempotency key. Counts and per-currency totals are all it carries.

**Enforcement nothing exercised.** Every seam that could move money refuses its live adapter in staging and production, and not one of those refusals was asserted anywhere. That is the state the payout overdraw trigger was in before it turned out to have never run once, so the same reasoning applies: an enforcement no test exercises is one nobody notices has stopped. All seven are now asserted to default to the refusing adapter, to work only where money cannot move, and to be rejected by name in both deployed environments. The `local-test` adapters reach no network, but they fabricate successful payments, priced offers, and paid instructions — one of them reachable in production would mean paid subscriptions nobody paid for and creator balances nobody was charged for.

**What is trusted and should not be mistaken for proof.** The commerce country gate refuses a country nobody approved, but its consumer input is self-declared: it comes from the consumer's own adult declaration, recorded with assurance class `self_declared`, and no approved verifier can produce anything stronger. The gate cannot show that a consumer naming an approved country is in it. That is tolerable only while live money movement is blocked. Approving a payment provider without first deciding what assurance a commerce country claim requires would promote this refusal into a compliance control it is not, and that decision sits under the launch-country and adult-assurance gates in `DECISIONS_REQUIRED`.

## Phase/cross-references

Phase 2 payments; Phase 3 payouts. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: providers, secret rotation, webhook retention/replay window, PCI scope, refund/dispute policy. See [payment lifecycle](../flows/payment-lifecycle.md), [money flow](../architecture/10-money-flow.md), [payment/payout gates](../compliance/04-payments-tax-payout-gates.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [finance operations](../operations/03-finance-payout-operations.md), [BILLING](../domains/billing.md), [PAYOUTS](../domains/payouts.md), [jobs](../engineering/03-jobs-idempotency-concurrency.md), [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md).
