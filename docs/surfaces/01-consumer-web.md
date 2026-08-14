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
- Core: discovery, introduction status, conversations, notifications, own profile/availability.
- Safety and account: block/report entry points, safety center, privacy, sessions, subscription/receipts, export/deletion.

Exact information architecture, labels, routes, layout, and visual design are `DESIGN REQUIRED` in Figma. Public creator pages remain part of creator/club commerce architecture; they must not alter consumer discovery. The canonical public creator address is `/c/{handle}`, resolved against the explicitly public projection CREATORS publishes; it carries no consumer product, no session requirement, and no purchase control, and an unknown handle, an unpublished profile, and a creator who is not active are one indistinguishable answer.

## Domains and dependencies

AUTH owns identity/session; USERS owns profile/account; DISCOVERY owns candidate/introduction state; MESSAGING owns conversations/messages; TRUST & SAFETY owns blocks/reports/enforcement; NOTIFICATIONS owns delivery/preferences; BILLING owns consumer payment/subscription truth; PRIVATE CLUBS owns creator entitlements. AI, RTC, creator commerce, and monetisation are phase-gated dependencies, not Web-owned behavior.

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

## Security, phase, and authority

Follow [security baseline](../security/01-security-baseline.md), [screen states](../design/06-screen-state-requirements.md), and [consumer product](../product/02-consumer-product.md). V1 includes consumer core only. Phase 2 may add premium and RTC; Phase 3 may add approved consumer AI and broader social features. Conditional creator content remains gate-controlled even on Web.
