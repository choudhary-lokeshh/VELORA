# Media upload and private delivery

## Purpose and scope

Define safe generic media boundary for profile/attachment/future creator content. Owner domain controls business visibility; storage adapter holds bytes. This does not approve any mature/explicit content category.

## Upload flow

Authorized user requests constrained upload session for specific owner/object. Server validates intent, content category policy, size/type/count/quota and generates scoped short-lived upload target. Object enters quarantine; scanner/processor verifies magic bytes, malware, metadata, dimensions/transcoding and moderation signal as policy requires. Only owner transitions object to usable/published state. Client-supplied MIME/filename/URL is never trusted.

## Delivery flow

On each request owner re-authorizes object access: actor, relationship/entitlement, content status, country/channel, safety/enforcement and expiry. Adapter emits short-lived object-bound signed URL/cookie or streams through authorization proxy. Cache policy prevents shared/private leakage. Revocation/removal invalidates future delivery; no permanent public private-content URL.

## Failure/security/concurrency

Scan/processing failure remains unavailable and cleans/quarantines safely. Deduplicate upload completion via object/version/provider reference. SSRF-safe processing never fetches arbitrary user URL without hardened egress policy. Strip dangerous metadata as policy requires; control transformed derivatives and backups by same access/retention rules. Log access decision without leaking content.

## Implemented consumer profile media

The consumer profile media path implements this boundary for images only. An authorized owner requests a slot; the platform issues a short-lived, object-bound upload capability through a provider-neutral port and records the object as `pending_upload`. Nothing about the object is believed until its bytes are inspected: the content type is identified from the object's own header, the size is measured, and only then may the owner's image become `ready`. An object whose bytes never arrived, whose window closed, whose type is unsupported, or whose size exceeds the limit is recorded as `rejected` with a coarse reason its uploader can act on.

There is no URL column and no durable public address, so a link cannot outlive the authorization decision that produced it. Storage keys, checksums, byte sizes, and the adapter's name are never rendered to any client.

No storage vendor is approved. `USERS_PROFILE_MEDIA_STORAGE` defaults to `unavailable`, which refuses every upload and inspection, and staging and production reject any other value. The `local-test` adapter keeps objects in process memory for development and tests and performs magic-byte and size verification only; it performs no malware scanning and no content moderation, so its acceptance is never evidence about real user content. Byte deletion after a removal is best effort against the adapter and is recorded when it fails: the platform record is authoritative, and orphaned objects are a retention concern for the approved provider rather than a reason to leave a removed image visible.

This approves no mature or explicit content category. Consumer V1 profile media is ordinary profile media; creator private and mature content remains out of scope and default-denied here.

## Phase/cross-references

V1 profile/allowed attachment baseline if media is introduced; creator private media Phase 2. Mature creator media Conditional / Compliance-Gated. See [PRIVATE CLUBS](../domains/private-clubs.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [creator entitlement](../flows/creator-entitlement.md), [creator/content gates](../compliance/03-creator-content-gates.md), [abuse/SSRF](06-abuse-outbound-networking.md).
