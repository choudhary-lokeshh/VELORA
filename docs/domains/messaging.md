# MESSAGING domain

## Purpose and scope

MESSAGING owns conversations, participant membership, messages, message delivery/read state, and permitted message attachments metadata. It does not own discovery connection truth, blocks/enforcement, presence/call rooms, moderation case decisions, or raw media storage.

## Main flow and transitions

Create direct conversation only from valid mutual introduction/other published future policy. `eligible -> active -> restricted/closed`; message `accepted -> persisted -> delivery_pending -> delivered/read` where platform supports it. Before every send/read/attachment request, verify participant membership plus current Trust & Safety eligibility. A block denies new interaction and closes/restricts future access under documented policy; handling of already exchanged message history is a separate retention/safety decision and must not expose a blocked counterpart through notifications or new delivery.

## Alternate/failure and concurrency

Client retry uses message client ID/idempotency key; unique participant/conversation rules prevent duplicate thread/message. Persist before delivery job; notification failure does not lose message. Sender sees truthful pending/failed status but server never fabricate delivery/read state. Concurrent block/send resolves by authoritative safety check at transition boundary.

## Security/data/phase

Participants only see objects in authorized conversation. Encrypt transport; encryption-at-rest/end-to-end posture is `DECISION REQUIRED / LEGAL REVIEW REQUIRED` and must preserve lawful safety/retention policy. Scan/validate attachments before availability. Retain only policy-defined message data; reports reference evidence via access-controlled snapshots. V1 text chat. Phase 2 RTC integration through REALTIME. Events: conversation/message lifecycle, delivery attempts, no body in general analytics.

## Cross-references

[messaging and blocks](../flows/messaging-and-blocks.md), [media security](../security/04-media-upload-delivery.md), [Trust & Safety](trust-safety.md), [NOTIFICATIONS](notifications.md).
