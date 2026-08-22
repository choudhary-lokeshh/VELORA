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

- **No delivery provider is approved.** [Notification provider eligibility](../compliance/11-notification-provider-eligibility.md) records why, from each vendor's own current text: four of six assessed email vendors prohibit this business category outright, one is silent, and one will only consider it against written guarantees nobody holds. No push vendor's governing text could be both retrieved and cleared, and separately there is no native build pipeline, so no device token can be issued at all. `NOTIFICATIONS_DELIVERY_CHANNEL` defaults to `unavailable` and configuration refuses anything else in staging and production. `unavailable` reports that no attempt was made: it spends no attempt budget, records no attempt row, and leaves the notice owed, so an approved provider can be switched on without a backlog having quietly expired.
- **Quiet hours, frequency caps, and the legal classification of mandatory notices are undecided.** [ADR-0026](../decisions/ADR-0026-notification-delivery-platform.md) decides the preference architecture — categories, with mandatory classes a preference cannot silence — and V1 sends only transactional notices, which those rules would not suppress. What remains open is the policy content rather than where it evaluates.
- **Retention is undecided.** Nothing here expires and no correctness rule depends on a row being physically deleted, so an approved duration can be applied as a deletion pass without changing behaviour.

## Preferences, and the categories that are not offers

A notice carries a category, and the category decides whether a preference may silence it. That is a different question from what the notice is about, and a single "notifications enabled" flag cannot answer it: either somebody can silence a notice about their own account security, or they can silence nothing.

`account_security` and `safety_legal` are mandatory. No V1 template uses either — the platform sends no security or legal notice yet — and the vocabulary exists ahead of the templates because the constraint has to be in place before the first one is written. `direct_message`, `introduction`, and `call` are the three V1 categories, all optional, all on the push channel. `marketing` exists so a promotional notice cannot be reclassified as transactional to escape a consent decision nobody has taken; no template carries it and it defaults to off.

The rule that a mandatory category cannot be silenced is a CHECK constraint on `notifications_preferences`, not a branch in a service. Expressed only in code it would survive exactly until a second write path forgot it, and it would then fail silently and in the direction nobody notices: a person stops being told about their own account. The service refuses it too, so there are two defences for one rule.

Absence of a row means "never asked", not "off". The default for a category is applied in policy rather than written into rows, so changing a default does not require rewriting decisions nobody made. The read surface returns the *effective* answer for every category and channel the platform has an approved template for — derived from the catalogue, so a switch cannot outlive the template it governs, and a control that does nothing is never offered.

Preference is evaluated inside the claiming transaction, last. The platform's own obligations settle first: whether the notice is still current, whether this account may be contacted at all, and whether these two people may still interact. Only then is the person's choice consulted. The ordering decides which reason an operator sees when more than one applies, and a block is the more consequential fact — recording `recipient_opted_out` over a block would hide the block.

A push preference is a decision about being interrupted, not about being told. An opted-out notice is still written to the in-app feed and still appears when the person opens the app; what does not happen is the external send.

## Delivery needs somewhere to arrive

A notice is aimed at a destination, and the destination is resolved inside the claiming transaction rather than remembered from when the notice was created. A device registered last week may have been retired since, and a notice aimed at a retired registration is one nobody receives.

A recipient with no destination is a suppression — `destination_unavailable` — and not a failure. Nothing was wrong and nobody was asked, so no attempt budget is spent. It is also what stops the delivered path from lying: before this, the development channel reported success for a recipient with no registered device at all, which is a report that somebody was reached who had nothing to reach.

Every live device is handed to the adapter in one request. Fan-out across devices is the adapter's business; the obligation is still one thing the platform owes one person, with one intent, one retry budget, and one attempt history. What crosses that seam is a device reference and a platform — never a token and never a fingerprint.

Email and SMS resolve to no destination for anybody, and that is a statement about the platform rather than about any recipient. **No domain stores an email address.** `auth_identities` holds an opaque provider subject, and AUTH's recovery port takes a destination as a parameter without keeping one. That gap blocks the email channel more completely than the absence of an approved provider does: an approved vendor would still have nowhere to send. It is recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), and it belongs to AUTH rather than here — NOTIFICATIONS observes deliverability and never owns an identity.

## Push device registration, and why a token is not an identity

A push token is a bearer credential for reaching a device. Whoever is holding that device receives whatever is sent to it, which makes every rule here a rule about the device rather than about the person.

`notifications_push_devices` binds a token to the principal that was authenticated when it registered, to an installation the client names, and to nothing else. Three things follow, and each is enforced by a partial unique index rather than by a service remembering to check.

One live registration per token, across the platform. Registering a token another account holds retires that account's registration in the same transaction, because two live registrations for one token is one person's notice arriving on another person's phone. One live registration per installation per person, so a device that rotates its token replaces its own row instead of accumulating a second one that would double every notice. And a registration is never re-enabled: whatever retires it, the device registers again and gets a new row, because a fresh registration is the only evidence this side can have that the device still holds the token.

