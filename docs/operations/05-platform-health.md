# Platform health operations

## Purpose and authority

Define operational health signals, ownership, and degraded behavior across Velora. This document does not select telemetry, hosting, queue, or incident vendors.

## Health model

Track user-visible journeys and their dependencies: authentication/onboarding, discovery/introduction, messaging/notification, media, reports/moderation/enforcement, payments/entitlements, creator Studio/content, payouts, Admin, data lifecycle, providers, and future AI/RTC.

Health indicators include availability, latency, errors, saturation, queue age/retries/DLQ, event lag, provider verification/failure, reconciliation backlog, authorization/entitlement denial anomalies, moderation/support backlog, deletion/export completion, audit pipeline, backup/restore status, and feature/country configuration drift.

A backlog indicator is a count **and** an age. A count alone cannot separate a busy minute from a stuck hour, and only the age says which one an operator is looking at. Where a domain already runs on a deadline — a lease, a backoff run, a stall bound, a sweep interval — the alerting age is derived from that deadline rather than chosen separately, so a dashboard cannot call work late that the platform considers to be proceeding, or call it healthy while a sweep is already repairing it. MEDIA publishes its owed work this way through the operator media state: every class every time, healthy ones included, each with the age of its oldest member and the threshold it is measured against, and its readiness gate in the [media threat model](../security/10-media-threat-model.md) depends on those signals being alertable and owned. A class that reports only when unhealthy cannot be distinguished from a class whose signal stopped arriving.

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

**As built** ([ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md)): Platform · Operations reports each domain outbox by state with the age of its oldest undelivered fact, recorded failures grouped by domain and class, BullMQ queue counters, and every dependency's readiness. Every figure is a durable row somebody's domain wrote because something went wrong, so a count is a set of records an operator can open rather than a gauge. A dependency nobody approved reports `unconfigured` rather than `unavailable`, a broker nothing reached reports `unreachable` with absent counts rather than zeroes, and a remote provider this process has not spoken to reports `unknown` — because saying otherwise would be reporting health with no evidence, on the one screen that exists to avoid exactly that. There is no uptime figure, error rate, or health percentage anywhere on it. Operator guidance for each of these conditions is in [operator runbooks](../engineering/09-operator-runbooks.md).

See [scale/resilience](../architecture/07-scale-and-resilience.md), [observability](../engineering/04-observability.md), [testing/release](../engineering/05-testing-release.md), [operator runbooks](../engineering/09-operator-runbooks.md), and [incident response](04-incident-response.md).
