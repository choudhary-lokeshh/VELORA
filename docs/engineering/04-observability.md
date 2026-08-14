# Observability and audit engineering

## Purpose

Make system behavior diagnosable without leaking private data. Operational observability and privileged audit are related but separate datasets/access paths.

## Minimum telemetry

Use correlation/trace ID across request, command, event, job, provider call, and audit operation. Structured logs include component, action, outcome, latency, safe error category, and redacted target reference. Metrics cover request/error/latency, auth failures, rate limits, queue age/retries/DLQ, provider verification/failure, payment pending/reconciliation, entitlement denial, moderation backlog, and deletion completion. Database saturation is part of that set: in-flight and waiting units, admission wait latency, capacity refusals, configured pool size, sustained `idle in transaction` backends, and advisory-lock waiters, per [ADR-0019](../decisions/ADR-0019-database-connection-admission.md). A sustained non-zero `idle in transaction` count is a lost-connection alert rather than a spike to ignore. Trace high-risk distributed flows with sampling/privacy controls.

Implementation uses provider-neutral OpenTelemetry API seams, W3C correlation, and Pino structured JSON logs. `packages/observability/server` owns server logging/redaction while `packages/observability/client` exposes only client-safe correlation types; no privileged root export exists. Official OpenTelemetry JavaScript support targets Node/browser, so a concrete Bun trace/metric SDK and OTLP exporter stay disabled until compatibility, flush, failure, and graceful-shutdown tests pass. OpenTelemetry's JavaScript logs SDK is not the log path.

## Audit requirements

Audit authentication/security changes, role grants, privileged reads/writes, enforcement, financial adjustments/refunds/payouts, configuration/feature/country changes, sensitive export, and break-glass. Audit records include actor/delegated role, target, reason, before/after references, approval, time, correlation and outcome. They must be append-protected, access-controlled, retention-governed, and not editable as normal logs.

## Failure/security/phase

Telemetry outage must not weaken authorization/financial state; buffer/drop only according to data class and alert. Recursively redact root, nested, and deeply nested secret-bearing keys; authentication/cookie headers; access/refresh tokens; API keys; passwords; connection/database URLs; query-string secrets; and secret-bearing error messages. Request logging records sanitized paths and safe fields, never raw query secrets or bodies by default. Initial privileged audit uses a separate insert-only, hash-chained PostgreSQL schema. Verified batches export to a separately administered WORM-capable archive before public production privileged operations. Telemetry/error/paging/archive vendors, SLOs, retention durations, and incident on-call remain decisions before public launch. See [ADR-0013](../decisions/ADR-0013-observability-testing.md), [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md), [scale](../architecture/07-scale-and-resilience.md), [platform health](../operations/05-platform-health.md), [incident response](../operations/04-incident-response.md), [analytics](../domains/analytics.md), [security baseline](../security/01-security-baseline.md).

AI-specific trace, usage, cost, latency, validation, safety, evaluation, and drift requirements are authoritative in [AI observability, budgets, and evaluations](../ai/05-ai-observability-budgets-evals.md). AI telemetry must not copy raw private context into generic logs or ANALYTICS.
