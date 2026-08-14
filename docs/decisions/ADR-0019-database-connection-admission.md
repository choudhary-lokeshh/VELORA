# ADR-0019: Database connection admission and pool warm-up

- Decision date: 2026-08-14
- ADR status: Accepted
- Owners: Founder (decision owner), platform operations, backend

## Context

An API instance under concurrent load on one pair of people would stop making progress. The repository attributed this to the pair advisory lock: a waiter holds its pooled connection while it waits, so the pool size looked like a hard ceiling on how many transactions may contend for one pair. That explanation was recorded in [jobs, idempotency and concurrency](../engineering/03-jobs-idempotency-concurrency.md) and produced the open pair-lock contention decision in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).

A measured study disproved it. Across 250 benchmark cells — pools of 5/10/15/20/30 against 1 to 50 simultaneous same-pair requests, over signal, send, block, and two mixed workloads — the stall pattern did not behave like a ceiling. It was not monotonic in concurrency: a pool of ten stalled at twelve simultaneous signals and completed cleanly at sixteen. `block`, the shortest request path, never stalled at any pool size or concurrency, including fifty simultaneous on a pool of five. No deadlock occurred in any cell. Advisory waiters peaked at twenty-seven with no ill effect, and observed connections never exceeded the pool.

The PostgreSQL statement log for a stuck backend showed the actual shape: seven ordinary autocommit reads, a `BEGIN`, then an autocommit read executing *inside* that `BEGIN`, then nothing — `BEGIN` 1, `COMMIT` 0. The backend stayed `idle in transaction` permanently.

It reproduces with no VELORA code and no advisory lock at all. A raw `Bun.SQL` pool of ten, given fifty concurrent units that each mix `sql.begin()` transactions with autocommit queries, leaked a connection in four of five runs. The trigger is a pool that must **queue a caller for a connection while it is also serving both transactions and autocommit queries**. Transactions alone never leak; reads alone never leak; concurrency at or below the pool never leaks. Every lost connection is permanent, so an instance degrades toward zero connections and stops answering — the hang that was being read as lock contention.

Bun 1.3.14 is pinned in `mise.toml`, `package.json#engines`, and the `@types/bun` catalog entry, and is the newest published release, so there is no upstream fix available to adopt.

## Requirements

- Keep the pair advisory lock, its ordering, and its unbounded wait exactly as they are; PostgreSQL stays the correctness authority.
- Prevent the pool from ever having to queue a caller for a connection.
- Bound how long a caller can wait for capacity, so a saturated instance answers rather than hangs.
- A capacity refusal must be truthful: the business action has not begun, and the response must reveal nothing about the pool, the driver, or connection counts.
- No change to pair-lock semantics, block/signal/introduction correctness, message idempotency, notification claims, or transaction boundaries.
- The bound must not become business authority, and must not be mistaken for distributed serialization.
- The worker must get equivalent protection, since it owns a second pool.

## Options evaluated

1. Raise the pool above expected concurrency.
2. `SET LOCAL lock_timeout` before `pg_advisory_xact_lock`, turning contention into a fast refusal.
3. `pg_try_advisory_xact_lock`, refusing immediately when the pair is busy.
4. Bound in-flight database work below the pool, pre-warm the pool, and stop reaping idle connections.
5. Move pair serialization out of PostgreSQL to Redis or a process mutex.

## Decision

Option 4.

`DatabaseService` opens all ten connections during startup and passes `idleTimeout: 0` so none is reaped. Each process admits at most eight units of work that may touch the pool, waits at most 250 ms for a permit, and answers `503` with `Retry-After: 1` and `SERVICE_UNAVAILABLE` when the wait expires. A unit is one HTTP request, one queued job, or one poller cycle; everything it reaches through the executor it was given belongs to that same unit and never admits itself again.

Pool size stays at ten. The pair advisory lock, its call sites, and its unbounded wait are untouched.

## Why

The lock was never the defect. Options 2 and 3 bound the *lock* wait, which is not where the failure is — it happens with no lock present — and both were measured to be actively worse for the product: against a 200 ms holder, `lock_timeout='50ms'` refused **all twenty** waiters with SQLSTATE `55P03` and zero succeeded, where unbounded waiting completed all twenty in 257 ms; `pg_try_advisory_xact_lock` admitted one of twenty and refused the rest in 7 ms. Turning a contended pair into mass refusal is a product-visible change made for a cause that does not exist.

Option 1 only widens the window. Fifty simultaneous requests on a pool of thirty still stalled, and multiplying the pool across replicas runs into PostgreSQL's own connection ceiling: twenty instances at a pool of twenty consume 400 backends, leaving nothing for migrations, admin, or monitoring.

Option 5 would move correctness out of the durable store, which [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md) and the architecture forbid, and it would not touch the driver defect either.

Option 4 addresses the measured trigger directly, and each half of it independently removed the failure: across sixteen trials of a thirty-request burst on a pool of ten, the unmitigated control lost seven connections across five trials and left fourteen requests unsettled; pre-warmed-and-not-reaped, bounded-to-eight, and both together each lost zero across sixteen trials. On the real service path, bounding turned a pool-of-ten, fifty-concurrent signal burst from 34 of 50 settled and stuck into 50 of 50 in 98 ms, and served 200 concurrent same-pair signals at p95 18 ms and 649 per second.

The bound is deliberately below the pool rather than equal to it. The two spare connections are what leave a readiness probe and a migration somewhere to go while request traffic is at its limit.

