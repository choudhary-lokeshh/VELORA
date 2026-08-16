import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  digestColumn,
  inList,
  isHexDigest,
  nullablePairing,
  timestamptz,
} from '../database/columns.js';
import {
  maximumMediaDimension,
  maximumMediaFrames,
  maximumMediaObjectBytes,
  maximumMediaPixels,
  mediaAssetClasses,
  mediaAssetLifecycles,
  mediaIdempotencyKeyPattern,
  mediaImageFormats,
  mediaObjectRoles,
  mediaObjectStates,
  mediaObligationKinds,
  mediaObligationStates,
  mediaOwnerDomains,
  mediaRejectionReasons,
  mediaUploadSessionStates,
  mediaVariantKinds,
  transientMediaLifecycles,
  type MediaAssetClass,
  type MediaAssetLifecycle,
  type MediaImageFormat,
  type MediaObjectRole,
  type MediaObjectState,
  type MediaObligationKind,
  type MediaObligationState,
  type MediaOwnerDomain,
  type MediaRejectionReason,
  type MediaUploadSessionState,
  type MediaVariantKind,
} from './policy.js';

/**
 * MEDIA's storage.
 *
 * Four tables, and the split between them is the whole point. An **asset** is
 * the identity other domains hold and the technical facts the platform derived
 * from bytes. An **upload session** is one attempt to put bytes somewhere. An
 * **object** is one thing that exists with a provider. An **obligation** is one
 * unit of work the platform owes and has not discharged.
 *
 * Nothing here records what a binary means to the product. There is no column
 * for a slot, an ordering, a title, a visibility, or a safety decision, and
 * adding one would move an ownership boundary rather than add a field.
 *
 * Every table lives under `media_`. Cross-domain references are opaque
 * identifiers with no foreign key, per ADR-0023 and the data ownership rule;
 * foreign keys inside this module are ordinary because they stay inside it.
 */

/**
 * One binary, and everything the platform learned about it from its own bytes.
 *
 * The measured columns are nullable because they are unknown until inspection
 * runs, and the shape checks below make the states that claim to know them
 * unrepresentable without them. That is deliberate: an asset that reached
 * `ready` without a measured size is not a bug to find in a log later, it is a
 * row the database refuses to hold.
 */
