# ADR-0025: RTC live communications core and provider-neutral call authority

- Decision date: 2026-08-20
- ADR status: Accepted
- Owners: Founder (decision owner), REALTIME, AUTH, USERS, DISCOVERY, MESSAGING, TRUST & SAFETY, NOTIFICATIONS, ADMIN, security, privacy, compliance, operations

## Context

[ADR-0008](ADR-0008-realtime-rtc.md) locked the realtime transport direction and the existence of a provider-neutral WebRTC boundary, and deferred everything a call actually needs: the session model, who may call whom, how a join credential is scoped, what a provider callback is allowed to change, and what happens when a network drops. `docs/domains/realtime.md` and `docs/flows/rtc-lifecycle.md` described that future in outline. Neither had an owning schema, a contract, or a line of runtime code.

A call is not a message with a camera attached. Three properties separate it from everything already built here, and each is a way to get it wrong:

- **The authorization decision and the media path are different systems.** VELORA decides whether two people may talk; a media provider decides whether a packet is forwarded. A provider that has been told to create a room will forward media to anyone holding a credential for it, whatever VELORA later decides. Every safety guarantee therefore has to be expressed as a credential that is narrow enough and short enough to be worth revoking, plus a revocation the provider actually performs.
- **Most of the state is not durable and must not become durable.** SDP, ICE candidates, and the packets themselves carry network addresses and content that this platform has no business keeping. The lifecycle that *is* durable — who invited whom, when it was accepted, when it ended — is small, and the temptation to store the rest for debugging is exactly the failure this ADR forecloses.
- **The clients are the least trustworthy participants and the ones with the most information.** Only the two endpoints know whether audio is flowing. A design that takes their word for it lets one of them assert that a call is active after the platform ended it.

Deferring the domain again was the alternative, and it was rejected for the same reason the Identity core was built before any verifier was approved: the expensive, risk-bearing part is the authority model, not the vendor integration, and building it against a network-free adapter is how the authority model gets proved before a vendor exists. Research recorded in [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), dated 2026-08-20, approves nobody, so this ADR selects no provider.

## Decision

### REALTIME owns call sessions; it does not own conversations, relationships, or safety

REALTIME is a bounded domain owning RTC session records, participants, invitation and lifecycle state, provider session references, provider-event receipts, revocation and cleanup obligations, and reconciliation findings. Nothing else writes those tables and REALTIME writes nothing outside them.

It owns none of the facts a call depends on. AUTH owns the principal and session. USERS owns account standing. DISCOVERY owns whether two people are mutually introduced. TRUST & SAFETY owns blocks and enforcement. NOTIFICATIONS owns durable delivery. MESSAGING owns conversation history, and a call is not a message: no call writes a message row, and ending a call closes no conversation.

MEDIA is untouched by this ADR. MEDIA owns stored bytes; RTC owns ephemeral transport that produces no bytes to store. The two never meet in V1 because nothing is recorded.

### A call invitation is not a call, and neither is a provider room

Four separate facts, and no one of them implies the next:

1. **Invited.** VELORA recorded that somebody asked to talk to somebody else. It expires on its own.
2. **Accepted.** The recipient answered. This is a platform fact taken from an authenticated request, never from a provider event.
3. **Authorized to join.** A specific participant was issued a specific, short-lived, single-participant credential, after every eligibility predicate was re-evaluated at that instant.
4. **Connected.** A provider observed media. This is an operational observation. It updates what the platform knows about the call's technical state and it never grants, extends, or restores permission.

The reverse direction is closed the same way: a call ending on the platform does not mean the provider has torn anything down, so ending records a revocation obligation that a worker discharges and reconciliation checks.

### Eligibility is composed at the moment of the action, from owners, every time

RTC introduces no new social relationship. A call is permitted only where the existing server-side communication relationship already permits contact: an authenticated Consumer principal, an account in good standing, a current mutual introduction from DISCOVERY, no pairwise block, and no live TRUST & SAFETY enforcement denying consumer interaction.

That composition is re-evaluated on invitation, on acceptance, on every join-credential issuance, and on every reconnect — inside the transaction that writes, under the pair lock, on the caller's executor, exactly as MESSAGING and NOTIFICATIONS already do. A cached answer, an answer taken from the page a client is holding, and an answer taken before an earlier step are all treated as absent. Absent means refused.

No request field, header, query parameter, or client-held token contributes a participant, a permission, a provider, a room, a scope, a duration, or a state.

### Provider credentials are issued per participant, per session, per issuance

A join credential names one session and one participant, carries the least capability that lets that participant take part, expires in minutes rather than hours, and is never stored in a form that can be replayed. It is issued only after the full eligibility composition passes and only to the authenticated principal it belongs to. VELORA never returns a room-wide secret, never returns another participant's credential, and never accepts a credential as evidence of anything on the way back in.

Every credential carries the session's authorization generation. Ending, rejecting, cancelling, revoking, or terminating a session advances that generation, which is what makes an old credential dead at the platform boundary even during the window before a provider has finished acting on a revocation. That window is real, is bounded by the credential's own lifetime, and is stated rather than hidden.

### Provider I/O is outside every transaction, and providers are behind one port

`RtcProvider` is a capability-declaring port. Creating a provider session, issuing a participant grant, revoking a participant, ending a session, reading current provider state, and normalizing a provider event are its whole surface. Provider SDK types stay behind it.

Session creation is two transactions with a network call between them: reserve the durable session and its provider-operation identity, commit, call the provider, then bind the reference. A crash at any boundary leaves a recoverable record, recovered by idempotent lookup and by reconciliation. No provider call ever runs inside a database transaction, for the reason [ADR-0019](ADR-0019-database-connection-admission.md) makes concrete: a pooled connection held across somebody else's network is a connection the admission bound cannot account for.

