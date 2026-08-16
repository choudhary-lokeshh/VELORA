-- Where the record and the provider stopped agreeing, and what was done about
-- it.
--
-- Every other part of this domain writes the record and the bytes in a fixed
-- order so that a crash leaves a recoverable shape rather than an invisible
-- one. Until now nothing went and looked. These three changes are what looking
-- costs.
--
-- `media_objects.verified_at` is the rolling audit's cursor: least recently
-- checked first, bounded per cycle, and advanced by the claiming statement so
-- the walk moves on whatever the provider says. It is NOT NULL and backfilled
-- from `created_at` deliberately. At the moment an object row is written the
-- platform has either just observed the object at the provider or is about to
-- write it itself, so "never audited" and "audited when it was created" are the
-- same claim -- and making them the same removes a null from the ordering the
-- audit walks, which is the difference between an index scan and a sort of the
-- whole table.
--
-- `media_upload_sessions.reconciled_at` marks closed windows that have been
-- checked for orphaned bytes. A closed window is the one place bytes can exist
-- that no object record claims: a capability honoured late, or a client that
-- finished uploading and never told the platform. Its partial index holds only
-- the windows still owing a look, so it empties as the work is done rather than
-- growing with the table.
--
-- `media_drift_findings` records the disagreements themselves. It is not a
-- duplicate of `media_obligations`: an obligation is work the platform owes, a
-- finding is a fact about a disagreement -- including the disagreements no
-- automatic correction is safe for. Folding the two together would mean the
-- only drift ever written down was the drift something already knew how to fix,
-- which is exactly backwards. An original the provider has lost cannot be
-- conjured by anybody, and that is precisely the finding an operator has to
-- hear about.
--
-- A finding is outstanding until it is resolved, and resolving it says which of
-- three things happened: the platform repaired it, the platform owed the
-- ordinary pipeline the duty that will, or it had already gone by the time
-- anybody looked. Nothing closes a finding merely because it was examined. The
-- two partial unique indexes give one outstanding finding of a kind per
-- subject, and there are two of them for the same reason `media_obligations`
-- has two: a unique index treats nulls as distinct, so one index over a
-- nullable key would admit exactly the duplicates that matter.
--
-- Rows are retained. "This asset's derivative went missing twice last month" is
-- an answer somebody will need, and a table that tidied itself could not give
-- it.
CREATE TABLE "media_drift_findings" (
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"object_id" uuid,
	"object_key" text,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"resolution" text,
	"resolved_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_drift_findings_kind_check" CHECK ("media_drift_findings"."kind" in ('orphaned_object', 'original_missing', 'variant_missing', 'original_size_mismatch', 'variant_size_mismatch', 'undeleted_object', 'stalled_lifecycle', 'stale_purge')),
	CONSTRAINT "media_drift_findings_resolution_check" CHECK ("media_drift_findings"."resolution" is null or "media_drift_findings"."resolution" in ('repaired', 'owed', 'no_longer_present')),
	CONSTRAINT "media_drift_findings_resolution_shape_check" CHECK (("media_drift_findings"."resolution" is null) = ("media_drift_findings"."resolved_at" is null)),
	CONSTRAINT "media_drift_findings_object_shape_check" CHECK ("media_drift_findings"."object_id" is null or "media_drift_findings"."object_key" is not null),
	CONSTRAINT "media_drift_findings_occurrences_check" CHECK ("media_drift_findings"."occurrences" >= 1)
);
--> statement-breakpoint
-- Added nullable, backfilled, and only then made NOT NULL. A single NOT NULL
-- addition without a default is refused outright on a table that already holds
-- rows, and giving it a default would have written an instant that describes
-- when the migration ran rather than when the object was last known good.
ALTER TABLE "media_objects" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "media_objects" SET "verified_at" = "created_at" WHERE "verified_at" IS NULL;--> statement-breakpoint
ALTER TABLE "media_objects" ALTER COLUMN "verified_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_drift_findings" ADD CONSTRAINT "media_drift_findings_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_drift_findings" ADD CONSTRAINT "media_drift_findings_object_id_media_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_drift_findings_asset_open_uk" ON "media_drift_findings" USING btree ("asset_id","kind") WHERE "media_drift_findings"."resolved_at" is null and "media_drift_findings"."object_key" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "media_drift_findings_object_open_uk" ON "media_drift_findings" USING btree ("object_key","kind") WHERE "media_drift_findings"."resolved_at" is null and "media_drift_findings"."object_key" is not null;--> statement-breakpoint
CREATE INDEX "media_drift_findings_open_idx" ON "media_drift_findings" USING btree ("created_at","id") WHERE "media_drift_findings"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "media_drift_findings_asset_idx" ON "media_drift_findings" USING btree ("asset_id","kind");--> statement-breakpoint
CREATE INDEX "media_objects_verification_idx" ON "media_objects" USING btree ("verified_at","id");--> statement-breakpoint
CREATE INDEX "media_objects_purge_pending_idx" ON "media_objects" USING btree ("purge_requested_at","id") WHERE "media_objects"."purge_requested_at" is not null and "media_objects"."purge_outcome" is null;--> statement-breakpoint
CREATE INDEX "media_upload_sessions_unreconciled_idx" ON "media_upload_sessions" USING btree ("created_at","id") WHERE "media_upload_sessions"."state" in ('abandoned', 'expired') and "media_upload_sessions"."reconciled_at" is null;
