# ADR-0023: Media platform authority, asset lifecycle, and the live-media gate

- Decision date: 2026-08-16
- ADR status: Accepted
- Owners: Founder (decision owner), MEDIA, USERS, CREATORS, PRIVATE CLUBS, TRUST & SAFETY, ADMIN, security, compliance

## Context

[ADR-0010](ADR-0010-media-storage-delivery.md) locked the shape of media in 2026-08-12: private object storage behind provider-neutral ports, direct signed upload, a quarantined asynchronous pipeline, owner-authorized signed delivery, and a private CDN origin. Nothing in it is being reversed. What it did not do — deliberately, because no domain existed to hold it — is say who owns a binary, what a binary's states are called, or what the platform is allowed to claim about one.

Since then the repository has grown two media seams and no media platform.

**Consumer profile media exists and is honest about being a seam.** `users_profile_media` carries the product association (a dense slot per account, an ordering, a removal) and the provider state (an object key, a checksum, a byte size, a sniffed content type, an upload expiry, a rejection reason) in one table, under one `state` column that means both "this is the image in slot 2" and "the bytes passed a magic-byte check". `USERS_PROFILE_MEDIA_STORAGE` defaults to `unavailable` and refuses every operation, and staging and production reject any other value, so no deployed environment has ever accepted an image. The `local-test` adapter keeps objects in process memory, performs a three-signature header sniff, and performs no decode, no dimension check, no metadata stripping, and no scan.

**Creator media does not exist at all.** `creators_profiles` has no avatar and no cover. `clubs_content` has a title, a summary, a body, a lifecycle, and a visibility, and no attachment concept of any kind. Every creator surface that shows an image today shows a placeholder.

**Trust and Safety froze around content that has no bytes.** [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md) gave the platform one eligibility authority, scoped append-only enforcement, takedown claims, depicted-person consent by reference, and a mature-content gate that refuses. Every one of those was built against content objects whose payload is text. The moment a content object has a binary, "taken down" acquires a second meaning that safety cannot deliver on its own: the record can say removed while an object sits in a bucket and a derivative sits in a cache.

The risk this ADR exists to close is not that media is built badly. It is that media is built **five times** — once inside USERS, once inside CREATORS, once inside PRIVATE CLUBS, once inside MODERATION for evidence, once inside ADMIN for operations — each with its own idea of what `ready` means. At that point no query can answer "may this byte reach this person", because the answer is distributed across five tables that disagree, and a takedown is only as complete as the least careful of them.

The second risk is subtler and worse. A media pipeline that conflates *what these bytes are* with *whether they may be shown* will eventually publish something because a decoder succeeded. Those are different claims, made by different authorities, and the architecture has to make it impossible to spend one as if it were the other.

## Requirements

- One domain owns binary lifecycle. USERS, CREATORS, PRIVATE CLUBS, MODERATION, and ADMIN hold opaque asset references and never learn an object key, a digest, a byte size, or an adapter name.
- MEDIA owns no product meaning. It cannot say whose profile image an asset is, whether a content item is public, or whether anything is safe. It answers what the bytes are and refuses the rest.
- Technical readiness and publication are separate vocabularies with no value in common. No boolean, column, enum value, or contract field may be spendable as both.
- Everything a client says about a file is a hint. Type, extension, name, size, and dimensions are derived from the stored bytes or they are not known.
- Object keys are server-generated and opaque. No user-supplied filename, path component, or client-chosen identifier reaches a key, so traversal has no input.
- An upload capability names one object, one method, one ceiling, and one expiry, and is created outside every database transaction.
- Accepted formats are an explicit allow-list backed by a decoder the platform actually runs, and the refusal happens before the decoder is invoked. A decoder that is willing to parse a format is not a reason to accept it.
- Every derivative is rendered from decoded pixels. Source metadata is never copied forward, and a public derivative carries no GPS, EXIF, device, or comment data.
- Delivery authorization is re-derived at every issuance from current server truth, and the platform states the maximum lifetime of an already-issued credential rather than claiming instant revocation.
- Removal from a product surface, a safety takedown, provider deletion, and evidence under legal hold are four distinct concepts and are never one boolean.
- Every obligation — inspect, scan, process, delete, purge, reconcile — is a durable PostgreSQL row. Queue loss delays it and cannot erase it.
- No provider or network call happens inside a database transaction. No processing happens on the request path.
- Configuration refuses. No approved provider means no media in a deployed environment, and no route, header, query parameter, or request field can select an adapter.
- The model must accept a future video asset class without any video machinery being built now, and without its generality being readable as permission to build it.

