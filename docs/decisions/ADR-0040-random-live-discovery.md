# ADR-0040: Random live discovery, and the LIVE domain that owns it

- Decision date: 2026-08-31
- ADR status: Accepted
- Owners: Founder (decision owner), LIVE, REALTIME, DISCOVERY, MESSAGING, USERS, AUTH, TRUST & SAFETY, security, privacy, compliance, operations

## Context

Every social relationship VELORA has been able to form so far is asynchronous and mutual before it is anything else. DISCOVERY shows two people to each other, each of them independently opts in, and only then may they message ([ADR-0027](ADR-0027-consumer-web-product-interface.md)) or call ([ADR-0025](ADR-0025-rtc-live-communications-architecture.md)). That is a good rule for a product built around browsing, and it produces a product nobody has a reason to open twice a day: a feed of people who were here earlier, and an inbox of conversations that already exist.

The product this platform is meant to be is the other one. Somebody opens VELORA, presses one control, and is talking to one other adult who is there *right now* — and if it is good, they connect, and the conversation survives; and if it is not, they move on, and nothing survives. Everything about that is available in the architecture already except the part that makes it happen: two strangers being put together by the server.

Four things stood in the way, and each is a real architectural question rather than a screen that needed writing.

**Nothing in the platform allocates a pair.** Every write in this codebase is about a pair that already exists — a viewer and a candidate, two people who are introduced, a caller and a recipient. Matching is the first decision that is not about a pair until after it has been taken, and a pair lock cannot serialize it, because neither matcher knows the pair yet.

**A call is authorized by a mutual introduction, and strangers have none.** ADR-0025 fixed one eligibility composition for RTC: authenticated principal, account standing, current mutual introduction from DISCOVERY, no pairwise block, no live enforcement. Three of those five are exactly right for two strangers. The fourth is exactly wrong, and there is no version of "mutually introduced" that two people who met ninety seconds ago satisfy without the phrase losing its meaning everywhere else it is used.

**A temporary meeting must not become permanent history.** Two strangers typing at each other for four minutes and then never speaking again must leave nothing in either Inbox. But it must leave something the platform can moderate, because a report about what somebody said is unanswerable if the words were thrown away. Those two requirements pull in opposite directions, and MESSAGING can satisfy only the second.

**Being put together is not consent to be recorded, counted, or presented.** Random video is the feature where a person most reasonably fears being recorded, and where a product most reliably invents an audience — "1,284 people online" on a platform with no presence projection at all. Both are decisions to make before the screen exists rather than after somebody notices.

Deferring was the alternative and was rejected for the reason ADR-0025 rejected it for calls: the expensive, risk-bearing part is the authority model, and building it against the network-free adapter is how the authority model gets proved before a vendor exists. No RTC provider is approved, and none is approved by this ADR either.

## Decision

### LIVE is a bounded domain, and it owns three things

LIVE owns who is waiting to meet somebody at random, which two people were put together, and what they typed to each other while they were together. That is the whole of it.

It owns no principal, no account standing, no relationship, no block, no enforcement decision, no call session, and no conversation. AUTH owns the principal. USERS owns admission and standing. DISCOVERY owns whether two people are introduced. TRUST & SAFETY owns blocks and enforcement. REALTIME owns the call session. MESSAGING owns the durable conversation. LIVE asks each of them at the moment of the action and stores its own copy of no answer — there is deliberately no `eligible` column anywhere in `live_`, for the same reason there is none in `realtime_`.

LIVE publishes exactly two facts and no more: that a pair is in a live encounter, and that a pair met live recently. Both are booleans. Neither says who anybody is, how long they talked, what was said, or how many encounters anybody has had.

### The matcher runs one at a time, under a global lock, and it is the only thing in the product that does

Matching reads everybody who is waiting and then chooses two of them. Two matchers reading the same waiting person would both choose them, and no pair lock closes that because the pair does not exist until the choice is made.

