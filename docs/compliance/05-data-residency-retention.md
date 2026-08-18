# Data residency and retention gates

## Purpose and status

Define architecture decisions required before storing or transferring production personal data across countries or providers. This is not legal advice. Regions, lawful bases, rights, retention periods, transfer mechanisms, and regulator duties are `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Data inventory and ownership

Each domain records for every data class: source owner, purpose, subjects, fields, sensitivity, collection source, processors/providers, storage/backup regions, transfer path, authorized roles, retention trigger/duration, legal/safety hold, deletion/de-identification, export eligibility, audit, and incident owner.

Derived analytics, search, caches, media variants, Identity evidence/digests, AI context/memory/RAG/evaluation data, logs, traces, queues, DLQs, provider copies, and backups inherit source sensitivity. Derived form, hashing, or encryption does not remove residency, retention, consent, or deletion obligations.

## Residency and provider routing

Country/channel capability configuration selects approved storage, processing, backup, analytics, moderation, verification, payment, notification, and AI provider regions. Routing must fail closed if no eligible region/provider exists; fallback cannot move data to an unapproved location.

Provider review covers subprocessors, transfer locations, training/secondary use, access support, retention, deletion, incident notification, government/legal request handling, and exit/export. Real vendors are not connected before approval.

## Retention and deletion lifecycle

Retention is event-based where possible: account deletion, session expiry, content removal, entitlement expiry, case closure, dispute settlement, payout completion, audit period, or consent withdrawal. Durable idempotent jobs delete or irreversibly de-identify owner records and propagate to projections/providers. Legal, financial, fraud, safety, or audit holds retain only justified fields with restricted access and expiry/review.

Backups and immutable logs use documented deletion latency and restore procedures that prevent deleted data from silently re-entering active systems. DLQs, exports, temporary files, caches, and test/evaluation datasets have explicit expiry. Failed deletion alerts and remains operationally visible.

## Rights, exports, and evidence

Authenticated export/correction/deletion requests coordinate across domains without exposing another person's data, reporter identity, moderation evidence, secrets, or legally restricted records. Export generation is asynchronous, encrypted, short-lived, rate-limited, and audited. User-facing status distinguishes requested, verifying, processing, held/limited, completed, and failed.

## Open decisions and cross-references

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: launch regions, data map, controller/processor roles, lawful bases/consent, transfer mechanisms, storage/backup regions, retention schedule, holds, rights SLA, backup deletion, provider deletion evidence, and breach/regulator notification.

See [privacy/retention](../security/03-privacy-retention.md), [data ownership](../architecture/05-data-ownership.md), [account deletion](../flows/account-deletion.md), [IDENTITY ASSURANCE](../domains/identity-assurance.md), [identity provider eligibility](09-identity-verification-provider-eligibility.md), [AI context](../ai/03-ai-context-memory-rag.md), and [incident response](../operations/04-incident-response.md).
