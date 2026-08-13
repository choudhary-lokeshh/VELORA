# API contract engineering

## Purpose

Define implementation rules for client/API and cross-domain contract compatibility. Product behavior remains owned by domain/flow documents.

## Contract shape

Every endpoint/command declares actor requirement, input validation, target authorization, idempotency expectation, success schema, stable error code, pagination/filter limits, data classification, events, and rate limit. Use explicit versioning/compatibility policy: additive optional fields first; deprecate consumers before removing/changing semantics. Generated clients may be used later, but source contract is language-neutral and reviewed.

The selected implementation is Elysia on Bun, REST/JSON over HTTPS with `/v1`, Zod 4 runtime schemas, generated OpenAPI 3.1 descriptions, and a generated TypeScript `api-client`. Zod schemas are the reviewed wire-schema source; route-registry tests reject undocumented Elysia routes, generation check mode rejects stale OpenAPI/client artifacts, and the Turbo dependency graph builds generators before consumers. `/v1/health/live` and `/v1/health/ready` are operational, not product, endpoints. Signed upload initiation, webhooks, and Socket.IO use separate purpose-specific contracts when their phases begin.

The registry declares each operation's transport credential alongside its schemas, and the published document carries it as an OpenAPI security requirement backed by a named scheme, so the credential an operation accepts is contract, not convention. Contract headers are declared per operation and published as header parameters; parity tests compare the published set in both directions. No credential ever appears in a path or query parameter.

## Request and failure flow

Authenticate transport, validate schema/size, authorize action/object in owner domain, execute transactional transition, emit outbox fact, return outcome with correlation ID. Retryable mutations require idempotency key and replay same response/outcome. Errors separate invalid input, unauthenticated, unauthorized/not-found privacy policy, conflict/version, rate limit, temporary dependency, and safe internal failure. Never expose stack traces, policy internals, secrets, or another user's data.

## Security/concurrency/testing

Contract tests cover schema compatibility, negative authorization, validation, idempotent replay, optimistic conflict, provider failure, and redaction. Clients must not treat UI hiding as access control. Pagination cursors are signed/validated/limited as appropriate. Log endpoint/action/correlation/outcome, not sensitive body by default.

## AUTH surface

`/v1` exposes the AUTH lifecycle: development/test identity authentication for browser and Mobile audiences, session status, Mobile refresh exchange, logout, global logout, account-recovery initiation, and account-recovery completion.

- The development/test identity operations are refused outside the local and test application environments by configuration and again at the edge, and they cannot mint Platform Admin authority: that audience is absent from their request schema.
- Browser operations are authenticated by an audience-scoped opaque session cookie; Consumer Mobile operations by a bearer access token. State-changing cookie-authenticated requests additionally require exact `Origin` validation, Fetch Metadata validation, and a server-bound CSRF token echoed in a contract header. Bearer requests carry no ambient credential and therefore need no CSRF evidence.
- Cross-origin browser access is an exact-origin credentialed CORS allowlist read from configuration. There is no wildcard and no pattern, and a preflight from an unknown origin is refused.
- AUTH failures use stable, deliberately uninformative codes with one shared message. Unknown, expired, revoked, and replayed refresh tokens answer identically, and recovery initiation answers identically whether or not an account exists, so no response discloses account existence, token state, provider internals, or storage detail.
- Refresh exchange is the one mutation with no retry tolerance. A rotated token presented again is replay and revokes its family, so the general idempotency rule above is satisfied by the client never repeating the request rather than by the server repeating a response; repeating a one-time credential is exactly the event the contract must not absorb.
- AUTH request bodies have their own smaller size ceiling so malformed or oversized input is rejected before any parsing work, and a credential whose shape is wrong is refused before any storage lookup.
- Recovery initiation answers `202` whether or not an account exists and whether or not its own quota was reached; only a caller-scoped limit answers differently, because it describes the caller and not any account.

## Phase and decisions

V1 contract registry and test discipline follow the unaffected contract portions of [ADR-0005](../decisions/ADR-0005-backend-api-architecture.md) and active backend [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). Exact error-code catalogue is defined per domain/endpoint without changing the common envelope. The registry declares the durable failures every operation can produce — `404` `HTTP_404`, `413` `PAYLOAD_TOO_LARGE`, and `500` `INTERNAL_ERROR` — because they are enforced around routing rather than inside a handler, so the generated OpenAPI document and client expose them. Parity tests compare method, path, every declared status, its response schema, and the correlation-identifier header in both directions, and the request body limit is declared once in `@velora/validation` and consumed by the runtime. GraphQL requires a future feature ADR and is not a default. See [contracts/events](../architecture/04-contracts-events.md), [RBAC](../security/02-access-control-rbac.md), [testing/release](05-testing-release.md).