## Decision

### MEDIA becomes a domain, and it owns bytes only

A new MEDIA domain joins [domain boundaries](../architecture/03-domain-boundaries.md), owning binary and object lifecycle, technical inspection truth, derivative production, and provider deletion and purge state. It must not own product association, ordering, publication intent, entitlement, safety, or evidence.

MEDIA writes only tables prefixed `media_`. It never writes and never reads `users_`, `creators_`, `clubs_`, or `safety_` rows; a safety answer arrives through the [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md) eligibility contract and a product association arrives through the owning domain's contract. No other domain writes `media_` rows. Cross-domain references are opaque asset identifiers with no foreign key, exactly as [data ownership](../architecture/05-data-ownership.md) already requires between owner domains.

An asset therefore does not know what it is for. Deleting a product association does not delete bytes, and deleting bytes does not delete an association; both propagate explicitly, because a database cascade across an ownership boundary is a blast radius nobody can see in a query plan.

### Four record shapes, and one lifecycle that is technical

Persistence separates four concerns, and the exact columns are settled in the implementing migration rather than here:

- **Asset** — the identity every other domain holds. Its class, its technical lifecycle, the facts inspection derived, its deletion and takedown markers, and a version for optimistic concurrency.
- **Upload session** — one attempt to put bytes somewhere. Its asset, its idempotency identity, the object key it is bound to, its ceilings, its expiry, its provider capability reference, and its state.
- **Object** — one thing that exists with a provider. Its asset, its role (`original` or `variant`), the variant kind and processing version when it is a variant, its provider, its opaque key, its measured byte length, its digest, and its deletion state.
- **Obligation** — one durable unit of work the platform owes: inspect, scan, process, delete, purge, or reconcile. Its target, its state, its lease, its attempt count, and its earliest next attempt.

Objects and variants are one table with a role discriminator rather than two, because a derivative is a stored object with extra facts, and splitting them would make "delete everything for this asset" a join instead of a scan of one index. Uniqueness of a variant is a database constraint on the asset, the variant kind, and the processing version, so concurrent processing cannot produce two durable truths.

The asset lifecycle is **technical** and is written down in [the MEDIA domain document](../domains/media.md): `initiated`, `awaiting_upload`, `uploaded`, `inspecting`, `quarantined`, `inspected`, `processing`, `ready`, `deleting`, `deleted`. `ready` is the strongest thing MEDIA will ever say and it means "technically deliverable if somebody with authority says so". There is no `published`, no `approved`, and no `visible` in this vocabulary, and no surface may treat any value of it as permission to render.

### Keys are server-generated, and the client never sees one

An object key is generated by the platform from the asset identity and a random component. A user-supplied filename is never stored as a key, never rendered to a client, and is not retained at all unless a later product requirement establishes a reason. Keys, digests, byte sizes, adapter names, and provider references are internal; no consumer, creator, or public contract carries any of them.

### Upload is direct to the provider under a narrow capability

The owning domain authorizes the purpose first — USERS for a profile slot, CREATORS for an avatar or cover, PRIVATE CLUBS for a content attachment — and only then does MEDIA create anything. MEDIA creates the asset and the upload session in one transaction and commits; it obtains the provider capability **outside** any transaction and records it in a second write. A crash between those two steps leaves a recoverable session, and reconciliation resolves it.

Completion is a signal and never a state transition on its own. The platform verifies with the provider that an object exists at the expected key, records what the provider reports as evidence about storage rather than about content, and moves the asset to `uploaded`, which means untrusted. Idempotency is scoped to the caller's operation identity: repeats collapse to one asset, and the same key with a materially different request is refused explicitly rather than silently creating a second one.

### Inspection derives truth from bytes, and the allow-list precedes the decoder

