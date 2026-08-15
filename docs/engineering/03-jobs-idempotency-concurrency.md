# Durable jobs, idempotency, and concurrency

## Purpose

Authoritative implementation pattern for retryable work: notifications, webhooks, media processing, payment reconciliation, retention, event delivery, AI generation/indexing/evaluation, and provider operations.

## Durable job flow

Owner transaction writes business state plus outbox/job intent. Worker claims with lease, executes bounded work, records attempt/correlation/provider reference, and transitions `queued -> running -> succeeded` or `retry_wait -> dead_letter`. Lease expiry permits safe recovery. Dead letter retains enough redacted context for repair and alerts; repair is audited.

Initial implementation uses PostgreSQL transactional outbox/inbox and BullMQ 5.81 through a logically isolated durable queue Redis responsibility under [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). Owner workflow tables remain authoritative for long waits/approvals. Ephemeral Redis and process memory are never critical job truth; queue Redis is persistent job infrastructure but still does not own business outcome. End-to-end effects are treated as at-least-once even when queue claim delivery is stronger.

The registry is bounded and contains only explicit versioned job names with attempt/backoff ceilings. Queue initialization and registration failures abort startup. Workers expose readiness only after queue Redis is reachable; runtime errors and failed jobs emit redacted diagnostics; shutdown stops intake and closes workers within a bounded timeout. Queue Redis requires private access, persistence, backup/restore, capacity/no-eviction policy, and recovery tests. Local AOF/RDB persistence is test evidence, not production policy.

## Idempotency rules

Public mutation accepts stable client idempotency key scoped to actor/action; same key + same canonical input returns same result, mismatched input is conflict. Provider operation has separate unique external reference. Consumer records processed event IDs. Do not use a timestamp-only key. Store outcome long enough for client/provider retry window defined by policy.

## Concurrency rules

Choose owner transaction, unique constraint, optimistic version, lease, or serialized queue per aggregate. Re-read policy/authorization at transition. Explicitly model races: duplicate submit, reciprocal introduction, block/send, refund/entitlement, payout/chargeback, deletion/retention, role revocation/operation. Do not rely on process memory locks across replicas.

AI jobs pin capability, prompt, schema, and approved route versions, but never pin reusable actor credentials. Re-authorize before sensitive context access, tool execution, approval resumption, or durable effect. A model retry may repeat generation but must not duplicate tool/domain effects; use separate run/step/tool idempotency identities.

## Security/phase/open questions

Workers use least privilege, redacted payloads, retry budgets and safe failed-job/DLQ access. Money and other high-impact handlers re-read PostgreSQL owner state, use stable idempotency identities, and reconcile ambiguous external effects; a BullMQ completed state is never authorization or business completion by itself. Queue/outbox/workflow baseline is locked. Each owner still defines retry windows and idempotency retention from client/provider/legal behavior. External broker or workflow engine is deferred until measured scale/complexity and requires an ADR. See [contracts/events](../architecture/04-contracts-events.md), [AI platform](../ai/01-ai-platform-architecture.md), [payment lifecycle](../flows/payment-lifecycle.md), [scale](../architecture/07-scale-and-resilience.md), [platform health](../operations/05-platform-health.md).

## Implemented relay and delivery worker

The first durable pipeline on this pattern is the notification path, and it is the reference implementation for the rest.

`src/events/outbox-table.ts` declares the outbox shape once and each producer owns an instance of it inside its own prefix, so a second producer inherits the lease, retry, and dead-letter behaviour rather than inventing a variant. `src/events/relay.ts` drains them: claim with `for update skip locked`, write a lease, hand the fact to registered consumers, then record `dispatched` or a bounded retry and finally `dead_letter`. Consumers deduplicate on the event's immutable identity, which is what makes at-least-once redelivery safe.

Three rules are worth restating because they are what make crash recovery work rather than merely look plausible. A claim is a database lease, not a memory fact, so a process killed while holding work releases it by expiry. An attempt is counted when the claim is taken rather than when a provider answers, so a job that kills every worker retires instead of being retried forever. And a settle predicate names the lease owner, so a worker whose lease expired mid-flight cannot write over the claim somebody else now holds.

`src/jobs/poller.ts` runs both loops with no overlap and no propagation: a cycle that throws is logged and the next one runs. The worker drains once at startup before the timers begin, because a restart is when a backlog is most likely. See [NOTIFICATIONS](../domains/notifications.md) for what this guarantees end to end.

## Measured: the relay's claim index

