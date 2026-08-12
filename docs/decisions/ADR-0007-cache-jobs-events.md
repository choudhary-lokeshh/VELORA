# ADR-0007: Cache, durable jobs, workflows, and events

- Decision date: 2026-08-12
- ADR status: Accepted

## Context

Velora needs ephemeral presence/rate-limit state, notifications, provider/webhook processing, media work, moderation, payment reconciliation, retention, scheduled work, AI jobs, approval waits, and reliable domain events. Critical work cannot live only in process memory or an evictable cache, and the initial system should not operate a broker or workflow cluster without evidence.

Current official sources were checked on the decision date. Valkey 9.1 is the current stable line. pg-boss 12 uses PostgreSQL `SKIP LOCKED`, supports transaction-scoped enqueueing, retries, scheduling, and queue recovery. End-to-end effects still require idempotency because a worker can fail after an external effect. See [Valkey releases](https://valkey.io/download/releases/), [Valkey topics](https://valkey.io/topics/), and [pg-boss project](https://github.com/timgit/pg-boss).

## Requirements

- Provide shared TTL state, rate limits, presence, fan-out support, and cache invalidation.
- Ensure notifications, money, entitlement, safety, deletion, provider, media, audit, and AI work survives process restart.
- Persist state and event/job intent atomically where correctness requires it.
- Support bounded retries, leases, schedules, cancellation, dead-letter handling, replay, and observability.
- Tolerate duplicate and out-of-order events.
- Keep initial operations small and preserve future broker/workflow extraction.

## Options evaluated

1. Valkey for ephemeral state plus PostgreSQL outbox and pg-boss for durable work.
2. PostgreSQL only, including all cache and presence behavior.
3. Redis/Valkey with BullMQ for all jobs.
4. RabbitMQ or NATS from first release.
5. Kafka from first release.
6. Temporal or another workflow engine from first release.
7. In-memory queues/timers.

## Decision

- Use Valkey 9.1 for shared ephemeral/cache concerns: rate-limit counters, short-lived presence/typing state, cache entries, revocation acceleration, distributed Socket.IO fan-out, and narrowly justified coordination hints.
- Nothing correctness-critical lives only in Valkey. Sessions, role grants, feature/country gates, messages, notifications intent, payment/payout/entitlement state, moderation/enforcement, approvals, audit, idempotency outcomes, and durable job state remain in PostgreSQL. Cache outage yields degraded performance or unavailable ephemeral features, never stale authorization success.
- Use pg-boss 12 on PostgreSQL for initial durable queues, scheduled jobs, retries, leases, priorities, and dead-letter handling. Pin exact version/schema at bootstrap and run its migrations through the reviewed infrastructure migration process, never hidden application-startup drift.
- For a business transition, write owner state plus a domain-owned outbox/job-intent row in one PostgreSQL transaction. A dispatcher publishes/creates pg-boss work idempotently. When pg-boss transaction integration is used directly, the same owner transaction and stable job ID are mandatory.
- Treat end-to-end job handling as at-least-once. Every handler records a stable job/operation/effect identity, checks current owner state, and makes provider/domain effects idempotent. A queue library's claim guarantee does not make a remote provider effect exactly once.
- Use a transactional outbox for domain and integration events. Events include immutable ID, producer, schema version, aggregate ID/version, occurred time, correlation ID, and minimized data. Consumers maintain inbox/deduplication state with their side effect.
- Use explicit owner workflow tables for long-running state machines and human approval waits. pg-boss supplies wakeups/timeouts; it is not the authoritative workflow state. Do not add a general workflow engine initially.
- Use separate queues and concurrency budgets by risk/workload class. Financial, safety, deletion, audit, and provider-reconciliation work cannot be starved by bulk media, analytics, or AI.
- Dead-letter state is durable, access-controlled, alerted, and repairable through audited operator workflows. Requeue preserves original identity and attempt history.
- Do not use Valkey Pub/Sub as durable domain-event transport. External broker/stream selection occurs only after measured throughput, retention, fan-out, or independent-service needs.

## Why

Valkey provides efficient shared ephemeral primitives. PostgreSQL and pg-boss reuse the selected durable engine, permit atomic enqueue patterns, and minimize infrastructure. The outbox/inbox pattern preserves domain facts and lets a broker be added later without changing owner transactions. Explicit workflow tables keep approvals and high-impact state visible and auditable.

## Rejected alternatives

- PostgreSQL for all presence/cache traffic: possible initially, but unnecessary write/read amplification and expiry load for high-churn advisory state.
- BullMQ as critical queue: creates a second durability boundary and cannot atomically commit business state with PostgreSQL.
- Kafka, RabbitMQ, or NATS initially: valuable at higher fan-out/throughput, but adds operations and distributed failure modes before need.
- Temporal initially: strong durable workflow model, but adds infrastructure, SDK semantics, and operational learning beyond current workflow volume.
- In-memory queues/timers: lose critical work on restart/deploy and fail across replicas.

## Consequences

PostgreSQL carries transactional data, outbox, and initial job load. Queue throughput is intentionally bounded by database capacity. Valkey becomes an availability dependency for realtime fan-out/rate limits but not business truth. Workflow code must model durable state explicitly.

## Risks

- Job tables/outbox can contend with transactional workload.
- Dual outbox-to-queue records can duplicate work.
- Valkey loss can cause presence/rate-limit degradation.
- Failed poison jobs can loop or expose sensitive payloads.
- pg-boss automatic schema behavior can conflict with migration discipline.

## Mitigations

Use bounded polling/batches, indexes, queue quotas, priority separation, stable IDs, inbox dedupe, payload minimization, encryption where needed, retry budgets, DLQ alerts, backup/restore tests, explicit pg-boss migration commands, and capacity thresholds for broker extraction.

## Scaling path

Phase A uses PostgreSQL outbox/pg-boss and one Valkey deployment. Phase B scales workers horizontally, separates queue classes and database connections, uses Valkey replicas/cluster only when needed, and monitors queue impact. Phase C may move selected integration streams to a broker or complex workflows to a workflow engine after a new ADR; owner outbox and idempotency semantics remain.

## Security implications

Valkey uses private networking, TLS/authentication, ACLs, dedicated credentials/namespaces, and no public exposure. Queue/outbox payloads contain references rather than secrets or raw sensitive content. Workers use least-privilege domain/provider credentials. DLQ and replay tools are privileged and audited.

## Testing implications

Test with real PostgreSQL and Valkey: crash after claim, lease expiry, duplicate dispatch, duplicate provider effect, retry exhaustion, DLQ/requeue, out-of-order events, schedule/timeouts, cancellation, queue starvation, Valkey outage, and recovery. Verify owner transaction and outbox atomicity.

## Migration/reversibility

Valkey data is disposable and rebuildable. pg-boss jobs and outbox records are exportable PostgreSQL data. A future broker/workflow engine can run in parallel, consume the same versioned outbox, compare outcomes, then cut over queue by queue. In-flight jobs remain on their original runner until drained or explicitly migrated.

## Status

| Decision | Classification |
|---|---|
| Valkey 9.1 for shared ephemeral state | LOCK NOW |
| PostgreSQL transactional outbox/inbox | LOCK NOW |
| pg-boss 12 durable jobs/schedules | LOCK NOW |
| Owner tables for approval/long workflow state | LOCK NOW |
| External broker/stream platform | DEFER UNTIL SCALE REQUIRES |
| General workflow engine | DEFER UNTIL SCALE REQUIRES |
| Valkey-only critical jobs or durable truth | REJECTED |
| In-memory critical queues/timers | REJECTED |

