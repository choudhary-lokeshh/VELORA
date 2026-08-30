# Production enablement / external dependency readiness

- Prepared: 2026-08-31 at `db2d982`
- Status: **every external capability is interface-ready and provider-blocked.** No production activation is claimed for any of them.

## How to read this

Each capability below has a port, at least one adapter, a configuration key, and an environment restriction that already exists in code. What none of them has is an approved provider, and several are additionally blocked on a policy decision that no provider would supply.

This is a readiness record, not an enablement. The rule the phase sets and this document keeps: **where a required decision or credential is absent, the production activation stops there.** Configuration and interface readiness around it is complete, and is described so that the day a decision arrives, what remains is wiring rather than design.

Three properties hold across all eleven, and they are the reason this is a short document rather than a project plan:

**The seam already exists.** Every capability is reached through a port the domain owns, and every port has an `Unavailable…` adapter that refuses. Nothing anywhere calls a vendor directly.

**The refusal is the default, and it is enforced by configuration rather than by discipline.** `packages/config/src/server.ts` rejects any non-`unavailable` value for these keys in staging and production, with a message naming what is undecided. A deployment cannot accidentally enable one, and an environment that tried would not start.

**A `local-test` adapter is not a provider.** Where one exists it says so under its own name — the tax authority assesses zero *as `local-test`* precisely so the zero is attributable — and configuration refuses it outside local and test.

## The eleven capabilities

| # | Capability | Port | Adapters | Key | Deployed value |
|---|---|---|---|---|---|
| 16A | Payments | `PaymentProviderPort` | Unavailable, LocalTest | `BILLING_PAYMENT_PROVIDER` | `unavailable` |
| 16B | Payouts | `PayoutProviderPort` | Unavailable, LocalTest | `PAYOUTS_PROVIDER`, `PAYOUTS_POLICY` | `unavailable`, unpublished |
| 16C | Identity / KYC | `IdentityVerificationProviderPort` | Unavailable, LocalTest | `IDENTITY_VERIFICATION_PROVIDER`, `IDENTITY_JURISDICTION_POLICY` | `unavailable` |
| 16D | Tax | `TaxAuthorityPort` | Unavailable, LocalTest | `BILLING_TAX_AUTHORITY` | `unavailable` |
| 16E | Media / CDN / scanning | `MediaStoragePort`, `MediaScannerPort` | Unavailable, LocalTest | `MEDIA_STORAGE_PROVIDER`, `MEDIA_MALWARE_SCANNER` | `unavailable` |
| 16F | RTC | `RtcProviderPort`, `RtcCallEligibilityPort` | Unavailable, LocalTest | `REALTIME_RTC_PROVIDER`, `REALTIME_CALL_ELIGIBILITY` | `unavailable` |
| 16G | Notifications | `NotificationChannelPort` | Unavailable, LocalTest | `NOTIFICATIONS_DELIVERY_CHANNEL` | `unavailable` |
| 16H | AI | AI gateway provider port | Unavailable, LocalTest | `AI_PROVIDER` | `unavailable` |
| 16I | Admin production auth | privileged authenticator verifier | Unavailable, LocalTest | `AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER` | `unavailable` |
| 16J | Google Play commerce | — (store policy, not a port) | — | — | unresolved |
| 16K | Policy decisions | — | — | — | recorded in DECISIONS_REQUIRED |

### Webhook and event requirements

Four capabilities require a provider to call back, and all four endpoints exist and are published in the contract:

- `POST /v1/billing/provider-events`
- `POST /v1/identity/provider-events`
- `POST /v1/notifications/provider-events`
- `POST /v1/rtc/provider-events`

Each takes a signature header, verifies before it records, records before it acts, and applies the event on a worker drain rather than on the request — so a slow endpoint cannot turn one provider event into five. A verified event that cannot be matched is left for reconciliation rather than guessed at. The **only** thing missing from each is the provider's signing secret and its published event vocabulary.

### Secrets

Three signing secrets exist as configuration and are required for a staging or production boot: `AUTH_ACCESS_TOKEN_SIGNING_KEY`, `AUTH_ACCESS_TOKEN_VERIFICATION_KEYS`, and `MEDIA_DELIVERY_SIGNING_KEY`. Every provider credential is additional to these and none is present. Custody for the AUTH signing key is itself an open decision — verification must remain possible with public key material alone, so a verifier can never mint a token.

