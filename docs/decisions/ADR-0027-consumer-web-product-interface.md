# ADR-0027: Consumer Web product interface

- Decision date: 2026-08-23
- ADR status: Accepted

## Context

Consumer Web reached this point as a working engineering scaffold: one client-rendered page, a tab-switched panel per backend module, browser-default controls, a developer session panel, and the browser's own system palette in place of a theme. Every product behaviour it needed was correct — admission, discovery, introductions, messaging, calling, safety, notifications, memberships — and none of it was presentable. A person opening it could not tell what VELORA was, and a stakeholder looking at it could not tell the difference between a capability that is missing and a capability that is finished but unstyled.

The design authority is genuinely partial and says so. [Design principles](../design/01-design-principles.md) approve a Master Visual Language: a 4 px rhythm, IBM Plex Sans with Noto global-script fallbacks, Living Ember `#B85645` with the dark expression `#E17A66`, a 1.75 px icon stroke, a 2 px focus treatment, a semantic safety and status system, and a Consumer expression that is "tonal dark, media-first, intimate, and socially alive". It then marks the remaining palette, the component system, the product screens, the responsive layouts, elevation, and motion `DESIGN REQUIRED`, and [Figma source of truth](../design/03-figma-source-of-truth.md) says implementation pauses for design rather than silently generating production UI.

"Pauses" is the right rule against an agent inventing a brand nobody asked for. It is the wrong outcome when the product owner has asked, in writing, for the Consumer interface to be built in the approved direction and named the expression. This ADR records that request as an authority rather than letting it arrive as an undocumented commit, and bounds exactly what it authorises.

## Decision

### NIGHT CURRENT is the Consumer expression of the approved Master, implemented in code

The Consumer surface implements the approved DNA verbatim — the two Living Ember values, the 4 px rhythm, IBM Plex Sans with Noto fallbacks, the 1.75 px icon stroke, the 2 px focus treatment — and fills in the values the Master leaves open: a tonal warm-neutral dark surface ladder, three foreground weights, three border weights, four semantic status hues distinct in hue from the brand signal, a radius scale, three elevations, a type scale, and motion timing.

Those values live in `apps/web/app/styles/tokens.css`, as one named semantic contract, and nowhere else. They do **not** move into `packages/design-tokens`: [ADR-0015](ADR-0015-shared-design-token-boundary.md) restricts that package to approved cross-surface values, and these are neither approved by Figma nor cross-surface. The package keeps publishing the approved primitives and the semantic role names; this surface supplies one filling of them.

Every text and icon pair in the palette was measured against its surface before it was written down. The weakest pair in the system is 4.59:1 and every other pair clears 5:1, against a 4.5:1 requirement.

### Consumer Web is dark only, deliberately

The approved Consumer expression is tonal dark. A light theme would be a second visual direction nobody has approved, so `color-scheme` is declared rather than offered and no light palette exists to drift. `packages/design-tokens` keeps a `consumer-light` name for the day one is approved.

### The information architecture is five consumer destinations, not one per domain

Discover, Introductions, Messages, Notices, You. Each is an address, so the browser's Back, a bookmark, a second tab, and a deep link all behave the way they behave everywhere else.

Calling is deliberately not a destination. A call is placed against a mutual introduction and against nothing else, so it belongs where the relationship is; a "Calls" item in the navigation would be the backend module list leaking into the product, which `AGENTS.md` forbids. Availability, safety, memberships, and settings sit under You, so the first four destinations stay about other people.

### One navigation model, three arrangements

A bottom bar within thumb reach below 768 px, a labelled rail from 768 px, a persistent sidebar from 1024 px. Both navigations are in the document and the stylesheet takes one out of the layout, because choosing in JavaScript means the first paint after hydration is the wrong one.

A conversation is a separate address rather than a pane, so on a phone Back leaves the conversation instead of doing nothing, and on a desktop the same address renders beside the list.

### Nothing on the surface may state something the server did not

This is the rule the whole interface is built to, and it decided several visible details:

- **No photograph is rendered anywhere.** Consumer media has no durable address and no authorized delivery route exists, so every person is drawn as a monogram on a tone derived from their identifier. The profile screen says so in its own words rather than showing an image frame that never fills.
- **No fabricated counter.** A conversation with something unread carries a mark, not a number: the contract publishes sequence positions, not an unread count. The navigation badge counts conversations and says "conversations with new messages" to a screen reader, because that is what it counted.
- **No distance, compatibility score, popularity, view count, or "online now".** None is in the contract, and availability is a bounded window rather than presence.
- **No purchase control anywhere**, because no payment provider is approved and a control that cannot succeed is worse than an explanation.
- **A deliberately unavailable capability looks deliberate.** A blocked capability uses a distinct treatment from an error, so nobody contacts support about a decision the platform has already made and can explain.
- **A declaration is called a declaration** on the entry page, on the sign-in page, and on the step itself.

