# DISCOVERY domain

## Purpose and scope

DISCOVERY owns candidate eligibility evaluation, candidate presentation, discovery preferences interpretation, introduction signals, and mutual introduction state. It does not own profiles, messages, payments, social content, creator entitlements, or enforcement source truth.

## Main flow and transitions

Build candidate set from authorized minimal profile projections plus current eligibility contracts. On show, record presentation with ranking/policy version. On introduction request, revalidate actor, target, block/enforcement, region/age policy, rate limit, and stale state. `eligible -> presented -> one_sided_signal -> mutual_introduction` when reciprocal valid signal exists; decline/withdrawal/block/enforcement leads to policy-defined `ineligible/closed`. Mutual introduction publishes connection fact for MESSAGING.

## Failure/concurrency/security

No candidate is a promise of availability or access. Idempotency key plus actor-target unique state prevents repeated signal from creating multiple introductions. Mutual actions race safely through transactional transition. DISCOVERY requests block/enforcement eligibility from Trust & Safety at decision time; cached feed never overrides it. Return privacy-preserving denial, not another user's restriction reason.

## Permissions/data/events/phase

Consumer acts on own discovery state only. Owner stores minimal candidate/presentation/intro state and retention-limits exposure analytics. Events: candidate shown, signal sent/withdrawn, mutual intro created/closed. V1. Phase 2 premium priority controls; Phase 3 paid visibility/advanced filters. Pricing never guarantees another person's response.

## Cross-references

[discovery flow](../flows/discovery-introductions.md), [Trust & Safety](trust-safety.md), [consumer product](../product/02-consumer-product.md), [monetisation](../product/05-monetisation.md).
