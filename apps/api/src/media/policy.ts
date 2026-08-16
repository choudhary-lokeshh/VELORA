/**
 * MEDIA's vocabulary and its technical limits.
 *
 * Everything here describes bytes. Nothing here describes whether anybody may
 * see them: ADR-0023 keeps the technical vocabulary and the publication
 * vocabulary disjoint precisely so that no value declared in this file can be
 * spent as permission to render. If a name in this module ever starts to read
 * like an answer about visibility, the boundary has been crossed.
 */

/**
 * Which domain asked for an asset, and therefore which domain may act on it.
 *
 * This is provenance, not product meaning. MEDIA records that USERS asked for
 * this asset on behalf of this account so that it can refuse a cross-owner
 * operation itself rather than trusting a caller to have checked. It does not
 * and must not record which slot the image occupies, whether it is a profile
 * picture, or whether anything is published — those stay with the owning
 * domain, which holds the asset identifier as an opaque reference.
 */
export const mediaOwnerDomains = ['users', 'creators', 'clubs'] as const;
export type MediaOwnerDomain = (typeof mediaOwnerDomains)[number];

/**
 * What kind of binary this is, technically.
 *
 * The class decides the derivative set and the technical limits, and nothing
 * else. Two assets of the same class are interchangeable to MEDIA however
 * differently their owning domains treat them.
 */
export const mediaAssetClasses = [
  'consumer_profile_image',
  'creator_avatar_image',
  'creator_cover_image',
  'creator_content_image',
] as const;
export type MediaAssetClass = (typeof mediaAssetClasses)[number];

/**
 * The technical lifecycle, in the order it advances.
 *
 * `ready` is the strongest thing this domain will ever say and it means
 * "technically deliverable if somebody with authority says so". There is no
 * `published`, no `approved`, and no `visible` here, and there never may be.
 */
export const mediaAssetLifecycles = [
  /** The row exists. Nothing has been reserved with a provider. */
  'initiated',
  /** A capability has been issued against one object key. Nothing arrived. */
  'awaiting_upload',
  /** An object exists at the expected key. **The bytes are untrusted.** */
  'uploaded',
  /** A worker holds a lease and is deriving truth from the stored bytes. */
  'inspecting',
  /** Inspection refused the object. It is never delivered and never processed. */
  'quarantined',
  /** The platform knows what the object is, and it is within policy. */
  'inspected',
  /** Derivatives are being produced from decoded pixels. */
  'processing',
  /** Every required derivative exists and is durable. */
  'ready',
  /** A deletion or takedown obligation is being carried out. */
  'deleting',
  /** The provider no longer holds the original or any derivative. */
  'deleted',
] as const;
export type MediaAssetLifecycle = (typeof mediaAssetLifecycles)[number];

/**
 * The only transitions the domain performs.
 *
 * Written as data rather than as a chain of conditionals so that "can an asset
 * go from `quarantined` to `ready`" is answerable by reading one table instead
 * of by tracing a service. The database enforces the shape of each state; this
 * enforces the order between them.
 *
 * Deletion is reachable from everything except the terminal states, because a
 * takedown does not wait for an upload to finish being interesting.
 */
const deletable = ['deleting'] as const;
export const mediaAssetTransitions: Readonly<
  Record<MediaAssetLifecycle, readonly MediaAssetLifecycle[]>
> = {
  initiated: ['awaiting_upload', ...deletable],
  awaiting_upload: ['uploaded', ...deletable],
  uploaded: ['inspecting', ...deletable],
  inspecting: ['inspected', 'quarantined', ...deletable],
  quarantined: [...deletable],
  inspected: ['processing', ...deletable],
  // A processing attempt that fails is retried from `processing`, so the state
  // is reachable from itself. The obligation bounds the attempts, not this.
  processing: ['processing', 'ready', 'quarantined', ...deletable],
  ready: [...deletable],
  deleting: ['deleted'],
  deleted: [],
};

export function mediaTransitionAllowed(
  from: MediaAssetLifecycle,
  to: MediaAssetLifecycle,
): boolean {
  return mediaAssetTransitions[from].includes(to);
}

/** Lifecycles a stuck asset can be found in. Reconciliation looks here. */
export const transientMediaLifecycles = [
  'initiated',
  'awaiting_upload',
  'uploaded',
  'inspecting',
  'inspected',
  'processing',
  'deleting',
] as const;

/**
 * The image formats the platform accepts, as an allow-list of things a safe
 * decoder handles and the product actually needs.
 *
 * This list is applied to sniffed bytes **before** any decoder is invoked. That
 * ordering is the control: the platform's decoder happily renders SVG, so an
 * allow-list meaning "whatever the decoder accepts" would accept an XML dialect
 * with script capability. See ADR-0023 and the media threat model.
 */
