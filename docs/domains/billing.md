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

## Implemented: the provider port and checkout orchestration

`src/billing/provider.ts` is the whole of what an eligible payment provider must be able to do, stated once in Velora's vocabulary: create a hosted checkout, retrieve a payment, refund one, and verify an inbound event. No provider status string, object shape, or SDK type crosses it. That matters more here than in most adapters, because [provider eligibility](../compliance/06-payment-provider-eligibility.md) makes a provider change likely rather than hypothetical.

`BILLING_PAYMENT_PROVIDER` selects the adapter. Its only deployable value is `unavailable`, which refuses every operation; staging and production reject anything else, so the deterministic `local-test` adapter is unreachable outside local and test by configuration rather than by convention. There is no header, query parameter, or request field that selects an adapter.

Checkout follows prepare, commit, call, record. One transaction establishes the operation and reserves its idempotency identity and commits; a second short transaction claims the instruction by moving `created` to `provider_pending`; only the winner of that claim calls the provider, outside every transaction, with a platform-generated key; a third records what came back. Fifty simultaneous submissions therefore produce one operation *and* one provider instruction — the idempotency key alone would have prevented a double charge, but it would have sent fifty identical instructions to do it.

An ambiguous provider outcome is neither success nor failure. The operation moves to `reconciliation_pending`, no second instruction is sent under a new key, and a job resolves it from the provider's own record. A `provider_pending` row with no provider reference means an instruction was in flight when the process stopped, and it is resolvable the same way.

Nothing a browser does moves a payment. The return and cancel URLs reach a read of the caller's own operation; there is no transition on that path, so arriving at a success URL by hand reports exactly what the platform already believed. Purchases are Consumer Web only — a Consumer Mobile bearer token is a valid consumer credential and is still refused, because a purchase from a mobile app is a different commercial arrangement and the boundary belongs at the API rather than in an absent screen.

No instrument data exists anywhere in this domain. Not a card number, not a last four, not an expiry, not redacted or hashed — absent. Collection happens on the provider's page under the provider's own compliance scope, and the API has no field that could carry one.

## Implemented: verified events, subscriptions, and the entitlement bridge

An external message becomes internal state through exactly one door. The webhook endpoint has no session, no audience, and no CSRF token: the provider's signature over the raw body is the entire credential. Size is bounded before the body is read as data, the signature is checked before it is parsed as anything, and only a verified event reaches storage — writing an unverified one would let anybody fill the table by posting nonsense at an unauthenticated endpoint.

The handler decides nothing. It records a receipt and acknowledges; a worker poller drains the receipts under a lease and applies each to current state. That separation is what stops a slow business transition from making a provider retry, and a provider retry is how one event becomes five.

Applying a settlement is one transaction: the payment reaches `succeeded`, the journal posts its balanced capture, the subscription is established, and the entitlement fact is appended to the outbox. All four or none — a payment marked succeeded without its journal entry is money nobody can explain, and an entitlement fact without the payment behind it is access nobody paid for. Every step is separately idempotent as well, because redelivery is expected rather than exceptional.

PRIVATE CLUBS consumes the fact and applies its own grant policy. BILLING never writes `clubs_` and PRIVATE CLUBS never reads `billing_`, so a commercial reversal revokes through the same door a payment granted through. A revocation only withdraws an entitlement whose source is `billing`: somebody who also holds a creator invitation keeps what the creator gave them, because the money ending is not the creator changing their mind.

`past_due` grants nothing. Whether a lapsed payment keeps access, and for how long, is grace policy nobody has approved, and the fail-closed reading of an unresolved policy is no access — recorded here as a deliberate choice rather than left as a gap.

## Implemented: refunds, disputes, and what a reversal means

A refund is a new financial event, never an edit of the payment it reverses. The capture keeps its amount, its state, and its provider reference forever, and what somebody was left paying is derived by reading the reversals against it. That is why `billing_refunds` is a table rather than a `refunded_amount` column: a column has no history, no provenance, and no way to describe two partial reversals issued by two operators on two days.

