# Provider adapter boundaries

## Purpose and scope

Keep product/domain logic vendor-neutral. Each owning domain defines a port, normalized capability/error model, test double, and adapter. UI and unrelated domains never call vendor SDKs directly.

| Capability | Owning domain | Port responsibility |
|---|---|---|
| Payments | BILLING | intent/reserve, confirm, refund, verified webhook normalization |
| RTC/video | REALTIME | issue scoped session credentials, room lifecycle, quality webhooks |
| Storage/media | PRIVATE CLUBS or owning content domain | quarantine upload, scan, private object, signed delivery |
| Email/push/SMS | NOTIFICATIONS / AUTH for OTP policy | send attempt, provider status, template capability |
| Identity/age verification | CREATORS / AUTH policy | verification session, outcome reference, revocation |
| Moderation | MODERATION | submit evidence, normalized signal, human review route |
| Analytics | ANALYTICS | event export, consent-aware delivery |
| Creator payouts | PAYOUTS | recipient readiness, transfer/disbursement, verified webhooks |
| AI models/embeddings | AI PLATFORM | generation, structured output, embeddings/classification where approved, streaming/cancellation, normalized usage/errors, model capability metadata |

Initial development uses local/mock/test adapters for every integration. Real providers require a provider-specific technical ADR, owning-domain contract, security/privacy/compliance review, country/channel approval, test/evaluation evidence, reconciliation/incident behavior, observability, and operations owner. No provider is selected by this document.

## Failure, security, and test behavior

Adapters use timeouts, bounded retry only for safe/idempotent operations, circuit isolation, redacted structured logs, and provider event verification. Persist provider request/response references, never raw credentials/card data. A local/mock adapter supports deterministic tests and development without paid services. Real adapter selection is configuration injected at composition root.

AI routing may select only evaluated adapters/models approved for capability, data class, country/residency, safety, latency, and cost policy. Fallback must preserve or strengthen these constraints. Provider/model identifiers and request shapes stay outside product/domain contracts; provider output remains untrusted and schema-validated.

## Preconditions and phase

Provider action requires owning-domain authorization and operation ID. V1 may use mocks/local implementations; no production provider connection by default. `DECISION REQUIRED`: providers, country availability, mobile/channel compatibility, data processing terms, and cost limits before production rollout.

## Cross-references

[Payment lifecycle](../flows/payment-lifecycle.md), [RTC lifecycle](../flows/rtc-lifecycle.md), [AI platform](../ai/01-ai-platform-architecture.md), [AI evaluation](../ai/05-ai-observability-budgets-evals.md), [media delivery](../security/04-media-upload-delivery.md), [payment webhooks](../security/05-payments-webhooks.md), [market entry](../compliance/01-market-entry-gates.md), [open decisions](../decisions/DECISIONS_REQUIRED.md).
