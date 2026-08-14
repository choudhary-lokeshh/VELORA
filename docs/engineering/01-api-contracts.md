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

## Consumer product surface

Consumer product operations share one authorization shape. They accept either the audience-scoped browser session cookie or a Consumer Mobile bearer access token, they resolve the acting consumer entirely from that credential, and they refuse any audience other than Consumer Web and Consumer Mobile with `CONSUMER_SURFACE_REQUIRED` before performing a lookup on the caller's behalf. State-changing cookie-authenticated requests carry the same exact-`Origin`, Fetch Metadata, and server-bound CSRF requirements AUTH defines, because one implementation resolves callers for every route in the application.

Product failure codes are separate from AUTH's on purpose. AUTH must stay uninformative about accounts and credentials; a product caller must be able to distinguish refused, gone, conflicting, and malformed without ever learning anything about another user. `RESOURCE_NOT_FOUND` is the privacy-preserving answer for both "does not exist" and "not visible to you", and the published `404` description states that the two are deliberately indistinguishable.

`/v1` currently exposes discovery — the candidate feed, private passes, and the introduction lifecycle — plus consumer account creation and self-read, the adult onboarding ladder — admission state, adult declaration, and policy acknowledgement — and the consumer profile surface: profile read and save, discoverability preference, and the profile media lifecycle.

Profile and preference writes carry an expected version. It is absent exactly when the caller believes the record does not exist, so a create that races another create and an edit that races another edit both answer `STATE_CONFLICT` rather than silently overwriting. Media operations name an object the caller already owns; ownership is part of the database predicate, so an identifier belonging to another account is indistinguishable from one that does not exist. A client never declares what it uploaded: it asks for an upload capability, writes the bytes, and asks the platform to inspect them, and the platform decides the type from the object's own bytes. Where no storage provider is approved the operation answers `503 DEPENDENCY_UNAVAILABLE`, which is a truthful statement about the environment rather than a client error. Account creation is idempotent: the AUTH account comes from the credential, so the body can never name another account, and a repeated call returns the existing account unchanged whatever its lifecycle state.

Onboarding operations return the derived admission state rather than accepting one. `ACCOUNT_NOT_ELIGIBLE` covers both an outstanding earlier step and a refused declaration, so a caller learns it may not continue without learning any policy internals; the underlying evidence is recorded either way. Repeated acknowledgement of a version already held is a success that changes nothing.

Reads that page publish `cursor` and `pageSize` as query parameters drawn from one declared registry, and parity tests compare the published set in both directions. The registry is what keeps the query surface closed: a credential in a URL reaches logs, proxies, and browser history, so nothing outside paging is ever accepted there. A cursor is a position, not authority — the acting account comes from the credential and every row is re-authorized on every page.

## Phase and decisions

V1 contract registry and test discipline follow the unaffected contract portions of [ADR-0005](../decisions/ADR-0005-backend-api-architecture.md) and active backend [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). Exact error-code catalogue is defined per domain/endpoint without changing the common envelope. The registry declares the durable failures every operation can produce — `404`, `413` `PAYLOAD_TOO_LARGE`, `500` `INTERNAL_ERROR`, and `503` `SERVICE_UNAVAILABLE` — because they are enforced around routing rather than inside a handler, so the generated OpenAPI document and client expose them. The `503` is the capacity refusal from [ADR-0019](../decisions/ADR-0019-database-connection-admission.md): the instance had no room to begin the request, it carries `Retry-After`, and the two health probes are exempt because an instance at its limit must still be able to report its own state. The `404` carries `HTTP_404` when no route matches and `RESOURCE_NOT_FOUND` when a product handler refuses to distinguish absent from invisible; the published description states that the two cases are indistinguishable rather than pinning one code. Parity tests compare method, path, every declared status, its response schema, and the correlation-identifier header in both directions, and the request body limit is declared once in `@velora/validation` and consumed by the runtime. GraphQL requires a future feature ADR and is not a default. See [contracts/events](../architecture/04-contracts-events.md), [RBAC](../security/02-access-control-rbac.md), [testing/release](05-testing-release.md).

## Implemented consumer client boundary

`@velora/consumer-client` is the one client architecture both consumer surfaces use. It owns the typed calls against the generated OpenAPI client, the classification of an answer into a product result, and the pure readings of server state the surfaces render — the admission stage, the media state, the availability view, the account standing, and what a failure is allowed to say.

What differs between surfaces is only how a request proves who is making it, and that is injected: Consumer Web sends an `HttpOnly` cookie the script cannot read plus a CSRF echo; Consumer Mobile sends a short-lived bearer token from platform-keystore-backed storage. Neither detail appears in the product methods, which is what keeps one client rather than two that drift.

`scripts/check-boundaries.mjs` lists the package as client-safe. It depends on `@velora/api-client` and nothing else, so nothing server-side can reach a consumer surface through it.

Three rules the surfaces hold to:

- **A refusal is never interpreted.** `docs/domains/trust-safety.md` requires a blocked pair to be indistinguishable from an absent one, so a client that translated a refusal into "they blocked you" would create the disclosure the API withheld. Unrecognised product codes fall back to one honest generic sentence and are never shown raw.
- **A retry is offered for a condition, never for a decision.** An unreachable server may succeed on the next try; a refusal will refuse again.
- **503 is read by its code, not by its status.** `DEPENDENCY_UNAVAILABLE` says a required external capability is not configured in this environment, and the surfaces say exactly that rather than inviting somebody to retry at a provider that does not exist. `SERVICE_UNAVAILABLE` says the opposite kind of thing: the instance had no capacity to begin the request, nothing was decided, and retrying is the right move — so clients fold it into the generic unavailable state they already offer a retry for. Neither body says anything about pools, connections, or the caller.
