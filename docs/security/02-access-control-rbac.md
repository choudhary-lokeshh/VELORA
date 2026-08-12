# Access control and RBAC

## Authority

Define authentication-to-authorization chain for all clients. AUTH verifies identity; each owner domain authorizes action/object. ADMIN owns role grants/audit workflow, not domain truth.

## Roles

User: own consumer objects/actions. Creator: own approved creator business/club actions only. Moderator: assigned review actions. Support: scoped support actions. Finance/Admin: approved financial operations. Platform Admin: configured operational workflows. Owner/Super Admin: highest operational scope, still least-privilege, audited, re-authenticated, and never entitled to secrets/raw sensitive data by default.

## Authorization model

Decision requires `(actor identity, active role grants, action, target object, ownership/relationship, tenant/creator scope, region/channel policy, current safety/enforcement, assurance level)`. Enforce server-side for read and mutation. Roles grant potential permissions; policy and target scope determine actual permission. Use deny-by-default, short-lived sessions/tokens, revocable grants, and step-up/dual approval for high-risk actions.

AI is not an actor role or approver. An AI run carries a narrowly delegated actor/capability context, but every tool/read/effect is re-authorized by the owning domain. Model output, prompt content, confidence, and tool selection cannot grant scope. Approval-required operations bind human approver identity, exact target/arguments/effect, expiry, and current authorization.

## Flows/failures/concurrency

Role grant/change requires authorized requester, approval where policy says, effective time/expiry, and immutable audit. Revocation propagates promptly; stale token/session cannot retain sensitive authorization past recheck. Access denial returns minimum explanation. Concurrent role/operation changes version-check and re-authorize at execution.

## Data/security/phase

Store grants, scopes, assurance and audits separately from credentials. Log privileged access; protect audit reads. V1 baseline role model and object authorization. `DECISION REQUIRED`: permission catalogue, service-account policy, step-up factors, support impersonation and break-glass policy. See [Platform Admin](../product/04-platform-admin.md), [Admin surface](../surfaces/04-platform-admin.md), [admin flow](../flows/admin-operations.md), [AI action flow](../flows/ai-assisted-action.md), [AUTH](../domains/auth.md).