export const mediaAssets = pgTable(
  'media_assets',
  {
    /** What kind of binary this is. Decides the derivative set and the limits. */
    assetClass: text('asset_class').notNull().$type<MediaAssetClass>(),
    /** Measured from the stored object. Never what a client declared. */
    byteSize: integer('byte_size'),
    createdAt: timestamptz('created_at').notNull(),
    /** Set when the provider no longer holds the original or any derivative. */
    deletedAt: timestamptz('deleted_at'),
    /** When removal was first owed, whichever authority asked for it. */
    deletionRequestedAt: timestamptz('deletion_requested_at'),
    /** Identified from the object's own header, never from a name or a claim. */
    detectedFormat: text('detected_format').$type<MediaImageFormat>(),
    digest: digestColumn('digest'),
    /** Frames the decoder found. Bounded, so an animation budget is explicit. */
    frameCount: integer('frame_count'),
    height: integer('height'),
    id: uuid('id').primaryKey(),
    /**
     * The owning domain's operation identity. Uniqueness with the owner is what
     * makes a retried request resolve to one asset rather than to two, and a
     * reused identity carrying a different request a conflict rather than a
     * silent second asset.
     */
    idempotencyKey: text('idempotency_key').notNull(),
    lifecycle: text('lifecycle').notNull().$type<MediaAssetLifecycle>(),
    lifecycleChangedAt: timestamptz('lifecycle_changed_at').notNull(),
    /** Provenance: which domain may act on this asset. Not product meaning. */
    ownerDomain: text('owner_domain').notNull().$type<MediaOwnerDomain>(),
    /** Opaque owner identifier. No foreign key, by ownership rule. */
    ownerReference: uuid('owner_reference').notNull(),
    readyAt: timestamptz('ready_at'),
    /** Internal and machine-readable. A client is told something coarser. */
    rejectionReason: text('rejection_reason').$type<MediaRejectionReason>(),
    updatedAt: timestamptz('updated_at').notNull(),
    /** Optimistic concurrency, so two workers cannot both advance one asset. */
    version: integer('version').notNull().default(1),
    width: integer('width'),
  },
  (table) => [
    // One asset per owner operation. The database settles a duplicate
    // initiation rather than a read deciding whether one already exists.
    uniqueIndex('media_assets_idempotency_uk').on(
      table.ownerDomain,
      table.ownerReference,
      table.idempotencyKey,
    ),
    // An owner's assets, newest first, paged by the tiebreaker the cursor uses
    // so the page boundary needs no sort.
    index('media_assets_owner_idx').on(
      table.ownerDomain,
      table.ownerReference,
      table.createdAt,
      table.id,
    ),
    // Reconciliation's query: assets sitting in a state they should be leaving.
    // Partial, so a platform with a million ready assets answers it from an
    // index the size of the work actually in flight.
    index('media_assets_transient_idx')
      .on(table.lifecycleChangedAt, table.id)
      .where(inList(table.lifecycle, transientMediaLifecycles)),
    check(
      'media_assets_owner_domain_check',
      inList(table.ownerDomain, mediaOwnerDomains),
    ),
    check(
      'media_assets_class_check',
      inList(table.assetClass, mediaAssetClasses),
    ),
    check(
      'media_assets_lifecycle_check',
      inList(table.lifecycle, mediaAssetLifecycles),
    ),
    check(
      'media_assets_format_check',
      sql`${table.detectedFormat} is null or ${inList(table.detectedFormat, mediaImageFormats)}`,
    ),
    check(
      'media_assets_rejection_reason_check',
      sql`${table.rejectionReason} is null or ${inList(table.rejectionReason, mediaRejectionReasons)}`,
    ),
    check(
      'media_assets_byte_size_check',
      sql`${table.byteSize} is null or (${table.byteSize} > 0 and ${table.byteSize} <= ${sql.raw(String(maximumMediaObjectBytes))})`,
    ),
    check(
      'media_assets_digest_check',
      sql`${table.digest} is null or ${isHexDigest(table.digest)}`,
    ),
    check(
      'media_assets_width_check',
      sql`${table.width} is null or (${table.width} > 0 and ${table.width} <= ${sql.raw(String(maximumMediaDimension))})`,
    ),
    check(
      'media_assets_height_check',
      sql`${table.height} is null or (${table.height} > 0 and ${table.height} <= ${sql.raw(String(maximumMediaDimension))})`,
    ),
    check(
      'media_assets_pixels_check',
      sql`${table.width} is null or ${table.height} is null or ${table.width} * ${table.height} <= ${sql.raw(String(maximumMediaPixels))}`,
    ),
    check(
      'media_assets_frames_check',
      sql`${table.frameCount} is null or (${table.frameCount} >= 1 and ${table.frameCount} <= ${sql.raw(String(maximumMediaFrames))})`,
    ),
    // A state that claims the platform knows what the bytes are must carry
    // what it learned. This is why `inspected` cannot be reached by a code path
    // that forgot to record a measurement.
    check(
      'media_assets_inspected_shape_check',
      sql`${table.lifecycle} not in ('inspected', 'processing', 'ready') or (${table.detectedFormat} is not null and ${table.byteSize} is not null and ${table.digest} is not null and ${table.width} is not null and ${table.height} is not null)`,
    ),
    check(
      'media_assets_quarantined_shape_check',
      sql`(${table.lifecycle} = 'quarantined') = (${table.rejectionReason} is not null)`,
    ),
    // `ready` requires the instant it became so. It is not an equivalence,
    // because a deleted asset keeps the record of having once been ready.
    check(
      'media_assets_ready_shape_check',
      sql`${table.lifecycle} <> 'ready' or ${table.readyAt} is not null`,
    ),
    check(
      'media_assets_deleted_shape_check',
      sql`(${table.lifecycle} = 'deleted') = (${table.deletedAt} is not null)`,
    ),
    // Removal is owed before it is done, so the request instant is present for
    // both halves and never only for the second.
    check(
      'media_assets_deleting_shape_check',
      sql`${table.lifecycle} not in ('deleting', 'deleted') or ${table.deletionRequestedAt} is not null`,
    ),
    check('media_assets_version_check', sql`${table.version} >= 1`),
    // The operation identity is an index key that in practice carries a value a
    // client supplied. Bounding its shape in the database as well as in the
    // service means a future caller that reaches the table another way cannot
    // widen it.
    check(
      'media_assets_idempotency_key_check',
      sql`${table.idempotencyKey} ~ ${sql.raw(`'${mediaIdempotencyKeyPattern}'`)}`,
    ),
  ],
);

/**
 * One attempt to get bytes to a provider.
 *
 * The capability reference is nullable and written after the provider call,
 * which happens outside every transaction. A process that dies between the
 * commit and that write leaves a session with no capability — recoverable, and
 * visible to reconciliation — rather than an asset with no session at all.
 */
