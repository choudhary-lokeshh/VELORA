# ADR-0029: Platform Admin product interface

- Decision date: 2026-08-23
- ADR status: Accepted

## Context

Platform Admin reached this point as the least finished of the three browser surfaces. It had a working session read, a handful of module-shaped panels, browser-default controls, and the browser's own system palette. Every privileged read the contract publishes was reachable from it and none of it looked like a console: an operator could not tell a healthy backlog from a stuck one, a count from a judgement, or a refusal from a failure.

It is also the one surface **nobody can reach**. [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md) requires a `platform_admin` audience at recent phishing-resistant assurance. `/v1/auth/local/web-sessions` admits `consumer_web` and `creator_studio` and nothing else; the local adapter issues `single_factor`; and the only privileged verifier the platform composes is `UnavailablePrivilegedAuthenticatorVerifier`, which refuses every assertion because no phishing-resistant implementation is approved. There is therefore no environment — local, test, staging, or production — in which a browser gets past the gate.

The design authority is partial and says so. [Design principles](../design/01-design-principles.md) approve a Master Visual Language — a 4 px rhythm, IBM Plex Sans with Noto global-script fallbacks, Source Serif 4 reserved for Creator editorial moments, Living Ember `#B85645` with the dark expression `#E17A66`, a 1.75 px icon stroke, a 2 px focus treatment, a semantic safety and status system — and an Admin expression that is "clear, dense, operational". It then marks the remaining palette, the component system, the product screens, the responsive layouts, elevation, and motion `DESIGN REQUIRED`.

[ADR-0027](ADR-0027-consumer-web-product-interface.md) and [ADR-0028](ADR-0028-creator-studio-product-interface.md) filled that gap for one surface each, and each said explicitly that it authorised nothing for any other. This ADR does the same work for Platform Admin, on the same authority, and bounds exactly what it authorises.

## Decision

### CLEAR PULSE is the Admin expression of the approved Master, implemented in code

The console implements the approved DNA verbatim — Living Ember `#B85645`, the 4 px rhythm, IBM Plex Sans with Noto fallbacks, the 1.75 px icon stroke, the 2 px focus treatment — and fills in the values the Master leaves open: a cool neutral surface ladder, three foreground weights, three border weights, four semantic status hues distinct in hue from the brand signal, a radius scale squarer than either other surface, three elevations, a type scale, and motion timing.

Those values live in `apps/admin/app/styles/tokens.css`, as one named semantic contract, and nowhere else. They do **not** move into `packages/design-tokens`: [ADR-0015](ADR-0015-shared-design-token-boundary.md) restricts that package to approved cross-surface values, and these are neither approved by Figma nor cross-surface.

Two departures from the other two surfaces are deliberate:

- **No Source Serif 4.** The foundation reserves the editorial serif for Creator moments. Nothing on a console is editorial, and a decision that ends somebody's access is not a place for a display face. IBM Plex Mono is added instead, for the one thing this surface has that the others do not: opaque identifiers an operator carries between systems, where a zero and a capital O being distinguishable is a correctness property.
- **Density is a token, not a habit.** Controls are 36 px and table rows 40 px, against Studio's 44 px. That is what "information-dense" means in [the responsive rules](../design/04-responsive-platform-rules.md), and it is honest only because a `pointer: coarse` block restores comfortable targets on anything a thumb drives. A dense console that is also unusable on a tablet would be a design that ignored half its own brief.

### Platform Admin is light only, deliberately

The approved Admin expression is clear and operational. A dark theme would be a second visual direction nobody has approved, so `color-scheme` is declared rather than offered and no dark palette exists to drift. `#E17A66`, the approved dark expression, is unused by this surface and absent rather than repurposed.

### Colour is only ever the server's own published judgement

This is the rule that shaped the surface more than the palette did.

It would be easy to tone a row red because its state string contains `failed`, and easy to be wrong: one domain's `failed` is terminal and another's is retried in ninety seconds. Most operational reads publish `state` as an open string in the owning domain's vocabulary, so the console **humanises** rather than interprets — `provider_pending` becomes "Provider pending" — and prints it in plain ink. A state added upstream tomorrow therefore reads correctly today.

The only things that get a colour are the judgements the contract itself publishes: `breached` on a backlog, a case's own priority, a creator's own status, an appeal's own state. Everything else is a count in plain ink, which on a console is the difference between a signal and a decorated table.

### Four destinations named for the work, not one per backend module

