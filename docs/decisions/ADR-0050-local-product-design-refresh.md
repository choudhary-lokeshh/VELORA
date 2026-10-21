# ADR-0050: Local product design refresh

- Decision date: 2026-10-19
- ADR status: Accepted for local/test review; production handoff `DESIGN REQUIRED`

## Context and authority

The product owner selected Consumer Ivory / Olive and then requested a complete UI/UX refresh across the project. This extends the local/test exception in ADR-0027 to the four clients. It does not declare the Pen exploration an approved production Figma handoff or supersede the deployed Master Visual Language.

## Visual and content plan

- Consumer Web: warm ivory, deep olive, large portrait-led discovery and calm horizontal navigation; task headings, personal context, then the existing primary action. Forms, conversations, settings and empty states use the same quiet surface hierarchy.
- Consumer Mobile: the same ivory/olive semantic palette with native bottom navigation, spacious identity-led discovery, accessible sheets, and touch feedback. Native navigation and keyboard behavior remain native.
- Creator Studio: ivory paper and olive ink, editorial titles, a persistent work rail, and open sections separated by rules. The next server-derived task precedes catalog, public-page, money and recent-activity context. Source Serif remains exclusive to Creator editorial headings.
- Platform Admin: cool porcelain, ink navigation and a restrained olive action signal; environment and role remain visible before counted work, filters, records and scoped actions. No editorial hero or serif enters the console.

Interaction thesis: brief content entrance, clear pressed/hover feedback, and underline/selection transitions. Reduced motion removes entrance transforms. No motion implies an authoritative result or interferes with a pending action.

In the Consumer Web preview, inactive paid search preferences sit in an optional disclosure. The active window remains directly visible. Expanding exposes the same catalogue prices, conditions, confirmations and errors before any charge; free Start and Voice controls remain primary. Queued discovery profiles do not offer a load-more control until the held profiles are exhausted.

## Implementation boundary

### App-first replacement review

The owner rejected the sparse, document-like phone entry and requested a more familiar contemporary social-app experience. The replacement preview uses a clean white ground, olive actions, compact brand/context headers, open content and grouped native controls. The visual thesis is a quiet, content-first social utility rather than a marketing page. Live's first viewport contains brand, meeting mode, a brief purpose, the camera consequence and Video/Voice actions; optional paid search moves into a native sheet. Active paid state remains visible, and catalogue prices, charging rules, confirmations and server decisions remain unchanged. Welcome places its form directly after the introduction; the development sign-in explanation and the introduction's privacy sentence remain visible in both appearances. The interaction thesis is immediate pressed feedback, native sheet continuity and predictable Back dismissal, respecting reduced motion.

Consumer Web mirrors the revised neutral color roles to preserve the existing 28-role parity gate; Creator and Admin retain their separate expressions. This is an owner-authorised local/test replacement review, not approval of a production theme or a change to the locked navigation destinations. No fabricated feed, story, presence, attendance or member imagery is introduced.

### Mobile-first follow-up

The owner prioritised phone usability after the initial refresh. The local/test native preview therefore raises the shared touch floor to 48 dp, removes ornamental card borders and shadows, bounds document content to 640 dp, and lets large-text headers grow without truncation. Discovery portraits adapt to window height and text scale to leave more space for identity and decisions; they retain the authorised image or monogram fallback. These measurements are preview-only review choices, not approved production tokens or a complete tablet navigation handoff.

You groups the same nine destinations into Your presence, Clubs & coins, and Preferences & support. No destination, permission or account action changes. Messages gives its virtualised list a bounded flex frame and its own pull-to-refresh; the list still reads the same authoritative contract. This layout correction applies in both appearances. The remaining tablet navigation design and physical-device accessibility/gesture review remain `DESIGN REQUIRED` and unverified respectively.

Document screens, onboarding and sheets include horizontal safe-area insets so landscape cutouts do not cover content. Dragging their scroll views dismisses the keyboard while preserving handled taps and the existing measured keyboard overlap. These native interaction corrections apply in both appearances and change no form submission or domain behaviour.

The subsequent ADB review exposed clipped first-viewport Discovery actions and truncated six-tab labels. Portraits now use a smaller height budget; the preview displays Intros and Chats while preserving the full accessible destination names, routes and signals. Live's entry content is bounded and omits its decorative mark in landscape. At enlarged text, an empty conversation scrolls so the composer is reachable; populated threads retain their existing virtualised layout. The [audit evidence](../evidence/impeccable-ui-audit-2026-10-19.md#adb-native-review) records observed coverage and the separate native development-client reload failure.

Browser roots select a surface-local stylesheet only when `VELORA_APP_ENV` is declared `local` or `test` and the surface configuration validates; an absent value keeps the baseline even on a development runtime, where the shared resolver would otherwise infer `local`. A production build (`NODE_ENV=production`) always serves the baseline, so the browser review lives on `next dev` and the end-to-end suite, which runs production builds declared `local`, proves the deployed expression. Native selects its local palette only for explicit `EXPO_PUBLIC_APP_ENV=local|test`. Missing, invalid, staging and production values retain their original expressions. Baseline token files and `design:parity` remain unchanged. A second parity assertion covers the preview Consumer colors. No shared component or unapproved value enters `packages/design-tokens`.

