# ADR-0026: Production notification delivery platform

- Decision date: 2026-08-22
- ADR status: Accepted

## Context

NOTIFICATIONS already owns a durable delivery obligation, an append-only attempt history, an in-app feed, an outbox intake, and one provider-neutral channel port. What it does not own is everything that stands between "a notice is owed" and "a person's device or mailbox actually took it": whether the recipient wants this class of notice, whether the destination is still deliverable, which device is still real, and what a provider said afterwards.

Those are not one problem. A preference is a standing instruction; a bounce is an observation; a device token is a credential with its own lifetime; a provider callback is hostile input. Building them as one "delivery status" field is how a platform ends up retrying a hard-bounced address forever, resurrecting a token the provider retired, or letting a webhook invent a product event.

[Notification provider eligibility](../compliance/11-notification-provider-eligibility.md) records that no email or push provider is approved: four of six assessed email vendors prohibit the category outright, one is silent, one requires written guarantees nobody holds, and no push vendor's governing text could be both retrieved and cleared. Separately, there is no native build pipeline, so no push token can be issued at all. This ADR therefore decides architecture that must be complete and correct while sending nothing.

## Decision

### NOTIFICATIONS owns delivery; it does not own the facts, the identities, or the addresses

A product domain states that something happened and who it concerns. It does not choose a channel, a retry budget, a template, or whether its fact survives a block. AUTH and USERS own what a person's email address is and whether it is verified. TRUST & SAFETY owns whether two people may still interact.

NOTIFICATIONS owns the delivery obligation, the channel decision, the preference evaluation, the deliverability observation, the device registration, the attempt history, the provider adapter, and the callback record. It reads other domains through published contracts and writes nothing outside `notifications_`.

The consequence that matters: a bounce does not unverify an email address, and a disabled device does not sign anybody out. Those would be NOTIFICATIONS reaching into another domain's truth on the strength of a third party's opinion.

### A notification category, not a boolean, decides whether preference applies

Every template carries a category. A preference may silence some categories and not others, and which is which is policy rather than a per-template flag somebody can flip.

Mandatory categories exist because some notices are not offers. A security notice about a session or a credential, and a safety or legal notice the platform is obliged to deliver, are sent regardless of an optional-notification preference. Ordinary product notices are not, and a marketing category exists in the vocabulary so that nothing can quietly become transactional to escape consent — it is refused everywhere today, and no V1 template uses it.

Preference is one input among several. A notice is eligible only when the category permits it, the recipient has not silenced it, the destination exists and is not suppressed, the account is in a state that receives notices, and the pair eligibility the template requires still holds. Any one of those failing suppresses rather than retries, with a reason recorded for operators and never shown to the recipient.

### A destination is a deliverability observation, and it is not an identity

NOTIFICATIONS records what happened when it tried to reach an address or a device: delivered, soft-bounced, hard-bounced, complained, refused, suppressed. It does not record what the address is, whether it is verified, or who owns it.

A destination is keyed by a generation so that changing an address retires every observation attached to the old one. Suppression follows the destination, not the person: a person who corrects a typo in their address is not carrying a hard bounce forward, and a person who re-adds a previously complained address does not silently clear the complaint.

A hard bounce and a complaint are terminal for that destination generation. A soft bounce is not; it is a retryable transport failure with a bound. This distinction is the whole reason failure classification is a normalized enum owned by the adapter rather than a provider error string stored raw.

### A push token is a credential, never an identity

A device registration binds a token to the principal that was authenticated when it registered, and to a generation. The token is a bearer credential for reaching a device, and it says nothing about who is holding the device now.

Three consequences are decided here. Registering a token that another principal already registered retires the older registration rather than sharing it, because the alternative is delivering one person's notice to another person's phone. Signing out retires the registration, because the next person to open that app must not receive the previous one's notices. And a provider that reports a token invalid disables that registration permanently rather than deferring it, because a token the provider has retired cannot be resurrected by a retry that was already in flight.

The token itself is stored so that it can be sent and so that a duplicate can be recognised, and it is never logged, never returned by any read surface, never used as a metrics label, and never exposed to Admin.

### Provider callbacks are verified observations that never create product facts

This is the same rule [ADR-0025](ADR-0025-rtc-live-communications-architecture.md) applies to RTC provider events, for the same reason. A callback may be forged, duplicated, delayed, reordered, replayed, or never arrive.

A callback is authenticated against the exact bytes received before it is parsed, bounded in size, checked against the environment and account it claims, and recorded in a durable inbox keyed by the provider's own event identifier so a replay is a no-op. Only then may it update a delivery observation.

What a callback may never do: create a notification, change a product fact, mark something delivered that was never attempted, or lift a suppression. A provider reporting success for a notice this platform has no attempt record for is a discrepancy to record and investigate, not an instruction to obey.

