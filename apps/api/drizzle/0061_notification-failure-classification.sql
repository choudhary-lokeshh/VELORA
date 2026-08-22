ALTER TABLE "notifications_attempts" DROP CONSTRAINT "notifications_attempts_failed_shape_check";--> statement-breakpoint
ALTER TABLE "notifications_attempts" ADD COLUMN "failure_class" text;--> statement-breakpoint
-- Attempts recorded before this vocabulary existed. They are given the
-- legacy class rather than a real one, because nobody classified them and
-- inventing a cause would be fabricating evidence. No adapter produces
-- 'unclassified', and a test asserts that. Without this the shape check
-- below cannot be added to a table that already holds a failed attempt.
UPDATE "notifications_attempts" SET "failure_class" = 'unclassified' WHERE "outcome" = 'failed' AND "failure_class" IS NULL;--> statement-breakpoint
ALTER TABLE "notifications_attempts" ADD CONSTRAINT "notifications_attempts_failure_class_check" CHECK ("notifications_attempts"."failure_class" is null or "notifications_attempts"."failure_class" in ('transport', 'throttled', 'soft_bounce', 'hard_bounce', 'invalid_token', 'policy_refused', 'destination_suppressed', 'unclassified'));--> statement-breakpoint
ALTER TABLE "notifications_attempts" ADD CONSTRAINT "notifications_attempts_class_scope_check" CHECK ("notifications_attempts"."outcome" = 'failed' or "notifications_attempts"."failure_class" is null);--> statement-breakpoint
ALTER TABLE "notifications_attempts" ADD CONSTRAINT "notifications_attempts_failed_shape_check" CHECK ("notifications_attempts"."outcome" <> 'failed' or ("notifications_attempts"."failure_reason" is not null and "notifications_attempts"."failure_class" is not null));
