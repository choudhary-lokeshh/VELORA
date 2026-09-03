# MESSAGING domain

## Purpose and scope

MESSAGING owns conversations, participant membership, messages, message delivery/read state, and permitted message attachments metadata. It does not own discovery connection truth, blocks/enforcement, presence/call rooms, moderation case decisions, or raw media storage.

## Main flow and transitions

Create direct conversation only from valid mutual introduction/other published future policy. `eligible -> active -> restricted/closed`; message `accepted -> persisted -> delivery_pending -> delivered/read` where platform supports it. Before every send/read/attachment request, verify participant membership plus current Trust & Safety eligibility. A block denies new interaction and closes/restricts future access under documented policy; handling of already exchanged message history is a separate retention/safety decision and must not expose a blocked counterpart through notifications or new delivery.

## Alternate/failure and concurrency

Client retry uses message client ID/idempotency key; unique participant/conversation rules prevent duplicate thread/message. Persist before delivery job; notification failure does not lose message. Sender sees truthful pending/failed status but server never fabricate delivery/read state. Concurrent block/send resolves by authoritative safety check at transition boundary.

## Security/data/phase

Participants only see objects in authorized conversation. Encrypt transport; encryption-at-rest/end-to-end posture is `DECISION REQUIRED / LEGAL REVIEW REQUIRED` and must preserve lawful safety/retention policy. Scan/validate attachments before availability. Retain only policy-defined message data; reports reference evidence via access-controlled snapshots. V1 text chat. Phase 2 RTC integration through REALTIME. Events: conversation/message lifecycle, delivery attempts, no body in general analytics.

## Implemented V1 messaging

`0009_messaging` adds the three MESSAGING-owned tables. None carries a foreign key to a consumer account or to an introduction: cross-domain references are stable identifiers rather than shared schema, on the rule [data ownership](../architecture/05-data-ownership.md) records. Within the domain, participants and messages do carry foreign keys to their conversation, because that is one owner's own tree.

### End-to-end encryption is not implemented

Transport is encrypted. Storage is not end-to-end encrypted, and **no surface may claim or imply that it is** — not the API contract, not a client, not marketing copy, not a security page.

This is a deliberate V1 posture rather than an unfinished one. An adults-only platform has to be able to act on what was actually said: moderation, reporting, and lawful safety review all require server-side product authority over message content, and a scheme that removed it would remove the platform's ability to answer for its own product. The alternative on offer was a hand-rolled encryption design, which would have traded a real safety capability for a guarantee nobody outside this repository could verify.

A unit assertion pins the posture so it cannot drift into a claim by accident.

### Retention

**No retention duration is approved.** It is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, and nothing in this codebase invents one — not thirty days, not ninety, not a year. A number chosen to look compliant would be worse than no number: it would be enforced, it would delete evidence a report might need, and it still would not be the policy.

The design is therefore retention-neutral:

- Nothing expires. There is no sweep, no TTL, no scheduled delete, and no `expires_at` or `deleted_at` column on a message.
- **No correctness rule depends on a row being physically gone.** Ordering, idempotency, pagination, membership, and authorization are all decided from state that is present. Whatever duration is eventually approved can therefore be applied as a deletion pass without changing how messaging behaves.
- Development and test are unaffected. The absence of a policy blocks production, not local work.

### What blocks production

Two things, and they are enforced rather than merely noted:

1. **Retention duration is undecided.** Above.
2. **Post-block history visibility is undecided.** TRUST & SAFETY now owns the durable block store and every MESSAGING transition asks its published pair-eligibility contract. V1 takes the fail-closed reading: while safety denies a pair, the conversation is absent from the list and its history is refused. Nothing is deleted to achieve that, so the other reading remains available the moment it is decided.

The pre-existing blocks on adult assurance and media storage still apply; a consumer cannot become discoverable in a deployed environment at all, so this is consistent rather than additional.

### Where the authority to converse comes from

A conversation is created from a mutual introduction and from nothing else. MESSAGING does not decide whether two people are introduced and does not read `discovery_introductions`: DISCOVERY publishes a connection contract, and MESSAGING calls it. That is what [domain boundaries](../architecture/03-domain-boundaries.md) requires, and it means there is exactly one definition of "these two people opted in".

The contract publishes the fact and nothing else — not who signalled first, not when a signal expired, not whether the pair ever declined, not what closed an earlier introduction. Publishing any of that would let MESSAGING start making decisions that belong to DISCOVERY.

One conversation per pair, for the life of the pair. A pair introduced again resumes the conversation it already had rather than acquiring a second thread beside it; hiding or discarding the earlier history instead would be a retention decision, and no retention decision is approved. Creation is idempotent by construction rather than by a client key: the unique index over the ordered pair decides, so two simultaneous opens produce one conversation and the loser reads the winner's.

### Authorization is taken at the moment of the action

Membership, conversation state, current safety eligibility, and the connection itself are all re-read when somebody sends — **inside the transaction that writes the message**, after the conversation's row lock is held. A recheck that commits separately from the write it authorizes is not a recheck, so the safety port and the connection contract both accept the caller's executor and answer within it.

The consequence is the one the flow document asks for: a block landing mid-request either precedes the message or follows it and never straddles it, and an in-flight send is refused before durable acceptance rather than accepted and then hidden.

