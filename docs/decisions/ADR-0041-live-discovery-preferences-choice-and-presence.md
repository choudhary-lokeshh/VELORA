# ADR-0041: Choosing somebody, narrowing a search, and the presence sweep that was never scheduled

- Decision date: 2026-08-31
- ADR status: Accepted
- Owners: Founder (decision owner), LIVE, DISCOVERY, USERS, TRUST & SAFETY, REALTIME, security, privacy, operations

## Context

[ADR-0040](ADR-0040-random-live-discovery.md) built random live discovery as a bounded domain and proved the loop end to end: two eligible strangers, matched by the server, put into one live session, able to connect, and able to move on. Everything in it works and the shape of it is right.

What it produced was a first functional implementation rather than a live-social product, and the gap was visible the moment either surface was opened rather than tested. Consumer Web rendered a page — a heading, a card of explanatory copy, a video pane beside a chat pane, a row of equally weighted buttons. Consumer Mobile rendered the same page in React Native, inside a `ScrollView`, so a conversation was something a person scrolled. Neither had anything to say about the other person beyond a name. Neither offered any way to influence who was found. Neither offered any way to reach a *particular* person. And the presence model the whole product rests on — reading is presence, silence is absence — had nothing running that measured the silence.

Four questions had to be answered before the screens could be rearranged, and each is architectural rather than visual.

**What may a stranger be shown about a stranger?** A name alone is not enough to decide whether to talk to somebody, and a full profile is more than two people put together by a matcher have earned from each other.

**Can a search be narrowed without narrowing it into a filter over a population?** "People near me" is a preference somebody holds about themselves. "People in a country I picked from a list" is a filter over other people, and a shape that can express the second will eventually be used for it.

**Can a person choose somebody without the platform promising something it cannot deliver?** Two people agreeing to meet does not put them in a live session; one of them may have closed the tab. A product that says "connecting…" there is lying, and a product that silently drops the request is worse.

**Who notices that somebody left?** Nobody in a live encounter is going to report that the other person's tab closed.

## Decision

### A peer is published in DISCOVERY's minimized public shape, minus its imagery

An encounter now carries the other person's display name, region, the languages the two of them share, and whatever they wrote about themselves — the same fields, with the same narrowing, that DISCOVERY already publishes a candidate in. They are read through USERS' published directory at render time and copied nowhere.

Photographs are deliberately absent. Whether one consumer may see another's imagery is DISCOVERY's `mayViewProfileMedia` question, and it answers yes for exactly two reasons: the pair holds a live introduction, or the subject is a candidate the viewer could be shown right now. Two strangers the matcher put together hold neither. Broadening that rule so a card could have a photograph on it would be a privacy decision taken for a layout reason, and the live video is the picture in any case.

### Preferences are two values, both about the person holding them, and neither is a promise

A search may be narrowed on region — `any` or `same`, never a country picker — and on one language, which must be one the caller already speaks. That is the whole vocabulary and the contract cannot express more: there is no shape in it that could hold a compatibility score, an age band, a body attribute, an inferred characteristic, or anything purchasable.

Both are stored on the participation rather than on the account, because they describe *this* search. Somebody who narrowed to one language yesterday is not silently still narrowed tomorrow.

Neither is a filter LIVE evaluates itself. Which country somebody is in and what they speak are USERS' facts, and LIVE asks USERS a membership question over identifiers it already holds — "which of these people match" — on the matcher's own connection. A copy in `live_` would be a fact this domain does not own and one that goes stale the moment somebody moves; a second pooled connection inside the matching transaction would be the deadlock ADR-0019 exists to prevent.

Applying a preference narrows the pool and a narrower pool takes longer. The surfaces say that and offer to widen it. What no surface does is claim that nobody matching exists, because neither surface can know that, and what no matcher does is quietly ignore the preference and hand over somebody who does not match.

### Choosing somebody is a request to meet, with the lifecycle a request honestly has

