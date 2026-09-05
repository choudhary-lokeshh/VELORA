# Closed-beta launch

## Purpose and authority

What has to be true before real adults are invited into VELORA, what is true
today, and what an operator does during and after a beta session. It selects no
vendor and approves no provider; where something is blocked it names the
decision that unblocks it and who owns it.

This document is written against the running code and against evidence produced
by the closed-beta readiness rehearsal, not against the plan. Every
classification below names what produced it, so it can be re-checked rather than
believed.

## The one thing that decides everything else

**No deployed VELORA environment can start.** `packages/config/src/server.ts`
refuses `staging` and `production` on four AUTH selections, unconditionally —
the enums admit only development values, so there is no value that satisfies
them:

| Refused in staging and production | Why | Unblocked by |
|---|---|---|
| `AUTH_IDENTITY_PROVIDER` | no production identity provider is approved | Authentication identity/social/factor platform decision |
| `AUTH_ACCESS_TOKEN_SIGNER` | no production signing authority is approved | AUTH signing authority decision |
| `AUTH_RECOVERY_DELIVERY` | no production recovery delivery channel is approved | Email delivery provider decision |
| `AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER` | no phishing-resistant authenticator verifier is approved | Privileged authenticator provider decision |

Every one is in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) and
every one is an owner decision followed by an implementation, not a
configuration value somebody has forgotten to set. Until all four land, a closed
beta can only be run on a machine running `APP_ENV=local`, with the developer
adapters that configuration admits there and refuses everywhere else.

That is not a reason to postpone the rehearsal, and this document is the result
of running it. It is the reason the beta plans below are written as *sessions on
a host somebody operates*, rather than as a public sign-up.

## Readiness matrix

`GREEN` — a real person can complete it and an operator can see it.
`YELLOW` — it works, with a named limit somebody should know about.
`RED` — a real person cannot complete it in a deployed environment.

