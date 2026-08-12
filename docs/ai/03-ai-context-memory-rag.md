# AI context, memory, and RAG

## Purpose and authority

This document is the primary authority for AI context construction, isolation between actor contexts, short-term context, durable AI memory, and retrieval-augmented generation (RAG). Domain records and approved platform documents remain authoritative; AI context and indexes are derived views.

## Context construction contract

Context Builder assembles only data required for one approved capability. Each item records source owner, source/reference ID, actor/object scope, data class, purpose, authorization basis, consent basis where applicable, version/time, trust label, freshness, retention behavior, and deletion linkage.

Instruction channels are separated from user text, conversation content, memory, retrieved documents, attachments, and tool results. All non-platform-policy content is treated as data. Context is allowlisted by field and bounded by size, age, retrieval count, and sensitivity.

## Context classes and isolation

| Context class | Allowed content | Isolation rule |
|---|---|---|
| Current request | Authenticated actor input and explicit attachments | One request/capability; no implicit reuse |
| Conversation context | Bounded fragments actor is currently authorized to access | Conversation and participant scoped; block/access changes invalidate reuse |
| Durable preferences/user memory | Explicit or derived preference under approved purpose and consent basis | Subject and capability scoped; never treated as domain fact |
| Creator context | Creator-owned business/content projections and current creator authorization | Creator entity scoped; no leakage into ordinary consumer discovery |
| Platform knowledge | Approved policies, procedures, help content, and product documentation | Versioned corpus with owner and publication status |
| Admin context | Role/object-scoped operational projections and approved procedures | No broader visibility than direct Admin workflow; sensitive reads audited |
| Moderation context | Assigned case evidence references and policy material | Case/queue scoped; evidence and AI inference remain distinct |

Context from different users, creators, clubs, cases, or Admin operators must not be silently mixed. Cache and retrieval keys include actor/tenant/creator scope, data class, capability, authorization version, and deletion/consent state as relevant.

## Short-term context

Short-term context is run- or session-scoped and expires quickly. It may contain current request, authorized tool results, bounded conversation excerpts, and retrieved knowledge. It is not durable memory and must not become durable because a provider logs requests, a cache outlives the run, or an operator reviewed a trace.

Short-term retention, provider logging, and cache TTL are set by capability/data class. Revoked access, block, deletion, consent withdrawal, or high-risk incident can invalidate it before nominal expiry.

## Durable AI memory

Durable memory is optional and disabled unless a product capability defines purpose, owner, lawful/consent basis, write rules, visibility, correction, retention, security, and deletion. Users receive appropriate controls to inspect, correct, disable, or delete memory where required.

Memory may store narrowly scoped preferences or explicit user-provided facts with provenance, confidence where derived, expiry, and last-confirmed time. It must not store credentials, authentication/recovery secrets, raw payment data, identity documents, safety evidence, internal moderation rationale, hidden traits about another person, or inferred private facts without separately approved purpose.

Domain truth always wins. Contradictory, stale, or revoked memory is ignored and repaired or deleted. Memory cannot grant roles, eligibility, entitlement, relationship state, safety status, payment status, or approval.

## RAG and platform knowledge

RAG may index approved platform knowledge and actor-authorized content. Corpus registration records owner, source authority, audience, data class, country/language, publication state, freshness target, ingestion method, chunking/embedding versions, citation format, access policy, retention, and removal SLA.

Source documents remain authoritative. Chunks, embeddings, indexes, reranker results, and summaries are disposable projections. Retrieval rechecks actor/object access and current corpus state at query time. Results include provenance and source version; citations show retrieval, not guaranteed truth.

Private or privileged corpora use separate namespaces and authorization filters. Public web content enters only through approved SSRF-safe egress and quarantine. Retrieved instructions cannot alter system policy, tools, scopes, approval requirements, or retrieval depth.

## Ingestion, poisoning, and deletion

Ingestion validates source, owner, content type, size, malware/active content, publication state, and authorization before indexing. Untrusted content is trust-labeled and cannot be promoted to platform policy without human-controlled publication. Corpus changes and embedding/chunking changes trigger evaluation.

Source deletion, access revocation, account deletion, consent withdrawal, content removal, creator suspension, or retention expiry propagates to chunks, embeddings, indexes, caches, memory, evaluation samples, and provider deletion workflows. Rebuildable projections are deleted rather than retained as hidden truth. Failures retry durably and alert; stale sensitive data is not silently served.

## Privacy and observability

Context content is not copied into generic logs or ANALYTICS. Operational traces store minimized source identifiers, classifications, and authorization outcomes. Human inspection of sampled content requires explicit purpose, scoped access, retention, audit, and legal/privacy approval.

## Phase and open decisions

No durable memory or private-data RAG exists merely because AI architecture is documented. See [AI safety/security](04-ai-safety-security.md), [privacy/retention](../security/03-privacy-retention.md), [data ownership](../architecture/05-data-ownership.md), and [account deletion](../flows/account-deletion.md).

`DECISION REQUIRED`: memory capabilities and consent UX, retention/visibility, eligible corpora, corpus owners, private indexing policy, vector/index technology, embedding routes, chunking and freshness rules, deletion SLA, citation policy, and provider retention/deletion verification.
