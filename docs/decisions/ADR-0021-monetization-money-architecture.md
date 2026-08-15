# ADR-0021: Monetization money architecture inside the ADR-0011 boundary

- Decision date: 2026-08-15
- ADR status: Accepted
- Owners: Founder (decision owner), BILLING, PAYOUTS, PRIVATE CLUBS, security, finance operations

## Context

[ADR-0011](ADR-0011-payments-payouts.md) locked the ownership split, owner-specific append-only balanced journals, durable idempotency, verified webhooks, reconciliation, and integer minor-unit money. It deliberately left the provider, the capture sequence, and every commercial policy open. Nothing was built.

Two things have changed. Creator Private Clubs shipped with real entitlements and a deliberate commercial seam in `apps/api/src/clubs/billing.ts` that refuses in every environment, so the receiving end of a payment now exists and has an owner. And [provider eligibility](../compliance/06-payment-provider-eligibility.md) now records, from primary sources retrieved 2026-08-15, that no assessed payment or payout provider is eligible for Velora without written approval nobody holds — and that several are prohibited outright the moment mature creator content is considered.

That combination is the reason to build now rather than later, and the reason to build it a particular way. The correctness architecture — journals, idempotency, state machines, reconciliation — is provider-independent and is the expensive part. The provider is the cheap part, and it is the part most likely to be replaced. Deferring the expensive part until a provider exists would mean building it under commercial pressure, which is how payment systems acquire the defects that are hardest to unwind.

This ADR records how ADR-0011's locked decisions become code. It does not reopen them.

## Requirements

- Every locked decision in ADR-0011 is satisfied by construction, not by convention.
- No commercial policy is invented. Where policy is missing, the production path refuses rather than guessing.
- No provider is chosen, and no provider's object shapes leak past an adapter.
- A test provider cannot exist in a deployed environment, by configuration rather than by a runtime flag.
- The existing PRIVATE CLUBS entitlement authority is preserved unchanged. Money publishes facts; entitlement stays where it is.
- Correct under duplicated, delayed, reordered, and replayed provider events, and across process crashes at every orchestration boundary.
- Nothing is added to the schema that no code can reach, and nothing is displayed that no server fact supports.

## Decision

### Money is a value, not a number

`Money` is an integer amount in minor units together with a validated currency, carried as one value everywhere. There is no API that accepts an amount without a currency and none that accepts a floating-point amount. Minor-unit precision comes from an explicit currency metadata table rather than an assumed two decimal places, and a currency with no metadata entry cannot be used at all. Conversion between display units and minor units exists only at the presentation edge and never produces an authoritative value.

### Two journals, in two domains, both balanced and append-only

BILLING owns the customer-money journal under a `billing_` prefix. PAYOUTS owns the creator-liability journal under a `payouts_` prefix. Each is `account / transaction / entry`, each transaction balances per currency by database constraint, and there is no cross-domain journal, no shared ledger table, and no writable ledger API between them. PAYOUTS learns about revenue from a published settled-revenue fact, exactly as PRIVATE CLUBS learns about entitlement.

A posted entry is never updated or deleted. Corrections are compensating transactions that reference what they correct. Balances are derived; where a projection is kept for read performance it is rebuildable from entries and is never the authority a decision is made against.

One business event posts at most one journal transaction. That is a unique constraint on the business reference, not a check the handler performs.

### Orchestration commits before it calls, and never holds a transaction across I/O

Every provider interaction follows the same four steps: open a transaction and establish the durable operation and its idempotency reservation; commit; call the provider outside any transaction with a platform-generated provider idempotency key; open a second transaction to record the outcome. A crash between steps three and four leaves a durable pending operation, which reconciliation resolves from the provider's own retrieve API. This is the shape ADR-0011 requires and [jobs, idempotency and concurrency](../engineering/03-jobs-idempotency-concurrency.md) already enforces for every other external effect.

Idempotency scope is actor plus operation plus offer plus client key. It is deliberately not a global deduplication of purchases: a consumer may legitimately buy two different things, and may legitimately buy the same thing again after a subscription ends.

### Provider events arrive through a durable verified inbox

