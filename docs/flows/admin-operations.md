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

## Phase/open questions

V1 limited support/moderation/enforcement/config operations. Finance/payout/dispute operations launch with domains. `DECISION REQUIRED`: exact permission matrix, dual-control thresholds, emergency procedure/review. See [ADMIN](../domains/admin.md), [Platform Admin product](../product/04-platform-admin.md), [Platform Admin surface](../surfaces/04-platform-admin.md), [operations authority](../DOCS_INDEX.md#operations-authority), [RBAC](../security/02-access-control-rbac.md).
