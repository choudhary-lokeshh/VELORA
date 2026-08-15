# BILLING domain

## Purpose and scope

BILLING owns platform customer money lifecycle: commercial offers, pricing snapshots, payment intents/reservations, charges, refunds, provider reconciliation, and platform subscription state. It does not own club content access decision, creator payout transfer, provider secrets in UI, or guaranteed interpersonal outcomes.

## Main flow/state

Create immutable order/attempt with idempotency key: `created -> provider_pending -> financially_verified -> entitlement_pending -> finalized` or `reconciliation_pending/compensating/failed/cancelled/refunded/disputed`. Exact provider/product transitions may authorize/reserve before entitlement or verify payment before entitlement with compensation. Verify provider result/webhook before financial progression. Record balanced append-only customer-money journal entries using integer minor units and immutable currency/price/tax snapshots. Publish normalized financial fact; entitlement owner grants/revokes product-specific access. Sequencing and compensation are set per payment capability under [payment lifecycle](../flows/payment-lifecycle.md).

## Failure/concurrency/security

Same idempotency key returns same operation; provider correlation/reference unique constraints prevent duplicate charges. Webhooks verify signature, timestamp and replay key before state transition. Ambiguous timeout stays pending and reconciles, never treated as both paid and failed. No raw card credentials; use provider tokens/references. Refunds and manual adjustments require authorization, limits, audit, and reason.

## Permissions/data/events/phase

Consumer sees own customer-safe receipts/status; creators see only approved aggregate earnings views; finance/admin scope is least privilege. Events: intent, charge, refund, dispute, reconciliation changes, redacted. Phase 2 consumer premium/club charges; Phase 3 coins/gifts. `DECISION REQUIRED`: provider, currency/country, tax, receipt/refund/dispute policy.

## Implemented: the customer-money journal

The first thing BILLING owns is the book, before any offer, payment, or subscription exists. [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md) gives the reason: a payment recorded before there is somewhere to account for it gets accounted for retroactively, by inference, from records that were not designed to support it.

`src/money/money.ts` is the money value. An integer count of minor units and a validated currency, always together, held as `bigint` rather than `number` — not because a realistic amount exceeds what a double holds, but because a double will silently accept `0.5` where minor units were meant. There is no operation that yields a bare amount, no operation that combines two currencies, and no arithmetic a floating-point value can enter. Minor-unit precision comes from an explicit exponent table in `@velora/validation`, so a yen with no minor unit and a dinar with three are both correct; an unknown currency is a refusal rather than an assumed two decimal places. On the wire an amount is a decimal string, because JSON's only numeric type is a double and `9007199254740993` does not survive a round trip through it.

`src/money/journal-table.ts` is the balanced append-only journal, declared once and instantiated per owner in the way the transactional outbox already is. `src/billing/schema.ts` instantiates it under `billing_`; PAYOUTS will instantiate the same shape under its own prefix. What the two share is invariants, never storage.

Four of those invariants are the database's, described in [data and migrations](../engineering/02-data-migrations.md): currency agreement through composite foreign keys, balance through a constraint trigger deferred to commit, at least two entries per transaction, and immutability through triggers that refuse every update and delete — and refuse an entry written by any transaction other than the one that posted its parent, which is the only way a settled transaction could otherwise be changed without a row being updated. The integration suite proves each one by writing directly to the tables rather than through the service, because a rule only the service upholds is a rule the next caller can break.

One guarantee is outside the schema and has to be a deployment control: `TRUNCATE` fires no row trigger, so append-only holds only while the application's database role does not hold that privilege on `billing_`. The test harness truncates deliberately, which is why no trigger blocks it.

Posting is idempotent by construction. A transaction carries the business event it accounts for, the unique index over that pair is what makes one event post once, and the insert carries `on conflict do nothing` so a duplicate is an answer rather than an aborted transaction. Fifty simultaneous postings of one event produce one transaction, forty-nine `alreadyPosted` replies, no lock, and no retry loop.

Balances are derived on every read, never stored. A cached balance is a second source of truth that a concurrency bug can corrupt with nothing noticing, and the entry index carries the direction and the amount so the projection reads from the index rather than the heap. `sum` over `bigint` returns `numeric` in PostgreSQL, so an account cannot overflow however many entries it accumulates.

Nothing posts to this book yet except a test. No provider is approved, no offer exists, and no reason but `correction` is reachable from application code; the rest of the vocabulary is declared with the phase that makes each one writable.

## Implemented: commercial offers and frozen prices

An offer says what a creator sells; a price says what it costs. They are separate rows with separate lifecycles because they answer to different rules: an offer can be withdrawn and reopened, and a price can never change at all.

An offer points at a resource another domain owns — a private club today — by opaque identifier. BILLING never learns what is inside a club and PRIVATE CLUBS never learns what one costs. They meet through one published contract, `ClubCommercialDirectory`, which answers exactly one question: is this club owned by this creator, and is it published. An unknown club and somebody else's club give the same answer, so no creator can enumerate another's catalog by identifier.

Activation is a conjunction re-evaluated inside the transaction that performs it, never inferred from an earlier decision. Approved commercial terms must exist; the creator must currently be able to operate, read from CREATORS' published contract; the resource must be owned and published; and the offer must carry at least one live price in a currency the policy still approves. A price approved yesterday in a currency withdrawn today does not activate.

A price is never edited. Changing what something costs means retiring one row and publishing another, and a database trigger enforces it: only the lifecycle columns may move, and neither a price nor an offer may be deleted. Retiring an offer retires every live price on it and deletes nothing, so a purchase made under the old terms still points at the exact row it was made against.

What any of this may cost is not decided here. `BILLING_COMMERCE_POLICY` selects the approved terms — the currencies, the cadences, and the price bounds — and its only deployable value is `unpublished`, which approves nothing. Staging and production refuse any other value. With no approved terms every commercial mutation answers `503 DEPENDENCY_UNAVAILABLE`, and the offer list still answers `200` with a readiness statement saying monetisation is not enabled: a creator is entitled to be told that plainly rather than meeting a form that cannot succeed.

## Cross-references

[monetisation](../product/05-monetisation.md), [payment lifecycle](../flows/payment-lifecycle.md), [money flow](../architecture/10-money-flow.md), [payment security](../security/05-payments-webhooks.md), [payment compliance](../compliance/04-payments-tax-payout-gates.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [finance operations](../operations/03-finance-payout-operations.md), [payment/payout ADR](../decisions/ADR-0011-payments-payouts.md), [money architecture ADR](../decisions/ADR-0021-monetization-money-architecture.md), [PAYOUTS](payouts.md).
