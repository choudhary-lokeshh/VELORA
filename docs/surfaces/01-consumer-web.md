# Consumer Web surface

## Purpose and actor

Consumer Web is a browser product for adult users and eligible visitors. It shares AUTH, USERS, safety, social, and commercial state with Consumer Mobile through published backend contracts. It is not Creator Studio, Platform Admin, or an independent account ecosystem.

## Responsibilities and non-responsibilities

Web presents public entry/help/legal pages; signup, sign-in, recovery, and session controls; onboarding/profile/availability; discovery and mutual introductions; conversations; notifications; block/report; account/privacy controls; and phase-approved consumer purchases. Later capabilities appear only when [product phases](../product/01-product-phases.md) and country/channel gates permit them.

Web does not own authorization, discovery eligibility, message truth, entitlement, payment truth, moderation, Admin operations, or creator business management. Browser storage and hidden UI are never sources of truth.

## Navigation and major screens

Expected navigation groups are:

- Public: landing, safety/help, legal notices, creator public pages where enabled, sign-in/signup.
- Onboarding: adult/country gate, authentication, required notices/consents, profile setup, verification status where required.
- Core: discovery, introduction status, conversations, calls, notifications, own profile/availability.
- Safety and account: block/report entry points, safety center, privacy, sessions, subscription/receipts, export/deletion.

The implemented information architecture is locked by [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md): five consumer destinations — Discover, Introductions, Messages, Notices, You — each at its own address, with availability, safety, memberships, and settings under You. Calling is deliberately not a destination, because a call is placed against a mutual introduction and against nothing else; a navigation item per backend module would be exactly the architecture leak this document forbids. One navigation model has three arrangements — a bottom bar within thumb reach below the tablet breakpoint, a labelled rail above it, a persistent sidebar on desktop — and a conversation is an address rather than a pane, so browser Back leaves it.

Discover carries two **sections** within that one destination: **People**, which is Social Discovery, and **Creators**, which lists pages their authors published. They are sections rather than a blended feed because they answer two different questions — the people feed is a fixed eligibility conjunction about who may be introduced to whom, and the listing is publication order over pages anybody may read — and one ranking rule cannot honestly mean both. The candidate feed contains no creator and the listing contains no candidate. The section is a query parameter on the same address, so a link, a bookmark, and Back all behave the way each destination does; it does not add a sixth destination and the five above are unchanged.

Clubs appear in neither section, and that is a rule rather than an omission: Creator Private Clubs stay separate from Social Discovery, so a club is reached from the page of the creator who runs it, and the access somebody already holds is under You.

Exact visual specification remains `DESIGN REQUIRED` in Figma. What exists in code is the approved Master Visual Language filled in for the Consumer expression under ADR-0027, which records both the values and the bound on them. Public creator pages remain part of creator/club commerce architecture; they must not alter consumer discovery. The canonical public creator address is `/c/{handle}`, resolved against the explicitly public projection CREATORS publishes; it carries no consumer product, no session requirement, and no purchase control, and an unknown handle, an unpublished profile, and a creator who is not active are one indistinguishable answer. The page shows the creator's published public catalog alongside their profile, paged and bounded by the server; drafts, archived items, and members-only items never appear on it. Published clubs appear as metadata only — a name and a description — with no member count, no member list, and no control implying anybody can pay to join, because membership comes from an invitation the creator sends and no payment path exists.

### Calling

Calling is offered from a mutual introduction and from nothing else. The screen has no field that takes a person as a value — no identifier, no handle lookup, no dialler — because the server derives the other party from the relationship and refuses a request that names one; a control here that accepted a person would be offering something the API has no route for. Voice and video are separate controls rather than one control with a medium toggle: agreeing to be heard is not agreeing to be seen, and a toggle carrying the last choice forward would make the more exposing option the default for somebody who never chose it.

Which controls exist is decided by the role and the state the server reported. Only a recipient answers or declines, only a caller withdraws, and either may hang up once there is something to hang up; a control the server would refuse is not rendered disabled, it is not rendered. State is always read back rather than inferred from the action just taken, because a call can be overtaken between the click and the answer.

Somebody meets a call they did not place through the server's own one-live-call-per-pair rule: reaching for the pair returns the call that already exists, on the correct side of it, rather than opening a second one. There is no in-browser ring, because no realtime gateway is deployed; a call that was missed appears in notifications, in the past tense, since a notice offering to answer would be offering something that stopped ringing long before anybody read it.