| Area | State | Evidence, and what the limit is |
|---|---|---|
| Deployment | RED | Four unconditional AUTH refusals above. External, owner-owned. |
| Signup and sign-in | GREEN | `e2e/consumer-auth.spec.ts`, `e2e/beta-rehearsal.spec.ts`. Local identity adapter only; the production one is the RED row above. |
| Adult gate | GREEN | Declaration required before admission, stated to be a declaration; `e2e/beta-rehearsal.spec.ts`. No age inference of any kind exists. |
| Onboarding | GREEN | Full ladder in a browser, including a real photograph through the real pipeline: `e2e/consumer-journey.spec.ts`. |
| Profile | GREEN | Create, edit, media, handle, visibility; private matching declarations never reach a public page or the operator activity stream. |
| Discover | GREEN | `e2e/consumer-journey.spec.ts`, `e2e/consumer-navigation.spec.ts`. No invented availability, popularity, or distance. |
| Live core | GREEN | Two real accounts over a real provider, media both ways, camera off with audio continuing in the same session, Next, End: `e2e/live-provider.spec.ts`. |
| Live cold start | GREEN | `e2e/live-journey.spec.ts` proves the product never claims nobody matching exists and never shows a count of who is waiting. |
| Live network interruption | GREEN | `apps/api/test/integration/rtc-reconnect.test.ts`, `rtc-lifecycle.test.ts`; surface states proved in the component suite. |
| Premium filters | GREEN | Reserve, capture on first qualifying encounter, expiry, release, no double charge: `e2e/live-journey.spec.ts`, `wallet-live-preferences.test.ts`. |
| Wallet and coins | YELLOW | Correct and server-authoritative. Every purchase channel is owner-blocked: `WALLET_WEB_ACQUISITION` and `WALLET_ANDROID_ACQUISITION` are refused outside local and test, so coins can only be granted in a development environment. |
| Payments | RED | `BILLING_PAYMENT_PROVIDER` has no approved value. Fails closed; never reports a purchase that did not happen. |
| Connect and Inbox | GREEN | `e2e/consumer-journey.spec.ts`. Idempotent send, ordering assigned by the server, blocked and deleted counterparts handled. |
| Notifications | YELLOW | In-product feed works. No delivery channel is approved: `NOTIFICATIONS_DELIVERY_CHANNEL=unavailable` outside local and test, so nothing leaves the platform. |
| Block and report | GREEN | `e2e/consumer-safety-support.spec.ts`, including reporting somebody who has already left. |
| Moderation and enforcement | GREEN | Report to case to restriction to appeal to resolution, with audit: `safety-*.test.ts`, `admin-moderation.test.ts`. |
| Support | GREEN | Ticket, reference, operator update, consumer sees status: `e2e/consumer-safety-support.spec.ts`, `support.test.ts`, and a double-pressed Send proved to make one ticket in `e2e/beta-rehearsal.spec.ts`. |
| Account deletion | GREEN | `users-closure.test.ts`, `e2e/consumer-safety-support.spec.ts`. |
| Creators and communities | GREEN | Public page to signup to the exact destination: `e2e/creator-journey.spec.ts`, `e2e/growth-journey.spec.ts`. |
| Memberships and gifting | YELLOW | Both work end to end against the local-test payment adapter and are blocked by the same payments RED row in a deployed environment. |
| Invites and referrals | GREEN | One link per account forever, attributed exactly once, proved under refresh and a second inviter: `growth.test.ts`, `e2e/growth-journey.spec.ts`. |
| Scheduled live windows | GREEN | Published, shared, timezone-correct, no attendee count: `e2e/growth-journey.spec.ts`. |
| Public entry and SEO | YELLOW | Correct and proved (`e2e/seo.spec.ts`). Nothing is indexable until a production environment exists and a canonical origin is configured — which is the deployment RED row. |
| Admin | GREEN | Seven destinations, capability-scoped, control plane and audit: [ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md). Unreachable in a deployed environment for the same AUTH reason as everything else. |
| Worker and jobs | GREEN | Outbox and queue state visible per domain with the age of the oldest undelivered fact: Platform · Operations. |
| Provider health | GREEN | Every dependency reports `healthy`, `unconfigured`, `unreachable`, or `unknown`, and never a number nothing measured. |
| Android | YELLOW | Device-proved through [ADR-0039](../decisions/ADR-0039-consumer-mobile-device-refinements.md); no Play Console project exists, so there is no installable build for a beta tester who is not handed one over a cable. It was not rebuilt during this rehearsal: the toolchain is complete and the disk was not. |
| Responsive Web | GREEN | 320 to 1440 and 200% text across consumer, creator, and operator suites. |
| Accessibility | GREEN | Keyboard-only journeys, focus containment, landmarks, focus rings, touch targets, and 200% text, in three browser suites. |
| Observability | GREEN | Composed operator activity across eleven domains; no telemetry table, and no figure without a row behind it. |
| Recovery and failure handling | GREEN | Fail-closed configuration, truthful unavailable states, durable retry, and no fake success anywhere the rehearsal could reach. |

## Closed-beta configuration

No new access-control mechanism was built, because none is needed and a
whitelist would be a system to maintain and get wrong. A closed beta is
constrained by *who is handed a link*, and stopped by controls that already
exist.

Before a session:

| Setting | Value | Why |
|---|---|---|
| `live.search` | on | The product. Pausing it is the emergency stop. |
| `growth.invitations` | on | Testers invite the next tester. |
| `growth.scheduled_windows` | on | The window is what concentrates people into the same minutes. |

Everything provider-dependent is already off by configuration and must stay off:
payments, payouts, identity verification, notification delivery, AI. None of
them needs an operator action, and none of them can be turned on by one.

The one lever a beta actually needs is the ability to stop admitting people to
Live without ending the conversations already running. That is
`Platform · Controls · live.search`, it takes effect within five seconds in every
API process, and it is audited with the reason the operator typed.

## Running a session

### Before

- Platform · Operations: every dependency reports healthy, and no outbox has an
  oldest undelivered fact older than its own threshold.
- Platform · Controls: the three controls above are on.
- Queues · Cases and Queues · Support are open and empty, or their contents are
  known.
