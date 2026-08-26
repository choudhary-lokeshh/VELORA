# Security baseline

## Purpose

Cross-cutting minimum security invariants for every future Velora component. Domain-specific authorities override only by becoming stricter.

## Required controls

- Authenticate every protected request; authorize every object/action in owner domain. Client assertions, hidden UI, and role labels alone are never authorization.
- Use TLS, secure transport headers, input validation, output encoding, CSRF defense where cookie sessions apply, safe redirects, secure session handling, and dependency/security regression testing.
- Web surfaces send `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`. No deployment edge owns them yet, so each Next.js application sets them from one shared builder in request-time middleware, and end-to-end tests assert them on every surface; Platform Admin is never weaker than Consumer Web. `connect-src` names the exact API origin the surface may call, read from the environment when the server starts rather than baked into the build artifact; it is never a wildcard or a scheme-only source. `upgrade-insecure-requests` is unconditional for every deployed environment and is omitted only when the application environment is explicitly local or test and the configured API is a plain-HTTP loopback address, a combination client configuration refuses outside those environments. WebKit applies the directive to loopback origins that Chromium and Firefox exempt, which otherwise makes a local API unreachable from Safari entirely; every deployed combination is asserted in unit tests where the policy is built. Separately, WebKit does not store a `Secure` cookie delivered over plain-HTTP loopback, so browser tests that depend on the session cookie run on the browsers that do, and the cookie attributes are never relaxed to change that. The current policy allows inline scripts because Next.js hydration requires it; `next dev` additionally permits `unsafe-eval` only when both the product environment is local/test and the API is plain-HTTP loopback, because React's development stack reconstruction otherwise emits an error on every page. A production Next.js process remains on the deployed policy even when it uses local test data. A nonce-based policy needs request-time middleware and is deferred with the edge-provider decision in [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md). The API sets its own stricter policy.
- Treat all user content, provider payloads, webhooks, URLs, filenames, and uploaded metadata as untrusted.
- Identity-provider hosted links, redirects, callback bodies, retrieved results, provider-dashboard state, evidence references, and manual-review outcomes are untrusted. Verify callbacks over raw bytes before parsing, bind provider/account/environment/subject, and let only the owning domain authorize an effect.
- Treat AI model output, prompts, memory, RAG/retrieved content, generated tool arguments, and provider metadata as untrusted. AI does not authorize or approve actions.
- Enforce per-action rate limits, abuse monitoring, bot resistance appropriate to risk, and bounded resource use.
- Keep secrets in managed runtime stores; rotate/revoke and redact them from logs/errors. Never expose passwords, raw cards, keys, tokens, hosted verification URLs, callback bodies, or private identity evidence.
- Record security-sensitive and privileged actions in immutable/restricted audit trail distinct from product analytics.

## Failure and incident behavior

Fail closed for authentication, authorization, entitlement, signature verification, and country/compliance gates. Use safe generic error to users and redacted correlated diagnostics internally. Isolate external provider failures, preserve durable state, and reconcile. Security incidents require access revocation/containment, evidence preservation, review, and documented remediation under [incident response](../operations/04-incident-response.md); exact severity, roles, and timelines are `DECISION REQUIRED`.

## Ownership and phase

Each domain owns security of its data/actions; platform composition owns shared controls. V1 mandatory. See [RBAC](02-access-control-rbac.md), [privacy](03-privacy-retention.md), [media](04-media-upload-delivery.md), [payments](05-payments-webhooks.md), [identity threat model](11-identity-verification-threat-model.md), [abuse/SSRF](06-abuse-outbound-networking.md), [AI safety/security](../ai/04-ai-safety-security.md), [dependency risk acceptance](08-dependency-risk-acceptance.md), [session and privileged policy](../decisions/ADR-0017-auth-session-recovery-security-policy.md), [compliance gates](../DOCS_INDEX.md#compliance-authority).
