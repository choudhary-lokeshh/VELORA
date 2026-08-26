# AI suggestion platform freeze report

- Freeze status: Local/test platform and product complete; no live provider
- Freeze SHA: `de29e85b6c028d539e0632837ff20025d334a387`
- Freeze date: 2026-08-26
- Hosted CI: run 33000560345, both jobs green on the freeze SHA
- Starting SHA: `07b0d9f38116d71388fbc32e235bc904217d369e`
- Architecture authority: [ADR-0012](../decisions/ADR-0012-ai-platform-runtime.md)
- Product implementation authority: [ADR-0033](../decisions/ADR-0033-local-test-ai-suggestion-platform.md)

## Scope

This report records the AI platform slice built on top of the Phase 10
whole-product runtime gate. It does not reopen any earlier freeze, and it does
not claim that a deterministic local adapter is a model or a production
provider. What is frozen here is the gateway, its durable PostgreSQL evidence,
the provider-neutral port, and the draft-only product surfaces on Consumer Web,
Consumer Mobile, Creator Studio, and Platform Admin.

## What is newly runnable

`POST /v1/ai/suggestions` is the only generation entry point and
`POST /v1/ai/runs/cancellation` cancels only a caller-owned active run. Both
sit behind the same request and database admission gate as every other
operation, so an AI request competes for the same bounded capacity rather than
holding a private allowance.

The gateway is an explicit state machine over four states — `running`,
`succeeded`, `failed`, `cancelled`. It admits against a durable per-actor daily
budget, minimizes and rejects credential-shaped or instruction-smuggling input
before a run exists, pins provider, model, prompt, output-schema, and safety
versions onto the run, streams through an `AbortSignal` port with an
eight-second timeout, retries at most once and only before any output, bounds
output at 2,000 characters, parses the response strictly, and refuses empty
output rather than presenting it.

PostgreSQL owns the truth. `ai_runs` carries digests, counts, versions, state,
cost, timestamps, actor, audience, and correlation identity, and has no column
in which raw context, drafts, prompts, messages, or evidence could be stored.
A trigger refuses deletion, refuses any change to a terminal run, refuses a
second transition, and refuses any edit to identity or release pins.
`ai_run_events` is append-only by trigger. `ai_capability_activations` is
version-pinned and seeded only for `local` and `test`, so a deployed
environment has no activation row to find.

## Product surfaces

Every surface offers a draft and nothing else. Generated text lives in local
component state, is presented as editable, and is applied to the adjacent form
only when its owner presses an explicit control. Save, Send, and Publish remain
the same existing product actions they were before this work, and the browser
journeys assert that the conversation contains no new message between the draft
appearing and Send being pressed.

Consumer Web and Consumer Mobile carry the profile and conversation
capabilities under NIGHT CURRENT. Creator Studio carries bio, title, caption,
description, content-idea, and club-announcement scratchpads under WARM SIGNAL.
Platform Admin receives only a review note built from bounded case metadata and
counts: report prose, evidence references, and target identity do not cross the
AI boundary, and the panel has no claim, triage, decision, or enforcement
channel. The Admin capability additionally requires current phishing-resistant
assurance, which no environment can currently satisfy, so the console's
existing honest refusal is unchanged.

## Defects this work found

**A Consumer surface named another surface's visual language.** The Consumer
Web panel titled itself with the Creator expression. NIGHT CURRENT is bounded
to `apps/web` by [ADR-0027](../decisions/ADR-0027-consumer-web-product-interface.md)
and WARM SIGNAL to `apps/creator-studio` by
[ADR-0028](../decisions/ADR-0028-creator-studio-product-interface.md), so the
heading was a claim the design authority does not permit. The panel now names
the work rather than the language, which is what the other two surfaces already
did.

**The run identity could not be minted on a device.** The mobile panel read
`randomUUID` from `globalThis.crypto`. The test renderer provides that object
and Hermes does not, so the capability passed every mobile suite and failed on
Android 36 with `Cannot read property 'randomUUID' of undefined`. The two
sibling identifier helpers in the same directory fall back to a non-UUID
string, which the AI contract rejects, so the fix reuses the RFC 9562 minting
this application already performs for its installation identifier. A test that
removes `globalThis.crypto` now fails without the fix and passes with it.

The failure was honest while it lasted — the panel reported that it could not
produce a suggestion rather than crashing or inventing one — but the capability
did not work on Android at all, and only the real runtime exposed it.

## Evidence

The canonical gate passed locally with 1,422 PostgreSQL integration tests
across 80 files, 321 API unit tests, 103 Consumer Web, 129 Consumer Mobile, 51
Creator Studio, 40 Platform Admin, 73 configuration, 24 contract-client, 21
surface-client, 18 validation, and 2 design-token tests, 154 browser journeys
with 68 documented WebKit and viewport skips, the generated Android manifest
gate, and the contract, boundary, design-parity, seed, secret, hygiene, and
dependency-security checks.

