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

## Implemented delivery path

The V1 path is `source transaction -> outbox row -> relay -> notification intent -> claim with safety recheck -> provider -> attempt record`. Stored states are `queued`, `attempted`, `delivered`, `suppressed`, and `dead_letter`; `requested` and `evaluated` are not stored because evaluation happens in the transaction that records the intent, and a failed attempt is recorded on its own attempt row rather than overwriting intent state.

Every transition is a compare-and-set under a lease, so two workers holding the same notice in mind — one whose lease expired mid-flight and one that has since claimed it — produce exactly one writer. The provider idempotency key is the intent identifier and is stable across every attempt, so a provider that honours it collapses this side's at-least-once retries into one send.

Suppression is decided inside the claiming transaction, before any external call, and is asserted by integration tests against real PostgreSQL: a blocked pair, a restricted recipient, and an expired notice each reach the channel adapter zero times. See [NOTIFICATIONS](../domains/notifications.md) for the durability and recheck guarantees in full, including the one window that cannot be closed.

## Implemented preference evaluation

`GET /v1/notifications/preferences` returns the effective decision for every category and channel with an approved template; `POST` to the same path records one and answers with the whole set, so a client never merges a response into local state. The recipient is the authenticated principal and is never read from the body, so no field in either request can address somebody else.

The update is a `POST` rather than a `PUT` because this API publishes no `PATCH`, `PUT`, or `DELETE` route anywhere: every operator and consumer command is explicit, and a generic update is a shape that can rewrite a record wholesale. An integration test asserts that property across every registered route.

A pairing with no template is refused rather than stored, and a mandatory category is refused by the service and again by the table's own CHECK. See [NOTIFICATIONS](../domains/notifications.md) for why that rule is stored rather than only enforced.

## Implemented in-app delivery

The in-app list is the only place a V1 notice is actually seen, because no external provider is approved. It is served from `notifications_feed`, written in the same transaction as the delivery intent, and read through `GET /v1/notifications`.

Eligibility is asked on every read rather than frozen into the row, so a block takes effect on the next page load and a withdrawn one restores what it hid. That is possible here and impossible for external delivery, and the difference is the reason the two are stored separately: a read has no side effect to recall.

Nothing about external delivery reaches this surface. `docs/domains/notifications.md` lists what is excluded and why.