### Failure behaviour, uniformly

Every capability fails closed, and the distinction the code keeps is between *refused* and *unavailable*: a provider that says no and a platform that has no provider are different answers, and the product surfaces say which. A person is never told a capability is unavailable when it is merely refused for them, and never told something is coming when nothing can deliver it.

### Staging path, uniformly

There is none yet, and that is a consequence rather than an oversight: staging and production cannot start at all until the AUTH signing authority exists. That is the first gate for every capability below, because none of them can be exercised in an environment that will not boot.

## What each capability is waiting for

These are the human decisions. None is a coding task, and none can be inferred from the code.

**16A Payments** — an approved provider whose written terms cover Velora's business model, plus commercial terms, a launch country, the tax position below, a refund policy, a grace policy for a lapsed renewal, and a recurring-billing strategy. `GiftService.available()` binds gifting to the configured provider and must not be widened before one exists.

**16B Payouts** — a payout provider, settlement window, rolling reserve, minimum payout, negative-balance treatment, payout countries, eligibility, holds, release policy, the KYC dependency in 16C, and failure/retry handling. The ledger side is complete and proved: reservation, release, overdraw refusal, and fifty-way concurrency all have tests.

**16C Identity / KYC** — an approved provider, scope, data terms, retention, country coverage, and creator eligibility rules. No fabricated verified state exists anywhere; the evidence tables are append-only and empty.

**16D Tax** — an authority or provider, jurisdiction, treatment, disclosure, and reporting responsibility. The deployed authority assesses **nothing**, which makes taxable commerce impossible rather than untaxed. An assumed zero would be an unremitted liability nobody decided to accrue, and the configuration says so in as many words.

**16E Media / CDN / scanning** — object storage, a CDN, a malware scanner, a moderation interface, retention, and access control. Both storage and scanner are required together and by name: a store with no scanner accepts bytes nobody vetted, and a scanner with no store has nothing to vet.

**16F RTC** — a provider whose terms permit what Velora is and that isolates unrelated calls, plus credentials, retention, regional availability, recording posture, and operations ownership. Recording stays off by construction rather than by a flag: there is no code path that records, stores, transcodes or transcribes call media.

**16G Notifications** — a push provider, an email provider, Android push credentials, and the delivery/retry and preference behaviour around them. Device registration, preferences, and the delivery ladder are built and tested; nothing can leave the building.

**16H AI** — a provider, a model and version, data terms, safety evaluations, rate limits, a budget, a kill switch, timeout and retry behaviour, and a logging/privacy posture. The architecture is provider-neutral and draft-only, and no raw text is persisted beyond what the contract already defines.

**16I Admin production auth** — an approved phishing-resistant authenticator and its enrolment, recovery, break-glass, role/scope matrix, privileged audit and session-freshness rules. **The local development adapter is not production access and must never be enabled outside local and test**; the configuration refuses it, and separately `/v1/auth/local/web-sessions` admits only the consumer and Creator Studio audiences, so a `platform_admin` session cannot be issued even at the right assurance. Both conditions must be answered, and the console states both rather than showing an empty screen.

**16J Google Play commerce** — the digital-goods policy position, the external-link restriction, and the resulting mobile purchase, membership and gifting strategy, plus entitlement sync. Nothing is improvised around this: Consumer Mobile offers no purchase and no outside link, and says where each thing happens instead. This is the decision that governs whether that stays true.

**16K Policy decisions** — carried in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md), which already holds each of the above with its options, trade-offs, affected domains and deadline.

## What this phase did not do

No provider was selected, no credential was created, no adapter was widened, and no decision was made on anybody's behalf. Where a phase asks for production enablement and the enablement requires a human, the honest output is the contract around the gap — which is this.

## Cross-references

[Whole-product runtime QA](31-whole-product-runtime-qa.md),
[configuration and environments](../engineering/07-configuration-environments.md),
[payments, tax and payout gates](../compliance/04-payments-tax-payout-gates.md),
[money flow](10-money-flow.md), and
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
