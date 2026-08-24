# Consumer Mobile product interface freeze report

- Freeze status: Frozen
- Freeze SHA: `48b6146`
- Freeze date: 2026-08-24
- Interface authority: [ADR-0030](../decisions/ADR-0030-consumer-mobile-product-interface.md)

## What this work owns

`apps/mobile` only, plus two changes outside it that exist to serve it: a
`./profile-bounds` subpath on `packages/validation` so a client can import a
length limit without importing a schema library, and `pnpm design:parity`, a new
gate step that proves the two Consumer surfaces hold the same visual language.
No backend behaviour changed, no contract was edited, and no locked constant was
touched.

## Where it started

A correct engineering scaffold with no product design in it. One screen held
seven areas as a flat row of unlabelled buttons, a development sign-in field sat
above the work, and `src/product/ui.tsx` said in its own comment that "nothing
here sets a colour". Every behaviour a phone needs was already right; none of it
was presentable.

## What landed

- **NIGHT CURRENT as a token module** — the same 28 colours, 14 spacing steps,
  radii, motion curves, and tracking that `apps/web` publishes, translated to
  React Native units, with shadows given both the iOS and the Android form
  because a card that is flat on one platform is a different product there.
- **The approved typeface and icon stroke**, both of which needed a dependency:
  IBM Plex Sans in four weights by exact subpath, and the same 35-mark icon
  table Consumer Web draws, rendered with `react-native-svg` at 1.75 px.
- **A component layer** — text, buttons, icon buttons, fields, a drawn switch,
  choices, cards, list rows, badges, chips, notices, skeletons, segmented
  controls, identity marks, and four distinct whole states — plus a bottom sheet
  that the system back gesture closes.
- **A native shell**: a drawn tab bar within thumb reach, safe-area-aware screen
  and header scaffolds, pull to refresh, and a toaster that sits above the bar.
- **Eleven route files** across a tab group, a pushed conversation, one route
  holding the five leaves under You, a not-found page, and a redirect that gives
  `/` a home — every destination is a named address so a deep link can name one,
  which leaves the address a launch actually opens with nothing of its own.
- **Thirteen screens**: welcome, the onboarding ladder, discover, introductions
  with calling, messages, one conversation, notices, you, profile,
  availability, notice preferences, safety, and account — plus the launch and
  no-endpoint states, which are real and rendered rather than skipped.

## The rule everything was built to

**Nothing on the surface may claim a capability this build does not have.**

- **No photograph anywhere, and no control that would add one.** Consumer media
  has no delivery route: `packages/validation` publishes image references with
  no address, because authorized delivery needs an approved storage provider and
  there is none. Every person is an identity mark on a stable tone, and the
  surface says why.
- **No push notification and no permission prompt.** No provider is approved and
  this build registers no device token. A prompt for a capability that does not
  exist teaches somebody to grant one for nothing.
- **No call carries media, said before a call is placed** rather than only once
  one is ringing.
- **No message preview on the conversation list**, because a list screen is read
  on a phone that may be face-up on a table.
- **No name against a block**, because the contract publishes none.
- **No account closure**, because every retention schedule it depends on is an
  open legal decision.

## Defects this work found and fixed

1. **No component in the application had ever been typechecked.**
   `apps/mobile/tsconfig.json` included `src/**/*.ts` and not `src/**/*.tsx`.
   Closing the hole immediately surfaced two contract mismatches in new code: a
   message has `senderId` and `createdAt`, not `direction` and `sentAt`, and a
   notification preference publishes no `mandatory` flag. Either would have
   shipped as a blank line or a crash.
2. **Expo Router would have taken `src/app/` as the application's routes.** It
   prefers `src/app` over `app` when both exist, so the providers, gate,
   navigation, and shell would silently have become routes and the real ones
   would never have been reached. They live in `src/frame/` for that reason.
3. **Typed routes made `tsc` red locally and green in CI for the same code.**
   The generated file is under `.expo/`, which is not committed, and
   `expo export` rewrites it with an empty route list — so running the gate
   twice in a row failed the second time. Typed routes are off and
   `src/frame/links.ts` builds every address instead.
4. **The onboarding ladder could render a screen with no step on it**, when the
   account read and the onboarding read disagreed. The account read is now
   authoritative about the first rung.
5. **A switch was a 28-point touch target.** The track still looks like a
   switch; the control around it clears 44.
6. **A disabled primary button dimmed the brand red to a muddy brown** that
   reads as a rendering fault. A disabled control is now flatly neutral whatever
   tone it would have had.
