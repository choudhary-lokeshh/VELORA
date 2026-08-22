# Notifications delivery freeze report

What the production notification delivery platform froze with, what still blocks a real send, and what unfreezes it. Companion to the [media](13-media-freeze-report.md), [identity](14-identity-freeze-report.md), and [RTC](16-rtc-freeze-report.md) reports, written to the same rule: architecture that is finished is described as finished, and a capability that cannot run says so in its own words.

## What the core owns

NOTIFICATIONS owns the delivery obligation, the channel decision, preference evaluation, destination resolution, the attempt history, the provider adapter, the verified callback record, and the operational read. It does not own the facts it delivers, the addresses it delivers to, or the identities it delivers about. A product domain states that something happened; AUTH and USERS own who somebody is; TRUST & SAFETY owns whether two people may still interact. This domain writes nothing outside `notifications_` and reads every other domain through a published contract.

The consequence worth naming: a bounce does not unverify an email address, and a disabled device does not sign anybody out. Both would be this domain reaching into another's truth on the strength of a third party's opinion.

## What was already there, and was not rebuilt

The durable intent, the append-only attempt history, the in-app feed, outbox materialization, the lease-and-claim delivery worker with its delivery-time safety recheck, and the consumer feed contract all predate this work. They were extended, never replaced. No second outbox was created, no second notification table, and no competing event bus.

## What this work added

| Concern | What landed |
| --- | --- |
| Failure classification | Seven normalized classes; retry reads the class and never a vendor error string. Three are retryable; four are terminal on first occurrence whatever the budget says |
| Preferences | Category-driven, with mandatory classes a preference cannot silence — enforced by a CHECK constraint, not only by a service |
| Push devices | Server-authoritative registration, one live registration per token platform-wide and per installation per person, never re-enabled, token fingerprinted and discarded |
| Destinations | Resolved inside the claiming transaction; no destination is a suppression, not a delivery |
| Provider feedback | Verified callback inbox keyed by provider, account, environment, and the provider's own event identifier; body discarded, digest retained |
| Operations | Counts, ages, and adapter name with no identifier of any kind; one delivery detail with no recipient, subject, or payload |
| Evidence | 25 schema-level red-team attacks and 7 query-plan assertions at roughly thousand-to-one live-to-dead disparity |

Five migrations, `0061` through `0065`. Four new tables: `notifications_preferences`, `notifications_push_devices`, `notifications_provider_events`, plus new columns and constraints on `notifications_attempts` and `notifications_intents`.

## The defect this work existed to find

Before it, the development channel reported `delivered` for a recipient with **no registered device at all**. Nothing was reached and the record said something was. It was possible because delivery had no concept of a destination: an intent named a recipient and a channel, and the adapter was handed neither an address nor a device. That is the exact shape of fake success a delivery platform cannot have, and closing it is the single most important thing here.

## Provider matrix

Retrieved 2026-08-22 from each vendor's own governing text. Full findings and quotations in [notification provider eligibility](../compliance/11-notification-provider-eligibility.md).

| Provider | Channel | Adult-business posture | Adapter | Production approved | Production enabled |
| --- | --- | --- | --- | --- | --- |
| Amazon SES | Email | Silent — no clause either way | No | No | No |
| Postmark | Email | Prohibits "Pornography/sexually explicit content" and "Escort services" | No | No | No |
| Resend | Email | Same prohibition, plus sole-discretion removal | No | No | No |
| SendGrid | Email | Twilio Email Policy (eff. 2026-04-09) prohibits pornography and "other similar services" | No | No | No |
| Mailgun (Sinch) | Email | Silent on lawful adult; requires "sufficient and specific guarantees" | No | No | No |
| SparkPost (Bird) | Email | Prohibits "obscene, offensive… or pornographic" | No | No | No |
| Apple APNs | Push | APNs-specific attachment not retrievable | No | No | No |
| Firebase Cloud Messaging | Push | Google Cloud AUP not retrievable | No | No | No |
| Expo Push Service | Push | Incorporated policy not in the Terms; relays to both of the above | No | No | No |

