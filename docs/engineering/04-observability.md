# Observability and audit engineering

## Purpose

Make system behavior diagnosable without leaking private data. Operational observability and privileged audit are related but separate datasets/access paths.

## Minimum telemetry

Use correlation/trace ID across request, command, event, job, provider call, and audit operation. Structured logs include component, action, outcome, latency, safe error category, and redacted target reference. Metrics cover request/error/latency, auth failures, rate limits, queue age/retries/DLQ, provider verification/failure, payment pending/reconciliation, entitlement denial, moderation backlog, and deletion completion. Trace high-risk distributed flows with sampling/privacy controls.

## Audit requirements

Audit authentication/security changes, role grants, privileged reads/writes, enforcement, financial adjustments/refunds/payouts, configuration/feature/country changes, sensitive export, and break-glass. Audit records include actor/delegated role, target, reason, before/after references, approval, time, correlation and outcome. They must be append-protected, access-controlled, retention-governed, and not editable as normal logs.

## Failure/security/phase

Telemetry outage must not weaken authorization/financial state; buffer/drop only according to data class and alert. Redact secrets, message bodies, media, raw payment data, identity docs, tokens, and sensitive URLs. V1 baseline dashboards/alerts/audit. `DECISION REQUIRED`: telemetry stack, SLOs, retention, immutable audit storage, incident on-call. See [scale](../architecture/07-scale-and-resilience.md), [platform health](../operations/05-platform-health.md), [incident response](../operations/04-incident-response.md), [analytics](../domains/analytics.md), [security baseline](../security/01-security-baseline.md).

AI-specific trace, usage, cost, latency, validation, safety, evaluation, and drift requirements are authoritative in [AI observability, budgets, and evaluations](../ai/05-ai-observability-budgets-evals.md). AI telemetry must not copy raw private context into generic logs or ANALYTICS.
