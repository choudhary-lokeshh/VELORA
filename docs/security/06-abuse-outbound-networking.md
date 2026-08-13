# Abuse controls and outbound networking

## Purpose

Define anti-abuse baseline and SSRF-safe external-request boundary. Applies to public APIs, auth, reports, messaging, media processing, webhooks, provider adapters, and Admin tools.

## Abuse controls

Rate limit by action/risk across account, session, IP/device and target dimensions without making any one signal sole truth. Bound payloads, uploads, pagination, fan-out, retries, and queues. Detect unusual signup, messaging, report, payment, invitation, upload and Admin activity; use progressive friction/restriction and auditable review. Do not reveal detection thresholds or enforcement details to abusive actors.

## SSRF-safe outbound rule

No component fetches arbitrary user/admin-supplied URL directly. When an approved feature requires outbound retrieval, use allowlisted schemes/hosts where feasible; validate controlled DNS resolution and every returned IPv4/IPv6 address, including IPv4-mapped IPv6; block loopback, private, link-local, multicast, unspecified, reserved, carrier-grade NAT and metadata endpoints; bind connection to a validated address with hostname/TLS verification to limit DNS rebinding; disable redirects or revalidate scheme/host/port/DNS/IP at every hop; constrain methods, ports, connect/read/total timeouts, response bytes, decompression, nested fetches and content type; strip credentials/cookies/internal headers; isolate egress from private networks; and redact URL query secrets from logs. Provider endpoints come from trusted config, not request data.

Bootstrap is deny-all. The API composition root registers the `OutboundHttp` port with a deny adapter and exposes no retrieval route. Backend source may not directly use global/Bun `fetch`, Bun socket APIs, `WebSocket`, `EventSource`, `XMLHttpRequest`, `navigator.sendBeacon`, Node HTTP/HTTPS/HTTP2/net/TLS/datagram modules (including aliases, object-property aliases, type assertions, or dynamic imports), `undici`, or an unapproved HTTP client dependency. ESLint and the repository boundary parser enforce these rules across every workspace the backend runtime can import — derived from the workspace dependency graph, so a new module in a server-capable package is covered on creation — and dependency-policy tests detect disallowed package additions. These checks are defense in depth; future enabled egress also requires network isolation/firewall policy and the complete validation contract above. Only an approved adapter implementation may own such primitives after its architecture/security review and negative tests.

AI models have no general-purpose network tool. User-supplied, admin-supplied, attachment-derived, retrieved, or model-generated URLs all use the same isolated egress service. Each redirect and nested fetch requires policy validation; returned content is quarantined, size/type limited, converted to inert data, and trust-labeled. Retrieved instructions cannot expand AI tools, permissions, budgets, or fetch scope.

## Failure/security/phase

Blocked request fails safely and is observable; retry only verified trusted endpoints. URL validation results are not authorization. HTTPS-only controlled egress and the isolated retrieval boundary are locked by [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md); the active deny-all Bun composition is locked by [ADR-0016](../decisions/ADR-0016-bun-elysia-redis-bullmq-backend.md). `DECISION REQUIRED`: rate-limit budgets, risk scoring, bot-challenge policy, feature-specific destination/port allowlists, egress infrastructure provider, parser/sandbox policy, and incident thresholds. See [security baseline](01-security-baseline.md), [AI safety/security](../ai/04-ai-safety-security.md), [media](04-media-upload-delivery.md), [provider adapters](../architecture/06-provider-adapters.md).
