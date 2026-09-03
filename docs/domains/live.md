# LIVE domain

## Purpose and scope

LIVE owns random live discovery: who is waiting to meet somebody at random, which two people the server put together, and what they typed to each other while they were together.

It owns none of the facts an encounter depends on. AUTH owns the principal and the session that authenticates a request. USERS owns admission and account standing. DISCOVERY owns whether two people are introduced. TRUST & SAFETY owns blocks, enforcement, and every communication restriction. REALTIME owns the call session that carries an encounter. MESSAGING owns the durable conversation a mutual connection authorizes. LIVE asks each of them through its published contract and re-derives nothing.

It does not own profiles, photographs, conversations, message history, call lifecycle, provider state, presence projections, recordings, or transcripts. **Nothing here is media**: no recording, transcript, frame, SDP, ICE candidate, TURN credential, or participant address has a column.

V1 is one-to-one random discovery between two adults. Group rooms, broadcast, audiences, spectators, paid sessions, and recording are out of scope and unbuilt. [ADR-0040](../decisions/ADR-0040-random-live-discovery.md) is the architecture authority, and [ADR-0041](../decisions/ADR-0041-live-discovery-preferences-choice-and-presence.md) adds preferences, choosing somebody, reactions, and the presence sweep. [ADR-0042](../decisions/ADR-0042-live-surface-refinements.md) refines the two surfaces without changing any of it. [ADR-0043](../decisions/ADR-0043-livekit-transport-coins-and-paid-live-preferences.md) makes the media real and adds one paid narrowing, and this domain gains exactly one thing from it: a contract it can ask [WALLET](wallet.md) about a bought window and tell it that the window produced an encounter. [ADR-0044](../decisions/ADR-0044-declared-matching-categories-and-premium-preference-sets.md) widens what a window can narrow on and makes it apply from **both** sides of a pair — the matcher reads every candidate's own window as well as the actor's, so somebody who paid to meet only women is never handed a man by his search, and it learns one bit per window rather than an attribute.

**Random matching is free and stays free.** Both narrowings this domain already offered — anywhere or near me, and one of your own languages — cost nothing and are unchanged. A paid window is applied to the candidate *pool*, before any safety, standing, enforcement, or eligibility predicate is asked, so it can only ever make the pool smaller; every predicate below is asked identically, in the same order, under the same pair lock, whether or not anybody paid. The contract WALLET publishes here has no method a safety decision consults, and that is why.

## The three facts an encounter is made of

**A participation** records that somebody is in the matching pool, and what they entered it for. One row per time a person entered it, rather than one per person for ever, so a record of who waited and for how long survives without a second table.

**An encounter** records that the server put two specific people together, when, and what became of it. There may be many encounters per pair over time — meeting is an event, not a relationship — so the uniqueness constraint is scoped to the live one.

**A live message** records something one of them typed — or tapped — inside that encounter. Its `kind` is `text` or `reaction`, and both are the same write with the same bound, the same idempotency key, the same server-allocated position, and the same safety re-composition, because both are equally the subject of a report about the encounter. What differs is rendering: a reaction is a moment on the picture and is never shown in the chat. It is not a conversation and never becomes one.

**A request to meet** records one person asking one other person to meet live. It is the counterpart to the pool — the pool is the server choosing, this is a person choosing — and it is a *request*, with the lifecycle a request honestly has. `accepted` means both agreed and are not both here yet, because accepting cannot conjure a live session out of somebody who has closed the tab. It authorizes nothing: an accepted request is a reason to pair two people *first*, and every predicate below is asked again when an encounter is allocated.

What is deliberately *not* a fact here: whether either person's camera is open. The server has no opinion about that, and a client that told it so would be asserting something about itself that the platform would then store and act on.

## Lifecycle

A participation is `searching`, `matched`, `ended`, or `left`. The first three all occupy the pool and are guaranteed to be one per person by a partial unique index, which is what makes "one account cannot hold two random matches" a property of the database rather than of whichever code path checked first.

`ended` is the state that makes "they moved on" sayable. When an encounter finishes, both people move to it and both keep naming the encounter, so each surface can say what happened rather than silently replacing the person somebody was talking to with a search. The one exception is the person who pressed Next: they have already said what they want next, and go straight back to `searching`.

An encounter is `live` or `ended`, and there is no third state. Neither person was invited — both entered the pool, which is a stronger and earlier consent than answering a ring — so there is nothing to accept and nothing to decline. A vocabulary with `invited` in it would be a random encounter pretending to be a call.

Every transition is a guarded update that restates the state it expects, so two people pressing Next at the same instant end one encounter between them and the loser observes it rather than overwriting it. The reason and the instant are written by the same statement as the state, so no row can say an encounter ended without saying why.

## Matching

Matching is the one decision in this product that is not about a pair until after it has been taken. It reads everybody who is waiting and then chooses two of them, and a pair lock cannot serialize that because neither matcher knows the pair yet.

So the matcher runs one at a time, under a transaction-scoped advisory lock on a single constant key, taken *before* any pair lock. Every other transaction in this domain takes a pair lock and nothing else; this one takes the global lock and then a pair lock, never the reverse. That is what keeps the lock graph acyclic and stops a match deadlocking with a block landing on the same two people.

