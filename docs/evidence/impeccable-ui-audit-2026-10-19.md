# Impeccable UI audit and polish — 2026-10-19

## Verdict and scope

The reviewed UI expresses the owner-selected Ivory / Olive system coherently. This was a refinement of the ADR-0050 local/test preview, not a replacement design. Consumer, Creator and Admin responsibilities remain separate. The native accessibility correction also applies to the existing deployed appearance because respecting system motion preferences is already required by the accessibility authority.

The audit covered source across all three browser clients and Consumer Mobile, with a fresh browser walk of Consumer landing, discovery, responsive actions and safety dismissal. Studio/Admin source and their existing responsive evidence were reviewed; their layouts were not redesigned or freshly certified. Native review was source and component-test based, not a device visual inspection. No previous critique snapshot existed.

## Audit health

Scores are bounded review judgments, not accessibility certification or performance benchmarks. A 4 requires broader runtime evidence than this pass collected.

| Dimension | Browser clients | Native | Evidence / limit |
|---|---:|---:|---|
| Accessibility | 3/4 | 3/4 | Named controls, restored safety focus, measured core text contrast; native motion now follows system state. Screen-reader/device matrix remains unverified. |
| Performance | 3/4 | 2/4 | Hidden discovery portraits are no longer requested. Native lists remain virtualized. No hardware frame-time or launch benchmark was collected. |
| Theming / appearance | 3/4 | 3/4 | Semantic palettes and both Consumer parity gates pass. Production preview approval remains separate. |
| Responsive / platform conformance | 3/4 | 3/4 | Fresh Consumer checks at 320/390/768/1440 px; native uses stacks, sheets and system Back. Physical gestures were not tested. |
| Implementation integrity / native adaptivity | 3/4 | 2/4 | Deterministic scan clean; manual defects below were fixed. Native tablet, landscape and large-text visual review remains outstanding. |
| Total | **15/20 — Good** | **13/20 — Acceptable, provisional** | Evidence limits prevent a release-ready verdict. |

## Verified findings and fixes

Six findings: one P1, three P2, two P3; no P0 observed in the reviewed paths.

1. **P1 — Native ignored Remove animations.** `apps/mobile/app/_layout.tsx`, `src/design/sheet.tsx` and `src/product/live.tsx` used unconditional navigation/sheet slides, moving reactions and looping rings. These can cause difficulty for motion-sensitive users and contradict the existing accessibility contract. A shared system-preference hook now starts still, observes live changes, handles read failure and prevents a late initial answer from overriding a newer event. Reduced motion uses still transitions/reactions and removes decorative rings without losing state. Normal animations retain cleanup; an interrupted camera-preview drag also resets its offset. Recommended command: `impeccable polish`. **Fixed.**
2. **P2 — Hidden portraits requested.** `apps/web/src/product/discovery.tsx` exchanged media references for every queued candidate while displaying only one. This wasted requests and issued unnecessary short-lived delivery addresses. The preview now resolves only the visible portrait; advancing resolves the next one through the same authorized contract. Baseline grid behavior is preserved. Recommended command: `impeccable optimize`. **Fixed.**
3. **P2 — Browser portrait decode failure lost the intended fallback.** The discovery card handled absent addresses but not failed images. It now returns to the existing monogram while keeping the person's link, name and actions. Recommended command: `impeccable harden`. **Fixed.**
4. **P2 — Native stale decode error could hide a new image.** `apps/mobile/src/design/portrait.tsx` tracked failure as a boolean. An old image's delayed callback could mark its replacement failed. Failure is now associated with the exact source address. Recommended command: `impeccable harden`. **Fixed and regression-tested.**
5. **P3 — Landing display tracking was too tight.** The local headline used `-0.055em`; it now uses `-0.04em`, retaining the selected typeface and composition. Recommended command: `impeccable typeset`. **Fixed.**
6. **P3 — Underlined tabs retained a box.** The preview overrode the bottom border but inherited the original top/side borders. Those are now removed; selection remains an underline with existing tab semantics and keyboard behavior. Recommended command: `impeccable polish`. **Fixed.**

## Evidence and positive findings

