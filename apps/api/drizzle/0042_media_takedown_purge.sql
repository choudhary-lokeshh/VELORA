-- Deletion, takedown, purge, and legal hold as four separate things.
--
-- They were four words in the domain document and one behaviour in the code.
-- This is where they stop being the same.
--
-- `legal_hold_at` records that an original is preserved as evidence. It is
-- independent of removal in both directions: holding an asset does not stop it
-- being taken down, and taking it down does not destroy what a case needs. An
-- asset under hold loses its derivatives, has its caches purged, and stops
-- being delivered like any other removed asset -- the original simply survives.
-- The shape check makes `deleted` under a hold unrepresentable, because
-- `deleted` means the provider no longer holds the original and under a hold it
-- does.
--
-- The purge columns record what a delivery layer actually said. `unsupported`
-- is a real outcome rather than a failure: a provider with no purge mechanism
-- has genuinely not purged, and recording that as success would be the platform
-- lying to its own operators about the exposure. A failure is not recorded as
-- an outcome at all -- the obligation stays owed and visible, which is what
-- makes a purge backlog something somebody can see.
--
-- Origin denial never waits for any of this. A held or removed asset stops
-- being authorised the moment any authority says so; a cache that has not yet
-- been told is a separate obligation, not a hole in the decision.
--
-- No retention duration is invented here. How long a hold lasts, and how long
-- a quarantined original or a deleted asset's evidence is kept, are
-- `LEGAL REVIEW REQUIRED` in docs/decisions/DECISIONS_REQUIRED.md, and nothing
-- in this schema expires on a timer.
ALTER TABLE "media_assets" ADD COLUMN "legal_hold_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "purge_outcome" text;--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "purge_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_hold_shape_check" CHECK ("media_assets"."lifecycle" <> 'deleted' or "media_assets"."legal_hold_at" is null);--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_purge_outcome_check" CHECK ("media_objects"."purge_outcome" is null or "media_objects"."purge_outcome" in ('purged', 'unsupported', 'failed'));--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_purge_shape_check" CHECK (("media_objects"."purge_outcome" is null) = ("media_objects"."purged_at" is null));--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_purge_requested_check" CHECK ("media_objects"."purged_at" is null or "media_objects"."purge_requested_at" is not null);