Inspection runs on the worker boundary against the stored object and derives byte length, detected format, decodability, dimensions, pixel count, frame count, digest, and metadata presence. Nothing a client said is consulted.

The accepted set is an explicit allow-list of raster formats. **SVG is refused, and the refusal is enforced before the decoder is called.** This is not a theoretical control: the platform image processor's prebuilt libvips reports `svg: input=true` and decodes an SVG document to pixels without complaint, so an allow-list expressed only as "whatever the decoder accepts" would accept an XML document with script capability on a social platform. Format admission is therefore a platform decision applied to sniffed bytes, and the decoder is asked only about formats already admitted. Exotic and rarely exercised container formats are refused for the same reason — an allow-list is only as safe as the decoders behind it.

Explicit limits on byte length, dimensions, total pixels, frames, and metadata size are applied before a full decode is attempted, and the decoder is configured with its own pixel ceiling as a second line rather than a first. Decoding is bounded and never loads an unbounded upload into memory.

Malware scanning is a port. A decoder succeeding is never recorded as a scan verdict, because those are different claims about the same bytes. Where policy requires scanning and no approved scanner exists, the path fails closed.

### Processing renders from decoded pixels behind a recorded processing version

Derivatives are produced by decoding to pixels, applying orientation, resizing, and re-encoding. The source container is never copied. GPS, EXIF, device, and comment metadata do not survive, and orientation is baked into the pixels so that no consumer depends on metadata to render correctly.

Variant kinds are derived from real product surfaces and nothing else. Each variant is immutable under its processing version, and that version is recorded on the object so a future pipeline change is an explicit regeneration decision rather than a silent change to what historical outputs mean.

Originals stay private. No ordinary consumer or creator contract returns an original address. Authorized access to an original, if a moderation workflow later needs one, is a separate high-privilege path with its own authority and its own audit, not a parameter on an existing one.

### The image processor is a library, not a provider

Image transformation is performed **in-process by the platform** behind a `MediaImageProcessor` port, using sharp on libvips. This is a dependency decision under [dependency governance](../security/08-dependency-risk-acceptance.md), not a provider decision under [provider adapters](../architecture/06-provider-adapters.md): no bytes leave the machine, no account exists, no terms of service apply, and there is nothing to be approved for.

That distinction is forced by the research in [media provider eligibility](../compliance/08-media-provider-eligibility.md): every assessed hosted image-processing platform prohibits pornographic, obscene, or indecent material on terms that apply to content Velora does not author, and two of them are ineligible outright on the mature-content answer. A platform that depends on a provider URL contract for resizing has made a product decision it cannot revisit without a rewrite. Verified on this toolchain before locking: sharp 0.35.3 under Bun 1.3.14 decodes, honours orientation, resizes, re-encodes, drops EXIF by default, and enforces `limitInputPixels` by refusing rather than by allocating.

The port exists so the processor is replaceable and so tests can substitute a deterministic double, not because a hosted processor is anticipated.

### Delivery is authorized at issuance, and revocation has two halves

Public derivatives and private media are different paths and are never confused.

A **public** derivative is an explicitly eligible, sanitized, immutable, versioned object with cache-safe headers. It is a derivative, never an original, and its address changes when its content changes so a cache never has to be trusted to forget.

A **private** delivery authorization is re-derived at every issuance from the caller, account standing, the owning domain's association and publication intent, entitlement where applicable, the current Trust and Safety answer, and technical readiness. The result is bound to one asset and one variant, is unguessable, and is short-lived. A private response is never marked shareable.

**The private delivery credential lifetime is 300 seconds.** It is a locked security parameter, pinned by a unit assertion so it cannot drift, and it is chosen as the smallest value that survives a page load, an image fetch, and one retry on a poor mobile connection. The consequence is stated plainly and must be repeated wherever revocation is described: new authorizations stop immediately, already-issued ones remain valid for up to 300 seconds, and the maximum revocation exposure for private media is therefore five minutes. [Media provider eligibility](../compliance/08-media-provider-eligibility.md) records that at least one major provider documents no per-URL revocation mechanism at all, so this is a property of signed delivery in general and not of one adapter. Any claim that media access was revoked instantly, made without naming that window, is false.

