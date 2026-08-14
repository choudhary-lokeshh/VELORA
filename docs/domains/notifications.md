# NOTIFICATIONS domain

## Purpose and scope

NOTIFICATIONS owns consent-aware notification preferences, channel selection, templates, delivery attempts, provider receipts, and suppression. It does not decide product eligibility, author message/call/content state, or own SMS/Email credential policy outside its delivery contract.

## Flow and transitions

Source domain emits minimized notification request/fact through the transactional outbox. NOTIFICATIONS evaluates recipient preference, consent, safety/quiet-hour/country rules and channel capability; then schedules durable BullMQ work from authoritative PostgreSQL intent and records `queued -> attempted -> delivered/failed/suppressed`. Provider receipt updates attempt idempotently. Queue completion does not define notification truth. Critical security notices use defined policy and may bypass ordinary marketing preferences only where lawful.

## Failure/security/concurrency

Notification failure never rolls back source action. Deduplicate by source event/recipient/template window; retries safe only with provider idempotency/reference. Do not put sensitive, sexual, payment, or report detail in lock-screen/email/SMS body by default. Validate templates, rate-limit, prevent notification flooding, and protect device tokens/addresses as private data.

## Permissions/data/phase

User manages own preferences. Source domain may request only its approved versioned template/event. Admin template/config actions are scoped/audited. V1 transactional notices; Phase 2 push expansion; Phase 3 growth campaigns only with consent. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: channel provider, default preferences, quiet hours, legal messaging policy. See [notification flow](../flows/notification-delivery.md), [provider adapters](../architecture/06-provider-adapters.md), [jobs/events ADR](../decisions/ADR-0007-cache-jobs-events.md), [privacy](../security/03-privacy-retention.md).

## Implemented V1 notifications

`0012_notifications_outbox` adds `messaging_outbox`, `notifications_intents`, and `notifications_attempts`. The outbox sits inside `messaging_` because a published fact must commit with the row it describes, and only the owning domain's transaction can do that; NOTIFICATIONS never reads it. Cross-domain references — recipient, subject, source event — are stable identifiers with no foreign key, on the rule [data ownership](../architecture/05-data-ownership.md) records.

### A committed business event cannot lose its notification

The obligation is durable at every instant between the business write and the send, and no step depends on a process staying alive.

1. **Fact and business state commit together.** `MessagingService.sendMessage` appends `messaging.message.sent.v1` to `messaging_outbox` inside the same transaction that writes the message. An enqueue placed after the commit would be lost by a process killed between the two; a row written by the same transaction cannot be.
2. **The relay claims by lease, not by memory.** `OutboxRelay` claims rows with `for update skip locked`, writes a lease, and settles the outcome as a state transition. A relay killed mid-dispatch releases its rows by lease expiry, and the next cycle claims them again.
3. **The handoff is database-to-database.** The relay marks a fact dispatched only after `notifications_intents` holds the notice. Kill the worker anywhere in that sequence and the fact is still `pending`; the redelivery is absorbed by the unique index over source event, recipient, and template, so it produces one notice rather than a second.
4. **Delivery claims the same way.** A worker killed holding a claim leaves an `attempted` row whose lease lapses, and the sweep reclaims it. The attempt is counted at claim time, before the provider call, so a notice that crashes every worker retires instead of being retried forever.
5. **Nothing is deleted.** Retirement is the `dead_letter` state on a row that keeps its payload, and it is logged at error level. A notice the platform owed and did not deliver stays visible and repairable.

BullMQ carries a wake-up and nothing else. The delivery job payload is one identifier, its handler re-reads PostgreSQL, and the sweep delivers from the same rows — so a queue that loses every job costs latency rather than a notice.

### Safety is re-read immediately before external delivery

A notice is queued because something happened and delivered because the recipient may still be told, and those are different moments. Between them the recipient can block the subject, or the account can be restricted. Both are re-read at claim time through published contracts — TRUST & SAFETY's eligibility answer and USERS' account standing — never from a verdict taken at queue time and never from a copy this domain keeps.

The claim takes the pair lock first, then the intent row lock, then the recheck, then the claim write, all in one transaction and in the lock order [`src/database/pair-lock.ts`](../../apps/api/src/database/pair-lock.ts) requires. A block committing concurrently therefore either precedes the recheck — and the notice is suppressed — or waits for it. The provider call happens after that transaction commits, never inside it, because holding a row lock across somebody else's network is not acceptable.

