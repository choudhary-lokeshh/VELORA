# PRIVATE CLUBS domain

## Purpose and scope

PRIVATE CLUBS owns creator club configuration, membership, permitted content metadata/status, and creator-specific access entitlements. It does not own creator verification, charge/refund truth, general discovery, raw media storage, or payout transfers.

## Implemented today

The creator content catalog exists under the `clubs_` prefix and is owned here rather than by CREATORS, because what a creator *is* and what a creator *publishes* have different owners, lifecycles, and audiences. An item moves `draft -> published -> archived`, with `archived -> draft` the only way back: archiving withdraws without destroying the record, and returning something to public view is a fresh decision rather than an undo. Every transition names the version it expects, so two simultaneous publications of one item settle as one.

Visibility is `public` or `members_only` from the start. `members_only` is deliberately unreachable by anybody today — no club, membership, or entitlement exists yet, so the read path has nobody to admit and refuses. That is fail-closed by construction rather than by a filter somebody has to remember.

The public catalog is a bounded, keyset-paged projection of published public items for an active creator whose profile is published, ordered by the publication instant, which never moves once set. Lifecycle, visibility, creator identifier, and version are in the predicate and never in the response. A creator who stops being active takes their whole catalog down without anybody unpublishing anything, because the read rechecks current creator state rather than trusting the flag.

The creator a row belongs to is an opaque CREATORS identifier with no foreign key, and this domain reaches CREATORS only through its published directory contract.

Clubs, entitlements, and invitations exist alongside the catalog. A club starts as a draft with nobody in it and no public presence; only a published club appears on a creator's public page, admits anybody, or may issue an invitation. Its slug is unique within its creator rather than globally, so two creators may both have a `studio`, and it is not renameable because it already appears in links people hold. Closing is final in this milestone: reopening would put people back inside a space they left with nobody deciding it, and no approved policy says what that means.

An entitlement records where it came from rather than whether it was paid for. A `paid` boolean would have made a complimentary invitation and a purchase indistinguishable, which is the confusion that lets somebody be told they bought something. `creator_invite` is the only source anything can carry today; `admin_grant` arrives with Admin operations, and `billing` cannot be written at all because the seam that would produce it refuses in every environment and configuration refuses to load a test adapter in staging or production. There is no route, header, or environment string that reaches one in a deployed environment.

An invitation is a bearer credential and is treated as one: 256 bits of server-generated randomness, returned exactly once, stored only as a SHA-256 digest, bounded by an expiry, revocable, and redeemable once. Redemption is settled by the database rather than by a read — a secret presented by ten callers at the same instant admits exactly one of them — and a claim that cannot be completed is released rather than spent, because a club unpublished a moment ago is somebody else's decision and consuming the invitation for it would charge the member for it. An unknown secret, an expired one, one already used, one withdrawn, a club that is not published, a creator who is not active, and an account that may not be admitted are one indistinguishable refusal, because anything finer is an oracle for guessing invitations.

An item scoped to a club is public only when that club is. A creator writing inside a room they have not opened yet keeps those posts off their public page until they open it, which is what a draft club is for; the freeze audit found the public catalog missing that condition and it is now in the predicate rather than applied afterwards.

Access is decided at the moment it is used. A membership is not permission: every protected read asks again whether the item is published and club-scoped, the club is published, the creator is active, the account is an adult in good standing, and the entitlement is live. Nothing consults a cached decision, so a revocation, a suspension, a closure, or a restriction stops a reader on the next read with nothing swept or recomputed. Club membership is deliberately not coupled to consumer discovery in either direction: a complete discoverable consumer profile is a discovery requirement and is not asked for here.

A creator sees how many people hold access and can withdraw one, and nothing else — no name, no consumer identifier, no contact detail, no behaviour. The member count is computed from live entitlements on every read rather than stored, so it cannot drift. A visitor sees club metadata only: a name, a description, and the slug, with no member count, no member list, no invitation, no content, and no control implying anybody can pay to join.

Content facts are not yet published through the outbox. The relay dead-letters an event no consumer is registered for, and no consumer for creator content exists: inventing a notification nobody has specified would be inventing product behaviour, so the events arrive with the domain that needs them.

## Main flow/state