7. **The primary action on a person card was truncated to "Intere…"** at 390 px,
   because the safety control competed for the same row. Safety moved to the
   card header, where it belongs anyway.
8. **The composer opened four lines high**, pushing the conversation off the
   screen before anybody had typed.
9. **A timestamp under every bubble**, which is pure noise in a thread of five
   and unreadable in a thread of five hundred. It now appears on the last
   message of each run.
10. **"Continue" pointed backwards** — the welcome screen's button carried a
    left arrow, and the screen carried two brand marks in its top third.

## How it was verified, and what that does not cover

**There is no simulator, no device, and no Xcode in the environment this was
built in.** The three browser surfaces were each driven in a real browser, and
that is where their defects were found. Here the product was rendered through
`react-native-web` in Chromium and walked at 320, 360, 390, 430, and 768 points
across every screen, checking for element overflow, a document that
scrolls sideways, and any tappable control under 44 points. Every defect in the
list above was found that way.

That proves layout, state, reachability, and target size. **It does not prove
native chrome** — the real status bar, the real keyboard, the real safe-area
insets, the platform's own scroll physics, or how the typeface renders on a
device. Nothing in this report should be read as evidence about those, and the
harness that produced the screenshots is a scratchpad tool that is not committed
and is not part of any gate.

## Tests

- **71 assertions across six suites**, up from 53. The launch and foreground
  lifecycle, the gate's four states, the endpoint resolution, the single-flight
  guard, the product screens, and calling.
- **The calling suite is the one that matters most** and is unchanged in intent:
  a call that ended while the screen was off, a cold start that revives nothing,
  a network handover, an answer on another device, and a platform ending shown
  without being explained.
- **`pnpm design:parity`** proves the two Consumer surfaces agree on 28 colours,
  14 spacing steps, five radii, three durations, two easing curves, label
  tracking, and 35 icon paths — in both directions, so a value added on one side
  and mirrored on neither fails the gate.
- The full gate — `pnpm ci:verify`, twenty steps from toolchain through
  dependency security — is green.

## What is frozen

`apps/mobile` in its entirety: tokens, typeface loading, icon set, component
layer, sheet, shell, navigation, routes, and every screen.

## What is not built, and why

| Not built | Why |
|---|---|
| Any photograph, avatar upload, or camera | No approved storage provider, so no delivery route exists for an image on any surface |
| Push notifications, device token registration, permission prompts | No approved delivery provider, and this application has no native build to register a token from |
| Audio or video on a call | Native media needs a development build this repository has no gate for, and no RTC provider is approved to connect to |
| Account closure and data export | Every retention schedule it depends on is an open legal decision |
| Anything commercial | No published commercial terms; `BILLING_COMMERCE_POLICY` approves no currency, price, or cadence |
| A tablet layout | The approved responsive rules ask for explicit tablet adaptation, which is a design decision nobody has made; the surface reflows to 768 without breaking and claims nothing more |
| An offline queue | The contract supports idempotent submission for messages only, and a queue for anything else would assume success the server has not given |

## Live capability

Everything the contract publishes for a consumer works, in every environment
that can reach an API: authentication, the onboarding ladder, discovery,
introductions, conversations, notices, availability, profile, and safety. What
is unreachable is unreachable because a provider or a legal decision is
outstanding, never because the client is unfinished — and each one is stated on
the screen it would have appeared on.

The application itself is not distributed. Whether a Consumer Mobile application
may be published to either store at all, once mature content exists on Consumer
Web, is an open legal decision recorded in
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), and `MOBILE_IOS` and
`MOBILE_ANDROID` are structurally ineligible surfaces in code rather than
configurable ones.

## What unfreezes each

| Blocked | Unblocked by |
|---|---|
| Images anywhere in the product | Media storage provider decision |
| Push delivery | Notification delivery provider **and** a native build pipeline — two independent blockers |
| Call media | An approved RTC provider **and** a native build pipeline that a gate can compile, link, and run |
| Distribution to either store | Mobile distribution decision; `LEGAL REVIEW REQUIRED` |
| Native-chrome verification of these screens | A simulator or device in the environment that builds them |
| A tablet layout | Approved Figma handoff for the tablet class |

## Cross-references

[Consumer Mobile surface](../surfaces/02-consumer-mobile.md),
[ADR-0030](../decisions/ADR-0030-consumer-mobile-product-interface.md),
[ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md),
[design principles](../design/01-design-principles.md),
[responsive platform rules](../design/04-responsive-platform-rules.md),
[accessibility and motion](../design/05-accessibility-motion.md),
[Consumer Web freeze report](18-consumer-web-freeze-report.md), and
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
