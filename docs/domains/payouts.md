# PAYOUTS domain

## Purpose and scope

PAYOUTS owns creator payable balance, holds/reserves, payout readiness, disbursement lifecycle, and payout reconciliation. It does not charge customers, decide club content entitlement, or validate creator identity itself.

## Flow and state

Consume eligible settled/reversible revenue facts and produce balanced append-only creator-liability journal entries using integer minor units. Derived balance is `pending -> available -> reserved -> paid` or `held/reversed/failed`. Creator can request payout only when CREATORS verification, country, tax/compliance, risk/hold, and provider recipient readiness pass. Adapter execution is idempotent by payout instruction reference; verified callback/reconciliation finalizes state.

## Failure/security/permissions

Refund, chargeback, fraud hold, or policy action can reserve/reverse only under explicit ledger rules; never mutate historical entries invisibly. Creator sees own balances/payout status. Finance/Admin can operate under scoped role, approval thresholds, audit, and separation of duties. Store provider recipient tokens/references only; do not expose bank/payout credentials broadly.

## Implemented: the payout architecture, and why it cannot run

PAYOUTS owns its own balanced append-only journal under `payouts_`, instantiated from the same shared shape BILLING uses. [ADR-0011](../decisions/ADR-0011-payments-payouts.md) forbids one ledger across the two, and the reason shows up immediately: money collected from a consumer and money owed to a creator are different obligations, and one combined book would let a refund and a payout reversal be posted as though they were the same event — the class of error that balances perfectly and means nothing.

This book learns what a creator is owed from a fact BILLING publishes and never by reading a `billing_` row, exactly as [money flow](../architecture/10-money-flow.md) requires. The return leg is symmetric: PAYOUTS publishes when a disbursement settles, and BILLING consumes that to move the liability out of the customer-money book. Neither domain writes the other's tables and neither calls the other synchronously.

A payout reserves before it asks anybody for anything. The reservation is an accounting transaction — an amount moved from `creator_available` to `creator_reserved` — committed before the provider is contacted, so a crash between the two leaves an instruction reconciliation can resolve rather than money sent that Velora has no record of. Because it is a posting rather than a lock, it is visible to every replica that reads the book, which is what stops two concurrent requests spending one balance.

The bound is enforced twice. The service sums the balance under a lock on the recipient row, so fifty simultaneous requests queue instead of all reading the same figure; and a deferred constraint trigger refuses any posting that would leave a creator position overdrawn, so the guarantee survives a caller that never went near the service. Fifty concurrent requests for one balance produce one instruction.

An ambiguous provider answer leaves the instruction `submitted` with its reservation intact and no second instruction under a new key, because a payout whose answer was lost has either moved money or not. A refusal releases the reservation through a compensating transaction rather than by rewriting the original. Nothing reaches `paid` without naming the provider object that sent the money: a CHECK constraint refuses the row, so no operator, job, or service can mark money as sent that was not.

Velora stores no bank account number, routing or sort code, IBAN, government identifier, tax identifier, date of birth, address, or identity document — not encrypted, not tokenized, not redacted: absent. Onboarding is a redirect into the provider's own hosted flow, and what Velora keeps is a reference to the provider's record plus a normalized capability answer. The guarantee is asserted against the column list rather than against a validator, because a field that exists is a field something eventually fills.

Two configuration values stop all of it, for two independent reasons. `PAYOUTS_PROVIDER` selects who could send money and its only deployable value refuses every call — [provider eligibility](../compliance/06-payment-provider-eligibility.md) records why, from primary sources: Stripe Connect and PayPal Payouts inherit their platforms' prohibitions, Wise prohibits both the content category and third-party money transmission, and Airwallex lists adult content as unsupported. `PAYOUTS_POLICY` selects the approved settlement terms and its only deployable value releases nothing, because the settlement window, the reserve, the minimum payout, the negative-balance treatment, and the payout countries are all undecided. Staging and production refuse any other value for either. The creator surface reports both plainly and still shows what is owed, because the money is real whatever the platform can currently do with it.

## Phase/events/open questions

Phase 3 and only after real payout infrastructure approval. Events: earnings eligibility, hold/release, payout state. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: payout countries, KYC/tax, commission, rolling reserve, negative balance, dispute window, provider. See [Creator Private Clubs](../product/03-creator-private-clubs.md), [BILLING](billing.md), [money flow](../architecture/10-money-flow.md), [payment compliance](../compliance/04-payments-tax-payout-gates.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [finance operations](../operations/03-finance-payout-operations.md), [payment security](../security/05-payments-webhooks.md), [payment/payout ADR](../decisions/ADR-0011-payments-payouts.md), and [money architecture ADR](../decisions/ADR-0021-monetization-money-architecture.md).