Eligible verified creator opens policy-permitted club. Content moves `draft -> submitted/processing -> published -> restricted/removed`; only eligible published content can be offered. A club membership/content entitlement moves `pending -> active -> suspended/revoked/expired`. BILLING financial confirmation plus policy checks drives grant; content delivery checks entitlement and current content/creator/country/enforcement status every request.

## Alternates/failure/concurrency

Duplicate financial event or user purchase request resolves one entitlement operation by unique commercial reference/idempotency key. If final charge outcome is ambiguous, entitlement remains policy-defined pending or constrained, then reconciles; never blindly duplicate or grant permanent access. Refund/chargeback, creator suspension, content removal, block, geographic gate, or compliance disable may revoke access under published terms. Visitor URL never bypasses check.

## Security/data/permissions

Creator manages only own club/content/pricing within policy; subscriber sees own valid access; moderator/admin uses scoped audited actions. Store access decisions/entitlement version, not payment credentials. Media is private validated object with short-lived object-bound signed access. Mature/explicit content stays disabled until all compliance gates in product authority pass.

## Phase/events/open questions

## Item images

A catalog item holds up to six images in dense zero-based positions, and PRIVATE
CLUBS owns the attachment — which asset sits at which position on which item —
and nothing else. `POST /v1/creator/content/media` reserves one against an item,
`.../completion` confirms the bytes, and `.../removal` detaches one and frees its
position without renumbering the others.

The attachment is what makes an item's images follow the item's own rules, and it
is asked at the moment an address is issued rather than remembered: a draft's
images are deliverable to nobody, a public published item's are public, a
members-only item's are deliverable to whoever currently holds a live membership
of that club, and an archived item's stop being deliverable the moment it is
withdrawn. None of that is a second rule about images; it is the same rule the
item already has.

A visitor's catalog carries references to ready images only. The creator's own
listing carries every attachment with its state, because that is the person who
can do something about one that was refused.

## Implemented: the club as a destination

[ADR-0035](../decisions/ADR-0035-club-membership-product.md) gives a club an
address of its own and gives its creator something to say on it.

`clubs_benefits` is what a member is told they get: short lines, bounded at
eight of a hundred and twenty characters, owned beside the rest of a club's
identity because that is what they are. No row here carries a price, a cadence,
a term, or a guarantee — a promise about money made in a club's own words would
be a commercial term BILLING never approved and cannot enforce. The whole list
travels on every save, so a partial update cannot silently reorder somebody
else's work, and it commits with the club row under the same optimistic version
check.

`GET /v1/clubs?handle&slug` answers with the club's public identity for anybody
who asks, and with the members-only feed only for a caller the entitlement
question permits **on that request**. Somebody who holds nothing gets the
identity and an empty list — never a body, a summary, or a media reference
belonging to a protected item — which is what makes a typed address, a shared
link, and a developer console equally safe. Nothing consults a cached decision,
so a revoked, blocked, suspended, or expired reader loses the feed on their next
load rather than at the next sweep.

`POST /v1/clubs/departures` is provenance-aware. A creator invitation is a gift
and handing it back ends it; a membership whose source is `billing` is refused,
because ending it here would revoke access while the subscription kept charging.
That one is ended through cancellation, where the period and the renewal are
accounted for. The ended row stays, revoked, so somebody's own history remains
theirs to see — and a revoked row grants no read, because every protected read
asks for a live membership.

`membership.source = 'billing'` is now reachable. It arrives through the outbox
intake and through nothing else, and a commercial revocation withdraws only what
a commercial grant created: somebody who also holds an invitation keeps what the
creator gave them, because the money ending is not the creator changing their
mind.

Phase 2 pilot: club/subscription/locked content/PPV only after decisions. Events: club/content/membership/entitlement lifecycle. `DECISION REQUIRED / LEGAL REVIEW REQUIRED`: subscription grace/refund linkage, tiering, audience limits, content taxonomy and country rules. Cancellation itself is decided: it schedules the end of renewal and never takes back a paid period. See [creator lifecycle](../flows/creator-lifecycle-content.md), [creator entitlement](../flows/creator-entitlement.md), [creator/content gates](../compliance/03-creator-content-gates.md), [BILLING](billing.md), [media security](../security/04-media-upload-delivery.md).
