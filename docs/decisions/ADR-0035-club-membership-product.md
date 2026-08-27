# ADR-0035: The club membership product on the frozen money architecture

- Decision date: 2026-08-27
- ADR status: Accepted
- Owners: Founder (decision owner), BILLING, PRIVATE CLUBS, Consumer Web, Consumer Mobile, Creator Studio, Platform Admin

## Context

[ADR-0021](ADR-0021-monetization-money-architecture.md) froze the provider-neutral money architecture and [ADR-0032](ADR-0032-provider-neutral-virtual-gifting.md) proved it end to end with a product that grants nothing. What neither did was make the thing the architecture was built for reachable: a person could not find what a club cost, could not buy access to one, could not read what it admitted them to, and could not stop paying for it. The [product gap matrix](../product/06-product-gap-matrix.md) classified the whole of monetisation as architecture with no product on top of it.

Two constraints in the frozen model turned out to be load-bearing for that product, and one of them had to move.

**One live price per offer per currency.** The rule existed so that "the price of this club" could not be a question with two answers at the moment somebody pays. A membership sold monthly *and* yearly is two prices in one currency, which the rule forbade — so an offer could carry a cadence or a choice of cadence, but not both.

**No consumer-initiated cancellation.** A subscription could only be ended by a provider event, which meant the only way out of a recurring charge was for the provider to decide there was one.

## Decision

### A membership is access to one club, and there are no tiers

The commercial chain is unchanged: creator, club, one commercial offer per club, versioned immutable prices, checkout, payment, verified provider event, subscription, entitlement outbox, club membership, authorized members-only content. Creator Studio presents exactly that and no more. There is no Bronze/Silver/Gold anywhere, because there is no tier in the domain — a hierarchy invented on a screen would be three names over one entitlement, and the first person to ask what the difference was would be told something untrue. A creator who wants two levels makes two clubs, which is a distinction the access rules already enforce.

### A price is identified by currency *and* cadence

`billing_prices_live_uk` is replaced by two partial unique indexes: one live price per offer per currency per cadence for recurring prices, and one live price per offer per currency for one-time prices. A purchase names the cadence, so "twelve a month" and "a hundred and twenty a year" are two prices for two different things rather than two answers to one question. A request that names no cadence against an offer publishing two is **refused** rather than resolved: charging the cheaper one, the first one, or whichever the database returned would each be Velora deciding what somebody bought. Idempotency comparison includes the cadence, so one key reused across two cadences is a conflict rather than a replay.

### Cancellation is a consumer action, and it schedules rather than takes

`POST /v1/billing/subscriptions/cancellation` moves a live subscription to `cancel_at_period_end` and stops. The paid period is unchanged and access continues to its end, because withdrawing it at the moment somebody cancels would take back something already bought. There is no immediate option and no field that could become one; a refund remains a separate operator-authorized reversal. A lapsed (`past_due`) subscription ends immediately instead, because it already grants nothing and there is no paid period left to honour.

It is open to every consumer surface. Beginning a purchase from a mobile application is a different commercial arrangement with different obligations and stays refused for that audience; ending one is not an arrangement at all, and making a subscription harder to leave than to enter is the pattern consumer-protection law exists to prevent.

### A period ends because a date passed, not because anybody asked

A worker sweep closes scheduled cancellations whose `current_period_end` has passed, moves them to `cancelled`, and publishes the revocation through the same outbox a grant travels through. Nothing about it reaches a provider: the end of a period is arithmetic on a date this platform already stored.

### `past_due` withdraws access, and no grace period is invented

A verified `subscription.past_due` event moves an active subscription to `past_due` and publishes a revocation with reason `subscription_lapsed`. Whether a lapsed payment keeps access, and for how long, is grace policy nobody has approved, and the fail-closed reading of an unresolved policy is no access. The relationship is not ended, because a lapse is not a decision anybody took.

### Leaving is provenance-aware

`POST /v1/clubs/departures` ends an invitation-based membership and refuses a commercial one. A creator invitation is a gift and giving it back ends it; a commercial entitlement belongs to the subscription that produced it, and revoking it here would end access somebody is still paying for while leaving the money running.

### What a club promises is PRIVATE CLUBS', what it costs is BILLING's

Benefit lines are a new `clubs_benefits` child table: presentation, owned beside the rest of a club's identity, bounded at eight lines of a hundred and twenty characters, and carrying no price, cadence, term, or guarantee. `GET /v1/creators/clubs` publishes the club's identifier, its benefits, and the viewer's own membership; `GET /v1/creators/memberships` publishes what that same opaque identifier costs. Neither domain reads the other's tables and neither route knows the other exists — the join happens on the surface that asked for both, which is where a join between two owners belongs.

### A club is a destination, and reaching it is safe