No join credential is retained. Joining asks the server for one and drops it, because there is nothing to hand it to: no media stack is opened, no track is captured, and no provider is contacted. When a media stack exists the credential will go straight to it and still never be stored, never enter the address, and never be rendered — a credential a third party honours without asking again is the one secret this surface could leak, and not holding it is how it does not. It is requested again on every join and every reconnect rather than cached, because the server re-composes eligibility at each issuance: re-asking is what lets a block landing mid-call take effect instead of being outlived by a credential minted before it. No RTC provider is approved, so in every deployed environment the API refuses to mint one at all and the surface reports that plainly.

An ending is disclosed in the vocabulary the person is entitled to. A call ended by a safety decision arrives as `ended_by_platform` and is shown as such; the screen has no finer vocabulary, because distinguishing a block from an enforcement would publish the other person's decision to the person it was taken about.

## Domains and dependencies

AUTH owns identity/session; IDENTITY ASSURANCE owns verified assurance evidence; USERS owns self-declaration/profile/account; DISCOVERY owns candidate/introduction state; MESSAGING owns conversations/messages; TRUST & SAFETY owns blocks/reports/enforcement; NOTIFICATIONS owns delivery/preferences; BILLING owns consumer payment/subscription truth; PRIVATE CLUBS owns creator entitlements. AI, RTC, verification workflow, creator commerce, and monetisation are phase-gated dependencies, not Web-owned behavior.

## Authentication and permissions

Protected routes require a valid session and server-side object/action authorization. Sensitive account/security changes may require re-authentication. Web uses the opaque secure cookie session and CSRF architecture from [ADR-0009](../decisions/ADR-0009-auth-authorization.md) with the exact lifetimes, cookie attributes, and rotation triggers locked in [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md).

The session cookie is `HttpOnly` and carries an audience-scoped name, so one browser cannot present a Creator Studio or Platform Admin session as a consumer one and no page script can read the session credential. A companion CSRF cookie is deliberately readable by the surface's own script and is echoed on state-changing requests, where the server compares it against the value bound to the session record. The API endpoint is resolved on the server at request time and handed to the browser, so one build artifact serves every environment.

Authentication state distinguishes bootstrap, authenticated, signed out on this device, signed out everywhere, session ended, request refused, and service unavailable. It never claims to know why a session ended: the API answers every failed session check identically so it discloses nothing, and the surface reports only what it can observe. Deep links must restore intended destination only after authentication, validation, and current feature/country/permission checks; unsafe or stale links land on a safe state.

Users may access only their account and authorized shared objects. Public pages expose only published, policy-approved fields. Web must never expose Admin routes, creator-only mutation, provider secrets, raw payment data, private identity evidence, or another user's restriction reason.

## Platform, responsive, and deep-link rules

Web supports keyboard and pointer input from mobile viewport through wide desktop. Responsive behavior follows [responsive rules](../design/04-responsive-platform-rules.md); it need not copy Mobile navigation or interactions. Browser back/forward, refresh, multiple tabs, session expiry, and resumable pending operations need explicit states.

Approved deep-link families may include authentication continuation, discovery/conversation object, notification target, receipt/subscription, safety/help, account settings, and public creator page. Exact route contracts and redirect allowlists are `DECISION REQUIRED` before implementation.

## Notifications and states

In-product notification entry points show minimized content and re-authorize destination on open. Email/SMS/push links use bounded, validated tokens or authenticated routes; notification content never grants access.

Every screen defines initial loading, refresh/loading-more, skeleton where useful, empty, validation error, authorization-safe not found, offline/network loss, rate limit, dependency pending, partial failure, success confirmation, and session/feature-revoked states. Payment or entitlement ambiguity shows pending and reconciliation, not fabricated success.

## What the surface may not state

Consumer Web renders server answers and adds nothing. In particular it carries no photograph of anybody — consumer media has no durable address and no authorized delivery route exists, so every person is drawn as an identity mark and the profile screen says why — no unread *message* count, because the contract publishes sequence positions rather than a count, no distance, compatibility score, popularity, or view count, no online indicator, and no purchase control. A capability the platform has deliberately not enabled is presented as a decision rather than as a failure, so nobody reports a product gap as a bug.

## Security, phase, and authority

Follow [security baseline](../security/01-security-baseline.md), [screen states](../design/06-screen-state-requirements.md), and [consumer product](../product/02-consumer-product.md). V1 includes consumer core and no new verification workflow UI. Phase 2 may add approved Identity Assurance handoff, premium, and RTC; Phase 3 may add approved consumer AI and broader social features. Conditional creator content remains gate-controlled even on Web.
