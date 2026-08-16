# Media threat model

## Purpose and scope

[Media upload and private delivery](04-media-upload-delivery.md) states the boundary. This document states the adversary. It is the threat model the MEDIA platform is built against and the one its tests are written from, covering upload, storage, inspection, processing, delivery, deletion, and reconciliation for image media.

The governing assumption is one sentence: **an uploaded file is hostile until the platform has proven otherwise from the bytes themselves, and proving what it is does not prove it may be shown.**

## Trust boundaries

There are four, and confusing any two of them is how media platforms leak.

1. **Client to API.** Everything a client says about a file — its name, its extension, its declared MIME type, its dimensions, its size, and its own claim that the upload succeeded — is a hint. Crossing this boundary changes nothing about what is believed.
2. **Provider to platform.** An object existing at a key proves an object exists at a key. Provider-reported metadata is evidence about storage, not about content; a provider that echoes a client-supplied `Content-Type` is echoing the client.
3. **Bytes to decoder.** This is the only boundary where content truth is created, and it is the most dangerous one to cross, because the thing being asked to establish trust is a parser being fed adversarial input. It runs bounded, outside the request path, and its failure is a refusal rather than an exception nobody catches.
4. **Technical readiness to publication.** Crossing this requires an authority MEDIA does not have. Nothing in the media pipeline may cross it alone.

## Adversaries and what they attempt

| Adversary | Attempts |
|---|---|
| Malicious uploader | Type confusion, polyglot files, decompression bombs, pixel bombs, animation abuse, metadata floods, oversized bodies, decoder crashes, arbitrary object keys, path traversal, overwriting another asset, replaying an upload token |
| Malicious consumer | Reading another account's asset, guessing an object key, reusing a delivery credential for a different asset or variant, holding a credential past a revocation |
| Malicious creator | Reading another creator's original, publishing to a surface they lack authority for, treating their own upload as consent evidence, resurrecting removed content by re-uploading identical bytes |
| Private-club outsider | Reaching protected media through a public path, a stale credential, a provider-origin address, or a cache |
| Revoked member | Minting a fresh credential after revocation; continuing to use one issued before it |
| Malicious operator | Viewing originals without authority, mutating state directly, acting without step-up or audit |
| Privacy attacker | Recovering GPS or device metadata from a public derivative, learning a filename, an object key, or whether some other account already uploaded identical bytes |
| Infrastructure failure | Provider timeout, ambiguous response, worker death mid-effect, queue loss, CDN purge failure, provider drift from recorded state |
| Race attacker | Duplicate initiation and completion, concurrent processing, delete against process, hold against delivery, revocation against issuance, purge against variant creation |

## Upload

**Threats.** Uploading to an arbitrary bucket or key; overwriting somebody else's object; escaping a size limit the API believed; using an expired or replayed capability; obtaining an asset without the owning domain having authorised the purpose; activating a test storage adapter in a deployed environment.

**Controls.** The owning domain authorises the purpose before MEDIA creates anything. Object keys are server-generated and opaque; no user-supplied filename or client-supplied path component reaches a key, so traversal has no input to work with. An upload capability names exactly one object key, one method, and one expiry, and carries the tightest size ceiling the provider supports enforcing. Capability creation happens outside any database transaction, and the resulting reference is recorded so a crash is recoverable rather than orphaning. Idempotency is scoped to the caller's operation identity: repeats collapse, and the same key with a different request is refused explicitly. Completion is a signal, never a state transition on its own — the platform verifies with the provider before recording `uploaded`. The storage adapter is chosen once at the composition root from a closed registry; no route, header, query parameter, or request field selects one, and configuration refuses the test adapter outside local and test.

**Residual risk.** A provider that does not enforce a size ceiling on a signed upload permits an oversized object to land. The platform detects it at inspection, refuses it, and owes a cleanup. That is recorded rather than assumed away, and it is one of the questions asked of any candidate provider.

## Storage

**Threats.** A public bucket; a predictable key; direct provider-origin access bypassing every authorization decision; credentials reaching a client; an original reachable through any ordinary API.

**Controls.** Production origins are private with no unauthenticated object access. Keys are unguessable and are never rendered to any client. Provider credentials exist only server-side. Originals are a separate object role from derivatives, and no consumer or creator contract returns an original address.

## Inspection

**Threats.** A file that is not what it claims; a file that is two things at once; a file whose decode consumes unbounded memory or time; a decoder vulnerability; a scanner that is unavailable being read as a pass.

**Controls.** Every fact is derived from the stored bytes: byte length, detected format, decodability, dimensions, pixel count, frame count, digest, metadata presence. The accepted set is an explicit allow-list of formats with a safe decoder behind them, not `image/*`. Limits on byte length, dimensions, total pixels, frames, and metadata size are explicit and are applied before a full decode is attempted. Decoding is bounded and does not load an unbounded upload into memory. A scanner is a port; where policy requires scanning and no approved scanner exists, the path fails closed. A decoder succeeding is never recorded as a malware verdict, because those are different claims.

**Format policy for this milestone.** Raster images with a safe decoder are eligible. Script-capable and active-content formats are refused: SVG is rejected outright, because a sanitizer that must be exactly right forever is not a control this milestone can honestly claim, and a rejected upload is a much smaller cost than a stored-XSS surface on a social platform. Exotic and rarely-exercised container formats are refused for the same reason — an allow-list is only as safe as the decoders on it. Animation is permitted only where the format's frame count is bounded and enforced.

## Processing

**Threats.** Copying source metadata into a public derivative; preserving GPS; leaking orientation-dependent behaviour; producing a derivative for the wrong asset under concurrency; silently changing what historical outputs mean; monopolising request-serving capacity.

