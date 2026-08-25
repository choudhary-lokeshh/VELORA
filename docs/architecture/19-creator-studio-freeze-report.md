# Creator Studio product interface freeze report

- Freeze status: Frozen
- Freeze SHA: `b157147b028af946c741b62808d5b4bd1d36f911`
- Freeze date: 2026-08-23
- Interface authority: [ADR-0028](../decisions/ADR-0028-creator-studio-product-interface.md)
- Initial freeze report SHA: `c45abde`

What the Creator Studio product interface froze with, what it deliberately does not do, and what unfreezes the rest. Companion to the [media](13-media-freeze-report.md), [identity](14-identity-freeze-report.md), [RTC](16-rtc-freeze-report.md), [notifications](17-notifications-freeze-report.md), and [Consumer Web](18-consumer-web-freeze-report.md) reports, written to the same rule: architecture that is finished is described as finished, and a capability that cannot run says so in its own words.

## Superseded since the freeze

Two claims in this report are no longer true. **Creator imagery exists.** A creator
can add an avatar and a cover to their page and up to six images to a catalog
item, and every surface that renders a creator — the public page, the catalog,
and this workspace's own preview — shows them. Every sentence below saying no
creator image can be added or shown describes what was true at this freeze; the
decision that closed it is recorded in
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), and
[CREATORS](../domains/creators.md) and
[PRIVATE CLUBS](../domains/private-clubs.md) carry the rules.

**Received gifts now exists under Money.** It lists durable local/test gift
operations, immutable gross payment, and creator share from the BILLING journal,
with sender identity withheld and payout transfer explicitly unclaimed. Production
gifting and payout remain blocked by their independent provider and policy gates.
[ADR-0032](../decisions/ADR-0032-provider-neutral-virtual-gifting.md) and the
[virtual gifting freeze report](23-virtual-gifting-freeze-report.md) supersede the
no-gift and three-money-readout statements below; the original freeze evidence
remains historical. Storage and delivery provider decisions are also untouched.

## What this work owns

The Creator Studio client. Two things behind it changed, both because the client found them and neither because the client was inconvenient: `packages/creator-client` bound the paging parameters the contract already published for clubs, memberships, and offers, and one API response mapper now emits a field the contract already published and the row already held. No route, table, migration, or authorization rule changed, and no dependency was added anywhere.

## Where it started

A working engineering scaffold: one client-rendered page, a tab-switched panel per backend module, browser-default controls, a development session panel sitting above the work, and the browser's own system palette in place of a theme. Every product behaviour was correct and none of it was presentable — and nothing in it was addressable, so the browser's Back, a bookmark, a second tab, and a deep link all did nothing.

## What landed

| Concern | What exists now |
| --- | --- |
| Design foundation | WARM SIGNAL: the approved Master DNA verbatim plus a filled-in warm paper surface ladder, foreground and border weights, four semantic status hues, radii, elevation, a type scale, and motion timing — 100 declarations in one file, semantic names, [ADR-0028](../decisions/ADR-0028-creator-studio-product-interface.md) |
| Component layer | Button, link button, icon button, field with wired label/hint/error/count, text input, textarea, select, choice card, card, card and section heads, page header, toolbar, list row, creator avatar, badge, chip, metric, info row, notice, status and error messages, empty state, error state, blocked state, skeletons, segmented filter, dialog, confirmation dialog, toaster — and nothing else, because a component nothing renders is a demo rather than a system |
| Icons | 34 marks drawn on one grid at the approved 1.75 px stroke, Studio's own set rather than a shared one, so no icon dependency was added and no shape overrides it |
| Information architecture | Five addressed destinations — Home, Profile, Catalog, Clubs, Money — with selling, earnings, and payouts as three addresses under Money, and standing, policies, the mature-content refusal, and the session under an Account reached from the identity affordance |
| Shell | One navigation model in three arrangements: a bottom bar below 768 px, a labelled rail from 768 px, a persistent sidebar from 1024 px; a skip link, a named main landmark, and a back control on every page underneath a destination |
| Entry | A sign-in page that says what is behind the form, and that a Creator Studio session is shorter than a VELORA one |
| Activation | A ladder that walks what the server published — no capability, an adult decision that belongs to another surface, outstanding policies by version, a suspended or closed account — and states plainly that creator access is not payment approval, identity verification, or permission to publish mature content |
| Public page | Handle claim with the contract's own bounds, display name, bio, up to five links, publication as its own decision, and a preview that reads the public addresses a stranger's browser would call, with no session attached |
| Catalog | Create, edit against a version, publish, return to draft, archive behind a confirmation, restore; title, summary, body, audience, and club association; keyset paging; a filter that says how far it has counted |
| Clubs | Create, rename, describe, publish, return to draft, close permanently behind a confirmation that names what closing costs; per-club access, invitations, and the items published to it |
| Invitations | Issued, shown once, masked until asked for, copied with one control, dismissed by the creator; a listing of what is live, used, withdrawn, or expired, carrying no secret |
| Money | Earnings one currency at a time and never a total across currencies; payouts separating a missing provider from a missing recipient record; selling stating that nothing can be sold and offering no price field |