The authorization model is shaped so a future segmented media class can reuse it. No segmented, ranged, or streaming delivery is implemented.

### Removal, takedown, deletion, and hold are four concepts

They are never one boolean and never one column:

- **Product removal** detaches an asset from a surface. The owning domain owns it. Bytes are unaffected.
- **Safety takedown or hold** denies delivery at the origin immediately, independently of any cache, and creates a durable revocation and purge obligation. Trust and Safety owns the decision; MEDIA owns carrying it out.
- **Provider deletion** destroys the original and every derivative. It is idempotent, and a provider reporting an object missing counts as deleted only where that provider's own documented semantics make the conclusion safe.
- **Legal hold** preserves bytes as evidence while delivery stays denied. Preservation and availability are independent, and no retention duration is invented anywhere in code.

Purge outcomes are recorded. A failed CDN purge remains a visible operational obligation with an owner, not an error somebody swallowed, and origin denial does not wait for it. Re-uploading identical bytes creates a new asset with a fresh authorization and a fresh policy evaluation; nothing is resurrected by content identity, and internal digests are never exposed in a way that reveals whether another account holds the same bytes.

### Obligations live in PostgreSQL and BullMQ only wakes them

Every unit of media work is a durable row claimed under a lease, following [jobs, idempotency, and concurrency](../engineering/03-jobs-idempotency-concurrency.md). BullMQ is the wake-up and the execution surface; it is never the record. A flushed queue delays every obligation and loses none. Claims are bounded and index-driven — no full-table scan per poll, and no per-asset in-memory timer.

Reconciliation detects drift in both directions: an object where the record says none, a record claiming an object the provider does not have, work stuck in a transient state, a purge outstanding too long, an expired session with an abandoned object, and provider metadata disagreeing with what was recorded. Its corrections are idempotent, bounded, and audited, and provider state never overwrites product or safety truth.

The [ADR-0019](ADR-0019-database-connection-admission.md) admission architecture is unchanged. Media scale is solved with indexes, keyset pagination, and bounded claims, never by widening the pool. CPU-heavy processing runs on the worker boundary so it cannot monopolise request execution.

### Configuration refuses, and the test adapter cannot become a backdoor

`MEDIA_STORAGE_PROVIDER`, `MEDIA_DELIVERY_PROVIDER`, and `MEDIA_MALWARE_SCANNER` each default to `unavailable`, which refuses every operation, and staging and production reject any other value. Adapters are selected once at the composition root from a closed registry; no route, header, query parameter, or request field selects one. A startup assertion proves the refusal, following the pattern already holding `BILLING_PAYMENT_PROVIDER`, `PAYOUTS_PROVIDER`, `IDENTITY_VERIFICATION_PROVIDER`, and `MESSAGING_SAFETY_ELIGIBILITY`.

The `local-test` storage adapter is filesystem-backed under a configured directory rather than process memory, because inspection and processing run in the worker process and an in-memory adapter would make the API and the worker disagree about whether an object exists. It is refused outside local and test, and its acceptance of an object is never evidence about real content.

### Consumer profile media evolves; it is not replaced

USERS keeps `users_profile_media` and keeps owning what it owns: which image occupies which slot, in what order, whether it has been removed, and whether the profile satisfies the minimum-image requirement for discovery. It gains an opaque `media_asset_id`. It loses the provider-state columns — object key, checksum, byte size, detected content type, upload expiry, rejection reason — to MEDIA, and its `state` narrows to the association states USERS actually owns.

A consumer image counts toward discoverability only when the required derivative is technically ready **and** product and safety eligibility permit it. An initiated, uploaded, inspecting, or quarantined asset satisfies nothing, and the existing rule about losing the last eligible image is preserved exactly.

The migration is additive and then narrowing, is deterministic and reversible per [data and migrations](../engineering/02-data-migrations.md), and ships with real PostgreSQL migration tests. It carries no data-loss risk in any deployed environment for a specific and verifiable reason: `USERS_PROFILE_MEDIA_STORAGE` has refused every upload in staging and production since the column existed, no deployment environment has been provisioned at all, and the table is therefore empty everywhere except local development and test databases. That fact is recorded here so the migration's safety rests on evidence rather than on optimism, and it is asserted by the migration test rather than assumed.