### Provider events are verified receipts, not instructions

A provider callback enters a durable inbox only after its exact raw bytes authenticate, before anything parses them. The inbox stores a digest and a normalized allow-list, never a body. Event identity is unique per provider, account, and environment. Duplicates, replays, reordering, and permanent absence are all expected, and none of them is an error condition that changes a decision.

A verified event may update the platform's technical observation of a call. It may never create a participant, grant permission, extend a credential, reverse a platform end, override a block or an enforcement, or resurrect a superseded session generation.

### Signalling transport is ephemeral; the call lifecycle is PostgreSQL

Call control is HTTP mutation against published routes. Realtime delivery of call events to connected clients is a fanout over ephemeral infrastructure, and clients recover by reading authoritative state, exactly as [ADR-0008](ADR-0008-realtime-rtc.md) requires of every realtime event. Redis fanout is transport. It is never durable truth, never a lock, and never the reason a call is in a state.

Offer/answer and ICE negotiation belong to the provider's own signalling path in every candidate architecture assessed, so VELORA relays no SDP and no ICE candidates in V1. If a future provider requires the platform to relay them, that is a change to this ADR with its own privacy review, because relaying them makes the platform a place they could be logged.

### Fail-closed configuration, and a test adapter that cannot exist in a deployed environment

`REALTIME_RTC_PROVIDER` defaults to `unavailable`, which refuses every provider operation. `local-test` is deterministic, in-process, network-free, and rejected at startup in staging and production. `REALTIME_CALL_ELIGIBILITY` defaults to `unavailable` and refuses every pair, on the same rule and for the same reason `MESSAGING_SAFETY_ELIGIBILITY` does: the open decisions behind live calling are not code, and an environment that has not resolved them must refuse rather than run.

No provider is selected by this ADR. Selecting one requires a provider-specific ADR and the written confirmation the eligibility record demands.

### No recording, no transcription, no media retention

Nothing in this architecture records, stores, transcodes, or transcribes call media, and no configuration value turns any of that on. Recording remains `DECISION REQUIRED / LEGAL REVIEW REQUIRED` under [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md); enabling it would require consent design, in-call indication, storage, retention, moderation, evidence, deletion, and jurisdiction decisions that do not exist. A safety report about a call therefore references the session, its participants, and its timestamps, and carries no media, no SDP, and no ICE data — because there is none.

### Phase and surface boundary

V1 contains the provider-neutral core, the fail-closed contracts, the consumer call surfaces built against them, safety integration, abuse limits, read-only operations, and reconciliation. It contains one-to-one consumer voice and video and nothing else.

Group calls, rooms, livestreaming, broadcast, creator paid sessions, call marketplaces, presence projections, and recording are out of scope and unbuilt. The seams they would use — a participant table that is not hard-coded to two rows, a session purpose, a provider port that describes sessions rather than pairs — exist because designing them away would be more work than leaving them, not because any of those capabilities is approved.

## Consequences

- The authority model is provable before a vendor exists, against an adapter that reaches no network.
- Provider replacement is an adapter change; no session identity, route, or contract carries a vendor concept.
- Live calling stays unavailable until provider, legal, mobile, and operations gates pass, and the surfaces say so rather than failing obscurely.
- A revocation window bounded by credential lifetime is accepted and documented rather than designed away, because no arrangement of this code removes it.
- Every call-control route costs a re-composition of eligibility across three domains. That is the intended price.
- Consumer surfaces ship a capability nobody can use in a deployed environment, which is a phase-map change recorded in [product phases](../product/01-product-phases.md) rather than an implicit one.

## Rejected alternatives

- **Let MESSAGING own calls.** A call has no history, no ordering, no body, and a different safety failure mode. Ownership would drag conversation semantics into a lifecycle that has none.
- **Trust the client's connection state.** The endpoints are the only observers of media and the least trustworthy participants; a client-asserted `active` is a client-authoritative permission.
- **Treat a provider `participant_joined` as permission.** It is an observation of a packet, arriving late, possibly twice, possibly never.
- **Issue one room credential to both participants.** A shared secret cannot be revoked for one person, and hands each participant the other's access.
- **Long-lived join tokens to simplify reconnect.** Reconnect is exactly when eligibility must be re-checked; a token that survives it is a token that outlives a block.
- **Persist SDP and ICE candidates for debugging.** It creates a durable record of participants' network addresses to answer questions that aggregate metrics answer.
- **Keep call state in Redis for speed.** Redis fanout losing a message must cost a UI refresh, never a call's existence.
- **Select a provider now on capability and price.** Two candidates are foreclosed on their own published terms and the rest have unresolved written-approval gaps; choosing one would be choosing to misrepresent what VELORA is.
- **Extract a realtime microservice.** [ADR-0008](ADR-0008-realtime-rtc.md) defers extraction until connection scale requires it, and nothing measured requires it.

## Unresolved decisions

RTC provider and hosting mode are `DEFER UNTIL PROVIDER INTEGRATION`. Recording and transcription remain `DECISION REQUIRED BEFORE FEATURE / LEGAL REVIEW REQUIRED`. Regional availability, call retention durations, emergency-calling posture, in-call safety intervention authority, native mobile RTC feasibility under the current Expo architecture, and operations ownership are `DECISION REQUIRED`. None of them is unblocked by code.

## Cross-references

[REALTIME](../domains/realtime.md), [RTC lifecycle](../flows/rtc-lifecycle.md), [RTC threat model](../security/12-rtc-threat-model.md), [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), [ADR-0008](ADR-0008-realtime-rtc.md), [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md), [ADR-0019](ADR-0019-database-connection-admission.md), [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md), [product phases](../product/01-product-phases.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