`live_invitations` records one person asking one other person to meet live. Its states are `pending`, `accepted`, `met`, `declined`, `cancelled`, and `expired`, and `accepted` is the one that keeps the product honest: it means both people agreed and are not both here yet. Accepting cannot conjure a live session out of somebody who has closed the tab, so the model says so and waits, and the matcher pairs an agreed couple *before* it scans the pool the next time both of them are searching.

Creating one is gated on DISCOVERY's own answer to whether these two may be introduced right now — the same predicate a signal from the feed is revalidated against — so a harvested identifier reaches somebody who has turned discoverability off exactly as often as a signal would, which is never. Random matching deliberately does *not* consult that predicate, because the matcher exists to put together people who were never each other's candidates.

An accepted request authorizes nothing. Every eligibility, standing, block, and enforcement predicate the random matcher composes is composed again, in the same order, when the encounter is allocated, and the request is spent the moment it produces one — an agreement that survived the meeting it asked for would be redeemable again against somebody who has since moved on from wanting it.

Rematch suppression does not apply to a pair who asked to meet. Suppression stops the *matcher* handing back somebody you just moved on from; refusing two people who named each other would be suppression acting as a rule about people rather than about randomness. A block still refuses them, before and under the pair lock.

There is no notification for an invitation. A person sees the requests waiting for them when they open Live, and that is the whole of it in this phase; wiring NOTIFICATIONS to it is a product decision that has not been taken and is recorded as open below.

### A reaction is a line in the encounter, and never a gift

`live_messages` gains a `kind` of `text` or `reaction`. Both go through the same bound, the same idempotency key, the same server-allocated position, and the same safety re-composition inside the transaction — because both are things one of two people sent the other during an encounter, and both are equally the subject of a report about it. The reaction body is one of six values and the database enforces that, so a reaction can never become a second text channel.

What differs is entirely rendering. A reaction rises over the picture and is gone; it never appears in the chat, because a transcript of who waved when is history this feature deliberately does not keep in front of people.

Nothing here costs anything or credits anybody. Attaching VELORA's gifting to a conversation between two strangers is a separate product and safety decision, and it has not been taken.

### The presence sweep runs on the worker, in a composition that can admit nobody

`sweepLapsedPresence` was written under ADR-0040 and **nothing ever called it**. LIVE was composed on the API and not on the worker, so no schedule reached it. A local world half an hour old held five participations still `searching` from hours earlier and four still `matched` to encounters nobody had attended since; deployed, that is a pool full of closed tabs and a person left on a screen that still says the other one is there.

LIVE is now composed on the worker for that one cycle. Every port it is handed that could admit anybody refuses: it ends encounters and closes participations, and it can neither match, introduce, open a conversation, nor authorize a session. A worker able to do any of those would be a second way in that no request path guards, which is the same rule REALTIME's worker composition already follows.

### The surfaces are stages, not documents

Both surfaces are rearranged around the picture. Once somebody has asked for their camera it is the ground of the screen while there is nobody to look at, and moves to a corner the moment there is; the other person owns the canvas, and the controls, the chat, the profile context, and the safety control float over it. Consumer Web takes one new shell option to escape the reading column, because a measure that makes a paragraph legible is the wrong container for a face. Consumer Mobile stops scrolling entirely during a conversation.

Controls are weighted by frequency and cost rather than laid out in a row. Next is the heaviest control on both surfaces because it is the most frequent act in the product, and it acknowledges before the server answers — the teardown underneath is unchanged, still names the encounter it ends, and still discards a late answer about a previous one. Connect is quieter and takes the accent only when the other person is waiting on it. End is obvious without being loud, and nothing is behind a menu. There is no confirmation on Next: a dialog between a person and the next conversation would be friction defended as care.

A mutual connection gets a restrained moment naming the Inbox conversation. It does not end the call, move anybody, or imply urgency — two people who have just agreed to keep talking are left talking.

### Nothing new is invented, and the absences from ADR-0040 all hold

