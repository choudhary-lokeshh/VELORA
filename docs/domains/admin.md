# ADMIN domain

## Implemented creator operations

Platform Admin can list and search creators, suspend and reinstate a creator capability, take a profile, an item, or a club out of public view, and withdraw one club entitlement. Every one of those writes through the owning domain — CREATORS for the capability and profile, PRIVATE CLUBS for content, clubs, and memberships — and ADMIN owns no table of its own, so there is no second opinion anywhere about what is true.

Two conditions guard every route and are never collapsed. The audience must be Platform Admin: a consumer session and a Creator Studio session are refused before any lookup happens on their behalf. And the assurance must be phishing-resistant and recent, which [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md) requires for privileged access — so with no approved verifier these operations are unreachable in a deployed environment rather than degraded to something weaker.

Every operation that changes something appends one TRUST & SAFETY enforcement record naming the actor, the action, the reason code, the target, and when it happened. A refused operation writes nothing, including no audit row, so the trail never contains an entry for a change that did not occur. Two operators acting at once settle as one decision and one record, because the state transition names the state it expects.

Creator suspension is scoped to the creator. The person's consumer account is untouched: those are different decisions about different things, and conflating them would ban somebody from a product they were not accused of anything in. Reinstatement is its own record rather than an edit, and republishes nothing — publication is the creator's decision to take again.

What an operator sees is operational state and nothing else: no AUTH subject, no consumer identifier, no contact detail, no financial data, and no moderation narrative. Search is a bounded prefix over the public handle, which is already public; searching by anything a visitor could not already see would make this a lookup tool for private data.

## Purpose and scope

ADMIN owns privileged operation requests, role grants, scoped operational workflows, approvals, audit records, controlled support views, system configuration/feature/country controls, and health dashboards. It does not own user, payment, creator, moderation, or enforcement truth; it invokes their contracts.

## Main flow

Authorized operator authenticates with required assurance, selects permitted operation/object, supplies reason/evidence, obtains step-up/approval when policy requires, and calls owning domain. Record `requested -> approved/rejected -> executed/failed -> reviewed` with immutable outcome references. Read views use owning-domain authorized projections, not unconstrained database access.

## Security/concurrency/data

RBAC plus scope, least privilege, short sessions, re-authentication, rate limits, immutable audit, and regular access review apply. Sensitive search/export is minimized/redacted, purpose logged, expiry-controlled; no passwords, raw cards, keys, secrets, or unneeded ID documents. Approval and execution may require different actors. Idempotency keys prevent repeated sensitive mutation; concurrent operation sees owner state/version.

AI may prepare Phase 3 summaries or operation drafts from authorized projections, but it receives no broader scope and cannot approve or execute high-impact operations. Exact proposal, human approval, and owning-domain result share an auditable correlation chain; changed/stale proposals require new approval.

## Phase/events/open questions

AUTH now provides the privileged foundation ADMIN builds on: isolated Platform Admin audience, authenticator enrolment with revocation and production-readiness reporting, step-up assurance, exact-action authorization with execution-time re-authorization, and dual-control privileged recovery. Admin sign-in itself is not implemented and cannot be: phishing-resistant verification has no approved implementation, so the configured verifier refuses every assertion and no adapter can mint Admin authority. Break-glass has no implementation at all, by design.

V1 minimum support/moderation/enforcement/country-flag/audit/health tools. Finance/payout/dispute workflows phase with owning domains. Events: role, approval, privileged read/write, configuration change. Privileged session, step-up assurance age, exact-action approval binding, privileged recovery, and break-glass semantics follow [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md). `DECISION REQUIRED`: granular permission matrix, approval thresholds, break-glass implementation, audit retention. See [Platform Admin product](../product/04-platform-admin.md), [Platform Admin surface](../surfaces/04-platform-admin.md), [admin operations](../flows/admin-operations.md), [operations authority](../DOCS_INDEX.md#operations-authority), [RBAC](../security/02-access-control-rbac.md).
