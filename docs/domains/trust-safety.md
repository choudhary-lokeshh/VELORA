# TRUST & SAFETY domain

## Purpose and scope

TRUST & SAFETY owns reports, user-to-user blocks, enforcement policy execution, safety eligibility decisions, and enforcement lifecycle. It does not own moderator queues/evidence tooling, consumer profile source truth, messages/content source data, or direct payment records.

## Main flow and transitions

User blocks another user: validate self/target, persist directional block, publish immediate eligibility change. Report creates protected case reference. Policy action transitions subject `active -> limited/suspended/banned` or restores status after review/appeal. Enforcement scopes can restrict discovery, messaging, realtime, clubs, creator tools, and notification without leaking reason to affected peers.

## Alternates/failure/concurrency

Block request is idempotent per blocker-target. Both-direction blocks remain independent records. Block/report vs send/intro races resolve at owning action's recheck; later send/intro must fail safely. Reports permit duplicates but link/merge under moderation policy. Expiry/appeal transitions must have effective time, policy version, actor/reason, and audit.

## Security/data/permissions

Reporter identity, evidence, and internal rationale are tightly access controlled; consumer never sees retaliatory detail. User can manage own blocks/reports within policy. Moderator acts through MODERATION workflow; Admin invokes approved operation. Publish minimal eligibility facts, not sensitive report content. Abuse-rate limit reports and preserve evidence integrity/chain of custody.

AI signals or recommendations are non-authoritative inputs only. TRUST & SAFETY never accepts model confidence, generated rationale, or AI approval as enforcement authorization; enforcement follows deterministic policy, authorized human workflow where required, version/concurrency controls, and audit.

## Phase/open questions

V1 blocks, reports, basic enforcement predicates. Phase 2 AI assistance remains advisory. Separately reviewed deterministic automation may perform only explicitly specified non-high-impact policy steps with audit, monitoring, human override, and no model judgment. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: policy taxonomy, permitted deterministic automation, appeal/SLA, evidence retention, regional requirements, enforcement propagation timing. See [report to enforcement](../flows/report-to-enforcement.md), [MODERATION](moderation.md), [moderation operations](../operations/02-moderation-operations.md), [AI action flow](../flows/ai-assisted-action.md), [RBAC](../security/02-access-control-rbac.md).