Under that lock, candidates are read without a row lock and re-checked under the pair lock before anything is written, for the same ordering reason.

A candidate is refused unless every one of these holds at that instant:

- the pair is not blocked in either direction — asked of TRUST & SAFETY, in batch first for cost and again per candidate under the pair lock for authorization;
- the candidate's account is in a standing that permits interaction — asked of USERS;
- no live enforcement denies consumer interaction to the candidate — asked of TRUST & SAFETY;
- the two have not met live within the rematch-suppression window, unless they asked to meet each other — suppression stops the *matcher* handing back somebody you just moved on from, and refusing two people who named each other would be suppression acting as a rule about people rather than about randomness.

The rematch rule is not a block and not a judgement. The pair may still find each other through Discover, may still connect, and are free to meet again afterwards; being handed back the person you just moved on from is simply the fastest way to make random discovery feel broken.

People who agreed to meet are considered before the pool is scanned, as a separate read rather than a sort key: an agreement is a reason to pair two people, and folding it into the ordering of a scan bounded at twenty would mean an agreement quietly falling off the end of a busy pool.

**Preferences narrow the pool and promise nothing.** A search may be narrowed to people in the caller's own region and to one language the caller already speaks. Both are stored on the participation rather than on the account, because they describe *this* search. Neither is evaluated here: which country somebody is in and what they speak are USERS' facts, and LIVE asks USERS a membership question over identifiers it already holds, on the matcher's own connection — a copy would be a fact this domain does not own, and a second pooled connection inside the matching transaction would be the deadlock [ADR-0019](../decisions/ADR-0019-database-connection-admission.md) exists to prevent. A language the caller does not speak is dropped rather than honoured, and the state that comes back says which preferences are being applied.

Finding nobody is a complete answer. It renders as "still searching", which is true, and the next poll tries again. No surface says nobody matching exists, because no surface can know that.

## Eligibility

LIVE introduces no new social relationship. Entering the pool requires exactly what messaging and calling require, taken from the same derived answer rather than a second copy of the rule:

- an authenticated Consumer principal on the Consumer audience;
- an account that is active and has completed onboarding, including adult declaration and the required policy acknowledgements;
- the environment's `LIVE_DISCOVERY_MODE` permitting it at all.

An account that may not send a message may not meet a stranger on camera either, and that ordering is deliberate: the second is the more exposing of the two.

No answer is cached. There is no `eligible` column anywhere in `live_`, for the same reason `realtime_` has none.

## The live session

An encounter is carried by an RTC session that REALTIME owns. LIVE opens it through a published contract, records the reference, and can ask for it to be ended; it cannot accept, reject, cancel, extend, revoke, or issue a credential for anything. A client asks REALTIME directly for a join credential, through the route that re-composes eligibility on every single issuance.

That session's `purpose` is `live_discovery`, and its eligibility is composed against the encounter rather than against an introduction. It is asked in exactly the places a call's introduction is asked — on creation, on every issuance, on every reconnect — so an encounter ending refuses the reconnect a client is already attempting.

Opening the session and reaching a provider both happen outside every transaction. An encounter with no session is a product state a surface can render honestly; a session with no encounter would be a room nobody owes anything about, so the encounter is always written first.

## Connecting

Connect signals an introduction through DISCOVERY's own contract, and through nothing else. One tap never produces a mutual connection: the introduction becomes mutual only when the other person has independently signalled too, which is a compare-and-set inside DISCOVERY's transaction — so two people pressing Connect at the same instant produce exactly one introduction and exactly one conversation.

DISCOVERY treats a recent live encounter as a second reason two people may be introduced, bounded by the rematch window. Without it, Connect would silently fail after a good conversation whenever the peer was not a current candidate of the caller's, which is most of them.

When the introduction becomes mutual, the durable conversation is opened immediately rather than left for the Inbox to create, so the relationship exists the moment both people chose it. It is idempotent by MESSAGING's own unique index over the pair.

## Live chat

What two strangers type belongs to the encounter. It is read through LIVE's contract only, no code path copies it into `messaging_messages`, and when the encounter ends it stops being reachable by either person. A pair that ends an encounter without connecting leaves nothing in either Inbox.

It is durable anyway, because a report about what somebody said is unanswerable if the platform threw the words away — and because a message that vanished when the encounter ended would be one a person could screenshot and a platform could not review.

Ordering is a server fact. The position comes from the encounter's own allocator under a row lock, so two people typing at the same instant get distinct adjacent positions and neither client's clock participates. A repeated client identifier writes nothing and answers the same list, decided by a unique index rather than by a prior read that two concurrent retries would both pass.

## What a peer may be shown about a peer

An encounter publishes the other person's display name, region, the languages the two of them share, and whatever they wrote about themselves — the same minimized shape, with the same narrowing, that DISCOVERY publishes a candidate in. Every field is one that person published about themselves, and all of it is read through USERS' published directory at render time rather than copied.

