# Creator Studio surface

## Purpose and actor

Creator Studio is a web-first workspace for eligible creators to manage creator business identity and, in approved phases, Private Clubs, content, pricing, subscribers, analytics, earnings, moderation, appeals, and payout readiness. A creator may share a Velora user identity, but Creator Studio state and permissions remain separate from ordinary consumer discovery.

## Responsibilities and non-responsibilities

Studio presents creator application/verification, business profile, public creator page preview, club configuration, content upload/draft/moderation/publish state, offers/pricing, subscription and PPV products, subscriber/entitlement-safe views, analytics, earnings, payout status, policy notices, suspension, and appeals as phases permit.

Studio does not make verification, moderation, entitlement, payment, payout, tax, or country eligibility true. It does not expose platform-wide Admin operations, subscriber private behavior, payment credentials, raw identity evidence, or consumer discovery controls.

## Navigation and major screens

Expected areas are Home/status, creator profile/public page, clubs, content library/editor, offers/pricing, subscribers, analytics, earnings/payouts, moderation/appeals, notifications, and settings/security. Phase-gated items stay absent or explicitly unavailable; documentation does not enable them.

Major workflows include application and activation, verification status, club creation, content upload/processing/review/publish, pricing version/change, subscriber entitlement status, refund/dispute impact, earnings/payout state, creator suspension, and appeal. Exact navigation, layouts, editor behavior, and visual tokens are `DESIGN REQUIRED`.

## Domains and dependencies

CREATORS owns creator business identity and eligibility. IDENTITY ASSURANCE owns creator-identity and commercial-KYC evidence but never activates a capability, enables content, or authorizes payout. PRIVATE CLUBS owns club/content metadata, memberships, and entitlements. BILLING owns customer money and commercial offers/price snapshots; PAYOUTS owns earnings/disbursement. MODERATION and TRUST & SAFETY constrain content and creator state. ANALYTICS owns metric definitions. ADMIN provides privileged workflows. AI may assist only in Phase 3 through registered capabilities.

## Authentication and permissions

Studio requires valid Velora identity plus active, scope-limited creator access. Creator role, verification, club eligibility, payout readiness, and content-category eligibility are separate predicates. The verification workflow remains Phase 2; KYC/payout exposure remains Phase 3; neither receives UI before approved identity handoff. Every mutation authorizes creator entity/object and checks current phase/country/channel/provider/safety state. Sensitive payout/account changes require step-up as policy defines. Studio session lifetimes are shorter than consumer sessions and are locked in [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md).

Team/delegated creator roles are not assumed; they are `DECISION REQUIRED`. Until approved, only explicitly authorized creator identity acts on its own entity. Consumer sessions cannot infer Studio permission from route visibility.

## Web-first, mobile, and public-page rules

Studio prioritizes desktop/tablet productivity, dense tables, filters, bulk selection only where operations are safely idempotent, persistent drafts, and audit/status visibility. Narrow screens may provide review/status tasks but need not support full creation or finance operations. Consumer Mobile is not required to expose Studio.

Public creator URLs show only published safe/free preview and policy-approved profile data. Private/paid media requires current entitlement authorization and short-lived delivery. Mobile/web distribution may differ; Conditional mature/explicit content stays disabled until every gate passes.

## Deep links, notifications, and states

Deep links may target creator application, verification, content draft/review, club, offer, moderation case/appeal, analytics period, payout, or policy action. Each link validates creator scope, session, feature state, and object access. Notifications contain minimal details and do not bypass re-authorization.

Screens define loading/skeleton, empty/new creator, processing, scheduled/pending review, rejected with safe next step, partially failed upload, stale price/version conflict, payment/payout pending, held/reversed, suspended, permission lost, provider unavailable, retry, and confirmed success states. Bulk actions expose per-item outcome.

## Implemented today

Studio is one workspace with peer areas — home, public profile, catalog, private clubs — rather than a stack, so a creator with a long catalog is not scrolling past it to reach a club. Home reports what the creator actually has: drafts, published items, published clubs, and the real number of people who currently hold club access, each counted from a list the server returned in the same read, and labelled as describing that page rather than a total nobody computed. There is no earnings figure, growth line, conversion rate, view count, follower count, or trend, because none of those exist as platform truth and a number with nothing behind it is worse than an empty screen.

Studio implements the Creator Studio session, creator onboarding through activation, and the public creator profile: claiming the canonical handle, editing display name and bio, managing the small set of public links, and publishing or withdrawing the page. Every one of those reads and writes real CREATORS truth through the published contract; none is stored in the browser, and Studio never declares somebody an adult — that is a USERS decision, so the surface says where to complete it rather than offering a control that would fail.

Studio also implements the content catalog and private clubs: adding a draft, setting who it is for, publishing, returning something to draft, archiving, creating a club, publishing or closing it, and issuing a complimentary invitation. An invitation secret is shown exactly once with that stated plainly, because it is not stored and cannot be shown again. The only number the surface reports is a live member count computed from current entitlements. A creator whose capability may not operate still sees their catalog — it is theirs — and is offered none of the controls the server would refuse.

Handles are claimed once and are not renameable in this milestone, so no rename control is offered. Publishing is a separate decision from saving: nothing a creator writes becomes public as a side effect of writing it. A members-only item is labelled honestly as reachable by nobody until private clubs exist. Clubs, offers, subscribers, analytics, earnings, and payouts remain absent, and no control implies a purchase, because no payment path exists.

## Security, phase, and authority

Follow [Creator Private Clubs](../product/03-creator-private-clubs.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [media security](../security/04-media-upload-delivery.md), and [creator compliance gates](../compliance/03-creator-content-gates.md). Phase 2 is web-first creator/club pilot; analytics, payouts, and creator AI are Phase 3. Mature/explicit content remains Conditional / Compliance-Gated.
