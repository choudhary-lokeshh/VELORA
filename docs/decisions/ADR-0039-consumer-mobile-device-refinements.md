# ADR-0039: Consumer Mobile device refinements

- Decision date: 2026-08-30
- ADR status: Accepted

## Context

[ADR-0030](ADR-0030-consumer-mobile-product-interface.md) established Consumer Mobile under NIGHT CURRENT and the [freeze report](../architecture/21-consumer-mobile-freeze-report.md) recorded the surface as complete: five destinations, a declared deep-link allow-list, every screen with its loading, empty, error and blocked states, and 148 tests behind them.

Driving the whole application again — on an Android 36 device, signed in against a seeded world, at the ordinary text size and at 200%, through every destination, both untrusted entry points, and the modal behaviour the platform imposes — found that the foundation held and that a specific set of things did not. Every one of them is a thing only a device could show.

**The application could not be run on a device at all.** `expo start` came up, and every bundle request returned 404. Metro's server root is the workspace root when a pnpm workspace is detected, so the entry it advertised — `apps/mobile/node_modules/expo-router/entry` — was a path through a pnpm symlink that its file map does not hold. Behind that sat a second failure of the same kind and a third behind that. `expo export` worked throughout, so the packaged artifact was never in doubt; what was unavailable was the ability to look at the product on the hardware it ships on.

**Every screen drew its NIGHT CURRENT atmosphere between four and seven times too strong.** `react-native-svg` hands `stopColor` to the platform's colour parser, which keeps three channels and discards the fourth, so `rgba(225, 122, 102, 0.22)` painted at full opacity. On a busy screen cards hid it. On a sparse one — Notices with a single row, Messages with one conversation — the lower half of the display was a saturated blue field and the upper right a saturated red one, with tertiary text over both. Consumer Web draws the same two washes through CSS, which honours the alpha, so the two surfaces did not look like one product.

**Two screens stated a platform-wide fact that the product was contradicting on the screen before.** You said "VELORA has no approved way to deliver an image, so nobody sees a photograph anywhere in the product" unconditionally, and Profile's subtitle said "none is displayed anywhere yet" — while Discover was rendering a photograph of every candidate and Profile's own Photos card was rendering a thumbnail. The mechanism for saying this truthfully already existed and was already used correctly one screen away: `deliveryUnavailable()` reports what the last exchange actually said.

**`velora://you/memberships` was refused.** Memberships is a real screen reachable by tapping since 2026-08-28; the deep-link parser kept its own copy of the section list and that copy never gained the entry. The test that would have caught it — "accepts every address the application publishes" — named `you/safety` by hand and nothing else, so it proved one section and implied six.

**There was nowhere to look at a person.** Discover is a decision surface and shows one photograph; Consumer Web has an address per person carrying every ready image and the bio unclamped. On a phone there was no such address, so somebody with five photographs was somebody with one.

**There was no gifting surface at all.** Somebody who sent a gift on the web had no record of it on the device in their hand.

**At 200% text a decision could not be read.** "Interested" — the primary action on the card the whole destination exists for — rendered as "Interest…", then, once allowed to wrap, broke mid-word as "Interes/ted". A header subtitle stopped at "and what happ..". A pushed screen's last line sat inside the system gesture band, because the tab bar was holding that band open on the five destinations and nothing was doing it anywhere else.

**Region and language read as wire codes**: `NG` where the web says "Nigeria", "Both speak en" where it says "Both speak English". This one is not fixed here; see below.

## Decision

### The development server is made to work in this workspace, by configuration rather than by patching

`EXPO_NO_METRO_WORKSPACE_ROOT=1` is set on the mobile `dev` and `start` scripts. It is Expo's own published escape hatch, it moves Metro's server root to the project root, and it resolves all three stacked failures at once — the entry, the HMR client replacement, and the transform helpers behind that. No dependency is added, no Metro configuration file is introduced, and `expo export` is left exactly as it was, because it was already correct.

### A wash keeps its alpha, and the alpha keeps one home

