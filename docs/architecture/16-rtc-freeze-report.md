# RTC freeze report

- Freeze status: Frozen
- Freeze SHA: `1a995f7`
- Freeze date: 2026-08-22
- Architecture authority: [ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md)
- Frozen code tip: `86c3b1a`

## What this records

What the one-to-one voice and video core froze with, what still blocks a real call, and what would unfreeze it. It is written so that somebody arriving later can tell what was built from what was decided, and can find no permission here that nobody granted.

Dated 2026-08-22. The frozen tip is `86c3b1a`.

## What is frozen

REALTIME owns call sessions and nothing else. It holds the lifecycle of a one-to-one call between two people who are already authorized to contact each other, and it owns no principal, no account standing, no relationship, no block, and no enforcement decision.

Eighteen modules under `apps/api/src/realtime`, seven migrations (`0054`–`0060`), the six consumer call-control routes and one provider-event endpoint, two operator reads, calling surfaces on Consumer Web and Consumer Mobile, and 192 RTC tests across thirteen integration suites.

**What is deliberately absent is most of the design.** There is no recording, no transcription, no group calling, no rooms, no livestreaming, no broadcast, no creator paid sessions, and no AI anywhere near a call. None of those is disabled by a flag: no code path performs them and no configuration value turns one on, so enabling any of them is a new capability with its own review rather than a setting somebody could find.

## Phase and commit history

| Phase | Commit | What it settled |
| --- | --- | --- |
| 0 | `9674c67` | Architecture, threat model, and provider eligibility research — approving nobody |
| — | `b0e45cb` | CI cadence repair: bounded the mobile dependency-currency check |
| 1 | `a55fee2` | Call session lifecycle and the state table |
| 2 | `2192df6` | Composed eligibility from the domains that own each fact |
| 3 | `2e8c868` | Provider-neutral orchestration: reserve, call, bind |
| 4 | `8119fe1` | Participant-scoped short-lived join authorization |
| 5 | `da482ae` | Call-control API |
| 6 | `2541d99` | Call notifications through the transactional outbox |
| 7 | `0f0a109` | Ephemeral signalling that carries hints and never state |
| 8 | `cf10cca` | Verified provider events that observe and never authorize |
| — | `0f9f3b3` | Took a paging test off the container clock; recorded the port hazard |
| — | `19bd1dc` | Raised the Expo SDK 57 pins and retired the DAB-2026-002 exclusions |
| 9 | `4e85334` | Reconnect and recovery, bounded by a stored deadline |
| 10 | `e13b274` | Consumer Web calling surface |
| 11 | `7408e86` | Consumer Mobile calling area, with native media blocked and recorded |
| 12 | `fb9422f` | Safety ends a call in progress, in the deciding transaction |
| 13 | `8499065` | Six abuse bounds, counted from durable rows |
| 14 | `5ec977b` | Operator view of calling, and no lever over it |
| 15 | `9ad3dcf` | Provider obligation discharge and the scheduled sweeps |
| 16 | `7e18e68` | Access paths held to a query plan at volume |
| 17 | `496bfe3` | Adversarial pass; closed the end-reason-to-state gap it found |
| 18 | `bf56127` | Twenty repeated runs of the non-deterministic stages |
| 19 | `88060d2` | This report — **red at its own SHA**, see below |
| — | `86c3b1a` | Corrected a scale-suite seed the freeze commit failed hosted on |

Three commits in this history are not hosted-green at their own SHA, and each is recorded rather than smoothed over. `0f9f3b3` is **red at its own SHA** and is recorded that way: it was pushed after the Expo release-age cutoff passed but before the pin raise that follows it, so `mobile:doctor` correctly blocked on an upgrade nothing forbade any more. It is green as part of the branch from `19bd1dc` onward. `8499065` was cancelled mid-run by pushing the next phase before it finished, and was re-run at its own SHA to green.

`88060d2` — the commit adding this report — **failed hosted and stays red**. It failed on a query-plan assertion written in Phase 16 that had passed twenty consecutive times locally: the seed left the live-side indexes and the partial deadline index at nearly the same size, so the planner's choice between them turned on cost differences smaller than the variation between machines. The local planner chose one way every time and the hosted runner chose the other. Correcting the seed then exposed, through the typecheck, that the invitation-deadline assertion had been matching zero rows since it was written — passing and proving nothing. `86c3b1a` fixes both and is hosted-green, and is the tip this freeze refers to.

None of the three is described as a first-attempt pass. A freeze report that smoothed them over would be the one document here nobody could check against reality — and the third one is the most useful of the three, because it is the case where twenty green runs were not evidence of what they appeared to be.

## What is not frozen, and why

**No RTC provider is approved, so no call can carry media.** This is enforced rather than documented: `REALTIME_RTC_PROVIDER` defaults to `unavailable`, and configuration rejects any other value outside local and test. Primary-source research on 2026-08-20 is recorded in [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md) and approves nobody. Two candidates were removed on published evidence rather than on missing paperwork: Agora's acceptable-use policy prohibits adult content outright, and Cloudflare's Realtime SFU documents that each track is retrievable from any session within an app, which leaves a one-to-one call no provider-enforced media boundary. Daily's and Vonage's policy text could not be retrieved from their official pages that day and are unassessed rather than acceptable. LiveKit Cloud is the closest technical fit and reserves unbounded discretion over "otherwise objectionable" content. AWS Chime documents join-token reuse as a supported device hand-off, which is a token-theft property VELORA would have to contain outside the provider.