Four of six assessed email vendors prohibit the category in their own words. One is silent, which is the absence of an answer rather than permission. One will consider it against written guarantees nobody holds. No push vendor's governing text could be both retrieved and cleared.

## Privacy

| Question | Answer |
| --- | --- |
| Full device token logged | **No** — never logged, and never stored either; only a SHA-256 fingerprint is kept |
| Full email body logged | **No** — no email body exists anywhere; no email template is defined |
| Private message body in push | **No** — the stored payload is a deep-link target; no body, name, or preview is ever written |
| Safety report content in push | **No** — no safety template exists, and no report field enters this domain |
| Provider secret exposed | **No** — no provider secret exists; the local-test signing secret is a public constant refused outside local and test |
| User email in metrics | **No** — no address exists to emit; the operations screen carries no identifier at all |
| Client-authoritative delivery state | **No** — no consumer route can write, read, or infer delivery state |
| Webhook body retained | **No** — a digest of the authenticated bytes only |
| Suppression reason published | **No** — the consumer contract has no field for one, asserted by test |

## Security

Recipient isolation is enforced by the pair and subject constraints and by every read being scoped to the authenticated principal; no route takes a recipient from a request body. Preference enforcement is evaluated inside the claiming transaction, after the platform's own obligations and before any send. Mandatory categories cannot be stored as disabled. Callback authentication runs against exact raw bytes before parsing, with one uniform rejection for a bad signature, a mutated body, an unknown type, and an unparseable payload. Replay is a refused insert. A retired device is never resurrected, including by hand. Admin requires the Platform Admin audience and a fresh phishing-resistant assurance that no approved verifier can produce, so the operations surface is reachable by nobody. The test adapter is refused outside local and test by the configuration loader rather than by a runtime check.

## Database and scale

Five migrations, expand-safe, with the one that adds a constraint to a populated table carrying its own backfill. Partial indexes on every live-state hot path, because each is a small live set inside a history that grows without bound. Query plans asserted for the due-delivery query, the provider-event claim, live devices, token recognition, and feed paging from both the top and a cursor; the preference lookup is asserted against its primary key. No unbounded `OFFSET` on any hot path. Registration is serialized by two transaction-scoped advisory locks in sorted order, which fifty concurrent registrations of one token proved necessary.

## Tests

311 unit and 1348 integration, across 76 files. Notification-specific: the behaviour suite, a 25-attack schema red-team with positive controls in every refusal block, a 7-assertion query-plan suite, and the pre-existing RTC notification suite. Concurrency proved at ×50 for device registration and ×50 for callback redelivery.

## Git history

| SHA | Phase | Hosted run | Result |
| --- | --- | --- | --- |
| `d7c60e6` | Provider research, eligibility register, ADR-0026 | 32559527583 | success |
| `8594db7` | Failure classification | 32560500858 | success |
| `d2c22e7` | Preferences and eligibility | 32561871366 | success |
| `1eb41e2` | Push device lifecycle | 32564776782 | success |
| `e5f7623` | Destination resolution | 32567457612 | success |
| `35c70bd` | Verified provider feedback | 32568934095 | success |
| `7e55a7e` | Admin delivery operations | 32570430232 | success |
| `d359001` | Red-team | 32571919595 | success |
| `3feb6f3` | Query plans at volume | 32579915826 | cancelled by the next push |
| `5380fc8` | Correcting note for `3feb6f3` | 32580175673 | **failure** — see below |
| `8bc8c11` | This freeze report | — | superseded before push |
| `104676b` | Correct the concurrency assertion CI caught | 32581908114 | success |

