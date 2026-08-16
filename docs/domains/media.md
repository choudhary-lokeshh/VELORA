# MEDIA domain

## Purpose and scope

MEDIA owns the binary. It is the platform authority for what bytes exist, what they actually are, whether they are technically safe to process, which derivatives were produced from them, where the objects live with a provider, and whether they have been deleted or purged.

MEDIA owns nothing about what a binary *means* to the product. It does not decide which image is somebody's profile picture, which asset is a creator's cover, which assets belong to a content item, whether a content item is public or club-protected, whether a creator may publish, or whether anything is safe to show. Those are owned by USERS, CREATORS, PRIVATE CLUBS, and TRUST & SAFETY respectively, and they stay there.

The distinction that makes this domain worth having is that **technical readiness is not publication**. An asset can be perfectly decodable, stripped, resized, and stored, and still be something no surface may render — because its owner never attached it, because its creator is restricted, because Safety holds it, or because the product category it belongs to is not enabled. MEDIA answers the first half of that sentence and refuses to answer the second.

## Ownership boundary

| Question | Owner |
|---|---|
| Do these bytes exist with a provider, and what is their length and digest? | MEDIA |
| What format are these bytes actually in, and are they decodable within our limits? | MEDIA |
| Were they scanned, and what did the scanner say? | MEDIA |
| Which derivatives exist, at what dimensions, under which processing version? | MEDIA |
| Has the original been deleted from the provider, and has the cache been purged? | MEDIA |
| Which image is a consumer's profile image, in what order, and does the profile meet the minimum? | USERS |
| Which asset is a creator's avatar or cover? | CREATORS |
| Which assets belong to a content item, and is that item public or club-scoped? | PRIVATE CLUBS |
| May this creator publish, may this item stay public, is it held or taken down? | TRUST & SAFETY |
| Does this viewer hold an entitlement to this club? | PRIVATE CLUBS |
| Is this account in good standing, and is it an adult? | USERS and AUTH |

MEDIA writes only tables under the `media_` prefix. It never writes `users_`, `creators_`, `clubs_`, or `safety_` rows, and it never reads them directly: an owning domain's association is that domain's record, and a safety answer arrives through the published Trust & Safety contracts. Conversely no other domain writes `media_` rows; they call MEDIA's service contracts and hold MEDIA asset identifiers as opaque references with no database foreign key, which is the same rule [data ownership](../architecture/05-data-ownership.md) already applies everywhere else.

An asset therefore has no idea what it is for, and that is deliberate. A product association is a fact in the owning domain pointing at an opaque asset identifier. Deleting the association does not delete the bytes; deleting the bytes does not delete the association. Both events are propagated explicitly, because the alternative is a cascade whose blast radius nobody can see.

## Asset lifecycle

The lifecycle describes the **technical** state of a binary and nothing else. It is not a publication state, and no surface may treat any value of it as permission to render.

```text
initiated -> awaiting_upload -> uploaded -> inspecting -> {quarantined | inspected}
inspected -> processing -> ready
any state -> deleting -> deleted
```

- `initiated` — the asset row exists; nothing has been reserved with a provider yet.
- `awaiting_upload` — an upload capability has been issued, bound to one object key, one method, one size ceiling, and one expiry. Nothing has arrived.
- `uploaded` — the platform has verified with the provider that an object exists at the expected key. **The bytes are untrusted.** Nothing about the client's declared type, size, or dimensions has been believed.
- `inspecting` — a worker holds a lease and is deriving truth from the stored bytes.
- `quarantined` — inspection refused the object. It is never delivered, never processed, and never satisfies any product requirement. The machine-readable reason is internal; what a client sees is coarse.
- `inspected` — the platform knows what the object actually is, and it is within policy.
- `processing` — derivatives are being produced from decoded pixels.
- `ready` — every required derivative for the asset's class exists and is durable. This is the strongest thing MEDIA will ever say, and it means "technically deliverable if somebody with authority says so".
- `deleting` / `deleted` — a deletion or takedown obligation is being carried out or has completed against the provider and every derivative.

`ready` is a technical claim about bytes. A separate delivery decision, composed from the owning domain, Trust & Safety, and the viewer's standing, decides whether those bytes reach anybody.

## Main flow

