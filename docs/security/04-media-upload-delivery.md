# Media upload and private delivery

## Purpose and scope

Define safe generic media boundary for profile/attachment/future creator content. Owner domain controls business visibility; storage adapter holds bytes. This does not approve any mature/explicit content category.

This document states the boundary. [The media threat model](10-media-threat-model.md) states the adversary it is built against, [MEDIA](../domains/media.md) owns binary lifecycle, and [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md) locks the architecture that implements both. Where this document and those disagree, they are wrong together and all of them are corrected; nothing here may be read as permitting something the threat model refuses.

## Upload flow

Authorized user requests constrained upload session for specific owner/object. Server validates intent, content category policy, size/type/count/quota and generates scoped short-lived upload target. Object enters quarantine; scanner/processor verifies magic bytes, malware, metadata, dimensions/transcoding and moderation signal as policy requires. Only owner transitions object to usable/published state. Client-supplied MIME/filename/URL is never trusted.

## Delivery flow

On each request owner re-authorizes object access: actor, relationship/entitlement, content status, country/channel, safety/enforcement and expiry. Adapter emits short-lived object-bound signed URL/cookie or streams through authorization proxy. Cache policy prevents shared/private leakage. Revocation/removal invalidates future delivery; no permanent public private-content URL.

## Failure/security/concurrency

Scan/processing failure remains unavailable and cleans/quarantines safely. Deduplicate upload completion via object/version/provider reference. SSRF-safe processing never fetches arbitrary user URL without hardened egress policy. Strip dangerous metadata as policy requires; control transformed derivatives and backups by same access/retention rules. Log access decision without leaking content.

## Implemented consumer profile media

The consumer profile media path implements this boundary for images only. An authorized owner requests a slot; MEDIA issues a short-lived, object-bound upload capability and the slot records nothing about the bytes at all.

Nothing about the object is believed until it is inspected, and inspection is real work on a worker rather than a header check on the request thread: the format is decided from sniffed bytes before any decoder runs, the object is decoded under explicit dimension, pixel, frame, and metadata ceilings, and a scanning position is required. Only then are derivatives rendered from decoded pixels, and only when every one the class owes exists does the image become `ready`.

Because that is asynchronous, a client is told the truth as it changes — `checking`, then `preparing`, then `ready` — and the profile keeps reporting its image requirement as outstanding until it genuinely is not. There is no state in which a surface reports success while the platform still says quarantined. A refusal is coarse by design: what an uploader needs is enough to fix the file, and the internal distinction between undecodable and unsupported is useful mainly to somebody probing what the platform accepts.

There is no URL column and no durable public address, so a link cannot outlive the authorization decision that produced it. Storage keys, checksums, byte sizes, and the adapter's name are never rendered to any client.

USERS no longer holds a storage adapter at all. It asks [MEDIA](../domains/media.md) for an upload capability and for readiness, and holds an opaque asset identifier; object keys, digests, measured sizes, detected formats, and lifecycle values are MEDIA's and stay there. `MEDIA_STORAGE_PROVIDER` and `MEDIA_MALWARE_SCANNER` both default to `unavailable`, which refuses everything, and staging and production reject any other value.

Removal detaches the association first and then asks MEDIA to remove the bytes, which MEDIA records as a durable obligation. A failure to reach it does not leave the image on the profile: the association is what a surface reads, and an orphaned asset is a reconciliation concern rather than a reason to keep showing something somebody deleted.

This approves no mature or explicit content category. Consumer V1 profile media is ordinary profile media; creator private and mature content remains out of scope and default-denied here.

## Phase/cross-references

V1 profile/allowed attachment baseline if media is introduced; creator private media Phase 2. Mature creator media Conditional / Compliance-Gated. See [MEDIA](../domains/media.md), [media threat model](10-media-threat-model.md), [media provider eligibility](../compliance/08-media-provider-eligibility.md), [PRIVATE CLUBS](../domains/private-clubs.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [creator entitlement](../flows/creator-entitlement.md), [creator/content gates](../compliance/03-creator-content-gates.md), [abuse/SSRF](06-abuse-outbound-networking.md), [ADR-0010](../decisions/ADR-0010-media-storage-delivery.md), [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md).