### Retry is decided by a normalized failure class, not by a transport error

The adapter converts whatever a provider said into one of a fixed set of classes: retryable transport failure, provider throttle, soft bounce, hard bounce, invalid token, permanent policy refusal, or suppressed destination. Only the first two consume a retry with backoff. The rest are terminal, and terminal means the row is retained as evidence, never deleted.

A notice that exhausts its budget becomes dead-lettered rather than disappearing. "Why did this person never hear about this" must be answerable from stored rows, which is why suppressions and failures are attempt records rather than overwritten state.

### Reconciliation compares durable state against the provider, outside every transaction

Provider state drifts from local state whenever a callback is lost, a send times out ambiguously, or a token is retired without a signal. A bounded, idempotent, multi-worker-safe sweep detects the classes of drift that are detectable — a notice pending far too long, an attempt with no provider reference, an invalid token never applied, a callback stuck in the inbox — and corrects them.

It never manufactures success. A discrepancy it cannot resolve is surfaced to operators rather than closed.

### Configuration is fail-closed, and the test adapter cannot exist in a deployed environment

`NOTIFICATIONS_DELIVERY_CHANNEL` already refuses anything but `unavailable` in staging and production. Any per-channel configuration this platform adds follows the same rule: the refusing value is the default, the development adapter is rejected outside local and test by the configuration loader rather than by a runtime check, and no route, header, query parameter, or request field selects an adapter.

`unavailable` is not a failure. It reports that no attempt was made, spends no attempt budget, writes no attempt row, and leaves the notice owed.

### Minimization is a property of the stored payload, not a convention in a template

The payload stored on an intent carries a deep-link target and the identifiers needed to route it. It does not carry a message body, a display name, a preview, a report narrative, identity evidence, or private club content — because a field that is never stored cannot be rendered onto a lock screen by a later template change, and cannot leak through a provider's logs.

Deep links resolve server-authoritatively after the application opens. The payload names what to open; the server decides whether this principal may still see it, at the moment they ask.

## Consequences

The platform gains a preference authority, a destination and suppression lifecycle, a device registry, a callback inbox, a retry classifier, and a reconciliation sweep — all of which are exercisable locally through test adapters and none of which can send anything in a deployed environment.

Operators gain answers they cannot get today: why a notice was not delivered, which destinations are suppressed and why, how deep the callback backlog is, and where local and provider state disagree.

The cost is a larger surface with more tables and more sweeps, for a capability that delivers nothing until a provider is approved and a native build pipeline exists. That cost is accepted because the alternative is writing this under time pressure on the day a provider is signed, which is when getting suppression or token identity wrong would reach real people.

## Rejected alternatives

- **One delivery status field per notice.** Cannot express "the provider accepted it and the mailbox rejected it later", which is the normal case for email.
- **Storing the provider's error text and branching on it.** Couples retry policy to vendor strings, which change without notice and differ per vendor.
- **Treating a device token as the identity of a recipient.** The failure mode is delivering a private notice to whoever holds the device now.
- **Letting a callback create or complete a notification.** Makes an unauthenticated third party a source of product truth, and makes a replay a way to fabricate delivery.
- **Suppressing by person rather than by destination.** Punishes a corrected typo forever and silently clears a complaint on re-adding an address.
- **Enabling a silent vendor because nothing forbids it.** Silence is not permission; the register says so and this ADR does not reopen it.
- **Building push against Expo's relay to get something working.** It inherits both unresolved vendor answers, adds a third party to the payload path, and still cannot issue a token without a native build.

## Unresolved decisions

Provider selection for email and push, and the written vendor answers the [eligibility register](../compliance/11-notification-provider-eligibility.md) requires. The native build pipeline that would make push registration possible at all. Quiet hours, frequency caps, and the exact legal classification of which notices are mandatory. Notification and attempt retention durations. Whether SMS is ever in scope. All are recorded in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).

## Cross-references

- [NOTIFICATIONS](../domains/notifications.md) and [notification delivery flow](../flows/notification-delivery.md): the domain and flow this ADR extends.
- [Notification provider eligibility](../compliance/11-notification-provider-eligibility.md): why nothing is switched on.
- [ADR-0025](ADR-0025-rtc-live-communications-architecture.md): the provider-event rule this reuses.
- [ADR-0014](ADR-0014-deployment-environments-cicd.md): typed configuration and the secret boundary.
- [Configuration and environments](../engineering/07-configuration-environments.md): the fail-closed seam and its documented default.
- [Privacy and retention](../security/03-privacy-retention.md) and [abuse and outbound networking](../security/06-abuse-outbound-networking.md).