1. A client asks its **owning domain** for an upload — never MEDIA directly. USERS authorises a profile slot; CREATORS authorises an avatar; PRIVATE CLUBS authorises a content attachment.
2. The owning domain calls MEDIA with an asset class and its own idempotency identity. MEDIA creates the asset and the upload session in one transaction and commits.
3. MEDIA obtains an upload capability from the storage port **outside** any database transaction, then records it. A crash between those two steps leaves a recoverable session, not an orphan.
4. The client uploads directly to the provider using the capability. No bytes pass through the API.
5. Completion is signalled and is treated as a hint. MEDIA verifies object existence and provider-reported metadata itself, then records `uploaded` and enqueues durable inspection work.
6. Inspection derives format, decodability, dimensions, pixel count, frame count, digest, and metadata presence from the stored bytes. A refusal quarantines.
7. Processing produces the derivative set for the asset's class from decoded pixels, strips privacy-bearing metadata, and records the processing version. It is idempotent under concurrent attempts.
8. The owning domain learns the asset became `ready` and applies its own product rule. Only then can any surface even ask about delivery.
9. Delivery is authorised per request against current server truth and answered with a short-lived, asset-and-variant-bound credential or a proxied stream.

## Alternates, failure, and concurrency

Every step above is at-least-once and every effect is idempotent, because the durable work runs on the pattern in [jobs, idempotency, and concurrency](../engineering/03-jobs-idempotency-concurrency.md): PostgreSQL holds the obligation, a claim is a database lease rather than a memory fact, and BullMQ is a wake-up rather than a record.

- **Duplicate initiation.** Repeated initiation under one client operation identity resolves to one asset. The same key with a materially different request is a conflict, never a silent second asset.
- **Duplicate completion.** Safe and idempotent. A completion for an asset already past `uploaded` is a no-op success.
- **Abandoned upload.** A capability expires. An expired session is detectable and cleanable under an explicit technical TTL, which is a resource policy about objects nobody ever finished uploading and is deliberately not a retention policy about accepted media.
- **Concurrent processing.** Many attempts on one asset produce exactly one durable derivative set. Uniqueness is settled by the database, not by a read.
- **Provider ambiguity.** A timeout is not a failure and not a success. The obligation stays recorded and reconciliation resolves it against provider truth without letting provider state overwrite product or safety truth.
- **Deletion racing processing.** Deletion wins the delivery question immediately; the byte work then converges. A derivative created after a purge began is itself an obligation, and is recorded as one.
- **Worker death.** A lease expires and the work is reclaimed. No inspection, processing, deletion, purge, or reconciliation obligation is lost because a process died or because the queue was flushed.

## Security, data, and permissions

- Client-declared MIME type, filename, extension, dimensions, and size are hints. None is authoritative and none is ever stored as truth.
- Object keys are server-generated and opaque. A user-supplied filename never becomes part of a path, so traversal is not defended against — it is unreachable.
- Provider credentials never leave the server. An upload capability is narrow, short-lived, and bound to one object.
- Originals are private. Ordinary consumer and creator APIs never return an original object address; public delivery serves sanitized derivatives.
- Public derivatives carry no EXIF, no GPS, no device metadata, and no embedded comment or profile beyond what correct rendering requires.
- Accepted formats are an explicit allow-list backed by an actual safe decoder. Script-capable formats are refused in this milestone.
- Decoding is bounded: dimensions, pixel count, frames, and metadata size all have limits, and unlimited byte loading is refused.
- No raw media bytes, signed delivery credential, upload token, provider secret, or EXIF value reaches a log.
- Storage keys, digests, byte sizes, and adapter names are internal and are never rendered to a client.
- No provider or network call happens inside a database transaction.

## Phase, events, and open questions

Images only in this milestone. The asset and variant model is shaped so that a future video asset class is a new class rather than a new schema, but no transcoding, streaming, or segmented delivery is implemented, and none may be inferred from the model's generality.

`DECISION REQUIRED` in [open decisions](../decisions/DECISIONS_REQUIRED.md): object-storage, CDN, image-processing, and malware-scanning providers; remote media import, which stays disabled. `LEGAL REVIEW REQUIRED`: retention duration for quarantined originals, for deleted-asset evidence, and for objects held under a Safety legal hold. No duration is invented here, and nothing depends on a row being physically gone.

See [ADR-0010](../decisions/ADR-0010-media-storage-delivery.md), [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md), [media upload and delivery security](../security/04-media-upload-delivery.md), [media threat model](../security/10-media-threat-model.md), [media provider eligibility](../compliance/08-media-provider-eligibility.md), [USERS](users.md), [CREATORS](creators.md), [PRIVATE CLUBS](private-clubs.md), [TRUST & SAFETY](trust-safety.md), [creator entitlement](../flows/creator-entitlement.md).
