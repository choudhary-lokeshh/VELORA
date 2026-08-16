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
- Storage keys, digests, byte sizes, and adapter names are internal. No product contract, response field, or delivery response carries one. The single exception is inherent rather than chosen: a direct-to-storage upload capability is an address for one object, so that object's key appears inside that URL and nowhere else. It is the key of the caller's own object, it is unguessable, and knowing it grants nothing, because the capability is bound to that object and every other operation is authorized server-side.
- No provider or network call happens inside a database transaction.

## Implemented foundation

`0038_media_platform` creates four tables, all owned here and all prefixed `media_`.

`media_assets` is the identity other domains hold plus the facts inspection derived: detected format, byte length, digest, dimensions, and frame count, each nullable until something measured it. `owner_domain` and `owner_reference` are provenance — which domain may act on the asset — and carry no foreign key. Idempotency is unique over the owner and the owning domain's operation identity, so a repeated initiation collapses to one asset and a reused identity naming a different class is a conflict rather than a silent substitution. The shape constraints are the point of the table: nothing reaches `inspected`, `processing`, or `ready` without every measurement present, a `quarantined` row exists exactly when a reason does, and `deleted` exactly when an instant does. A state that lies is refused by PostgreSQL rather than found in a log afterwards.

`media_upload_sessions` is one attempt to put bytes somewhere: the object key, the ceiling, the expiry, and the provider capability reference, which is written by a second statement because the provider call happens outside every transaction. A partial unique index allows one open window per asset. `media_objects` holds originals and derivatives in one table under a role discriminator, with partial unique indexes giving exactly one original per asset and exactly one variant per kind per processing version — which is where concurrent processing collapses into one durable truth, decided by an index rather than by a read. `media_obligations` follows the transactional outbox: a lease that survives the process holding it, an attempt count, a deferral instant, and a partial claimable index; two partial unique indexes rather than one over a nullable column, because a unique index treats nulls as distinct and would admit a duplicate exactly where a duplicate means discharging a deletion twice.

The lifecycle order lives in code as a transition map and the shape of each state lives in the database. Neither is sufficient alone: the map is what stops `quarantined` becoming `ready`, and the constraints are what stop `ready` existing without the measurements that justify it.

`MediaStoragePort` covers capability issuance, object stat, bounded read, derivative write, deletion, delivery authorization, and purge. Reading is bounded and an oversized object is an outcome rather than an exception, so a worker refuses it instead of allocating it. Deletion distinguishes `deleted` from `already_absent`, because whether an absent object counts as deleted is a provider-semantics question answered per adapter rather than folded away here. Purge has `unsupported` as a first-class answer, so an adapter with no cache in front of it reports that rather than claiming success.

`MEDIA_STORAGE_PROVIDER` defaults to `unavailable`, which refuses every operation, and staging and production reject any other value. The `local-test` adapter is filesystem-backed rather than in-process, because inspection runs in the worker and the API issues capabilities, and an in-memory adapter would let two processes disagree about whether an object exists. It requires an explicit directory and an explicit delivery signing key in every environment: a per-process fallback key would work on one replica and fail across two, which is the multi-instance bug hardest to find later. It performs no malware scanning and no content moderation, so nothing it accepts is evidence about real content.

## Upload orchestration

**MEDIA publishes no HTTP route, and that is a design decision rather than an omission.** An upload endpoint that did not belong to a product domain would be a purpose-free upload endpoint: somebody could reserve storage with no product reason at all. The owning domain authorizes the purpose and then calls this service, so CSRF, origin, and audience behaviour is a property of the Consumer and Creator routes and is tested where those routes live. A test asserts the route registry contains no media path, so a future route cannot appear here quietly.

The operation identity an upload is keyed by is bounded to the published client idempotency contract, in the service and again by `0039_media_upload_orchestration` as a check constraint, so a caller reaching the table another way cannot widen an index key.

