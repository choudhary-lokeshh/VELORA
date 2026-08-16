-- MEDIA: the platform's binary authority.
--
-- Four tables, and the split between them is the point. An **asset** is the
-- identity other domains hold plus the facts inspection derived from bytes. An
-- **upload session** is one attempt to put bytes somewhere. An **object** is
-- one thing a provider holds. An **obligation** is one unit of work the
-- platform owes and has not discharged.
--
-- Nothing here records what a binary means to the product. There is no slot, no
-- ordering, no title, no visibility, and no safety decision, because those are
-- owned by USERS, CREATORS, PRIVATE CLUBS, and TRUST & SAFETY. `owner_domain`
-- and `owner_reference` are provenance -- who may act on this asset -- and
-- carry no foreign key, per the data ownership rule.
--
-- Three constraint groups carry the invariants that matter.
--
-- The **shape checks on `media_assets`** make a lifecycle that claims knowledge
-- unrepresentable without it: nothing reaches `inspected`, `processing`, or
-- `ready` without a detected format, a measured size, a digest, and
-- dimensions, and a `quarantined` row exists exactly when a reason does. A
-- state that lies is refused by the database rather than found in a log.
--
-- The **partial unique indexes on `media_objects`** settle concurrency. One
-- original per asset, and one variant per kind per processing version, so
-- however many workers attempt a derivative at once there is exactly one
-- durable truth -- decided by the index, never by a read.
--
-- The **partial unique indexes on `media_obligations`** keep a duty from being
-- owed twice. Two indexes rather than one over a nullable column, because a
-- unique index treats nulls as distinct and would admit duplicates exactly
-- where a duplicate means discharging a deletion or a purge twice.
--
-- Obligations follow the transactional outbox: written by the transaction that
-- created them, claimed under a database lease rather than a memory one, and
-- retained after completion, because a discharged purge is evidence it happened
-- and a dead-lettered one is evidence it did not.
--
-- See ADR-0023.
CREATE TABLE "media_assets" (
	"asset_class" text NOT NULL,
	"byte_size" integer,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"detected_format" text,
	"digest" text,
	"frame_count" integer,
	"height" integer,
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"lifecycle" text NOT NULL,
	"lifecycle_changed_at" timestamp with time zone NOT NULL,
	"owner_domain" text NOT NULL,
	"owner_reference" uuid NOT NULL,
	"ready_at" timestamp with time zone,
	"rejection_reason" text,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"width" integer,
	CONSTRAINT "media_assets_owner_domain_check" CHECK ("media_assets"."owner_domain" in ('users', 'creators', 'clubs')),
	CONSTRAINT "media_assets_class_check" CHECK ("media_assets"."asset_class" in ('consumer_profile_image', 'creator_avatar_image', 'creator_cover_image', 'creator_content_image')),
	CONSTRAINT "media_assets_lifecycle_check" CHECK ("media_assets"."lifecycle" in ('initiated', 'awaiting_upload', 'uploaded', 'inspecting', 'quarantined', 'inspected', 'processing', 'ready', 'deleting', 'deleted')),
	CONSTRAINT "media_assets_format_check" CHECK ("media_assets"."detected_format" is null or "media_assets"."detected_format" in ('jpeg', 'png', 'webp')),
	CONSTRAINT "media_assets_rejection_reason_check" CHECK ("media_assets"."rejection_reason" is null or "media_assets"."rejection_reason" in ('object_missing', 'too_large', 'empty_object', 'unsupported_format', 'undecodable', 'dimensions_exceeded', 'pixel_limit_exceeded', 'frame_limit_exceeded', 'metadata_limit_exceeded', 'scan_refused', 'processing_failed')),
	CONSTRAINT "media_assets_byte_size_check" CHECK ("media_assets"."byte_size" is null or ("media_assets"."byte_size" > 0 and "media_assets"."byte_size" <= 15728640)),
	CONSTRAINT "media_assets_digest_check" CHECK ("media_assets"."digest" is null or "media_assets"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_assets_width_check" CHECK ("media_assets"."width" is null or ("media_assets"."width" > 0 and "media_assets"."width" <= 12000)),
	CONSTRAINT "media_assets_height_check" CHECK ("media_assets"."height" is null or ("media_assets"."height" > 0 and "media_assets"."height" <= 12000)),
	CONSTRAINT "media_assets_pixels_check" CHECK ("media_assets"."width" is null or "media_assets"."height" is null or "media_assets"."width" * "media_assets"."height" <= 50000000),
	CONSTRAINT "media_assets_frames_check" CHECK ("media_assets"."frame_count" is null or ("media_assets"."frame_count" >= 1 and "media_assets"."frame_count" <= 1)),
	CONSTRAINT "media_assets_inspected_shape_check" CHECK ("media_assets"."lifecycle" not in ('inspected', 'processing', 'ready') or ("media_assets"."detected_format" is not null and "media_assets"."byte_size" is not null and "media_assets"."digest" is not null and "media_assets"."width" is not null and "media_assets"."height" is not null)),
	CONSTRAINT "media_assets_quarantined_shape_check" CHECK (("media_assets"."lifecycle" = 'quarantined') = ("media_assets"."rejection_reason" is not null)),
	CONSTRAINT "media_assets_ready_shape_check" CHECK ("media_assets"."lifecycle" <> 'ready' or "media_assets"."ready_at" is not null),
	CONSTRAINT "media_assets_deleted_shape_check" CHECK (("media_assets"."lifecycle" = 'deleted') = ("media_assets"."deleted_at" is not null)),
	CONSTRAINT "media_assets_deleting_shape_check" CHECK ("media_assets"."lifecycle" not in ('deleting', 'deleted') or "media_assets"."deletion_requested_at" is not null),
	CONSTRAINT "media_assets_version_check" CHECK ("media_assets"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"asset_id" uuid NOT NULL,
	"byte_size" integer,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"digest" text,
	"format" text,
	"height" integer,
	"id" uuid PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"processing_version" integer,
	"provider" text NOT NULL,
	"role" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"variant_kind" text,
	"width" integer,
	CONSTRAINT "media_objects_role_check" CHECK ("media_objects"."role" in ('original', 'variant')),
	CONSTRAINT "media_objects_state_check" CHECK ("media_objects"."state" in ('present', 'deleting', 'deleted')),
	CONSTRAINT "media_objects_format_check" CHECK ("media_objects"."format" is null or "media_objects"."format" in ('jpeg', 'png', 'webp')),
	CONSTRAINT "media_objects_variant_kind_shape_check" CHECK (("media_objects"."role" = 'variant') = ("media_objects"."variant_kind" is not null)),
	CONSTRAINT "media_objects_processing_version_shape_check" CHECK (("media_objects"."role" = 'variant') = ("media_objects"."processing_version" is not null)),
	CONSTRAINT "media_objects_variant_kind_check" CHECK ("media_objects"."variant_kind" is null or "media_objects"."variant_kind" in ('avatar_small', 'avatar_large', 'card', 'display')),
	CONSTRAINT "media_objects_processing_version_check" CHECK ("media_objects"."processing_version" is null or "media_objects"."processing_version" >= 1),
	CONSTRAINT "media_objects_byte_size_check" CHECK ("media_objects"."byte_size" is null or ("media_objects"."byte_size" > 0 and "media_objects"."byte_size" <= 15728640)),
	CONSTRAINT "media_objects_digest_check" CHECK ("media_objects"."digest" is null or "media_objects"."digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_objects_width_check" CHECK ("media_objects"."width" is null or ("media_objects"."width" > 0 and "media_objects"."width" <= 12000)),
	CONSTRAINT "media_objects_height_check" CHECK ("media_objects"."height" is null or ("media_objects"."height" > 0 and "media_objects"."height" <= 12000)),
	CONSTRAINT "media_objects_deleted_shape_check" CHECK (("media_objects"."state" = 'deleted') = ("media_objects"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "media_obligations" (
	"asset_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"object_id" uuid,
	"sequence" bigserial NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_obligations_kind_check" CHECK ("media_obligations"."kind" in ('inspect', 'scan', 'process', 'delete', 'purge', 'reconcile')),
	CONSTRAINT "media_obligations_state_check" CHECK ("media_obligations"."state" in ('pending', 'completed', 'dead_letter')),
	CONSTRAINT "media_obligations_attempts_check" CHECK ("media_obligations"."attempts" >= 0),
	CONSTRAINT "media_obligations_lease_shape_check" CHECK (("media_obligations"."lease_owner" is null) = ("media_obligations"."lease_expires_at" is null)),
	CONSTRAINT "media_obligations_lease_state_check" CHECK ("media_obligations"."lease_owner" is null or "media_obligations"."state" = 'pending'),
	CONSTRAINT "media_obligations_completed_shape_check" CHECK (("media_obligations"."state" = 'completed') = ("media_obligations"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "media_upload_sessions" (
	"asset_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"maximum_bytes" integer NOT NULL,
	"object_key" text NOT NULL,
	"provider" text,
	"provider_reference" text,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_upload_sessions_state_check" CHECK ("media_upload_sessions"."state" in ('issued', 'completed', 'expired', 'abandoned')),
	CONSTRAINT "media_upload_sessions_attempt_check" CHECK ("media_upload_sessions"."attempt" >= 1),
	CONSTRAINT "media_upload_sessions_maximum_bytes_check" CHECK ("media_upload_sessions"."maximum_bytes" > 0 and "media_upload_sessions"."maximum_bytes" <= 15728640),
	CONSTRAINT "media_upload_sessions_completed_shape_check" CHECK (("media_upload_sessions"."state" = 'completed') = ("media_upload_sessions"."completed_at" is not null)),
	CONSTRAINT "media_upload_sessions_provider_shape_check" CHECK (("media_upload_sessions"."provider" is null) = ("media_upload_sessions"."provider_reference" is null))
);
--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_obligations" ADD CONSTRAINT "media_obligations_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_obligations" ADD CONSTRAINT "media_obligations_object_id_media_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_idempotency_uk" ON "media_assets" USING btree ("owner_domain","owner_reference","idempotency_key");--> statement-breakpoint
CREATE INDEX "media_assets_owner_idx" ON "media_assets" USING btree ("owner_domain","owner_reference","created_at","id");--> statement-breakpoint
CREATE INDEX "media_assets_transient_idx" ON "media_assets" USING btree ("lifecycle_changed_at","id") WHERE "media_assets"."lifecycle" in ('initiated', 'awaiting_upload', 'uploaded', 'inspecting', 'inspected', 'processing', 'deleting');--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_object_key_uk" ON "media_objects" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_original_uk" ON "media_objects" USING btree ("asset_id") WHERE "media_objects"."role" = 'original';--> statement-breakpoint
CREATE UNIQUE INDEX "media_objects_variant_uk" ON "media_objects" USING btree ("asset_id","variant_kind","processing_version") WHERE "media_objects"."role" = 'variant';--> statement-breakpoint
CREATE INDEX "media_objects_asset_idx" ON "media_objects" USING btree ("asset_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "media_obligations_sequence_uk" ON "media_obligations" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "media_obligations_asset_pending_uk" ON "media_obligations" USING btree ("asset_id","kind") WHERE "media_obligations"."state" = 'pending' and "media_obligations"."object_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "media_obligations_object_pending_uk" ON "media_obligations" USING btree ("object_id","kind") WHERE "media_obligations"."state" = 'pending' and "media_obligations"."object_id" is not null;--> statement-breakpoint
CREATE INDEX "media_obligations_claimable_idx" ON "media_obligations" USING btree ("kind","sequence") WHERE "media_obligations"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "media_obligations_asset_idx" ON "media_obligations" USING btree ("asset_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "media_upload_sessions_object_key_uk" ON "media_upload_sessions" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_upload_sessions_open_uk" ON "media_upload_sessions" USING btree ("asset_id") WHERE "media_upload_sessions"."state" = 'issued';--> statement-breakpoint
CREATE INDEX "media_upload_sessions_expiry_idx" ON "media_upload_sessions" USING btree ("expires_at","id") WHERE "media_upload_sessions"."state" = 'issued';--> statement-breakpoint
CREATE INDEX "media_upload_sessions_asset_idx" ON "media_upload_sessions" USING btree ("asset_id","created_at");
