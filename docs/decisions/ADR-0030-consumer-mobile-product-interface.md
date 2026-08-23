# ADR-0030: Consumer Mobile product interface

- Decision date: 2026-08-24
- ADR status: Accepted

## Context

Consumer Mobile reached this point as a correct engineering scaffold with no product design in it. One screen held seven areas as a flat row of unlabelled buttons, a development sign-in field sat above the work, and `src/product/ui.tsx` said in its own comment that "nothing here sets a colour" — which was true and was the whole problem. Every behaviour a phone needs was already right: a cold launch restoring from the platform keystore, one in-flight refresh shared by concurrent callers, paged and virtualised lists, a foreground revalidation instead of a poll, a send that survives a lost response.

The design authority is partial and says so. [Design principles](../design/01-design-principles.md) approve a Master Visual Language and one Consumer expression — tonal dark, media-first, intimate, socially alive — and mark the remaining palette, component system, product screens, responsive layouts, elevation, and motion `DESIGN REQUIRED`. [ADR-0027](ADR-0027-consumer-web-product-interface.md) filled that gap for `apps/web` as NIGHT CURRENT, bounded to that surface.

Two facts about this surface are unlike any other in the repository and shaped every decision below.

**Nobody can see it.** There is no Xcode, no simulator, and no attached device in the environment this was built in. The three browser surfaces were each driven in a real browser and the defects that mattered were found that way; here the only renderer available was a test library that produces a JSON tree.

**The approved typeface and icon stroke are not free.** IBM Plex Sans is not a system font on either platform, and a 1.75 px stroked icon set has no implementation in React Native without a vector library.

## Decision

### NIGHT CURRENT is the Consumer expression on both Consumer surfaces, and a gate proves it

The approved Master names exactly one Consumer expression. Consumer Mobile is the same product, for the same person, on a different device, so it uses that expression rather than a fourth one invented here. What changes is the idiom — native navigation, native lifecycle, native gestures, touch-first density, and no hover state anywhere — not the palette.

React Native cannot consume a CSS custom property and [ADR-0015](ADR-0015-shared-design-token-boundary.md) restricts `packages/design-tokens` to values an approved Figma handoff has fixed, which these are not. So the values exist twice: as custom properties in `apps/web/app/styles/tokens.css` and as a TypeScript module in `apps/mobile/src/design/tokens.ts`.

**Two copies of a palette drift, so neither is trusted.** `pnpm design:parity` reads both files and fails the gate if they disagree about any of 28 colours, 14 spacing steps, the radius scale, the motion durations and easing curves, label tracking, or any of 35 icon paths. The icon set is the same table, mark for mark: the same product should not draw a different heart on a phone. Exhaustiveness is checked in both directions, so a colour added to one surface and mirrored in neither fails rather than shipping as a difference nobody chose.

What is deliberately not mirrored is layout. A sidebar width, a content maximum, and a reading measure are answers to a question a phone does not ask.

### Three dependencies to honour the approved DNA, and one to make the work visible

- **`expo-font` and `@expo-google-fonts/ibm-plex-sans`** carry IBM Plex Sans in four weights, imported by exact subpath so Metro bundles four faces rather than the package's fourteen. A face that will not load is a visual problem and never a functional one, so the product renders in the platform's face rather than holding a splash screen over somebody who wanted to read a message. Noto is the approved global-script fallback and React Native has no font stack to name it in; a script Plex does not cover falls through to the platform's own full-coverage face, which is the same intent by the only mechanism available.
- **`react-native-svg`** draws the icon set at the approved 1.75 px stroke. Every icon library worth adding draws at 2 px and would have to be overridden shape by shape.
- **`react-native-web`, as a devDependency**, exists so the product can be looked at. It is never exported: `pnpm --filter @velora/mobile build` runs `expo export --platform ios --platform android`, and no web bundle is produced or served by anything.

All three are Expo-managed at the versions SDK 57 pins, and every version clears the 1440-minute release-age policy. This adds no native module class beyond what `expo-secure-store` already requires, and none of it is a capability claim — which is the distinction `docs/surfaces/02-consumer-mobile.md` draws when it explains why `react-native-webrtc` is refused.

### Five destinations, the same five Consumer Web has

