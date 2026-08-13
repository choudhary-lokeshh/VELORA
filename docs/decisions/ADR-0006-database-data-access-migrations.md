# ADR-0006: PostgreSQL, data access, and migrations

- Decision date: 2026-08-12
- ADR status: Accepted in part; driver/runtime portion superseded by ADR-0016

> Supersession note (2026-08-13): [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md) replaces the `node-postgres` runtime path with Drizzle's Bun SQL driver. PostgreSQL, Drizzle, committed reviewed SQL, explicit migration execution, constraints, ownership, compatibility, and rollback discipline remain accepted. Historical driver analysis below is retained intentionally.

## Context

Velora's core state includes identity, relationships, messages, entitlements, financial operations, payouts, moderation, approvals, jobs, and audit references. These workflows need transactions, constraints, partial indexes, row/advisory locks where justified, predictable SQL, durable recovery, and domain-owned migrations. Database choice must favor correctness and low early operations over speculative polyglot persistence.

Current official sources were checked on the decision date. PostgreSQL 18 is supported through November 2030 and PostgreSQL recommends current minor releases. Drizzle supports transactions and SQL migration generation; its documentation distinguishes committed migration generation from direct schema push. See [PostgreSQL version policy](https://www.postgresql.org/support/versioning/), [PostgreSQL 18 release](https://www.postgresql.org/docs/18/release-18.html), [Drizzle transactions](https://orm.drizzle.team/docs/transactions), and [Drizzle migrations](https://orm.drizzle.team/docs/migrations).

## Requirements

- Enforce business-critical uniqueness and invariants in database constraints.
- Support transactions, `SELECT ... FOR UPDATE`, advisory locks, partial/expression indexes, JSONB where justified, full SQL escape hatches, and explainable query plans.
- Keep schemas, repositories, and migrations owned by one domain.
- Test migrations against the production database engine.
- Permit safe expand/backfill/contract rollout and auditable production execution.
- Avoid a database-per-domain or polyglot estate before scale evidence.

## Options evaluated

1. PostgreSQL 18 with Drizzle ORM/query builder and `node-postgres`.
2. PostgreSQL with Prisma.
3. PostgreSQL with Kysely or handwritten SQL.
4. MySQL-compatible relational database.
5. Document/NoSQL database as transactional source of truth.
6. Database per domain from first release.

## Decision

- Use PostgreSQL 18 as the sole initial transactional database engine. Run the current supported 18.x minor consistently across local, CI, staging, and production unless a managed provider's approved compatibility constraint requires a documented temporary exception.
- Use one physical database initially, with explicit domain-owned schemas/tables, naming, migrations, repository interfaces, and least-privilege roles. Shared database does not grant cross-domain query permission.
- Use Drizzle ORM 0.45.x with `node-postgres` for typed schema/query construction. Pin exact versions at bootstrap. Use parameterized SQL through Drizzle's explicit SQL escape hatch for locks, advanced indexes, query hints where supported, and PostgreSQL-native operations. No generic base repository hides transaction or SQL semantics.
- Treat TypeScript schema declarations and committed SQL migrations as reviewed artifacts. Generate with Drizzle Kit, inspect/edit SQL when needed, and apply only committed migrations through a dedicated migration runner. `drizzle-kit push` is forbidden for shared, staging, and production databases.
- Every critical invariant uses the narrowest appropriate database constraint: primary/foreign keys inside owner scope, unique/partial unique indexes, checks, exclusion constraints, immutable references, and non-null rules. Service validation improves errors but does not replace constraints.
- Use transactions around state transitions. Use optimistic versions by default for user-visible concurrent edits; row locks for short contested transitions; advisory locks only for coarse operations with stable keys and bounded lock time. Process memory locks are never cross-replica correctness controls.
- Use integer minor units plus ISO currency for money. Never use binary floating point for financial amounts.
- Production migration sequence is expand, deploy compatible readers/writers, run durable idempotent backfill, verify invariants, then contract in a later release. Destructive or long-locking changes require query/lock analysis, backup/restore evidence, approval, maintenance/online strategy, and a separate rollback or forward-fix plan.
- Production migrations are forward-only operationally. Rollback means restoring the prior application against a backward-compatible schema or applying a reviewed forward-fix. Down migrations are not trusted to recover deleted data.
- One elected migration job runs before incompatible application activation. Application replicas never auto-migrate on startup.
- Partitioning, read replicas, specialized search, warehouse, and multi-region write topology remain absent until measured need and separate ADRs.

## Why

PostgreSQL supplies the transaction, indexing, locking, constraint, and operational maturity needed by social, safety, and money workflows in one engine. Drizzle keeps SQL visible while preserving useful TypeScript inference and migration generation. One physical database reduces cost and enables local domain transactions; ownership and repository rules prevent it from becoming a shared-table monolith.

## Rejected alternatives

- Prisma: productive and type-safe, but the chosen system needs direct, routine PostgreSQL DDL/locking/query control with generated SQL kept central to review.
- Kysely/handwritten SQL: strong SQL control, but requires more separate schema/type/migration assembly for the initial team.
- MySQL-compatible database: viable, but PostgreSQL better matches selected locking, partial-index, JSONB, extension, and queue patterns.
- NoSQL primary store: weak fit for multi-record financial, entitlement, approval, and relationship invariants.
- Database per domain: creates distributed consistency and operational burden before independent scaling or ownership exists.

## Consequences

PostgreSQL availability is a major shared dependency. Domain schemas share capacity and maintenance windows while preserving logical ownership. Engineers must understand generated SQL and transaction isolation; ORM types are not permission boundaries.

## Risks

- Cross-domain joins can bypass service authorization.
- Long transactions, backfills, or indexes can block production traffic.
- Drizzle's pre-1.0 API can change.
- One database can become a scaling bottleneck or broad blast radius.
- Automatic migration generation can miss semantic data changes.

## Mitigations

Use separate module entrypoints and database roles where practical; dependency and SQL review; statement/lock/idle transaction timeouts; online/concurrent index patterns; exact Drizzle pins; real-PostgreSQL migration tests; query budgets and explain plans; PITR/backups and restore drills; explicit data backfill code as durable jobs.

## Scaling path

Phase A uses one managed PostgreSQL 18 cluster with connection pooling and PITR. Phase B adds tuned indexes, read replicas for explicitly stale-safe projections, partitioning only for measured large tables, and independent worker pools. Phase C extracts a domain only after contract/outbox boundaries exist and migration/cutover preserves one writer. Specialized search, vector, or analytics stores remain derived projections.

## Security implications

Use TLS, encrypted storage where applicable, separate migration/runtime roles, least privilege, rotated credentials, query parameterization, row/object authorization in services, restricted backups, and audited privileged access. No client, AI tool, Admin user, or provider receives SQL access.

## Testing implications

Run repository/integration, constraints, locks, isolation, idempotency, migration-upgrade, backfill-resume, and query-plan tests against a real PostgreSQL 18 container. CI applies all migrations from empty and from a maintained previous-release fixture, verifies schema snapshots/drift, and tests old/new application compatibility during expand/contract windows.

## Migration/reversibility

PostgreSQL is a durable strategic choice. Drizzle can be replaced incrementally because migrations are SQL and repositories are behind domain ports. Database-engine replacement would require a new ADR, dual-write/verify or offline cutover plan, export validation, and domain-by-domain ownership migration.

## Status

| Decision | Classification |
|---|---|
| PostgreSQL 18 transactional database | LOCK NOW |
| Drizzle ORM 0.45.x with `node-postgres` | LOCK NOW |
| Committed reviewed SQL migrations | LOCK NOW |
| Expand/backfill/contract production flow | LOCK NOW |
| Read replicas and table partitioning | DEFER UNTIL SCALE REQUIRES |
| Specialized search/vector/warehouse stores | DECISION REQUIRED BEFORE FEATURE |
| Database-per-domain initial topology | REJECTED |
| Production schema push and startup auto-migration | REJECTED |
