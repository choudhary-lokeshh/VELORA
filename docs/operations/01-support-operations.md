# Support operations

## Purpose and authority

Define normal support workflows across consumer, creator, subscription, account, and access issues. Support uses Platform Admin and published domain operations; it does not own domain truth or receive unrestricted access.

## Actors and scope

Support agents work assigned queues with role, country, product, and data scope. Moderators handle policy/evidence decisions; Finance handles money and payout operations; Security handles account compromise; Owner/Super Admin handles approved platform-level intervention. Escalation does not transfer source-of-truth ownership.

## Intake and case lifecycle

Support case states are `new -> assigned -> investigating -> awaiting_user/awaiting_internal -> resolved -> closed`, with `escalated`, `reopened`, and `merged` where needed. Intake records subject, authenticated contact, product/surface, category, urgency, consented attachments, and correlation references while minimizing sensitive content.

Agent verifies requester and object relationship, views authorized projections, follows versioned procedure, requests owning-domain action if permitted, records outcome reference, communicates safe result, and closes with resolution code. Duplicate contacts link to one case; concurrent agents use assignment lease/version.

## Allowed and forbidden operations

Support may explain status, assist navigation, resend approved notices, and request documented reversible actions within scope. Account recovery/security changes, identity evidence, enforcement, content moderation, refunds, entitlement overrides, payout, role/configuration, exports, or deletion follow specialized workflow, step-up/approval, and domain authorization.

Support never asks for passwords, full card data, recovery secrets, or unnecessary identity documents; never directly edits domain tables; never promises relationship outcomes or bypasses country/content/payment gates. Impersonation is disabled unless separately approved, time-bound, visibly indicated, audited, and privacy reviewed.

## Privacy, security, and communication

Search is purpose-limited, rate-limited, and audited. Views redact sensitive fields and other-party information. Attachments are quarantined/scanned. Outbound messages use approved templates/channels, verify destination, avoid sensitive lock-screen/email detail, and retain case/policy version. Exports and screen capture are restricted.

AI support assistance, if Phase 3 approved, may summarize authorized case data or draft replies/procedures. Human agent remains sender and decision-maker; AI cannot expand scope or execute account, financial, entitlement, enforcement, or security action.

## Metrics, failure, and open decisions

Measure queue age, first response, resolution/reopen, escalation, procedure errors, customer-safe outcomes, sensitive access, and abuse without turning speed into authorization pressure. Platform/domain outage leaves truthful pending state and escalation; no case is marked resolved before verified owner outcome.

`DECISION REQUIRED`: support categories, hours/SLA, countries/languages, verification method, impersonation posture, attachment retention, escalation matrix, complaint handling, QA sampling, and AI support capability.

## Cross-references

See [Platform Admin surface](../surfaces/04-platform-admin.md), [Admin operations](../flows/admin-operations.md), [RBAC](../security/02-access-control-rbac.md), [incident response](04-incident-response.md), and domain flow for requested action.