Reversal follows the same prepare, commit, call, record ordering checkout does, and adds one thing checkout does not need. A payment is bounded by a price nobody else is spending; a refund is bounded by an amount other refunds are spending at the same moment. The bound is therefore taken under `FOR UPDATE` on the capture — a lock that never modifies it and exists purely for the ordering — and enforced again by a database trigger that sums every reversal against the capture that is not `failed`. Fifty simultaneous full reversals of one charge return the money once, and they do so because PostgreSQL serialized them rather than because a handler looked first. A `failed` reversal releases what it reserved; an ambiguous one does not, because the money may well have moved.

Cross-currency is structurally impossible: a reversal reaches its capture through a composite key over identifier and currency, so a EUR refund of a USD charge cannot be inserted at all. Reversing a capture that never settled is refused for the same reason it is meaningless — it would be a claim about a movement that never happened.

The accounting is compensating rather than corrective. A refund debits a contra-revenue position and credits the position the provider holds Velora's money in, so the sale and its reversal are both visible in the book rather than one replacing the other. Nothing is posted until the provider confirms: an accepted-but-pending reversal has no entries, because a posting on acceptance would be a movement nobody has confirmed.

A dispute is modelled separately, and the distinction is not cosmetic. A refund is Velora deciding to return money; a dispute is somebody else's bank taking it, on a timetable Velora does not control, with an outcome Velora may lose. Only a verified provider event creates or moves one: there is no route, no operator action, and no job that can decide a dispute has happened. Opening one posts the withholding, because the provider really has taken the money out of Velora's position. Resolution settles it in one direction — won or withdrawn puts it back and the sale stands; lost sends it to the cardholder and unwinds the customer settlement, so a fully lost dispute leaves every position the capture touched at zero. Arrival order does not matter: a resolution that arrives before its opening establishes the claim in its outcome and still posts both legs, and a late opening cannot reopen what is settled. A claim whose amount disagrees with the capture is recorded as seen and accounted for not at all, because a dispute that cannot be reconciled against Velora's own record is not evidence of anything.

Access follows the money only when the money fully goes. A reversal of everything that was taken — by refund or by a lost dispute — publishes a revocation through the same outbox a payment granted through. A partial reversal changes nothing, because withdrawing access for part of a refund would be a commercial term nobody has approved. While a claim is merely *live*, access is untouched for the same reason, and that leaves one question genuinely open, so the fail-closed answer is applied to the only thing it can be applied to without taking something away: a consumer with a live claim cannot start a new purchase. That withdraws nothing they hold and commits Velora to nothing further while their bank is reversing the last payment.

There is no consumer-facing refund path anywhere in the API. Refund eligibility — who may ask, within what window, for what proportion — is unresolved commercial policy, and a self-service control would be a commercial promise nobody approved. What exists is one operator route, and a deployed environment refuses it twice over and independently: ADR-0017 requires a fresh phishing-resistant assurance and no verifier that can produce one is approved, so no session reaches the handler; and `BILLING_PAYMENT_PROVIDER` is `unavailable` there, so the service refuses before it writes anything.

## Implemented: the revenue split and what a creator has earned

A settled sale is divided between the parties with a claim on it, and the division comes from approved commercial terms and from nowhere else. `CommercePolicy.allocate` answers what one gross amount owes the creator, the platform, and a tax authority; the parts must sum to the gross exactly, because a split that loses a minor unit to rounding is a book that will not balance and one that gains a minor unit is money nobody paid. The unpublished policy — the only value staging and production accept — allocates nothing, which makes a capture unpostable rather than posted against a percentage nobody approved.

The capture posting is therefore the ordinary one: the provider's clearing position is debited the gross, and the creator's payable, the platform's revenue, and the tax position are credited their shares. `creator_payable` is subject-scoped, so "how much is owed to this creator" is a balance rather than a report. Nothing writes a tax position, because no tax authority is configured anywhere and computing one would be inventing an amount owed to a government.

A reversal withdraws the same claims in the same proportions. That is the difference between a payable a creator can trust and one they cannot: a contra-account model would leave the payable standing after a sale was refunded, and the creator would be shown money they are not owed. Two declared categories — `customer_settlement` and `refunds` — are consequently never written, and that is recorded here rather than left as a puzzle.

Partial reversals are exact rather than approximately exact. Each one is split as the allocation of everything reversed so far minus the allocation of everything reversed before it, so five partial refunds against one capture return exactly the capture and leave nothing behind. Splitting each reversal independently would round each one, and five roundings against a percentage leave a payable that never quite reaches zero.