- Platform · Live: the matching pool is what you expect it to be — nobody
  waiting, no encounters running.
- A second operator is reachable, because the person watching the product should
  not also be the person answering a report about it.

### During

- Watch Activity, filtered to `live` and to `safety`. Every row links to the
  record behind it.
- Do not open a private message, a support description, or a report narrative
  unless a person has asked for help with that specific thing. The console is
  built so that reading someone's words is a deliberate act, and it should stay
  one.
- Note confusion out loud in the tester's own words. "I did not know if it was
  still looking" is worth more than a screenshot.

### After

- Queues · Support: every ticket has a status somebody set.
- Queues · Cases: every report has been opened.
- Platform · Growth: signups by source, and whether the invitations attributed.
- Money · Reconciliation: five invariants, all zero.
- Activity, filtered to `operations`: every control change and every session
  revocation, with the reason that was typed.

## Feedback

Feedback is a support ticket. There is no separate channel, no survey tool, and
no analytics vendor — a beta tester who has to learn a second place to complain
does not complain.

Ask each tester to send one ticket per session through **You · Help**, choosing
the category that fits and putting the shape of it in the summary:

- what they were trying to do
- what happened
- what they expected
- which device and which surface
- how bad it was, in their words

The reference they are handed is the same reference the operator sees, which is
what makes a follow-up possible without an email thread.

## Severity

| Class | Meaning | Response |
|---|---|---|
| P0 | Security or privacy breach, financial corruption, data loss, the product unusable, or a safety workflow that failed | Stop the session. Pause `live.search`. Fix before the next one. |
| P1 | Live, sign-in, or Connect broken for everybody; a repeated money or support failure | Stop inviting new testers. Fix before the next session. |
| P2 | A significant defect with a workaround | Fix in the ordinary way; tell testers the workaround. |
| P3 | Polish, wording, a rough edge | Batch it. |

## Stop conditions

Pause the beta — `Platform · Controls · live.search` off, and no new invitations
— when any of these is true. Each one is observable in Admin, which is why they
are these and not others.

| Condition | Where it shows | First action |
|---|---|---|
| Wallet inconsistency | Money · Reconciliation reports a non-zero invariant | Pause. Do not adjust a balance; there is deliberately no operator route that can. |
| Widespread auth failure | Activity, `users` domain, sign-in failures across accounts | Pause. Check Platform · Operations for the database and Redis. |
| Live unusable | Platform · Live shows searches with no encounters, or Operations reports the RTC provider `unreachable` | Pause `live.search`. Tell testers the truth; the surface already does. |
| A safety workflow failing | A report that produced no case, or an enforcement that did not take effect | Pause. This is the one class where the product's promise is the thing that broke. |
| Any data leak | Anything private on a screen it does not belong on | Pause, and treat it as P0 regardless of size. |
| Account deletion broken | A closure request that leaves the account usable | Pause. |
| Admin unavailable | The console cannot answer | Pause. An unobserved beta is not a beta. |

Resuming is the same control and the same audit record, with the reason.

## First ten users

The first ten exist to prove reliability, not reach. Recruit them from people
the owner can contact directly and who will tell the truth.

1. All adults, all known to the owner, all told what VELORA is before they
   arrive.
2. One scheduled live window, published from Admin, so everybody is present in
   the same fifteen minutes. Concurrency is the whole point: two people on
   VELORA at different hours is not a test of a product about meeting.
3. At least four people in that window, so a first encounter can end and a
   second can begin without waiting for a stranger.
4. A mix of surfaces: Consumer Web on a desktop, Consumer Web on a phone
   browser. Android only if a build has been handed over directly.
5. One operator in Admin for the whole window, doing nothing but watching.
6. One ticket each afterwards, whatever happened.

Progress to the next stage when a window runs with no P0 and no P1.

## First twenty-five

The next fifteen come from the first ten, which is also the first real test of
the invitation path.

- Each of the first ten shares their own invitation link with one or two people
  they would actually invite.