**Controls.** Derivatives are generated from decoded pixel content, never by copying the source container. Orientation is applied during decode and the output is canonical pixels, so no consumer depends on metadata to render correctly. GPS, EXIF, device, and comment metadata are stripped; only what correct rendering requires survives. Variants are derived from real product surfaces rather than invented, and each is immutable under its processing version, which is recorded so a future pipeline change is a regeneration decision rather than a silent semantic change. Uniqueness under concurrency is settled by the database. Processing runs on the worker boundary, not on the request path.

## Delivery

**Threats.** Treating an opaque URL as authorization; a credential minted for asset A being used on asset B or on a different variant; a credential outliving a revocation; a public cache serving content after a hold; a private response being cached shared; a stale entitlement or safety decision being used because it was read too early.

**Controls.** Every issuance re-derives the answer from current server truth: the caller, account standing, the owning domain's association and publication intent, entitlement where applicable, the current Trust & Safety answer, and technical readiness. A credential is bound to one asset and one variant, is unguessable, and is short-lived. Cache directives distinguish public derivatives from private ones, and a private response is never marked shareable. Public derivatives are immutable and versioned so a change is a new address rather than a mutation behind a cached one.

**The honest limit.** A signed delivery credential is a bearer token that the platform generally cannot recall once issued; [media provider eligibility](../compliance/08-media-provider-eligibility.md) records that at least one major provider documents no per-URL revocation at all. So revocation has two halves and they must be described separately: **new** authorizations stop immediately, and **already-issued** ones remain valid until they expire. The bound on the second half is the credential TTL, and that number is a security parameter to be justified — not a convenience setting. Any statement that media access was revoked "instantly" that does not name that window is false.

## Takedown, deletion, and cache

**Threats.** A worker dying after a hold is recorded and before the purge happens; a CDN purge failing silently; derivatives surviving an original's deletion; a provider reporting an object missing and that being read as successful deletion when it is not; a removed asset resurrected by re-uploading identical bytes; deletion destroying evidence a case needs.

**Controls.** Four concepts stay distinct and are never one boolean: a user removing something from their product surface, Safety holding or taking it down, the bytes being deleted at the provider, and evidence being retained under a legal hold. A hold denies delivery at the origin immediately, independent of whether any cache has been purged. A takedown creates a durable revocation and purge obligation in PostgreSQL; queue loss delays it and cannot erase it. Purge outcomes are recorded, and a failed purge stays a visible operational obligation rather than an error somebody swallowed. Deletion targets the original and every derivative; provider deletion is idempotent, and a "not found" counts as deleted only where the provider's own documented semantics make that safe to conclude. Re-uploading the same bytes creates a new asset with a fresh authorization and policy evaluation; nothing is resurrected by content identity. Where hashes are used internally they are never exposed in a way that reveals whether some other account holds the same bytes.

**What cannot be promised.** Cache invalidation is a provider capability with provider semantics. The platform records measured or provider-documented behaviour and states it plainly; it does not claim caches are instantly empty.

## Multi-instance and reconciliation

**Threats.** Two replicas issuing conflicting decisions; two workers processing one asset; a duplicate durable variant set; a lost obligation; a deadlock from inconsistent lock ordering; a provider whose state has drifted from the record.

**Controls.** Every authority check happens in the database, in the transaction that performs the write it authorises. Claims are bounded, indexed, and leased. Lock ordering follows the existing repository rule. Reconciliation detects drift in both directions — an object that exists where the record says none should, a record that claims an object the provider does not have, work stuck in a transient state, a purge outstanding too long — and its corrections are idempotent, bounded, audited, and never allow provider state to overwrite product or safety truth.

## Logging and observability

No raw media bytes, no signed delivery URL or token, no upload capability secret, no provider credential, and no EXIF or private metadata value reaches a log. Metric labels never carry a user identifier, a creator handle, a filename, an object key, or a content title. What is observable is counts, ages, latencies, and outcomes — enough to run the platform, not enough to read anybody's media.

## Live production media gates

The internal platform being complete is not permission to serve real user media in production. Every one of the following must be satisfied, and each is independently blocking:

1. An **approved storage provider** with a recorded eligibility finding, a provider ADR, a security and privacy review, and a named operations owner.
2. An **approved delivery path** whose private-origin, signed-delivery, and purge semantics are documented and measured, with the maximum revocation exposure stated.
3. An **approved scanning position** — either an approved malware scanner or a written, owner-signed decision that scanning is not required for the scoped content, recorded rather than assumed.
4. A **data-residency and retention answer** for originals, derivatives, quarantined objects, and evidence under hold, from [data residency and retention](../compliance/05-data-residency-retention.md).
5. **Written provider confirmation** for any provider whose policy is silent on the content Velora actually serves.
6. **Operational readiness**: purge backlog, deletion backlog, and reconciliation mismatch are alertable and owned.

Mature-content media is a **separate** decision that none of the above unlocks. It stays refused by the Trust & Safety configuration gate under [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md), and satisfying every gate on this list changes nothing about it.

## Cross-references

[Media upload and delivery](04-media-upload-delivery.md), [security baseline](01-security-baseline.md), [RBAC](02-access-control-rbac.md), [privacy and retention](03-privacy-retention.md), [abuse and outbound networking](06-abuse-outbound-networking.md), [MEDIA domain](../domains/media.md), [media provider eligibility](../compliance/08-media-provider-eligibility.md), [ADR-0010](../decisions/ADR-0010-media-storage-delivery.md), [ADR-0023](../decisions/ADR-0023-media-platform-architecture.md), [jobs, idempotency, and concurrency](../engineering/03-jobs-idempotency-concurrency.md).
