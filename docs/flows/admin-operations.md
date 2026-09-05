# Privileged Admin operation flow

## Purpose

Define safe Platform Admin operations. ADMIN owns request/approval/audit lifecycle; owning domain executes source-of-truth transition.

## Preconditions

Operator has assigned least-privilege role, valid scoped session and required step-up authentication. Operation is permitted for target, country, monetary threshold, and sensitivity. Sensitive operations define reason/evidence and approval policy.

## Main flow

1. Operator locates privacy-minimized authorized record and selects an allowed domain operation.
2. ADMIN creates operation request with actor, role scope, target, reason, correlation ID, proposed action, and before-state reference.
3. Required approver, distinct from requester where policy says, approves/rejects; emergency access is time-bound and flagged.
4. Owning domain re-authorizes, checks version/idempotency, executes or rejects operation.
5. ADMIN writes immutable outcome/audit references, notifies/reviews according to policy, and exposes only permitted result.

## Alternate/failure/concurrency

Expired session/role, missing approval, stale target, or limit breach denies safely. Duplicate submit returns same request/outcome. Concurrent operations serialize or version-conflict at owner; no direct database bypass. Domain outage leaves request pending/failed with retry/reconciliation; operator cannot claim action completed without verified outcome.

## Security/data/events

Log privileged reads/writes, delegation, approvals, break-glass use, exports, role changes, and configuration changes. Redact secrets/payment/identity data; protect audit immutability and access. Segregate duties for roles/limits. Audit events are not generic analytics data.

Identity operations are V1 read-only: aggregate health and exact opaque-reference lookup. No search, list, export, raw evidence, provider payload, manual grant, override, revocation, deletion, or force-retry is authorized. A future mutation needs a new operation contract and explicit ADR-0017 exact-action/approval policy.

## Phase/open questions

The binding and execution-time re-authorization steps above are implemented in AUTH as a reusable primitive; the operations themselves belong to their owning domains and are not implemented. An authorization that names a different target, different arguments, or a different expected effect, or whose target state moved after it was issued, is refused at execution rather than proceeding.

**As built** ([ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md)): the exact permission matrix is implemented — twenty-two capabilities and seven roles in [OPERATIONS](../domains/operations.md), with every operator route naming the one capability that authorises it. Every operator command follows one order: resolve the operator, check the capability, act through the owning domain, then record what happened — including when it did not happen. A control write additionally states the version it read, so two operators acting at once resolve deterministically rather than overwriting each other. `refused` and `failed` are recorded outcomes rather than absences.

V1 limited support/moderation/enforcement/config operations. Finance/payout/dispute operations launch with domains. Operator session limits, step-up assurance age, approval binding fields, privileged recovery, and break-glass semantics follow [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md). `DECISION REQUIRED`: dual-control thresholds, emergency implementation and review cadence, and who holds the first operator grant in a deployed environment. See [OPERATIONS](../domains/operations.md), [operator runbooks](../engineering/09-operator-runbooks.md), [ADMIN](../domains/admin.md), [Platform Admin product](../product/04-platform-admin.md), [Platform Admin surface](../surfaces/04-platform-admin.md), [operations authority](../DOCS_INDEX.md#operations-authority), [RBAC](../security/02-access-control-rbac.md).
