# Whole-product QA freeze report

## Scope

This report records the Phase 10 product walk over the Phase 9 deterministic
local world. It does not reopen Phases 1–9 and it does not claim that a local
adapter is a production provider. The evidence came from `bun run dev`,
`bun run dev:seed`, real browser surfaces, the Android 36 emulator, the running
API and worker, PostgreSQL, and Redis.

## Local world and browser surfaces

The seed completed through public API contracts with 32 consumers, 12
creators, 47 creator items of which 41 are public, 6 clubs, 30 invitations of
which 15 are redeemed, 8 mutual and 6 waiting introductions, 8 conversations,
and 6 settled gifts. It remains deterministic, local-only, and guarded against
non-loopback or non-local targets.

Consumer Web rendered populated People and Creator discovery, public creator
profile and media, catalog and club states, gift selection and honest final
payment confirmation, introductions, conversations, notices, the consumer's
profile and safety state, sign-out, sign-in, and sent-gift history. Creator
Studio rendered its home, public preview, profile media, published and
members-only catalog, club membership work, gift history, and ledger-derived
money state. Public media traversed reserve, upload, worker processing, and
anonymous delivery; browser inspection found no broken image.

The browser walk found one runtime defect: Next development mode requires
dynamic evaluation for its own development runtime, while the shared CSP
correctly forbade it. The fix permits `unsafe-eval` only when the client config
is explicitly in development runtime, the application environment is local or
test, and the API origin is plain-HTTP loopback. Production builds keep the
strict policy, and tests prove both the narrow allowance and every refusal.
Fresh Consumer and Creator sessions then produced no console error or warning.

Platform Admin has no browser bypass. `/queues` redirected to the access gate,
which truthfully reports that no `platform_admin` issuer and no approved
phishing-resistant authenticator exist. That is `ADMIN_BLOCKED`, not a failed
consumer or creator flow and not authority to weaken the gate.

## Android device evidence

The installed development build ran on Android 36 in `velora-android36`. A cold
launch reached the development launcher, selected the running Metro server,
and restored an authenticated application session. The real app rendered
populated discovery, introductions, a conversation and unread message, an
unread notice, account and safety navigation, and an editable profile with a
ready local media thumbnail. Background and foreground preserved the route.
The `velora:///messages` and `velora:///notices` links reached the allow-listed
destinations. Force-stop followed by relaunch restored the encrypted session
after the development launcher reattached to Metro. Device sign-out returned
to the honest local-development identity gate, and sign-in as a seeded person
returned to populated discovery.

There was no Android fatal exception, JavaScript error, unhandled promise, or
script-load failure. The only matching native log entry was React Native's
known lifecycle soft exception while its context was not ready during the
development-launcher transition; it neither reached JavaScript nor interrupted
the app. Camera, live push delivery, and real call media remain separately
provider- or product-gated as recorded by the Android freeze authority.

## API inventory

`pnpm runtime:inventory:check` freezes all 137 OpenAPI operation identities,
methods, and paths behind a reviewed digest. Every operation is classified as
`PASS`, `PROVIDER_BLOCKED`, `POLICY_BLOCKED`, or `ADMIN_BLOCKED`: 107, 5, 1,
and 24 operations respectively. The local live probe additionally observed 4
`PASS`, 132 `EXPECTED_REJECTION`, and 1 documented `PROVIDER_BLOCKED` response,
with no unexplained 500. The probe accepts only an uncredentialed HTTP loopback
origin, sends no valid mutation payload or session, requires the observed
status to be documented by that operation, rejects every literal 500, and
accepts another 5xx only for an already blocked operation. Contract additions
or route changes fail the canonical gate until the entire inventory is reviewed
and its digest deliberately advanced.

The classifications describe the operation boundary, not a production-launch
claim. Local payment, media, RTC, notification, and identity adapters remain
local/test-only; live vendors remain unavailable until their recorded provider,
security, privacy, compliance, country, channel, reconciliation, and operations
gates are approved.

## Freeze boundary

The canonical local gate passed with 1,401 PostgreSQL integration tests, 152
browser tests, 126 mobile tests, the generated Android manifest gate, contract,
design-parity, secret, hygiene, and dependency-security checks. Phase 10 is
closed only after hosted verify and Android compilation also pass on the exact
commit. No architecture decision changed: this work added runtime evidence, a
drift gate over the published contract, and the narrow local development CSP
condition. No ADR is required. This report is the new durable QA authority, so
the documentation index is updated; other durable behavior and ownership
authorities are unchanged.