That leaves one window, stated plainly: a block committing after the claim commits and before the provider call returns. No arrangement of this code closes it, because the send is already in flight. It is bounded by one provider call, and every notice still queued for that pair is suppressed on its own next claim.

Suppression reasons — `safety_block`, `recipient_not_deliverable`, `expired` — are operator-facing and are never returned to a recipient. Telling somebody a notice was suppressed for a block would disclose another person's safety decision.

### What is minimized

The published fact carries no message body, display name, or preview, and the stored notice carries only the conversation identifier. A field that never leaves MESSAGING cannot be rendered onto a lock screen by a later template change. Templates are keyed by source event and bound to one producer, so a source domain cannot reach a template whose safety rules are weaker than its own facts are subject to.

### What blocks production

- **No delivery provider is approved.** Email, push, and SMS are all pending in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md). `NOTIFICATIONS_DELIVERY_CHANNEL` defaults to `unavailable` and configuration refuses anything else in staging and production. `unavailable` reports that no attempt was made: it spends no attempt budget, records no attempt row, and leaves the notice owed, so an approved provider can be switched on without a backlog having quietly expired.
- **Preferences, quiet hours, and marketing classification are undecided.** The evaluation point exists in intake; the policy that will sit in it does not. V1 sends only transactional notices, which those rules would not suppress.
- **Retention is undecided.** Nothing here expires and no correctness rule depends on a row being physically deleted, so an approved duration can be applied as a deletion pass without changing behaviour.

## In-app notifications, and the second V1 event

`0013_notifications_feed_discovery_outbox` adds `notifications_feed` and `discovery_outbox`.

### The in-app surface is separate from external delivery

`notifications_feed` is a NOTIFICATIONS-owned table written by the same transaction that writes the delivery intent, keyed the same way, so a relay redelivery produces neither a second notice nor a second line. It is a separate table because the two are different obligations. An intent is a promise to hand something to somebody else's network: it has a provider, a retry budget, a lease, and a terminal suppression, and once the request leaves there is no recalling it. A feed row is a promise to show something on a surface the platform controls: it is read on demand, so eligibility is evaluated at read time and there is no in-flight window to lose a safety decision in.

Two consequences follow, and both are deliberate. The in-app surface works in every environment, including the ones where no delivery provider is approved — which is all of them today. And a notice about somebody the reader may no longer interact with is *filtered* rather than suppressed: the row is never deleted, the filter asks TRUST & SAFETY on every read, and a withdrawn block restores what it had been hiding. External delivery cannot behave that way, because a send cannot be un-sent.

`GET /v1/notifications` and `POST /v1/notifications/read` are the whole consumer surface. Nothing about external delivery is published through them — no lease, no attempt count, no provider reference, no failure reason, and above all no suppression reason, because `safety_block` would disclose another person's decision. Acknowledgement is monotonic and reports only the identifiers that were the caller's own, so it cannot be used to test whether a notification exists.

Reads are paged with a keyset cursor over immutable values, and the safety filter refills a page a bounded number of times before returning it short with its cursor. A short page with a cursor never means "no more".

### Notification event coverage

Two events are approved, and that is the complete list of V1 business transitions judged to warrant telling somebody:

| Event | Producer | Recipient | Why |
| --- | --- | --- | --- |
| `messaging.message.sent.v1` | MESSAGING | the participant who did not send it | Somebody wrote to them, and they cannot know without being told. |
| `discovery.introduction.mutual.v1` | DISCOVERY | the person who signalled first | The other side signalled back. The responder already has the introduction in the response to their own request, so only the initiator is told. |

Everything else was evaluated and rejected. A pass, a suppression, and a block are silent by design — telling anybody would disclose another person's decision. A report acknowledgement is the response to the reporter's own request. A profile, availability, or media change is the recipient's own action. Enforcement notices are a legal-policy decision that is not approved.

`discovery_outbox` follows the same ownership rule as `messaging_outbox`: the fact that an introduction became mutual is appended by the transaction that makes the transition, under the pair lock it already holds. One relay drains both, and it hands facts to consumers rather than granting anybody access to a source table.
