# ADR-0008: Realtime gateway and RTC abstraction

- Decision date: 2026-08-12
- ADR status: Accepted in part; backend integration/cache naming superseded by ADR-0016

> Supersession note (2026-08-13): [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md) replaces NestJS integration and Valkey naming with Elysia composition and ephemeral Redis. Socket.IO/REST resync, non-authoritative realtime events, provider-neutral RTC, and recording-off decisions remain accepted. Historical implementation detail below is retained intentionally.

## Context

Velora needs presence, typing, message updates, notification updates, and future call invitations/signalling. Realtime transport cannot become message, notification, relationship, safety, entitlement, or call source of truth. Future audio/video requires provider portability, short-lived credentials, explicit consent, and safe session lifecycle without locking a commercial provider now.

Current official sources were checked on the decision date. Socket.IO 4 provides ordered events but default arrival is at-most-once, so recovery and durable state remain application responsibilities. Its Redis adapter uses Pub/Sub for cross-node fan-out and has explicit network/ACL requirements. See [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/) and [Socket.IO Redis adapter](https://socket.io/docs/v4/redis-adapter/).

## Requirements

- Support authenticated Web and Mobile connections, rooms/channels, reconnection, backpressure, and horizontal fan-out.
- Keep message/notification/call state durable in owning domains.
- Revoke access promptly after block, enforcement, session, role, entitlement, or country change.
- Support future call invitations, accept/decline/timeout, WebRTC credentials, quality events, and provider replacement.
- Do not assume recording, transcription, or permanent presence.

## Options evaluated

1. Socket.IO 4 gateway with Valkey adapter and REST snapshot/resync.
2. Raw WebSocket protocol.
3. GraphQL subscriptions.
4. Managed realtime platform as primary state.
5. Polling/server-sent events only.
6. Self-hosted or managed RTC provider selected now.

## Decision

- Use Socket.IO 4.8.x for the initial realtime gateway, integrated through NestJS but isolated behind REALTIME transport contracts.
- Use WebSocket transport as the production baseline. If a network cannot establish it, clients fall back to bounded REST refresh/resync rather than silently depending on HTTP long-polling affinity. Any later polling transport requires load-balancer affinity tests.
- Authenticate connection with a short-lived, audience-bound connection credential derived from current AUTH session. Authorize every channel join and privileged event against current owning-domain state. Re-check on reconnect and sensitive transition; disconnect/revoke when relevant owner events arrive.
- Use Valkey Pub/Sub adapter for cross-replica fan-out. Valkey is trusted private infrastructure, not durable delivery or state. If it fails, local-node fan-out may continue, but clients resync from authoritative REST/domain state.
- Presence, typing, connection membership, and transient quality state use TTL and are advisory. Messages, notification records, invitations, call lifecycle, enforcement, and delivery outcomes are persisted before notification/fan-out.
- Every state-bearing server event carries stable event/object version or cursor. Clients detect gaps and fetch an authorized snapshot/delta. Never interpret Socket.IO delivery as confirmed durable state.
- Keep the gateway inside the API deployable in Phase A, with a clear process entrypoint and no direct repository access. Extract a dedicated gateway deployable when connection scaling or deploy interruption warrants it.
- Use WebRTC as the client media standard for future RTC. REALTIME owns invitation/session lifecycle and exposes an RTC provider port for room/session creation, scoped participant credentials, removal, quality/status callbacks, and teardown.
- Server issues short-lived room/participant/role-scoped credentials only after explicit invite acceptance and current authorization. Clients handle capture/render/device selection; they do not create privileged rooms or trusted session state.
- Recording and transcription are disabled by default. Any enablement requires separate product phase, consent, legal/privacy, storage, retention, moderation, notification, provider, and operations decision.
- Defer managed versus self-hosted RTC vendor until Phase 2 integration. Provider adapters normalize credentials and lifecycle; provider room IDs never become public/domain identity.

## Why

Socket.IO reduces protocol/reconnection/room implementation burden for a small team, while explicit REST resync compensates for its at-most-once arrival semantics. Valkey fan-out supports horizontal replicas without making cache durable. WebRTC and a provider port preserve mobile/Web media support while deferring a costly, compliance-sensitive vendor choice.

## Rejected alternatives

- Raw WebSocket initially: maximum protocol control but requires rebuilding reconnection, acknowledgements, rooms, client compatibility, and operational tooling.
- GraphQL subscriptions: couples realtime to a rejected primary GraphQL layer and does not solve durable domain state.
- Managed realtime platform as truth: leaks vendor concepts into domains and weakens revocation/recovery control.
- Polling only: insufficient for typing, presence, and call invitations; remains a degraded read fallback.
- Selecting RTC vendor now: Phase 2 requirements, countries, safety, recording posture, and pricing remain unresolved.

## Consequences

Clients implement socket plus REST resync. Realtime events are hints/updates, not write acknowledgements. Valkey and load balancer settings become tested infrastructure. Future RTC requires platform-specific native integration and a provider ADR.

## Risks

- Lost events or reconnect gaps can create stale UI.
- Pub/Sub compromise can inject or expose fan-out data.
- Long-lived connections complicate deploys and autoscaling.
- Old credentials can outlive a block/revocation briefly.
- Provider SDKs can leak into client/domain APIs.

## Mitigations

Use cursors/versioned snapshots, private TLS/ACL Valkey, minimized events, connection drain, bounded credential TTL, revocation events plus rechecks, rate/connection limits, payload schemas, and provider adapter conformance. Never include secrets, message bodies beyond authorized delivery needs, or raw safety evidence in fan-out.

## Scaling path

Phase A runs gateway with API and one Valkey. Phase B extracts gateway process, scales connections horizontally, uses dedicated Valkey credentials/cluster if measured, and deploys connection draining. Phase C partitions rooms/channels or regions only after connection/load metrics and residency requirements; domain state remains centralized through contracts.

## Security implications

Enforce origin/audience checks, authentication expiry, per-event schema and authorization, rate/size limits, room enumeration protection, TLS, Valkey isolation, and redacted telemetry. RTC credentials are least-privilege and short-lived. Block/enforcement/country revocation wins over stale connection state.

## Testing implications

Test authorization on connect/join/event, token expiry, block/revocation races, duplicate/out-of-order events, disconnect/reconnect gap recovery, Valkey outage, horizontal fan-out, connection drain, payload abuse, and rate limits. RTC adapter tests cover invite consent, credential scope/expiry, duplicate callbacks, removal, reconnect, provider outage, and no-recording default.

## Migration/reversibility

Socket.IO is behind client/gateway contracts; a future raw or managed transport can coexist and consume the same durable events. RTC provider replacement uses normalized session IDs and adapters; run dual-provider test/canary routes without migrating domain truth.

## Status

| Decision | Classification |
|---|---|
| Socket.IO 4.8.x realtime protocol | LOCK NOW |
| WebSocket transport plus REST resync | LOCK NOW |
| Valkey cross-node fan-out | LOCK NOW |
| WebRTC and provider-neutral RTC port | LOCK NOW |
| Dedicated realtime service extraction | DEFER UNTIL SCALE REQUIRES |
| RTC provider and hosting mode | DEFER UNTIL PROVIDER INTEGRATION |
| RTC recording/transcription | DECISION REQUIRED BEFORE FEATURE |
| Managed realtime platform as source of truth | REJECTED |