So the matcher takes a transaction-scoped advisory lock on one constant key, before any pair lock. The cost is that concurrent searches queue behind each other for the length of one short transaction; the guarantee bought is that nobody is ever handed to two people. Every other transaction in this domain takes a pair lock and nothing else, and the matcher takes the global lock and then a pair lock — never the reverse — so the lock graph is acyclic and no transaction here can deadlock with a block landing on the same two people.

Under that lock, candidates are read *without* a row lock and re-checked under the pair lock before anything is written. That ordering is deliberate and load-bearing: every transaction in this domain takes the pair lock before any row lock, which is what keeps it from deadlocking with TRUST & SAFETY.

Everything else is a partial unique index rather than a check somebody wrote. One live participation per person; one live encounter per pair; one RTC session per encounter; one message per client identifier per sender per encounter. Two people pressing Next at the same instant end one encounter between them and the loser observes it, because every transition is a guarded update that restates the state it expects.

### An RTC session gains a purpose, and eligibility is composed against the purpose it was created under

`realtime_sessions.purpose` is `introduced` or `live_discovery`. An `introduced` session carries an introduction and no encounter; a `live_discovery` session carries an encounter and no introduction; the database enforces both as paired equivalences, so a session with neither reference or with both cannot be recorded.

`RtcCallEligibilityPort.mayCall` takes the purpose as a required argument. Safety, standing, and enforcement are asked identically for both, because those three do not care how two people came to be talking. The fourth predicate is the one that differs: an `introduced` session is judged against DISCOVERY's current mutual introduction, and a `live_discovery` session against LIVE's current encounter. It is asked in exactly the same places — on creation, on every join-credential issuance, on every reconnect — so an encounter ending refuses the reconnect a client is already attempting, exactly as a closed introduction refuses a call's.

The purpose is a stored column rather than something inferred from which reference is present, because inference would let a session silently change which predicate judges it. That is precisely how a few minutes of random discovery would become a standing permission.

REALTIME is extended rather than duplicated. A second lifecycle for random sessions would be a second, weaker answer to questions the first already answers — provider orchestration, join credentials and their bounds, revocation obligations, reconciliation, the operator read, and safety termination — and the weaker answer would eventually be the one somebody called. ADR-0025 left this seam open in as many words.

A live session is created in `accepted`, with both participants already marked as having accepted. Neither person was invited: both entered the matching pool, which is a stronger and earlier consent than answering a ring. Modelling it as an invitation would produce a session one of them had to accept before the other could be heard, an expiry deadline that means nothing, and a `rejected` path neither of them can reach.

### Connect is DISCOVERY's introduction, and nothing else

Pressing Connect signals an introduction through the same contract Discover uses. It is the single most important decision in this feature.

A separate "live connection" would be a second relationship model that eventually disagreed with the first, and it would mean somebody met live and somebody met in Discover were two different kinds of connection with two different inboxes. One tap never produces a mutual connection: the introduction becomes mutual only when the other person has independently signalled too, decided by the same compare-and-set inside DISCOVERY's own transaction — so two people pressing Connect at the same instant produce exactly one introduction and exactly one conversation.

DISCOVERY gains a second reason two people may be introduced: they met live, recently. Without it, Connect would silently fail after a good conversation whenever the peer was not a current candidate of the caller's — a different language, a closed availability window, a rotation that was never going to surface them — which is most of them. The arm is bounded by the same window that stops the matcher handing the same two people to each other again, because it is a reason to introduce *now* rather than a permission that outlives the meeting. It is deliberately not restricted to a *live* encounter: Connect and the encounter ending race constantly, and somebody whose Connect lost that race by a few milliseconds has still met the person.

### Live chat is LIVE's, and it never becomes an Inbox conversation

`live_messages` belongs to the encounter. It is read through LIVE's own contract, no code path copies it into `messaging_messages`, and when the encounter ends it stops being reachable by either person. A pair that ends an encounter without connecting leaves nothing in either Inbox, which is the product rule the whole feature rests on.

