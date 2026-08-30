# Whole-product real runtime QA

- QA date: 2026-08-31
- Commit under test: `c8d101f`
- Runtime: fresh local stack, real PostgreSQL 18.4, real Redis 8.10, applied migrations, deterministic seeded world, Chromium against the running dev servers

## The result, stated first

**No product defect was found.** Three surfaces were walked in a real browser against the running stack — not against a built fixture — at five widths and at 200 % text, and the runtime-health conditions this phase forbids were all absent.

Two things could not be done and are recorded as such rather than glossed: the Android journey could not be re-walked on this machine, and the seeded database carries residue from earlier automated runs.

## 15A — fresh start

| Claim | Evidence |
|---|---|
| Dependencies valid | `pnpm install:check` — frozen install and peer policy verified |
| Migrations apply | 70 files, 70 rows in `drizzle.__drizzle_migrations` |
| Services start | Consumer Web 3000, Creator Studio 3001, Platform Admin 3002, API 4000, Metro 8081, worker — all six reported ready |
| Seed completes | `dev:seed` exit 0 |
| Seed is idempotent | Run three times; 127 accounts and 28 clubs before and after the third, unchanged |
| Metro / Android path valid | Metro answered `/status`, with the project-root server root from [ADR-0039](../decisions/ADR-0039-consumer-mobile-device-refinements.md) |

## 15B–15D — the journeys

**Consumer Web.** Signed in through the real local identity gate as a seeded person, then walked Discover, Introductions, Messages, Notices, You, Sent gifts, Memberships, Safety, Settings, a person at their own address and back, a public creator page by address, and a club inside it. Every route rendered its own heading. A person opened from a Discover card resolved to `/people/<id>` with the name, region and shared languages the projection publishes — "Nigeria" and "Both speak English", which is the same code path that renders raw subtags on Android and the reason that gap is a platform limitation rather than a product one.

**Creator Studio.** Signed in as a seeded creator; home, catalog, private clubs, public page, money and account each rendered their own heading against real seeded data.

**Platform Admin.** Signed in through the local development authenticator at `/access` — the only privileged path that exists, and local-only by construction — and reached all sixteen console destinations: overview, accounts, creators, clubs, queues and both sub-queues, money and all three money areas, and all five platform areas. A nested address survived a reload. An unknown address answered "That page is not here".

One observation, not a finding: the four `/platform/*` addresses share the heading "Platform". They are distinguished by a marked sub-navigation and a distinct lede on each, and the document title differs, so an operator always knows which area they are in. That is a section-and-area pattern rather than an ambiguity.

## 15F — widths and text size

Three surfaces × twenty route-and-width combinations at 320, 390, 768, 1024 and 1440 px, then every route again at 320 px with the root font size forced to 32 px. The style tag is re-applied after each navigation, because `goto` discards it — the mistake that made an earlier version of this assertion unable to fail.

**No horizontal overflow anywhere, at any width, at either text size.**

## 15G — runtime health

Recorded across every navigation on all three surfaces:

- no unexplained console error
- no React warning of any kind, including no duplicate-key warning
- no uncaught page error
- no failed request other than the expected ones
- no 404 on a valid route
- no permanent skeleton — every screen resolved
- no dead control, no navigation trap
- no fabricated data, consistent with the [data integrity audit](26-data-integrity-audit.md)

The only 4xx responses observed were `401` from `/v1/auth/session` while signed out, which is the API correctly saying there is no session, and `404` on addresses that were requested precisely because they do not exist. A browser logs both to the console; neither is a defect.

One earlier reading in this pass was a false alarm worth recording: a walk script reported a person link landing back on Discover. It was the script reading `page.url()` before the client-side navigation settled. Re-driven deliberately, the navigation is correct.

## Not done, and why

### The Android journey could not be re-walked

The emulator will not boot on this machine: 16 GB total with 209 MB unused, and it crashes at startup even with the API, Metro and the other dev servers stopped. The memory is held by Docker's virtualisation VM and the developer's own applications, none of which this work gets to close. That is the **local environment hazard** the [test infrastructure audit](30-test-infrastructure-audit.md) classifies as class D, not a product fault.

**No device proof is claimed for this commit.** What can be said precisely: `apps/mobile` is byte-identical between `a5559de` and `c8d101f` — `git diff a5559de..HEAD -- apps/mobile` is empty — and the full Android walk recorded in [ADR-0039](../decisions/ADR-0039-consumer-mobile-device-refinements.md) was performed on a real Android 36 device at `a5559de`. It covered every destination, both untrusted entry points, the system Back and modal Back behaviour, the onboarding ladder, and the whole application at 200 % text. That walk therefore describes the mobile product as it stands at this commit, because the mobile product has not changed. It is not a substitute for re-walking it, and it is not presented as one.

### The seeded database carries earlier residue

The local database holds creator handles from earlier automated runs — `e2e-…`, `walk…`, `repro…` — alongside the seeded world, because the e2e suites and the seed share one local database. It affected nothing here beyond making a seeded creator harder to pick out, and it is worth knowing before reading a count off the local database and believing it describes the seed.

## Cross-references

[Test infrastructure audit](30-test-infrastructure-audit.md),
[Operational readiness audit](29-operational-readiness-audit.md),
[Data integrity audit](26-data-integrity-audit.md),
[Whole-product QA freeze report](24-whole-product-qa-report.md), and
[ADR-0039](../decisions/ADR-0039-consumer-mobile-device-refinements.md).
