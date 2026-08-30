# Operational / observability readiness audit

- Audit date: 2026-08-31
- Scope: API errors, structured logging, background jobs, worker behaviour, provider failures, queue health, health checks, startup failure

## The result, stated first

One silent important failure was found, in the three places where it mattered most, and it is fixed. Everything else the phase asked for was already in place.

## Fixed: three drains retired work permanently and said nothing

Three loops in this platform claim rows, attempt an external effect, and retire what has failed too often:

- the **outbox relay**, which turns every committed domain fact into a delivered notification;
- the **billing provider-event drain**, which applies a payment provider's verified confirmations;
- the **identity provider-event drain**, which applies assurance results.

Each returns a cycle report carrying `deadLettered`. Nothing read it. The worker's other pollers all inspect their reports and choose a level — identity reconciliation warns when anything is outstanding, financial reconciliation warns when anything failed, the RTC drain logs an error when obligations are abandoned — but these three were composed as `cycle: async () => admit(async () => drain())`, discarding the result.

The gap was specific rather than general, which is why it survived. `Poller` does log a cycle that **throws**. A dead letter does not throw: it is the ordinary, documented outcome of a row that has used up a bounded retry budget. So the most consequential thing these loops can produce was the only thing they did in silence.

Concretely, before this change: a domain fact committed and never delivered anywhere; a settled payment's confirmation from the provider never applied; an assurance result never recorded — each retired after eight attempts, each needing an operator, and none of them visible anywhere.

`reportDrainCycle` now decides the level, because the level is the whole decision — an operator filters on it, and a permanent loss logged at `info` is a permanent loss nobody reads:

- **silence** when the cycle claimed nothing, which is the ordinary case and would otherwise be a line every few seconds saying nothing happened;
- **`warn`** when something was deferred, which is usually a provider having a moment and usually resolves itself;
- **`error`** when something was retired, because that is permanent and nothing else in the platform is watching for it.

Counts only, never an identifier. What an operator needs is how much is stuck and whether it is falling; whose payment it was belongs to the audit trail rather than to a line a wider audience reads. Five unit tests hold the branch, including that a dead letter alongside a retry still decides the level, and that the fields are exactly the four counts and no fifth.

## What was verified and already held

**No other silent failure.** Every `catch` in the API was examined. Exactly one swallows without a statement, and it is a documented optimistic-concurrency retry — the media position was taken between the read and the insert, so the loop looks again. There is no other place where the API discards a failure.

**Retries are bounded and intentional.** Eight attempts, deterministic capped exponential backoff to five minutes, a sixty-second lease, and a dead letter at the ceiling. The absence of jitter is reasoned rather than overlooked: `skip locked` already spreads a handful of relays apart, and a reproducible schedule is worth more than thundering-herd protection for a fleet that does not exist.

**Logs are useful without exposing secrets.** Redaction is asserted at root, nested, and deeply nested depths. A startup or shutdown failure writes its message to stderr through `redactEmbeddedUrls`, so a connection string in an error does not become the first line of a crash log.

**Errors carry a reference and nothing else.** One stable code, a correlation id, and a generic message; nothing about state, policy, or another person.

**Health is per-dependency.** Liveness is separate from readiness, and readiness reports PostgreSQL, ephemeral Redis and queue Redis individually as up or down, answering 503 when any is down rather than a single opaque boolean.

**Queue health is bounded and honest.** The operator console reports owed work with the age of its oldest member and the alert threshold the *owning domain* derives from its own sweep deadlines — so the console cannot invent a severity, and forty items owed for forty-five seconds does not read like one owed for a day.

**No observability vendor was integrated.** OpenTelemetry spans and structured logging already exist under ADR-0013; nothing here adds a provider, because none is approved.

## Cross-references

[Financial correctness audit](28-financial-correctness-audit.md),
[Security correctness audit](27-security-correctness-audit.md),
[ADR-0013](../decisions/ADR-0013-observability-testing.md),
[ADR-0007](../decisions/ADR-0007-cache-jobs-events.md), and
[scale and resilience](07-scale-and-resilience.md).
