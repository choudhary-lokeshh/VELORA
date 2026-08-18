# Scale and resilience

## Creator core, measured

Every creator listing is keyed on an indexed ordering and bounded by a limit, and the plans are asserted on seeded volume rather than assumed: the public handle lookup resolves through its unique index, one creator's public catalog comes from the partial published index with no sort, the operator list walks its ordering index, and a creator's own catalog page never touches another creator's rows. Those assertions are the guard — a change that loses an index fails on the plan, not later in production.

Paging is keyset rather than offset throughout, and the creator catalog is keyed on the publication instant, which is written once and never rewritten. A reader part-way through cannot have a page boundary move under them, so an item published mid-read appears ahead of their position instead of being inserted into a page they already had.

Counting is done per bounded page rather than per row. A page of clubs resolves its live member counts in one bounded set of statements, and the operator list resolves handles for its page in one statement, so no listing has a query shape that grows with the number of rows it returns.

Creator load runs on the same pool as everything else, at production sizes, in `test/integration/database-pool-hardening.test.ts`: fifty simultaneous claims of one handle settle on one owner and fifty concurrent catalog writes across ten creators all succeed, with no connection lost, no deadlock, and no in-flight work left behind.

## Purpose

Define system behavior under growth and partial failure. PostgreSQL, logically separated Redis responsibilities, BullMQ, OCI containers, and the managed-container topology are selected; cloud, managed-service, external broker, and deployment vendors remain deferred. Queue Redis is persistent correctness-relevant infrastructure, while ephemeral Redis remains rebuildable; neither owns business truth.

## Baseline

- Keep API request paths short; move slow/remote/retryable work to durable jobs.
- Scale stateless clients/API horizontally. Partition only after measured hot keys or data volume justify it; preserve aggregate ordering rules.
- Use timeouts, bounded retries with jitter, circuit isolation, backpressure, and dead-letter handling for external calls.
- Design all public mutation endpoints and webhook processors for duplicate delivery. Protect multi-writer records using transactions, uniqueness constraints, or optimistic version guards.
- Maintain recoverable backups, tested restore procedure, health checks, operational runbooks, and access-limited incident evidence.

## Failure flows

Provider outage: record pending state, retry safe operation asynchronously, surface truthful pending/error result, and reconcile later. Event lag: use source-of-truth authorization for access-critical action, not stale projection. Job failure: alert, retain durable payload, retry/DLQ, then repair with auditable operator tool. Never silently grant access, charge twice, or erase state to hide failure.

Identity-provider I/O never runs inside a database transaction. A committed attempt may remain unbound after a timeout or process crash; retrieval by provider idempotency key and reconciliation recover it. Provider-event leases are bounded and reclaimable, attempts and events are protected by database uniqueness, and stale callbacks cannot resurrect superseded evidence. Subject/evidence/admin reads use indexed exact lookup or keyset aggregation; the required 200,000-subject plans are release evidence, not an assumed future optimization.

## Observability and phase

V1 needs correlation IDs, redacted logs, core SLO metrics, traces for high-risk flows, queue health, and audit separation. Initial deployment is one approved region. `DECISION REQUIRED`: SLO targets, RPO/RTO, recovery-region/failover posture, data residency, and incident response ownership before launch. See [observability](../engineering/04-observability.md), [jobs](../engineering/03-jobs-idempotency-concurrency.md), [platform health](../operations/05-platform-health.md), [incident response](../operations/04-incident-response.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).

Scaling follows [technical stack](09-technical-stack.md): Phase A single-region modular monolith; Phase B horizontal API/workers and selective gateway/worker separation; Phase C service extraction only where metrics, security isolation, or ownership require it.
