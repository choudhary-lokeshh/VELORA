# Platform Admin console freeze report

- Freeze status: Frozen
- Freeze SHA: `ac16651`
- Freeze date: 2026-08-23
- Interface authority: [ADR-0029](../decisions/ADR-0029-platform-admin-product-interface.md)

## What this work owns

`apps/admin` only. No backend behaviour changed, no contract was edited, no authorization was moved, and no locked constant was touched. The whole of it is a browser client for privileged reads and operations the API already published.

## Where it started

A working engineering scaffold: a session read, a handful of module-shaped panels, browser-default controls, and the browser's own system palette. Every privileged read the contract publishes was reachable from it and none of it looked like a console. An operator could not tell a healthy backlog from a stuck one, a count from a judgement, or a refusal from a failure.

## What landed

- **CLEAR PULSE**, in `apps/admin/app/styles/`: 100 semantic token declarations across a cool neutral surface ladder, three foreground weights, three border weights, four status hues, a squarer radius scale, three elevations, a type scale, and motion timing. IBM Plex Sans with Noto fallbacks; IBM Plex Mono for opaque identifiers; no editorial serif. Controls at 36 px and rows at 40 px, restored to comfortable targets under `pointer: coarse`.
- **A component layer** — panels, a horizontal scroller, a table, fact lists, badges, chips, notices, metrics, fields, selects, acknowledgements, skeletons, and four distinct states (empty, error, blocked, unreachable) — plus a focus-trapping dialog and a 27-mark icon set drawn at the approved 1.75 px stroke.
- **A responsive shell** with three arrangements: a bottom bar below 768 px, an icon rail from 768 px, a labelled sidebar at the widest breakpoint.
- **Eleven addressed routes**: the access door, four destinations, appeals, one case, three platform areas, and a not-found page. Every one is a real address, so Back, a bookmark, a second tab, and a deep link all behave normally.
- **A contract client** in `apps/admin/src/api/`: types derived from the generated `paths`, one `createAdminApi` with eighteen operations, CSRF on every write, keyset paging, and a failure mapper that separates a refusal from an outage.
- **Ten console screens**: queues, one case, appeals, creators, one creator, money, and four platform health areas — plus the decision and refund dialogs.

## The rule everything was built to

**Nothing on this surface may state something the server did not, and nothing may publish a person.**

- **Colour is only ever the server's own published judgement.** `breached` on a backlog, a case's priority, a creator's status, an appeal's state. Every other `state` arrives as an open string in the owning domain's vocabulary, is humanised rather than mapped — `provider_pending` becomes "Provider pending" — and is printed in plain ink. A state added upstream tomorrow reads correctly today, and nothing is toned on a guess about what a word means.
- **No name, handle, contact detail, consumer account, object key, digest, asset identifier, payout recipient, bank detail, identity document, or secret** appears anywhere. A case target is a type and an opaque reference, and the screen says so.
- **No list and no search over private material.** The contract offers exact-reference reads of a media asset, an RTC call, and an identity subject to a tool that already holds an identifier. This console offers none of them, and says so on the screen. The one search that exists is over public creator handles.
- **No cross-currency total**, because adding a euro to a yen produces a number with no meaning that somebody would act on. Amounts render against each currency's own published minor-unit exponent, with the code beside the digits.
- **Every backlog carries the age of its oldest owed item against the age its owner calls late**, and every class is shown every time — a panel listing only what is wrong cannot tell "nothing is owed" from "the signal stopped arriving".
- **The console never claims a state the owning domain has not confirmed**, and every decision carries the version the operator was looking at.

## Defects this work found and fixed

Each was found by driving the real console in a browser or by a test, not by reading the code.

1. **The whole page rocked sideways on a phone.** At 320–430 px the document scrolled 138 px on `/creators` and 56 px on `/platform` while the table that was meant to scroll sat still. Every wide element looked correctly contained, and the containment was a lie: the screen-reader-only text inside a wide table row is absolutely positioned, and an absolutely positioned box is clipped by an ancestor's overflow only when that ancestor is in its containing-block chain. The static scroller did not hold it, so those 1 px spans resolved against the page and grew the document. Fixed at the cause — the scroller establishes a containing block — rather than by clipping the root, which does nothing at all: root overflow propagates to the viewport, and the viewport does not accept `clip`.
2. **The browser overflow assertion could not have caught it.** The helper skipped anything under an ancestor with a non-visible `overflow-x`, which is exactly the false negative above, and it never checked the document's own scroll width. It now accounts for position when deciding containment and reports the symptom independently, on all three surfaces.
3. **The door claimed "you hold no session" when it had not been able to ask.** The console's origin is not in the platform's allowed browser origins, so the request never arrives — and reading a refused request as "signed out" is stating something the console does not know, on the one surface built never to do that. "Answered" is now distinct from "signed in", and the unreachable case renders as an error with a retry.
4. **The decision form preselected a reason.** An operator changing the action to a temporary hold and never touching the reason would record an enforcement against "no violation found". Which reason fits which action is policy and policy is not written in a client, so the form now asks and refuses to submit without an answer. A test pins it.
5. **Platform's areas offered a "back" that went sideways.** `/platform/identity` treated `/platform` as its parent, so the back control returned an operator to the Media tab. The four areas are peers; the control is gone and the tabs are the only movement between them.
6. **The browser assertion forbade the words "Creator Studio" on the door.** But naming the audiences the authentication contract admits is the honest explanation of the refusal. The forbidden list is now capabilities and controls from other surfaces, which is what actually must not appear.