**The hosted runner found a defect that eleven local runs did not.** The
fifty-concurrent-registration test asserted that all fifty answers were `200`.
That passed locally every time and failed on CI, because registration
serializes on an advisory lock over the token and database admission bounds how
many requests may be in flight, declining the rest with a retryable `503`
rather than holding them. Fifty simultaneous registrations of one token are a
convoy on that lock, so on a slower machine some reach the admission wait and
are refused — which is [ADR-0019](../decisions/ADR-0019-database-connection-admission.md)
working, not failing.

The test was asserting a throughput guarantee the platform deliberately
declines to make. It now asserts what the platform does promise: no answer is
an internal error, at least one registration succeeds, and concurrency cannot
produce a second live registration. The last is the one that matters, because a
duplicate there is one person's notice arriving on another person's phone. The
platform was never wrong; the test was.

Recorded accurately rather than flatteringly. `3feb6f3` needed three local gate attempts: the first failed on a Prettier check over a file `expo-doctor` rewrote mid-run, the second on a hygiene failure over a file `expo-cli` generated without a trailing newline, and only the third was clean. Its hosted run was then cancelled by the push of `5380fc8`, which is a strict superset of it. `3feb6f3` also carries an unrelated `VELORA_BIND_HOST` change that a `git add -A` swept in; `5380fc8` records what happened and why nothing was rewritten.

## The stability sequence, and what it found

The twenty-run sequence was invalidated at run 3, and what invalidated it was
not this vertical: five tests in `rtc-reconciliation.test.ts` failed together,
reporting that the reconciler examined zero obligations when one had just been
created.

The cause is a clock race, and it is the second time this repository has met
this class — `0f9f3b3` took paging stability off the container clock for the
same underlying reason. PostgreSQL's `now()` and the worker's clock are
different clocks: the database runs in a container whose clock measured roughly
twenty milliseconds *ahead* of the host's, and the reconciler claims what is due
against its own clock (`available_at <= input.now`). An obligation written at
the database's `now()` is therefore in the future by the reconciler's reckoning
for the first few tens of milliseconds of its life, and a discharge cycle inside
that window examines nothing.

It fails intermittently and, counter-intuitively, on the *fastest* runs: a fast
run leaves less wall time between the insert and the claim. The same five tests
had failed once earlier in this session and were attributed to the machine
having slept. That diagnosis was wrong, and the second occurrence — with no
sleep involved and on the fastest of three runs — is what disproved it.

The fix backdates the seeded obligation by a second, which dwarfs any plausible
skew and weakens nothing: those tests are about the claim and discharge cycle,
and the due-time boundary is covered on its own terms by
`leaves a deferred obligation alone until its backoff has passed`. No runtime
code changed, because no runtime code was wrong.

### The second attempt, and the second finding

The sequence was restarted on the fixed code and reached run 9 of 20 before a
single test failed: the fifty-concurrent registration returned a status that was
neither the registration nor an admission refusal. Eight runs of identical code
had been clean.

The cause was this suite's connection pool, not the runtime. `connectDatabase`
defaults to twenty connections and documents the failure mode precisely — a pool
that must queue a caller while it is also serving transactions can strand a
connection `idle in transaction` — and every other suite driving high
concurrency already asks for sixty. This one fires fifty simultaneous requests
in two places, registration and callback redelivery, on the default. The repo's
own note says such a suite "needs headroom above its own peak rather than a
smaller test", so the pool was raised rather than the concurrency lowered.

The assertion also reported only `false`, which cost a diagnostic cycle. It now
asserts the list of offending statuses, so the next failure names what arrived.

Three defects in this vertical's own test code have now been caught by running
it rather than by reading it: a throughput assumption that only fails on slow
machines, a clock race that only fails on fast ones, and a pool that only fails
under sustained repetition. None was a defect in the runtime.

### The sequence that held

Twenty consecutive complete integration suites on `8977ddc`, the tree that is
also hosted-CI green. No retries, no skips, no restarts inside the sequence.

