# Platform Admin surface

## Purpose and actors

Platform Admin is the dedicated privileged console for Moderator, Support, Finance/Admin, Platform Admin, and Owner/Super Admin roles. It provides scoped, auditable workflows across Velora without owning or directly editing business-domain persistence.

## Responsibilities and non-responsibilities

Admin presents authorized search and operational views for users, creators, clubs/content, verification, reports/cases, enforcement, support, subscriptions/payments/refunds, disputes, earnings/payouts, country/feature controls, analytics, audit review, configuration, incidents, and system health as phases permit.

Admin does not expose plaintext passwords, raw card data, encryption keys, secrets, unrestricted identity documents, or arbitrary database access. Owner/Super Admin has maximum configured operational authority, not automatic data visibility or freedom from approval/audit.

## Navigation and major screens

Expected areas are work queues, global scoped search, users, creators/clubs/content, moderation/reports/appeals, support, billing/refunds/disputes, payouts/holds, country/features/configuration, analytics, audit review, incidents, and platform health. Navigation is role- and scope-filtered; hidden navigation does not replace server authorization.

Screen/workflow authority comes from owning domain and operations documents. Exact information architecture, dense table patterns, dashboards, keyboard workflows, and visual design are `DESIGN REQUIRED`.

## Domains and cross-domain dependencies

ADMIN owns role grants, privileged operation requests, approvals, and audit views. AUTH supplies assurance; every target domain owns its data and transition. MODERATION owns case workflow; TRUST & SAFETY owns enforcement; BILLING/PAYOUTS own financial state; CREATORS/PRIVATE CLUBS own creator/club state; ANALYTICS owns metrics; observability owns operational telemetry. AI may assist in Phase 3 but cannot approve or execute.

## Authentication, permissions, and approvals

Require dedicated privileged access policy, strong assurance, short sessions, re-authentication/step-up, least privilege, object/region/queue/monetary scope, revocable roles, and regular access review. Exact privileged MFA method, session limits, step-up assurance age, and approval-binding fields are locked in [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md). High-risk operations use explicit reason/evidence, exact target/effect, idempotency, current-state check, and required single/dual approval or separation of duties.

Payment/refund/payout, enforcement/ban, account/security, entitlement, role/configuration, deletion, sensitive export, and emergency operations must follow deterministic owner authorization and documented approval. No UI bulk action may weaken individual authorization or audit.

## Responsive and platform rules

Admin is desktop-first and information-dense, with tablet support for approved queue/review tasks. Mobile phone support may be limited to urgent read/approval workflows only after security design; it is not embedded in Consumer Mobile. Tables need accessible keyboard use, explicit filters, stable sort, pagination, saved views policy, and export limits.

## Deep links, notifications, and states

Deep links may target authorized case, user, creator, financial operation, approval, incident, audit entry, or health alert. Link possession grants no access; session, role, scope, target, feature phase, and current state are rechecked. External notification copy is minimized and avoids sensitive case/financial detail.

Screens define initial/loading/skeleton, empty queue, stale data, permission denied, approval pending/expired/rejected, step-up required, version conflict, partial bulk outcome, dependency outage, pending reconciliation, operation failed, break-glass active, and verified completed states. UI never claims execution before owning-domain confirmation.

## Security, phase, and authority

Follow [Platform Admin product](../product/04-platform-admin.md), [Admin operations](../flows/admin-operations.md), [RBAC](../security/02-access-control-rbac.md), and [operations](../operations/01-support-operations.md). V1 includes minimum support/moderation/enforcement/country-flag/audit/health controls. Financial functions phase with BILLING/PAYOUTS; Admin AI is Phase 3.