export const mediaUploadSessions = pgTable(
  'media_upload_sessions',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    /** Attempts against this asset, so a reissued capability is visible. */
    attempt: integer('attempt').notNull().default(1),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull(),
    /** After this instant the capability is spent, used or not. */
    expiresAt: timestamptz('expires_at').notNull(),
    id: uuid('id').primaryKey(),
    /** The tightest ceiling the provider can be asked to enforce. */
    maximumBytes: integer('maximum_bytes').notNull(),
    /** Server-generated and opaque. No client input reaches it. */
    objectKey: text('object_key').notNull(),
    /** Which adapter issued the capability, recorded for reconciliation. */
    provider: text('provider'),
    /** The adapter's own handle for the capability. Never sent to a client. */
    providerReference: text('provider_reference'),
    state: text('state').notNull().$type<MediaUploadSessionState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('media_upload_sessions_object_key_uk').on(table.objectKey),
    // One open window per asset. A second initiation cannot quietly create a
    // second live capability against the same asset.
    uniqueIndex('media_upload_sessions_open_uk')
      .on(table.assetId)
      .where(sql`${table.state} = 'issued'`),
    // The expiry sweep: open windows whose instant has passed, oldest first.
    index('media_upload_sessions_expiry_idx')
      .on(table.expiresAt, table.id)
      .where(sql`${table.state} = 'issued'`),
    index('media_upload_sessions_asset_idx').on(table.assetId, table.createdAt),
    check(
      'media_upload_sessions_state_check',
      inList(table.state, mediaUploadSessionStates),
    ),
    check('media_upload_sessions_attempt_check', sql`${table.attempt} >= 1`),
    check(
      'media_upload_sessions_maximum_bytes_check',
      sql`${table.maximumBytes} > 0 and ${table.maximumBytes} <= ${sql.raw(String(maximumMediaObjectBytes))}`,
    ),
    check(
      'media_upload_sessions_completed_shape_check',
      sql`(${table.state} = 'completed') = (${table.completedAt} is not null)`,
    ),
    // A capability the platform never obtained has no provider either. The two
    // are written by the same statement or neither is.
    check(
      'media_upload_sessions_provider_shape_check',
      nullablePairing(table.provider, table.providerReference),
    ),
  ],
);

/**
 * One thing that exists with a provider.
 *
 * Originals and derivatives are one table with a role discriminator rather than
 * two, because a derivative is a stored object with extra facts and splitting
 * them would make "reach every byte of this asset" a join instead of one index
 * walk. A takedown is exactly that query, so it is the one that must not be
 * clever.
 */
export const mediaObjects = pgTable(
  'media_objects',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    byteSize: integer('byte_size'),
    createdAt: timestamptz('created_at').notNull(),
    deletedAt: timestamptz('deleted_at'),
    digest: digestColumn('digest'),
    format: text('format').$type<MediaImageFormat>(),
    height: integer('height'),
    id: uuid('id').primaryKey(),
    /** Server-generated and opaque, unique across the whole platform. */
    objectKey: text('object_key').notNull(),
    /**
     * Which processor produced this derivative. Recorded so a future pipeline
     * change is a regeneration decision rather than a silent change to what
     * historical outputs mean.
     */
    processingVersion: integer('processing_version'),
    provider: text('provider').notNull(),
    role: text('role').notNull().$type<MediaObjectRole>(),
    state: text('state').notNull().$type<MediaObjectState>(),
    updatedAt: timestamptz('updated_at').notNull(),
    variantKind: text('variant_kind').$type<MediaVariantKind>(),
    width: integer('width'),
  },
  (table) => [
    uniqueIndex('media_objects_object_key_uk').on(table.objectKey),
    // Exactly one original per asset, whatever concurrency attempts otherwise.
    uniqueIndex('media_objects_original_uk')
      .on(table.assetId)
      .where(sql`${table.role} = 'original'`),
    // Exactly one durable derivative per kind per processing version. This is
    // where fifty concurrent processing attempts collapse into one truth, and
    // it is settled by the database rather than by a read.
    uniqueIndex('media_objects_variant_uk')
      .on(table.assetId, table.variantKind, table.processingVersion)
      .where(sql`${table.role} = 'variant'`),
    // The takedown and delivery query: every object of one asset.
    index('media_objects_asset_idx').on(table.assetId, table.role),
    check('media_objects_role_check', inList(table.role, mediaObjectRoles)),
    check('media_objects_state_check', inList(table.state, mediaObjectStates)),
    check(
      'media_objects_format_check',
      sql`${table.format} is null or ${inList(table.format, mediaImageFormats)}`,
    ),
    // A variant is exactly the thing that has a kind and a processing version,
    // and an original is exactly the thing that has neither.
    check(
      'media_objects_variant_kind_shape_check',
      sql`(${table.role} = 'variant') = (${table.variantKind} is not null)`,
    ),
    check(
      'media_objects_processing_version_shape_check',
      sql`(${table.role} = 'variant') = (${table.processingVersion} is not null)`,
    ),
    check(
      'media_objects_variant_kind_check',
      sql`${table.variantKind} is null or ${inList(table.variantKind, mediaVariantKinds)}`,
    ),
    check(
      'media_objects_processing_version_check',
      sql`${table.processingVersion} is null or ${table.processingVersion} >= 1`,
    ),
    check(
      'media_objects_byte_size_check',
      sql`${table.byteSize} is null or (${table.byteSize} > 0 and ${table.byteSize} <= ${sql.raw(String(maximumMediaObjectBytes))})`,
    ),
    check(
      'media_objects_digest_check',
      sql`${table.digest} is null or ${isHexDigest(table.digest)}`,
    ),
    check(
      'media_objects_width_check',
      sql`${table.width} is null or (${table.width} > 0 and ${table.width} <= ${sql.raw(String(maximumMediaDimension))})`,
    ),
    check(
      'media_objects_height_check',
      sql`${table.height} is null or (${table.height} > 0 and ${table.height} <= ${sql.raw(String(maximumMediaDimension))})`,
    ),
    check(
      'media_objects_deleted_shape_check',
      sql`(${table.state} = 'deleted') = (${table.deletedAt} is not null)`,
    ),
  ],
);

