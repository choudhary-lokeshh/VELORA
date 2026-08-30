# Auth / authorization / security correctness audit

- Audit date: 2026-08-30
- Scope: Consumer, Creator, Platform Admin, sensitive actions, web/API security, auditability

## The result, stated first

**No authorization hole was found.** Every control this audit set out to verify was in place and correct: audience gating, ownership scoping, privileged assurance, origin and CSRF defences, error containment, and the audit trail behind operator actions.

What the audit found instead was three places where a correct guarantee was **not enforced by anything** — held by construction, and by nothing that would notice if the construction changed. Each is now proved, and each proof was checked by breaking the guarantee and watching the check go red. That is the whole of this phase's product: the guarantees did not move, the evidence did.

An audit that finds nothing wrong should say so plainly rather than manufacture findings. It should also be honest that "no hole found" is a statement about what was examined, and this examined the boundaries below rather than every line behind them.

## What was verified and already held

**Consumer.** Sign-in, sign-out, session expiry, and direct-route admission are exercised by the AUTH suites. Restricted-account behaviour, profile ownership, and conversation ownership each have hostile tests that answer a stranger exactly as they answer something absent — the distinction that matters, because telling the two apart discloses that the object exists.

**Creator.** Creator capability, creator-only routes, and content, club and profile ownership are covered, including `never lets one creator reach another creator commercial terms` and `never reports another creator's sales`. Financial read isolation on the creator side was already proved.

**Admin.** Every one of the 32 admin route handlers resolves an operator before it does anything else — audience first, assurance second, and both before any lookup on the caller's behalf. No Platform Admin session can be minted at all, because no approved verifier can produce the phishing-resistant assurance the routes require, so the surface is unreachable rather than merely guarded. Navigation is not permission here in the literal sense: the routes are published and the console renders them, and the server refuses each one independently.

**Web/API.** The error envelope is uniform — one stable code, a correlation id, and the words "Request failed" — so no route leaks state, policy, or another person's data through a message. Origin handling refuses a malformed or unlisted `Origin` outright, refuses cross-site Fetch Metadata, refuses a non-CORS mode on a state-changing request, and refuses an ambient cookie credential with no provable origin. CORS is exact origins from configuration, never a wildcard, with `Vary: Origin` emitted whether or not the origin matched so no shared cache can serve one origin's credentialed reply to another. Logging redaction is asserted at root, nested, and deeply nested depths.

**Auditability.** Operator actions write an audit row through the owning domain's own service with an actor and a reason, and — the property worth having — an operation that could not be applied writes no audit row at all.

## Fixed: three guarantees that nothing was enforcing

### 1 · The contract and CORS agreed, and nothing said they had to

A custom request header makes a cross-origin request preflighted. If `access-control-allow-headers` does not name it, the browser never sends the request, and what the surface reports is that VELORA could not be reached — indistinguishable from the API being down.

This has already happened once, to `x-velora-idempotency-key`. Every jsdom suite in the repository passed throughout, because a `fetch` double has no preflight. Nothing short of a real browser talking to a real API across two origins can observe it, and no test does that for every operation.

`scripts/check-cors-contract.mjs` now reads the generated OpenAPI document and `apps/api/src/http/cors.ts` and fails when they disagree, in both directions: a declared header CORS omits is a request no browser will make, and an `x-velora-*` allowance no operation declares is a permission granted for no reason. It runs inside `pnpm contracts:check`. Verified by removing the idempotency header — it reproduces the historical bug exactly, naming the operation — and by adding an allowance nothing declares.

### 2 · Consumer financial reads were owner-scoped, and only one of them was tested

`listSent` takes the caller's own user id; so do the subscription, payment and club-access reads. None of them has ever been able to answer with somebody else's row.

The test that existed proved a buyer sees their own gift — which is precisely the assertion that keeps passing on the day the scope is dropped. A stranger now signs in against the same application, with the same origin and session shape, and asks all four questions. Every answer must be **empty rather than refused**: whether somebody else has bought anything is not a fact this account is entitled to learn either way, and a 403 would answer it. Verified by removing the sender predicate from `listSent` and watching the test fail.

### 3 · The admin route sweep spoke for the whole surface and probed a quarter of it

Three tests named "the operator surface exists and reaches nobody" walked a hand-written list of operations. That list held 8 of the 32 `/v1/admin` paths the contract publishes, and four paths — disputes, one payment read, and both notification reads — were not touched by any suite in the repository.

The controls were never wrong. But a list somebody has to remember to extend is a list that eventually is not extended, and the failure is silent: the route works, the sweep stays green, and nothing says the new address was never asked the question. This is the same shape as the deep-link section list [ADR-0039](../decisions/ADR-0039-consumer-mobile-device-refinements.md) replaced, in a place where the cost of missing one is higher.

The sweep now enumerates the paths from the OpenAPI document, so it covers the surface by construction and grows with it. Every address is probed with a consumer session, a Creator Studio session, and no session; every one must be 403, 403, and 401-or-403. `{}` is sent as the body of every write deliberately — a schema refusal instead of an authorization refusal would itself be a finding, because it would mean the route parsed a stranger's input before deciding whether the stranger was allowed to be there. Verified by removing the operator resolution from `/v1/admin/notifications/state`, one of the four addresses nothing had ever probed; the sweep fails and names the route.

## Noted, not changed

`RealtimeReconciliation` writes a provider client's own error text into a column an operator reads, while the comment beside it says the message must be this domain's words rather than a vendor's. It reaches no client and no consumer surface, and the RTC provider is `unavailable` in every environment, so the path is currently dead. It is recorded here rather than changed, because the diagnostic value is real and the risk — a provider echoing a credential into an error string — is hypothetical until a provider exists.

## Cross-references

[Data integrity audit](26-data-integrity-audit.md),
[ADR-0009](../decisions/ADR-0009-auth-authorization.md),
[ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md),
[ADR-0036](../decisions/ADR-0036-platform-admin-operations-console.md), and
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
