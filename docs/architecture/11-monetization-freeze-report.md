# Monetization freeze report

- Freeze status: Frozen
- Freeze SHA: `a2c50d7`
- Freeze date: 2026-08-15
- Architecture authority: [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md)

## What this records

The monetization core and the money architecture are frozen: the internal architecture, its invariants, and the code that carries them are complete and green, and no further work on them is planned until something below unfreezes them.

Freezing the architecture is not the same as being able to take money, and this document exists mostly to keep those two apart. [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md) requires that the freeze report say so plainly rather than claim payment readiness. Velora cannot charge anybody today, the reasons are external to the code, and every one of them is a decision nobody has made rather than a component nobody has built.

## What is frozen

The double-entry journal and its money primitives, offers and immutable price snapshots, checkout orchestration, subscriptions and their entitlement seam, refunds and disputes, creator earnings and payable balances, the payout and recipient architecture, commerce eligibility and the tax seam, the operator financial surface, and reconciliation for the three outcomes the platform can be genuinely unsure of — a capture whose provider answer was lost, a reversal in the same position, and a payout instruction sent and never confirmed. A subscription is not a fourth: it follows the capture it came from, so resolving the payment resolves it.

Eight migrations carry it, `0021_billing_journal` through `0028_payouts_overdraw_enforcement`, across three owning domains: `money` for the journal primitives, `billing` for commerce, and `payouts` for disbursement. The two commercial domains never read each other's tables — what a creator is owed moves between them as a published fact, and that is what makes either replaceable without the other.

## What is not frozen, and why

**LIVE MONEY MOVEMENT IS BLOCKED.** Not by an incomplete implementation but by configuration that fails closed, and behind that by decisions that do not exist. Every seam that could move money defaults to an adapter that refuses, and staging and production reject any other value, so no route, header, or environment string reaches a working payment path in a deployed environment.

The external gates, each recorded with its owner in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md):

- **Payment provider eligibility.** Every provider assessed in [provider eligibility](../compliance/06-payment-provider-eligibility.md) places Velora in a prohibited or written-approval-only category on the adult-content, dating, or platform axis, and all of them prohibit the business outright if mature creator content is ever enabled. No provider is eligible today and none is selected.
- **Payout provider eligibility.** The same finding on the disbursement side. No payout provider is eligible, and creator payouts remain a later product phase.
- **Published commercial terms.** Platform fee, revenue share, currencies, price bounds, billing intervals, refund terms, and cancellation timing are all undecided. The accounting machinery takes its allocation terms from injected policy, so a deterministic test policy exercises the arithmetic while production carries none.
- **Tax authority and merchant-of-record position.** No tax engine, registration, merchant-of-record decision, or remittance process is approved. An assumed zero is an unremitted liability nobody decided to accrue, so no authority means no sale.
- **Launch countries and market gates.** No launch country, creator country, or country-currency pairing is approved. `LEGAL REVIEW REQUIRED`.
- **Adult and age assurance.** No verifier that can produce anything stronger than a self-declaration is approved. This one also bounds the commerce country gate, which refuses an unapproved country but cannot prove a consumer naming an approved one is in it. `LEGAL REVIEW REQUIRED`.
- **Creator identity, KYC, and tax process.** Unapproved, along with settlement and reversal windows, reserves and holds, negative-balance treatment, and minimum payout.
- **Financial record retention.** Undecided, and deliberately so: nothing in the money core deletes a financial row, because a retention period is the one decision that cannot be undone after the fact.

## The invariants, and where each is enforced

Money is integer minor units with an explicit currency, never a float, and its wire form is a decimal string. Every posting is balanced double-entry, enforced by a deferred constraint trigger rather than by the writer. Financial history is append-only: what a row means is frozen by trigger, and a correction is a compensating entry rather than an edit. Nothing a buyer sends decides what they are charged: a checkout names an offer and a currency, and the amount comes from the price snapshot the writing transaction reads. A creator does set their own price, bounded by approved terms — which is why price creation refuses in every deployed environment, where no terms are approved. No browser navigation moves a payment, and a redirect is never evidence. Provider truth arrives only through authenticated, signature-verified, replay-protected events, or through a read of the provider's own record under the key Velora already sent. Every financial operation is idempotent under a platform-generated key, and no provider call happens inside a database transaction. Nothing stores a raw card number, bank credential, government identifier, or identity document.

