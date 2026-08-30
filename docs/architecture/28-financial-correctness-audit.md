# Payments / ledger / commerce correctness audit

- Audit date: 2026-08-30
- Scope: memberships, gifting, checkout, subscriptions, payments, refunds, reversals, disputes, creator earnings, payouts, ledger

## The result, stated first

The financial invariants hold. Every category this audit set out to verify was already covered by tests that would fail if it stopped holding — including the hostile matrix, which was largely complete before this phase began.

**One gap was found and closed**: a gift state that the contract publishes, the database constrains, two services transition to, and three product surfaces render with their own words — and that no test in the repository had ever produced.

## What was verified and already held

**Payment invariants.** One logical payment per intended action, with duplicate submission proved at both ends: `resolves a double-clicked join to one purchase`, `settles one purchase however many times the page is submitted`, `deduplicates concurrent sends`. Idempotency ownership is scoped and hostile: `refuses one key reused across two cadences`, `refuses the same key used for a different amount`. Provider reference provenance is checked and forgery refused: `refuses a forged reference on the provider page`. Cross-user isolation on the consumer side was the [security audit](27-security-correctness-audit.md)'s finding and is now proved for all four financial reads.

**Membership invariants.** Every state in the lifecycle has a test, and so does every way out of it: cadence selection, retired prices, offers taken off sale, scheduled cancellation that does not take back the period already paid for, expiry swept exactly once however often the sweep runs, departure, double departure, club closure, creator suspension, and reader restriction. `withdraws access on a lapsed renewal and never invents a grace period` is the one worth naming — the fail-closed reading of an unresolved policy, asserted rather than assumed.

**Ledger.** Append-only is enforced by database triggers rather than by application discipline: `refuses every update and delete against a posted book`, `refuses entries appended to a transaction posted earlier`. Balance, posting uniqueness, business reference, currency isolation, and minor-unit exactness each have their own test, including `carries an amount larger than a double through PostgreSQL exactly` — the one that matters for money in JavaScript. `admits exactly one of fifty simultaneous postings of one event` covers the race.

**Payouts.** Reservation, send, settlement, release, and refusal on both the provider axis and the policy axis, independently. `spends one balance once under fifty simultaneous requests` and `never overdraws a creator, whichever of the two wins` cover concurrency; `refuses a posting that would overdraw a creator, written directly` covers the bypass. `has no column for a bank detail or an identity document` is a structural assertion, not a behavioural one, and is the right shape for what it protects.

**Tax and policy.** Nothing is invented. The deployed tax authority assesses **nothing**, which makes taxable commerce impossible rather than untaxed — a platform with no engine cannot charge a price whose tax component it invented, and it certainly cannot charge one whose tax component it assumed was nil. The development authority assesses zero *under its own name*, so a zero in the books is attributable and cannot be mistaken for evidence about any real treatment; configuration refuses that adapter outside local and test. There is no consumer-facing refund path at all, and a test says so.

## Fixed: a state three surfaces render and nothing produced

`partially_reversed` is a gift state. It is in `gift-policy.ts`, in a CHECK constraint on `billing_gifts`, and in the transition both `refund-service.ts` and `dispute-service.ts` perform. Consumer Web, Consumer Mobile and Creator Studio each give it its own sentence — *"Part of this was returned. The creator keeps the rest."*

It appeared **nowhere in the API test suite**. Nothing proved a partial reversal of a gift reached that state rather than jumping to `reversed`, and nothing would have noticed if the boundary between "partly" and "wholly" moved.

The new test returns one minor unit and then the remainder, rather than two halves. The property under test is the threshold — `settledReversalTotal` accumulating across separate reversals and reaching `reversed` only when the total covers the capture — and a single even split cannot tell an accumulated total from a comparison against the last reversal alone. It also asserts the creator's payable is reduced but not zeroed after the first, and zeroed after the second.

Verified by changing the threshold from `totalReversed >= amountMinor` to `totalReversed > 0`, which makes any refund fully reverse the gift; the test fails on the first assertion and names both values.

## Noted, not changed

`provider_error` is declared as a payout failure reason in a union whose only caller always passes `declined`, so no code path can produce it. It is dead surface rather than a correctness defect: nothing renders it, because nothing writes it. It is recorded here rather than removed, because a real payout provider adapter is the thing that would need it and none exists yet.

## Cross-references

[Security correctness audit](27-security-correctness-audit.md),
[Data integrity audit](26-data-integrity-audit.md),
[money flow](10-money-flow.md),
[monetization freeze report](11-monetization-freeze-report.md),
[ADR-0011](../decisions/ADR-0011-payments-payouts.md), and
[ADR-0032](../decisions/ADR-0032-provider-neutral-virtual-gifting.md).