**The token itself is not stored.** Only a SHA-256 fingerprint of it is, which is enough to recognise the same token arriving again and enough to name a device in a log without naming a credential. No response echoes a token or a fingerprint; the caller already has its own token, and returning one would put a bearer credential into a response body, a log, and a proxy cache for no purpose. The column that would hold a sendable token lands with the provider that needs it, not before — no push provider is approved and there is no native build pipeline to issue a token at all, so a stored credential today is one nothing could spend.

Registration is serialized by two transaction-scoped advisory locks, on the token and on the installation, taken in sorted order. All three of its decisions are about the *absence* of a row, which has nothing to lock, and fifty concurrent registrations of one token demonstrated the gap before the locks were added: some of them lost the insert race on the partial unique index and failed rather than settling on the row that won. Two locks rather than one because two different uniqueness rules are being protected, and sorted because two transactions needing both must ask in the same order.

Revocation is scoped to the caller's own principal and succeeds silently when nothing is registered, so it cannot be used to discover whether an installation identifier exists.

## Provider feedback, and what a verified event is allowed to change

A delivery provider will eventually report what happened to a notice it carried. `notifications_provider_events` is where that arrives and stops being trusted, and it is deliberately the same shape REALTIME uses for its provider events, because it is the same problem: an unauthenticated party asserting facts about work this platform asked for.

**Bytes authenticate before anything parses them.** A signature covers the exact octets that arrived, so verification happens against those and never against a re-serialized object — a body checked after a round trip through JSON authenticates a different document than the one that was signed. Nothing unverified reaches the parser, and an unverifiable request creates no row at all. A bad signature, a mutated body, an unknown event type, and an unparseable payload all get one answer, because telling them apart would tell a forger which part to fix next.

**The body is discarded.** What survives is a digest of the exact bytes and a normalized type in this domain's vocabulary. A retained webhook body is where an address, a device token, or a fragment of somebody's message arrives and stays, and there is nothing a later investigation can ask that the digest and the normalized fields cannot answer.

**Duplication is free and expected.** Identity is the provider, its account, its environment, and the provider's own event identifier together, so the fiftieth delivery of one event costs one refused insert. Including the account and environment is what stops a sandbox event from ever being mistaken for a production one.

**A verified event is an observation, never an instruction.** It may update what this platform knows about a delivery. It may not create a notice, mark delivered something that was never attempted, lift a suppression, or bring back a retired device registration. The endpoint answers `202` rather than `200` for the same reason: the event is recorded, not applied. Applying happens on a worker against a lease, so a provider's retry budget is never spent waiting for work this platform chose to do later.

Today one feedback type has an effect with teeth. `token_invalid` retires every live registration holding that fingerprint, across every account, because a token the provider has retired is one nobody can be reached on — and it is safe in the direction that matters, since the worst case is a device that registers again on next launch. `delivered`, `deferred`, `bounced`, and `complained` are all statements about an email destination, and no domain stores an email address, so they are recorded and applied to nothing. Inventing somewhere to put them would be building against a channel that cannot exist.

An event naming something this platform has no record of is neither an error nor a reason to retry. A provider may report about a device that was never registered here, and the honest response is to record that it did not match rather than to keep asking or to invent the missing row.

## What an operator may see, and what they may not do

The operational read lives in NOTIFICATIONS rather than in ADMIN, on the rule MEDIA's and REALTIME's views already follow: nothing outside this domain queries a `notifications_` table, and an operator genuinely needs the technical lifecycle, so the query belongs where the rule is.

The state screen is counts, ages, and the adapter name, and **carries no identifier of any kind** — not a notice, not an account, not a device. A screen an operator watches all day must not become a window onto who is being told about whom, and one person being notified about another is not an operational fact. Every declared state appears every time, including the zeroes, because a list that omitted the healthy states could not tell an operator "nothing is stuck" apart from "the signal stopped arriving".

There is **no list and no search**. An operator able to page through notices has a browsing surface over who contacts whom, which is not an operations tool however it is labelled. The detail route answers about one delivery whose identifier the operator already holds from a report or a reconciliation finding, and it carries no recipient, no subject, and no payload: the question is why a notice did not go, and none of those three answer it. It reports that a worker holds a notice without naming which, because an operator cannot act on a process identifier.

The failure row is the one that earns its place. Failures grouped by the class that decided what happened next separate an outage on this side from a problem with a destination: a wall of `transport` is an outage, a wall of `hard_bounce` is a list problem, and a wall of `invalid_token` is a fleet of devices that should have been retired and were not.

There is **no action** at all: no retrying a notice, no suppressing a destination, no clearing a dead letter. Each of those has consequences for a person — a retry sends somebody a message, a suppression stops one arriving — and none has an approved authority, an audit record, or a reason vocabulary yet. An operator button would be that power with none of those. What will not deliver is reconciliation's problem and is surfaced as a number to be alerted on rather than a button to be pressed; adding one is a decision in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), not an implementation detail.

The adapter is reported from what the process actually composed rather than from the configuration meant to select it. A screen naming the configured adapter while the process runs another is exactly the lie an operations screen exists to prevent.

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