It is durable anyway, and that is not a contradiction. A report about what somebody said in a live encounter is unanswerable if the platform threw the words away, and a message that vanished when the encounter ended would be one a person could screenshot and a platform could not review. Retention is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, as it is for encounters themselves; nothing expires and no correctness rule depends on a row being physically gone.

### Presence is reading, and nothing else — and no count of anybody is ever published

There is no presence projection, no gateway, and no heartbeat endpoint. A client that is reading the live state is present; one that has stopped reading is not. That is how "they closed the tab" becomes visible at all, because a closed tab, a phone that lost signal, and a killed process all send exactly nothing — absence is measured rather than announced.

The contract therefore publishes no count of who is waiting, who is online, or how many people the platform has, and no shape in it can carry one. A number there would be invented, and an invented number about how busy a product is, is the dishonesty this feature most invites.

### An encounter that ends holds both people on it, rather than replacing anybody with a spinner

When either side leaves, both participations move to `ended` and keep naming the encounter. That is what lets each surface say what happened — "you moved on", "they moved on", "you lost each other", "VELORA ended this" — instead of silently swapping the person somebody was talking to for a search. The one exception is the person who pressed Next, who has already said what they want next and is put straight back into the pool.

A safety decision reaches both rows together. A block ends the encounter (LIVE's row) and the live session (REALTIME's row) in the same transaction under the same pair lock, through two published enforcement contracts, because a block placed while two strangers are on camera has to stop *that* rather than refuse the next thing they try. Neither domain writes the other's table. The disclosable end reason is `ended_by_platform` and never anything finer: `safety_block` and `safety_enforcement` are separate decisions with separate owners and neither is a peer's business.

### Nothing is recorded, and no configuration turns that on

No live encounter is recorded, stored, transcoded, or transcribed. No code path does any of those things, no configuration value enables one, and no surface may claim or imply that a live session is recorded or could be. This restates ADR-0025's posture rather than relaxing it, because random video is exactly the feature where somebody would assume otherwise.

### Fail-closed configuration, and a stand-in that cannot exist in a deployed environment

`LIVE_DISCOVERY_MODE` defaults to `unavailable`, which admits nobody to the matching pool, and is rejected at startup in staging and production. Random discovery ends in a call between two strangers, so it inherits every blocker calling has — no approved RTC provider, no call retention duration, undecided regional availability and recording posture, unassigned operations ownership — and adds one of its own: nobody owns moderation coverage for live encounters.

`LIVE_DISCOVERY_SIMULATION` defaults to `unavailable` and is rejected in the same environments. Where it is `local-test`, the matcher may offer a *seeded local account* — a real row, really onboarded, really eligible — as a stand-in, and every scenario drives that account through the same published service methods a person's client calls. There is no back door into the tables and no fabricated person, presence, or activity; a stand-in that has been blocked is not matched, and one whose account is restricted is not matched. It exists because every interesting state in this feature needs two people, and a developer alone in a local world would otherwise be able to walk two of them.

### Live is the primary consumer destination on both surfaces

Consumer Web and Consumer Mobile both put Live first in the navigation, and both send a newly admitted person there. Discover, Introductions, Messages, Notices, You, memberships, gifts, settings, and safety are unchanged and remain exactly as reachable as they were.

Neither surface opens a camera because a page loaded. Both show a door that says what pressing it will do, offer voice and video as separate controls — agreeing to be heard is not agreeing to be seen — and release every device when the screen is left, the tab is hidden, or the application leaves the foreground. Muting is remembered across a reacquisition, so nothing silently unmutes somebody who muted themselves.

Neither surface draws an empty video pane for the remote participant. With no approved provider the pane says so in words, beside the person's real name and picture; when a provider is configured it says that instead, from the server's own answer rather than a build flag.

### Android asks for a camera and does not ask for a microphone

