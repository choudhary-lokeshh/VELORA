# Platform Admin / Owner Console

## Purpose and scope

Separate privileged operations client controlling ecosystem workflows: users/creators/clubs, verification, moderation/reports, bans/suspensions, subscriptions/payments/refunds, earnings/payout operations, disputes/chargebacks, country availability, feature flags, content status, analytics, support, audit events, configuration, and system health. It is not Consumer Web admin and not Creator Studio.

## Roles and permission model

| Role | Permitted operational scope |
|---|---|
| User | No Admin access |
| Creator | Own creator business tools only; no Admin access |
| Moderator | Assigned reports/cases and policy actions within scope |
| Support | Account/support workflows, no unrestricted finance/enforcement |
| Finance/Admin | Payments, refunds, earnings/payout ops within approved limits |
| Platform Admin | Configured multi-domain operations, not unrestricted secrets |
| Owner/Super Admin | Highest operational authority, still permissioned/audited and secret-minimized |

Exact grants use RBAC plus operation/object scope, least privilege, step-up authentication for sensitive actions, and separation of duties where risk warrants. Role is never a reason to expose plaintext passwords, raw payment/card credentials, encryption keys, private secrets, or unnecessary identity documents.

## Main and failure flow

Operator authenticates, receives scoped role, searches privacy-minimized record, requests domain action with reason/evidence, satisfies approval/step-up if required, domain re-authorizes and applies state transition, then ADMIN records immutable audit outcome. Failed/duplicate requests show current safe state; no direct storage edits. Emergency access is time-bound, dual-controlled where possible, and reviewed.

## Security/data/events

ADMIN owns operation request/approval/audit views, not core facts. Sensitive reads are logged. Export is scoped, redacted, rate-limited, watermarked where appropriate, and expiry-controlled. Actions emit audit events with actor, delegated role, target, reason, before/after references, correlation ID, approval and outcome. Admin analytics uses authorized aggregate data.

## Admin AI boundary

Phase 3 AI may summarize only operator-authorized projections, retrieve approved procedures, explain system state, surface anomalies, and draft operation requests. It must not broaden data visibility or approve/execute privilege, configuration, account/security, payment/refund/payout, entitlement, enforcement/ban, deletion, or sensitive-content actions. Existing RBAC, step-up, dual-control, owning-domain authorization, and audit apply after AI assistance; AI is never approver.

## Phase/open questions

V1: minimal audited support, moderation, enforcement, user status, feature/country-control foundation and health visibility, plus privacy-minimized Identity Assurance health and exact-reference read-only inspection. There is no identity search, export, mutation, manual grant, refusal, revocation, or override. Phase 2/3: finance/payout/dispute capabilities as financial domains launch. Admin AI assistance is Phase 3. `DECISION REQUIRED`: approval thresholds, break-glass policy, role matrix, support data access standard, and any future identity-review authority. See [Platform Admin surface](../surfaces/04-platform-admin.md), [ADMIN](../domains/admin.md), [Identity Assurance](../domains/identity-assurance.md), [RBAC](../security/02-access-control-rbac.md), [AI product surfaces](../ai/06-ai-product-surfaces.md), [AI action flow](../flows/ai-assisted-action.md), [admin operations](../flows/admin-operations.md), and [operations authority](../DOCS_INDEX.md#operations-authority).
