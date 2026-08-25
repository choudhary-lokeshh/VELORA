# DISCOVERY domain

## Purpose and scope

DISCOVERY owns candidate eligibility evaluation, candidate presentation, discovery preferences interpretation, introduction signals, and mutual introduction state. It does not own profiles, messages, payments, social content, creator entitlements, or enforcement source truth.

## Main flow and transitions

Build candidate set from authorized minimal profile projections plus current eligibility contracts. On show, record presentation with ranking/policy version. On introduction request, revalidate actor, target, block/enforcement, region/age policy, rate limit, and stale state. `eligible -> presented -> one_sided_signal -> mutual_introduction` when reciprocal valid signal exists; decline/withdrawal/block/enforcement leads to policy-defined `ineligible/closed`. Mutual introduction publishes connection fact for MESSAGING.

## Failure/concurrency/security

No candidate is a promise of availability or access. Idempotency key plus actor-target unique state prevents repeated signal from creating multiple introductions. Mutual actions race safely through transactional transition. DISCOVERY requests block/enforcement eligibility from Trust & Safety at decision time; cached feed never overrides it. Return privacy-preserving denial, not another user's restriction reason.

## Permissions/data/events/phase

Consumer acts on own discovery state only. Owner stores minimal candidate/presentation/intro state and retention-limits exposure analytics. Events: candidate shown, signal sent/withdrawn, mutual intro created/closed. V1. Phase 2 premium priority controls; Phase 3 paid visibility/advanced filters. Pricing never guarantees another person's response.

## Implemented V1 discovery

`0006_discovery` adds the two DISCOVERY-owned tables. Neither carries a foreign key to a consumer account: cross-domain references are stable identifiers rather than shared schema, on the rule [data ownership](../architecture/05-data-ownership.md) records.

### Where candidate data comes from

DISCOVERY does not read `users_` tables. USERS publishes a consumer directory as a service contract, and DISCOVERY calls it with the criteria DISCOVERY owns. That is what [domain boundaries](../architecture/03-domain-boundaries.md) requires — another domain may call an approved service contract, not reach into a schema it does not own — and it keeps one module responsible for knowing what a profile looks like. The criteria crossing the boundary are values, never SQL: a domain that could hand the directory a predicate would be reaching into the schema by a longer route rather than not reaching into it.

### How the two halves of eligibility meet

The question "who may this person see" has an answer split across two domains. USERS knows who is eligible to appear at all; DISCOVERY knows which pairs this particular viewer has suppressed. Neither half can be moved into the other without one domain reading tables it does not own.

The directory therefore takes no list of identifiers to exclude. DISCOVERY reads a bounded batch of eligible candidates in ranking order, asks its own tables which of *those* candidates are suppressed or already paired, and repeats until the page is full or the ranked order ends. The cost of a page is a function of the page size and nothing else.

Asking the question in this direction is what removes the relationship-count ceiling. Carrying a viewer's suppressions into the candidate query made an unbounded value a query parameter, and the cap that bounded it was a correctness rule in disguise: an account with more live suppressions than the cap would have started seeing people it had declined. `0008_discovery_scale_hardening` removes it. No count of passes, declines, or introductions changes which candidates are eligible or in what order they are reached; it changes only how many batches a walk takes. A regression seeds more than a thousand live suppressions in real PostgreSQL and asserts that none of them leaks and that the feed still reaches what lies behind them.

Two bounds remain, and neither is a correctness rule. One request reads a bounded batch and walks a bounded number of them. Running out of that budget is not the end of the feed: the response carries the position the walk actually reached, so the client resumes from exactly there. A short page — including an empty one — with a cursor means "keep going", and only the ranked order running out ends a feed. Returning no cursor at a position the ranking never finished reading would be the silent truncation this design exists to remove.

### Blocks

A live block in either direction removes a candidate from the feed and refuses an introduction signal, and DISCOVERY decides neither: it asks TRUST & SAFETY's published contract. The feed asks about a bounded batch, so no count of a person's safety relationships enters a query plan; a signal asks about one pair inside the transaction that writes, under a lock on the ordered pair, so a block landing concurrently either precedes the signal or waits for it.

A blocked pair answers exactly as a candidate who is not there. Returning anything else would disclose another person's safety decision.

### Eligibility

A candidate appears only when every one of these holds, all of them in a single statement: the account is active; its most recent adult assurance is a pass that has not expired; its minimum profile is complete, including a ready image; discoverability is on; an availability window is open right now; it is not the viewer; the pair is not under a live pass suppression; and the two share at least one language.

Adult eligibility is read from the assurance evidence rather than inferred from account status. Status is reconciled on write, so an assurance that expires without any write would leave it stale; reading the evidence removes that gap for the one condition where being wrong matters most.

Nothing purchasable participates. There is no spend, subscription, popularity, follower, or boost column in the predicate, in the ordering, or in the schema behind either, so no future change can quietly buy visibility without adding one.

