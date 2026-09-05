# GROWTH domain

## Purpose and scope

GROWTH owns how somebody arrived and nothing that follows from arriving: invitation links, signup attribution, acquisition counts, and scheduled live windows. It does not own entitlement, balance, standing, reward, profile, session, or any live encounter. It holds opaque USERS identifiers it cannot resolve to a person, and there is no method anywhere in it that grants anything.

It exists because VELORA has no acquisition budget. Every mechanism here is one the platform runs on its own database — a row for an invitation, a row for an origin, two instants for a window — so nothing in this domain can be switched off by a vendor or costs anything to run.

## Flow and data rules

One account has one invitation link forever, enforced by a unique index on the owner rather than by a prior read. A code is 22 lowercase alphanumerics from the platform's random source; it authorises nothing and is never derived from an identifier, so a link is safe to post publicly. Opening an invitation answers one boolean and never discloses the inviter — the address can be forwarded to anybody, so anything disclosed is disclosed to everybody who saw it.

Attribution is **first touch**, applied **only on the request that created the account**, and recorded **exactly once**: `growth_signup_attributions` is keyed on the account, so a second origin is impossible rather than refused. A CHECK constraint refuses an inviter equal to the invited account. A signup with no invitation and no campaign is recorded as `direct`, which is a real answer rather than a gap. Campaign labels are somebody else's strings from an address bar: bounded, stripped to a small printable set, truncated, and never read as permission, money, or identity.

`growth_acquisition_events` has four allowed names and no payload column. There is no address, referer, user agent, IP, or session identifier in this domain; a person refreshing an invitation page is one opening, deduplicated on a browser-generated key that is joined to no account. A live window's state — `upcoming`, `active`, `ended` — is derived from its two instants on every read, never stored and never swept.

## Security/failure/concurrency

Idempotency is structural everywhere it matters: the owner index for a link, the account key for an origin, the dedupe index for an opening. Attribution never fails an account creation — a signup must not depend on a marketing fact being writable — so a refusal is logged and the route answers as it would have. Consumer routes resolve the caller and read only their own link; the two public routes consult no session at all, because attaching an identity to a request that has no use for one is the thing to avoid rather than the thing to do. Operator routes resolve the operator first, refusing audience and assurance before any lookup.

There is no reward, no qualification state, and no per-inviter figure anywhere — in the contract, the schema, or a surface. Signup alone is what every fraudulent referral scheme has ever been paid for, and a number attached to one is what makes buying accounts worthwhile.

## Phase/open questions

V1: invitations, attribution, acquisition counts, platform-owned live windows. `DECISION REQUIRED`: retention for all four tables (`LEGAL REVIEW REQUIRED`), whether a referral reward exists and what would qualify for it, and whether a creator or community may own a live window. `EXTERNAL`: a registered domain, Search Console and Bing ownership, and Android App Links verification — see [public entry and SEO](../engineering/08-public-entry-and-seo.md).

See [ADR-0047](../decisions/ADR-0047-public-entry-and-organic-acquisition.md), [analytics](analytics.md), [domain boundaries](../architecture/03-domain-boundaries.md), [data ownership](../architecture/05-data-ownership.md).