The gradient stops pass `stopOpacity` explicitly, read back out of the same token that carries the colour, so `packages/design-tokens` parity remains the only place the value lives. A surface that draws SVG must state opacity separately from colour; that is a property of the renderer, not a preference.

### A surface states what the platform said, not what a document said when it was written

You and Profile stop asserting that delivery is unavailable. You reports what the server says about this person's own photograph, and adds the platform-wide sentence only when the last exchange refused for that reason — the same rule, and the same guard against speaking before there is anything to say, that the photo screen already used. Profile's subtitle says what the screen is for and leaves the answer to the card that has it.

The identity card on You also shows the person's own portrait, from the first slot the server says is ready. A product that shows everybody else's face and not yours reads as something being wrong with your account.

### One list of the sections under You

`links.ts` owns both the array and the type derived from it. The router, the deep-link parser, and the tests for both read that array. The parser's private copy is deleted, and the test walks every entry rather than naming one.

### A person has an address, and a gift has a history

`/people/[personId]` carries every photograph the projection published, the bio, the safety control, and both decisions; it is opened from the identity block of a Discover card and is reachable as `velora://people/<uuid>` with the same UUID validation a conversation link gets. `velora://people` alone is refused rather than quietly redirected, because there is no listing of people and a redirect would be a different address than the one somebody was given.

`/you/gifts` reads back what was sent, with the gift's own silhouette, the exact amount the ledger posted, and what each state means for the person who sent it — the same words Consumer Web uses. Nothing is counted: no total, no streak, no rank.

**There is no send, and no link to one.** `POST /v1/billing/gifts` admits only the `consumer_web` audience, so a control here could produce nothing but a 403. That is not a gap to route around. Whether an application may take payment for a digital gift, or point somebody at an outside page that does, is unresolved Google Play policy; the screen says plainly where sending happens and offers neither a control nor a link. This is the boundary a club that is for sale already draws on the creator's page, applied to the same question.

### Three surfaces draw the eight gift silhouettes, and the gate holds them together

`pnpm design:parity` now reads the gift table out of Consumer Web, Creator Studio and Consumer Mobile and fails if any character of any path disagrees — including the rose, which is five quoted fragments across five lines and which a single-line pattern silently skipped until the check was made to fail on purpose.

### Large text changes the layout, rather than the words

One measured threshold, in one module, used three ways: as a growth ceiling where a slot's width is fixed, as the point at which a row of equal-weight controls becomes a column, and as the point at which a header stops counting lines. The `Actions` primitive owns the row-to-column decision, so Discover, a person, the voice/video pair and the answer/decline pair all get it from one place. A button drops its decorative mark before it costs the label a character.

### A screen that has no tab bar under it holds the gesture band open itself

Whether a tab bar is below is a fact the layout knows and the screen does not, so it is a context the tabs layout provides. It defaults to false, which is the safe direction: a screen that wrongly believes it has no bar leaves a little extra room; one that wrongly believes it has leaves none.

## Consequences

Consumer Mobile can be run and looked at on the hardware it ships on, which is how every defect above was found and how each fix was confirmed. The surface now matches Consumer Web in what a person can see — every photograph of a person, every gift they have sent — and differs only where the server or an unresolved store policy makes it differ, in both cases saying so.

Country and language names remain wire codes on Android. Hermes ships `Intl` but not `Intl.DisplayNames`, so the fallback that was written for an edge case is the only path on the platform. Nothing is fabricated by it and no country list is hand-written, which is why it was written this way; but it is worse than the web for every reader, and closing it means bundling CLDR data or reaching the platform's own names through a native module. Both carry a bundle-size and dependency cost nobody has chosen, so it is open as "Country and language names on Android" in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md) rather than settled quietly. No test can catch it: Node ships full ICU, so the same code renders "Spain" under Jest.

Sending a gift and buying a membership stay unavailable on Android, as does everything already recorded as provider-blocked — real call media, live push delivery, and payout transfer.
