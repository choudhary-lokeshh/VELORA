# AI safety and security

## Purpose and authority

This document is the primary authority for AI-specific threat boundaries: prompt injection, malicious content, tool abuse, outbound retrieval, private-network protection, upload/media handling, PII, provider data handling, secret leakage, and output validation. General controls in [security baseline](../security/01-security-baseline.md) remain mandatory.

## Trust and safety model

A model is a probabilistic processor, not a principal, approver, policy engine, secret store, or source of truth. User input, conversation content, files, images, metadata, memory, RAG chunks, web pages, provider output, model output, tool arguments, and tool results are untrusted or differently trusted data.

Deterministic platform policy, registered capability configuration, authenticated actor intent, and owning-domain authorization take precedence. Prompt text is defense in depth, never an authorization boundary.

## Prompt-injection and tool-abuse defenses

- Separate system/capability policy from user, memory, retrieval, attachment, and tool-result data using explicit channels and trust labels.
- Minimize context and expose only capability-registered tools with bounded schemas.
- Never expose credentials, hidden system data, unrestricted code/query execution, direct storage access, or general network access to a model.
- Detect attempts to override policy, exfiltrate context, reveal prompts/secrets, add tools, expand scope, encode leakage, recurse, or exhaust budgets; deterministic controls remain effective even when detection misses.
- Re-authorize each read and tool call outside the model. Bind sensitive proposals to explicit human approval as defined by [capabilities/tools](02-ai-capabilities-tools.md).
- Validate and escape output for destination. Generated URLs, code, SQL, markup, commands, or configuration are inert drafts unless a separately approved capability validates and executes them through a bounded contract.
- Preserve source provenance and distinguish observed evidence, retrieved claims, model inference, and human decision.

Indirect prompt injection from RAG, websites, files, media metadata, messages, or tool results cannot change capability, system instructions, tool allowlist, actor scope, budgets, provider route, approval requirements, or fetch permissions.

## SSRF-safe outbound and web retrieval

AI has no general-purpose network tool. All user-supplied, admin-supplied, retrieved, attachment-derived, or model-generated URLs use a dedicated isolated egress service. Provider endpoints come only from trusted configuration.

For every request and redirect hop, egress must:

- allow only explicitly supported protocols, normally `https`; reject embedded credentials and unsafe schemes;
- canonicalize host/port and apply host/port allowlists where feasible;
- resolve DNS through controlled resolvers, validate every returned IPv4 and IPv6 address, and reject IPv4-mapped IPv6 forms that map to blocked ranges;
- block loopback, private, link-local, multicast, unspecified, reserved, carrier-grade NAT, documentation, and cloud/container metadata ranges as policy requires;
- connect only to a validated resolved address while preserving hostname/TLS verification, then revalidate on new resolution to limit DNS rebinding;
- disable redirects by default or cap and revalidate scheme, host, port, DNS, and IP on every hop;
- use bounded methods, ports, connection/read/total timeouts, response bytes, decompression ratio, nested resources, and content types;
- strip cookies, authorization headers, internal headers, client certificates, and URL query secrets unless a specific trusted connector contract requires them;
- prevent direct access to private networks and isolate egress credentials and runtime from application networks;
- quarantine active content, malware, archives, media metadata, and parser-risk formats before conversion to inert text/data.

Retrieval results cannot trigger another request or tool without a new policy decision. Blocked or ambiguous resolution fails closed and records a safe security signal. URL validation does not authorize content access.

## Upload and media safety

AI processing of uploads inherits [media upload/delivery](../security/04-media-upload-delivery.md): purpose-bound upload session, size/count/type limits, magic-byte validation, malware scan, metadata controls, decompression/transcoding limits, quarantine, and owner-controlled publication. Media content and metadata remain untrusted. Private media cannot be sent to an AI route unless capability, entitlement, data class, provider terms, country/channel policy, consent, and retention all permit it.

## PII, privacy, and provider controls

Before provider transmission, classify purpose and fields; enforce actor/object authorization, field allowlists, minimization, redaction/tokenization/pseudonymization, residency, retention, and route eligibility. Raw card data, passwords, authentication/recovery secrets, encryption keys, unnecessary identity documents, unrelated third-party data, and private moderation evidence must not enter AI context.

Provider contracts and configuration must define training use, retention, human review, subprocessors, region, deletion, breach handling, and logging. Provider deletion is not assumed complete until verified through the approved process. Sensitive content sampling requires explicit purpose, role-scoped access, encryption, audit, retention, deletion propagation, and legal/privacy review.

## Output and surface safety

Structured output is strictly parsed and semantically validated. Free text is labeled as assistance, escaped, length-limited, and filtered according to capability. Unsafe, ambiguous, hallucination-sensitive, or unsupported output is refused, corrected within bounded policy, or sent to human review.

Consumer and creator AI cannot impersonate another person, autonomously send/publish, infer hidden/private traits without approved purpose, expose safety status, promise relationship outcomes, or bypass entitlement/content gates. Moderation AI cannot invent evidence or authorize enforcement. Admin AI cannot broaden visibility or execute privileged operations.

## Incident response

Suspected injection, data leakage, unsafe tool attempt, poisoned corpus, route compromise, or provider behavior change can suspend capability, route, tool, memory, or corpus through deterministic controls. Preserve redacted evidence, revoke exposed access, rotate affected secrets, invalidate unsafe derived data, notify security/privacy/domain owners, assess impacted users and providers, and require regression evidence before re-enable.

## Implemented local/test controls

The first [local/test suggestion slice](../decisions/ADR-0033-local-test-ai-suggestion-platform.md) accepts only a bounded draft and optional already-authorized context projection. Deterministic input minimization strips control characters and rejects credential/token-shaped content plus common policy-override or prompt-exfiltration instructions before durable admission. Provider output is capped at 2,000 characters and strict-parsed into the public response contract. Generic logs and AI tables retain metadata/digests only.

Consumer and Creator surfaces pass only the actor's current editable draft. They pass no counterpart profile, conversation transcript, or hidden/safety state. Admin passes case state, queue, priority, target type, policy version, counts, and latest category timestamps only; report prose, evidence references, target identity, and raw safety evidence are excluded by construction and regression test. No tool, retrieval, memory, RAG, network client, or provider secret is available to the model adapter.

## Phase and open decisions

Controls are required before any AI capability in its approved phase. See [AI platform](01-ai-platform-architecture.md), [context/memory/RAG](03-ai-context-memory-rag.md), [outbound networking](../security/06-abuse-outbound-networking.md), and [incident response](../operations/04-incident-response.md).

HTTPS-only controlled egress and isolated retrieval are locked by [ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md). `DECISION REQUIRED`: threat-review owner, feature-specific destination/port allowlists or protocol exceptions, provider data terms, content-sampling policy, AI incident severity/SLA, protected-trait inference policy, and per-capability safety/refusal standards. Country-specific questions require `LEGAL REVIEW REQUIRED`.
