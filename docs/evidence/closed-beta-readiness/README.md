# Closed-beta readiness: what was observed

Recorded 2026-09-05, for the closed-beta launch rehearsal. Every claim here is
something that was watched happen on this machine. Where something is argued
rather than observed, it says so. The launch-facing conclusions are in
[closed-beta launch](../../operations/08-closed-beta-launch.md).

## The finding that mattered most: five migrations that were never applied

`pnpm db:migrate` printed nothing and exited `0`. The local database had 110
tables and no `growth_*`, `operations_*`, or `support_*` among them, which is
how a `GET /v1/growth/live-windows` came to answer `500` for a table that
should have existed.

`drizzle.__drizzle_migrations` held 76 rows against 81 SQL files. Drizzle's
migrator reads one row — the highest `created_at` — and applies a migration only
when its journal `when` is strictly greater. Migrations `0072` through `0075`
carried hand-rounded timestamps a week *ahead* of `0076` through `0080`, so on
any database that had reached `0075`, the five that followed were skipped in
silence, forever:

| Migration | Journal `when` | As a date |
|---|---|---|
| `0071_live-discovery-v2` | 1788193826438 | 2026-08-31 |
| `0075_platform-owned-offers` | 1788900200000 | **2026-09-08** |
| `0076_post-encounter-safety` | 1788454968633 | 2026-09-03 |
| `0080_operations-control-plane` | 1788607411832 | 2026-09-05 |

No test could have caught it: every suite provisions an empty database, and
against an empty database drizzle applies the whole folder in order whatever the
timestamps say. Only a long-lived database is affected — a developer's, and one
day a deployed one, which is the first thing a beta would have been.

The journal was corrected in place, which changed no SQL. `pnpm db:journal:check`
now runs in `pnpm ci:verify` and refuses a journal whose timestamps do not
strictly increase. The repair for a database that already stored a wrong value is
in [data migrations](../../engineering/02-data-migrations.md).

## A sentence on the entry page that had stopped being true

The landing footer read: *"VELORA is in development. Messages are not
end-to-end encrypted, and calls carry no audio or video yet."*

The second half was written before the transport shipped. Two people in a live
encounter now see and hear each other — proved below, over a real provider — so
the first thing every beta visitor read was that the one thing the heading
promises does not work. The false half is gone; the true half stayed.

## Two real people, one real provider

`e2e/live-provider.spec.ts` against LiveKit Cloud, with
`LIVE_DISCOVERY_SIMULATION=unavailable` so a match could only ever be another
real browser. Two contexts, two cookie jars, two seeded accounts.

- Both matched, both published, and both received: inbound audio **and** video
  bytes counted on the transport in both directions, with a decoded frame and
  an advancing clock rather than a still.
- One camera turned off. The other person's picture disappeared entirely rather
  than freezing on the last frame, the caption said the camera was off, and the
  person stayed present — no error state.
- Audio bytes kept arriving while the camera was off, and chat crossed the same
  room. One `RTCPeerConnection` throughout, which is what makes "camera off" a
  control inside one session rather than a second call.
- Next ended it cleanly for the other side, and End returned the first to the
  door.

## A brand-new account, with nothing behind it

`e2e/beta-rehearsal.spec.ts`, added for this phase. Every other browser test
drives a seeded account that already has a photograph, a conversation, a
balance; the state none of them occupies is the one every real beta user starts
in.

- The whole admission ladder from the public entry: sign-in, adult declaration
  said to be a declaration, policy acknowledgement, profile, a real photograph
  through the real pipeline, and the server's own gate opening on Live.
- Every empty screen names its real condition: no introductions, no
  conversations, no notices, an empty wallet history against a real zero, and no
  support tickets. None of them is a spinner, and none invents a figure.
- Send pressed on a support form produces one ticket and one reference, and the
  reference is still there after a reload.
- The invitation control pressed again produces the same link, because there is
  one link per account forever.

## Failure drills, against a running API