A window can be **replaced but never reused**. A reissue always allocates a new object key. An expired capability is expired at the provider too, but reusing the key would mean that if one were ever honoured late its bytes would land exactly where the next completion looks — and the platform would accept an object written under an authorization that had already lapsed. A fresh key makes that sequence describe nothing, and a test writes bytes under a lapsed capability to prove completion refuses them. Only an asset still waiting for its first bytes may be reissued; an asset that is uploaded, inspecting, quarantined, ready, or being deleted has moved past the point where a second window means anything.

Reissue takes the advisory lock in [`idempotency-lock.ts`](../../apps/api/src/database/idempotency-lock.ts) before touching a row. `media_upload_sessions` carries two unique indexes, and `on conflict do nothing` arbitrates one: two writers that pass the arbiter's check in the same instant would collide on the other as a raised error rather than a skipped insert, which surfaces as a failed request for what is only a double submission.

Three housekeeping cycles run on the worker as one poller, because they are one story about windows nobody finished. **Expiry** closes spent windows in bounded batches under `for update skip locked` — without it two sweeps take the same identifiers, the second waits on the first's locks, and both then report having closed the same rows; that was measured at three rows each before the fix, and the state predicate now appears in the outer statement as well so the guarantee does not rest on skipping alone. **Recovery** re-obtains capabilities for sessions that committed before the provider call could be made, which is the crash window made visible and is exactly why the capability is a second write. **Reclamation** deletes assets that never received bytes and have gone quiet past an explicit technical TTL of twenty-four hours, measured from the last lifecycle change so a reissue restarts the clock.

That TTL is a resource policy about uploads nobody finished. It is deliberately **not** a retention policy about accepted media, and it may not be cited as a precedent for one: durations for accepted media, quarantined originals, and evidence under hold are `LEGAL REVIEW REQUIRED` and no code invents one.

Reclamation goes through the ordinary deletion path rather than deleting rows, so whatever bytes did reach the provider become a recorded obligation. Whether an object actually exists under a window nobody completed is a question about provider state, and answering it belongs to reconciliation rather than to a sweep.

## Inspection and quarantine

Uploaded bytes are untrusted, and inspection is where the platform stops guessing. It runs on the worker, never on a request thread — the API composes no inspector at all, so decoding hostile input is not something a route could be talked into.

The order of the checks is the cheap-first rule applied to an adversary rather than to a happy path: size before format, format before decoder, header before pixels. Every step that can refuse without invoking a parser does so, because the parser is the component being fed hostile input.

**Format admission runs before the decoder, and that ordering is the control.** libvips reads an SVG document and reports a perfectly sensible 64×64 image; it decodes GIF too. Both are measured in the test suite rather than assumed. An allow-list meaning "whatever the decoder accepts" would therefore accept an XML dialect with script capability on a social platform, so admission is a platform decision taken on sniffed bytes and the decoder is only ever asked about formats already admitted. Accepted: JPEG, PNG, and still WebP. Everything else — SVG, GIF, TIFF, BMP, HEIC, AVIF, PDF, archives, arbitrary bytes — is simply not on the list, and the list has no deny-list beside it that a case could be added to by mistake.

Disagreement between the header and the decoder is the polyglot signal: a file that is a JPEG by its first three bytes and something else to libvips is refused.

The header is read with the decoder's pixel limit **off**, deliberately. With the limit on, a pixel bomb makes libvips throw and every bomb is recorded as merely `undecodable`; with it off, the claimed dimensions come back and the platform applies its own ceilings and says exactly why — `dimensions_exceeded` or `pixel_limit_exceeded`. Reading a header allocates nothing whatever the header claims, so a precise refusal costs nothing. The decode probe that follows keeps the limit on.

Decodability is proven by decoding, bounded to a thumbnail. A header that parses is a weaker claim than the one processing depends on, so the pipeline pays for that here rather than discovering the truth during variant generation.

