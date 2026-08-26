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

Studio is a workspace at five addresses rather than one page with tabs — Home, Profile, Catalog, Clubs, Money, with the account reached from the identity affordance — so the browser's Back, a bookmark, a second tab, and a deep link all behave the way they behave everywhere else. Selling, earnings, and payouts are three addresses under Money because they are three reads of one question a creator asks once; "Offers", "Onboarding", and "Safety" are absent as destinations because those are backend module names. One navigation model takes three arrangements: a bottom bar within thumb reach below 768 px, a labelled rail from 768 px, a persistent sidebar from 1024 px. The visual language is WARM SIGNAL, implemented under [ADR-0028](../decisions/ADR-0028-creator-studio-product-interface.md).

Home reports what the creator actually has: drafts, published items, published clubs, and the real number of people who currently hold club access, each counted from a list the server returned in the same read and labelled as describing the pages that arrived rather than a total nobody computed. It also presents currency-separated creator-payable ledger balances and recent catalog, club, and received-gift activity from their owning reads; gift rows keep sender identity withheld and never describe the creator share as a payout. It offers exactly one next step, chosen from server state — no page, an unpublished page, a draft waiting, no club. There is no growth line, conversion rate, view count, follower count, subscriber count, invented revenue total, or trend, because none of those exists as platform truth; a browser assertion walks every destination and fails on any of those words.

Studio implements the Creator Studio session, creator activation through the policy ladder, and the public creator page: claiming the canonical handle, editing display name, bio, and the small set of public links, publishing or withdrawing the page, and previewing it — the preview being a read of the same public addresses a stranger's browser would call, with no session attached, so a draft page previews as what a visitor actually gets, which is nothing. Every one of those reads and writes real CREATORS truth through the published contract; none is stored in the browser, and Studio never declares somebody an adult — that is a USERS decision, so the surface says where to complete it rather than offering a control that would fail.

Studio also implements the content catalog and private clubs. An item has a title, a summary, a body, an audience, and a lifecycle; it can be created, edited against its version, published, returned to draft, archived, and restored, and it can be attached to one of the creator's own clubs. A members-only item with no club is labelled as reaching nobody, because that is exactly what it does. A club can be created, renamed, described, published, returned to draft, and closed permanently behind a confirmation that names what closing costs. Both lists are keyset-paged and say how far they have counted.

Access to a club is presented as access control rather than as an audience: how many grants are live, where each came from, and when it was made, with the ability to withdraw one — and no name, handle, identifier, or behaviour, because the contract publishes none. An invitation is a bearer credential and is treated as one: shown once, masked until somebody asks to see it, copied with one control, dismissed by the creator rather than by a timer, never written to a log or an address, and never rendered in the listing that follows.

Money is four honest readouts. Earnings shows one currency at a time and never a total across currencies, rendered against each currency's published minor-unit exponent. Received gifts lists the real gift operation, immutable gross, and exact creator-payable journal share with sender identity withheld; it never calls that share a payout. Payouts separates a missing provider from a missing recipient record, shows the balances anyway because the money is real whatever the platform can do with it, and carries one idempotency key across every attempt at one payout intent. Selling states that creator-authored offers cannot be sold and offers no price field, because both offer operations refuse in every deployed environment. Local/test gift offers are platform-managed and never appear in creator offer controls.

Handles are claimed once and are not renameable in this milestone, so no rename control is offered. Publishing is a separate decision from saving: nothing a creator writes becomes public as a side effect of writing it. A creator whose capability may not operate still sees everything they have made — it is theirs — and is offered none of the controls the server would refuse.

Creator-owned profile and catalog imagery uses the published creator media reservation, upload, completion, removal, and delivery contracts. Studio shows lifecycle truth for each upload, reserves stable image geometry while addresses resolve, and public preview renders only ready references returned by the anonymous public creator and catalog projections. Provider activation remains separate from those product contracts and follows the media boundary. Two capabilities remain deliberately absent and say so in their own words: there is no notification control anywhere because the notification contract refuses a Creator Studio credential outright, and mature content is refused for four reasons attributed to somebody other than the creator reading them. Both remain recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## Security, phase, and authority

Follow [Creator Private Clubs](../product/03-creator-private-clubs.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [media security](../security/04-media-upload-delivery.md), and [creator compliance gates](../compliance/03-creator-content-gates.md). Phase 2 is web-first creator/club pilot; analytics, payouts, and creator AI are Phase 3. Mature/explicit content remains Conditional / Compliance-Gated.