## The rule everything was built to

**Nothing on the surface states a figure the platform does not compute.** It decided the visible details that matter:

- **No follower count, view count, subscriber count, revenue line, growth figure, conversion rate, or trend.** A browser assertion walks every destination and fails on any of those words, so the rule survives the next person to work here.
- **Every count says what it counted.** Home's figures come from the pages the server actually returned and say so while there is more to load; the catalog's filter counts what has arrived and says so too, rather than reporting "0 drafts" to somebody whose drafts are on the next page.
- **A members-only item with no club is labelled as reaching nobody**, because that is exactly what it does.
- **No photograph anywhere**, and both screens that would host one say why in their own words.
- **No notification control**, because the notification contract refuses a Creator Studio credential outright.
- **No price field**, because both offer operations refuse in every deployed environment.
- **A creator sees their own access control, never their members** — a count, a source, and a grant date, and no name, handle, or identifier.
- **A deliberately unavailable capability looks deliberate**, in a treatment distinct from an error.

## Defects this work found and fixed

Each was found by driving the real workspace rather than by reading it.

| Defect | Why it happened | Fix |
| --- | --- | --- |
| Saving a profile silently deleted every link the creator had saved | The form never sent `links`, and the contract replaces the array it is given | Links are edited as rows and travel back with every save |
| Content and clubs could be created and never edited | The client sent no `contentId`, `clubId`, or `version` on a save, though the contract published all three | Both editors carry the version and refuse a stale write as a refusal |
| A creator with more than one page of clubs, members, or offers could not reach the rest | `packages/creator-client` bound no paging parameters for those three routes | The parameters the contract publishes are bound, and every list pages |
| The club an item belongs to was write-only | The API's creator-facing content mapper never emitted `clubId`, so a members-only item's association could be set and never read back | One field added to one allow-listed mapper; the visitor's mapper is separate and unchanged |
| A creator with no capability yet, and one with no page yet, were shown a failure | A 404 — the platform's way of saying "there is nothing here" — was classified as an error | `Resource` reports absence separately from failure, and every screen renders it as absence |
| A creator who already had a page was shown the claim-your-handle form for a frame | A resource enabled part-way through — which is what happens when the session answer arrives — reported itself as finished with nothing | `Resource` is loading until a read has actually answered |
| A refused save destroyed what the creator had typed, and the refusal with it | The screen fell back to a placeholder while the re-read that follows every save was in flight, unmounting the form | The screen waits for a first answer rather than for the current one |
| Every list blanked to placeholders after every change | A revalidation replaced content it already had | A list keeps what it holds while it re-reads |
| A club or item conflict told the creator their handle was unavailable | One shared sentence covered every `STATE_CONFLICT` on every screen | A caller may name the nouns on its own screen without naming the cause; the shared sentence names neither |
| A retried payout could have sent two | The idempotency key was made at the moment of the press, so a second press made a second key | The key is made once per intent and reused for every attempt at it |
| "Read only for now" flashed on every screen before the creator's standing had loaded | The notice was rendered from "not active" rather than from "known and not active" | Both notices wait for an answer |
| A radio in the audience chooser could not be activated by anything aiming at it | The identifier was on a one-pixel input underneath its own label | The identifier is on the label, which is what a person presses |
| The editor went on saying there were unsaved changes to something already saved | It compared against a copy of the item that the save had not refreshed | The editor is handed the new answer after a save |
| The sign-in page carried the whole contract | `@velora/validation` has one entry point that assembles every domain's zod schemas, and one formatting helper reached through it put 346 KB of them in the browser of somebody looking at a form | A `./money` subpath, following the precedent `@velora/config` already sets |
| The desktop header printed the page's own heading directly above it | The phone's title bar was rendered at every width | The bar keeps only the way back from the tablet up, and disappears where there is nowhere to go back to |
| A focused field looked like an invalid one | The focus border took the brand red, which on this surface is a hand's breadth from the critical red | A focused field takes the approved 2 px ring and a stronger neutral edge |