The claim is `where state = 'pending' and available_at <= now() ... order by sequence limit 50 for update skip locked`. It is the only hot query either outbox has, and the index that serves it has to supply the *order*, not just the filter.

A partial index on `(available_at, sequence)` cannot. Measured against 200,000 pending rows deferred by backoff and 80 claimable ones, PostgreSQL abandoned it, walked the `sequence` unique index instead, and discarded 49,951 rows to find 50 — 1,360 shared buffers, 3.71 ms. The cost grows with the backlog, which is exactly the condition a relay meets after an incident.

`0014_outbox_claim_index` changes both outboxes to a partial index on `(sequence) where state = 'pending'`. The same query then walks in publication order and stops at the batch size: 150 buffers, 0.11 ms on the same data. The deferral instant stays a filter, which is cheap because a healthy backlog is mostly available and a deferred one is bounded by the retry budget.

## Measured: pair-lock key normalization

`lockPair` hashes an ordered pair of identifiers. Some of those identifiers arrive in a request body, and a UUID is case-insensitive as a value but not as a string: `A1B2…` and `a1b2…` are the same person to PostgreSQL's `uuid` type, and two different sort positions and two different hashes to a plain string comparison. A caller spelling a counterpart's identifier in upper case would have taken a different advisory lock for the same pair — so a block and a signal about those two people could run concurrently, which is the check-then-act gap the lock exists to close. `src/database/pair-lock.ts` now lower-cases before ordering and hashing, and `test/unit/pair-lock.test.ts` holds that property.

## Measured: the pool loses connections, and the pair lock is not why

An instance under concurrent load on one pair used to stop making progress. This document previously attributed that to the pair advisory lock — a waiter holding its pooled connection, making the pool a hard ceiling on same-pair contention. **That attribution was wrong**, and it is corrected here because the wrong cause pointed at the wrong fixes.

A benchmark of 250 cells — pools of 5/10/15/20/30 against 1 to 50 simultaneous same-pair requests, over signal, send, block, and two mixed workloads — does not behave like a ceiling. Stalling is not monotonic in concurrency: a pool of ten stalls at twelve simultaneous signals and completes cleanly at sixteen. `block`, the shortest request path, never stalls at any pool size or concurrency, including fifty simultaneous on a pool of five. Not one cell deadlocked, advisory waiters peaked at twenty-seven with no ill effect, and observed connections never exceeded the pool.

The statement log for a stuck backend shows what actually happens: several ordinary autocommit reads, a `BEGIN`, then an autocommit read executing *inside* that `BEGIN`, then nothing. `BEGIN` 1, `COMMIT` 0, and the backend stays `idle in transaction` forever.

It is a Bun.SQL defect and it reproduces with no VELORA code and no advisory lock. A raw pool of ten, given fifty concurrent units that each mix `sql.begin()` transactions with autocommit queries, lost a connection in four runs of five. The trigger is a pool that must **queue a caller for a connection while it is also serving transactions and autocommit queries**. Transactions alone never leak. Reads alone never leak. Concurrency at or below the pool never leaks. Every loss is permanent, so the instance degrades toward zero connections — which is the hang, and it is not contention.

Advisory locks themselves are correct throughout. Two replicas firing eight simultaneous signals each at one fresh pair still produce exactly one introduction, because the lock lives in the database.

### What the code does about it

[ADR-0019](../decisions/ADR-0019-database-connection-admission.md) is the decision. `DatabaseService` opens all ten connections at startup, never reaps an idle one, and admits at most **eight** units of work that may touch the pool at once, so the pool never has to queue. A unit waits at most **250 ms** for a permit; past that the instance answers `503` with `Retry-After: 1` and code `SERVICE_UNAVAILABLE`, which is safe to retry because the business action never began.

Three rules keep that honest:

- **One unit, one permit.** A unit is one HTTP request, one queued job, or one poller cycle. Everything it reaches through the executor it was handed is already inside that unit; admitting again further down would let a unit wait on itself.
- **It is resource protection, never business authority.** The bound decides how much work touches the pool and nothing else. PostgreSQL decides who may signal, block, send, or be introduced.
- **It is process-local, and that is intended.** Each replica has its own bound of eight, and the semaphore serialises nothing across processes. Cross-replica correctness is the pair advisory lock's job, in the database, exactly as before.

The worker owns a second pool and gets the same treatment: its relay cycle, its delivery sweep, and each queued job run as one admitted unit, so BullMQ's own concurrency cannot recreate the queueing in that process.

