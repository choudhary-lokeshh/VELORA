-- Post-encounter safety.
--
-- Two indexes so "who did I just finish meeting" is an index range rather than
-- a scan of everybody this person has ever met, keyed on when the encounter
-- *ended* because that is what "just met" means to somebody reaching for a
-- report, and partial on the finished state so a live encounter never enters
-- the plan. Two of them because the pair is stored ordered and a caller is on
-- whichever side of it they happen to be.
--
-- Two more reporter reasons. `hate_or_abuse` and `threats_or_violence` were
-- both being filed as `harassment`, which describes the wrong thing about the
-- two allegations where describing it correctly matters most.
--
-- The `users_matching_declarations` constraint is dropped and re-added with
-- byte-identical SQL. It is a no-op against the database and repairs a
-- serialization drift in the 0075 snapshot, which recorded the enum members
-- unquoted while every migration that ever wrote them quoted them. Left in
-- rather than hand-removed, so the committed SQL is exactly the diff the
-- committed snapshot describes.
ALTER TABLE "safety_reports" DROP CONSTRAINT "safety_reports_reason_check";--> statement-breakpoint
ALTER TABLE "users_matching_declarations" DROP CONSTRAINT "users_matching_declarations_gender_check";--> statement-breakpoint
CREATE INDEX "live_encounters_low_ended_idx" ON "live_encounters" USING btree ("pair_low_id","ended_at") WHERE "live_encounters"."state" = 'ended';--> statement-breakpoint
CREATE INDEX "live_encounters_high_ended_idx" ON "live_encounters" USING btree ("pair_high_id","ended_at") WHERE "live_encounters"."state" = 'ended';--> statement-breakpoint
ALTER TABLE "safety_reports" ADD CONSTRAINT "safety_reports_reason_check" CHECK ("safety_reports"."reason_code" in ('underage_concern', 'harassment', 'hate_or_abuse', 'threats_or_violence', 'sexual_content_violation', 'impersonation', 'spam_or_scam', 'other'));--> statement-breakpoint
ALTER TABLE "users_matching_declarations" ADD CONSTRAINT "users_matching_declarations_gender_check" CHECK ("users_matching_declarations"."matching_gender" in ('woman', 'man', 'non_binary', 'undisclosed'));