The webhook endpoint reads a bounded raw body, selects the configured adapter, verifies signature and timestamp before parsing anything as business data, and persists a receipt keyed uniquely by provider plus provider event identifier. Business processing is asynchronous, idempotent, and re-evaluates current state rather than assuming arrival order. A duplicate is acknowledged without re-effect. An unverified request changes nothing and is audited.

Normalized, minimized event data is persisted. Raw provider payloads are not retained indefinitely.

### The entitlement bridge is the seam that already exists

BILLING publishes a versioned commercial fact through the existing PostgreSQL outbox. PRIVATE CLUBS consumes it idempotently and applies its own grant and revoke policy, producing at most one active membership per verified activation. BILLING never writes `clubs_` tables and PRIVATE CLUBS never reads `billing_` tables. `membership.source = 'billing'` becomes reachable through this path and through no other.

### Every capability is configuration that fails closed

Monetization capability is gated by explicit configuration on the established pattern: a named adapter registry, an `unavailable` implementation that refuses, a `local-test` implementation for local and test only, and a `superRefine` guard that makes staging and production reject any value but `unavailable`. There is no HTTP header, query parameter, request field, or `NODE_ENV` reading that changes which adapter is built. Production additionally asserts at startup that no test adapter is loaded.

The same mechanism gates commercial policy, not only providers. An offer cannot become purchasable while the platform fee, the supported currency, the tax treatment, or the refund terms for its country are unpublished. The refusal is a truthful `503 DEPENDENCY_UNAVAILABLE` about the environment, not a client error and not a fake checkout.

### Payout architecture is built; payout capability is not enabled

[Product phases](../product/01-product-phases.md) classifies creator earnings and payout operations as Phase 3. This ADR does not move them. What is built is the provider-neutral accounting and orchestration architecture with its production activation refused by configuration in every deployed environment — the same relationship `CLUBS_BILLING_ENTITLEMENT` already has to creator subscriptions, and the same relationship the adult-assurance and media-storage seams have to their capabilities. A seam that cannot be reached in a deployed environment is not the capability; it is the place the capability will attach. Enabling it remains a change-control decision under that document plus every gate in [payments, tax, and payout gates](../compliance/04-payments-tax-payout-gates.md).

### Velora stores no instrument and no identity document

No primary account number, security code, bank account number, routing number, government identifier, or identity document enters Velora's schemas, contracts, logs, metrics, or analytics. Payment collection is provider-hosted. Creator payout onboarding is provider-hosted, and Velora stores a recipient reference plus normalized capability status. The API contract has no field into which card data could be submitted, which is a stronger statement than validating it away.

## Why

**Because the correctness problems are provider-independent and the provider is not.** Duplicate webhooks, reordered events, crashed orchestrations, over-refunds, and double payouts are properties of distributed money, not of any vendor. Building them against an adapter boundary means the eventual provider decision changes an adapter and a configuration value.

**Because the eligibility research says a provider swap is likely, not hypothetical.** A provider eligible while mature content stays disabled may be prohibited the day it is enabled. Architecture that assumed one provider would turn a product decision into a payments migration.

**Because two journals model the actual liabilities.** Money owed to a creator and money collected from a consumer are different obligations with different lifecycles, different reversal rules, and different owners. One combined ledger would let a refund and a payout reversal be posted as though they were the same event, which is the class of error that balances perfectly and means nothing.

**Because derived balances cannot silently drift.** A stored balance is a second source of truth that a concurrency bug can corrupt invisibly. A derived one can be recomputed and compared, so a bug in the reservation logic shows up as a mismatch rather than as money.

**Because a fail-closed default is the only honest state.** No provider is approved and no commercial terms are published. A surface offering a Subscribe button today would be describing a product that does not exist, and a configuration that could be flipped to a test adapter in production would be a way to fabricate financial truth.

## Rejected alternatives

**One shared ledger across BILLING and PAYOUTS.** Rejected by ADR-0011 and rejected again here on evidence: it requires one domain to write another's rows, which the boundary forbids, and it collapses two distinct liabilities into one table where cross-contamination balances cleanly.