Metadata is capped at 32 KiB across every block the decoder exposes. That is comfortably above what a camera writes, and none of it survives anyway — processing renders from decoded pixels and strips every block — so metadata size has no downstream value to trade against the parser work it costs.

**Scanning is a separate claim from decoding**, and the two are never conflated. `MEDIA_MALWARE_SCANNER` defaults to `unavailable`, which refuses, and a refusal quarantines rather than passing: an environment with no scanning position accepts no media at all. An unavailable scanner reporting `clean` would be the single most dangerous line in this domain, and there is no configuration under which it can. The development scanner refuses a Velora marker string; that exercises the refusal path and is never evidence that anything was scanned.

Quarantine is terminal for delivery. A quarantined asset is never processed, never owes a `process` obligation, and cannot reach any state a surface would act on. Its reason is machine-readable and internal; what a client is eventually told is coarser, because the difference between "your file is not a JPEG" and "your file claimed to be a JPEG and its bytes are a PNG" is useful to an attacker and to nobody else.

Inspection is claimed under a database lease, so several workers take different rows, a worker that dies mid-decode loses its lease rather than the duty, and a completion from a worker whose row another has since taken is refused. A failed attempt backs off and is dead-lettered after five, retained as evidence rather than dropped.

Test fixtures are generated rather than committed, so a hostile input is a description in code instead of an opaque file. None of them is real malware.

## Processing and privacy

A derivative is **rendered from decoded pixels**, never assembled by copying the source container. That one rule is what makes the privacy guarantee structural rather than a stripping step somebody could forget: there is no path by which a source's EXIF, GPS, device identity, colour profile, or embedded comment can reach an output, because the output is built from pixels and an encoder rather than from the file it came from. The tests prove the source really carries those things before asserting their absence, and they assert the absence of the device string anywhere in the output bytes rather than only the absence of an EXIF block.

Orientation is baked in during decode, and that is a privacy consequence rather than a rendering nicety. A camera writes an orientation tag and expects the viewer to honour it; the platform strips every tag, so a derivative that had not been rotated first would render sideways for ever. Measured on this toolchain: a 120×60 source tagged orientation 6 becomes a 60×120 derivative when auto-oriented and stays 120×60 when it is not. Both branches are asserted.

Variants are `avatar_small` and `avatar_large` as square crops, and `card` and `display` as bounding boxes that preserve aspect. Nothing is enlarged — a small source stays small rather than becoming a larger, blurrier copy of itself — so a recorded dimension always describes picture rather than padding. Every derivative is WebP, because a derivative is a platform artefact rather than a copy of what somebody uploaded; WebP carries alpha, so a transparent PNG survives as one.

Each variant records the processing version that produced it. Bumping that version does not rewrite anything: it makes a new derivative set addressable alongside the old, and deciding what to do with the old one is a separate deliberate act rather than a silent change to what historical outputs mean.

The row is inserted **before** the bytes are written, the same ordering the upload path uses and for the same reason. A crash between the two leaves a record of an object that is missing — which reconciliation can see — rather than bytes at a key nothing references, which nobody would ever look for. It also means a writer that loses the uniqueness race never gets as far as writing, so there is nothing to clean up.

`ready` is reached only when every derivative the class owes is durable, and it remains a claim about bytes rather than about permission. Processing runs on the worker; the API composes neither an inspector nor a processor, so decoding hostile input and re-encoding pixels cannot compete with serving traffic and cannot be reached from a request at all.

## The publication bridge

`ready` is one term in a conjunction, and MEDIA supplies only that one. A delivery decision composes it with the owning domain's association and publication intent, the viewer's entitlement, and Trust and Safety's current answer. The composition lives here rather than in each caller for a specific reason: a conjunction evaluated separately by four surfaces is four chances to omit a term, and omitting one here is a compile error.

