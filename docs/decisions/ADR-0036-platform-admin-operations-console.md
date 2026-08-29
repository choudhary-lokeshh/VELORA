# ADR-0036: Platform Admin operations console

- Decision date: 2026-08-29
- ADR status: Accepted

## Context

[ADR-0029](ADR-0029-platform-admin-product-interface.md) established Platform Admin under CLEAR PULSE and froze ten screens: four destinations (Queues, Creators, Money, Platform), one case, appeals, four subsystem health areas, and the access door. [ADR-0034](ADR-0034-local-test-admin-authenticator.md) then made the console reachable in local and test environments with a deterministic privileged authenticator.

Two gaps followed from that history rather than from any defect.

**The console covered the routes the backend happened to publish, not the work an operations team does.** Every privileged read in the contract was reachable from it, and several operational domains had no address at all: there was no answer to "what needs a person right now", no consumer account surface, no way to see an individual payment or payout, and no way to read either of the platform's two audit records. Three of the domains that did have screens reported only aggregate counts, so an operator could learn that nine payments had succeeded and could not look at one.

**One capability was real in the API and unreachable in the product.** The console can revoke a club membership, and the form asked an operator to paste an identifier the console could not show them: `POST /v1/admin/creators/membership-revocation` existed, and no route or screen could produce its target.

Separately, [ADR-0029](ADR-0029-platform-admin-product-interface.md) recorded that the ten screens were proved only against a `fetch`-level contract double and driven by hand at ten widths against a scratchpad stub — "a weaker guarantee than the other two surfaces have" — and that it becomes a browser assertion the day a privileged authenticator exists. ADR-0034 produced one.

## Decision

### Seven operator reads, and no new operation

`AdminOperationsDirectory` and `AdminOperationsRoutes` are added to the ADMIN module, publishing seven routes: `/v1/admin/overview`, `/v1/admin/accounts`, `/v1/admin/billing/payments`, `/v1/admin/billing/payment`, `/v1/admin/payouts`, `/v1/admin/clubs`, and `/v1/admin/audit`.

Every one is a `GET`, and the module has no service to write with. The operations an operator has remain exactly the explicit commands the other ADMIN route modules declare — a suspension, a reinstatement, an object removal, a membership revocation, a case decision, an appeal outcome, a refund, a media purge — each going through the owning domain's own service with an actor and a reason. **No operation is added by this ADR.**

The directory sits beside `AdminFinancialDirectory` and follows the pattern that established: an operator read model that queries the owning domain's schema rather than inventing a projection nobody maintains. ADMIN still owns no table.

### The overview is counted by the platform, not by the console

`/v1/admin/overview` returns totals computed over whole tables. The alternative — the console adding up the rows of the paged lists it already reads — would have been approximately right on the one screen where an operator decides what to work on next.

A zero is published rather than omitted, because "nothing is waiting" and "the signal stopped arriving" are different answers and a missing row cannot tell them apart. There is no rate, no trend, no comparison with a previous period, and no derived score anywhere in the response or on the screen.

### Accounts is an enforcement work list, not a directory of everybody

ADR-0029 records that this surface publishes no person and offers no list or search over private material. A browsable consumer directory would reverse that, so `/v1/admin/accounts` does something narrower: with no status asked for it answers with the accounts **the platform has itself decided are not in good standing** — restricted, deletion pending, deactivated, erased. The rows are bounded by the platform's own decisions rather than by whatever somebody types.

Choosing a status widens it to that status, including `active`, because an operator sometimes has to confirm that an account they hold an identifier for is fine; the whole population counted by status is published beside the list so the size of what is being asked for is never in doubt. An exact-reference read by account identifier is available for an operator who already holds one.

What an account carries is its lifecycle, the coarse reason USERS publishes for it, and its region. No name, no handle, no contact detail, no profile, no photograph, and no locale — none of them is in the response shape. Region is present because it is jurisdiction, and an operator deciding whether a restriction may be lifted needs it. The finding behind a safety restriction stays with the enforcement record in TRUST & SAFETY and reaches an operator through the case that produced it, beside the evidence it rests on.

**No operation on a consumer account appears anywhere on the screen.** Restricting an account and restoring it are TRUST & SAFETY decisions that carry a case, a reason, an appeal path, and a record; they are taken on the case that produced them.

### A payment carries no payer; a payout carries no destination

`/v1/admin/billing/payments` and `/v1/admin/payouts` omit `consumer_id` and every recipient field respectively. A payment list keyed by who paid would be a purchase history for every person on the platform whatever the screen was called, and `docs/operations/03-finance-payout-operations.md` already forbids a recipient reference, bank detail, or account name in an operational view.

What is published instead is what an operator answering for a record actually turns on: the record's own identifier, its state, its amount against its own currency, the closed failure code the domain published, and the reference the provider quotes. The payment detail read carries the reversals and the claims recorded against that payment, because the question in front of a payment is whether money has already gone back and whether somebody's bank is taking it.

A payout names its creator by the same opaque identifier the creator directory already publishes, because a payout is *to* somebody and an operator answering for one has to know whose book it left.

### A membership is published by its identifier and its state

