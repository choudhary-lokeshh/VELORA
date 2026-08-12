# Security baseline

## Purpose

Cross-cutting minimum security invariants for every future Velora component. Domain-specific authorities override only by becoming stricter.

## Required controls

- Authenticate every protected request; authorize every object/action in owner domain. Client assertions, hidden UI, and role labels alone are never authorization.
- Use TLS, secure transport headers, input validation, output encoding, CSRF defense where cookie sessions apply, safe redirects, secure session handling, and dependency/security regression testing.
- Treat all user content, provider payloads, webhooks, URLs, filenames, and uploaded metadata as untrusted.
- Treat AI model output, prompts, memory, RAG/retrieved content, generated tool arguments, and provider metadata as untrusted. AI does not authorize or approve actions.
- Enforce per-action rate limits, abuse monitoring, bot resistance appropriate to risk, and bounded resource use.
- Keep secrets in managed runtime stores; rotate/revoke and redact them from logs/errors. Never expose passwords, raw cards, keys, tokens, or private identity evidence.
- Record security-sensitive and privileged actions in immutable/restricted audit trail distinct from product analytics.

## Failure and incident behavior

Fail closed for authentication, authorization, entitlement, signature verification, and country/compliance gates. Use safe generic error to users and redacted correlated diagnostics internally. Isolate external provider failures, preserve durable state, and reconcile. Security incidents require access revocation/containment, evidence preservation, review, and documented remediation under [incident response](../operations/04-incident-response.md); exact severity, roles, and timelines are `DECISION REQUIRED`.

## Ownership and phase

Each domain owns security of its data/actions; platform composition owns shared controls. V1 mandatory. See [RBAC](02-access-control-rbac.md), [privacy](03-privacy-retention.md), [media](04-media-upload-delivery.md), [payments](05-payments-webhooks.md), [abuse/SSRF](06-abuse-outbound-networking.md), [AI safety/security](../ai/04-ai-safety-security.md), [compliance gates](../DOCS_INDEX.md#compliance-authority).
