# Platform health operations

## Purpose and authority

Define operational health signals, ownership, and degraded behavior across Velora. This document does not select telemetry, hosting, queue, or incident vendors.

## Health model

Track user-visible journeys and their dependencies: authentication/onboarding, discovery/introduction, messaging/notification, media, reports/moderation/enforcement, payments/entitlements, creator Studio/content, payouts, Admin, data lifecycle, providers, and future AI/RTC.

Health indicators include availability, latency, errors, saturation, queue age/retries/DLQ, event lag, provider verification/failure, reconciliation backlog, authorization/entitlement denial anomalies, moderation/support backlog, deletion/export completion, audit pipeline, backup/restore status, and feature/country configuration drift.

## Ownership and dashboards

Each domain owns service and business-process indicators for its contracts. Platform operations owns shared runtime/egress/queue/data infrastructure. ADMIN presents role-scoped health and operation links but does not become telemetry or domain truth. ANALYTICS product metrics remain separate from operational health and immutable audit.

Dashboards and alerts use correlation IDs and redacted identifiers. They must not expose message/media content, raw payment/identity data, secrets, private moderation evidence, AI context, or sensitive URLs.

## Degraded behavior

- Authorization, entitlement, compliance, and webhook-verification uncertainty fail closed.
- Provider outage returns truthful pending/unavailable state and durable retry/reconciliation where safe.
- Event lag does not let access-critical action trust stale projection.
- Notification/analytics outage does not roll back source action.
- Queue overload applies backpressure and priority policy; it does not drop critical financial, safety, deletion, audit, or provider work silently.
- AI route failure uses only pre-approved fallback; otherwise stops safely.
- RTC degradation ends or rejects sessions safely without inventing recording or presence truth.

## SLOs, alerting, and capacity

Define SLO/error budget per journey and risk tier before public launch. Alerts must be actionable, deduplicated, routed to owner, and include runbook/correlation context. High-risk correctness signals may alert even when availability is high. Capacity plans cover launch country/channel, growth, provider quotas, queues, storage, egress, media, and future AI budgets.

Synthetic probes use non-production-safe accounts/data and cannot execute uncontrolled financial, enforcement, or notification effects. Operational repair uses audited tools and owner contracts, never direct ad-hoc persistence mutation.

## Release and incident integration

Deployments/config/provider/model changes correlate with health. Canary and feature flags support rollback. Alerted state can suspend capability through deterministic policy. Incident response owns coordination; health systems preserve evidence and recovery verification.

## Open decisions and cross-references

OpenTelemetry/OTLP, Pino logs, and separate audit architecture are locked by [ADR-0013](../decisions/ADR-0013-observability-testing.md). `DECISION REQUIRED`: telemetry/error/paging/archive vendors, SLOs/error budgets, on-call ownership, alert thresholds, dashboard access, synthetic testing, capacity model, status page, runbooks, RPO/RTO, recovery-region posture, and audit/telemetry retention durations.

See [scale/resilience](../architecture/07-scale-and-resilience.md), [observability](../engineering/04-observability.md), [testing/release](../engineering/05-testing-release.md), and [incident response](04-incident-response.md).
