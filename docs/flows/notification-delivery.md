# Notification request and delivery flow

## Purpose and authority

Define notification request, preference, delivery, deep-link, and failure behavior. Source domain owns event truth; NOTIFICATIONS owns preferences, templates, channel selection, attempts, provider receipts, and suppression. Delivery never changes source state.

## Preconditions and states

Source domain emits an approved minimized notification fact/request with event ID, recipient, template, purpose, urgency, correlation, object/deep-link reference, and data classification. Notification attempt moves `requested -> evaluated -> queued -> attempted -> delivered/failed/suppressed`, with retry and expiry under policy.

## Main flow

1. Validate source domain, contract/version, event deduplication, recipient, template, purpose, phase/country/channel, and payload fields.
2. Evaluate recipient preferences/consent, quiet hours, safety suppression, marketing law/policy, device/channel readiness, rate/frequency limits, and expiry.
3. Render approved localized template with field allowlist; do not accept arbitrary source HTML/markup.
4. Queue durable attempt with idempotency/provider reference and send through configured adapter.
5. Verify and normalize provider receipt/status; update attempt idempotently.
6. On open, client authenticates and owning domain re-authorizes target. Notification/deep-link possession never grants object access.

## Alternate and failure paths

Invalid source/template/payload is rejected and alerted. Preference or safety policy suppresses without leaking reason. Provider timeout or ambiguous receipt stays attempted/pending and reconciles; bounded retries avoid duplicate flooding. Expired token/deep link lands on safe destination. Missing device token, revoked session, logout, reinstall, or account deletion invalidates/suppresses as policy requires.

Critical security notices may bypass ordinary marketing preference only under approved legal/product policy. Notification outage never rolls back signup, message, payment, entitlement, moderation, or other source operation.

## Privacy, security, and anti-abuse

Lock-screen, email, and SMS copy minimizes names, sexual/sensitive content, message text, report/enforcement, financial, identity, and creator private-content details. Protect addresses/device tokens; no secrets or raw object data in URL. Validate redirect allowlists and tokens. Rate limit by source/recipient/template/device and detect flooding or harassment.

User controls own permitted preferences across Web/Mobile. Admin template/config action is scoped/audited. Source domain cannot bypass suppression with a different template. Analytics receives minimized event/aggregate, not message body or provider credential.

## Phase and open decisions

V1 transactional notices. Phase 2 push expansion. Phase 3 consented growth campaigns. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: providers, channel defaults, transactional/marketing classification, quiet hours, frequency limits, template governance, deep-link/token strategy, retry/expiry, receipts, and country communication rules.

See [NOTIFICATIONS](../domains/notifications.md), [Consumer Mobile](../surfaces/02-consumer-mobile.md), [provider adapters](../architecture/06-provider-adapters.md), [privacy](../security/03-privacy-retention.md), and [outbound networking](../security/06-abuse-outbound-networking.md).
