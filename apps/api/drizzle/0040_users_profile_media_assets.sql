-- USERS profile media: keeping the association, giving up the bytes.
--
-- This table carried two domains' answers. Which asset occupies which slot is
-- USERS' business; what the bytes are, whether they decoded, and where the
-- provider keeps them are MEDIA's. Holding both here meant one fact recorded
-- twice, and the copy that goes stale is the one somebody is watching a
-- spinner against.
--
-- What leaves: the object key, the digest, the measured byte size, the sniffed
-- content type, the upload expiry, and the refusal reason. What arrives: an
-- opaque `media_asset_id` with no foreign key, on the ownership rule every
-- other cross-domain reference already follows.
--
-- `state` narrows from four values to two. `pending_upload`, `ready`, and
-- `rejected` were never this domain's answers -- they described what the
-- platform had worked out about some bytes. What a client is shown is now
-- derived from MEDIA's readiness contract at read time, so it cannot drift.
--
-- `media_ready` is a **cached projection** of that contract, and it exists for
-- one reason: discovery's candidate query must stay a single indexed read
-- rather than a per-candidate call into another domain. It defaults to false
-- and is only ever set true by MEDIA saying so, so a stale value delays
-- somebody's discoverability rather than exposing an image. Delivery never
-- reads it -- every issuance re-derives readiness, safety, and entitlement --
-- so a stale value cannot cause a byte to be served.
--
-- **Existing rows are deleted, deliberately and not silently.** A row here
-- points at an object key in the profile-media adapter this migration retires,
-- and there is no value to backfill `media_asset_id` with: the asset it would
-- name was never created. No deployed environment can hold such a row --
-- `USERS_PROFILE_MEDIA_STORAGE` has refused every upload in staging and
-- production since the column existed, and no deployment environment has been
-- provisioned at all -- so the only rows this can reach are in a developer's
-- local database, pointing at bytes in a process that exited long ago. Doing
-- it explicitly makes the migration deterministic everywhere instead of one
-- that passes CI and fails on somebody's laptop.
DELETE FROM "users_profile_media";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP CONSTRAINT "users_profile_media_content_type_check";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP CONSTRAINT "users_profile_media_byte_size_check";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP CONSTRAINT "users_profile_media_checksum_check";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP CONSTRAINT "users_profile_media_ready_shape_check";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP CONSTRAINT "users_profile_media_rejection_shape_check";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP CONSTRAINT "users_profile_media_rejection_reason_check";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP CONSTRAINT "users_profile_media_state_check";--> statement-breakpoint
DROP INDEX "users_profile_media_storage_key_uk";--> statement-breakpoint
ALTER TABLE "users_profile_media" ADD COLUMN "media_asset_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "users_profile_media" ADD COLUMN "media_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users_profile_media" ADD COLUMN "readiness_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_profile_media_asset_uk" ON "users_profile_media" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "users_profile_media_readiness_idx" ON "users_profile_media" USING btree ("readiness_checked_at","id") WHERE "users_profile_media"."state" = 'attached';--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP COLUMN "byte_size";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP COLUMN "checksum";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP COLUMN "content_type";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP COLUMN "ready_at";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP COLUMN "rejection_reason";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP COLUMN "storage_key";--> statement-breakpoint
ALTER TABLE "users_profile_media" DROP COLUMN "upload_expires_at";--> statement-breakpoint
ALTER TABLE "users_profile_media" ADD CONSTRAINT "users_profile_media_state_check" CHECK ("users_profile_media"."state" in ('attached', 'removed'));