export const mediaImageFormats = ['jpeg', 'png', 'webp'] as const;
export type MediaImageFormat = (typeof mediaImageFormats)[number];

/**
 * Derivative roles, named for what a surface needs rather than for a pixel
 * size. Geometry belongs to the processing version and is recorded per object,
 * so changing what `card` measures is a new processing version rather than a
 * new vocabulary.
 */
export const mediaVariantKinds = [
  'avatar_small',
  'avatar_large',
  'card',
  'display',
] as const;
export type MediaVariantKind = (typeof mediaVariantKinds)[number];

/**
 * The derivative set each class owes before it may be `ready`.
 *
 * Deliberately small. A speculative variant is storage, processing time, and a
 * purge obligation for an address nothing ever requests.
 */
export const requiredMediaVariants: Readonly<
  Record<MediaAssetClass, readonly MediaVariantKind[]>
> = {
  consumer_profile_image: ['avatar_small', 'avatar_large', 'display'],
  creator_avatar_image: ['avatar_small', 'avatar_large'],
  creator_cover_image: ['card', 'display'],
  creator_content_image: ['card', 'display'],
};

/**
 * Which processor produced a derivative.
 *
 * Recorded on every variant so a future pipeline change is an explicit
 * regeneration decision rather than a silent change to what historical outputs
 * mean. Bumping it does not rewrite anything: it makes a new derivative set
 * addressable alongside the old one, and deciding what to do with the old one
 * is a separate, deliberate act.
 */
export const mediaProcessingVersion = 1;

/**
 * What each derivative measures, under {@link mediaProcessingVersion}.
 *
 * `cover` crops to a square because an avatar slot is square and letterboxing
 * one looks broken. `inside` preserves aspect because a card and a display are
 * bounding boxes rather than shapes. Nothing is enlarged: a small source stays
 * small rather than being upscaled into a blurrier copy of itself, so a
 * variant's recorded dimensions are what was actually produced.
 */
export const mediaVariantGeometry: Readonly<
  Record<
    MediaVariantKind,
    {
      readonly fit: 'cover' | 'inside';
      readonly height: number;
      readonly width: number;
    }
  >
> = {
  avatar_small: { fit: 'cover', height: 64, width: 64 },
  avatar_large: { fit: 'cover', height: 256, width: 256 },
  card: { fit: 'inside', height: 640, width: 640 },
  display: { fit: 'inside', height: 1600, width: 1600 },
};

/**
 * The one format every derivative is written in.
 *
 * One output format rather than one per source, because a derivative is a
 * platform artefact rather than a copy of what somebody uploaded. WebP carries
 * alpha, so a transparent PNG survives as one, and it is smaller than the
 * alternatives at the qualities these sizes need.
 */
export const mediaVariantFormat = 'webp' as const;
export const mediaVariantQuality = 82;

/** How often processing obligations are claimed. */
export const mediaProcessingIntervalMilliseconds = 5_000;

/**
 * What an owning domain may be told about an asset's progress.
 *
 * A **product** vocabulary rather than the technical lifecycle, and coarser on
 * purpose. An owning domain needs to render honest progress and decide whether
 * a requirement is satisfied; it does not need to know whether a worker is
 * decoding or encoding, and publishing the internal lifecycle would make every
 * future pipeline change a breaking change for four surfaces.
 */
export const mediaReadinessStates = [
  /** A capability exists. No bytes have been verified. */
  'pending_upload',
  /** Bytes arrived and the platform is working out what they are. */
  'checking',
  /** The platform knows what they are and is making the sizes it needs. */
  'preparing',
  /** Every derivative the class owes exists. Still not permission to show it. */
  'ready',
  /** Refused. It will never become ready. */
  'rejected',
  /** Being removed, or gone. */
  'removed',
] as const;
export type MediaReadinessState = (typeof mediaReadinessStates)[number];

/**
 * Why an object was refused, as its uploader may be told.
 *
 * Deliberately coarser than {@link mediaRejectionReasons}. The internal set
 * distinguishes an undecodable file from an unsupported one from a pixel bomb,
 * which is useful to an operator and useful to an attacker probing what the
 * platform will accept. What its owner needs is enough to fix the file.
 */
export const mediaPublicRejectionReasons = [
  'unsupported_type',
  'too_large',
  'not_uploaded',
  'content_rejected',
] as const;
export type MediaPublicRejectionReason =
  (typeof mediaPublicRejectionReasons)[number];

/** How an internal refusal is coarsened before anybody outside MEDIA sees it. */
export const publicRejectionFor: Readonly<
  Record<MediaRejectionReason, MediaPublicRejectionReason>