MEDIA reproduces no part of the safety policy engine, reads no `safety_` row, and holds no opinion about what a restriction implies. It cannot even form the safety question on its own — an asset has no idea what it is for, so it does not know which subject a restriction would name, which object a takedown would name, or which capability applies. The owning domain supplies those three; Trust and Safety answers them through the published eligibility contract; MEDIA obeys.

Every input is re-read inside the caller's executor at the moment of the decision, on the rule the eligibility contract already states: a safety check that commits separately from the thing it authorises is not a check. A hold therefore stops **new** authorizations immediately, with no cache to invalidate and no replica holding a stale yes.

Refusals report **every** closed gate rather than the first, ordered by the vocabulary so the headline is never whichever gate happened to be evaluated last. The reasoning is ADR-0022's: a caller told only the first refusal reasonably concludes that fixing it is enough, and here that is frequently untrue. An unknown asset identifier and an unattached asset give the same answer, because saying which would tell a stranger whether an identifier they guessed names anything.

Two defaults refuse. A composition with no association adapter reports `not_attached`; one with no safety adapter reports `safety_restricted`. Neither means "no restrictions found" — nothing was asked, and nothing is not permission.

The same rule covers the gap this milestone has not closed. An asset that hangs off a content item is marked content-gated, which additionally requires classification, depicted-person consent, surface eligibility, viewer assurance, and the mature-content gate. That gate is Phase 8's to wire, and until it is, **a content-gated asset is denied**. The missing piece is represented in the type system rather than assumed away, so it cannot be mistaken for a pass — and mature-content media stays blocked by the [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md) configuration gate regardless.

## Authorized delivery

Two paths, and confusing them is how private media ends up on a cacheable address.

A **public** derivative gets a permanent immutable address and `public, max-age=31536000, immutable`. That is safe precisely because the address carries the processing version and a random component, so a derivative that changes is a different address rather than the same one behind a cache somebody has to be trusted to forget. A **restricted** one gets a credential bound to one asset and one variant, and a response marked `private, no-store` — never shareable.

Which path applies is the owning domain's call, not MEDIA's: only a domain that knows what an asset is attached to can say whether that thing is a public creator page or somebody's private club. Neither path is reachable without the publication authority having said yes at the moment of issuance, and only a derivative is ever served — a test asserts the public address contains no original's key.

### What revocation actually means

It has two halves and both must always be stated together.

**New** authorizations stop the instant any authority changes its answer, because every issuance re-derives the decision inside the caller's transaction. There is no cache to invalidate and no replica holding a stale yes.

**Already-issued** credentials remain valid until they expire, for at most **300 seconds**. A signed URL is a bearer token and the platform generally cannot recall one; [media provider eligibility](../compliance/08-media-provider-eligibility.md) records that at least one major provider documents no per-URL revocation mechanism at all. That number is reported on every grant as `maximumRevocationExposureSeconds`, so no caller can describe delivery without naming it, and a test asserts a credential minted before a hold still verifies until it expires. **Any statement that media access was revoked instantly which does not name that window is false.**

For a public derivative the second half is not a TTL at all but a cache purge, whose semantics belong to a provider and are recorded rather than assumed.

A credential is bound to one object, and the expiry is signed along with it. Carrying one across to a different variant, a different asset, or a longer expiry all fail. Key knowledge buys nothing: a request that never went through the authority is refused at the origin, because obscurity of the key is not part of the authorization model.

Credentials are verifiable across replicas, which is why the signing key is configured rather than generated per process — a test mints on one runtime and verifies on another, and shows that a different key fails.

Where no provider is approved, delivery reports `unavailable` rather than a refusal. Nothing about the viewer or the asset is wrong; there is simply no approved way to serve bytes.

## Consumer profile media