Reads are held to the same standard. While safety denies a pair, neither person sees the conversation in their list and neither can read its history.

### Message ordering is a server fact

Every message carries a `sequence` allocated from a counter on its own conversation, under that conversation's row lock. No client clock participates, no arrival order at a load balancer participates, and no retry can influence it. Two people sending at the same instant receive distinct adjacent positions; sixteen simultaneous senders receive sixteen distinct positions, which is asserted against real PostgreSQL rather than simulated.

The order is unique and strictly increasing within a conversation. It is deliberately **not** promised to be contiguous, and clients must not assume it: a position is consumed when a message is written and nothing renumbers.

Timestamps alone would not have been enough. Two messages can share a millisecond, and a tie in an ordering key is a conversation whose transcript reads differently to its two participants.

### A send is idempotent

The caller supplies a client message identifier, scoped by the server to the conversation and the sender. The unique index over that triple is what makes a repeat idempotent — not a prior read, which two concurrent retries would both pass.

The conversation lock is taken *before* the idempotency lookup rather than after. That ordering is what makes a duplicate wait long enough to see the original instead of racing it, and it is why fifty simultaneous duplicates produce one message and consume exactly one ordering position rather than burning fifty. All three of two, ten, and fifty are asserted.

The same key with a different body is not a retry. It is refused with `IDEMPOTENCY_KEY_MISMATCH`, because answering it with somebody's earlier message would be worse than refusing.

### Pagination

History pages backwards, keyset on the sequence. The sequence is immutable and unique within a conversation, so a page boundary is exact: a reader scrolling back sees every message once regardless of what arrives while they read. The cursor carries the conversation it was minted for, so a cursor used against a different conversation is a validation failure rather than a silently different query.

The conversation list is ordered by last activity, which does move. The consistency model is the same shape as [discovery's](discovery.md): a conversation that receives a message mid-read jumps to the front, which a forward-only reader has already passed, so it can be missed on that pass and never duplicated into it. Clients deduplicate by identifier.

Each row publishes the mutual introduction that authorized the conversation as a typed relationship and a bounded projection of the newest durable message. The projection normalizes whitespace, carries at most 160 UTF-16 code units, identifies the sender only relative to the caller, and is absent before the first message. It is derived by joining the conversation's authoritative newest sequence to that exact persisted message; no draft, optimistic send, delivery assertion, counterpart read position, typing state, or presence enters the list. The relationship identifier lets an authorized client place a call from the thread through REALTIME's existing mutual-introduction contract without inventing a second identity or privilege path.

### Read state

`lastReadSequence` is per participant and monotonic. An acknowledgement below the recorded position is accepted and changes nothing, so a retry or an out-of-order client can never un-read a conversation. An acknowledgement beyond what exists is clamped to the newest message rather than believed.

The other person's read position is never published. Whether somebody has read a message is their business, and publishing it is a presence signal the approved policy does not include.

### Privacy

Message bodies never appear in a log, in an error, or in an event. A regression asserts that a body sent through the API is absent from every log record the request produced, and that no log field is named for one.

### Not in V1

No attachment, no voice note, no editing, no deletion by a participant, no disappearing message, no typing indicator, no delivery receipt beyond the caller's own read state, no real-time message transport. None of them is approved for V1, and a contract is the easiest place for an unapproved capability to appear by accident, so none has a schema. Consumer composers state the text-only and no-attachment boundary explicitly rather than presenting a dead attachment control.

## The sending bound

One account may send `maximumMessagesPerWindow` messages an hour, counted across every conversation it is in. It is a cap on automation rather than on conversation: somebody typing to one person, or to several, comes nowhere near it, and a bound low enough for a person to feel is a bound that would be removed the first time somebody complained.

Counting across conversations rather than within one is the point. A per-conversation bound is evaded by opening more of them, and somebody being written to at machine speed does not care which conversation it arrived in.

It is counted inside the transaction that writes, and after the idempotency read. Both orderings matter. Counting on a separate connection is a bound a burst walks straight through; counting before the idempotency read would refuse a retry of a send that already committed, turning a lost response into an error the client could never resolve.

Reaching it refuses further sends for the window and removes or alters nothing already sent. It is a bound on what one account may start, so the person being written to is unaffected — which is what stops one abuser silencing the person they were writing to.

## Cross-references## Cross-references

[messaging and blocks](../flows/messaging-and-blocks.md), [media security](../security/04-media-upload-delivery.md), [Trust & Safety](trust-safety.md), [NOTIFICATIONS](notifications.md), [DISCOVERY](discovery.md).

### The published fact

`0012_notifications_outbox` adds `messaging_outbox`, and `sendMessage` appends `messaging.message.sent.v1` to it inside the same transaction that writes the message. The outbox belongs to this domain rather than to a shared events schema for one reason: the fact and the message have to commit together, and only this domain's transaction can do that. A queue enqueue placed after the commit would be lost by a process killed in between, and somebody would never be told about a message that exists.

The payload names the conversation, the message, the sender, the recipient, and the sequence. It carries no body and no display name: what may be shown to a recipient is NOTIFICATIONS' decision, and a field that never leaves this domain cannot end up on a lock screen. MESSAGING does not read the outbox after writing it and does not know what happens to the fact; see [NOTIFICATIONS](notifications.md).
