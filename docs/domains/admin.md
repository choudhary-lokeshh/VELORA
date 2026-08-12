# ADMIN domain

## Purpose and scope

ADMIN owns privileged operation requests, role grants, scoped operational workflows, approvals, audit records, controlled support views, system configuration/feature/country controls, and health dashboards. It does not own user, payment, creator, moderation, or enforcement truth; it invokes their contracts.

## Main flow

Authorized operator authenticates with required assurance, selects permitted operation/object, supplies reason/evidence, obtains step-up/approval when policy requires, and calls owning domain. Record `requested -> approved/rejected -> executed/failed -> reviewed` with immutable outcome references. Read views use owning-domain authorized projections, not unconstrained database access.

## Security/concurrency/data

RBAC plus scope, least privilege, short sessions, re-authentication, rate limits, immutable audit, and regular access review apply. Sensitive search/export is minimized/redacted, purpose logged, expiry-controlled; no passwords, raw cards, keys, secrets, or unneeded ID documents. Approval and execution may require different actors. Idempotency keys prevent repeated sensitive mutation; concurrent operation sees owner state/version.

AI may prepare Phase 3 summaries or operation drafts from authorized projections, but it receives no broader scope and cannot approve or execute high-impact operations. Exact proposal, human approval, and owning-domain result share an auditable correlation chain; changed/stale proposals require new approval.

## Phase/events/open questions

V1 minimum support/moderation/enforcement/country-flag/audit/health tools. Finance/payout/dispute workflows phase with owning domains. Events: role, approval, privileged read/write, configuration change. `DECISION REQUIRED`: granular permission matrix, approval thresholds, break-glass, audit retention. See [Platform Admin product](../product/04-platform-admin.md), [Platform Admin surface](../surfaces/04-platform-admin.md), [admin operations](../flows/admin-operations.md), [operations authority](../DOCS_INDEX.md#operations-authority), [RBAC](../security/02-access-control-rbac.md).
