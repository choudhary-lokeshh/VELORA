# Durable jobs, idempotency, and concurrency

## Purpose

Authoritative implementation pattern for retryable work: notifications, webhooks, media processing, payment reconciliation, retention, event delivery, AI generation/indexing/evaluation, and provider operations.

## Durable job flow

Owner transaction writes business state plus outbox/job intent. Worker claims with lease, executes bounded work, records attempt/correlation/provider reference, and transitions `queued -> running -> succeeded` or `retry_wait -> dead_letter`. Lease expiry permits safe recovery. Dead letter retains enough redacted context for repair and alerts; repair is audited.

## Idempotency rules

Public mutation accepts stable client idempotency key scoped to actor/action; same key + same canonical input returns same result, mismatched input is conflict. Provider operation has separate unique external reference. Consumer records processed event IDs. Do not use a timestamp-only key. Store outcome long enough for client/provider retry window defined by policy.

## Concurrency rules

Choose owner transaction, unique constraint, optimistic version, lease, or serialized queue per aggregate. Re-read policy/authorization at transition. Explicitly model races: duplicate submit, reciprocal introduction, block/send, refund/entitlement, payout/chargeback, deletion/retention, role revocation/operation. Do not rely on process memory locks across replicas.

AI jobs pin capability, prompt, schema, and approved route versions, but never pin reusable actor credentials. Re-authorize before sensitive context access, tool execution, approval resumption, or durable effect. A model retry may repeat generation but must not duplicate tool/domain effects; use separate run/step/tool idempotency identities.

## Security/phase/open questions

Workers use least privilege, redacted payloads, encrypted queues where needed, retry budgets and safe DLQ access. V1 mandatory primitives. `DECISION REQUIRED`: queue/outbox technology, retry windows, idempotency retention, workflow engine. See [contracts/events](../architecture/04-contracts-events.md), [AI platform](../ai/01-ai-platform-architecture.md), [payment lifecycle](../flows/payment-lifecycle.md), [scale](../architecture/07-scale-and-resilience.md), [platform health](../operations/05-platform-health.md).
