# Observability and audit engineering

## Purpose

Make system behavior diagnosable without leaking private data. Operational observability and privileged audit are related but separate datasets/access paths.

## Minimum telemetry

Use correlation/trace ID across request, command, event, job, provider call, and audit operation. Structured logs include component, action, outcome, latency, safe error category, and redacted target reference. Metrics cover request/error/latency, auth failures, rate limits, queue age/retries/DLQ, provider verification/failure, payment pending/reconciliation, entitlement denial, moderation backlog, and deletion completion. Trace high-risk distributed flows with sampling/privacy controls.

Implementation uses OpenTelemetry traces/metrics and OTLP, W3C propagation, and Pino structured JSON logs correlated with trace IDs. `packages/observability` isolates domain/application code from the telemetry backend. OpenTelemetry's JavaScript logs SDK is not the only log path.

## Audit requirements

Audit authentication/security changes, role grants, privileged reads/writes, enforcement, financial adjustments/refunds/payouts, configuration/feature/country changes, sensitive export, and break-glass. Audit records include actor/delegated role, target, reason, before/after references, approval, time, correlation and outcome. They must be append-protected, access-controlled, retention-governed, and not editable as normal logs.

## Failure/security/phase

Telemetry outage must not weaken authorization/financial state; buffer/drop only according to data class and alert. Redact secrets, message bodies, media, raw payment data, identity docs, tokens, and sensitive URLs. Initial privileged audit uses a separate insert-only, hash-chained PostgreSQL schema. Verified batches export to a separately administered WORM-capable archive before public production privileged operations. Telemetry/error/paging/archive vendors, SLOs, retention durations, and incident on-call remain decisions before public launch. See [ADR-0013](../decisions/ADR-0013-observability-testing.md), [scale](../architecture/07-scale-and-resilience.md), [platform health](../operations/05-platform-health.md), [incident response](../operations/04-incident-response.md), [analytics](../domains/analytics.md), [security baseline](../security/01-security-baseline.md).

AI-specific trace, usage, cost, latency, validation, safety, evaluation, and drift requirements are authoritative in [AI observability, budgets, and evaluations](../ai/05-ai-observability-budgets-evals.md). AI telemetry must not copy raw private context into generic logs or ANALYTICS.
