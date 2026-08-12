# ADR-0010: Object storage, media processing, and private delivery

- Decision date: 2026-08-12
- ADR status: Accepted

## Context

Velora may store profile media, message attachments, creator originals, derived media, and moderation evidence. Bytes require scalable object storage, quarantine and processing, while owning domains retain publication and authorization truth. Private or paid media must never become public through object paths, CDN caching, or permanent URLs.

## Requirements

- Support large direct uploads without proxying all bytes through API replicas.
- Quarantine, validate, scan, transform, moderate, and publish asynchronously.
- Keep private originals and derivatives non-public and revocable.
- Support object-bound signed delivery and CDN acceleration without provider-specific domain logic.
- Preserve country/residency, retention, deletion, legal hold, audit, and evidence rules.
- Provide local/mock/test adapters before production services.

## Options evaluated

1. Provider-neutral object-store/media ports with direct signed upload and private CDN origin.
2. Application server filesystem.
3. Database byte storage for all media.
4. Public object URLs with opaque names.
5. One all-purpose third-party media platform called directly by clients.
6. API-proxied upload and download for every object.

## Decision

- Store media bytes in private object storage behind owner-defined `ObjectStore`, `MediaProcessor`, `MalwareScanner`, and delivery adapter ports. Provider, region, scanner, transcoder, and CDN remain deferred until media integration.
- Separate at least quarantine, approved private originals, derived assets, and restricted evidence by bucket/container or equivalent policy boundary. Use server-generated opaque object IDs; user filenames and MIME types are metadata only.
- Client requests a purpose-bound upload session from the owning domain. Owner validates actor, object, category, count, size, declared type, country/channel, and quota, then returns a short-lived signed upload limited to exact object key, method, size, and content constraints where provider supports them.
- Upload completion creates idempotent durable work. A sandboxed media worker validates actual magic bytes/container, size, dimensions/duration, decompression limits, malware, metadata, and content policy; strips unsafe metadata; generates only approved derivatives; and records normalized results. Failed/unscanned media never becomes available.
- Provider events and client completion are untrusted signals. Owner transitions media metadata through versioned states only after verified object existence, checksum/size, processing, and required moderation outcome.
- Owning domain stores media metadata/status and decides visibility. Object storage never owns profile, message, content, moderation, or entitlement truth.
- Private delivery calls owner authorization for actor, object, relationship/entitlement, creator/content status, safety, country/channel, and current policy. Then issue a short-lived object/version-bound signed URL/cookie or stream through a controlled authorization proxy. CDN uses private origin and cannot serve on object-key knowledge alone.
- Public assets are an explicit published class copied/promoted through owner workflow; private objects are never made public in place.
- Cache keys include immutable object version/derivative and authorization class. Revocation prevents new signatures immediately and uses bounded URL TTL; emergency invalidation is available for high-risk removal.
- Media workers use isolated egress, no route to private application networks beyond required stores/services, resource/CPU/memory/time limits, patched parsers, and SSRF-safe retrieval for any approved remote import. Nested/remote fetch is disabled by default.
- Delete/retain bytes and all derivatives according to owner lifecycle, legal hold, backups, provider deletion evidence, and audit. Object inventory/reconciliation finds orphans and missing objects without changing domain truth automatically.

## Why

Object storage is the appropriate byte store and direct signed upload removes API bandwidth bottlenecks. Private-by-default buckets, durable processing, and owner-authorized signed delivery preserve entitlement and moderation rules. Ports keep storage/CDN/media vendors replaceable while allowing a simple local adapter during development.

## Rejected alternatives

- Server filesystem: not durable or shared across replicas and complicates backup, scaling, and deployment.
- Database for all media bytes: inflates transactional storage/backups and mixes byte lifecycle with domain rows.
- Public opaque URLs: obscurity is not authorization and revocation/caching remain unsafe.
- Client-to-vendor SDK as business integration: bypasses owner authorization, phase, country, and audit rules.
- Proxying every byte through API: increases cost and saturation; retained only for exceptional evidence/high-control flows.

## Consequences

Media availability is asynchronous. Clients need upload, processing, rejection, and retry states. Object store/CDN are provider dependencies but not sources of truth. Signed URL TTL creates bounded revocation delay that must match content risk.

## Risks

- Malicious parser files, decompression bombs, metadata leakage, or content-type confusion.
- CDN/cache misconfiguration can expose private media.
- Orphaned objects and failed deletion can increase cost/privacy risk.
- Direct upload can bypass declared size/type constraints.
- Provider-specific transformation URLs can leak into domain/client contracts.

## Mitigations

Quarantine, magic-byte validation, sandboxed patched processors, resource limits, checksums, private origins, cache tests, short signatures, emergency purge, inventory reconciliation, deletion jobs/alerts, no transformation URL contracts, and adapter conformance/security tests.

## Scaling path

Phase A uses one approved object store and small worker pool. Phase B adds CDN, autoscaled media workers, lifecycle policies, multipart upload, regional processing, and queue isolation. Phase C uses regional buckets/routes or specialized processing providers only when residency, throughput, or cost data requires it; object IDs and owner contracts remain stable.

## Security implications

Use private buckets, least-privilege per-worker credentials, TLS, server-side encryption where applicable, key rotation, upload/download expiry, object-key unpredictability, log redaction, evidence isolation, and provider access audit. Never put storage credentials or unrestricted signed URLs in clients, AI context, notifications, or generic logs.

## Testing implications

Test type spoofing, oversized/polyglot/archive/decompression inputs, malware signal, duplicate completion, processing crash/retry, moderation failure, signed URL scope/expiry, entitlement/block/revocation races, CDN cache leakage, metadata stripping, orphan cleanup, deletion/hold, provider outage, and adapter replacement.

## Migration/reversibility

Object IDs and media metadata are provider-neutral. Migrate by dual-writing new uploads, copying/checksumming historical objects, comparing inventory, switching signed delivery, then retiring old storage after retention/rollback window. Never change owner object IDs or entitlements during byte migration.

## Status

| Decision | Classification |
|---|---|
| Private object storage with provider-neutral ports | LOCK NOW |
| Signed direct upload and owner-authorized signed delivery | LOCK NOW |
| Durable quarantined media pipeline | LOCK NOW |
| Private CDN-origin architecture | LOCK NOW |
| Object store, CDN, scanner, and processor vendors | DEFER UNTIL PROVIDER INTEGRATION |
| Remote media import | DECISION REQUIRED BEFORE FEATURE |
| Public URLs for private media and production filesystem storage | REJECTED |

