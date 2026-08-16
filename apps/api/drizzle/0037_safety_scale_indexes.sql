-- TRUST & SAFETY: making the reads that grow index-driven.
--
-- Every one of these was found by measuring rather than by reading the code,
-- and each fixes a read that was correct and would have become an outage.
--
-- The **operator queue with no filter** is the default view, and
-- `safety_cases_queue_idx` leads with the queue, so it could not serve one: the
-- read fell back to scanning every case ever opened and sorting it. A partial
-- index on the open rows, ordered exactly as the cursor pages them, turns that
-- into a walk that stops.
--
-- The **open report queue** spans two states, so an index leading with `state`
-- means a merge and a sort. Partial on the open states, ordered by the read's
-- own order, is one walk.
--
-- A person's **own blocks** page by creation instant, and the live-pair unique
-- index leads with the blocked account -- it answers "is this pair blocked" and
-- can supply no order at all.
--
-- Three lists page on a **tiebreaker the index did not carry**: decisions about
-- a subject, complaints by an appellant, and reports by their reporter all
-- order by an instant and then by identifier, so the identifier belongs in the
-- index or the sort comes back at the page boundary.
--
-- The **overdue takedown queue** now excludes claims whose breach is already
-- recorded. Without that in the predicate the index accumulates every breach
-- ever recorded and the sweep filters them out again on every cycle, for ever.
--
-- Nothing here changes what any query answers.
DROP INDEX "safety_appeals_appellant_idx";--> statement-breakpoint
DROP INDEX "safety_decisions_subject_idx";--> statement-breakpoint
DROP INDEX "safety_reports_reporter_idx";--> statement-breakpoint
DROP INDEX "safety_takedown_claims_due_idx";--> statement-breakpoint
CREATE INDEX "safety_blocks_live_idx" ON "safety_blocks" USING btree ("blocker_id","created_at","id") WHERE "safety_blocks"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "safety_cases_open_idx" ON "safety_cases" USING btree ("opened_at","id") WHERE "safety_cases"."state" not in ('decided', 'closed');--> statement-breakpoint
CREATE INDEX "safety_reports_open_idx" ON "safety_reports" USING btree ("created_at","id") WHERE "safety_reports"."state" in ('received', 'under_review');--> statement-breakpoint
CREATE INDEX "safety_appeals_appellant_idx" ON "safety_appeals" USING btree ("appellant_reference","submitted_at","id");--> statement-breakpoint
CREATE INDEX "safety_decisions_subject_idx" ON "safety_decisions" USING btree ("subject_id","decided_at","id");--> statement-breakpoint
CREATE INDEX "safety_reports_reporter_idx" ON "safety_reports" USING btree ("reporter_id","created_at","id");--> statement-breakpoint
CREATE INDEX "safety_takedown_claims_due_idx" ON "safety_takedown_claims" USING btree ("action_due_at","id") WHERE "safety_takedown_claims"."action_due_at" is not null and "safety_takedown_claims"."breach_recorded_at" is null;