The refresh changes presentation, not product scope: no new API, permission, provider, business predicate, chart, counter, member data, or optimistic high-impact outcome. Every real route, safety control, refusal, loading/empty/error state, form label and confirmation remains available. Creator and Admin remain separate clients. Deployment enablement, privileged access and approval policy remain governed by their existing authorities.

## Validation and reconciliation

The subsequent [Impeccable audit and polish](../evidence/impeccable-ui-audit-2026-10-19.md) preserves this direction, removes inherited tab chrome, relaxes headline tracking, limits portrait exchanges to visible candidates and hardens decode fallbacks. Native reduced-motion support fulfills the existing accessibility authority in both appearances; it is not a deployed theme change.

The public landing artwork at `apps/web/public/images/velora-conversation.jpg` was generated with the built-in image tool on 2026-10-19 and converted to a compressed JPEG. It depicts fictional adults as brand illustration, is not a member photograph or testimonial, and is not used in any profile, directory or matching projection. Baseline production markup does not request it.

Run each affected client's unit tests, lint, typecheck and build, the boundary and design-parity gates, then inspect browser layouts and keyboard/focus at narrow and wide widths. Native bundle validation does not substitute for an emulator/device visual review; report that separately. Approved production Figma remains `DESIGN REQUIRED`; reconciling it must update this decision and the affected surface authorities before enabling the refresh in deployed environments.

### Review evidence — 2026-10-19

All four client suites passed: Consumer Web 265 assertions, Creator Studio 84, Platform Admin 113, Mobile 221 (683 total). Client lint and typecheck, the three Next builds and Android bundle exports passed. The original design-parity assertions remain intact; `pnpm design:parity` additionally compares all 28 preview Consumer color roles. The 14-workspace boundary check passed.

The browser review covered seven Consumer routes, six Studio routes and four Admin routes at 320, 390, 768 and 1440 px (68 route/width checks), with no document-level horizontal overflow. Public landing was additionally checked at 320/390 px; imagery moved below copy there to preserve contrast. A real safety sheet opened, Escape closed it and restored its trigger; optional search preferences expanded and collapsed from the keyboard. Seeded records remained fixture data, not production activity. An expired Admin assurance was refused rather than bypassed.

Native default and explicit-local Android exports passed, and the portrait decode-failure/replacement test passed. A device visual review remains **not verified**: the emulator booted, but the available native UI-control tool could not bind its window. No native screenshot or device-journey claim is made. This is client-focused validation, not a rerun of whole-product release, security or provider gates.

### Reconciliation — 2026-10-21

A diff review before commit found the preview drifting from this decision in six places, each corrected rather than recorded as an exception:

- The three browser gates read the resolved environment, so an absent `VELORA_APP_ENV` on a development runtime enabled the preview. Each now requires the declared value; tests cover the absent and development-only cases.
- The Consumer Web topbar rendered its preview brand link into every environment's DOM and hid it with CSS. It now renders only in the preview's bare topbar.
- Discovery and the person page renamed `Interested` to `Say hello` with a send icon. The action is a mutual-interest signal, not a message, so the label and icon are restored in both appearances; the person page's preview line keeps `Both speak` for shared languages.
- Live's preview caption dropped `no setting turns that on`, and Welcome's preview hid the development sign-in explanation behind a sheet and dropped `nobody is told you passed`. All three are visible again in both appearances; How Live works stays in its sheet as supplementary guidance.
- Dismissing the paid preference sheet while a hold was in flight unmounted the form that owned the request, so a reopened form could send a second hold. The single-flight state now belongs to the sheet's owner and the sheet refuses dismissal while it is busy; a regression test holds the request open and proves one POST.
- A Discovery region assertion had become a substring match. It is anchored again in both appearances.
- The end-to-end suite runs production standalone builds with `VELORA_APP_ENV=local`, so the preview replaced the deployed expression in every browser run and 13 assertions about it failed; the deployed baseline had no browser proof. Production builds now always serve the baseline. The same run showed three preview differences. One was a defect: the public pages' wordmark and Sign in overflowed a 320 px viewport at 200% text. The preview bar now wraps, and an ad-hoc probe of every public route at 320 px and 200% text on the development server confirmed no sideways scroll. The other two are the preview's own composition rather than defects. Discover's people view carries a visually hidden heading, so the topbar is the one place its name is visible. The paid Live grant sits inside the optional disclosure this decision describes. The baseline's browser assertions describe neither, and they now run against the baseline.

Three native corrections were already unscoped and are recorded here as applying in both appearances, because each is an enlarged-text accessibility fix rather than preview styling: shared headers grow without a line clamp at enlarged text, tab-bar signal counts are capped at the large-text scale, and an empty conversation scrolls at enlarged text so the composer stays reachable.

Mobile passed 231 tests in each appearance, with the transform cache disabled so the environment switch is real.

Documentation-impact audit: this decision records the expanded preview exception; the four surface authorities, Figma-source authority, relevant discovery/creator/Admin flow references and index are updated. No domain, API, persistence, phase, provider, authorization or runtime decision changes. Older production design ADRs still describe the deployed baseline; their local/test exception is explicit here rather than silently replacing them.

Related authorities: [design source](../design/03-figma-source-of-truth.md), [responsive rules](../design/04-responsive-platform-rules.md), [accessibility](../design/05-accessibility-motion.md), [screen states](../design/06-screen-state-requirements.md), ADR-0027 through ADR-0030, ADR-0037 through ADR-0039, and the four [surface authorities](../DOCS_INDEX.md#product-surface-authority).