`503` is the honest status. The server is declining to *begin* work: `429` would claim rate limiting, `409` would claim a state conflict, and `423` is WebDAV locking. Nothing in the response says why, because a client must not be able to read infrastructure state out of an error body.

## Rejected alternatives

- Raising the pool: widens the window, does not close it, and multiplies across replicas into a server-side ceiling.
- `lock_timeout`: measured as all-or-nothing refusal, and aimed at a mechanism that is not the cause.
- `pg_try_advisory_xact_lock`: worse than `lock_timeout`, with starvation under sustained load.
- Redis or process-mutex pair locking: moves correctness out of PostgreSQL and adds a failure domain, for no effect on the defect.
- Downgrading or upgrading Bun: 1.3.14 is the newest published release, so there is nothing to move to.
- Retrying a lost connection: every lost connection is permanent, so a retry cannot recover one.

## Consequences

Each process holds its full pool open from startup instead of letting it shrink when idle: ten backends per API instance and ten per worker, continuously. Startup now fails when the database cannot be reached, which is where it should fail. Under enough concurrent load an instance returns `503` with `Retry-After: 1` instead of queueing without limit, and the shared contract publishes that on every operation. Consumer clients treat that code as the generic unavailable state they already offer a retry for, rather than as a business refusal.

Per-pair throughput is unchanged, because the pair lock is unchanged. Bounding in-flight work at eight does not reduce it either: a single hot pair still serialises in the database, and measured at roughly 300 sends per second on one pair against 714 spread over twenty-five.

## Risks

- The bound is process-local. It is not distributed serialization and must never be described as such; a replica has its own bound, and only PostgreSQL knows about the other replica.
- A workload whose per-request database time grows could push waits past 250 ms and produce refusals in ordinary traffic. The admission wait, in-flight, and waiter metrics exist to see that coming.
- Holding connections open costs backends at all times rather than only under load.
- The underlying driver defect is unfixed upstream. If a connection is lost for another reason — a network interruption, a database restart — the pool re-establishes it, and re-establishment under load is the trigger.

## Mitigations

`DatabaseService` exposes admission counters and two PostgreSQL seams: sustained `idle in transaction` backends, which is the defect's exact signature, and advisory-lock waiters. A count that stays above zero across samples is the alert; a spike is not. Every capacity refusal is logged with operational counters and no caller identity. The regression suite runs the real services over the real pool at production sizes, so a change that reintroduces queueing fails there rather than in production. The evidence needed for an upstream Bun report is recorded in the same engineering document.

## Scaling path

Adding replicas adds bounds and connections linearly; PostgreSQL's `max_connections` is the ceiling that matters, and a transaction-mode pooler is the seam if it is ever reached. The pair lock is `pg_advisory_xact_lock` rather than a session-scoped lock precisely so it survives transaction pooling. If the defect is fixed upstream, the bound may be revisited — but pre-warming and not reaping are cheap enough to keep regardless.

## Security implications

None of the admission state reaches a caller: the refusal body is the standard `ApiError` with a generic message and no pool, connection, or driver detail. Logs carry counters and a correlation identifier, never a pair or an account. The observability seams read `pg_stat_activity` aggregates only, so they cannot expose query text or arguments. Startup failure messages come from the driver, and the connection URL is never interpolated into them.

## Testing implications

Unit tests hold the admission properties with an injected clock: exact capacity, FIFO admission, a permit released on throw, no double release, a bounded wait that produces a refusal without starting the work, and a cancelled caller that leaves the queue. A real-PostgreSQL suite runs the real services at pool ten and admission eight through fifty simultaneous same-pair signals, fifty simultaneous sends, a block racing sends and signals, five unrelated pairs, a deliberately saturated instance, and two replicas — asserting in each case that every request settles, that no connection is lost to `idle in transaction`, that no deadlock occurs, and that correctness is unchanged.

## Migration/reversibility

No migration, no schema change, no data change. Reverting means removing the admission wrapper and restoring `idleTimeout`, which restores the measured failure; the pair lock and every domain service are untouched either way.

## Status

| Decision | Classification |
|---|---|
| Pair advisory lock, ordering, and unbounded lock wait unchanged | LOCK NOW |
| PostgreSQL remains the correctness authority for every pair | LOCK NOW |
| Production pool of ten connections per process | LOCK NOW |
| Eight in-flight database-touching units per process | LOCK NOW |
| 250 ms bounded admission wait | LOCK NOW |
| `503` with `Retry-After: 1` and code `SERVICE_UNAVAILABLE` on saturation | LOCK NOW |
| Pool opened at startup and never reaped idle | LOCK NOW |
| Equivalent bound in the worker process | LOCK NOW |
| `lock_timeout` on the pair lock | REJECTED |
| `pg_try_advisory_xact_lock` on the pair lock | REJECTED |
| Raising the pool as the mitigation | REJECTED |
| Redis or process-mutex pair locking | REJECTED |
| Connection pooler in front of PostgreSQL | DEFER UNTIL MEASURED NEED |

## Cross-references

[ADR-0006](ADR-0006-database-data-access-migrations.md), [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md), [ADR-0013](ADR-0013-observability-testing.md), [jobs, idempotency and concurrency](../engineering/03-jobs-idempotency-concurrency.md), [API contracts](../engineering/01-api-contracts.md), [observability](../engineering/04-observability.md), [scale and resilience](../architecture/07-scale-and-resilience.md), and [open decisions](DECISIONS_REQUIRED.md).