/**
 * Work the platform owes.
 *
 * The shape follows the transactional outbox for the same reason: the
 * obligation is written by the transaction that created it, so a process dying
 * before it can enqueue anything loses a queue message and not a duty. A lease
 * is a database fact rather than a memory one, which is what lets another
 * worker recover work from one that died mid-effect.
 *
 * Rows are not deleted when they complete. A discharged purge is evidence that
 * it happened, and a dead-lettered one is evidence that it did not; both are
 * needed to answer "did the takedown actually reach the cache" later.
 */
export const mediaObligations = pgTable(
  'media_obligations',
  {
    assetId: uuid('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull().default(0),
    /** Not claimable before this instant. Retry backoff is written here. */
    availableAt: timestamptz('available_at').notNull(),
    completedAt: timestamptz('completed_at'),
    createdAt: timestamptz('created_at').notNull(),
    /** A redacted code. Never a provider message or a byte of content. */
    failureReason: text('failure_reason'),
    id: uuid('id').primaryKey(),
    kind: text('kind').notNull().$type<MediaObligationKind>(),
    /** A claim survives the process that took it, which is the whole point. */
    leaseExpiresAt: timestamptz('lease_expires_at'),
    leaseOwner: text('lease_owner'),
    /** Set for the kinds that address one object rather than the asset. */
    objectId: uuid('object_id').references(() => mediaObjects.id, {
      onDelete: 'cascade',
    }),
    /** Claim order within a kind. Monotonic, because instants collide. */
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    state: text('state').notNull().$type<MediaObligationState>(),
    updatedAt: timestamptz('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('media_obligations_sequence_uk').on(table.sequence),
    // At most one outstanding asset-scoped obligation of a kind per asset, and
    // at most one outstanding object-scoped one per object. Two partial indexes
    // rather than one over a nullable column, because a unique index treats
    // nulls as distinct and would let duplicates through exactly where the
    // duplicate matters.
    uniqueIndex('media_obligations_asset_pending_uk')
      .on(table.assetId, table.kind)
      .where(sql`${table.state} = 'pending' and ${table.objectId} is null`),
    uniqueIndex('media_obligations_object_pending_uk')
      .on(table.objectId, table.kind)
      .where(sql`${table.state} = 'pending' and ${table.objectId} is not null`),
    // The claim query: the oldest claimable rows of one kind, in order. Leads
    // with the columns the query filters and orders by, and stays partial so a
    // year of discharged obligations does not enter it.
    index('media_obligations_claimable_idx')
      .on(table.kind, table.sequence)
      .where(sql`${table.state} = 'pending'`),
    index('media_obligations_asset_idx').on(table.assetId, table.kind),
    check(
      'media_obligations_kind_check',
      inList(table.kind, mediaObligationKinds),
    ),
    check(
      'media_obligations_state_check',
      inList(table.state, mediaObligationStates),
    ),
    check('media_obligations_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'media_obligations_lease_shape_check',
      nullablePairing(table.leaseOwner, table.leaseExpiresAt),
    ),
    // A lease belongs to a row somebody may still be working on. A terminal row
    // holding one is indistinguishable from a live claim.
    check(
      'media_obligations_lease_state_check',
      sql`${table.leaseOwner} is null or ${table.state} = 'pending'`,
    ),
    check(
      'media_obligations_completed_shape_check',
      sql`(${table.state} = 'completed') = (${table.completedAt} is not null)`,
    ),
  ],
);

export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type MediaObjectRow = typeof mediaObjects.$inferSelect;
export type MediaObligationRow = typeof mediaObligations.$inferSelect;
export type MediaUploadSessionRow = typeof mediaUploadSessions.$inferSelect;
