# Messaging and blocks flow

## Purpose

Define conversation authorization and block precedence. MESSAGING owns messages/conversations; Trust & Safety owns blocks/enforcement.

## Preconditions

Conversation participant membership is valid from approved connection policy, account/session is active, and current safety eligibility permits communication.

## Main flow

1. Participant submits message with stable client message ID/idempotency key.
2. MESSAGING rechecks membership and Trust & Safety eligibility.
3. Validate size/type/attachment reference; persist message and outbox event atomically.
4. Delivery worker updates delivery attempt; NOTIFICATIONS may notify recipient under preferences.
5. Recipient reads/acknowledges only authorized messages; state updates safely.

## Block, report, and failure flows

Block persists immediately in Trust & Safety, then eligibility propagation prevents new discovery, message, counterpart-generated notification, and RTC actions. In-flight send rechecks before durable acceptance; outcome is either accepted-before-block under retention rules or denied, never assumed sent. User can report allowed evidence without re-exposing blocked counterpart. Access to already exchanged history follows explicit safety/retention policy; it may remain read-only or be hidden, but neither client can infer new authorization from cached history. Duplicate sends return original message; notification/provider outage leaves persisted message status truthful. Enforcement can restrict/close conversation without revealing internal reason.

## Security/data/concurrency

Object authorization applies every read/write. Message/attachment contents never go in generic logs/events. Attachment remains inaccessible until validated/scanned. Retention, encryption, and legal safety access follow policy. Unique client ID per conversation/sender plus transactional writes prevent duplicate messages; read receipt is monotonic.

## Phase/cross-references

V1 text conversation/block/report. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: post-block history visibility, retention, evidence access, and encryption posture. See [MESSAGING](../domains/messaging.md), [Trust & Safety](../domains/trust-safety.md), [media security](../security/04-media-upload-delivery.md), [report flow](report-to-enforcement.md).
