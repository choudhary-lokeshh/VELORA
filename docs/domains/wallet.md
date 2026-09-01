# WALLET domain

## Purpose and scope

WALLET owns coins: how many somebody has, how they got them, what is held against an open commitment, and what became of every one of those movements.

It owns none of the facts a coin depends on. AUTH owns the principal and the session. USERS owns the account. BILLING owns money, payments, and the provider that takes them. LIVE owns matching. TRUST & SAFETY owns every restriction on who may interact with whom. WALLET asks each of them through its published contract and re-derives nothing.

It does not own prices in money, payment instruments, provider state, offers, or entitlements to anything other than the one thing coins currently buy. **A coin is not money**: it has no ISO 4217 currency, no minor unit, no exchange rate, and no denomination outside VELORA.

[ADR-0043](../decisions/ADR-0043-livekit-transport-coins-and-paid-live-preferences.md) is the architecture authority, and [ADR-0011](../decisions/ADR-0011-payments-payouts.md) is the rule it follows: owner-specific append-only balanced journals, never a shared ledger.

## Why this is a second journal rather than a currency in BILLING's

BILLING's journal enforces currency agreement between an entry, its account, and its transaction, through composite foreign keys onto an ISO 4217 code. A coin has no currency.

Giving it a fake one — `XXX`, a private code, an invented `VLC` — would make every currency-shaped rule in that journal untrue about coins, and would put a unit that buys nothing outside VELORA into the same books as money somebody actually paid. So this is a separate journal with the same shape and the same invariants, under its own prefix, in its own tables.

The two books meet at exactly one place: a payment BILLING settles publishes an entitlement fact, and an issuance here consumes it. Nothing sums across them, because a total denominated in "coins and pounds" would mean nothing.

## The facts a balance is made of

**A coin transaction** records one balanced movement and why it happened. `businessType` and `businessReference` together are its identity, so a redelivered purchase fact, a retried activation, and a duplicated sweep all collide on one unique index and produce one transaction.

**Coin entries** are the two or more sides of it. Direction plus a strictly positive amount, never a signed amount, so "which way did this go" is a value the database can group by and a malformed entry cannot express itself as a negative credit.

**A balance row** is a projection of those entries and never an independent truth. Every write to it happens in the same transaction as the posting that justifies it, and an integration test rebuilds every row from the entries and asserts they agree.

It exists for two reasons a sum over entries cannot serve: it is the row a spend takes for update, which is what serializes two concurrent activations, and it carries the `CHECK` constraints that make an overspend a database refusal rather than a race between two reads.

**An entitlement** records one person's paid, bounded window of narrowed matching: what was bought, what it cost, when it closes, and which ledger transactions reserved and settled it. It is a *commitment*, not a permission — there is deliberately no column on it that could be read as a grant.

**An acquisition** records that one external purchase was turned into coins, by which channel. It is the idempotency record for acquisition and holds no receipt: no purchase payload, signature, price, account, or device identifier has a column.

## Four positions and no more

`consumer_balance` is what somebody can spend. `consumer_reserved` is what is committed to an open window — neither spendable nor spent, which is the whole reason it is a position rather than a flag. `platform_issuance` is where coins come from and where a reversal sends them back. `platform_revenue` is where a captured reservation lands, and the only account whose balance means "this was consumed".

## What PostgreSQL enforces rather than the application

An accounting rule upheld only by the code that writes is a rule one bug away from being false, and a balance somebody can spend is the last place to discover that.

**Balance.** A deferred constraint trigger checks, at commit, that debits equal credits for every transaction touched. Deferred because entries arrive after the transaction row and a per-statement check would reject the first one.

**Immutability.** Triggers refuse `UPDATE` and `DELETE` on accounts, transactions, entries, and acquisitions, and refuse an entry inserted by any transaction other than the one that created the transaction it belongs to — which closes the mutation an append-only rule would otherwise miss, where two entries that balance on their own are appended to a transaction posted last year. A correction is a new balanced transaction naming the one it corrects.

**Non-negativity.** The projected balance carries `CHECK` constraints that neither position may go below zero.

One guarantee is deliberately outside the schema: `TRUNCATE` fires no row trigger, so the append-only property assumes the application's database role does not hold that privilege. That is a deployment control, not something a table can assert about itself.

## The charging rule