### Who may see somebody's photograph

USERS owns a consumer's profile images and cannot answer this, because it is a question about a relationship. DISCOVERY publishes the answer as a port, and there are exactly two ways to hold a reason.

**The pair holds a live introduction** — an unexpired pending signal in either direction, or a mutual one. Somebody who has turned discoverability off, whose availability window has closed, or who no longer matches on language does not vanish from a conversation they are already in, so this arm re-asks none of those.

**The subject is a candidate the viewer may currently be shown**, revalidated through the same predicate a signal is revalidated against. A photograph is therefore visible exactly where the person is, and stops being visible when they stop being eligible — including when their availability window closes, which is the one place presence legitimately reaches imagery.

Both arms are conditioned on Trust & Safety permitting the pair, so a block withdraws imagery in both directions at the next issuance whatever relationship preceded it. What is deliberately not asked is whether the *viewer* is discoverable: being seen and being able to see are different questions, and requiring the first would stop somebody who has turned themselves off from seeing the people they are already talking to.

Shared language is a requirement rather than a ranking signal, because two people who cannot read each other have nothing an introduction could lead to. Region is the opposite: a signal, not a filter, so a coarse mismatch orders somebody lower rather than making them invisible.

### Ranking

Deterministic and explainable: coarse region match, then shared language count, then availability freshness, then a rotating tie-break. No model, no attractiveness score, no popularity signal, no paid rank.

Availability freshness is compared in coarse buckets rather than by exact timestamp. Exact timestamps would make freshness nearly unique and the tie-break would never decide anything, which is the same as not having one; bucketing also stops being thirty seconds quicker to press a button from being an advantage.

The tie-break is a hash of the candidate identifier and a per-viewer seed that rotates on a fixed window. Inside a window the order is stable, so a reader paging through it never sees somebody twice or misses somebody; across windows the seed changes, so no account sits permanently at the top of everyone's tie group.

The four signals are composed into one opaque sort key, and paging is a single comparison against the last key of the previous page. That keeps the window stable while rows appear and disappear underneath it, which an offset never does.

### Pagination consistency model

Freshness is measured from when a person's availability *session* began, not from when their availability row was last written. `0008_discovery_scale_hardening` adds `users_availability.available_since`, which advances only when a closed availability opens again; extending a window, or repeating the same answer from a second device, leaves it alone.

That distinction is the whole consistency mechanism. Every component of the sort key — region, shared language count, freshness bucket, rotation hash, identifier — is then immutable for as long as a candidate's session lasts, so a candidate cannot move within the order while somebody is paging through it. Refreshing availability, the ordinary case that used to reorder a live feed, now changes nothing.

This was chosen over a cursor `asOf` snapshot. An `asOf` cannot recover a candidate's pre-update position, because the update overwrote it; it could only clamp everybody who wrote after the snapshot into one bucket, which moves them just the same. Ranking on a value that does not change costs one column and removes the movement outright, where a snapshot would have added a parameter and reduced it.

What the model guarantees, exactly:

- **No duplicates from availability churn.** A candidate delivered on an earlier page cannot reappear on a later one because of anything they do to their own availability.
- **Newly available candidates may be missed.** Somebody who becomes available mid-read enters near the front of the order, which a forward-only reader has already passed. They appear on the reader's next pass rather than being duplicated into this one.
- **Ineligibility takes effect immediately.** An account that is suspended, becomes undiscoverable, has its assurance lapse, or is later blocked disappears from subsequent pages at once. Safety always outranks snapshot stability; a feed is never allowed to be consistent with a state that is no longer permitted.
- **Profile edits still move a candidate.** Changing region or language count changes the key. Both are rare deliberate edits rather than routine churn, and the effect is bounded to one candidate's position.

Clients deduplicate by candidate identifier regardless. A feed reader that assumed uniqueness from the server would be relying on a property no live ranking can promise, and the residual cases above are exactly the ones that would break it.

### The cursor is not a credential

The cursor carries a position and the rotation window, and nothing else. It contains no account identifier, is not signed, and is not treated as authority: the acting consumer always comes from the presented credential, and every candidate on every page is re-evaluated against the full eligibility rules. The worst a tampered cursor can do is move a caller to a different position in their own feed. Signing it would add a key to distribute and rotate in exchange for protecting nothing, and would invite the much worse mistake of treating a cursor as proof of something.

### Presentation and passes

A presentation is recorded once per pair with a first-seen, last-seen, and count, not once per impression. An impression log would grow without bound in the hot path of every feed page; what the flow actually requires is that presentation is recorded with the ranking version behind it, which this carries at bounded cost.

A pass is private, one-directional, and expiring. Nobody is notified, no score is derived from it, and the pair returns to ordinary discovery after the single suppression window defined in the discovery policy module. Repeating a pass renews the window rather than failing, so a client that lost a response gets the same outcome instead of an error about a decision the person already made. A block is the stronger, indefinite suppression and belongs to Trust & Safety.

