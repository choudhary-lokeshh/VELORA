# Final release gate

- Assessed: 2026-08-31
- Question: can VELORA truthfully be declared production-ready?

## The answer

**No — and the reason is entirely external.**

The product is built, proved and gated. What is missing is not code: it is a set of decisions and credentials that only a person can supply, and without which staging and production **cannot start at all**.

Stating it precisely, because the distinction is the whole point of this gate:

> Product implementation is complete and verified. External enablement has not begun, and cannot begin until a human chooses providers and approves policy.

Nothing below is a workaround, a partial enablement, or a claim that something is nearly ready. Where a provider is absent the platform refuses, and the refusal is enforced by configuration rather than by discipline.

## Provider classification

The phase requires these kept apart rather than collapsed into one "blocked", because they are answered by different people and unblock in different orders.

| Capability | Classification | What specifically |
|---|---|---|
| **AUTH signing authority** | **BLOCKED ON CREDENTIAL** | An Ed25519 private key in an approved secret manager or KMS. **This is the first gate for everything else**: staging and production refuse to start without it, so no other capability can be exercised in a deployed environment until it exists. Verification must stay possible with public key material alone, so a verifier can never mint a token. |
| **Payments** | **BLOCKED ON PROVIDER** | No payment provider is approved for Velora's business model. Additionally blocked on policy — refund rules, grace on a lapsed renewal, recurring-billing strategy — and on a launch country. |
| **Payouts** | **BLOCKED ON PROVIDER** | No payout provider approved. Additionally **BLOCKED ON POLICY**: settlement window, rolling reserve, minimum payout, negative-balance treatment and payout countries are each undecided, and no provider supplies those. |
| **Tax** | **BLOCKED ON COUNTRY / LEGAL** | Not primarily a provider gap. There is no launch jurisdiction, no merchant-of-record position, no registration and no remittance process. An assumed zero would be an unremitted liability nobody decided to accrue. |
| **Identity / KYC** | **BLOCKED ON PROVIDER** | No verification provider approved. Additionally **BLOCKED ON COUNTRY / LEGAL** for country coverage, retention and the biometric basis. |
| **Media / CDN / scanning** | **BLOCKED ON PROVIDER** | Neither object storage nor a malware scanner is approved, and both are required together by name — a store with no scanner accepts bytes nobody vetted. |
| **RTC** | **BLOCKED ON PROVIDER** | No provider whose written terms permit what Velora is and that isolates unrelated calls. Additionally **BLOCKED ON POLICY** for retention, regional availability and recording posture. |
| **Notifications** | **BLOCKED ON PROVIDER** | No email, push or SMS provider approved. Android push additionally needs credentials once a provider exists. |
| **AI** | **BLOCKED ON PROVIDER** | No production model provider approved. Additionally **BLOCKED ON POLICY**: data terms, safety evaluations, budget and kill-switch ownership. |
| **Admin production auth** | **BLOCKED ON PROVIDER** | No approved phishing-resistant authenticator. Two independent conditions, both of which must be answered: the verifier, and the fact that `/v1/auth/local/web-sessions` admits only the consumer and Creator Studio audiences, so a `platform_admin` session cannot be issued even at the right assurance. |
| **Google Play commerce** | **BLOCKED ON POLICY** | An owner decision about digital-goods policy, external links, and the resulting mobile purchase, membership and gifting strategy. No provider is involved and none would resolve it. |
| **Observability vendor** | **NOT REQUIRED** | OpenTelemetry spans, structured logging and an audit trail already exist under ADR-0013. No vendor integration is needed to ship, and none was built. |

**Nothing is READY.** Recording that plainly is the point of the classification.

## What is proved

| Gate | Result |
|---|---|
| Repository | Clean worktree, HEAD at origin/main, no generated drift, no debug artefacts, no temporary diagnostics, secret scan clean over 1177 files |
| Dependencies | Frozen install verified, workspace policy across 15 manifests, release-age and dependency-security policy enforced, Expo doctor 20/20, override drift guarded |
| Database | 70 migrations applied to a clean database, schema and constraint checks in the suite, seed proved idempotent by measurement across three runs |
| Builds | All four applications plus the worker build uncached; the Android project regenerates and is inspected — `com.velora.consumer 0.1.0 (1)`, minSdk 24, targetSdk 36, 6 permissions, 22 blocked |
| Tests | API unit 327, API integration 1496 across 83 files, browser 216, mobile 157, plus the web, Studio, admin and package suites |
| Runtime | Three surfaces walked in a real browser against a fresh stack at five widths and 200 % text, with no console error, React warning, permanent skeleton or dead control |

## What is not proved, and why

**A device walk at the final commit.** The emulator cannot boot on this machine — 16 GB total, roughly 200 MB unused — and crashes at startup even with every dev server stopped. `apps/mobile` is byte-identical to `a5559de`, where the full Android walk was performed and recorded, so that walk describes the mobile product as it stands. That is not the same as re-walking it and is not offered as one.

**Anything about a real provider.** Every provider path is exercised against a `local-test` adapter or refused by an `unavailable` one. No statement in this repository about how a real payment, payout, verification, delivery, call or model provider behaves is evidence, because none has ever been contacted.

**Anything about staging or production.** Neither environment has started, because neither can until the AUTH signing authority exists.

## What can run locally today

The whole product. Onboarding and sign-in, discovery, introductions, messaging, calls as lifecycle without media, creator publishing, clubs, membership purchase through a deterministic provider to a settled ledger, gifting with reversals and disputes, creator earnings, the operations console under a local development authenticator, AI draft suggestions, and photographs through the `local-test` media transport.

## What cannot truthfully run in production

All of it, and for one reason: staging and production will not boot without a signing authority, and every capability above additionally waits on its own decision. That is not a defect list. It is the boundary between what was built and what must be chosen.

## Cross-references

[Production enablement readiness](32-production-enablement-readiness.md),
[Whole-product runtime QA](31-whole-product-runtime-qa.md),
[Test infrastructure audit](30-test-infrastructure-audit.md), and
[DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