`GET /v1/clubs?handle&slug` answers with the club's public identity for anybody, and with the members-only feed only for a caller the entitlement question permits *on that request*. A visitor gets an empty feed rather than a filtered one, so there is no protected body, summary, or media reference in the answer to hide. Nothing consults a cached decision: a revoked, blocked, suspended, or expired reader loses the feed on their next load.

### The local-test provider gets a page, because a flow nobody can walk is a flow nobody walks

The `local-test` payment adapter serves a hosted checkout page on the API's own origin, outside `/v1`, registered only where that adapter is the one configuration built — the same arrangement the `local-test` media transport already uses. It collects nothing, settles nothing by being visited, and delivers a signed event through the ordinary verified inbox. Configuration refuses the adapter in every deployed environment, so no page exists there to reach.

## Why

**Because the expensive parts were already correct and unreachable.** Journals, idempotency, the verified inbox, reconciliation, and the entitlement bridge were built and proved. What was missing was a person being able to use them, and every gap was a route or a screen rather than a correctness question.

**Because cadence is a product fact, not an ambiguity.** The old rule prevented an ambiguity by preventing a product. Naming the cadence in the request removes the ambiguity and keeps the guarantee: two live monthly prices in one currency are still refused.

**Because somebody must always be able to stop paying.** A platform that accepts a subscription on one surface and refuses to end it on another has made a decision about its users that no store rule required.

**Because a locked state assembled on the client is not a locked state.** Answering with an empty feed rather than a filtered one is what makes a typed address, a shared link, and a developer console all equally safe.

## Rejected alternatives

**A second offer per club to carry the annual price.** Rejected: it makes "the membership" ambiguous, doubles every entitlement question, and is a tier hierarchy wearing a different name.

**Resolving an unnamed cadence to the cheapest or the newest price.** Rejected: it is Velora choosing what somebody bought, and the person would find out from their statement.

**Immediate cancellation with access withdrawn.** Rejected: it takes back a period already paid for, and the refund it implies is a commercial term nobody has approved.

**A grace period on `past_due`.** Rejected outright. Inventing one would be inventing a commercial term, and the honest reading of an unresolved policy is no access.

**Ending a paid membership through the club departure route.** Rejected: it would revoke access while the subscription kept charging, which is the worst of both.

**Letting Consumer Mobile start a purchase.** Rejected: the store-channel question is unresolved, and the API refuses the audience rather than the screen omitting a button.

**Putting a link to a web purchase page inside the mobile application.** Rejected: whether an application may point somebody at an external payment page is unresolved store policy, and a link added on the assumption that it is fine is how an application gets removed.

## Consequences

- A membership can be created, priced, sold, read, cancelled, expired, and refunded end to end in local and test, through the product's own routes and a real browser.
- Staging and production are unchanged: no payment provider, no commerce policy, no eligibility, and no tax authority is approved, every one of them refuses, and no surface offers a purchase where they do.
- Creator Studio gains real controls. A price change retires the old row and publishes a new one; nothing on that screen can rewrite a figure somebody was charged.
- Platform Admin gains a dispute queue that is a read. There is no evidence submission, because nothing has decided what evidence may be sent or by whom.
- Consumer Mobile gains membership consumption and cancellation, and gains no purchase path.
- The seeded local world contains live memberships, scheduled cancellations, an abandoned payment, both cadences, and invitation-only clubs, so every state is visible before anybody writes a test for it.

## Cross-references

[ADR-0011](ADR-0011-payments-payouts.md), [ADR-0021](ADR-0021-monetization-money-architecture.md), [ADR-0032](ADR-0032-provider-neutral-virtual-gifting.md), [BILLING](../domains/billing.md), [PRIVATE CLUBS](../domains/private-clubs.md), [monetisation](../product/05-monetisation.md), [product gap matrix](../product/06-product-gap-matrix.md), [payment lifecycle](../flows/payment-lifecycle.md), [creator entitlement](../flows/creator-entitlement.md), [payments, tax, and payout gates](../compliance/04-payments-tax-payout-gates.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).

## Status

| Decision | Classification |
|---|---|
| One live price per offer, per currency, per cadence; the purchase names the cadence | LOCK NOW |
| Consumer-initiated cancellation that schedules the end of renewal | LOCK NOW |
| Period-end expiry as a worker sweep publishing through the outbox | LOCK NOW |
| `past_due` withdraws access; no grace period | LOCK NOW |
| Provenance-aware departure; a paid membership ends through cancellation | LOCK NOW |
| Club benefits as PRIVATE CLUBS presentation, carrying no commercial term | LOCK NOW |
| Club destination answering an empty feed to anybody it does not admit | LOCK NOW |
| `local-test` hosted checkout page on the API origin | Local/test only |
| No purchase and no external purchase link on Consumer Mobile | LOCK NOW until a Google Play commerce strategy is approved |
| Provider, terms, currencies, countries, tax, refund, grace, and payout policy | DEFER UNTIL PROVIDER INTEGRATION / LEGAL REVIEW REQUIRED |
