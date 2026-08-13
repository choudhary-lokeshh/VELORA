# API contract engineering

## Purpose

Define implementation rules for client/API and cross-domain contract compatibility. Product behavior remains owned by domain/flow documents.

## Contract shape

Every endpoint/command declares actor requirement, input validation, target authorization, idempotency expectation, success schema, stable error code, pagination/filter limits, data classification, events, and rate limit. Use explicit versioning/compatibility policy: additive optional fields first; deprecate consumers before removing/changing semantics. Generated clients may be used later, but source contract is language-neutral and reviewed.

The selected implementation is Elysia on Bun, REST/JSON over HTTPS with `/v1`, Zod 4 runtime schemas, generated OpenAPI 3.1 descriptions, and a generated TypeScript `api-client`. Zod schemas are the reviewed wire-schema source; route-registry tests reject undocumented Elysia routes, generation check mode rejects stale OpenAPI/client artifacts, and the Turbo dependency graph builds generators before consumers. Bootstrap exposes only `/v1/health/live` and `/v1/health/ready`; neither is a product endpoint. Signed upload initiation, webhooks, and Socket.IO use separate purpose-specific contracts when their phases begin.

## Request and failure flow

Authenticate transport, validate schema/size, authorize action/object in owner domain, execute transactional transition, emit outbox fact, return outcome with correlation ID. Retryable mutations require idempotency key and replay same response/outcome. Errors separate invalid input, unauthenticated, unauthorized/not-found privacy policy, conflict/version, rate limit, temporary dependency, and safe internal failure. Never expose stack traces, policy internals, secrets, or another user's data.

## Security/concurrency/testing

Contract tests cover schema compatibility, negative authorization, validation, idempotent replay, optimistic conflict, provider failure, and redaction. Clients must not treat UI hiding as access control. Pagination cursors are signed/validated/limited as appropriate. Log endpoint/action/correlation/outcome, not sensitive body by default.

## Phase and decisions

V1 contract registry and test discipline follow the unaffected contract portions of [ADR-0005](../decisions/ADR-0005-backend-api-architecture.md) and active backend [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). Exact error-code catalogue is defined per domain/endpoint without changing the common envelope. The registry declares the durable failures every operation can produce — `404` `HTTP_404`, `413` `PAYLOAD_TOO_LARGE`, and `500` `INTERNAL_ERROR` — because they are enforced around routing rather than inside a handler, so the generated OpenAPI document and client expose them. Parity tests compare method, path, every declared status, its response schema, and the correlation-identifier header in both directions, and the request body limit is declared once in `@velora/validation` and consumed by the runtime. GraphQL requires a future feature ADR and is not a default. See [contracts/events](../architecture/04-contracts-events.md), [RBAC](../security/02-access-control-rbac.md), [testing/release](05-testing-release.md).