`/v1/admin/clubs` publishes clubs with membership counts by state, and — only when one club is asked for by identifier — that club's memberships by identifier, state, source, and dates. `member_id` is absent: a club that listed its members would be a console publishing who pays whom, and knowing who holds a membership changes nothing an operator may decide about it.

This exists so the membership revocation has a findable target. The revocation itself stays on the creator's screen, where it collects a reason and records an enforcement, so the operation has one home and one set of words.

### The audit trail sits with the domain that owns each record

`/v1/admin/audit` reads one of two append-only records, selected by a `stream` parameter, in one flat shape: AUTH's enumerated security event log, or TRUST & SAFETY's settled decisions.

They are surfaced under **Platform → Security** and **Queues → Decisions** rather than under a destination called "Audit". Every other subsystem's operational record is already read under Platform, and a settled decision belongs beside the work that produced it. Organising by the owning domain is what the rest of this console does, and it avoids a bucket whose only unifying property is how serious the word on the tab sounds.

A security event carries no account: an operator reading an authentication trail does not need to know whose it is, and a console that joined it would be an account browser wearing an audit label. A decision carries the operator's session reference rather than a name, which is what the platform records.

### Six destinations, with areas as addresses

The information architecture becomes six destinations — Overview, Queues, Creators, Accounts, Money, Platform — each with areas that are peers of one another and real addresses in their own right, following the pattern Platform already used. Appeals and Decisions become areas of Queues; Clubs becomes an area of Creators; Payments, Payouts, and Disputes become areas of Money; Security becomes a fifth area of Platform.

`parentOf` returns a record to **the area it was found in** rather than to the destination root, because that is where the operator's filter and position still are. Truncating the path would return them to the top of a list they had already worked halfway down. The root address redirects to the overview, and it is where an operator lands after authenticating.

### The console is proved in a real browser

`AUTH_PRIVILEGED_AUTHENTICATOR_VERIFIER=local-test-privileged` is composed in the browser suite's stack, on exactly the same terms as the local-test payment, media, RTC, notification, and AI adapters already there. `packages/config/src/server.ts` refuses that value in staging and production at schema parse time, so the API does not start rather than starting with a weakened verifier, and that refusal has its own suite.

`e2e/admin-console.spec.ts` signs in through the development panel and asserts what only a browser can answer: that every destination and area is an address a person can type, bookmark, reload, and leave; that a record opened from a list returns to that list; that a record made by a creator in Studio is found by an operator in the console; that the honest empty states are the ones that render; that no screen publishes a person; and that the whole console fits ten widths and survives text at twice its size.

`e2e/admin.spec.ts` continues to assert the production refusal against the same stack, unchanged.

## Security properties

| Property | How it holds |
|---|---|
| Every new route is refused without a fresh phishing-resistant Platform Admin session | Each handler resolves `AdminContextResolver` before any lookup, which checks audience and assurance separately and collapses both into one answer. Asserted per route for a consumer session, a stale-assurance operator session, and no session at all. |
| No new route can write | All seven are `GET`. The module holds a directory that only selects and no service at all. |
| Query values cannot become an open filter | Every state, status, stream, and identifier is validated against a closed vocabulary or a UUID pattern before it reaches a comparison; anything else is a 422. |
| Staging and production cannot compose the browser suite's verifier | `serverConfigSchema.superRefine` rejects `local-test-privileged` outside local and test at parse time, unchanged by this ADR. |
| Nothing published identifies a person | Asserted as exact key sets in the integration suite — a field added later fails the test rather than quietly appearing on a screen. |

## What this does not change

- **The role and scope matrix.** Which operator may claim a case, record a decision, suspend a creator, or issue a refund remains an open decision. Navigation is not permission; the server refuses at every route regardless.
- **Approval, dual control, and break-glass.** Locked in ADR-0017 semantics; implementation remains deferred.
- **The exact-reference reads the console still declines.** A media asset, an RTC call, an identity subject, and a single notification delivery are each published by the contract for a tool that already holds an identifier. The console offers none of them and says so on the screen that would otherwise be the place to put a lookup field.
- **Any production capability.** No payment, payout, tax, identity, or privileged-authenticator provider is approved by this ADR.

## Consequences

- The console covers sixteen operational concerns rather than eight, and every screen behind the gate now has browser coverage — the weaker guarantee ADR-0029 recorded is closed.
- One capability that was real in the API and unreachable in the product is reachable.
- The frozen runtime inventory rises from 146 operations to 153; all seven additions classify as `ADMIN_BLOCKED`, which is what every `/v1/admin/` operation classifies as.
- A responsive defect was found by the new browser assertion and fixed at its cause: a grid item's automatic minimum is its content, so the bottom navigation stopped being equal-columns at six destinations and twice the text size, and took the page sideways with it.

## Cross-references

[ADR-0009](ADR-0009-auth-authorization.md), [ADR-0017](ADR-0017-auth-session-recovery-security-policy.md), [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md), [ADR-0029](ADR-0029-platform-admin-product-interface.md), [ADR-0034](ADR-0034-local-test-admin-authenticator.md), [platform admin freeze report](../architecture/20-platform-admin-freeze-report.md), [platform admin surface](../surfaces/04-platform-admin.md), [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md).
