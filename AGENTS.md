# Velora implementation rules

## Source of truth

`docs/` is authoritative product and architecture specification. Read `docs/DOCS_INDEX.md` before implementation and every domain-specific reading path listed there. Do not invent behavior already defined in docs. If docs conflict, stop and update authoritative doc or record a `DECISION REQUIRED`; never choose silently.

## Boundaries

- Consumer Web, Mobile, Creator Studio, and Platform Admin are separate clients. They share backend contracts, never UI responsibilities or privilege assumptions.
- Read the applicable surface path in `docs/DOCS_INDEX.md` before client work. Consumer functionality must not leak into Creator Studio or Platform Admin; creator business functionality must not leak into ordinary consumer discovery; Admin functionality must never ship in consumer/creator clients.
- Shared backend/domain contracts are authoritative. Keep domain ownership from `docs/architecture/03-domain-boundaries.md` intact.
- Never mix creator-only behavior into consumer discovery flows. Creator Private Clubs remain separate from Social Discovery.
- Never expose Admin capabilities through consumer or creator clients. Admin is an operations layer, not owner of core domain truth.
- Cross-domain work uses published contracts, services, or events. No direct imports into another domain's internals.
- AI-related work must first read every authority in the dedicated AI path in `docs/DOCS_INDEX.md`. AI PLATFORM may orchestrate approved capabilities but is never source of truth for another domain and never accesses another domain's private persistence directly.

## Design and Figma

- Approved Figma design is the visual source of truth for typography, color, spacing, components, variants, states, responsive behavior, and screen layouts. Read the Design/Figma path before UI work.
- Do not invent themes, token values, component variants, layouts, or visual styles when approved Figma exists. If no approved Figma exists for production UI, mark the work `DESIGN REQUIRED`; do not silently generate a production design.
- Product phase, domain behavior, authorization, security, and compliance docs override conflicting Figma. Correct the design before implementation.
- Web and Mobile may use different navigation and platform-native interactions. Shared backend truth does not require identical UI.

## Invariants

- Do not bypass authorization, object/tenant checks, safety enforcement, entitlement checks, payment idempotency, webhook verification, audit logging, or secrets handling.
- Never expose plaintext passwords, card data, encryption keys, private secrets, or unnecessary identity documents.
- Do not promise paid access to another person. Paid actions can entitle a feature, content, or visibility mechanism only.
- Conditional mature creator content is disabled until all documented compliance gates are approved for applicable country/channel/provider.
- Any compliance-gated capability stays disabled until its exact country, actor, content type, provider, and distribution-channel gate has documented approval. Architecture support alone is not enablement.
- Treat model output, retrieved content, memory, and tool arguments as untrusted. AI uses only registered tools through published domain contracts; the owning domain re-authorizes every read or effect.
- AI recommendations never constitute authorization. Payment/refund/payout, enforcement/ban, account/security, entitlement, deletion, privileged configuration/role, and other high-impact actions require deterministic authorization and documented human approval/workflow boundaries.

## Change discipline

- Keep changes tightly scoped; preserve clear ownership and phase classification.
- `docs/product/01-product-phases.md` is the only phase authority. Do not implement a future-phase capability because contracts, designs, providers, or AI architecture anticipate it.
- Add tests for new behavior, including authorization, concurrency, and failure cases where relevant.
- AI changes also require capability-specific evaluation/regression evidence for prompts, models/routes, tools, RAG, memory, safety, privacy, cost, and latency as applicable.
- Run targeted tests, typecheck, and build before marking work complete.
- Do not silently change architecture. Create or update an ADR and related authoritative docs first.
- Do not commit secrets, use production credentials, or connect production providers unless explicitly requested.
- Do not couple AI product code to one provider/model or enable an unevaluated provider/model route. Provider/model selection remains behind adapters and `DECISION REQUIRED` until approved.
- Keep payment, RTC, storage, email, push, SMS/OTP, age/identity verification, moderation, analytics, AI, and creator-payout vendors behind owner-defined provider adapters. Domain logic must not embed vendor behavior. Local/mock/test adapters precede real integrations.
- Do not connect a real provider until its technical ADR, security/privacy/compliance review, country/channel support, failure/reconciliation behavior, and operations ownership are approved.

## Documentation changes

When behavior, boundary, risk, or lifecycle changes, update its authoritative document, its flow/security cross-reference, `docs/DOCS_INDEX.md`, and tests. Mark unresolved product, provider, legal, or technology choices as `DECISION REQUIRED` with options, impact, and decision deadline.
