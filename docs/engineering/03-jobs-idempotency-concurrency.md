# Durable jobs, idempotency, and concurrency

## Purpose

Authoritative implementation pattern for retryable work: notifications, webhooks, media processing, payment reconciliation, retention, event delivery, AI generation/indexing/evaluation, and provider operations.

## Durable job flow

Owner transaction writes business state plus outbox/job intent. Worker claims with lease, executes bounded work, records attempt/correlation/provider reference, and transitions `queued -> running -> succeeded` or `retry_wait -> dead_letter`. Lease expiry permits safe recovery. Dead letter retains enough redacted context for repair and alerts; repair is audited.

Initial implementation uses PostgreSQL transactional outbox/inbox and BullMQ 5.81 through a logically isolated durable queue Redis responsibility under [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). Owner workflow tables remain authoritative for long waits/approvals. Ephemeral Redis and process memory are never critical job truth; queue Redis is persistent job infrastructure but still does not own business outcome. End-to-end effects are treated as at-least-once even when queue claim delivery is stronger.

The registry is bounded and contains only explicit versioned job names with attempt/backoff ceilings. Queue initialization and registration failures abort startup. Workers expose readiness only after queue Redis is reachable; runtime errors and failed jobs emit redacted diagnostics; shutdown stops intake and closes workers within a bounded timeout. Queue Redis requires private access, persistence, backup/restore, capacity/no-eviction policy, and recovery tests. Local AOF/RDB persistence is test evidence, not production policy.

## Idempotency rules

Public mutation accepts stable client idempotency key scoped to actor/action; same key + same canonical input returns same result, mismatched input is conflict. Provider operation has separate unique external reference. Consumer records processed event IDs. Do not use a timestamp-only key. Store outcome long enough for client/provider retry window defined by policy.

## Concurrency rules

Choose owner transaction, unique constraint, optimistic version, lease, or serialized queue per aggregate. Re-read policy/authorization at transition. Explicitly model races: duplicate submit, reciprocal introduction, block/send, refund/entitlement, payout/chargeback, deletion/retention, role revocation/operation. Do not rely on process memory locks across replicas.

AI jobs pin capability, prompt, schema, and approved route versions, but never pin reusable actor credentials. Re-authorize before sensitive context access, tool execution, approval resumption, or durable effect. A model retry may repeat generation but must not duplicate tool/domain effects; use separate run/step/tool idempotency identities.

## Security/phase/open questions

Workers use least privilege, redacted payloads, retry budgets and safe failed-job/DLQ access. Money and other high-impact handlers re-read PostgreSQL owner state, use stable idempotency identities, and reconcile ambiguous external effects; a BullMQ completed state is never authorization or business completion by itself. Queue/outbox/workflow baseline is locked. Each owner still defines retry windows and idempotency retention from client/provider/legal behavior. External broker or workflow engine is deferred until measured scale/complexity and requires an ADR. See [contracts/events](../architecture/04-contracts-events.md), [AI platform](../ai/01-ai-platform-architecture.md), [payment lifecycle](../flows/payment-lifecycle.md), [scale](../architecture/07-scale-and-resilience.md), [platform health](../operations/05-platform-health.md).