> = {
  dimensions_exceeded: 'too_large',
  empty_object: 'not_uploaded',
  // Animation is not a size problem and not a corruption problem; from the
  // uploader's side it is a format this platform does not take.
  frame_limit_exceeded: 'unsupported_type',
  metadata_limit_exceeded: 'content_rejected',
  object_missing: 'not_uploaded',
  pixel_limit_exceeded: 'too_large',
  processing_failed: 'content_rejected',
  scan_refused: 'content_rejected',
  too_large: 'too_large',
  undecodable: 'unsupported_type',
  unsupported_format: 'unsupported_type',
};

/** How the technical lifecycle is projected for an owning domain. */
export const readinessFor: Readonly<
  Record<MediaAssetLifecycle, MediaReadinessState>
> = {
  awaiting_upload: 'pending_upload',
  deleted: 'removed',
  deleting: 'removed',
  initiated: 'pending_upload',
  inspected: 'preparing',
  inspecting: 'checking',
  processing: 'preparing',
  quarantined: 'rejected',
  ready: 'ready',
  uploaded: 'checking',
};

/** An object is either what was uploaded or something the platform made. */
export const mediaObjectRoles = ['original', 'variant'] as const;
export type MediaObjectRole = (typeof mediaObjectRoles)[number];

/** Whether the provider still holds the bytes. Not whether anybody may read them. */
export const mediaObjectStates = ['present', 'deleting', 'deleted'] as const;
export type MediaObjectState = (typeof mediaObjectStates)[number];

export const mediaUploadSessionStates = [
  /** A capability exists and the window is open. */
  'issued',
  /** The platform verified an object at the expected key. */
  'completed',
  /** The window closed with nothing verified. */
  'expired',
  /** Superseded, or its asset is being deleted. */
  'abandoned',
] as const;
export type MediaUploadSessionState = (typeof mediaUploadSessionStates)[number];

/**
 * Work the platform owes. Every one of these is a durable row before it is a
 * queue message, so a flushed queue delays it and cannot erase it.
 */
export const mediaObligationKinds = [
  'inspect',
  'scan',
  'process',
  'delete',
  'purge',
  'reconcile',
] as const;
export type MediaObligationKind = (typeof mediaObligationKinds)[number];

/** Kinds that address one stored object rather than the asset as a whole. */
export const objectScopedObligationKinds: readonly MediaObligationKind[] = [
  'delete',
  'purge',
];

export const mediaObligationStates = [
  'pending',
  'completed',
  'dead_letter',
] as const;
export type MediaObligationState = (typeof mediaObligationStates)[number];

/**
 * Why inspection refused an object.
 *
 * Internal and machine-readable. What a client is told is coarser, because the
 * difference between "your file is not a JPEG" and "your file claimed to be a
 * JPEG and its bytes are a RIFF container" is useful to an attacker and not to
 * anybody else.
 */
export const mediaRejectionReasons = [
  'object_missing',
  'too_large',
  'empty_object',
  'unsupported_format',
  'undecodable',
  'dimensions_exceeded',
  'pixel_limit_exceeded',
  'frame_limit_exceeded',
  'metadata_limit_exceeded',
  'scan_refused',
  'processing_failed',
] as const;
export type MediaRejectionReason = (typeof mediaRejectionReasons)[number];

/**
 * Technical ceilings.
 *
 * These bound what a decoder is ever asked to do. They are refusal thresholds,
 * not product preferences: an image beyond any of them is rejected rather than
 * resized down, because deciding it is too big is cheap and decoding it to find
 * out is exactly the attack.
 */
export const maximumMediaObjectBytes = 15 * 1024 * 1024;

/**
 * The largest object each class accepts.
 *
 * Per class rather than one platform number, because the ceiling is a product
 * decision about what a surface asks people to upload rather than a technical
 * one about what a decoder can survive. Consumer profile media keeps the eight
 * mebibytes its published contract already promises;
 * {@link maximumMediaObjectBytes} remains the hard technical bound that no
 * class may exceed.
 */
export const maximumMediaBytesByClass: Readonly<
  Record<MediaAssetClass, number>
> = {
  consumer_profile_image: 8 * 1024 * 1024,
  creator_avatar_image: 8 * 1024 * 1024,
  creator_content_image: maximumMediaObjectBytes,
  creator_cover_image: maximumMediaObjectBytes,
};
export const maximumMediaDimension = 12_000;
export const maximumMediaPixels = 50_000_000;
/**
 * One. No accepted format in this milestone is permitted to animate: an
 * animated WebP is a supported container carrying an unbounded frame budget,
 * and bounding it is a decision this milestone has no product reason to take.
 */
export const maximumMediaFrames = 1;

/**
 * The most embedded metadata an accepted object may carry.
 *
 * A metadata flood is a cheap way to make a parser work hard and a cheap way to
 * carry a payload past somebody looking at pixels. Thirty-two kibibytes because
 * that is comfortably above what a camera writes — EXIF with a full thumbnail
 * is typically well under it — and because none of this data survives anyway:
 * processing renders from decoded pixels and strips every block, so metadata
 * size has no downstream value to trade against the parser work it costs.
 */
