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

AUTH supplies deny-by-default authentication primitives — authenticated, audience, assurance, and assurance freshness — over a server-derived context that carries no credential and no client assertion. The Platform Admin audience carries an assurance floor no other audience can satisfy, so audience confusion cannot produce privileged authority. High-impact authorization is bound to one actor, target, operation, argument digest, before-state, expected effect, correlation identifier, assurance, and expiry, is single use, and re-authorizes current state, session liveness, and assurance freshness at execution.

**As built** ([ADR-0048](../decisions/ADR-0048-operator-control-plane-and-composed-activity.md)): the operator permission catalogue exists. Twenty-two capabilities, seven roles that are convenience sets over them, and every privileged route naming the one capability that authorises it — as a required parameter, so a route cannot be written without deciding. Roles are never checked by a route, so adding one cannot widen what a route admits. Read is separated from write throughout. `operators.manage` is its own capability held by one role, because whoever holds it can grant themselves every other one. One live grant per operator, enforced by a partial unique index; a revoked grant keeps its row as evidence of what somebody held during an incident window. In staging and production an operator with no grant may do nothing at all.

**Support impersonation is deliberately absent and stays absent.** There is no "sign in as" anywhere in this platform, and the operator surface is built out of read-only projections that publish counts and states rather than a person's own view of their account. A secure audited impersonation model would be a new capability with its own consent, audit, and disclosure decisions rather than a convenience added to a console.

Store grants, scopes, assurance and audits separately from credentials. Log privileged access; protect audit reads. V1 baseline role model and object authorization. Privileged MFA method, Admin session limits, step-up assurance age, exact-action approval binding, privileged recovery, and break-glass policy semantics are locked by [ADR-0017](../decisions/ADR-0017-auth-session-recovery-security-policy.md). `DECISION REQUIRED`: service-account policy, break-glass implementation, and who holds the first operator grant in a deployed environment. See [OPERATIONS](../domains/operations.md), [Platform Admin](../product/04-platform-admin.md), [Admin surface](../surfaces/04-platform-admin.md), [admin flow](../flows/admin-operations.md), [AI action flow](../flows/ai-assisted-action.md), [AUTH](../domains/auth.md).
