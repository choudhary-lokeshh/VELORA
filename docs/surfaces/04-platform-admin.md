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

## Implemented: the console interface

The interface is CLEAR PULSE, recorded in [ADR-0029](../decisions/ADR-0029-platform-admin-product-interface.md). It is the Admin expression of the approved Master Visual Language, filled in for this surface only: a cool neutral surface ladder, four semantic status hues distinct in hue from the brand signal, a squarer radius scale, IBM Plex Sans with Noto fallbacks, and IBM Plex Mono for the opaque identifiers an operator carries between systems. There is no editorial serif, because the foundation reserves it for Creator moments and nothing on a console is editorial. Controls are 36 px and rows 40 px, restored to comfortable targets under `pointer: coarse`.

Four destinations, named for the work: Queues, Creators, Money, Platform, with the session under Access at the foot of the navigation. "Billing", "Moderation", "Notifications", and "RTC" are deliberately not destinations — a console with an item per backend module is a client leaking backend architecture. Platform's four areas are peers of each other rather than nested pages, so nothing there offers a "back" that would dress a sideways move as a return.

One rule decided more of the surface than the palette did: **colour is only ever a judgement the server itself published**. `breached` on a backlog, a case's priority, a creator's status, an appeal's state. Every other state arrives as an open string in the owning domain's vocabulary, is humanised rather than mapped — `provider_pending` becomes "Provider pending" — and is printed in plain ink, so a state added upstream tomorrow reads correctly today and nothing is toned on a guess about what a word means.

## Implemented: work queues, cases, and appeals

Cases as the platform holds them, filterable by the queue that owns them, with the priority and workflow state each publishes. Nothing in the list names anybody: a target is a type and an opaque reference.

One case shows the reports as filed, the evidence as recorded, and the decisions as made — including the ones a later decision replaced, because a record that hid a superseded decision would be a worse record. It never scores, ranks, or suggests an outcome. The local/test proof in [ADR-0033](../decisions/ADR-0033-local-test-ai-suggestion-platform.md) may draft one clearly labeled review note from case state, queue, priority, target type, policy version, counts, and latest category timestamps only. Report prose, evidence references, target identity, and raw safety evidence do not enter that context. The draft is editable, is not stored as case truth, and has no claim, triage, decision, enforcement, or other action control. An operator's judgement remains the product. When the platform returns a bounded slice of a case, the screen says so, because deciding on a partial record without knowing it is partial is the failure this surface exists to prevent.

The operations are claiming a case, saving its triage, and recording a decision. A decision carries the exact action, a reason, the scope it acts on, the evidence it rests on, and the version the operator was looking at — so two moderators reaching one case produce one decision and one refusal rather than two enforcements. Nothing is applied optimistically; the screen never claims a state the owning domain has not confirmed. **No reason is preselected.** Which reason fits which action is policy, policy is not written in a client, and a preselected one is exactly how a temporary hold ends up recorded against "no violation found".

Appeals are a separate list against decisions already made, with the same rules and the same absence of names.

## Implemented: creators and enforcement

A directory searched by the beginning of a public handle, which is the only thing it can be searched by — a handle is public, and everything else about a creator is not. Each row carries the status CREATORS publishes and whether the public page is published. The detail beside it is the whole of what the platform publishes about a creator to an operator: no catalog, no club list, no member, no consumer account, no name, and no contact detail.

The operations are suspending and reinstating a creator, removing something they published, and revoking a club membership. Each is applied by the owning domain with the operator's session and a reason, and each is kept on the enforcement record. There is deliberately **no control that edits a creator's own content, price, or profile**: an operator removes or restricts, and only the creator writes.

## Implemented: platform health

Four peer areas — media, notifications, calling, identity — each answering one question an operator has: is this subsystem able to do its job in this environment, and is anything stuck.

Each reports the adapters the process actually composed rather than what a configuration file asked for, because "off" and "off because nobody has approved a provider" are different situations. Each reports counts by state, and where a domain publishes owed work it reports the **age of the oldest owed item against the age its owner calls late** — a count alone cannot separate a busy platform from a stuck one. Every class is shown every time, healthy ones included, because a panel listing only what is wrong cannot tell "nothing is owed" from "the signal stopped arriving".

None of it identifies anybody, and none of it can be searched. The contract offers exact-reference reads of a media asset, an RTC call, and an identity subject to a tool that already holds an identifier; this console offers none of them, and says so on the screen, because a lookup field beside a dashboard is where a browsing surface over private material begins.

## Implemented: the access door, and why it is the whole product today

No browser reaches any of the above, in any environment. [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md) requires a `platform_admin` audience at recent phishing-resistant assurance. `/v1/auth/local/web-sessions` admits `consumer_web` and `creator_studio` and nothing else, so the audience cannot be issued; and the only privileged verifier the platform composes refuses every assertion, because no phishing-resistant implementation is approved and hand-rolling one would be a fabricated control.

The access page therefore is the surface rather than a placeholder. It states both conditions separately, because an operator whose audience is wrong and one whose assurance is stale have different problems. It reports what the browser actually holds in the server's own words. It distinguishes "this browser holds no session" from "this console could not reach the platform", because an origin the deployment has not admitted is the likelier state and reading a refused request as "signed out" would be stating something the console does not know.

It offers **no sign-in form**. No route would accept one, a form that always fails is worse than an explanation, and on this surface it would be a control inviting somebody to try to get in. The one control it offers is signing out, which is real: somebody may be carrying a consumer session on this origin and be better off without it.

Both conditions are recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) as a privileged authenticator provider choice and an approval policy, alongside the role and scope matrix the console asserts nothing about.
