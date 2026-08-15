-- TRUST & SAFETY case management.
--
-- A report becomes evidence in a case rather than a queue entry of its own.
-- Several reports about one target share one case, so a duplicate is reviewed
-- once without any of them being discarded, and "how many people complained"
-- stops being a number the workflow can act on: there is no reporter column and
-- no count column on `safety_cases` at all.
--
-- Reports also gain a target type, because a report could previously only be
-- about a consumer account. Every existing row is exactly that, so the backfill
-- is a fact rather than a guess.
--
-- The source surface is deliberately nullable. The old API accepted reports
-- from both consumer surfaces and kept nothing that distinguishes them, so an
-- absent value means "filed before Velora recorded a surface" -- which is true
-- -- rather than a surface nobody observed.
CREATE TABLE "safety_cases" (
	"assigned_actor_reference" text,
	"assigned_at" timestamp with time zone,
	"assignment_expires_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	"priority" text NOT NULL,
	"queue" text NOT NULL,
	"state" text NOT NULL,
	"target_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "safety_cases_state_check" CHECK ("safety_cases"."state" in ('new', 'triaged', 'investigating', 'closed')),
	CONSTRAINT "safety_cases_priority_check" CHECK ("safety_cases"."priority" in ('untriaged', 'low', 'normal', 'high', 'urgent')),
	CONSTRAINT "safety_cases_queue_check" CHECK ("safety_cases"."queue" in ('consumer_conduct', 'creator_content', 'creator_identity')),
	CONSTRAINT "safety_cases_target_type_check" CHECK ("safety_cases"."target_type" in ('consumer_account', 'creator_profile', 'creator_content', 'club', 'conversation')),
	CONSTRAINT "safety_cases_closed_shape_check" CHECK (("safety_cases"."state" = 'closed') = ("safety_cases"."closed_at" is not null)),
	CONSTRAINT "safety_cases_assignment_shape_check" CHECK (("safety_cases"."assigned_actor_reference" is null) = ("safety_cases"."assigned_at" is null)
        and ("safety_cases"."assigned_actor_reference" is null) = ("safety_cases"."assignment_expires_at" is null)),
	CONSTRAINT "safety_cases_assignment_expiry_check" CHECK ("safety_cases"."assignment_expires_at" is null or "safety_cases"."assignment_expires_at" > "safety_cases"."assigned_at"),
	CONSTRAINT "safety_cases_version_check" CHECK ("safety_cases"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "safety_reports" DROP CONSTRAINT "safety_reports_not_self_check";--> statement-breakpoint
DROP INDEX "safety_reports_subject_idx";--> statement-breakpoint
ALTER TABLE "safety_reports" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "safety_reports" ADD COLUMN "source_surface" text;--> statement-breakpoint
ALTER TABLE "safety_reports" ADD COLUMN "target_type" text;--> statement-breakpoint
-- Every report written before this migration was about a consumer account:
-- it was the only thing the contract could name.
UPDATE "safety_reports" SET "target_type" = 'consumer_account' WHERE "target_type" IS NULL;--> statement-breakpoint

-- One case per target that still has an unresolved report, so the queue a
-- reviewer opens after this migration contains the work that was already
-- waiting. Reports already actioned or dismissed get none: they were decided
-- under the previous model and inventing a case for them would fabricate a
-- review that never happened.
INSERT INTO "safety_cases" (
  "id", "opened_at", "policy_version", "priority", "queue", "state",
  "target_id", "target_type", "updated_at"
)
SELECT gen_random_uuid(), min("created_at"), 'v1-provisional', 'untriaged',
       'consumer_conduct', 'new', "subject_id", 'consumer_account', now()
FROM "safety_reports"
WHERE "state" IN ('received', 'under_review')
GROUP BY "subject_id";--> statement-breakpoint

UPDATE "safety_reports" AS "report"
SET "case_id" = "opened"."id"
FROM "safety_cases" AS "opened"
WHERE "opened"."target_type" = 'consumer_account'
  AND "opened"."target_id" = "report"."subject_id"
  AND "report"."state" IN ('received', 'under_review');--> statement-breakpoint

ALTER TABLE "safety_reports" ALTER COLUMN "target_type" SET NOT NULL;--> statement-breakpoint

CREATE UNIQUE INDEX "safety_cases_open_target_uk" ON "safety_cases" USING btree ("target_type","target_id") WHERE "safety_cases"."state" <> 'closed';--> statement-breakpoint
CREATE INDEX "safety_cases_queue_idx" ON "safety_cases" USING btree ("queue","state","opened_at","id");--> statement-breakpoint
CREATE INDEX "safety_cases_assignment_idx" ON "safety_cases" USING btree ("assignment_expires_at") WHERE "safety_cases"."assignment_expires_at" is not null;--> statement-breakpoint
CREATE INDEX "safety_cases_target_idx" ON "safety_cases" USING btree ("target_type","target_id");--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_case_id_safety_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."safety_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_reports_case_idx" ON "safety_reports" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "safety_reports_subject_idx" ON "safety_reports" USING btree ("target_type","subject_id");--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_target_type_check" CHECK ("safety_reports"."target_type" in ('consumer_account', 'creator_profile', 'creator_content', 'club', 'conversation'));--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_source_surface_check" CHECK ("safety_reports"."source_surface" is null or "safety_reports"."source_surface" in ('consumer_web', 'consumer_mobile', 'creator_studio'));--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_not_self_check" CHECK ("safety_reports"."target_type" <> 'consumer_account' or "safety_reports"."reporter_id" <> "safety_reports"."subject_id");