## Hostile states, driven rather than reasoned about

Two presses in one frame on Become a creator, on Publish, and on New invitation each issued **one** request. A stale second tab was refused on a club edit and on a profile edit, and read as a refusal rather than as a failure. A duplicate handle and a duplicate club address were each refused with the right noun and without naming who holds it. A malformed handle, a two-character display name, and an over-long bio were refused before anything was sent. Fields stop at the contract's maximum rather than sending something the server will reject. A bio of six hundred unbroken characters and a title of a hundred and forty wrapped rather than pushing the page sideways. The one-time invitation secret did not survive a reload, and never appeared in the listing beside it. Back after a publish landed on the item and showed its new state rather than a stale draft. An unknown item address, an unknown club address, and an address that is not part of the workspace each said so and offered the way back. A cleared cookie moved the browser to sign-in carrying its intended destination. Every creator call failing showed one honest sentence with a retry. A slow API showed the workspace's own loading state rather than an empty page.

## Responsive and accessibility evidence

Ten widths — 320, 360, 390, 430, 768, 820, 1024, 1280, 1440, 1728 — across every product address including a real club, asserted per element rather than by page scroll width. The matrix runs on one engine and seeds one creator for all ten, because what it asserts is a property of the stylesheet and ten admissions buy the same answer ten times. Asserted on every engine that can hold a session: the phone gets a bottom bar, the tablet a rail, and the desktop a sidebar; every primary control clears a comfortable target on a phone; the workspace survives text scaled to 200%.

Accessibility: one first-level heading per page, a named main landmark, one visible named navigation, an accessible name on every input and every icon-only control, focus visible on every control, focus entering a dialog, unable to leave it, and returning to the control that opened it, `role="status"` for progress and `role="alert"` for failure, an icon and words beside every status colour, and a measured contrast floor of 5.21:1 with every other pair above it.

## Performance

Measured against the production build. The sign-in page transfers 300 KB and paints in tens of milliseconds locally; its JavaScript is 454 KB uncompressed against Consumer Web's 493 KB, and the 90 KB it carries beyond that surface is the second typeface the approved foundation assigns to Creator editorial moments. Six in-application navigations across the whole workspace issue **seven** API requests in total: the session, the creator's standing, and the profile are read once by the workspace and shared, and only the screens with their own data ask again. There is no polling anywhere.

## Tests

| Layer | Count |
| --- | --- |
| Creator Studio unit assertions, through the generated client against a contract-shaped stand-in | 46 |
| Other workspace unit suites | 537 |
| API integration against real PostgreSQL, Redis, and BullMQ | 1349 |
| Browser, three engines | 120 passed, 63 skipped |

The skips are WebKit's, plus the width matrices on the two engines that do not run them. WebKit's are the same skips the repository already had: it will not store a `Secure` cookie delivered over plain-HTTP loopback, the cookie attributes are locked by [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md), and no attribute was relaxed to make a local browser cooperate. WebKit still runs the transport, security-header, and surface-isolation assertions.

