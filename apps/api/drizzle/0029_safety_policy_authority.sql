-- TRUST & SAFETY policy and enforcement authority.
--
-- `safety_enforcements` could not answer "what is in force right now", because
-- direction was encoded inconsistently: `account_restriction` was written both
-- by a decision that restricted an account and by the review that restored one,
-- while creators got a second scope, `creator_reinstatement`, to say the same
-- thing. Two rows with the same scope meant opposite things, so the only reader
-- that could tell them apart was the domain that had applied the change.
--
-- This migration makes direction an orthogonal value, adds an expiry for
-- time-bounded restrictions, and links a reversal to exactly the record it
-- replaces. The table stays append-only: a lift is still a new row.
--
-- The backfill is deterministic because the old vocabulary did carry the
-- information, just not in one place. Before this migration only two code paths
-- wrote `account_restriction`: a moderation decision, which always named the
-- report it came from, and an account restoration, which never did. Creator
-- reversals named themselves. Anything the backfill cannot pair is refused
-- rather than guessed, because a mislabelled safety record is worse than a
-- migration that stops.
ALTER TABLE "safety_enforcements" DROP CONSTRAINT "safety_enforcements_scope_check";--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD COLUMN "disposition" text;--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint

-- Everything restricts until something below proves otherwise.
UPDATE "safety_enforcements" SET "disposition" = 'restrict' WHERE "disposition" IS NULL;--> statement-breakpoint

-- Account restorations: the rows with no report behind them. Paired with the
-- restrictions they reversed in the order both were made, which is the order an
-- operator could have made them in — a restriction has to precede its reversal.
WITH "restrictions" AS (
  SELECT "id", "subject_id",
         row_number() OVER (PARTITION BY "subject_id" ORDER BY "effective_at", "id") AS "rank"
  FROM "safety_enforcements"
  WHERE "scope" = 'account_restriction' AND "report_id" IS NOT NULL
), "restorations" AS (
  SELECT "id", "subject_id",
         row_number() OVER (PARTITION BY "subject_id" ORDER BY "effective_at", "id") AS "rank"
  FROM "safety_enforcements"
  WHERE "scope" = 'account_restriction' AND "report_id" IS NULL
)
UPDATE "safety_enforcements" AS "target"
SET "disposition" = 'lift', "supersedes_id" = "restriction"."id"
FROM "restorations" AS "restoration"
JOIN "restrictions" AS "restriction"
  ON "restriction"."subject_id" = "restoration"."subject_id"
 AND "restriction"."rank" = "restoration"."rank"
WHERE "target"."id" = "restoration"."id";--> statement-breakpoint

-- Creator reinstatements stop being their own scope and become what they always
-- were: a lift of the suspension they followed.
WITH "suspensions" AS (
  SELECT "id", "subject_id",
         row_number() OVER (PARTITION BY "subject_id" ORDER BY "effective_at", "id") AS "rank"
  FROM "safety_enforcements"
  WHERE "scope" = 'creator_suspension'
), "reinstatements" AS (
  SELECT "id", "subject_id",
         row_number() OVER (PARTITION BY "subject_id" ORDER BY "effective_at", "id") AS "rank"
  FROM "safety_enforcements"
  WHERE "scope" = 'creator_reinstatement'
)
UPDATE "safety_enforcements" AS "target"
SET "scope" = 'creator_suspension',
    "disposition" = 'lift',
    "supersedes_id" = "suspension"."id"
FROM "reinstatements" AS "reinstatement"
JOIN "suspensions" AS "suspension"
  ON "suspension"."subject_id" = "reinstatement"."subject_id"
 AND "suspension"."rank" = "reinstatement"."rank"
WHERE "target"."id" = "reinstatement"."id";--> statement-breakpoint

-- Refuse rather than guess. A reversal the backfill could not pair with a
-- restriction is a record whose meaning the old vocabulary cannot express, and
-- inventing one would put a safety decision in the log that nobody made.
DO $$
DECLARE "unpaired" integer;
BEGIN
  SELECT count(*) INTO "unpaired"
  FROM "safety_enforcements"
  WHERE "scope" = 'creator_reinstatement'
     OR "disposition" IS NULL
     OR ("disposition" = 'lift' AND "supersedes_id" IS NULL);
  IF "unpaired" > 0 THEN
    RAISE EXCEPTION USING MESSAGE = format(
      'safety_enforcements: %s row(s) record a reversal with no restriction to supersede. The pre-0029 vocabulary cannot express which record they reversed, so they must be resolved by hand before this migration can be applied.',
      "unpaired"
    );
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "safety_enforcements" ALTER COLUMN "disposition" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_supersedes_id_safety_enforcements_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."safety_enforcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_enforcements_live_idx" ON "safety_enforcements" USING btree ("subject_id","scope","effective_at");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_enforcements_supersedes_uk" ON "safety_enforcements" USING btree ("supersedes_id") WHERE "safety_enforcements"."supersedes_id" is not null;--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_disposition_check" CHECK ("safety_enforcements"."disposition" in ('restrict', 'lift'));--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_lift_shape_check" CHECK ("safety_enforcements"."disposition" = 'restrict' or "safety_enforcements"."supersedes_id" is not null);--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_supersedes_self_check" CHECK ("safety_enforcements"."supersedes_id" is null or "safety_enforcements"."supersedes_id" <> "safety_enforcements"."id");--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_expiry_check" CHECK ("safety_enforcements"."expires_at" is null or "safety_enforcements"."expires_at" > "safety_enforcements"."effective_at");--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_lift_expiry_check" CHECK ("safety_enforcements"."disposition" = 'restrict' or "safety_enforcements"."expires_at" is null);--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_scope_check" CHECK ("safety_enforcements"."scope" in ('account_restriction', 'conversation_closure', 'creator_suspension', 'creator_object_removal', 'club_membership_revocation'));