USERS is the first domain to hold a MEDIA asset, and `0040_users_profile_media_assets` is where the ownership split became real. `users_profile_media` keeps which asset occupies which slot, in what order, and whether the slot is attached or removed. Everything else it used to carry — the object key, the digest, the measured size, the sniffed content type, the upload expiry, the refusal reason — moved here, because holding one fact in two domains means the copy that goes stale is the one somebody is watching a spinner against.

`state` narrowed from four values to two. `pending_upload`, `ready`, and `rejected` were never USERS' answers; what a client sees is now derived from the readiness contract at read time. That contract is coarse on purpose — `pending_upload`, `checking`, `preparing`, `ready`, `rejected`, `removed` — because whether a worker is decoding or encoding is not a product fact and publishing it would make every pipeline change a breaking contract change.

The published contract lost its `contentType`, and that is the point rather than an omission: what format some bytes turned out to be is MEDIA's answer, no surface renders it, and restating it from USERS would be one domain publishing a fact it no longer holds.

### The cached projection, and what it costs

Discovery's candidate query must stay a single indexed read; asking MEDIA per candidate would be an N+1 across the whole feed. So `users_profile_media.media_ready` caches MEDIA's answer, which is the [non-authoritative projection](../architecture/03-domain-boundaries.md) the boundary rules already permit.

Two properties make that safe. It defaults to false and is only ever set true by MEDIA saying so, so staleness delays somebody's discoverability rather than exposing an image. And **delivery never reads it** — every issuance re-derives readiness, safety, and entitlement — so a stale value cannot cause a byte to be served. The exposure is bounded to discoverability.

It is refreshed on two paths. The owner reading their own profile refreshes their own slots, because that person is the one waiting. A worker sweep refreshes the stalest slots platform-wide, oldest first, so a profile nobody has opened since its asset was taken down does not keep a stale `true` indefinitely.

Both paths reconcile admission, and that is a behaviour that would otherwise have regressed. An image becoming ready is what completes somebody's minimum profile, and completion is what activates their account. That used to happen on the write that made the image ready; readiness is asynchronous now, so without reconciling here an account would sit at `pending_profile` until its owner happened to save something else.

### What a surface shows

Completion no longer makes an image ready and does not pretend to. It tells the platform to go and look; the looking happens on the worker. A client posting a completion is told `checking`, then `preparing`, then `ready` — and the profile continues to report `ready_media` as outstanding until it genuinely is. There is no state in which a surface says an upload succeeded while the platform still says quarantined.

Delivery of a consumer profile image is restricted rather than public — a profile is never a public internet page — and for now the only entitled viewer is the owner. Whether a *peer* may see somebody's profile image is a question about the relationship between two accounts, which DISCOVERY owns; answering it in USERS would mean inventing the rule, so it is left until a surface needs it.

Not built yet, and not to be inferred from the model's generality: creator media, peer delivery of consumer images, takedown propagation and cache purge, reconciliation, and Admin operations.

## Phase, events, and open questions

Images only in this milestone. The asset and variant model is shaped so that a future video asset class is a new class rather than a new schema, but no transcoding, streaming, or segmented delivery is implemented, and none may be inferred from the model's generality.

`DECISION REQUIRED` in [open decisions](../decisions/DECISIONS_REQUIRED.md): object-storage, CDN, image-processing, and malware-scanning providers; remote media import, which stays disabled. `LEGAL REVIEW REQUIRED`: retention duration for quarantined originals, for deleted-asset evidence, and for objects held under a Safety legal hold. No duration is invented here, and nothing depends on a row being physically gone.

See [ADR-0010](../decisions/ADR-0010-media-storage-delivery.md), [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md), [media upload and delivery security](../security/04-media-upload-delivery.md), [media threat model](../security/10-media-threat-model.md), [media provider eligibility](../compliance/08-media-provider-eligibility.md), [USERS](users.md), [CREATORS](creators.md), [PRIVATE CLUBS](private-clubs.md), [TRUST & SAFETY](trust-safety.md), [creator entitlement](../flows/creator-entitlement.md).
