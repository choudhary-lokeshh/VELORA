# Scale and resilience

## Purpose

Define system behavior under growth and partial failure. PostgreSQL, Valkey, pg-boss, OCI containers, and the managed-container topology are selected; cloud, managed-service, broker, and deployment vendors remain deferred.

## Baseline

- Keep API request paths short; move slow/remote/retryable work to durable jobs.
- Scale stateless clients/API horizontally. Partition only after measured hot keys or data volume justify it; preserve aggregate ordering rules.
- Use timeouts, bounded retries with jitter, circuit isolation, backpressure, and dead-letter handling for external calls.
- Design all public mutation endpoints and webhook processors for duplicate delivery. Protect multi-writer records using transactions, uniqueness constraints, or optimistic version guards.
- Maintain recoverable backups, tested restore procedure, health checks, operational runbooks, and access-limited incident evidence.

## Failure flows

Provider outage: record pending state, retry safe operation asynchronously, surface truthful pending/error result, and reconcile later. Event lag: use source-of-truth authorization for access-critical action, not stale projection. Job failure: alert, retain durable payload, retry/DLQ, then repair with auditable operator tool. Never silently grant access, charge twice, or erase state to hide failure.

## Observability and phase

V1 needs correlation IDs, redacted logs, core SLO metrics, traces for high-risk flows, queue health, and audit separation. Initial deployment is one approved region. `DECISION REQUIRED`: SLO targets, RPO/RTO, recovery-region/failover posture, data residency, and incident response ownership before launch. See [observability](../engineering/04-observability.md), [jobs](../engineering/03-jobs-idempotency-concurrency.md), [platform health](../operations/05-platform-health.md), [incident response](../operations/04-incident-response.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).

Scaling follows [technical stack](09-technical-stack.md): Phase A single-region modular monolith; Phase B horizontal API/workers and selective gateway/worker separation; Phase C service extraction only where metrics, security isolation, or ownership require it.