`RECORD_AUDIO` stays blocked in the permission model. The camera opens so the person somebody meets can see them; nothing records, and no approved provider exists to carry audio anywhere, so asking for a microphone would be asking for a permission this build cannot use. The mute control still exists and is still authoritative over intent, and the surface says plainly that nothing is carrying audio yet.

## Consequences

- The whole social loop — stranger, live interaction, mutual connection, durable relationship, ongoing conversation — is provable end to end against a network-free adapter, and is proved by `apps/api/test/integration/live-discovery.test.ts`.
- One relationship model and one Inbox serve both ways of meeting somebody. A person met live and a person met in Discover are the same kind of connection, in the same conversation list.
- Matching serializes globally. That is a throughput property with a known ceiling, and the first thing to revisit if the pool ever gets large; nothing about the design forecloses sharding the lock by cohort later.
- Every live encounter costs a re-composition of eligibility across four domains, twice — once for the encounter and once for the session. That is the intended price and the same one ADR-0025 accepted.
- Random discovery stays unavailable in every deployed environment until the provider, legal, moderation, and operations gates pass, and the surfaces say so rather than failing obscurely.
- Two surfaces now ship a primary destination that no deployed environment can serve. That is a phase-map fact rather than an implicit one.

## Rejected alternatives

- **Let DISCOVERY own the matching pool.** DISCOVERY owns candidate eligibility and pair state for a feed that is read, ranked, and paged. A pool is a queue with presence and a global allocation decision, and folding it in would put a synchronous lifecycle inside a domain whose every other write is asynchronous.
- **Let REALTIME own the pool.** REALTIME owns call sessions and, by ADR-0025, owns none of the facts a call depends on. Deciding who meets whom is exactly such a fact.
- **Give LIVE its own media session instead of extending REALTIME.** It would duplicate provider orchestration, credential issuance and its bounds, revocation obligations, reconciliation, and the operator read — a parallel system with a weaker safety model.
- **Invent a "live connection" separate from an introduction.** Two relationship models that eventually disagree, and two inboxes for the same person.
- **Put live chat in MESSAGING with a short life.** A conversation that disappears is a retention decision nobody has approved, and it would make every Inbox read filter out threads that are technically conversations.
- **Delete live messages when the encounter ends.** It makes a report about what somebody said unanswerable, which is the one thing a random-stranger product cannot afford.
- **Show an online count.** No presence projection exists. Any number would be invented, and it is the exact dishonesty this feature invites.
- **Auto-resume searching for the person who was left.** It replaces the person somebody was talking to with a spinner and leaves them to work out what happened.
- **Trust a client to report that its camera is open.** A client-asserted device state is a client asserting a fact about itself that the server would then store and act on.
- **Ask for `RECORD_AUDIO` now.** A permission the product cannot use, requested under an explanation that would not be true.
- **Fabricate a peer for local development.** A fixture pretending to be a person proves the fixture. A seeded account driven through the published service methods proves the product.

## Unresolved decisions

Live-encounter and live-message retention durations are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`. Moderation coverage for live encounters is `DECISION REQUIRED` and is a new blocker this feature introduces. Everything ADR-0025 left open remains open and continues to block this: RTC provider and hosting mode, recording posture, regional availability, in-call safety intervention authority, native mobile RTC feasibility, and operations ownership. None of them is unblocked by code.

## Cross-references

[LIVE](../domains/live.md), [REALTIME](../domains/realtime.md), [DISCOVERY](../domains/discovery.md), [MESSAGING](../domains/messaging.md), [ADR-0025](ADR-0025-rtc-live-communications-architecture.md), [ADR-0027](ADR-0027-consumer-web-product-interface.md), [ADR-0030](ADR-0030-consumer-mobile-product-interface.md), [ADR-0019](ADR-0019-database-connection-admission.md), [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md), [domain boundaries](../architecture/03-domain-boundaries.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
