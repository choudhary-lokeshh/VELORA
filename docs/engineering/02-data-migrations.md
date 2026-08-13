# Data and migration discipline

## Purpose

Define safe PostgreSQL 18 schema evolution while preserving domain ownership. Drizzle through Bun SQL owns typed data access and committed SQL migrations remain review authority under the unaffected portions of [ADR-0006](../decisions/ADR-0006-database-data-access-migrations.md) and [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md).

Migration files use the sequential index prefix, matching the committed `0000_bootstrap` and the `idx` ordering in `drizzle/meta/_journal.json`; `drizzle.config.ts` sets `migrations.prefix` to `index` so generation stays consistent. Do not mix index-prefixed and timestamp-prefixed migrations: ordering is taken from the journal, and a mixed scheme makes review order and file order disagree. Migrations run only through the explicit `pnpm db:migrate` command, never at application startup.

## Rules

- Domain owner writes its schema/migrations; another module never queries/modifies it directly.
- Every table/record has owner, data class, lifecycle/retention, indexes/constraints, audit needs, and migration rollback/forward plan.
- Prefer expand, backfill, dual-read/write if necessary, migrate consumers, verify, then contract later. Never deploy destructive schema change coupled to old readers.
- Execute migrations only through the explicit Bun migration command using the committed journal/SQL path. API and worker startup never invoke migrations or schema push.
- Enforce database constraints for critical uniqueness/references alongside service validation: identity linkage, idempotency, provider event, pair state, entitlement/payment/payout references as appropriate.

## Migration flow and failure

Review ownership/privacy/performance, apply compatible schema, deploy code, run durable resumable backfill with rate limits/checkpoints, validate counts/invariants, remove old path only after compatible clients/jobs drain. Backfills are idempotent and observable. Failure pauses safely, alerts, and resumes/compensates; never use production ad-hoc direct edits without an audited emergency procedure.

## Security/concurrency/phase

Migrations use a dedicated least-privilege role, no production secrets in repo/logs, and restrict sensitive data access. Locks/timeouts and online operations protect availability. Generate and review committed SQL; never use schema push or application-startup auto-migration in any environment. Real PostgreSQL tests must run the actual migration command against an empty database, rerun it, prove constraints, and prove bootstrap creates no product table. Database, migration tool, and initial topology are locked; partitioning is deferred until scale and backup/RPO/RTO values remain decisions before production. See [data ownership](../architecture/05-data-ownership.md), [scale](../architecture/07-scale-and-resilience.md), [account deletion](../flows/account-deletion.md).