- **Redis taken away.** Readiness answered `503` with `ephemeralRedis: down`,
  `queueRedis: down`, `postgres: up` — the truth, per dependency. Product reads
  that need it failed rather than inventing a success.
- **PostgreSQL taken away.** Readiness answered `503` with all three down. Sign
  in and public reads failed. Nothing reported a fake success anywhere.
- **Both restored.** The API reconnected on its own, with no restart: readiness
  returned to `ready` and every route answered again. Measured separately
  against a standalone client with the same options across a 105-second outage,
  which recovered in about six seconds.
- **API and worker restarted.** A support ticket created a moment earlier, its
  reference, an invitation code, and a coin balance all survived. So did the
  browser session, which is a database row rather than the process's memory.

## The public entry, in a production shape

The built Consumer Web artifact was run with `VELORA_APP_ENV=production` and a
public origin, on an isolated port.

- `robots.txt` allowed `/`, disallowed all eleven private prefixes, and named
  the sitemap at the canonical origin.
- The sitemap listed exactly the seven public pages as absolute addresses.
- The entry page carried `index, follow` with an absolute canonical and
  `og:url`; `/you` still carried `x-robots-tag: noindex, nofollow`.
- **And the fail-safe held.** The same production-shaped surface pointed at a
  loopback API refused to be indexed at all — disallow-everything robots, an
  empty sitemap, `noindex` on every page, and a relative canonical — rather than
  publishing an identity it does not have. A surface that is accidentally told
  it is production does not accidentally get indexed.

## What a deployed environment does

Measured by parsing `.env.example` through the real schema at each environment.
`local` and `test` resolve 52 fields. `staging` and `production` refuse, on
eleven issues — four of which are unconditional, because the enums admit only
development values:

```
AUTH_IDENTITY_PROVIDER is not usable in production: no production identity provider is approved
AUTH_ACCESS_TOKEN_SIGNER is not usable in production: no production signing authority is approved
AUTH_RECOVERY_DELIVERY is not usable in production: no production recovery delivery channel is approved
AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER is not usable in production: no phishing-resistant authenticator verifier is approved
```

With every other provider left at its `unavailable` default, those four are what
remain. No deployed VELORA can start until each is decided and implemented, and
none of it is a configuration value somebody has forgotten to set.

## Performance, against the seeded local world

32 people, 12 creators, 47 catalog items, 8 conversations. Warm, three passes,
last reported. Every consumer read is single-digit milliseconds and every
payload is kilobytes.

| Route | Time | Payload |
|---|---|---|
| `/v1/users/me` | 7 ms | — |
| `/v1/discovery/candidates` | 43 ms cold, 8 ms warm | 5.5 kB |
| `/v1/messaging/conversations` | 17 ms cold, 5 ms warm | 4.4 kB |
| `/v1/discovery/introductions` | 8 ms | 4.5 kB |
| `/v1/notifications` | 5 ms | 3.0 kB |
| `/v1/live/sessions` | 7 ms | — |
| `/v1/support/tickets` | 2 ms | — |
| `/v1/growth/live-windows` | 5 ms | — |

Operator screens were measured in the browser suite instead, where each
`e2e/operator-journey.spec.ts` journey — a page load and every read behind it —
completed in 197–764 ms.

## No server secret reaches a client

The built static output of Consumer Web, Creator Studio, Platform Admin, and the
Mobile export was searched for the LiveKit API key, the LiveKit API secret, and
the local database password. None appears in any of them.

## Android

Not walked this phase, and the reason is the machine rather than the product.
`pnpm android:doctor` reports the toolchain complete — JDK 17, SDK, platform 36,
build tools, NDK, platform tools, and an AVD — but the data volume is at 96%
with 9.9 GiB free, and a Gradle plus NDK build of this application needs most of
that. Filling a developer's disk is not an acceptable cost for re-proving
something [ADR-0039](../../decisions/ADR-0039-consumer-mobile-device-refinements.md)
already proved on a real handset. `pnpm android:verify` and `pnpm mobile:doctor`
both pass, so the generated native project and its permission model are
unchanged.
