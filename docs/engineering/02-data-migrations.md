# Data and migration discipline

## Purpose

Define safe schema evolution while preserving domain ownership. Specific database technology is not selected.

## Rules

- Domain owner writes its schema/migrations; another module never queries/modifies it directly.
- Every table/record has owner, data class, lifecycle/retention, indexes/constraints, audit needs, and migration rollback/forward plan.
- Prefer expand, backfill, dual-read/write if necessary, migrate consumers, verify, then contract later. Never deploy destructive schema change coupled to old readers.
- Enforce database constraints for critical uniqueness/references alongside service validation: identity linkage, idempotency, provider event, pair state, entitlement/payment/payout references as appropriate.

## Migration flow and failure

Review ownership/privacy/performance, apply compatible schema, deploy code, run durable resumable backfill with rate limits/checkpoints, validate counts/invariants, remove old path only after compatible clients/jobs drain. Backfills are idempotent and observable. Failure pauses safely, alerts, and resumes/compensates; never use production ad-hoc direct edits without an audited emergency procedure.

## Security/concurrency/phase

Migrations use least-privilege credentials, no production secrets in repo/logs, and restrict sensitive data access. Locks/timeouts and online operations protect availability. V1 discipline. `DECISION REQUIRED`: database, tenancy/partitioning, migration tool, backup/RPO/RTO. See [data ownership](../architecture/05-data-ownership.md), [scale](../architecture/07-scale-and-resilience.md), [account deletion](../flows/account-deletion.md).
