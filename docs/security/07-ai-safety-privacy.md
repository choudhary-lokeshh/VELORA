# AI security integration boundary

## Purpose

Bind AI work to Velora's general security, privacy, access-control, media, and outbound-networking authorities. Dedicated [AI safety and security](../ai/04-ai-safety-security.md) is primary authority for AI-specific threats and controls.

## Invariants

- Treat prompts, model output, memory, RAG/web content, attachments, tool arguments/results, and provider metadata as untrusted data.
- Prompt text, model confidence, AI recommendations, and AI-generated approval never authorize an action.
- Models receive no unrestricted tools, code/query execution, service credentials, private persistence, or general network access.
- Owning domain re-authorizes every read/effect; high-impact actions require existing human approval/workflow.
- AI context and provider transmission inherit source data classification, purpose, country/residency, retention, consent, deletion, and audit rules.
- All outbound/web retrieval uses hardened egress from [abuse/outbound networking](06-abuse-outbound-networking.md); private-network access fails closed.
- Output is schema/semantically validated and escaped for destination; generated content is not executed directly.

## Required reading

Read [AI safety/security](../ai/04-ai-safety-security.md), [AI context/memory/RAG](../ai/03-ai-context-memory-rag.md), [AI capabilities/tools](../ai/02-ai-capabilities-tools.md), [privacy/retention](03-privacy-retention.md), [RBAC](02-access-control-rbac.md), and [AI-assisted action](../flows/ai-assisted-action.md).

Controls apply before any AI capability in its phase. Country-specific and provider data questions remain `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.
