# NOTIFICATIONS domain

## Purpose and scope

NOTIFICATIONS owns consent-aware notification preferences, channel selection, templates, delivery attempts, provider receipts, and suppression. It does not decide product eligibility, author message/call/content state, or own SMS/Email credential policy outside its delivery contract.

## Flow and transitions

Source domain emits minimized notification request/fact through the transactional outbox. NOTIFICATIONS evaluates recipient preference, consent, safety/quiet-hour/country rules and channel capability; then schedules durable BullMQ work from authoritative PostgreSQL intent and records `queued -> attempted -> delivered/failed/suppressed`. Provider receipt updates attempt idempotently. Queue completion does not define notification truth. Critical security notices use defined policy and may bypass ordinary marketing preferences only where lawful.

## Failure/security/concurrency

Notification failure never rolls back source action. Deduplicate by source event/recipient/template window; retries safe only with provider idempotency/reference. Do not put sensitive, sexual, payment, or report detail in lock-screen/email/SMS body by default. Validate templates, rate-limit, prevent notification flooding, and protect device tokens/addresses as private data.

## Permissions/data/phase

User manages own preferences. Source domain may request only its approved versioned template/event. Admin template/config actions are scoped/audited. V1 transactional notices; Phase 2 push expansion; Phase 3 growth campaigns only with consent. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: channel provider, default preferences, quiet hours, legal messaging policy. See [notification flow](../flows/notification-delivery.md), [provider adapters](../architecture/06-provider-adapters.md), [jobs/events ADR](../decisions/ADR-0007-cache-jobs-events.md), [privacy](../security/03-privacy-retention.md).