export const maximumMediaMetadataBytes = 32 * 1024;

/**
 * How large a decode probe is allowed to be.
 *
 * Inspection proves an object decodes by actually decoding it, bounded to a
 * thumbnail. Reading a header proves a header parses, which is a weaker claim
 * than the one the pipeline needs before it hands bytes to processing.
 */
export const mediaDecodeProbePixels = 32;

/** How long an inspection worker holds a claim before another may take it. */
export const mediaObligationLeaseMilliseconds = 2 * 60_000;

/** How long a failed obligation waits before it is claimable again. */
export const mediaObligationBackoffMilliseconds = 30_000;

/**
 * How many times an obligation is attempted before it is dead-lettered.
 *
 * Dead-lettered rather than dropped: a duty the platform could not discharge is
 * evidence, and it stays visible as an operational obligation instead of
 * disappearing into a log.
 */
export const maximumMediaObligationAttempts = 5;

/** How long an upload capability stays usable. */
export const mediaUploadWindowMilliseconds = 15 * 60_000;

/** How often inspection obligations are claimed. */
export const mediaInspectionIntervalMilliseconds = 5_000;

/**
 * How long an asset that never received bytes is kept before the platform
 * reclaims it.
 *
 * Twenty-four hours: long enough that somebody who closed a laptop mid-upload
 * can come back the same day and retry against the same asset, short enough
 * that abandoned rows and whatever orphaned bytes reached the provider do not
 * accumulate indefinitely.
 *
 * This is a **resource policy about uploads nobody finished**, and it is
 * deliberately not a retention policy about accepted media. No duration for
 * accepted media, quarantined originals, or evidence under hold is invented
 * anywhere in this codebase; those are `LEGAL REVIEW REQUIRED` in
 * `docs/decisions/DECISIONS_REQUIRED.md`. Nothing here may be cited as a
 * precedent for them.
 */
export const mediaAbandonedUploadMilliseconds = 24 * 60 * 60_000;

/** How often expired upload windows and abandoned assets are looked for. */
export const mediaUploadSweepIntervalMilliseconds = 60_000;

/**
 * How many rows one sweep cycle touches.
 *
 * Bounded so a backlog drains over several cycles rather than in one statement
 * that holds a transaction open across a hundred thousand rows.
 */
export const mediaSweepBatchSize = 100;

/**
 * The shape an owning domain's operation identity must have.
 *
 * It matches the published client idempotency contract, because in practice it
 * carries a value a client supplied. Bounding it here keeps arbitrary text out
 * of an index key, and the database enforces the same rule so a future caller
 * that skips the service cannot widen it.
 */
export const mediaIdempotencyKeyPattern = '^[A-Za-z0-9._-]{8,128}$';

export function isMediaIdempotencyKey(value: string): boolean {
  return new RegExp(mediaIdempotencyKeyPattern, 'u').test(value);
}

/**
 * How long a private delivery credential lives, and therefore the maximum time
 * an already-issued one outlives the authorization that produced it.
 *
 * Locked at 300 seconds by ADR-0023 and asserted by a unit test so it cannot
 * drift. It is the smallest value that survives a page load, an image fetch,
 * and one retry on a poor mobile connection. Revocation has two halves and both
 * must always be stated: new authorizations stop immediately, already-issued
 * ones remain valid for up to this long. Any claim of instant revocation that
 * does not name this window is false.
 */
export const mediaDeliveryCredentialSeconds = 300;

/**
 * A ceiling on what the platform will pull into memory to inspect.
 *
 * Equal to the object ceiling rather than larger, so an object that somehow
 * exceeded a provider-enforced upload limit is refused at read time instead of
 * being allocated first.
 */
export const maximumMediaReadBytes = maximumMediaObjectBytes;

/**
 * Object keys are generated here and nowhere else.
 *
 * No caller supplies any part of a key. A filename never reaches one, so path
 * traversal has no input to work with rather than being defended against, and
 * the random component makes a key unguessable even to somebody who knows every
 * identifier involved.
 */
export function mediaObjectKey(input: {
  readonly assetId: string;
  readonly role: MediaObjectRole;
  readonly variantKind?: MediaVariantKind;
  readonly processingVersion?: number;
}): string {
  // Random rather than derived. A key that could be computed from an asset
  // identifier would make key knowledge a function of identifier knowledge, and
  // an identifier travels to clients while a key never does.
  const suffix = crypto.randomUUID().replaceAll('-', '');
  if (input.role === 'original') {
    return `media/${input.assetId}/original/${suffix}`;
  }
  return `media/${input.assetId}/variant/${String(input.variantKind)}/v${String(
    input.processingVersion,
  )}/${suffix}`;
}