- A creator or two publishes a page and shares it, so a public entry produces a
  signup that Growth attributes.
- Two scheduled windows a week, at different times of day, so supply is not one
  hour deep.
- The operator now watches attribution as well as failures: a signup with no
  origin where a link was shared is a defect, not a preference.

Progress when two consecutive windows run with real concurrency and the reports
that arrive are about the product rather than about it not working.

## First hundred, at ₹0

No advertising, no purchased placement, no bought reviews, no automated
messages to strangers. Every channel below is somebody choosing to tell somebody
else.

| Stage | Channel | What it needs | What to watch |
|---|---|---|---|
| 1 | The founder's own network | Nothing | Whether people who were asked directly turn up in the window |
| 2 | Invitation links from stage 1 | `growth.invitations` on | Signups attributed to `invite` |
| 3 | Creator and community pages shared by their own owners | A creator who wants to be there | Signups attributed to the public entry |
| 4 | Communities where VELORA is genuinely on topic — a Discord, a group chat, a subreddit where the owner is already a participant — announced once, as a person, with a scheduled window attached | Nothing but honesty about what it is | Whether an announced window produces concurrency or only signups |
| 5 | Organic posts on the owner's own accounts, pointing at a public page rather than at a store listing | Nothing | Same |

The thing being grown is **people in a window at the same time**, not accounts.
A hundred signups spread across a month is worth less than fifteen people in one
scheduled window, and the plan should be judged on the second number.

What must not happen, at any stage: seeding conversations, seeding availability,
inventing counts, buying anything, or messaging people who did not ask.

## What to observe, and what not to invent

No target percentage appears here, because nothing has produced a baseline and a
number invented now would become the number everybody optimises against. Observe
these, all of which are rows some domain already writes:

| Question | Where |
|---|---|
| How many people opened an invitation, and how many of those made an account | Platform · Growth |
| How many accounts finished onboarding | Accounts, and the admission ladder in Activity |
| How many searched Live, and how many met somebody | Platform · Live |
| How many connected after meeting | Activity, `discovery` domain |
| How many sent a message | Activity, `messaging` domain |
| How many blocked or reported, and about what | Queues · Cases |
| How many asked for help | Queues · Support |
| Whether any coins moved, and whether the ledger balances | Money · Reconciliation |

## External blockers

Nothing in this section is a code defect, and none of it can be closed by
writing software.

### Before a closed beta on a real host

| Blocker | Owner action |
|---|---|
| Production identity provider | Select and approve one; implement the adapter |
| AUTH signing authority | Decide key custody and rotation; implement it |
| Recovery delivery channel | Select an email provider and verify a sending domain |
| Phishing-resistant authenticator verifier | Select one, so an operator can reach the console at all |
| First operator grant in a deployed environment | Decide who holds it and how it is established |
| Hosting, DNS, TLS, and a domain | Select a platform; the provider ADR queue is open |

### Before public production

| Blocker | Owner action |
|---|---|
| Payment provider, tax position, commerce policy, launch countries | Every purchase path is refused until these land |
| Object storage and media delivery provider | Photographs are filesystem-backed in development only |
| Notification delivery — email and push | Nothing leaves the platform today |
| Google Play Console project and signing | There is no installable Android build for a stranger |
| Search Console and Bing Webmaster verification | Indexing needs a production origin first |
| Legal review of Terms, Privacy, and community rules | The surfaces exist; the words need approval |
| Retention schedules | Live encounters, live messages, operator actions, and acquisition events all persist indefinitely by default |
| LiveKit production credentials and their rotation | The development project is not a production one |

## Cross-references

[What the readiness rehearsal observed](../evidence/closed-beta-readiness/README.md),
[operator runbooks](../engineering/09-operator-runbooks.md),
[platform health](05-platform-health.md),
[incident response](04-incident-response.md),
[support operations](01-support-operations.md),
[moderation operations](02-moderation-operations.md),
[configuration and environments](../engineering/07-configuration-environments.md),
[public entry and SEO](../engineering/08-public-entry-and-seo.md),
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