- Impeccable 4.6.0 / engine 0.1.15 scanned `app` and `src` in Web, Studio and Admin once after editing. JSON result: `[]`, exit 0. This is source-only mechanical evidence, not a rendered contrast verdict. No rules were disabled or suppressed. Native was not sent to the web detector.
- Across primary/secondary/tertiary text against four solid preview surfaces, the weakest contrast was Web **4.67:1**, Studio **4.74:1**, Admin **5.29:1**. Primary-button text contrast was **8.45:1**, **8.68:1**, **9.22:1** respectively. Photographs, overlays, disabled states and every possible content combination were not certified by this calculation.
- Fresh discovery checks at 320/390/768/1440 px found no document overflow. Decision controls measured 56 px high and safety 48 px. Tabs had 0 px top/side borders and a 1 px bottom rule. Escape closed safety and restored its trigger.
- All client suites passed: Web 266, Studio 84, Admin 113, Mobile 225: **688 tests**. New regression coverage includes media-request minimization, browser decode failure, stale native callbacks, preference changes, listener cleanup and a failed system-setting read. Affected-client lint/typecheck, Web build, Android preview export, boundary and design-parity checks passed.
- Existing server-confirmed decisions, loading/error/refusal states, reduced-motion browser rules, safe media fallbacks and separate operational vocabulary remain intact. No member identity, metric, payment result or availability was invented.

## Remaining review and documentation impact

Native device, tablet/landscape, large text, TalkBack, physical touch and frame-time review remains required. The existing native 44-point minimum should be reviewed against Android's 48 dp recommendation in the approved device handoff; this pass does not claim platform-target conformance from a browser viewport. Production Figma handoff remains `DESIGN REQUIRED` under ADR-0050. No new theme, privilege, provider, domain behavior or architecture decision was introduced.

The accessibility and Mobile surface authorities and ADR-0050 record the implementation correction; the index links this evidence. No new architecture ADR is needed. There is no unexplained design drift beyond the already explicit preview exception. Optional `impeccable init` can capture tool context later, but must reference the authoritative `docs/` paths rather than creating competing product/design truth.

## Mobile-first follow-up

The subsequent owner request prioritised mobile UX and authorised further redesign. The explicit native preview now uses a 48 dp shared touch floor, quieter borderless cards, bounded document width, growing large-text headers, window/text-aware portrait proportions, and three account-menu groups containing all nine existing destinations. Messages now has a bounded virtualised list and list-owned refresh in both appearances.

Both baseline and explicit-preview Mobile suites pass **227 tests** each, including account destination reachability and list refresh through the generated client. Mobile lint/typecheck, Android preview export, design parity, dependency boundaries and diff whitespace checks pass. The earlier 688-test count remains historical evidence for the prior four-client pass; unchanged browser suites were not rerun for this native-only follow-up.

Native visual QA is still blocked: the emulator reached device state, but the host UI tool returned “The Mac is locked and automatic unlock could not unlock it.” The owner was asked to unlock. No screenshot, native gesture, large-text rendering, tablet navigation or full redesign-completion claim is made from unit tests. The 48 dp preview floor resolves the earlier preview target-size choice; the deployed baseline and production Figma requirement remain unchanged.

After the owner confirmed unlock, the host UI tool resumed but rejected both the exact running emulator executable path and `qemu-system-aarch64` with `Invalid app`. The emulator was running and listed by ADB. The tool's computer-use restriction requires an explicit user request before substituting another UI-control technology, so an ADB screenshots/taps/navigation request is pending. Meanwhile horizontal safe-area handling and drag-to-dismiss keyboard behaviour were corrected in shared screens and sheets. The 227-test explicit-preview suite, lint/typecheck, Android preview export and diff checks passed again. Native visual QA remains unverified.

Documentation impact: ADR-0050, the Mobile authority, this evidence and the design reading-path index were updated. No new architecture ADR, backend contract, permission, provider, product phase or shared token change was needed.

## ADB native review

The owner explicitly authorised ADB screenshots, taps and test navigation after the host UI tool could not bind the emulator. Review used the installed VELORA development client on Android 36, `velora-android36`, 1080 × 2400 portrait and 2400 × 1080 landscape, serving current local-preview JavaScript from Metro. This is an emulator journey, not a newly compiled APK, physical-device certification or RTC integration test.

Observed: development sign-in with an existing fictional seed account, Live entry, Discovery, grouped You menu, conversation list, opening a long-name empty conversation, the person-scoped safety sheet, and system Back dismissing that sheet. No report, block, payment, message, camera or microphone effect was performed. At system font scale 2.0 the long name wrapped; the empty conversation's composer was initially unreachable and became reachable by scrolling after correction. Discovery's initial portrait budget put decision controls below the first viewport; the smaller budget subsequently exposed both complete controls. Intros and Chats prevent the preview's long tab labels from truncating while accessible names and route identities remain unchanged. Landscape Live was bounded to a readable width and its decorative mark omitted, exposing Start in the first viewport. Other content remains scrollable.