## Hostile states, driven rather than reasoned about

A refused write, a stale version, an unreachable platform, a truncated case, a closed case, a 404 on a case that does not exist, an unknown address, a session for the wrong audience, and no session at all. Each renders as itself. A deliberately blocked capability uses a distinct treatment from an error, so nobody escalates a decision the platform has already made and can explain.

## Responsive and accessibility evidence

The door and the not-found page are asserted in a real browser at 320, 360, 390, 430, 768, 820, 1024, 1280, 1440, and 1728 px, and again at 200 % text size, with no element and no document overflowing at any of them.

The ten console screens were driven at the same ten widths against a scratchpad stub, because no committed browser assertion can reach them. **That is a weaker guarantee than the other two surfaces have, and it is stated rather than dressed up.** It becomes a browser assertion the day a privileged authenticator is approved.

One `<h1>` per page, one named `main` landmark, a skip link, labelled navigation, `aria-current` on the current destination, focus trapped and restored by the dialog, the approved 2 px focus treatment applied once to everything, and every interactive element reachable and operable from the keyboard alone. Every text and icon pair was measured against its surface before it was written down.

## Tests

- **39 unit assertions** over the console screens, run against a `fetch`-level double answering real contract paths — the version carried into a decision, the refusal when the platform has replaced it, the reason that must be chosen, the scope asked for only when the action enforces something, the claim, the triage, the refund acknowledgement, the paging, and the honesty rules.
- **28 browser assertions** across chromium, firefox, and webkit over the reachable surface: that every console address redirects to the door carrying where it was going, that the door explains both conditions, that it offers nothing to type, that it reads nothing privileged before refusing, that it carries no capability from another surface, and that it is a finished page at every width and on a keyboard.
- The full gate — `pnpm ci:verify`, twenty steps from toolchain through dependency security — is green.

## What is frozen

`apps/admin` in its entirety: tokens, stylesheets, component layer, icon set, shell, navigation, contract client, and all ten screens plus the door.

## What is not built, and why

- **No role or scope model.** The console asserts none and gates only on the audience and assurance the session endpoint published. Which role may claim a case, record a decision, suspend a creator, or issue a refund — and which of those need a second approver — is an open decision, so the console offers what the contract publishes to a session that could hold it.
- **No approval workflow, no break-glass, and no dual control.** [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md) locks the semantics; the implementation is an open decision. Building a control that recorded an approval nobody had defined would be a fabricated control.
- **No media asset lookup, no RTC call lookup, and no identity subject lookup**, although the contract publishes all three. Each is an exact-reference read for a tool that already holds an identifier; putting a field beside a dashboard is where a browsing surface over private material begins.
- **No bulk action anywhere.** Every operation names one target. A bulk control that weakened individual authorization or audit is forbidden by the surface document, and one that did not would just be a loop with a progress bar.
- **No legal hold.** MEDIA implements it and the database enforces it; no route exposes it, deliberately, because an operator placing a hold with no enforcement record behind it is an unaudited action on evidence.
- **No analytics, no configuration editing, no country or feature flag control, and no audit browser.** None is published by the contract today.

## Live capability

**Zero, in every environment.** No browser can reach any screen behind the door.

`/v1/auth/local/web-sessions` admits `consumer_web` and `creator_studio` and nothing else, so a `platform_admin` session cannot be issued. The local adapter issues `single_factor`. The only privileged verifier the platform composes is `UnavailablePrivilegedAuthenticatorVerifier`, which refuses every assertion because no phishing-resistant implementation is approved and hand-rolling one would be a fabricated control. Both conditions must be answered, and each fails independently.

This is the truth rather than a defect, and the surface says so in those terms rather than leaving an operator on a console that answers nothing.

## What unfreezes each

| Blocked | Unblocked by |
|---|---|
| Reaching any console screen in a browser | Privileged authenticator provider, plus a route that can issue a `platform_admin` audience — both in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) |
| Role-filtered navigation and operations | Admin permission/approval matrix |
| Approval, dual control, break-glass | Break-glass implementation, on the locked ADR-0017 semantics |
| A browser assertion over the console screens | The two access decisions above; the screens themselves need no change |
| Any identity manual review or override | Identity manual review or override decision; current capability is exact-reference read-only by design |

## Cross-references

[Platform Admin surface](../surfaces/04-platform-admin.md), [ADR-0029](../decisions/ADR-0029-platform-admin-product-interface.md), [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md), [design principles](../design/01-design-principles.md), [responsive platform rules](../design/04-responsive-platform-rules.md), [RBAC](../security/02-access-control-rbac.md), [admin operations](../flows/admin-operations.md), and [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