One case has an arithmetic fallback rather than a policy. A cardholder's bank can take back the whole capture after part of it was already refunded, which is more than the sale ever allocated; no refund can do this, because the database refuses it. The excess lands on the platform's own share, because charging it to the creator would take back money Velora already agreed it owed them on the strength of an event they had no part in. A published policy may reallocate it.

The Creator Studio earnings surface reads this and nothing else. The payable is the ledger's balance, derived on every read and never cached, so a bug in the split shows up as a payable that disagrees with the sales rather than as money. Gross, the platform's share, what has been reversed, and what is currently claimed back are projections over the commercial records that produced those entries — computed on read, therefore rebuildable by construction, and never what a decision is taken against. Currencies are separate all the way to the screen: two currencies are two sets of figures and never a third that adds them, because the sum of a euro and a yen is not an amount. There is no chart, no trend, no forecast, and no conversion rate, because none of those are platform truth. History is one sequence of captures, reversals, and claims, keyset paged, carrying no consumer identifier — who bought something is not the seller's to know.

## Implemented: where Velora may transact, and what a sale owes

"Global" is the default nobody decides and everybody assumes. A platform with published prices and no country authority does not sell in no countries; it sells in all of them, quietly, the first time somebody with an unexpected address completes a checkout. `BILLING_COMMERCE_ELIGIBILITY` makes that an answer rather than an omission, and its only deployable value refuses every pairing.

The authority evaluates six independent gates and reports every one that is shut rather than the first it finds: the consumer's country is one Velora may sell into; the creator's country is one it may sell *from*, which is a different list answering to different law; the currency is approved for that pairing rather than in general; a payment capability exists; a payout capability exists, because selling into a country Velora cannot pay a creator out of accrues a liability it has no way to discharge; and a tax authority exists that can say what is owed. An absent country refuses. That is the whole point: the failure this seam prevents is an unknown value reading as permission.

The countries are facts Velora already holds rather than new ones it collects. The consumer's is the region on their own account, published through USERS' standing contract. The creator's is the region of the person behind the creator, asked of CREATORS through its published directory — because "where is this creator" is not BILLING's fact and reaching into `creators_` or `users_` to answer it would be the boundary violation the port exists to prevent.

Tax is a port, not a calculation. What a sale owes depends on where both parties are, what was sold, which registrations the platform holds, and which of them make it the merchant of record, and every one of those is unresolved. `BILLING_TAX_AUTHORITY` selects the engine and its only deployable value assesses nothing — which makes taxable commerce impossible rather than untaxed. Zero and nothing are deliberately different values: an authority that says a sale owes nothing has said something, and an absent authority has not, so a checkout with no authority refuses rather than charging a price whose tax component it assumed was nil.

The assessment is made outside every database transaction, for the same reason a payment provider call is, and then snapshotted onto the payment with the name of the authority that produced it. Both halves are set together or not at all, and a trigger freezes them: recomputing a historical sale against today's rates would silently rewrite what somebody was charged, and a rate change is exactly the event that makes somebody want to. Nothing posts tax to the journal, because posting it would require deciding how a reversal apportions it back — unresolved tax treatment rather than arithmetic — and a book carrying a number nobody has decided how to unwind is worse than one carrying none. The evidence lives on the sale.

A replay is answered before any of this runs. A repeated submission resolves to the operation it already created whatever the gates say today — a country withdrawn after somebody started paying does not un-start their payment — and it never reaches a tax engine, because asking somebody else's service about a sale that was already assessed would bill Velora for the question and put a duplicate in their records.

Nothing in any of this is legal or tax advice, and nothing in the repository decides a country list, a registration, or a rate.

## Cross-references

[monetisation](../product/05-monetisation.md), [payment lifecycle](../flows/payment-lifecycle.md), [money flow](../architecture/10-money-flow.md), [payment security](../security/05-payments-webhooks.md), [payment compliance](../compliance/04-payments-tax-payout-gates.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [finance operations](../operations/03-finance-payout-operations.md), [payment/payout ADR](../decisions/ADR-0011-payments-payouts.md), [money architecture ADR](../decisions/ADR-0021-monetization-money-architecture.md), [PAYOUTS](payouts.md).
