# Consumer Web product interface freeze report

- Freeze status: Frozen
- Freeze SHA: `e7e5b0ef44200d21b05b49a9c2c2a797bd84a521`
- Freeze date: 2026-08-23
- Interface authority: [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md)
- Initial freeze report SHA: `6bca054`

What the Consumer Web product interface froze with, what it deliberately does not do, and what unfreezes the rest. Companion to the [media](13-media-freeze-report.md), [identity](14-identity-freeze-report.md), [RTC](16-rtc-freeze-report.md), and [notifications](17-notifications-freeze-report.md) reports, written to the same rule: architecture that is finished is described as finished, and a capability that cannot run says so in its own words.

## Superseded since the freeze

One claim in this report is no longer true, and it is the one that shaped most of the rest. **Consumer photographs are now rendered.** `POST /v1/media/deliveries` exchanges the image references every projection already carried for short-lived addresses, and DISCOVERY publishes the peer-visibility rule USERS was missing. Every sentence below about no photograph existing anywhere describes what was true at this freeze; the decision that closed it is recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), and [MEDIA](../domains/media.md) and [DISCOVERY](../domains/discovery.md) carry the rule.

Nothing else here changed. The storage and delivery **provider** decisions are untouched and still open, so a deployed environment still serves nothing; what was closed was the platform's own gap.

## What this work owns

The Consumer Web client, and nothing behind it. No contract, table, route, migration, or authorization rule changed. One client package gained the two notification-preference operations the contract already published and no client had bound.

## Where it started

A working engineering scaffold: one client-rendered page at `/`, a tab-switched panel per backend module, browser-default controls, a developer session panel showing `consumer_web` and `single_factor` as raw values, a "block somebody by their identifier" field, and the browser's own system palette in place of a theme. Every product behaviour was correct and none of it was presentable, which is the failure mode where a missing capability and a finished one look identical.

## What landed

| Concern | What exists now |
| --- | --- |
| Design foundation | NIGHT CURRENT: the approved Master DNA verbatim plus a filled-in surface ladder, foreground and border weights, four semantic status hues, radii, elevation, a type scale, and motion timing — one file, semantic names, [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md) |
| Component layer | Button, link button, icon button, field with wired label/hint/error/count, text input, textarea, select, switch, choice, card, page header, list row, avatar, badge, chip, notice, status and error messages, empty state, blocked state, skeletons, segmented tabs, dialog, confirmation dialog, toaster — and nothing else, because a component nothing renders is a demo rather than a system |
| Icons | 35 marks drawn on one grid at the approved 1.75 px stroke, so no icon dependency was added and no shape overrides it |
| Information architecture | Five addressed destinations — Discover, Introductions, Messages, Notices, You — with availability, safety, memberships, and settings under You, and calling reached from a mutual introduction rather than from the navigation |
| Shell | One navigation model in three arrangements: a bottom bar below 768 px, a labelled rail from 768 px, a persistent sidebar from 1024 px; a skip link, a named main landmark, and a back control on every page underneath a destination |
| Public entry | A landing page and a sign-in page that say what the platform is and what it has not built, including that the sign-in behind them is a development identity |
| Admission | A four-step ladder counting the server's steps, a region field that echoes the country it resolves to, a language picker that names each code, and a way out for somebody who signed in as the wrong person |
| Screens | Discovery, introductions, conversation list and thread with grouping and day separators, the call lifecycle, notices, profile with a distinct read and edit state, availability, photos, memberships, settings, and safety |
| Safety | Block and report from every surface that shows a person, with confirmation, honest consequences, and no identifier to paste |
| Private clubs | The access a person holds, and the invitation path that creates it: a bearer secret typed once, settled by the database, never echoed back, and the same answer for a spent one as for one that never existed |

## The rule everything was built to

**Nothing on the surface states something the server did not.** It decided the visible details that matter:

- **No photograph anywhere.** Consumer media has no durable address and no authorized delivery route exists, so every person is an identity mark and the profile screen says why in its own words.
- **No fabricated counter.** A conversation with something unread carries a mark rather than a number, because the contract publishes sequence positions and not a count. The navigation badge counts conversations and says so to a screen reader.
- **No distance, compatibility score, popularity, view count, or online indicator.** None is in the contract; availability is a bounded window and never presence.
- **No purchase control**, because no payment provider is approved.
- **No manufactured urgency.** A pending introduction has a real deadline and the surface neither computes nor counts it down.
- **A declaration is called a declaration** on the entry page, the sign-in page, and the step itself.
- **A deliberately unavailable capability looks deliberate**, in a treatment distinct from an error.

