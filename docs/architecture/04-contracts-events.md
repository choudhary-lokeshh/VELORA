# Contracts and events

## Purpose

Specify cross-domain/API interaction rules. Domain-specific event names and payload ownership live in each domain document; this document is authoritative for delivery semantics.

## Contract rules

- Publish request/response schemas and error codes through versioned contracts. Add fields compatibly; deprecate before removal.
- Commands name intended action and return only result needed by caller. Domain service re-authorizes actor; upstream authorization is not trusted alone.
- Events name completed facts in past tense, include immutable event ID, schema version, occurred time, aggregate ID/version, correlation ID, producer, and minimized payload.
- Never put passwords, raw cards, secret keys, raw identity documents, or unnecessary sensitive media in contracts/events.
- Registering a domain contract as an AI tool does not grant permission. Tool metadata must preserve owning-domain authorization, effect classification, idempotency, data classification, approval, and audit requirements; model-generated arguments remain untrusted.

## Delivery and failure flow

Within owner transaction, persist state plus outbox record. Durable worker delivers event at least once. Consumer records processed event ID before/with side effect, making repeated delivery safe. Failed deliveries retry with bounded backoff, then dead-letter and alert; they never silently disappear. Event order is guaranteed only per explicitly defined aggregate stream; consumers must tolerate duplicate and late events.

## State and data ownership

Commands cause owner state transition. Events are facts, not remote-write instructions. Read models/projections are rebuildable and cannot become new source of truth. Contract changes require owner approval, compatibility test, observability update, and index update.

## Technical implementation

V1 uses Zod 4 schemas, generated OpenAPI 3.1/TypeScript clients, PostgreSQL transactional outbox/inbox, and BullMQ execution under [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md) plus the unaffected contract/outbox portions of ADR-0005 and ADR-0007. PostgreSQL owner state and the outbox fact are atomic; publication and job handling are idempotent and reconcilable. An external broker is deferred until measured throughput, fan-out, retention, or extraction requires it. See [API contracts](../engineering/01-api-contracts.md), [AI capabilities/tools](../ai/02-ai-capabilities-tools.md), [jobs/idempotency](../engineering/03-jobs-idempotency-concurrency.md), [analytics](../domains/analytics.md).