`USERS_PROFILE_MEDIA_STORAGE` is retired by that migration's release. One media storage authority, not two.

### Video is a future asset class, not a future schema

The asset class, the variant kind, and the processing version are general enough that a video asset would be new values rather than new tables. Nothing else about video is built: no transcoding, no segmentation, no streaming, no ranged delivery, no live anything. The generality of the model is not permission to add them, and [product phases](../product/01-product-phases.md) remains the only authority that can move that line.

### Live production media stays blocked

Completing this platform enables nothing in production. The gates are enumerated in [the media threat model](../security/10-media-threat-model.md) and each is independently blocking: an approved storage provider with a recorded eligibility finding and a provider ADR; an approved delivery path with documented and measured private-origin, signed-delivery, and purge semantics; an approved scanning position or a written owner-signed decision that scanning is not required; a data-residency and retention answer; written provider confirmation wherever a policy is silent about what Velora actually serves; and alertable, owned purge, deletion, and reconciliation backlogs.

Mature-content media is a **separate** decision that none of those gates unlocks. It stays refused by the [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md) configuration gate, and satisfying every gate on that list changes nothing about it.

## Why

**One domain, because five would each be right about a third of it.** The alternative already started: `users_profile_media` mixes slot ordering with object keys, and every new surface would have copied the pattern. Ownership stated once, with `media_` as a hard write boundary, is the only version of this that a takedown can be complete against.

**Separate vocabularies, because a shared one gets spent.** If technical readiness and publication share a word, some code path will eventually check the cheap one. Giving them no value in common makes the mistake a type error rather than an incident.

**Bytes are the only witness.** Every media platform breach in the genre starts with something the client said being believed. Deriving every fact from stored bytes is not defence in depth; it is the only depth there is.

**The allow-list precedes the decoder, because the decoder is generous.** libvips will render SVG. It will decode formats nobody on this platform needs. Delegating admission to "does it parse" hands format policy to a library's build flags.

**Processing in-process, because the market decided for us.** Cloudinary, imgix, and Mux each prohibit content Velora does not author under terms broad enough to reach ordinary creator images, and are ineligible outright on the mature-content answer. A resize is not worth a provider dependency that constrains the product roadmap.

**Five minutes, stated, rather than "instant", implied.** A signed URL is a bearer credential. AWS documents no per-URL revocation. Choosing a short TTL and naming it is the honest version; claiming instant revocation while a credential is still live is the version that becomes a false statement in an incident review.

**Fail-closed configuration, because it is the pattern that has held.** Six capability variables already refuse in deployed environments for reasons written next to them. Media joins that list rather than inventing a weaker mechanism.

## Consequences

- MEDIA appears in [domain boundaries](../architecture/03-domain-boundaries.md), the [documentation index](../DOCS_INDEX.md), and the media implementation reading path. Its document is [MEDIA](../domains/media.md).
- Media availability is asynchronous everywhere. Consumer Web, Consumer Mobile, and Creator Studio gain real upload, inspection, processing, ready, rejected, and infrastructure-unavailable states, and none of them may render success while server truth says quarantined.
- New migrations are additive and land after `0037_safety_scale_indexes`.
- One dependency enters the graph for image processing, with a native component. It is subject to the ordinary dependency security gate, and an advisory against it is an ordinary gate failure with no special handling.
- Creator avatar, cover, and content attachment become possible for the first time. Their product rules stay with CREATORS and PRIVATE CLUBS; only the bytes are new.
- Trust and Safety gains a purge obligation it did not have. A takedown against content with a binary is not complete when the record says so; it is complete when origin denial is in force and the purge obligation is discharged or visibly outstanding.
- [ADR-0010](ADR-0010-media-storage-delivery.md) is not superseded. This ADR is how its locked decisions become code, and where they were silent it decides rather than leaving the choice to an implementation.
- Several provider, legal, and retention questions remain open in [open decisions](DECISIONS_REQUIRED.md). None is resolved here, and none may be resolved silently in code.

## Alternatives considered