Suppression is applied by filtering each candidate batch against DISCOVERY's own tables rather than by carrying a viewer's declines into the candidate query. See "How the two halves of eligibility meet" above: there is no cap on how many suppression relationships an account may hold.

## Implemented mutual introductions

`0007_discovery_introductions` adds the pair state machine: `pending -> mutual`, and `closed` from a withdrawal, a decline, or an enforcement outcome.

The pair is stored as an ordered low and high identifier rather than as actor and target, so the same two people are the same row whichever of them acts first. Everything that depends on "these two people" then works without knowing who moved first.

A mutual introduction means both sides deliberately opted in. The transition is a compare-and-set against the *other* person's pending signal, with the initiator in the predicate, so an account can never make an introduction mutual by signalling twice, whatever a client sends. Two simultaneous reciprocal signals produce exactly one introduction: the partial unique index over the live pair rejects the second insert, and the loser then reads the winner's row and completes it. This is asserted with real concurrent requests against PostgreSQL, not simulated.

The index excludes closed rows, so a pair that closed can be introduced again later without the earlier attempt being rewritten or removed. Every closure stays on the record.

The target is revalidated at the moment of the signal rather than trusted from whatever page a client is still holding, which is what [the flow](../flows/discovery-introductions.md) requires. A target that is no longer introducible answers exactly as a target that does not exist, so probing discloses nothing.

A decline closes the introduction, tells the other person nothing, and suppresses the pair for the same window a pass uses — re-showing the pair immediately would make the decline meaningless. A withdrawal is the initiator changing their own mind, so it closes the introduction and suppresses nothing. Neither discloses a reason, and the closure reason is never rendered to either side.

### Signal expiry

A pending positive signal expires. It is an offer to meet somebody who is around now, so it cannot outlive the availability that produced it, and it cannot outlive the day either — an answer arriving a week later answers a question nobody is still asking.

The effective expiry is `min(originating availability window, creation + 24 hours)`, recorded on the row at creation from the initiator's own open window. Browsing is not gated on being available, so a caller with no open window gets the 24-hour ceiling, which is still bounded. `0008_discovery_scale_hardening` adds the column and refuses a pending row without one.

Expiry is enforced in the predicate of the mutual transition, not by a sweep. There is therefore no window in which a job has not yet run and an expired signal still completes. It also means no background job exists to fall behind, and no index is carried for one.

An expired signal is closed where it is found, with the reason `expired`, at the moment somebody acts on the pair. Nothing is rewritten: the row keeps who offered what and when, and gains only the reason it ended, so the evidence stays auditable. The pair is then free to be introduced again — expiry is the passage of time, not a decision, so it adds no suppression of its own. An expired signal is also invisible: it is absent from the caller's introduction list and cannot be declined or withdrawn, because there is nothing left to answer.

Explicit pass and decline suppression is unchanged at the approved seven-day window. A pass is still not a block.

Reappearance policy beyond this remains `DECISION REQUIRED`: a closed pair returns to ordinary discovery when the existing suppression expires.

Live pairs are excluded from the feed in both directions. Somebody already introduced, or already awaiting an answer, is not a candidate; discovery does not restart a pair that already has a state.

No idempotency key is required on a signal. The live-pair index already makes a repeat return the same introduction, so a client key would add a second mechanism for a property the database already guarantees.

### The connection contract

MESSAGING consumes the mutual fact through a published DISCOVERY contract rather than by reading `discovery_introductions`. The contract answers two questions and no others: whether a particular introduction is mutual and includes the caller, and whether two people currently hold a mutual introduction. It does not say who signalled first, when a signal expired, whether the pair ever declined, or what closed an earlier attempt, because the moment any of that were published another domain could start making decisions that belong to this one.

The second question accepts the caller's executor. MESSAGING asks it inside the transaction that persists a message, so "the connection was still live when the message was accepted" is a fact about one commit rather than about two.

A closure keeps its evidence. `0010_introduction_closure_evidence` corrects a constraint that would have forced an enforcement closure of a mutual introduction to erase `mutual_at`; a closed row now keeps the moment the two people connected, which is what an audit of an enforcement action needs to be able to read.

## Cross-references

[discovery flow](../flows/discovery-introductions.md), [Trust & Safety](trust-safety.md), [consumer product](../product/02-consumer-product.md), [monetisation](../product/05-monetisation.md).

## The published fact

`discovery.introduction.mutual.v1` is appended to `discovery_outbox` by the transaction that promotes a pending signal to mutual, under the pair lock that transaction already holds. It names the initiator as the person to tell and the responder as the subject: the responder performed the action synchronously and received the introduction in the response to their own request, so telling them again would be a notification about something they just did.

The payload is three identifiers. No display name, no profile field, and no reason the two were surfaced to each other — a notice about an introduction has to be renderable from an authorized read rather than from whatever a delivery payload happened to carry.
