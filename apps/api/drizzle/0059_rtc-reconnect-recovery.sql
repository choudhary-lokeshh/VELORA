ALTER TABLE "realtime_sessions" ADD COLUMN "state_entered_at" timestamp with time zone;--> statement-breakpoint
-- Backfill before the constraint, so this is safe against a table that already
-- holds calls. `updated_at` is the closest existing approximation of when a row
-- last moved, and every existing row is either terminal or was written by the
-- same statement that set it.
UPDATE "realtime_sessions" SET "state_entered_at" = "updated_at" WHERE "state_entered_at" IS NULL;--> statement-breakpoint
ALTER TABLE "realtime_sessions" ALTER COLUMN "state_entered_at" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "realtime_sessions_state_deadline_idx" ON "realtime_sessions" USING btree ("state_entered_at") WHERE "realtime_sessions"."state" in ('connecting', 'reconnecting');