**Extend `users_profile_media` for each new surface.** Rejected: it is the trajectory that produces a per-surface media implementation, and it has no answer for a takedown that must reach every derivative of an asset that three domains reference.

**Let MEDIA own product association too, since it already has the asset.** Rejected: it inverts ownership for a convenience. MEDIA would then decide which image is somebody's profile picture, and the domain that actually knows would be asking permission to describe its own state.

**One `ready` boolean for the whole platform.** Rejected outright. It is the single decision that would make every other control in this ADR decorative.

**A hosted image platform for processing and delivery.** Rejected on evidence: the assessed providers prohibit material Velora does not author, in language broad enough to reach ordinary content, and the two that would matter most are ineligible on the mature-content answer. The dependency would constrain the product rather than serve it.

**Accept SVG behind a sanitizer.** Rejected for this milestone. A sanitizer must be exactly right forever against an XML dialect with script capability; a refused upload is a much smaller cost than a stored-XSS surface, and the platform gains nothing from the format.

**A long delivery TTL for cache friendliness.** Rejected: the TTL is the revocation window. Trading a bounded safety guarantee for fewer signature calls is the wrong side of that trade on a platform with private club media.

**Wait for an approved provider before building any of it.** Rejected: nothing in this ADR depends on which provider is chosen, and building it now behind fail-closed configuration makes an eventual approval an adapter plus a review rather than a rewrite.

## Status

| Decision | Classification |
|---|---|
| MEDIA as a domain owning binary lifecycle only | LOCK NOW |
| Technical lifecycle vocabulary disjoint from publication | LOCK NOW |
| Server-generated opaque object keys, client-supplied names never in a path | LOCK NOW |
| Direct-to-provider upload under a narrow, expiring, object-bound capability | LOCK NOW |
| Byte-derived inspection with a platform allow-list applied before the decoder | LOCK NOW |
| SVG and script-capable formats refused | LOCK NOW |
| Derivatives rendered from decoded pixels with metadata stripped | LOCK NOW |
| In-process image processing behind a port; sharp on libvips | LOCK NOW |
| 300-second private delivery credential lifetime | LOCK NOW |
| Removal, takedown, provider deletion, and legal hold as four concepts | LOCK NOW |
| Durable PostgreSQL obligations with BullMQ as wake-up only | LOCK NOW |
| Fail-closed media configuration; test adapter refused outside local and test | LOCK NOW |
| `users_profile_media` narrowed to association, provider state moved to MEDIA | LOCK NOW |
| Storage, CDN, and malware-scanning vendors | DEFER UNTIL PROVIDER INTEGRATION |
| Retention for quarantined originals, deleted-asset evidence, and legal holds | LEGAL REVIEW REQUIRED |
| Remote media import by URL | DECISION REQUIRED BEFORE FEATURE |
| Video, transcoding, segmented and live delivery | DEFER UNTIL PHASE AUTHORITY MOVES |
| Cross-user binary deduplication | DEFER UNTIL SCALE REQUIRES |
| Public originals, public SVG, and client-visible provider credentials | REJECTED |

## Cross-references

[MEDIA](../domains/media.md), [media threat model](../security/10-media-threat-model.md), [media upload and delivery](../security/04-media-upload-delivery.md), [media provider eligibility](../compliance/08-media-provider-eligibility.md), [USERS](../domains/users.md), [CREATORS](../domains/creators.md), [PRIVATE CLUBS](../domains/private-clubs.md), [TRUST & SAFETY](../domains/trust-safety.md), [domain boundaries](../architecture/03-domain-boundaries.md), [data ownership](../architecture/05-data-ownership.md), [provider adapters](../architecture/06-provider-adapters.md), [data and migrations](../engineering/02-data-migrations.md), [jobs, idempotency, and concurrency](../engineering/03-jobs-idempotency-concurrency.md), [privacy and retention](../security/03-privacy-retention.md), [dependency risk acceptance](../security/08-dependency-risk-acceptance.md), [ADR-0010](ADR-0010-media-storage-delivery.md), [ADR-0019](ADR-0019-database-connection-admission.md), [ADR-0022](ADR-0022-trust-safety-policy-enforcement-authority.md).