Photographs are deliberately absent. Whether one consumer may see another's imagery is DISCOVERY's `mayViewProfileMedia` question, which answers yes for exactly two reasons — the pair holds a live introduction, or the subject is a candidate the viewer could be shown right now — and two strangers the matcher put together hold neither. The live video is the picture.

Nothing published here says whether anybody is available, online, or how often they are here.

## Presence

There is no presence projection, no gateway, and no heartbeat endpoint. A client that is reading the live state is present; one that has stopped reading is not.

That is the only mechanism by which "the other person closed the tab" becomes visible at all: a closed tab, a phone that lost signal, and a killed process all send exactly nothing, so absence is measured rather than announced. A sweep closes participations whose client has gone quiet, and the encounter they were in ends for `presence_lapsed` — never for a departure, because nobody decided anything and telling the other side "they moved on" would be a claim about a decision that was never taken.

**The sweep runs on the worker**, in a composition of this domain that can admit nobody: every port it is handed that could match, introduce, open a conversation, or authorize a session refuses. It ends encounters and closes participations and does nothing else, because a worker able to do any of the rest would be a second way in that no request path guards. Under ADR-0040 the sweep existed and nothing called it, which meant the presence model was true only in the sense that the code for it was written.

**No count of anybody is ever published.** Not who is waiting, not who is online, not how many people the platform has. The contract carries no shape that could hold one, because a number there would be invented.

## Safety

A block ends the encounter and the live session together, in the transaction that writes the block, under the pair lock it already holds. Two contracts because they are two rows owned by two domains: the encounter is LIVE's and the session is REALTIME's, and neither domain writes the other's table.

A restriction ends every live encounter its subject is in and takes that account out of the pool, so a restricted account is never handed to the next person waiting.

Both people come off a safety-ended encounter and neither is ejected from the pool. The blocked person is not told and is not removed: they were looking to meet somebody, that has not changed, and removing them would be a visible consequence of another person's private safety decision.

What a participant may be told is coarse. `safety_block` and `safety_enforcement` are separate decisions with separate owners; both become `ended_by_platform` on the wire, and the distinction stays inside the platform where an operator can see it.

## What is never recorded

**No live encounter is recorded, stored, transcoded, or transcribed.** No code path does any of those things, no configuration value enables one, and no surface may claim or imply that a live session is recorded or could be. Enabling recording would be a separate architecture with its own consent, indication, retention, moderation, evidence, deletion, and jurisdiction decisions, none of which exists.

## Translation

Nothing translates anything, and no surface offers or implies that it does.

The seam exists: the AI gateway carries capability manifests, per-capability activation, and a provider that is `unavailable` by default and refused in staging and production, and a translation capability would sit behind it unchanged. It is not taken because no provider is approved — a control that never works is worse than an absent one, and text labelled as translated when nothing translated it is worse than either. Recorded as an open decision in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## Somebody who left can still be reported

A random encounter has no relationship behind it. That is the product working as intended, and it used to make one thing impossible: the other person behaved badly, pressed Next, and every control that named them left the screen with them. There was nowhere on the product to reach for, and asking somebody to remember a stranger's display name in order to report them is asking them not to bother.

`GET /v1/live/recent-people` answers who this caller met and has already finished with, newest first, bounded to ten people over twenty-four hours. It publishes the same minimized public shape a peer is shown during an encounter — name, roughly where, shared languages, whatever they wrote — and carries no message, no duration, no end reason, and nothing about the call. It is a way back to somebody for a safety action, not a history of the meeting and not a directory of strangers.

Two rules make it safe. It reports **ended** encounters only, because a live one is already published in live state and returning it twice would put the same person on the screen under two meanings. And it is deliberately not gated on the caller's own live eligibility: somebody whose standing lapsed, or who has been restricted since, must still be able to report the person they met, on the same rule TRUST & SAFETY already applies to blocking and reporting.

Retention is unchanged by it. Nothing expires when an encounter passes out of the window; the list stops offering it, and the row stays exactly as long as it did before — which is still `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Configuration and blockers

`LIVE_DISCOVERY_MODE` defaults to `unavailable`, admits nobody to the pool, and is rejected at startup in staging and production. Random discovery ends in a call between two strangers, so it inherits every blocker calling has and adds one of its own:

- no approved RTC provider;
- live-encounter retention duration undecided;
- live-message retention duration undecided;
- regional availability undecided;
- recording posture undecided;
- RTC operations ownership unassigned;
- live moderation coverage unassigned.

`LIVE_DISCOVERY_SIMULATION` defaults to `unavailable` and is rejected in the same environments. Where it is `local-test`, the matcher may offer a seeded local account as a stand-in — a real row, really onboarded, really eligible — and every scenario drives that account through the same published service methods a person's client calls. Nothing about it is fabricated, and every safety and standing predicate applies to it exactly as it would to anybody else.

## Cross-references

[ADR-0040](../decisions/ADR-0040-random-live-discovery.md), [REALTIME](realtime.md), [DISCOVERY](discovery.md), [MESSAGING](messaging.md), [TRUST & SAFETY](trust-safety.md), [USERS](users.md), [ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md), [domain boundaries](../architecture/03-domain-boundaries.md), [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
