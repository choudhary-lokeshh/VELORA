# Identity verification operations

## Scope and authority

This document defines operation of the provider-neutral Identity Assurance core. It authorizes observation and incident handling, not identity decisions. No operator may manually grant, override, revoke, search, export, or alter assurance evidence until a separate approved workflow defines authority and dual-control requirements.

## Health and queues

Operators observe privacy-minimized aggregates for configured provider availability, attempts by lifecycle/purpose, oldest provider-event backlog, retry/dead-letter counts, expiring evidence, reconciliation findings by class/age, provider latency/error classes, and outbox backlog. Metrics and logs never contain identity attributes, hosted URLs, provider payloads, free-form reasons, or raw evidence.

Alerts require an owner and runbook for:

- callback authentication failures above baseline;
- verified callback backlog/oldest age;
- attempts stuck in recoverable states;
- provider create/retrieve latency and ambiguous outcomes;
- evidence expiry or reverification backlog;
- reconciliation drift and failed repair;
- dead-letter growth;
- privacy deletion/retention obligation breach;
- provider or jurisdiction-policy configuration drift.

Exact thresholds and SLOs are `DECISION REQUIRED BEFORE FEATURE`.

Current implementation provides the verified callback inbox, bounded lease/retry/dead-letter worker, redacted failure logging, and transactional evidence/outbox write. Aggregate Admin reads, alerts/dashboards, reconciliation, privileged repair, and privacy-obligation execution remain unavailable; this document does not imply that an operator can perform them yet.

## Allowed actions

Before a privileged mutation workflow is approved, operators may:

- inspect aggregate health;
- read one exact subject by an already-known opaque reference using the approved exact action;
- correlate an attempt/event/finding by opaque identifiers;
- disable the live capability through the owning configuration/change process;
- escalate provider, security, privacy, legal, safety, or incident response;
- preserve diagnostic evidence that contains no raw identity payload.

Operators may not use a provider dashboard decision as VELORA truth, edit database rows, replay an unverified callback, fabricate evidence, force a provider, lower assurance, bypass jurisdiction policy, or disclose provider reasons to a user without approved copy/policy.

## Incident and reconciliation procedure

1. Classify impact by provider/account/environment, jurisdiction, purpose, and time window using aggregates.
2. Fail closed for new starts when authenticity, policy, privacy, or result integrity is uncertain.
3. Preserve correlation IDs, digests, normalized states, configuration versions, and audit records; never copy raw documents/callbacks into tickets or chat.
4. Let verified inbox and reconciliation recover under bounded leases. Do not manually mark completion.
5. If provider state conflicts with VELORA, record a reconciliation finding and follow the owner-approved repair path. Evidence history remains append-only.
6. Notify security/privacy/legal/product owners as required; user communications use approved privacy-safe copy.
7. Verify backlog drain, no stale resurrection, outbox delivery, and owner-domain predicate recomputation before re-enablement.
8. Record post-incident actions and update the provider-specific ADR/runbook when durable knowledge changed.

## Dead letter and privacy obligations

Dead-letter rows contain normalized identifiers and error classes only. Repair is audited and idempotent. A repair never accepts raw callback data or lets an operator choose normalized evidence.

Deletion, consent withdrawal, biometric retention, legal hold, and provider-erasure obligations are tracked as durable work with a named privacy/legal owner. Provider confirmation is evidence of provider action, not permission to erase VELORA records that another lawful retention rule requires.

## Production gate

Production starts fail while the provider is `unavailable`, the jurisdiction policy is unpublished, or `local-test` is configured. Live operations additionally require staffed ownership, approved SLO/alerts, provider escalation, secret rotation, callback replay response, outage/degraded plan, reconciliation cadence, privacy request process, and incident exercise.

See [Identity domain](../domains/identity-assurance.md), [verification flow](../flows/identity-assurance-verification.md), [threat model](../security/11-identity-verification-threat-model.md), and [incident response](04-incident-response.md).
