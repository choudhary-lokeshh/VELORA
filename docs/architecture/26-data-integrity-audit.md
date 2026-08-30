# Real-data / fake-data / state integrity audit

- Audit date: 2026-08-30
- Surfaces: Consumer Web, Creator Studio, Consumer Mobile (Android), Platform Admin

## What this audit was looking for

Every number, state, and claim a person reads, against one question: did the platform actually compute this, or did a screen assemble it? The named targets were hardcoded counts, fabricated people, social proof, engagement, popularity, revenue, financial charts, member counts, provider state, success, scarcity, "trending", impossible status combinations, and seed data escaping the environment it belongs to.

Every finding is classified:

- **A** — real runtime data
- **B** — legitimate local/test seeded data
- **C** — honest unavailable state
- **D** — invalid, misleading, or fabricated presentation

Only D is a defect. Three were found and all three are fixed.

## What is not there at all

The categories that most often go wrong were absent rather than correct-by-accident, and that is worth recording as a finding in itself. Across all four surfaces there is **no** chart, sparkline, or trend line; no follower, view, like, or engagement count; no leaderboard, rank, streak, or "trending"; no scarcity device; no placeholder person; and no hardcoded number rendered as a figure. The public creator and club pages publish no member count of any kind, so a visitor is shown nothing about how popular anything is — because the platform does not compute popularity and a page that implied it would be inventing it.

## A — real runtime data

Every metric on every surface traces to a value the server computed in the same read.

- **Creator Studio**: draft, published, and club counts are filtered from the lists the server returned; the money figures come from ledger balances through one formatter; a club's own member count is the server's count of live entitlements for that club.
- **Platform Admin**: the population, calls-held, and attempt totals sum a **partition** — each account, call, or attempt appears in exactly one state bucket — so the sum is the whole and the arithmetic is sound. The distinction matters, and getting it wrong is finding D-1 below.
- **Provider readiness is read, never inferred.** `liveMediaAvailability` and `rtcLiveAvailability` are derived from the names of the adapters actually composed — `storage !== 'unavailable' && scanner !== 'unavailable'`, `provider !== unavailable && eligibility !== unavailable` — rather than from a flag anybody could set. A store with no scanner accepts bytes nobody vetted; both are required, by name.
- **No hardcoded success path.** Every success message on every surface is behind the server's own answer (`isOk`, `failure === undefined`, `result.kind === 'accepted'`, or a resolved clipboard promise). A refusal is never rendered as a success.
- **Derived states are derived from published fields.** `accountStanding` maps the server's `status`; `availabilityView` distinguishes "expired" from "unavailable" by comparing the server's `state` against its own `effectiveState`, which is a reading of two published facts rather than an inference about a person.

## B — legitimate local/test seeded data

The seed world exists and is useful, and cannot leave. `assertLocalSeedTarget` refuses any `VELORA_APP_ENV` but `local` and any API address that is not plain-HTTP loopback, with no credentials in the URL. It lives in its own module precisely so `pnpm seed:check` can prove the refusal without starting a server or importing a script whose last statement seeds data.

No application source imports the seed fixtures. Nothing seeded can reach a client bundle, and no surface renders a fixture as though it were production truth.

## C — honest unavailable state

The blocked capabilities are stated on the screens they would have appeared on rather than only in a document: payment, payout transfer, call media, push delivery, media delivery where no provider is configured, gift sending and membership purchase on Android, account closure, and the privileged authenticator that makes Platform Admin unreachable in production. Each names what is missing rather than showing an empty frame.

One case is worth naming because it looks like a defect and is not. Creator Studio's overview reads `account.status ?? 'active'` while the onboarding read is in flight. That default decides only whether to raise a **warning**, so before the answer arrives it withholds a warning rather than claiming an account is healthy — and showing somebody a suspension notice that turns out not to be theirs is the worse failure.

## D — fixed

### D-1 · Creator Studio counted memberships and called them people

The overview summed each club's member count and captioned it "people who hold club access now". Clubs are not a partition of anybody: somebody in two clubs was counted twice, so a creator with three clubs and one loyal member could read three people. The per-club figures are real and correct; adding them produces a number of memberships, not of people.

The caption now says **club memberships held now**, which is true of the arithmetic, and the comment beside it explains why counting distinct people is a different question that only the server could answer. Pinned by a test that asserts the caption, not just the number.

### D-2 · Consumer Web presented one page of introductions as three totals

Introductions loads a single default page — 20 rows — and never reads the `nextCursor` the route publishes. The three numbers beside the group names were counted from that page and rendered as bare numerals. A count is the one thing on a partial list that reads as a total, so somebody with more introductions than a page holds read three numbers that were each quietly short, with nothing on the screen saying so.

The lede now says *"These counts describe what has been loaded so far, not a total"* whenever the server sent a cursor — the same distinction Creator Studio's overview already draws, in the same words. Two tests cover it: one that the disclosure appears when the page is partial, one that it does not when the server sent everything.

The underlying paging gap — neither Consumer Web nor Consumer Mobile offers a way to reach a second page of introductions — is a completeness limit rather than a misleading presentation, and is recorded here rather than fixed under this phase.

### D-3 · Platform Admin printed a capped queue as the whole queue

The appeals screen asked for 50 and printed the page's own length as "N awaiting an outcome". `openAppeals` is capped at that same 50 and publishes no cursor, so a queue of any size above the cap reported exactly 50 — an unbounded backlog rendered as a bounded one, in a number that looks exactly like the truth. On an operations console that is the worst class of wrong figure, because the whole purpose of the number is to tell an operator whether they are on top of the work.

A full page now reads **"at least 50 awaiting an outcome"**, which is precisely what the read supports, and a queue that fits states its number plainly. Proved by temporarily removing the fix and watching the test go red.

## Cross-references

[Whole-product QA report](24-whole-product-qa-report.md),
[ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md),
[ADR-0028](../decisions/ADR-0028-creator-studio-product-interface.md),
[ADR-0030](../decisions/ADR-0030-consumer-mobile-product-interface.md),
[ADR-0036](../decisions/ADR-0036-platform-admin-operations-console.md), and
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