**Native mobile media is blocked by this repository's own build, not by package compatibility.** On 2026-08-21 `react-native-webrtc@124.0.8` and `@config-plugins/react-native-webrtc@15.0.2` both admit React Native 0.86 under Expo SDK 57. What does not admit it is that this app has no native projects, no `eas.json`, and no development-build pipeline: its build is `expo export`, which compiles nothing native. Adding a package requiring custom native code would put code in the tree that no gate compiles, links, signs, or runs, leaving the gate green while the app was unbuildable.

**Operations ownership is unassigned.** Nobody is named to be paged for a stuck call backlog, an obligation that will not discharge, or a provider outage.

**Retention is undecided and legally unreviewed.** Nothing expires, no sweep deletes, and no correctness rule depends on a row being gone — so applying an approved duration later removes data without changing how any of this behaves.

Regional availability, recording posture, and native mobile media feasibility are likewise undecided, and those three sit alongside the provider, retention, and operations-ownership entries in `productionBlockers` — six in total, enumerated in `apps/api/src/realtime/policy.ts`. Emergency-calling posture is carried in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) rather than in that list, which is a real gap in the list rather than a decision that has been taken.

"Recording posture undecided" is a blocker about policy, not about capability: no code path records, stores, transcodes, or transcribes call media, so what is undecided is whether recording should ever exist, not whether it is currently switched off.

## The invariants, and where each is enforced

| Invariant | Enforced by |
| --- | --- |
| A call exists only between two people already mutually introduced | Composed eligibility, re-asked inside the writing transaction under the pair lock |
| Eligibility is never inherited or cached | Re-composed at invitation, acceptance, and every issuance; no `eligible` column exists |
| A credential admits one participant to one call for minutes | Per-issuance minting bound to the session's authorization generation |
| Ending kills every outstanding credential | Every terminal transition advances the generation |
| Safety ends a call in progress, not merely the next one | Block and restriction end the call in the transaction that records the decision |
| A provider observes and never authorizes | Verified events record state; no event creates a participant or grants anything |
| No provider call holds a database connection | Orchestrator and reconciler both call outside every transaction |
| One live call per pair | Partial unique index on the non-terminal states |
| A reason belongs to the state it is recorded with | `realtime_sessions_end_reason_state_check`, added by the adversarial pass |
| Nothing about a call is stored that could reconstruct it | No column exists for SDP, ICE, TURN, credentials, tokens, recordings, transcripts, or addresses; a test enumerates every column |

## Explicit privacy and safety answers

No raw media is persisted. No call is recorded. No SDP or ICE candidate is stored or relayed — offer and answer negotiation belongs to a provider's own path, and a platform relaying them would be a place they could be logged. No TURN credential, provider join token, or room secret appears in any log, metric, trace, or analytic. No participant IP address is a metrics label, or a column anywhere. No call audio or video reaches telemetry, because none is captured.

A participant may learn that VELORA ended their call. They may never learn which decision did it: `safety_block` and `safety_enforcement` both surface as `ended_by_platform`, because distinguishing them would publish one person's decision to the person it was taken about.

The provider is treated as an adversary as well as a dependency. It is authoritative about media and unaware of safety, so it learns a per-call hash rather than an account identifier, and never holds a durable name for a person.

## Mature content

**Mature content production enablement remains BLOCKED, and nothing in this work changes that.** Completing RTC is not an input to that decision and grants no part of it. The gates that would have to change are Safety and compliance gates that are untouched here, and no configuration value in this domain enables mature content in any environment. Anyone reading this report for permission will not find it.

## What unfreezes this

An approved RTC provider with terms VELORA can actually operate under, or a decision to self-operate with a named owner; an operations owner and alert routing; an approved retention duration with legal review; regional availability and an emergency-calling posture. For mobile media specifically, a native build pipeline that compiles, links, signs, and runs the app before the gate may call it verified.

Until then the core is provider-neutral, fails closed, and refuses every call in every deployed environment — which is the correct state, not a degraded one.

## The evidence this rests on

- 192 RTC tests across thirteen integration suites, against real PostgreSQL and Redis
- Query plans asserted on 40,000 seeded calls, so the access paths are index-driven at a size nobody has yet
- An adversarial suite that attacks the published contracts and found the end-reason gap now closed
- [Twenty repeated runs](15-rtc-stability-evidence.md) of the non-deterministic gate stages: 20 passed, 0 failed, 0 killed

## Cross-references

[ADR-0025](../decisions/ADR-0025-rtc-live-communications-architecture.md), [REALTIME](../domains/realtime.md), [RTC lifecycle](../flows/rtc-lifecycle.md), [RTC threat model](../security/12-rtc-threat-model.md), [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), [Consumer Web](../surfaces/01-consumer-web.md), [Consumer Mobile](../surfaces/02-consumer-mobile.md).
