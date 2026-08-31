# LIVE domain

## Purpose and scope

LIVE owns random live discovery: who is waiting to meet somebody at random, which two people the server put together, and what they typed to each other while they were together.

It owns none of the facts an encounter depends on. AUTH owns the principal and the session that authenticates a request. USERS owns admission and account standing. DISCOVERY owns whether two people are introduced. TRUST & SAFETY owns blocks, enforcement, and every communication restriction. REALTIME owns the call session that carries an encounter. MESSAGING owns the durable conversation a mutual connection authorizes. LIVE asks each of them through its published contract and re-derives nothing.

It does not own profiles, photographs, conversations, message history, call lifecycle, provider state, presence projections, recordings, or transcripts. **Nothing here is media**: no recording, transcript, frame, SDP, ICE candidate, TURN credential, or participant address has a column.

V1 is one-to-one random discovery between two adults. Group rooms, broadcast, audiences, spectators, paid sessions, and recording are out of scope and unbuilt. [ADR-0040](../decisions/ADR-0040-random-live-discovery.md) is the architecture authority.

## The three facts an encounter is made of

**A participation** records that somebody is in the matching pool, and what they entered it for. One row per time a person entered it, rather than one per person for ever, so a record of who waited and for how long survives without a second table.

**An encounter** records that the server put two specific people together, when, and what became of it. There may be many encounters per pair over time — meeting is an event, not a relationship — so the uniqueness constraint is scoped to the live one.

**A live message** records something one of them typed inside that encounter. It is not a conversation and never becomes one.

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
- the two have not met live within the rematch-suppression window.

The last is not a block and not a judgement. The pair may still find each other through Discover, may still connect, and are free to meet again afterwards; being handed back the person you just moved on from is simply the fastest way to make random discovery feel broken.

Finding nobody is a complete answer. It renders as "still searching", which is true, and the next poll tries again.

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

## Presence

There is no presence projection, no gateway, and no heartbeat endpoint. A client that is reading the live state is present; one that has stopped reading is not.

That is the only mechanism by which "the other person closed the tab" becomes visible at all: a closed tab, a phone that lost signal, and a killed process all send exactly nothing, so absence is measured rather than announced. A sweep closes participations whose client has gone quiet, and the encounter they were in ends for `presence_lapsed` — never for a departure, because nobody decided anything and telling the other side "they moved on" would be a claim about a decision that was never taken.

**No count of anybody is ever published.** Not who is waiting, not who is online, not how many people the platform has. The contract carries no shape that could hold one, because a number there would be invented.

## Safety

A block ends the encounter and the live session together, in the transaction that writes the block, under the pair lock it already holds. Two contracts because they are two rows owned by two domains: the encounter is LIVE's and the session is REALTIME's, and neither domain writes the other's table.

A restriction ends every live encounter its subject is in and takes that account out of the pool, so a restricted account is never handed to the next person waiting.

Both people come off a safety-ended encounter and neither is ejected from the pool. The blocked person is not told and is not removed: they were looking to meet somebody, that has not changed, and removing them would be a visible consequence of another person's private safety decision.

What a participant may be told is coarse. `safety_block` and `safety_enforcement` are separate decisions with separate owners; both become `ended_by_platform` on the wire, and the distinction stays inside the platform where an operator can see it.

## What is never recorded

**No live encounter is recorded, stored, transcoded, or transcribed.** No code path does any of those things, no configuration value enables one, and no surface may claim or imply that a live session is recorded or could be. Enabling recording would be a separate architecture with its own consent, indication, retention, moderation, evidence, deletion, and jurisdiction decisions, none of which exists.

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