## Defects this work found and fixed

Each was found by driving the real surface rather than by reading it.

| Defect | Why it happened | Fix |
| --- | --- | --- |
| Every application address redirected to `/discover` | A gate read "no account" from a resource that had not been asked yet, sent the browser to onboarding, and onboarding sent it back | `Resource` now reports whether the server has answered since it was enabled, and every gate waits for that |
| A conversation opened from an introduction rendered "not available" | The messages screen reads a list fetched before the conversation existed | The list is re-read before navigating, and the thread asks once more before declaring anything missing |
| A long message pushed the whole page sideways at 390 px | A grid item's minimum is its content's, and a message may contain an unbreakable run of any length | `minmax(0, 1fr)` and an explicit minimum on every pane, deck, card, and row that carries text somebody typed |
| A four-thousand-character message buried the composer | The transcript grew the page instead of scrolling inside itself | The transcript is bounded in viewport units, so the composer stays on screen |
| A refused call left a dialog with no exit | The controls were rendered from the call, and a refusal produces no call | A close control is rendered whenever there is no live call |
| An unadmitted person could not sign out | Every session control lived behind the admission they had not finished | Sign out and sign out everywhere are on the admission screen |
| A failed onboarding read stranded somebody on the loading screen | Only the account read's failure was handled | Either read failing is reported, with a retry |
| A dialog's only exits were Escape and the scrim | No close control existed | Every titled dialog carries one, and initial focus deliberately skips it |

## Hostile states, driven rather than reasoned about

Two presses in one frame on Send issued **one** request. A reload during a pending mutation recovered. A slow feed showed a skeleton and then content. A refused mutation showed one honest sentence and leaked no code, correlation identifier, or status. A dropped request reported a failure with a retry. Two tabs disagreed and the stale one corrected itself when it was looked at. Back and forward across five destinations landed where they should. A cleared cookie moved the browser to sign-in carrying its intended destination. A rate-limited call refusal read as "Too many attempts. Wait a moment and try again."

## Responsive and accessibility evidence

Ten widths — 320, 360, 390, 430, 768, 820, 1024, 1280, 1440, 1728 — across every product address and every public address, asserted per element rather than by page scroll width, with a fixture whose bio and longest message contain unbreakable runs specifically to keep that assertion honest. The matrix runs on one engine, because what it asserts is a property of the stylesheet and two hundred page loads per project buys the same answer twice. Asserted on every engine that can hold a session: the phone gets a bottom bar and the desktop a sidebar; a conversation is its own screen on a phone and sits beside the list on a desktop; every primary control clears a comfortable target on a phone; the page survives text scaled to 200%.

Accessibility: one first-level heading per page, a named main landmark, named navigation, an accessible name on every input and every icon-only control, focus visible on every control, focus entering a dialog, unable to leave it, and returning to the control that opened it, `role="status"` for progress and `role="alert"` for failure, non-colour cues beside every status colour, and a measured contrast floor of 4.59:1 with every other pair above 5:1.

## Performance

Measured against the production build. The first navigation transfers 353 KB and paints in tens of milliseconds locally. Seven in-application navigations across five destinations issue **five** API requests in total: account, onboarding, profile, conversations, and notices are read once by the shell and shared, and only the screens with their own data ask again. There is no polling anywhere except inside an open call dialog, which re-reads the call it is showing every three seconds and stops when the call is not live.

## Tests

| Layer | Count |
| --- | --- |
| Consumer Web unit assertions, through the generated client against a contract-shaped stand-in | 88 |
| Other workspace unit suites | 479 |
| API integration against real PostgreSQL, Redis, and BullMQ | 1348 |
| Browser, three engines | 103 passed, 53 skipped |

The skips are WebKit's, plus the width matrix on the two engines that do not run it. WebKit's are the same skips the repository already had: it will not store a `Secure` cookie delivered over plain-HTTP loopback, the cookie attributes are locked by [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md), and no attribute was relaxed to make a local browser cooperate. WebKit still runs the transport, security-header, and surface-isolation assertions.

