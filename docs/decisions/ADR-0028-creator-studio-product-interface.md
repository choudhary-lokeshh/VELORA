# ADR-0028: Creator Studio product interface

- Decision date: 2026-08-23
- ADR status: Accepted

## Context

Creator Studio reached this point as a working engineering scaffold: one client-rendered page, a tab-switched panel per backend module, browser-default controls, a development session panel sitting above the work, and the browser's own system palette in place of a theme. Every product behaviour it needed was correct — activation, the policy ladder, handle claim, the catalog, clubs, invitations, membership, earnings, payouts, the commercial and mature-content refusals — and none of it was presentable. A creator opening it could not tell what VELORA had built for them, and nothing in it was addressable: there was one URL, so the browser's Back, a bookmark, a second tab, and a deep link all did nothing.

The design authority is genuinely partial and says so. [Design principles](../design/01-design-principles.md) approve a Master Visual Language — a 4 px rhythm, IBM Plex Sans with Noto global-script fallbacks, Source Serif 4 for Creator editorial moments, Living Ember `#B85645` with the dark expression `#E17A66`, a 1.75 px icon stroke, a 2 px focus treatment, a semantic safety and status system — and a Creator expression that is a "warm editorial workspace". It then marks the remaining palette, the component system, the product screens, the responsive layouts, elevation, and motion `DESIGN REQUIRED`.

[ADR-0027](ADR-0027-consumer-web-product-interface.md) recorded the same situation for Consumer Web and filled the gap for that surface alone, saying explicitly that it authorised nothing for any other. This ADR does the same work for Creator Studio, on the same authority — the product owner asking, in writing, for the Creator interface to be built in the approved direction and naming the expression — and bounds exactly what it authorises.

## Decision

### WARM SIGNAL is the Creator expression of the approved Master, implemented in code

The Creator surface implements the approved DNA verbatim — Living Ember `#B85645`, the 4 px rhythm, IBM Plex Sans with Noto fallbacks, Source Serif 4 for the Creator editorial moments the foundation reserves it for, the 1.75 px icon stroke, the 2 px focus treatment — and fills in the values the Master leaves open: a warm paper surface ladder, three foreground weights, three border weights, four semantic status hues distinct in hue from the brand signal, a radius scale, three elevations, a type scale, and motion timing.

Those values live in `apps/creator-studio/app/styles/tokens.css`, as one named semantic contract, and nowhere else. They do **not** move into `packages/design-tokens`: [ADR-0015](ADR-0015-shared-design-token-boundary.md) restricts that package to approved cross-surface values, and these are neither approved by Figma nor cross-surface. The package keeps publishing the approved primitives and the semantic role names; this surface supplies one filling of them, as Consumer Web supplies another.

One value is a step rather than a copy, and it is deliberate. `#B85645` is the signal wherever the signal is a fill or a mark — a primary button, a current destination, a focus ring. As *text* on warm paper it clears only 4.2:1, so a darker step of the same hue carries the signal wherever it is a letterform. Every text and icon pair in the system was measured against its surface before it was written down; the weakest is 5.21:1 against a 4.5:1 requirement.

### Creator Studio is light only, deliberately

The approved Creator expression is a warm editorial workspace. A dark theme would be a second visual direction nobody has approved, so `color-scheme` is declared rather than offered and no dark palette exists to drift. `#E17A66`, the approved dark expression, is therefore unused by this surface and absent rather than repurposed.

### Studio is not Consumer Web wearing another palette

The two surfaces share the approved DNA and nothing else. Studio has its own tokens, its own component layer, and its own 34-mark icon set, because `AGENTS.md` keeps the surfaces separate and because they do not want the same things: nothing in Studio draws a heart or a compass, and nothing on the consumer surface draws a ledger. Where the two implementations are similar — a field that wires its own label, hint, error, and count; a dialog that contains and restores focus — they are similar because the requirement is the same, not because one imports the other.

What differs is the character. Studio is squarer, denser, and paper-toned; it uses a two-column working layout from the desktop breakpoint where the consumer surface uses one; and it is the only surface authorised to use the editorial serif, which it spends on exactly two things: the name of the place a creator is standing in, and the creator's own words.

### The information architecture is five creator destinations, not one per domain

Home, Profile, Catalog, Clubs, Money. Each is an address, so the browser's Back, a bookmark, a second tab, and a deep link all behave the way they behave everywhere else.

Selling, earnings, and payouts are three reads of one question a creator asks once, so they are three addresses under Money rather than three destinations. Standing, the policy record, the mature-content refusal, and the session live under Account, reached from the identity affordance, so the five destinations stay about the work. "Offers", "Onboarding", and "Safety" are absent as destinations because they are backend module names, and a navigation built from those is the leak `AGENTS.md` forbids.

### One navigation model, three arrangements

A bottom bar within thumb reach below 768 px, a labelled rail from 768 px, a persistent sidebar from 1024 px. Both navigations are in the document and the stylesheet takes one out of the layout, because choosing in JavaScript means the first paint after hydration is the wrong one.

The approved responsive rules make Studio desktop-first. That is a statement about where the density goes, not permission to break the phone: the same workspace is asserted at ten widths from 320 px to 1728 px, and every control a thumb has to reach clears a comfortable target.

### Nothing on the surface may state something the server did not

This is the rule the whole interface is built to, and it decided several visible details:

- **No follower count, view count, subscriber count, revenue line, growth figure, or trend.** None exists as platform truth. A browser assertion walks every destination and fails on any of those words, so the rule survives the next person to work here.
- **Every count says what it counted.** Home's figures are derived from the pages the server actually returned, and say so while there is more to load. The catalog's filter counts what has arrived and says so too, rather than showing "0 drafts" to somebody whose drafts are on the next page.
- **A members-only item with no club is labelled as reaching nobody**, because that is exactly what it does.
- **No photograph anywhere.** The contract publishes no route by which a creator could add, replace, or deliver an image, so both screens that would host one carry a deliberate blocked state instead of an upload control that could not work.
- **No notification control.** The notification contract is a consumer-audience one that refuses a Creator Studio credential outright, so there is no creator notification to count and a bell with a number beside it would be the first fabricated thing on the surface.
- **No price field.** Both offer-creation operations exist in the API and both refuse in every deployed environment; a form that always fails is worse than an explanation.
- **A deliberately unavailable capability looks deliberate.** A blocked capability uses a distinct treatment from an error, so nobody contacts support about a decision the platform has already made and can explain.

### An invitation is treated as the bearer secret it is

Shown once, masked until somebody asks to see it, copied with one control, and dismissed by the creator rather than by a timer that could take it away mid-copy. It is never written to a log, never put in an address, never stored, and never rendered in the listing that follows. The listing carries only what the contract publishes about an invitation: when it was issued, when it expires, and whether it has been used, withdrawn, or run out.

### A creator sees their own access control, never their members

How many grants are live, where each came from, and when it was made. No name, no handle, no identifier, no behaviour — the contract publishes none, and a surface that displayed one would be the place a member-privacy decision quietly got made.

### One payout intent carries one idempotency key

The key is made when the creator opens the confirmation and reused on every attempt for that intent, so a retry after a dropped connection is one payout rather than two. A key regenerated per press would make the header decoration rather than protection.

## Consequences

Creator Studio is a product rather than a scaffold, and the visual decisions inside it are now written down and testable instead of implicit. The cost is a filled-in palette that a later approved Figma handoff may contradict. That cost is bounded on purpose: the values are semantic role names in one file, no component encodes a raw value, and no approved value was overwritten — so reconciling with an approved handoff is a change to one stylesheet rather than a redesign.

The second consequence is that the honest gaps are now visible instead of hidden behind an unstyled page. A creator can see that no image can be attached to anything, that nothing can be sold, that no payout can be sent, that mature content is refused for four reasons none of which are theirs, and that a members-only item with no club is reachable by nobody.

## Security and testing

No authorization moved to the client. Every gate in `src/app/gate.tsx` decides what is worth putting in front of somebody and nothing else; every request behind it is authorized again by the server, and a refusal is rendered as a refusal. The session is still an `HttpOnly` `__Host-` cookie scoped to the `creator_studio` audience plus the CSRF echo, and no invitation secret, provider name, storage key, or internal identifier reaches a log.

Evidence: 46 unit assertions driving the surface through the generated client against a stand-in API that answers the real contract; a browser suite covering activation, the adult gate that belongs to another surface, identity, the public preview read from the public addresses with no session attached, publishing, clubs, invitation issue and cross-surface redemption, stale-edit refusal, session expiry, keyboard operation, dialog focus containment and restoration, an assertion that no fabricated figure appears on any destination, and the layout at ten widths from 320 px to 1728 px with a per-element sideways-overflow assertion.

## Migration and reversibility

Additive to the client, with two exceptions worth naming.

`packages/creator-client` gained the paging parameters the contract already published for clubs, memberships, and offers, which no client had bound — so a creator with more than one page of clubs could not reach the rest.

`apps/api` gained one field in one response mapper: the creator's own view of an item now carries `clubId`. The contract already published it and the row already held it, so the association was write-only — a creator could attach an item to a club and never read back which one. The visitor's view is a separate allow-list and is unchanged, because a visitor learning which room an item belongs to would be learning about a room they are not in.

Reverting is deleting one surface's stylesheet and screens, not unwinding a platform decision.

## Status

| Decision | Classification |
|---|---|
| WARM SIGNAL semantic values implemented in `apps/creator-studio` | LOCK NOW |
| Creator Studio light-only | LOCK NOW |
| Five-destination creator information architecture | LOCK NOW |
| A separate Studio component and icon layer rather than a shared one | LOCK NOW |
| Approved Figma product-screen handoff | DESIGN REQUIRED |
| A dark Creator theme | DESIGN REQUIRED |
| Creator media of any kind | DEFER UNTIL PROVIDER INTEGRATION |
| Creator-audience notifications | DECISION REQUIRED |
| Moving these values into `packages/design-tokens` | REJECTED until Figma approves them |
| Any surface stating a fact the server did not publish | REJECTED |

## Cross-references

[Design principles](../design/01-design-principles.md), [design-system contract](../design/02-design-system-contract.md), [Figma source of truth](../design/03-figma-source-of-truth.md), [responsive rules](../design/04-responsive-platform-rules.md), [accessibility and motion](../design/05-accessibility-motion.md), [screen states](../design/06-screen-state-requirements.md), [Creator Studio surface](../surfaces/03-creator-studio.md), [ADR-0004](ADR-0004-client-frameworks.md), [ADR-0015](ADR-0015-shared-design-token-boundary.md), [ADR-0020](ADR-0020-creator-capability-activation.md), [ADR-0027](ADR-0027-consumer-web-product-interface.md), and the [Creator Studio freeze report](../architecture/19-creator-studio-freeze-report.md).