**Reserve on activation, capture on the first filtered match, release in full on expiry.**

The coins leave the spendable balance the instant the window opens and are held. They are captured when the window produces an encounter, and released in full when it does not — by the worker, on a cycle far shorter than the window itself, whether or not anybody is watching.

Charging on tap would mean paying for a pool that turned out to be empty. Charging only after a successful match would mean the platform running a narrowed, more expensive search for free for anybody who never matched, and would make what somebody paid depend on how busy the product happened to be.

Two consequences are deliberate. Cancelling inside the window returns everything, because changing your mind is not a consumption of what you bought. And a pair who had already agreed to meet bypasses the narrowed pool by design, so that match does not capture — charging for a match the filter did not make would be charging for the filter not being used.

## What the paid preference is, and what it is not

One supported attribute: a declared ISO 3166-1 alpha-2 region, which a person set themselves during onboarding, which USERS owns, and which the matcher already reads for the free `same` narrowing.

Nothing is inferred. No camera, face, name, voice, model, or location proxy contributes to any value, and `livePremiumPreferenceKinds` is a closed list of one, so the absence of anything else is checkable rather than asserted here.

A declared-gender preference has no field to read — the minimum discoverable profile deliberately excludes gender so that nobody is asked to hand over sensitive data as the price of being seen — and adding one is a product, policy, and legal decision recorded in `DECISIONS_REQUIRED.md`.

The free preference contract is unchanged and still cannot express a specific region. The paid narrowing is bought as a bounded window and read by the matcher from that record, so a client can never simply ask to filter a population; it can only hold a window somebody deliberately opened, that expires.

## Paying narrows a pool and authorizes nothing

The window is applied to the candidate pool, before any safety, standing, enforcement, or eligibility predicate is asked, and it can only make the pool smaller. Every one of those predicates is asked identically, in the same order, under the same pair lock, whether or not anybody paid.

That is why the contract this domain publishes to LIVE has no method a safety decision consults, and why a blocked pair stays refused — and uncharged — to somebody who paid to find them.

## Acquisition

**Web** is BILLING's. A coin pack is an ordinary offer, checkout is ordinary checkout, and all this domain adds is what a settled payment does to a balance and what a reversal undoes. The seam exists and is inert: nothing yet emits a `coins` resource type, because BILLING's offer model is creator-scoped and a platform-owned product is an open decision.

**Android** is a separate port, because Google Play requires digital goods consumed inside a Play-distributed application to be sold through Play Billing and a Play purchase is proved by a server-side verification against Google's own API. Verify, then credit, then acknowledge — never the reverse, because Play refunds an unacknowledged purchase and acknowledging first would acknowledge a delivery that had not happened.

There is deliberately no `google-play` adapter. No Play Console project, product identifier, application signing key, or service-account credential exists to verify against, and a channel that could be selected and could not verify would mint currency on a client's word.

**Neither channel takes a coin amount from a request.** What a purchase is worth comes from this platform's own catalogue, keyed by the product the store or BILLING confirmed.

## Configuration

`WALLET_COIN_LEDGER` gates the ledger and defaults to `unavailable`. Every deployed environment refuses `enabled`, because what a coin is worth, whether a balance expires, whether it is refundable, and how a virtual balance is treated for consumer-protection and tax purposes are all undecided.

`WALLET_ANDROID_ACQUISITION` gates the store channel, defaults to `unavailable`, and requires the ledger — a channel crediting a balance nothing holds is a configuration error rather than a channel that quietly does nothing.

A development grant exists and its availability follows the *environment* rather than a configuration value: there is no variable that turns it on in staging or production. It posts to the same ledger a purchase does, is idempotent on the reference supplied, and records `grant` as its reason so the books can always say which coins were bought and which were given.

## What this domain publishes

To **LIVE**: the narrowing somebody currently holds, and a request to charge the window that produced an encounter. Two operations, and no price in either — LIVE has no business knowing what anything cost.

To **consumer surfaces**: one authoritative wallet read, returned by every wallet operation, so a client never computes a balance from a delta it applied itself. It carries no count of matching people, no estimated wait, and no probability, because none of those is a number this platform has.

## Retention

Nothing here expires. A financial record that vanished would make a dispute unanswerable, and no correctness rule depends on a row being physically deleted, so an approved schedule applies later as a deletion pass.
