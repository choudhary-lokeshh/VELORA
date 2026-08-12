# Market entry gates

## Purpose and status

Define architecture and product controls required before enabling Velora in a country or distribution channel. This is not legal advice. Country-specific conclusions remain `DECISION REQUIRED / LEGAL REVIEW REQUIRED`.

## Gate model

ADMIN owns approved country/channel feature configuration and audit; business domains enforce it at action time. A launch record identifies country/region, channel, capability, audience, minimum age/adult proof, identity/creator requirements, content classes, payment/payout support, data region, provider routes, policy/legal versions, operational owner, approval, effective time, and rollback/disable plan.

Capability is enabled only when all applicable gates are approved:

- product phase and product owner;
- adult age and identity assurance;
- consumer/creator eligibility;
- content type and moderation policy;
- payment, tax, refund/dispute, and payout support;
- App/Web distribution-channel rules;
- privacy, consent, residency, retention, deletion, and user-rights process;
- Trust & Safety, support, finance, incident, and takedown operations;
- provider contract, capability, data terms, and regional availability;
- localization, accessibility, notices/terms, and legal review;
- observability, audit, feature flag, rollback, and emergency disable.

## Decision flow

1. Product owner proposes country/channel/capability and phase.
2. Domain, security, privacy, compliance/legal, design/accessibility, provider, and operations owners complete applicable evidence.
3. ADMIN records approved configuration with reviewer references and effective dates.
4. API/domain admission checks country/channel and current actor/object predicates; clients cannot self-enable.
5. Monitoring detects gate/provider/policy changes; deterministic control disables new operations or delivery as policy requires.
6. Re-enable requires current evidence and approval, not stale launch status.

## Failure and revocation

Unknown country/channel or missing/expired approval fails closed for gated capability. Existing sessions, cached pages, links, entitlements, or provider availability do not override current gate. Revocation behavior distinguishes stopping new signup/purchase/upload, preserving lawful customer access, refund/cancellation, takedown, export/deletion, and support obligations; exact treatment is capability-specific and legally reviewed.

Emergency disable is scoped, auditable, reversible when safe, and followed by review. Do not silently route a user to another country, provider, or channel to bypass a failed gate.

## Data, analytics, and open decisions

Collect minimum country/channel evidence needed for decision and audit. Location/IP/device signals are inputs, not sole truth. ANALYTICS measures launch outcomes through approved definitions; it does not authorize availability.

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`: initial countries, country determination method, minimum ages, notices/terms, consumer protection, platform/content restrictions, provider eligibility, app-store rules, regulator contacts, takedown/appeal duties, and gate review cadence.

## Cross-references

See [adult verification](02-adult-age-verification.md), [creator content gates](03-creator-content-gates.md), [payments/tax/payout gates](04-payments-tax-payout-gates.md), [data residency/retention](05-data-residency-retention.md), and [product phases](../product/01-product-phases.md).
