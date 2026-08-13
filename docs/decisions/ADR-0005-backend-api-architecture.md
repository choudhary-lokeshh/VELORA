# ADR-0005: Backend modular monolith and API contracts

- Decision date: 2026-08-12
- ADR status: Accepted in part; framework/runtime portion superseded by ADR-0016

> Supersession note (2026-08-13): [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md) replaces NestJS/Fastify/Node with Elysia/Bun. The modular-monolith boundaries, REST `/v1`, Zod/OpenAPI/client generation, deterministic owner authorization, published ports, and extraction rules remain accepted. Historical framework analysis below is retained intentionally.

## Context

Velora needs one backend for global consumer, creator, Admin, financial, realtime, media, notification, and AI capabilities. Initial development must stay simple, but domain isolation, deterministic authorization, durable work, and future service extraction cannot be deferred to accidental code structure.

Current official sources were checked on the decision date. NestJS 11 supports Fastify 5 and requires Node.js 20 or newer. OpenAPI 3.1 is language-neutral and aligned with JSON Schema; Zod 4 provides first-party JSON Schema conversion. See [NestJS 11 migration guide](https://docs.nestjs.com/migration-guide), [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.2.html), and [Zod 4](https://zod.dev/v4).

## Requirements

- Enforce existing domain ownership and published-contract rules.
- Keep initial operations suitable for one small team and one primary transactional database.
- Support HTTP APIs, webhooks, signed uploads, streaming responses where approved, WebSocket composition, workers, authorization, validation, and observability.
- Provide stable generated clients to Web and Mobile without sharing backend internals.
- Allow selective extraction without rewriting domain behavior.

## Options evaluated

1. TypeScript modular monolith using NestJS on Fastify.
2. Minimal Fastify application with hand-built module/composition conventions.
3. Microservices from first release.
4. Serverless function per endpoint/domain.
5. REST with OpenAPI; GraphQL; tRPC/RPC; hybrid.
6. Zod schema-first contracts, handwritten OpenAPI, or framework DTO-only contracts.

## Decision

- Build one modular monolith in `apps/api` using NestJS 11 on Fastify 5, Node.js 24, and TypeScript 5.9.3.
- Map every authoritative domain to a server-only module in `packages/domain`. Each module has domain model/policies, application use cases, published ports/contracts, and infrastructure adapters. Private repositories, persistence models, and internal events are not exported.
- Keep `apps/api` as composition root and transport adapter. It may wire modules, auth, config, telemetry, HTTP, WebSocket, and providers; it must not contain domain rules or access private tables across modules.
- Use REST over HTTPS as primary client API. Publish OpenAPI 3.1 descriptions, stable error codes, cursor pagination, idempotency requirements, and explicit `/v1` compatibility boundary. Use additive evolution within a version; create a new major path only for unavoidable incompatible semantics.
- Define runtime request/response schemas in `packages/validation` with Zod 4. Generate OpenAPI and `packages/api-client`/client-safe types from the same reviewed schema registry. CI rejects schema-generation drift and breaking contract changes.
- Use dedicated webhook endpoints, signed direct-upload initiation, and Socket.IO contracts where HTTP request/response is not appropriate. GraphQL is not a secondary default.
- Cross-domain synchronous calls use published application-service interfaces. Cross-domain asynchronous facts use versioned outbox events. No module imports another module's repository, ORM schema, entity class, or provider implementation.
- Enforce dependency direction:

```text
apps/web, apps/mobile, apps/creator-studio, apps/admin
  -> packages/api-client, packages/types, packages/validation, packages/config, packages/observability
  -> apps/api transport contracts
  -> owning domain application service / published port
  -> owning domain model and repository interface
  <- infrastructure repository/provider adapter injected by apps/api
```

- Admin and AI use the same published application services as other callers, with their own actor/capability context and stricter authorization. Neither receives repository access.

## Why

NestJS supplies predictable modules, dependency injection, guards, lifecycle, testing support, and WebSocket integration. Fastify reduces transport overhead and provides a mature HTTP core. A modular monolith preserves transaction simplicity and low operational load while the published-port and outbox seams create real extraction boundaries. REST/OpenAPI gives all clients a standard, inspectable, cache-aware, language-neutral contract and does not expose server implementation types.

## Rejected alternatives

- Initial microservices: multiply deployment, network, consistency, tracing, and incident burden before load or team ownership justifies it.
- Unstructured Fastify handlers: technically lean, but places too much architectural discipline in convention for an agent-heavy codebase.
- Function-per-endpoint serverless topology: fragments domain transactions, WebSocket/session behavior, connection pooling, and local testing.
- GraphQL as primary API: adds field-level authorization, query-cost, caching, and schema-operation complexity without a current graph-query requirement.
- tRPC as public contract: excellent TypeScript ergonomics, but couples clients to server TypeScript shapes and weakens language/provider portability.
- Framework DTO-only source: risks runtime/OpenAPI/generated-client drift and decorator-specific contracts.

## Consequences

One deployable can perform local transactions and compose domains without distributed calls. Module boundaries require static enforcement because a shared process alone cannot prevent imports. API schema becomes a reviewed release artifact. REST endpoints may require purpose-built aggregation endpoints rather than client-side cross-domain fan-out.

## Risks

- Nest global modules or convenience imports can create hidden coupling.
- Modular monolith can decay into shared tables and shared utility logic.
- Generated clients can lag contracts.
- REST aggregation can move unauthorized joins into API composition.

## Mitigations

Ban global domain modules; use dependency-graph tests and module public entrypoints; assign every table and use case to one owner; generate and compile clients in CI; make owning application services produce authorized projections; record an ADR before any extraction or new API style.

## Scaling path

Phase A runs one API deployable plus workers. Phase B scales stateless API replicas horizontally and may separate the Socket.IO gateway process while preserving module contracts. Phase C extracts only measured hotspots such as realtime, media, notifications, AI workers, or analytics ingestion. Extraction replaces an in-process port with a versioned network/event adapter; domain ownership remains unchanged.

## Security implications

Authenticate at transport boundary and authorize inside owner application service. Zod schemas reject unknown/oversized input as configured. Apply secure headers, CORS allowlists, CSRF for cookie sessions, rate limits, request body limits, redacted errors, and correlation IDs. No client, Admin route, AI tool, or provider callback bypasses domain authorization.

## Testing implications

Require module dependency tests, schema generation/diff tests, API contract tests, negative authorization tests, Fastify integration tests, real PostgreSQL tests, idempotency/concurrency tests, and end-to-end flow tests. Extracted-adapter contract tests must run before topology changes.

## Migration/reversibility

Nest/Fastify are transport/composition choices; domain/application code depends on ports. A future framework migration can replace adapters module by module. API versioning and generated clients permit staged client upgrades. Service extraction uses existing public contracts and outbox events rather than copying private tables.

## Status

| Decision | Classification |
|---|---|
| NestJS 11 modular monolith | LOCK NOW |
| Fastify 5 HTTP adapter | LOCK NOW |
| REST/JSON primary API | LOCK NOW |
| OpenAPI 3.1 and Zod 4 schema-first contracts | LOCK NOW |
| Generated TypeScript client package | LOCK NOW |
| Microservice extraction | DEFER UNTIL SCALE REQUIRES |
| GraphQL as initial/default API | REJECTED |
| Initial microservices and direct client/domain imports | REJECTED |
