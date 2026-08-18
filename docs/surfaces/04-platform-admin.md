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

ADMIN owns role grants, privileged operation requests, approvals, and audit views. AUTH supplies authentication assurance; IDENTITY ASSURANCE owns verification evidence and exposes only privacy-minimized aggregates plus exact-reference reads in V1. Every target domain owns its data and transition. MODERATION owns case workflow; TRUST & SAFETY owns enforcement; BILLING/PAYOUTS own financial state; CREATORS/PRIVATE CLUBS own creator/club state; ANALYTICS owns metrics; observability owns operational telemetry. AI may assist in Phase 3 but cannot approve or execute.

## Authentication, permissions, and approvals

Require dedicated privileged access policy, strong assurance, short sessions, re-authentication/step-up, least privilege, object/region/queue/monetary scope, revocable roles, and regular access review. Exact privileged MFA method, session limits, step-up assurance age, and approval-binding fields are locked in [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md). High-risk operations use explicit reason/evidence, exact target/effect, idempotency, current-state check, and required single/dual approval or separation of duties.

Payment/refund/payout, enforcement/ban, account/security, entitlement, role/configuration, deletion, sensitive export, and emergency operations must follow deterministic owner authorization and documented approval. No UI bulk action may weaken individual authorization or audit.

## Responsive and platform rules

Admin is desktop-first and information-dense, with tablet support for approved queue/review tasks. Mobile phone support may be limited to urgent read/approval workflows only after security design; it is not embedded in Consumer Mobile. Tables need accessible keyboard use, explicit filters, stable sort, pagination, saved views policy, and export limits.

## Deep links, notifications, and states

Deep links may target authorized case, user, creator, financial operation, approval, incident, audit entry, or health alert. Link possession grants no access; session, role, scope, target, feature phase, and current state are rechecked. External notification copy is minimized and avoids sensitive case/financial detail.

Screens define initial/loading/skeleton, empty queue, stale data, permission denied, approval pending/expired/rejected, step-up required, version conflict, partial bulk outcome, dependency outage, pending reconciliation, operation failed, break-glass active, and verified completed states. UI never claims execution before owning-domain confirmation.

## Security, phase, and authority

Follow [Platform Admin product](../product/04-platform-admin.md), [Admin operations](../flows/admin-operations.md), [RBAC](../security/02-access-control-rbac.md), and [operations](../operations/01-support-operations.md). V1 includes minimum support/moderation/enforcement/country-flag/audit/health controls and read-only Identity Assurance operations; no identity search, list, export, mutation, manual grant, refusal, revocation, or override exists. Financial functions phase with BILLING/PAYOUTS; Admin AI is Phase 3.

## Implemented: financial operations

One screen, and it reads. Counts of payments, reversals, claims, subscriptions, and payout instructions per state; what is currently being claimed back and what is still owed to creators, per currency; what needs a person to look at it; and which capability seams are configured.

Nothing on it identifies anybody. No consumer, no creator, no provider object, no payout recipient, no bank detail, no identity document, and no secret — an operator needs to know what state the platform's money is in and be able to act on it, and none of those help with that. There is no cross-currency total, because adding a euro to a yen produces a number with no meaning that somebody would act on.

There is no control on the screen that changes a financial row, because there is no operation in the API that does. The one financial action an operator has is issuing a refund, and it goes through BILLING's own service with an operator's authority, a reason, and a record. A manual adjustment is an explicit ledger operation, never a field.

The capability row reports adapter names rather than a boolean. An operator seeing `unavailable` and `unpublished` across it is seeing the truth — no payment provider, no payout provider, no published commercial terms, no approved launch country, and no tax authority — and "off" and "off because nobody has approved one" are different situations.

In a deployed environment nobody reaches any of it. ADR-0017 requires a recent phishing-resistant assurance for privileged access and no verifier that can produce one is approved, so every request is refused before any lookup happens on its behalf. The surface says that in those terms rather than showing an empty screen.

## Implemented: media operations

A second panel, and it reads for a stricter reason than the first.

What it carries is the state of the media platform: which storage and scanning adapters this process actually composed, whether the environment can accept media at all, counts of assets, stored objects, and duties by state, the disagreements with the provider nobody could safely correct, and what needs a person.

The rows worth having are the backlogs. Each class of owed work carries the **age of its oldest member** and the age at which that becomes an alert, because a count alone cannot separate a busy platform from a stuck one — forty purges owed for forty-five seconds and one owed for a day are the same kind of row and opposite situations. Every class is shown every time, healthy ones included: a panel that listed only what was wrong could not tell "nothing is owed" apart from "the signal stopped arriving". A class with nothing in it says so rather than reporting an age of zero. The thresholds come from [MEDIA](../domains/media.md), which derives them from the deadlines its own sweeps run on, so the screen cannot call work late that the platform is still working on.

Nothing on it identifies anybody: no owner, no account, no object key, no digest, no asset identifier. There is also **no list and no search**, and that is the same rule rather than an omission — an operator who could page through everybody's media has a browsing surface over private images however it is labelled.

The one media action an operator has — asking a delivery layer to forget an address — is deliberately not on this panel. It names one asset, it is reached from a drift finding, a report, or a support conversation rather than by browsing, and putting a lookup field beside it on a dashboard is where a search over private media begins. The API offers the action and the detail read to a tool that already holds an identifier; the screen offers neither.

Its refusal state is the financial panel's, for the same reason: in a deployed environment nobody reaches it, and it says so rather than rendering an empty screen.