**A `creator_balance` column updated inside the payment transaction.** Simpler, faster, and wrong. It has no history, no correction provenance, and no way to detect that it disagrees with reality.

**Granting entitlement synchronously inside the payment confirmation.** Rejected because it couples entitlement availability to BILLING's transaction and makes a partial failure produce an unpaid grant or a paid non-grant. The outbox already gives at-least-once delivery with idempotent consumption.

**Deriving entitlement from provider subscription status directly.** Rejected because it makes a vendor's status vocabulary into Velora's authorization model, and because a provider's opinion arriving late, twice, or out of order would move access.

**Selecting a provider now and adapting later.** Rejected on the eligibility evidence. Selecting a prohibited provider is not a head start.

**Building offers and checkout without the journal first.** Rejected because a payment recorded before there is a place to account for it is a payment that gets accounted for retroactively, by inference, from records that were not designed to support it.

**A minor-unit assumption of two decimal places.** Rejected outright. It is wrong for several real currencies, and the failure is a silent factor-of-100 error in an amount, which is the worst possible shape for a money bug.

## Consequences

- Monetization ships as architecture plus refusals. Nothing about it is reachable as a working payment path in staging or production, and the freeze report must say so plainly rather than claiming payment readiness.
- Finance operations gain real workflows to attach to, but every high-impact action stays behind Admin authorization, step-up, reason, and audit under [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md) and [finance operations](../operations/03-finance-payout-operations.md).
- Creator Studio and Consumer Web gain money surfaces that truthfully report an unavailable capability where one is unavailable. There is no placeholder price and no non-functional purchase action.
- Adding a provider means an adapter, a provider-specific ADR, a compliance review, a configuration value, and nothing else. Adding a currency means a metadata entry and approved policy. Adding a country means passing every eligibility authority.
- The schema grows substantially before any of it carries a real transaction. That is accepted deliberately: the alternative is growing it under production pressure.

## Cross-references

[ADR-0011](ADR-0011-payments-payouts.md), [ADR-0006](ADR-0006-database-data-access-migrations.md), [ADR-0016](ADR-0016-bun-elysia-redis-bullmq-backend.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md), [ADR-0019](ADR-0019-database-connection-admission.md), [ADR-0020](ADR-0020-creator-capability-activation.md), [money flow](../architecture/10-money-flow.md), [domain boundaries](../architecture/03-domain-boundaries.md), [provider adapters](../architecture/06-provider-adapters.md), [BILLING](../domains/billing.md), [PAYOUTS](../domains/payouts.md), [PRIVATE CLUBS](../domains/private-clubs.md), [payment lifecycle](../flows/payment-lifecycle.md), [creator entitlement](../flows/creator-entitlement.md), [payment and webhook security](../security/05-payments-webhooks.md), [payments, tax, and payout gates](../compliance/04-payments-tax-payout-gates.md), [provider eligibility](../compliance/06-payment-provider-eligibility.md), [finance operations](../operations/03-finance-payout-operations.md), [jobs, idempotency and concurrency](../engineering/03-jobs-idempotency-concurrency.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).

## Status

| Decision | Classification |
|---|---|
| `Money` as integer minor units plus validated currency, with explicit currency metadata | LOCK NOW |
| Two owner-specific append-only balanced journals, derived balances only | LOCK NOW |
| Prepare-commit-call-record orchestration, no transaction held across provider I/O | LOCK NOW |
| Durable verified webhook inbox, unique per provider event, idempotent processing | LOCK NOW |
| Entitlement published through the outbox and applied by PRIVATE CLUBS | LOCK NOW |
| Fail-closed configuration for every monetization capability | LOCK NOW |
| Payment provider and payout provider | DEFER UNTIL PROVIDER INTEGRATION |
| Capture and entitlement sequence per provider | DECISION REQUIRED BEFORE FEATURE |
| Platform fee, revenue share, currencies, countries, tax, refund, cancellation, grace, reserve, and payout policy | DECISION REQUIRED BEFORE FEATURE |
| Financial record retention | LEGAL REVIEW REQUIRED |
| Enabling creator earnings or payouts as a product capability | Phase 3, unchanged by this ADR |
