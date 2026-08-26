# AI product surfaces

## Purpose and authority

This document is the primary authority for allowed and forbidden AI roles across Velora product surfaces. [Product phases](../product/01-product-phases.md) remains the only phase authority. Surface documents own navigation and UI responsibility; business domains own state and authorization.

No AI product capability is V1. Documentation support does not enable a feature.

## Consumer AI

Phase 3 candidates include profile wording assistance, user-controlled conversation drafts, translation, explanation of discovery controls, and safety nudges. Each capability requires separate approval, evaluation, consent/privacy design, clear labeling, and user review before send/save.

Consumer AI must not autonomously send messages or introductions, select relationship outcomes, become DISCOVERY ranking truth, infer hidden/private traits, expose another person's private/safety status, impersonate another user, guarantee attention or relationships, or bypass block, report, age, monetisation, or entitlement rules.

## Creator AI

Phase 3 candidates include caption/content drafts, translation, organization, policy-aware preparation, explanation of authorized creator analytics, audience-support drafts, and moderation assistance. Creator remains publisher and actor; content, price, eligibility, and entitlement are revalidated by owning domains.

Creator AI must not publish, change price, grant/revoke entitlement, charge/refund, initiate payout, fabricate ownership/consent, assert compliance eligibility, or expose subscriber/private content beyond current authorization. AI never enables mature/explicit content unless every Conditional / Compliance-Gated requirement passes for country, creator, content, provider, and channel.

## Moderation and Trust & Safety AI

Phase 2 assistance may classify or prioritize signals, summarize assigned evidence, retrieve approved policy, identify anomalies, and draft recommendations. Output is labeled inference with provider/model/prompt version, source provenance, confidence/limitations, and reviewer correction path.

Human or deterministic policy remains authoritative. AI must not create evidence, silently merge accusation with fact, close appeals, determine bans/enforcement alone, or mutate content/account status. MODERATION owns review workflow; TRUST & SAFETY owns enforcement state.

## Admin AI

Phase 3 assistance may summarize operator-authorized projections, retrieve approved procedures, explain operational health or authorized analytics, surface anomalies, and draft support or operation requests.

Admin AI receives no broader data scope than operator's direct workflow. It must not become an unrestricted executor, run arbitrary queries/network requests, grant privilege, supply step-up authentication or approval, change configuration, or execute account/security, payment/refund/payout, entitlement, enforcement/ban, deletion, or sensitive-content actions.

## Human review and user control

Surfaces show when output is AI-assisted, what will happen before an effect, who remains responsible, and how to edit, reject, report, or retry safely. Sensitive recommendations expose source/provenance and limitations appropriate to role. Approval UI follows owning workflow, never a generic AI confirmation.

AI assistance must have non-AI fallback or safe unavailable state where necessary. Feature refusal, provider outage, budget exhaustion, or missing consent cannot silently perform a weaker or less safe action.

## Implemented local/test product proof

[ADR-0033](../decisions/ADR-0033-local-test-ai-suggestion-platform.md) implements the Phase 3-shaped surfaces against the deterministic local/test provider while production remains disabled:

- Consumer Web and Mobile: profile bio refinement and chat icebreaker/reply drafting with explicit Generate/Regenerate, editable suggestion, Use in draft, refusal, loading, and cancellation states. Use changes only local form state; Save and Send remain separate.
- Creator Studio: bio, title, caption, description, content-idea, and club-announcement scratchpad drafts with tone selection and explicit use. The announcement scratchpad states that it is neither saved nor published; all publication controls remain separate.
- Platform Admin: an editable review-only case note from bounded metadata/counts. It receives no report prose or evidence reference and exposes no AI-linked case action.

The controls remain labeled AI assistance and degrade to honest unavailable/refusal states. This implementation does not change V1 exclusion or approve a live provider, capability rollout, country, or production design handoff.

Real browser regression runs the normal Consumer and Creator surfaces against PostgreSQL, the API gateway, and the local/test adapter: a person generates and edits a bio before Save, edits a reply before explicit Send, and a creator edits a caption before the existing draft-save and Publish controls. Platform Admin remains inaccessible in a real browser because no approved route can issue its required audience and phishing-resistant assurance; its bounded context and no-action behavior are therefore proved at the generated client/component boundary and the authenticated API integration boundary without weakening that gate.

## Future autonomy boundary

Broader agentic capabilities are Future / Moonshot. Even then, AI cannot replace domain source truth, deterministic authorization, approval, entitlement, payment, safety, audit, privacy, or compliance gates. New surface capability needs phase change control, threat/privacy review, registered tools, evaluation, operations readiness, and rollback.

## Cross-references and open decisions

Read [capabilities/tools](02-ai-capabilities-tools.md), [AI safety/security](04-ai-safety-security.md), [consumer product](../product/02-consumer-product.md), [creator product](../product/03-creator-private-clubs.md), [Platform Admin](../product/04-platform-admin.md), [MODERATION](../domains/moderation.md), and [TRUST & SAFETY](../domains/trust-safety.md).

`DECISION REQUIRED`: exact launch capabilities, UX disclosure/consent, translation language set, human review expectations, user reporting/feedback, protected-trait policy, safety escalation, and per-capability rollout criteria.
