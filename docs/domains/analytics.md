# ANALYTICS domain

## Purpose and scope

ANALYTICS owns event/metric definitions, consent-aware collection policy, derived reporting datasets, experiment measurement, and data-quality controls. It does not own transactional product state, authorize product actions, or receive raw secrets/sensitive evidence by default.

## Flow and data rules

Owner domain emits versioned minimized event; ANALYTICS validates schema, consent/purpose, deduplicates event ID, derives aggregates, and exposes role-scoped metrics. Event specification names actor pseudonym/reference, event time, correlation ID, properties classification, retention, and permitted consumers. Product decisions always re-check source domain, never analytics projection.

## Security/failure/concurrency

Reject/quarantine invalid events with data-quality alert; do not block user transaction unless explicit critical audit path. Deduplicate at least once delivery. Hash/pseudonymize identifiers where useful, minimize sensitive fields, enforce deletion/consent propagation, and restrict Admin/creator analytics to aggregation that avoids exposing private counterpart behavior. No message body, raw media, auth secret, raw card, or identity document.

## Phase/open questions

V1 operational/product baseline events and audit-adjacent metrics. Phase 3 creator analytics and experiments/growth maturity. `DECISION REQUIRED`: warehouse/provider, consent model, thresholding, retention, metric governance. See [observability](../engineering/04-observability.md), [privacy](../security/03-privacy-retention.md), [contracts/events](../architecture/04-contracts-events.md).
