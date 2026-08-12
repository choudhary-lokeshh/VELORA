# Media upload and private delivery

## Purpose and scope

Define safe generic media boundary for profile/attachment/future creator content. Owner domain controls business visibility; storage adapter holds bytes. This does not approve any mature/explicit content category.

## Upload flow

Authorized user requests constrained upload session for specific owner/object. Server validates intent, content category policy, size/type/count/quota and generates scoped short-lived upload target. Object enters quarantine; scanner/processor verifies magic bytes, malware, metadata, dimensions/transcoding and moderation signal as policy requires. Only owner transitions object to usable/published state. Client-supplied MIME/filename/URL is never trusted.

## Delivery flow

On each request owner re-authorizes object access: actor, relationship/entitlement, content status, country/channel, safety/enforcement and expiry. Adapter emits short-lived object-bound signed URL/cookie or streams through authorization proxy. Cache policy prevents shared/private leakage. Revocation/removal invalidates future delivery; no permanent public private-content URL.

## Failure/security/concurrency

Scan/processing failure remains unavailable and cleans/quarantines safely. Deduplicate upload completion via object/version/provider reference. SSRF-safe processing never fetches arbitrary user URL without hardened egress policy. Strip dangerous metadata as policy requires; control transformed derivatives and backups by same access/retention rules. Log access decision without leaking content.

## Phase/cross-references

V1 profile/allowed attachment baseline if media is introduced; creator private media Phase 2. Mature creator media Conditional / Compliance-Gated. See [PRIVATE CLUBS](../domains/private-clubs.md), [creator lifecycle](../flows/creator-lifecycle-content.md), [creator entitlement](../flows/creator-entitlement.md), [creator/content gates](../compliance/03-creator-content-gates.md), [abuse/SSRF](06-abuse-outbound-networking.md).
