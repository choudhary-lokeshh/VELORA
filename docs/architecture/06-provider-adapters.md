# Provider adapter boundaries

## Purpose and scope

Keep product/domain logic vendor-neutral. Each owning domain defines a port, normalized capability/error model, test double, and adapter. UI and unrelated domains never call vendor SDKs directly.

| Capability | Owning domain | Port responsibility |
|---|---|---|
| Payments | BILLING | intent/reserve, confirm, refund, verified webhook normalization |
| RTC/video | REALTIME | create an isolated session, issue participant-scoped short-lived join grants, revoke a participant, end a session, read current state for reconciliation, normalize verified events |
| Storage/media | PRIVATE CLUBS or owning content domain | quarantine upload, scan, private object, signed delivery |
| Email/push/SMS | NOTIFICATIONS / AUTH for OTP policy | send attempt, provider status, template capability |
| Identity/age/creator/commercial verification | IDENTITY ASSURANCE; owner domains decide product predicates | capability declaration, hosted session, retrieval, raw callback verification/normalization, current-state reconciliation, declared cancellation/expiry |
| Moderation | MODERATION | submit evidence, normalized signal, human review route |
| Analytics | ANALYTICS | event export, consent-aware delivery |
| Creator payouts | PAYOUTS | recipient readiness, transfer/disbursement, verified webhooks |
| AI models/embeddings | AI PLATFORM | generation, structured output, embeddings/classification where approved, streaming/cancellation, normalized usage/errors, model capability metadata |

Initial development uses local/mock/test adapters for every integration. Real providers require a provider-specific technical ADR, owning-domain contract, security/privacy/compliance review, country/channel approval, test/evaluation evidence, reconciliation/incident behavior, observability, and operations owner. No provider is selected by this document.

## Failure, security, and test behavior

Adapters use timeouts, bounded retry only for safe/idempotent operations, circuit isolation, redacted structured logs, and provider event verification. Persist provider request/response references, never raw credentials/card data. A local/mock adapter supports deterministic tests and development without paid services. Real adapter selection is configuration injected at composition root.

AI routing may select only evaluated adapters/models approved for capability, data class, country/residency, safety, latency, and cost policy. Fallback must preserve or strengthen these constraints. Provider/model identifiers and request shapes stay outside product/domain contracts; provider output remains untrusted and schema-validated.

Identity routing is server-only. No route, header, query, or client field selects provider, provider workflow, assurance strength, or jurisdiction policy. `unavailable` is the default and `local-test` is network-free and rejected in staging/production. Raw callback authenticity is verified before parsing; the durable inbox stores a digest and normalized allow-list only. Hosted links are short-lived secrets and never become durable product data. See [ADR-0024](../decisions/ADR-0024-identity-assurance-architecture.md) and [provider eligibility](../compliance/09-identity-verification-provider-eligibility.md).

## Preconditions and phase

Provider action requires owning-domain authorization and operation ID. V1 may use mocks/local implementations; no production provider connection by default. `DECISION REQUIRED`: providers, country availability, mobile/channel compatibility, data processing terms, and cost limits before production rollout.

## Implemented: the payment adapter boundary

The payment port in `apps/api/src/billing/provider.ts` is the reference shape for the rest. It declares every provider interaction the domain will ever need rather than growing one method at a time, because the interface is what a candidate provider is assessed against; callers arrive per phase and the unimplemented ones refuse.

Two adapters exist. `unavailable` rejects every call and is the only value staging and production accept. `local-test` is deterministic, in-process, and reaches no network; it exists so the orchestration *around* a provider — idempotent retries, ambiguous outcomes, verified events — is exercisable before any provider is approved, and it is named so no passing test can be read as evidence about a real one.

Selection is one configuration value read at the composition root, validated by the schema, and rejected at startup outside local and test. There is no route, header, query parameter, or request field that reaches a different adapter, which is the difference between a test double being unreachable and merely being unused.

## Cross-references

[Payment lifecycle](../flows/payment-lifecycle.md), [RTC lifecycle](../flows/rtc-lifecycle.md), [AI platform](../ai/01-ai-platform-architecture.md), [AI evaluation](../ai/05-ai-observability-budgets-evals.md), [media delivery](../security/04-media-upload-delivery.md), [payment webhooks](../security/05-payments-webhooks.md), [market entry](../compliance/01-market-entry-gates.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).