## What the hardening phases found

Recorded because the value of an audit is in what it caught, and because three of these were enforcement that existed and did not work:

- **A purchase could answer `500` under concurrent submission.** `on conflict … do nothing` arbitrates one index, and the derived provider-key index was not it, so two callers establishing one purchase collided where a duplicate is raised rather than skipped. Closed by an advisory lock on the purchase identity. The same commit made the provider key a digest, because the previous derivation overran its column bound at the longest permitted idempotency key and truncation made it non-unique.
- **The no-overdraw bound had never run.** `velora_payouts_assert_not_overdrawn` branched on `IF FOUND` after `EXECUTE`, which PostgreSQL does not set. The trigger was attached, deferred, and inert for its whole life, and the test named after it was passing on a different error entirely.
- **A creator's payout position had one locked writer out of four**, so a payout and a reversal could each pass the bound and both commit. A deferred constraint is a check at commit, not a mutex.
- **The capture was locked when a reversal was requested and not when one was settled**, so concurrent settlements each allocated against a stale total and debited a creator for money the others were already taking back.
- **A recurring cycle was constructed and never started.** The provider-event drain — the only thing that applies verified provider events — ran once at boot and never again, while the process reported itself healthy.

Every one is now enforced in the database where the database can hold it, in code where it cannot, and asserted by a test that fails for the right reason.

## The evidence this rests on

Twenty consecutive runs of the API integration suite, on the frozen tree, with no retries and no reruns: 615 tests across 30 files, 615 passing and none failing in every one of the twenty. The sequence was the whole proof — a suite that passes on a second attempt has been shown to be flaky rather than stable, so any failure would have voided it and restarted it from the first run after a root-cause fix.

Beneath that, the canonical `pnpm ci:verify` graph: toolchain and frozen-install verification, workspace policy, formatting, lint, domain boundaries, typecheck, contract generation checked against the committed OpenAPI document and generated client, the authorization policy check, unit tests, the integration suite against real PostgreSQL and Redis, an uncached build of every app, browser end-to-end tests across three engines, the mobile doctor, compose validation, secret scanning, whitespace and hygiene, and the dependency security gate. Green end to end, and green on the hosted pipeline for every commit in the sequence.

No test was weakened, skipped, or retried to reach any of this, and no financial invariant was relaxed to make one pass. Where a test failed, it was because the code was wrong; the two occasions where the test itself was wrong are recorded above as exactly that.

## What unfreezes this

Any of: a provider becomes eligible and is selected by ADR; commercial terms are approved; a tax authority and merchant-of-record position are decided; launch countries are approved; an adult-assurance verifier is approved; or a retention period is set. Each of those turns a refusing adapter into a real one, and none of them is a code change first — the adapter boundary is where a provider lands, and the policy ports are where approved terms land.

The review triggers on [provider eligibility](../compliance/06-payment-provider-eligibility.md) apply: its findings are dated, and an entry whose retrieval date has aged past its trigger is stale evidence that must be re-verified before it supports any decision.

## Cross-references

[money architecture ADR](../decisions/ADR-0021-monetization-money-architecture.md), [money flow](10-money-flow.md), [provider adapters](06-provider-adapters.md), [BILLING](../domains/billing.md), [PAYOUTS](../domains/payouts.md), [payment security](../security/05-payments-webhooks.md), [payment/tax/payout gates](../compliance/04-payments-tax-payout-gates.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [finance operations](../operations/03-finance-payout-operations.md), [jobs, idempotency, concurrency](../engineering/03-jobs-idempotency-concurrency.md), [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
