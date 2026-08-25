# Messaging and blocks flow

## Purpose

Define conversation authorization and block precedence. MESSAGING owns messages/conversations; Trust & Safety owns blocks/enforcement.

## Preconditions

Conversation participant membership is valid from approved connection policy, account/session is active, and current safety eligibility permits communication.

## Main flow

1. Participant submits message with stable client message ID/idempotency key.
2. MESSAGING rechecks membership and Trust & Safety eligibility.
3. Validate the bounded text body; persist message and outbox event atomically.
4. Delivery worker updates delivery attempt; NOTIFICATIONS may notify recipient under preferences.
5. Recipient reads/acknowledges only authorized messages; state updates safely.

## Block, report, and failure flows

Block persists immediately in Trust & Safety, then eligibility propagation prevents new discovery, message, counterpart-generated notification, and RTC actions. In-flight send rechecks before durable acceptance; outcome is either accepted-before-block under retention rules or denied, never assumed sent. User can report allowed evidence without re-exposing blocked counterpart. Access to already exchanged history follows explicit safety/retention policy; it may remain read-only or be hidden, but neither client can infer new authorization from cached history. Duplicate sends return original message; notification/provider outage leaves persisted message status truthful. Enforcement can restrict/close conversation without revealing internal reason.

## Security/data/concurrency

Object authorization applies every read/write. Message contents never go in generic logs/events. V1 publishes no attachment input; a future attachment remains inaccessible until MEDIA validates and scans it and the owning policy authorizes it. Retention, encryption, and legal safety access follow policy. Unique client ID per conversation/sender plus transactional writes prevent duplicate messages; the caller's read position is monotonic and the counterpart's is never published.

## Implemented V1 behaviour

The conversation is opened from a mutual introduction and from nothing else, through DISCOVERY's published connection contract. Membership, conversation state, current safety eligibility, and the connection itself are re-read inside the transaction that persists a message, after the conversation's row lock is held — so an in-flight send meeting a concurrent block is refused before durable acceptance rather than accepted and then hidden, and a block never straddles a write.

Ordering is a server fact: every message takes its position from a counter on its own conversation under that lock, so no client clock and no arrival order participates, and two people sending in the same instant get distinct adjacent positions. A send is idempotent on the caller's client message identifier, scoped to the conversation and the sender and decided by a unique index; the same identifier with a different body is refused rather than answered with somebody's earlier message.

TRUST & SAFETY owns the durable block store. Every block and message transition takes the same transaction-scoped pair lock before any conversation row lock, then MESSAGING re-asks the published safety and connection contracts inside the write transaction. Post-block history takes the fail-closed reading while the policy decision is open: the conversation and its history are withheld from a pair that may not communicate, and nothing is deleted to achieve that.

Conversation lists carry a bounded, whitespace-normalized projection of the exact newest persisted message and the mutual-introduction relationship that authorized the thread. The preview is relative to the caller and makes no delivery, counterpart-read, typing, or presence claim. The relationship can start REALTIME's call lifecycle from either the introduction surface or the thread; it authorizes no media provider and no device capture.

## Phase/cross-references

V1 text conversation/block/report. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: post-block history visibility, retention duration, evidence access, and encryption posture; each is recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) with what it blocks. Messaging is **not** end-to-end encrypted and no surface may claim it is. See [MESSAGING](../domains/messaging.md), [Trust & Safety](../domains/trust-safety.md), [media security](../security/04-media-upload-delivery.md), [report flow](report-to-enforcement.md).