`test/integration/database-pool-hardening.test.ts` runs the real services over the real pool at production sizes through fifty simultaneous same-pair signals, fifty simultaneous sends, a block racing sends and signals, five unrelated pairs, a deliberately saturated instance, and two replicas.

The integration harness keeps its own larger pool for a different reason: fifteen suites in one process, with a container ceiling above their total, and both numbers say why in the code.

### For an upstream report

Bun 1.3.14, `Bun.SQL` against PostgreSQL 18.4. One pool, `max: 10`, `idleTimeout: 30`. Fifty concurrent units, each running an autocommit query, then a `sql.begin()` transaction, then another autocommit query. Expected: fifty completions. Observed: units never settle, and `pg_stat_activity` shows backends `idle in transaction` that are never returned to the pool or recovered. It does not occur when concurrency stays at or below `max`, when only transactions run, or when only autocommit queries run. Measured on the same host: unmitigated, 0 of 50 settled within 15 s with a backend stranded `idle in transaction`; with the pool pre-opened and in-flight work bounded at eight, 50 of 50 settled in 30 ms with none stranded.

## Measured: `on conflict` arbitrates one index, and a money table has two

Every table that records a money instruction carries two unique indexes over the same fact: the caller's identity for the operation — who, what, and the key they sent — and the platform-generated provider key derived from exactly those columns. Both are wanted. The first is what a replay resolves against; the second is the invariant that Velora never sends two different instructions under one provider key.

`insert … on conflict (…) do nothing` arbitrates the index it names and no other. A duplicate that is already committed is found by the arbiter's check and the insert is skipped before any other index is touched, which is the ordinary replay and is safe. Two transactions establishing the same identity *at the same moment* are the case it does not cover: both pass the arbiter's check before either has an index entry the other can see, and the loser then inserts into the unarbitrated provider-key index, where a duplicate is raised as `23505` rather than skipped. It escapes as an unhandled error, so a double submission of one purchase is answered `500`.

Reproduced on a two-CPU Linux runner with the hosted pipeline's toolchain: the fifty-simultaneous-submissions suite, repeated forty times, failed twice with `duplicate key value violates unique constraint "billing_payments_provider_key_uk"`. The same suite passes on an unloaded ten-CPU machine, which is why it first appeared as one red hosted run against a green local one.

`src/database/idempotency-lock.ts` closes it with a transaction-scoped advisory lock on the operation identity, taken before the insert. One caller establishes the operation and commits; the next takes the lock only after that commit and reads the operation that now exists, so the second insert never happens and neither index is ever contended. Same forty rounds on the same two CPUs afterwards: no failures. The ordering rule is `lockPair`'s — advisory lock before any row lock — so the two compose.

BILLING's reversals and PAYOUTS' instructions have the same two-index shape and are *not* exposed, because both already take a row lock that serializes the contending writers before they reach the insert: `lockPayment` on the capture, and `lockRecipient` on the creator's recipient. Both call sites say so, because a later change that drops the row lock reopens the race.

## Measured: a derived provider key must stay one-to-one

`billing_payments.provider_idempotency_key` is bounded at 200 characters and an idempotency key may be 128, so the original derivation — the two identifiers and the key written out — reached 209 and was truncated. Truncation is what breaks it: two submissions differing only past the cut derive the same provider key, so the second collides on the index that exists to keep instructions distinct and is refused as a duplicate of a purchase it is not. This needs no concurrency at all.

The derivation is now a SHA-256 digest of the whole identity, which is fixed-width and cannot overrun the bound. Stored keys are never recomputed — reconciliation re-sends the key the row already holds — so the change reaches new operations only.

## Measured: a cycle that is constructed and never started

The worker composed four recurring cycles, wired all four into shutdown, ran all four once at boot, and started two. The provider-event drain was one of the two that were never started — and it is the only thing that applies verified provider events, because the webhook route records and returns and deliberately never posts money on a request thread. A settled payment arriving after boot therefore stayed unapplied until somebody restarted the worker, while the process reported itself healthy throughout. Nothing failed, which is what made it invisible: an unstarted cycle has no error to log.

`startBackgroundCycles` now selects cycles by type rather than by name, so a cycle added later is started without anybody remembering to add a line, and `Poller.scheduling` makes "is this actually running" observable instead of private. `test/unit/worker-cycles.test.ts` holds both halves — every poller in a composition is scheduling afterwards, including one the test never names.