Evidence screenshots are kept outside the repository, in the reviewer's local session output: `discover.png`, `you.png`, `messages.png`, `conversation.png`, `conversation-large-text-scroll.png`, `safety.png`, and `landscape.png`. The development-client Tools overlay is not product chrome. Some earlier captures show intermediate tab labels or layout; `discover.png` is the final normal-text preview. System font scale and rotation settings were restored to their original values.

Both baseline and preview suites passed **228 tests** each. Mobile lint/typecheck, Android preview bundle export, design parity, boundaries and diff whitespace checks passed. New tab regression coverage proves the short visible labels preserve full accessible names, signals and navigation.

An unresolved development-client defect was observed on Reload: `audioRecordSamplesDispatcher is not initialized` during LiveKit module invalidation. A cold restart reopened the app. This pass changes neither native RTC initialization nor provider setup and does not certify reload/media behaviour. Physical hardware, TalkBack traversal, populated-thread large-text composition, tablet navigation, full route/state coverage and production Figma approval remain outstanding. The earlier blocked-review statements are historical; this section supersedes them only for the explicitly observed journey.

Documentation impact: ADR-0050, the Mobile surface authority and index reference this review. No new architecture ADR or backend/security/provider contract change. Production visuals remain `DESIGN REQUIRED`; local preview divergence stays explicit.

## App-first Consumer replacement

The owner rejected the sparse phone entry as insufficiently app-like and authorised replacement composition. Impeccable, frontend-skill and the installed UI/UX Pro Max reference database informed a white/olive, content-first native preview. No extra skill installation or external design service was required.

- Welcome removes the large spacer and boxed development explanation. The form follows the short introduction; Development sign-in, Development identity, the unchecked-address hint and adult notice stay visible. A reversible native sheet retains the full local-only explanation.
- Live replaces the decorative hero with compact brand and mode context, left-aligned task heading, a short explanation and the camera consequence before the actions. Video/Voice controls share a row at ordinary text size and stack when enlarged. How Live works keeps the full camera, matching, mutual Connect and recording explanation available.
- Optional paid narrowing opens a native sheet instead of filling the entry viewport. Existing prices, balance, reservation/capture conditions, review, confirmation and failures remain in the form. An active window stays inline. Closing or opening alone performs no command; cancelling an active window returns to the collapsed entry.
- Discovery becomes an open feed item with identity and context first, then the authorised portrait, biography and existing decisions. Account captions are shorter and ready-photo status sits with identity; unavailable/failed photo states retain their notice. Shared native document headers are smaller. No new destination, account power or invented social data was added.
- Consumer Web mirrors six revised neutral color roles and the white browser theme color. The original baseline and separate Creator/Admin expressions are unchanged. The existing internal preview selector retains its `ivory` name for compatibility.

Native ADB observations cover the new Live entry, paid sheet open and system-Back dismissal, feed composition, account navigation, device sign-out, Welcome and the full sign-in information sheet. An existing seed identity signed back in through the normal local adapter. At system font scale 2.0, Video/Voice stacked, both actions remained fully visible, and the paid entry remained accessible; supporting content remained scrollable. Font scale was restored to 1.0. Screenshots in the existing `native-qa` directory use the `app-first-` prefix: Live, Discovery, Welcome, paid preferences, sign-in information and enlarged Live. Emulator Tools chrome is not part of the app. No device payment, report, block, camera or microphone action was performed.

Validation: Mobile **230 tests** in each appearance, Consumer Web **266 tests**, affected-client lint/typecheck, Web production build, Android preview export, boundaries and both palette-parity checks pass. New regression coverage checks reversible sheet presentation and that opening it produces no POST, and local sign-in disclosure without authentication. The paid activation/cancellation and refusal tests now walk the actual sheet entry. Browser inspection confirmed `--canvas: #fff`, neutral support surfaces and no overflow at the reviewed 1280 px width. The weakest primary/secondary/tertiary foreground against the three new solid neutral surfaces is **5.50:1**; this is not whole-product accessibility certification.

ADR-0050, both Consumer surface authorities, Figma-source authority, discovery flow and index record this replacement. No new architecture ADR, API, persistence, provider, runtime, permission or product-phase change was needed. Existing dev-client LiveKit Reload failure, physical-device/assistive-technology coverage and production Figma reconciliation remain unresolved. This pass is a redesign of the described flows and shared presentation, not a claim that every product screen was independently rebuilt or every state/device certified.
