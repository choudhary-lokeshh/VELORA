# Velora implementation rules

## Source of truth

`docs/` is authoritative product and architecture specification. Read `docs/DOCS_INDEX.md` before implementation and every domain-specific reading path listed there. Do not invent behavior already defined in docs. If docs conflict, stop and update authoritative doc or record the appropriate unresolved classification; never choose silently.

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
- `packages/design-tokens` may contain only approved cross-surface primitive and semantic design contracts. It must not contain components, navigation, copy, permissions, privilege assumptions, business state, or unapproved visual values.
- The approved Master Visual Language remains authority while Figma Starter prevents production multi-mode variables. Do not create fake Figma modes or invent replacement themes; use documented code-level semantic contracts and preserve unresolved design items explicitly.

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
- Do not suppress, filter, or lower the dependency security gate. An unavoidable transitive advisory is recorded in `docs/security/08-dependency-risk-acceptance.md` with exact package, version, advisory ID, dependency chain, reachable workspaces, reachability, compensating controls, named owner, and a hard expiry no longer than 90 days, or it fails CI. An audit that cannot run is a failure, never a pass.
- Do not choose session, recovery, step-up, or break-glass constants during implementation. Those values are locked in ADR-0017 and asserted by `pnpm auth:policy`; changing one requires editing the ADR and the locked baseline together, with an ADR amendment and security review. Do not restate a locked value in another document; point at ADR-0017.
- Do not change a pinned runtime version in one place. Bun, Node, and pnpm are declared in `mise.toml`, `package.json#engines`, `.node-version`, and `.bun-version`, and `pnpm toolchain:check` fails when they disagree. Provision them with `mise install`; see ADR-0018.
- Do not couple AI product code to one provider/model or enable an unevaluated provider/model route. Provider/model selection remains behind adapters and `DEFER UNTIL PROVIDER INTEGRATION` until approved.
- Keep payment, RTC, storage, email, push, SMS/OTP, age/identity verification, moderation, analytics, AI, and creator-payout vendors behind owner-defined provider adapters. Domain logic must not embed vendor behavior. Local/mock/test adapters precede real integrations.
- Do not connect a real provider until its technical ADR, security/privacy/compliance review, country/channel support, failure/reconciliation behavior, and operations ownership are approved.

## Technical implementation

- Before repository bootstrap or code changes, read `docs/architecture/09-technical-stack.md` and every ADR in its relevant technical implementation path in `docs/DOCS_INDEX.md`.
- Do not add or replace a framework, runtime, database, queue, broker, workflow engine, API style, auth/session mechanism, realtime protocol, deployment topology, or infrastructure tool without amending or superseding its ADR.
- Clients import only client-safe contracts/packages. They never import `packages/domain`, repositories, Drizzle schemas, Elysia application internals, workers, or provider SDKs.
- Domain modules never import another domain's private repository/table/entity/provider implementation. Admin, AI, jobs, and migrations use owning application services/contracts for business mutation.
- No correctness-critical state may live only in process memory or ephemeral Redis. BullMQ queue Redis is durable infrastructure, but PostgreSQL remains authoritative for business state; high-impact handlers require idempotency and reconciliation. No provider-specific business rule may escape its adapter.
- pnpm/Turborepo own the workspace and task graph. Bun runs API, worker, migration, and compatible backend-test code; Node runs client and repository tooling that requires it. Do not introduce a second package-management model or execute backend production entrypoints on Node.
- No migration ships without real PostgreSQL migration/compatibility tests. No financial or external-effect flow ships without documented idempotency, concurrency, ambiguous-outcome, reconciliation, and compensation tests.

## Documentation changes

When behavior, boundary, risk, or lifecycle changes, update its authoritative document, its flow/security cross-reference, `docs/DOCS_INDEX.md`, and tests. Classify unresolved choices using the technical stack vocabulary where applicable; record options, impact, and decision deadline.

Before completing every implementation or architecture task, perform a documentation-impact audit. Update existing authorities when implementation changes durable product behavior, ownership, lifecycle, contracts/events, security, authorization, data/migrations, idempotency/concurrency, provider boundaries, operations, testing, deployment/runtime, or design implementation rules. Create a new document only for genuinely new durable knowledge and a new ADR for a significant architecture/platform/provider decision or change to a locked decision. Keep `docs/DOCS_INDEX.md` synchronized when a document or reading path changes. Do not document trivial helpers, refactors, formatting, or ordinary implementation detail. Report documentation impact, ADR need, index impact, and any documentation-code drift at task completion.