No count of who is waiting, who is online, or how many people the platform has appears anywhere, and no shape in the contract can carry one. No profile is labelled available or online: availability is not published by the discovery feed and neither surface can prove it. No compatibility score, match percentage, or trust badge exists — VELORA has no trust signal it owns well enough to publish, and copying one would be inventing it. Searching conveys progress through the person's own live picture and three true phrasings of "still looking", and never through a queue position, a rotating face, or a progress bar tied to nothing.

### Translation is a documented extension point and nothing more

Communicating across languages is a real differentiator in mature live-discovery products, and VELORA has an AI gateway with capability manifests, per-capability activation, and a provider that is `unavailable` by default and refused in staging and production. A translation capability could sit behind that seam unchanged.

No translation is implemented, no capability is declared, and no surface offers or implies one. There is no approved provider, so anything shipped would be a control that never works, and the one thing worse than absent translation is text labelled as translated when nothing translated it. The seam is recorded here and in `docs/domains/live.md`; taking it is a decision with a provider, a cost, and a privacy review attached.

## Consequences

- A person can now influence who they meet without the platform being able to express a filter over a population, and the honest cost of narrowing is stated rather than hidden.
- Selected matching exists without a promise the platform cannot keep, and without a second authorization path: an agreement is a reason to pair two people first and never a permission.
- Reactions are moderatable on the same terms as messages, at the cost of one column and one check constraint, and are still invisible to the Inbox.
- The presence model is now true rather than aspirational. Stale participations are closed within a sweep interval of the grace expiring, on both sides.
- LIVE is composed twice — once on the API with everything, once on the worker with almost nothing. The refusing composition is the point and is asserted by its own stubs.
- Both consumer surfaces now have a primary destination that reads as a live product and that no deployed environment can serve. That remains a phase-map fact.

## Rejected alternatives

- **Show the peer's photographs.** It requires broadening `mayViewProfileMedia` for a pair that holds neither reason it answers yes for — a privacy change made for a layout.
- **Copy region and languages onto the participation.** A fact this domain does not own, stale the moment somebody moves, and one more place a privacy decision would have to be re-made.
- **Let a preference name a country.** Expressible means eventually used; "near me" is a preference, "in that country" is a filter over people.
- **Make accepting an invitation open a live session.** It puts somebody into a video call because a person who is not there tapped a button.
- **Let an accepted invitation skip a predicate.** Then a request from an hour ago would be a standing permission, which is exactly what the session `purpose` column exists to prevent elsewhere.
- **Give reactions their own ephemeral channel.** Process-local state that no second instance shares, and a thing said between two people that no report can reach.
- **Put reactions in the chat transcript.** It turns a moment into history the feature deliberately does not keep.
- **Add gifting to a random encounter.** A commerce and safety decision nobody has taken, in the one context where pressure to spend is least appropriate.
- **Show an availability or online badge in Choose.** The feed does not publish availability and this surface cannot prove it; the badge would be invented.
- **Publish a trust badge.** VELORA has no trust signal it owns well enough to be honest about, and a badge that means nothing is worse than none.
- **Sweep presence from the API process.** It is scheduled work, it is not a request, and the API composition can admit people — the worker composition cannot, which is why it is the right place.
- **Ship a translation control against no provider.** A control that never works, or text labelled translated when nothing translated it.

## Unresolved decisions

Everything ADR-0040 left open remains open and continues to block this. Added here: whether a request to meet should produce a notification, and whether live message translation should become an AI capability. Both are recorded in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).

## Cross-references

[LIVE](../domains/live.md), [DISCOVERY](../domains/discovery.md), [USERS](../domains/users.md), [ADR-0040](ADR-0040-random-live-discovery.md), [ADR-0025](ADR-0025-rtc-live-communications-architecture.md), [ADR-0019](ADR-0019-database-connection-admission.md), [domain boundaries](../architecture/03-domain-boundaries.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