Queues, Creators, Money, Platform, with the session under Access at the foot of the navigation. "Billing", "Moderation", "Notifications", and "RTC" are not destinations: `AGENTS.md` keeps backend architecture out of client responsibility, and a console with an item per backend module is exactly that leak. An operator asking "is anything stuck" asks once, under Platform, where the four subsystems are peer areas rather than nested pages.

### Nothing on this surface publishes a person

No name, no handle, no contact detail, no consumer account, no object key, no digest, no asset identifier, no payout recipient, no bank detail, no identity document, no secret. A case target is an opaque reference and the screen says so.

There is also **no list and no search over private material**, and that is the same rule rather than an omission. The contract offers exact-reference reads of a media asset, an RTC call, and an identity subject to a tool that already holds an identifier; this console offers none of them, because a lookup field beside a dashboard is where a browsing surface over private material begins. The one search that exists is over public creator handles, which are public.

### The contract and the client live in the app, not in a package

`apps/admin/src/api/` holds types derived from the generated `paths` and one `createAdminApi` with eighteen operations. There is no `packages/admin-client` because there is exactly one consumer and a package with one consumer is indirection with a version number. The generated contract remains the source of truth; nothing is hand-written that could be derived.

### The door is the product, because it is the only address anybody reaches

Given that no browser can be admitted, the access page is not a placeholder — it is the surface. It states both failing conditions separately, because an operator whose audience is wrong and one whose assurance is stale have different problems. It reports what the browser actually holds in the server's own words. It distinguishes "you hold no session" from "this console could not reach the platform", because the origin not being admitted is the likelier state and reading a failed request as "signed out" would be stating something the console does not know.

It offers **no sign-in form**. No route would accept one, a form that always fails is worse than an explanation, and on this surface it would also be a control inviting somebody to try to get in. The one control it offers is signing out, which is real: somebody may be carrying a consumer session on this origin and be better off without it.

### The console screens are proved in the unit suite, because that is the only place they can be

Browser assertions cover what a browser can actually reach: that every console address redirects to the door carrying where it was going, that the door explains itself, that it reads nothing privileged before refusing, that it carries no capability from another surface, and that it is a finished page at ten widths and on a keyboard.

Everything behind the gate is proved against the generated contract with a `fetch`-level double answering real contract paths. That is a weaker guarantee than a browser and it is stated as one rather than dressed up: it is what remains available when the surface cannot be entered, and it becomes a browser assertion the day a privileged authenticator is approved.

### An operator's judgement is the product, so the console does not pre-judge

The case screen shows reports as filed, evidence as recorded, and decisions as made. It does not summarise them, score them, rank them, or suggest an outcome. A console that pre-judged would be making the decision while leaving the operator's name on it.

Two consequences are visible in the decision form. Nothing is applied optimistically — the screen never claims a state the owning domain has not confirmed — and every decision carries the version the operator was looking at, so two moderators reaching one case produce one decision and one refusal. And **no reason is preselected**: which reason fits which action is policy, and policy is not written in a client, so the form asks and refuses to submit without an answer rather than letting an operator record a hold against "no violation found" by never touching the field.

## Consequences

- Platform Admin has a complete visual and interaction system that is its own, sharing the approved DNA with the other two surfaces and nothing else.
- An approved Figma handoff supersedes one stylesheet in one app. Nothing was added to `packages/design-tokens` and no approved value was changed.
- The surface is honest about being unreachable, in the product rather than only in a document.
- Console-screen responsiveness is verified by hand against a stub rather than by a committed browser assertion, because no committed browser assertion can get past the gate. That limitation is recorded in the freeze report rather than papered over.
- Three decisions this surface depends on stay open and are recorded in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md): the privileged authenticator provider, the approval and break-glass policy, and the role and scope matrix.

## Authority and scope

This ADR authorises the Platform Admin interface only. It changes no approved value, adds nothing to the shared token package, and authorises no interim filling for Consumer Mobile. `DESIGN REQUIRED` still stands for the full design-system handoff.

## Amendment 2026-08-26: Phase 8 clarity pass

The product-owner Phase 8 brief asks CLEAR PULSE to look finished while keeping operational clarity first. The console therefore adds only a quiet canvas depth, separation at the navigation boundary, and a stable inset face behind panel headings. All treatments use the semantic values already locked by this ADR. No decorative signal, data interpretation, status color, control, route, or privilege was added, and panels remain bordered operational regions rather than promotional cards.