| Run | Tests | Failures | Seconds |
| --- | --- | --- | --- |
| 1 | 1348 | 0 | 323 |
| 2 | 1348 | 0 | 319 |
| 3 | 1348 | 0 | 318 |
| 4 | 1348 | 0 | 327 |
| 5 | 1348 | 0 | 314 |
| 6 | 1348 | 0 | 412 |
| 7 | 1348 | 0 | 813 |
| 8 | 1348 | 0 | 564 |
| 9 | 1348 | 0 | 489 |
| 10 | 1348 | 0 | 451 |
| 11 | 1348 | 0 | 442 |
| 12 | 1348 | 0 | 390 |
| 13 | 1348 | 0 | 385 |
| 14 | 1348 | 0 | 387 |
| 15 | 1348 | 0 | 385 |
| 16 | 1348 | 0 | 382 |
| 17 | 1348 | 0 | 384 |
| 18 | 1348 | 0 | 381 |
| 19 | 1348 | 0 | 385 |
| 20 | 1348 | 0 | 382 |

26,960 tests, zero failures. The durations span 314 to 813
seconds — a 2.6× spread, because the machine was under varying load
throughout — which matters more than the count: the two timing-sensitive
defects this vertical found were each visible only at one end of that range,
one on fast runs and one on slow.

What this proves and what it does not is worth stating. Twenty passes on one
machine demonstrate stability against ordering, load, and the clock. They do not
demonstrate that a query plan chosen here is the plan a different planner
chooses, which is why the plan assertions seed a thousand-to-one disparity
rather than relying on repetition, and why the hosted runner is the authority
for anything a local run agrees with too easily.

## What is frozen

**PRODUCTION NOTIFICATIONS DELIVERY CORE: FROZEN.** The obligation model, failure classification, preference authority, device lifecycle, destination resolution, callback inbox, retry and dead-letter behaviour, operational read, and their evidence are complete and green.

## What is not built, and why

- **Email rendering and templates.** No email template exists, because no email destination can be resolved for anybody.
- **Consumer Mobile push integration.** No native build pipeline, so no token can be issued to register.
- **Creator Studio notification surface.** No creator notification event is product-authorized; inventing one to exercise the platform is exactly what the brief forbids.
- **Consumer Web preference controls.** The preference API and its contract exist; the surface does not.
- **Provider-drift reconciliation.** Comparing local state against provider state requires a provider to read from. The detectable local classes are surfaced as backlog ages and counts instead.
- **SMS.** Not implemented. The channel vocabulary exists so a template can name a channel; nothing uses it.

## Live delivery

**LIVE EMAIL DELIVERY: BLOCKED** — no approved provider (four of six assessed prohibit the business category, one is silent, one requires written guarantees nobody holds), and, independently and more fundamentally, **no domain stores an email address at all**, so an approved vendor would still have nowhere to send.

**LIVE MOBILE PUSH DELIVERY: BLOCKED** — no approved provider (no vendor's governing text was both retrievable and clear), and, independently, **no native build pipeline exists**, so no device token can be issued to register against.

**LIVE SMS DELIVERY: NOT IMPLEMENTED** — no product authority requires it.

## What unfreezes each

Email needs a written vendor answer naming VELORA's business, and an owning domain for a consumer email address with its verification and correction path — an AUTH architecture decision that is itself blocked on identity-provider approval. Push needs a written vendor answer and a native build pipeline that compiles, links, signs, and runs the app. Both then need callback key custody, retention durations, the legal classification of which notices are mandatory, and an operations owner. All are recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## Cross-references

- [NOTIFICATIONS](../domains/notifications.md) and [notification delivery flow](../flows/notification-delivery.md)
- [ADR-0026](../decisions/ADR-0026-notification-delivery-platform.md)
- [Notification provider eligibility](../compliance/11-notification-provider-eligibility.md)
- [Configuration and environments](../engineering/07-configuration-environments.md)
