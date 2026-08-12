# USERS domain

## Purpose and scope

USERS owns consumer account state, profile basics, self-managed preferences, availability, and account lifecycle coordination. It does not own credentials, discovery ranking, relationship state, reports/enforcement decisions, creator business identity, or billing.

## Flows and state

After AUTH identity exists, create account in `pending_profile`; completion of required profile/policy gates becomes `active` or `restricted` based on validated inputs and other-domain eligibility signals. User edits own permitted fields; field-level visibility is policy controlled. Deletion request transitions `active/restricted -> deletion_pending -> deactivated -> erased/anonymized` subject to defined holds. Account state change emits lifecycle fact for projections.

## Alternate/failure/authorization

Duplicate account-creation command resolves same identity idempotently. Conflicting profile changes use record version or last-write policy explicitly chosen per field. User may alter only own allowed profile; support/admin requests validated domain action, reason, and audit. Enforcement/age/region predicates may restrict product action without exposing private cause to other users.

## Data/security/events/phase

Own profile data classification/visibility and deletion coordination; share minimized profile view, never raw internal notes. Validate uploads via media policy; prevent unsafe free text exposure where applicable. Events: account/profile/availability/deletion lifecycle. V1. `DECISION REQUIRED`: required profile fields, visibility defaults, display-name policy, retention durations.

## Cross-references

[consumer product](../product/02-consumer-product.md), [consumer account/profile](../flows/consumer-account-profile.md), [onboarding](../flows/onboarding.md), [account deletion](../flows/account-deletion.md), [data ownership](../architecture/05-data-ownership.md).