### Safety starts from a person, never from an identifier

Block and report are on every surface that shows somebody — a discovery card, an introduction, a conversation header — behind one unobtrusive control. The previous surface asked a frightened person to find a settings page and paste a UUID into a field, which is a safety flow that does not get used.

### Preferences are rendered from what the server publishes

The notification switches are exactly the category and channel pairs the server returns; if it returns none, none are shown. What the screen does not do is imply anything will arrive: no email or push provider is approved and a website is not a push destination in any case, so the screen says the choices are stored against the day a channel exists.

## Consequences

Consumer Web is a product rather than a scaffold, and the visual decisions inside it are now written down and testable instead of implicit. The cost is a filled-in palette that a later approved Figma handoff may contradict. That cost is bounded on purpose: the values are semantic role names in one file, no component encodes a raw value, and no approved value was overwritten — so reconciling with an approved handoff is a change to one stylesheet rather than a redesign.

The second consequence is that the honest gaps are now visible instead of hidden behind an unstyled page. A person can see that photos are stored and not shown, that calls carry no audio, that nothing can be bought, and that notices arrive in one place only.

## Security and testing

No authorization moved to the client. Every gate in `src/app/gate.tsx` decides what is worth putting in front of somebody and nothing else; every request behind it is authorized again by the server, and a refusal is rendered as a refusal. Session state is still an `HttpOnly` cookie the script cannot read plus the CSRF echo, and no join credential, upload address, storage key, or provider name reaches the document.

Evidence: 83 unit assertions driving the surface through the generated client against a stand-in API that answers the real contract; a browser suite covering the public entry, the admission ladder and where it stops, discovery, introductions, messaging, calling, safety, notices, deep-link restoration, session expiry, keyboard operation, dialog focus containment and restoration, and the layout at ten widths from 320 px to 1728 px with a per-element sideways-overflow assertion.

## Migration and reversibility

Additive to the client only. No contract, table, or route changed; `packages/consumer-client` gained the two notification-preference operations the contract already published. Reverting is deleting one surface's stylesheet and screens, not unwinding a platform decision.

## Status

| Decision | Classification |
|---|---|
| NIGHT CURRENT semantic values implemented in `apps/web` | LOCK NOW |
| Consumer Web dark-only | LOCK NOW |
| Five-destination consumer information architecture | LOCK NOW |
| Approved Figma product-screen handoff | DESIGN REQUIRED |
| A light Consumer theme | DESIGN REQUIRED |
| Moving these values into `packages/design-tokens` | REJECTED until Figma approves them |
| Any surface stating a fact the server did not publish | REJECTED |

## Amendment 2026-08-25: photographs are rendered

One bullet under "Nothing on the surface may state something the server did not" is no longer true, and it is the one the rest of that section was written around.

**"No photograph is rendered anywhere" is superseded.** It was accurate: consumer media had no durable address and no authorized delivery route existed, so a monogram was the only honest thing to draw. Both halves have since been built — `POST /v1/media/deliveries` exchanges the references every projection already carried for short-lived addresses, and DISCOVERY publishes the peer-visibility rule USERS was missing — so discovery cards, introduction cards, the conversation list, a thread header, somebody's own photo grid, and a creator's public page all render photographs.

**Nothing else in that section changes, and the rule itself is unchanged.** A person with no photograph to show still gets the monogram, on the same tone, in the same box; the two are the same size so a list does not move as addresses arrive. Why somebody has no photograph is still never explained — an image still being decided, one its owner removed, and one this viewer may not be shown are deliberately indistinguishable, because the reason is somebody else's business and the API withholds it on purpose.

**The provider decisions above it are untouched.** `MEDIA_STORAGE_PROVIDER` and `MEDIA_DELIVERY_PROVIDER` still default to `unavailable` and staging and production still reject any other value, so a deployed Consumer Web still renders no photograph and says so. What closed was the platform's own gap, not the vendor question, and this surface reports the difference: it says photographs are not shown *here* only when the platform has actually answered that it cannot deliver one.

The five-destination information architecture, the navigation model, the palette, and every other locked decision above are unchanged by this.

## Cross-references

[Design principles](../design/01-design-principles.md), [design-system contract](../design/02-design-system-contract.md), [Figma source of truth](../design/03-figma-source-of-truth.md), [responsive rules](../design/04-responsive-platform-rules.md), [accessibility and motion](../design/05-accessibility-motion.md), [screen states](../design/06-screen-state-requirements.md), [Consumer Web surface](../surfaces/01-consumer-web.md), [ADR-0004](ADR-0004-client-frameworks.md), [ADR-0015](ADR-0015-shared-design-token-boundary.md), and the [Consumer Web freeze report](../architecture/18-consumer-web-freeze-report.md).