Twenty-one of the PostgreSQL cases are AI-specific and hostile by design:
instruction smuggling, credential-shaped input, oversized input at the schema
boundary, cross-caller isolation, version-pinned activation, audience
enforcement, run-identity collision without a second reservation, bounded
retry, persistent provider failure, timeout, oversized output, runtime-malformed
chunks, action-shaped output kept inert, empty output, a provider whose task set
the registry does not route, registry immutability with no live route
registered, terminal and audit immutability enforced by PostgreSQL, cancellation
ownership, kill switch spending nothing, and daily rate enforcement. A run that
straddles UTC midnight is accounted against the day it was admitted rather than
the wall clock, which is the case a naive implementation gets wrong.

Browser journeys run the real API and the local/test adapter for a Consumer bio
edited and explicitly saved, a Consumer chat draft edited and explicitly sent,
and a Creator caption edited and carried into the normal publish flow.

Android 36 in `velora-android36` ran the real application against the running
API, PostgreSQL, and the seeded local world. A profile draft request returned
HTTP 200, the panel presented the suggestion as editable and not yet used, the
bio field was unchanged while the draft was on screen, and the only write the
device made in that window was the AI request itself. PostgreSQL recorded one
`succeeded` run for the `consumer_mobile` audience with pinned provider, model,
prompt, output-schema, and safety versions, an output digest, zero settled cost,
and an `admitted` then `succeeded` event pair.

## Configuration

`AI_PROVIDER` defaults to `unavailable` and `AI_KILL_SWITCH` defaults to
`enabled`, so an environment that says nothing has no AI capability. Both gates
must admit a run. Staging and production reject `local-test` and reject a
disabled kill switch at configuration load, so no deployed environment can
start with a live-like AI route. Neither variable reaches a client and neither
carries a provider credential.

## Forensic record for the phases this work builds on

This section exists so that a later handoff does not have to reconstruct which
commit proved what. It records repository and hosted-CI truth as read from Git
and GitHub Actions, and it changes no earlier freeze declaration.

The history from `3f1d476` to `07b0d9f` is linear and contains no merge, so a
descendant contains its ancestors' trees unchanged and hosted evidence on a
descendant is evidence for every ancestor in that chain.

| Phase | Commit | Subject | Hosted run | verify | android |
|---|---|---|---|---|---|
| 6 | `3f1d476` | complete creator studio workspace | 32931938793 | cancelled | cancelled |
| 6 (descendant proof) | `2f3462c` | resolve counterpart identities in notifications | 32941098736 | success | success |
| 7 | `15cd14b` | complete notification activity center | 32949465920 | cancelled | cancelled |
| 8 | `555e185` | elevate product visual experience | 32951314714 | cancelled | cancelled |
| 9 | `b3804d2` | build rich deterministic local world | 32954225162 | cancelled | cancelled |
| 10 | `07b0d9f` | harden whole-product runtime gate | 32957192821 | success | success |

Phases 7, 8, and 9 have no direct hosted evidence: each run was superseded by
the next push and cancelled before finishing. Their proof is `07b0d9f`, which
is a linear descendant of all three and is green on both jobs. Phase 6 is
proved the same way by `2f3462c`. This is recorded rather than corrected,
because re-running an old commit would not change what the repository already
contains.

Phase 10's report, [whole-product QA](24-whole-product-qa-report.md), carries no
freeze metadata header because it was written before its own commit existed.
Its freeze commit is `07b0d9f` and its hosted evidence is run 32957192821.

The earlier platform tracks were frozen by domain rather than by phase number,
and each already declares its own freeze SHA. For completeness, every one of
them is green on its declared commit: monetization `a2c50d7` (31899274406),
trust and safety `7d92408` (31938505147), media `99eb8d2` (32106813338),
identity assurance `c015b11` (32339629850), RTC `1a995f7` (32537592772) with
the scale-suite correction at `86c3b1a` (32535940236), configuration bootstrap
`8169229` (32556768186), notifications `f27ac2a` (32599069552), Consumer Web
`e7e5b0e` (32625434236), Creator Studio `b157147` (32643861167), Platform Admin
`ac16651` (32651140655), Consumer Mobile `48b6146` (32665114553), Android native
`a7e6b70` (32751438543), and virtual gifting `0bd02e1` (32862684156).

The product-phase numbering in [product phases](../product/01-product-phases.md)
is a separate axis. It describes when a capability may reach people, and it is
unchanged: AI product assistance remains Phase 3 there regardless of the
implementation evidence recorded here.

## What is not enabled

No live AI provider, model, evaluation threshold, data-processing term,
country, retention schedule, sampling policy, or cost budget is approved. The
only working adapter is deterministic, network-free, and refused in every
deployed environment. This slice registers no tool, memory, RAG, retrieval,
arbitrary network access, or autonomous loop, and adding any of them requires
its own approved capability under the existing authorities. The Admin
capability is implemented but unreachable, because no environment has a
`platform_admin` issuer or an approved phishing-resistant authenticator.

## Freeze boundary

Phase 11 closes only after hosted verify and Android compilation pass on the
exact commit. No architecture decision changed beyond
[ADR-0033](../decisions/ADR-0033-local-test-ai-suggestion-platform.md), which
this work introduced. This report is the durable AI implementation authority, so
the documentation index is updated; other behavior and ownership authorities are
unchanged.