Discover, Introductions, Messages, Notices, You — named for what somebody is trying to do rather than for the domain that answers it. The seven flat areas this replaces included "Calls" and "Safety", and neither is a place anybody goes.

**Calling lives inside Introductions.** A call is placed against a mutual introduction and against nothing else; the server derives who the other party is from the relationship. A calling destination would be a second list of the same people with a field somewhere that took a person.

**Safety lives beside the person it is about.** Blocking and reporting are one unobtrusive control on every surface that shows somebody, opening a sheet where the identifier is already known. The wireframe had a Safety screen with a text box for pasting an identifier, which is a safety flow that does not get used. What remains under You is the record — standing, appeals, blocks, reports — and it says where the controls are.

### Every address is a real route

Expo Router, with a tab group and pushed screens for a conversation and for each leaf under You. The system back gesture, a deep link, and a notification all land where they should, and the platform restores the right tab on a cold start.

Two things about that were not obvious and are recorded because the next person will meet them:

- **`src/app/` had to be renamed.** Expo Router prefers `src/app` over `app` as its route root when both exist, so the providers, gate, navigation, and shell living in `src/app/` would silently have become the application's routes. They are in `src/frame/` for that reason and no other.
- **Typed routes are off, and a link module replaces them.** The generated route types live under `.expo/`, which is not committed, so they are absent in CI and present locally — and `expo export` rewrites the file with an empty route list, which turns the next `tsc` run red for links that are correct. A check that is red locally and green in CI for the same code is worse than no check. `src/frame/links.ts` builds every address in one place instead, which is a stronger guarantee against what actually goes wrong.

### The gate had a hole, and closing it found real defects

`apps/mobile/tsconfig.json` included `src/**/*.ts` and not `src/**/*.tsx`, so no component in the application had ever been typechecked. Adding it immediately surfaced two contract mismatches in new code — a message has `senderId` and `createdAt`, not `direction` and `sentAt`, and a notification preference publishes no `mandatory` flag — either of which would have shipped as a blank or a crash.

### Nothing on the surface claims a capability this build does not have

- **No photograph anywhere, and no control that would add one.** `packages/validation` publishes image references with no address, because authorized delivery needs an approved storage provider and there is none. Every person is an identity mark on a stable tone, and the surface says why rather than showing a broken frame.
- **No push notification, and no permission prompt.** No delivery provider is approved and this build registers no device token. The preferences screen lists what the server publishes, says plainly that nothing is sent outside VELORA yet, and asks for no permission — because a permission prompt for a capability that does not exist teaches somebody to grant one for nothing.
- **No call carries media**, and the screen says so *before* a call is placed rather than only once one is ringing. Somebody who presses "Voice" expecting to be heard has already been misled by the time a notice appears on the call card.
- **No message preview on the conversation list.** A list screen is read on a phone that may be face-up on a table.
- **No name against a block**, because the contract publishes none — the list is by date, and says so.
- **No account closure**, because every retention schedule it depends on is an open legal decision.

### Native idioms where a phone differs, not a browser layout scaled down

Bottom sheets rather than centred dialogs, so a confirming control lands under the thumb of a hand already holding the device. A composer that lifts above the keyboard and keeps the words when a send fails. Pull to refresh on every list. A pressed state on everything, because press is all a phone has. Nothing tappable smaller than 44 points, including a switch whose visible track is 28. Text scales with the system setting, uncapped for body copy and capped for display steps, because an uncapped heading pushes the thing it heads off the screen.

## Consequences

- Consumer Mobile has a complete visual and interaction system, and it is provably the same expression as Consumer Web rather than a similar one.
- An approved Figma handoff supersedes one token module and one stylesheet. Nothing was added to `packages/design-tokens` and no approved value was changed.
- `packages/validation` gained a `./profile-bounds` subpath so a client can import a length limit without importing a schema library. The bounds are defined once and re-exported, so nothing drifts.
- The design-parity check is now part of `pnpm ci:verify`, between the contract check and the tests.
- Visual verification was done against a react-native-web render in a real browser, which proves layout, state, and reachability — and does not prove native chrome. That limitation is recorded in the freeze report rather than smoothed over.

## Authority and scope

This ADR authorises the Consumer Mobile interface only. It changes no approved value, adds nothing to the shared token package, and authorises no interim filling for any other surface. `DESIGN REQUIRED` still stands for the full design-system handoff.