## What is frozen

**PRODUCTION CREATOR STUDIO PRODUCT UI: FROZEN.** The design foundation, component layer, information architecture, responsive shell, activation, identity, the public preview, the content catalog and its editor, private clubs, access, invitations, the three money readouts, the deliberate refusals, their states, and their evidence are complete and green.

## What is not built, and why

- **Any image, anywhere.** The persistence exists and the contract publishes no creator media route, so there is nothing for a client to call. Recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
- **Any notification, count, or attention surface.** The notification contract is consumer-audience only and refuses a Creator Studio credential.
- **Who a member is.** The membership contract publishes a source and a grant date and no identity. The count, the source, and the withdraw control are the whole surface, deliberately.
- **A handle rename.** Claimed once, with no redirect for links already shared; recorded as decided rather than pending.
- **An appeal, a report, or a safety case.** Those routes are consumer-audience; a creator has no Studio path to any of them.
- **Analytics of any kind.** No metric definition exists, and a plausible-looking number is worse than none.
- **Offer creation, pricing, or a purchase.** No approved payment provider and no published commercial terms.
- **Payout setup or withdrawal.** No eligible payout provider and no published settlement terms; the balances are shown anyway, because the money is real whatever the platform can do with it.
- **Mature content.** Four blockers, none of them the creator's, and two surfaces that could never carry it in any case.
- **A dark theme.** The approved Creator expression is a warm editorial workspace; a second direction would be an invention.
- **Localisation.** Copy is English. Dates are rendered in the reader's own locale by the platform's own formatter; money carries its currency code and no symbol, because a symbol is a locale decision nobody has approved.

## Live capability

**CREATOR MEDIA: BLOCKED** — no approved storage provider, and, independently, no creator route in the contract that would upload, attach, or address one.

**CREATOR NOTIFICATIONS: ABSENT** — a contract decision rather than a provider one. Recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

**CREATOR SELLING: BLOCKED** — no approved payment provider and no published commercial terms. Both offer operations exist and refuse in every deployed environment.

**CREATOR PAYOUT: BLOCKED** — twice over and shown as twice: no eligible payout provider, and no published settlement window, reserve, or minimum.

**MATURE CREATOR CONTENT: BLOCKED** — four blockers reported by the server and restated in the creator's terms, each attributed to somebody other than the creator.

**CLUB ACCESS: LIVE.** An invitation issued in Studio admits exactly one consumer, exactly once, and the whole path is proved in a browser across both surfaces.

## What unfreezes each

Every one is a provider, legal, or product decision recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), not client work. Creator media needs the storage provider decision and then a creator route. Creator notifications need a creator audience and an event catalogue in NOTIFICATIONS. Selling and payout each need approved terms and an eligible provider. Mature content needs four separate approvals, two of which no provider can currently give. The visual layer needs an approved Figma product-screen handoff, which supersedes ADR-0028 by changing one stylesheet.

## Cross-references

- [Creator Studio surface](../surfaces/03-creator-studio.md), [creator product](../product/03-creator-private-clubs.md), and [creator lifecycle](../flows/creator-lifecycle-content.md)
- [ADR-0028](../decisions/ADR-0028-creator-studio-product-interface.md), [ADR-0020](../decisions/ADR-0020-creator-capability-activation.md), [ADR-0015](../decisions/ADR-0015-shared-design-token-boundary.md), and [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md)
- [Design principles](../design/01-design-principles.md), [design-system contract](../design/02-design-system-contract.md), [Figma source of truth](../design/03-figma-source-of-truth.md), [responsive rules](../design/04-responsive-platform-rules.md), [accessibility and motion](../design/05-accessibility-motion.md), [screen states](../design/06-screen-state-requirements.md)
- [Creator content gates](../compliance/03-creator-content-gates.md) and [surface and distribution eligibility](../compliance/07-surface-and-distribution-eligibility.md)
- [Open decisions](../decisions/DECISIONS_REQUIRED.md)