## How the browser suite reaches the product at all

The browser cannot complete a profile in any environment: the minimum requires one image in the `ready` state, no approved storage provider exists, and the development adapter is filesystem-backed with no HTTP upload transport by design. Every assertion past admission would therefore be unreachable.

The suite admits its fixtures through the API's own HTTP surface for everything except the bytes, which a small script inside the API workspace places by calling the adapter directly — the same way the integration suite has always placed them. The platform then inspects and processes them exactly as it would a real upload. The refusal a real person meets is asserted separately and explicitly, so the workaround never becomes the claim.

The browser environment runs the development adapters the configuration schema admits in local and test — filesystem media, the in-process RTC adapter, the real block store for messaging eligibility, an in-memory notification channel. `packages/config/src/server.ts` refuses every one of them in staging and production, and that refusal has its own assertions.

## What is frozen

**PRODUCTION CONSUMER WEB PRODUCT UI: FROZEN.** The design foundation, component layer, information architecture, responsive shell, admission, discovery, introductions, messaging, calling, notices, profile, availability, media states, memberships, settings, safety, their states, and their evidence are complete and green.

## What is not built, and why

- **Any rendered photograph.** No authorized consumer media delivery route exists. Recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
- **A name against a block.** The block list publishes an identifier and a timestamp; publishing a name for somebody a pair may no longer reach is a product decision nobody has taken.
- **Anything inside a private club.** A member's access is real and listed; the contract has no route that publishes what a club contains, only one that reads a single item by an identifier nothing hands out. The screen says so rather than rendering an empty shelf. Note also a server rule the surface renders rather than second-guesses: a live entitlement is omitted from the member's list while its creator has no published public page, because the listing carries the handle CREATORS publishes and there is none to carry.
- **Account closure or deletion.** The flow is specified and no consumer route exists, because every retention schedule it depends on is unapproved.
- **Purchase, checkout, or price.** No approved payment provider and no published commercial terms.
- **Legal and policy copy.** Both required documents sit at `0-unpublished`; the acknowledgement step records which version was accepted and does not invent text.
- **A light theme.** The approved Consumer expression is tonal dark; a second direction would be an invention.
- **Localisation.** Copy is English. Region and language codes are rendered through the platform's own display names rather than a shipped catalogue, so nothing here presumes which countries or languages VELORA serves.

## Live capability

**RENDERED CONSUMER MEDIA: BLOCKED** — no approved storage provider, and, independently, no authorized delivery route in the contract for one to serve.

**LIVE CALL AUDIO AND VIDEO: BLOCKED** — no approved RTC provider. The surface carries the whole call lifecycle and says plainly that nothing is being carried.

**EXTERNAL NOTIFICATION DELIVERY: BLOCKED** — unchanged from the [notifications freeze](17-notifications-freeze-report.md): no approved email or push provider, no stored email address, and no native build pipeline. Consumer Web now renders the preference controls the contract publishes and states that nothing leaves the platform yet.

**CONSUMER PURCHASE: BLOCKED** — no approved payment provider and no published terms. A creator's invitation is the only path into a private club, and it works end to end.

**CLUB CONTENT: UNREACHABLE** — a member holds real access and no route lists what is behind it.

## What unfreezes each

Every one is a provider, legal, or product decision recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), not client work. Rendered media needs the storage provider decision and then a delivery route. Calling needs an eligible RTC provider. External notices need a vendor answer, an owning domain for a consumer email address, and a native build. Purchase needs approved commercial terms and a provider. The visual layer needs an approved Figma product-screen handoff, which supersedes ADR-0027 by changing one stylesheet.

## Cross-references

- [Consumer Web surface](../surfaces/01-consumer-web.md) and [consumer product](../product/02-consumer-product.md)
- [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md) and [ADR-0015](../decisions/ADR-0015-shared-design-token-boundary.md)
- [Design principles](../design/01-design-principles.md), [design-system contract](../design/02-design-system-contract.md), [Figma source of truth](../design/03-figma-source-of-truth.md), [responsive rules](../design/04-responsive-platform-rules.md), [accessibility and motion](../design/05-accessibility-motion.md), [screen states](../design/06-screen-state-requirements.md)
- [Open decisions](../decisions/DECISIONS_REQUIRED.md)
