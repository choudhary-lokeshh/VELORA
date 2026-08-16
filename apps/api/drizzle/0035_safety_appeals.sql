-- TRUST & SAFETY appeals.
--
-- A complaint about a decision, from either of the two people one decision can
-- affect: a subject who was restricted, and a notifier whose report was
-- dismissed. Regulation (EU) 2022/2065 Article 20 covers complaints about
-- decisions taken *and* about decisions not to act on a notice, so a model with
-- only the first would have missed half of it. Whether that obligation binds
-- Velora is `LEGAL REVIEW REQUIRED` and is recorded in
-- `docs/compliance/07-surface-and-distribution-eligibility.md` rather than
-- answered here; the machinery is built because notice, reasons, a human
-- decision, and a bounded window are structure rather than copy.
--
-- An appeal never erases anything. Upholding one produces a *superseding*
-- decision that names the original, and the original stays byte-for-byte as
-- written -- it is the only evidence that the appeal was necessary.
--
-- The outcome carries the reviewer who reached it. Article 20 forbids a
-- complaint being decided solely by automated means, and a column only a named
-- human fills is how that stops being a promise: nothing in this domain is
-- automated, and no path writes that column without one.
--
-- The window comes from a published policy and is stored beside its version.
-- Production publishes none, so a complaint is accepted with no closing date at
-- all -- which is the safer half of the question to leave open. The six-month
-- figure the Article states is recorded as evidence about what a policy will
-- need to say rather than compiled in.
--
-- The case gains no `appealed` state. An appeal has its own lifecycle and its
-- own queue, and a second state that had to be kept in sync with it would be
-- two sources of truth for one fact.
CREATE TABLE "safety_appeals" (
	"appellant_kind" text NOT NULL,
	"appellant_reference" uuid NOT NULL,
	"appeal_policy_version" text,
	"case_id" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"outcome_decision_id" uuid,
	"policy_version" text NOT NULL,
	"reviewer_actor_reference" text,
	"statement" text,
	"state" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"window_closes_at" timestamp with time zone,
	CONSTRAINT "safety_appeals_state_check" CHECK ("safety_appeals"."state" in ('received', 'under_review', 'upheld', 'refused', 'withdrawn')),
	CONSTRAINT "safety_appeals_appellant_kind_check" CHECK ("safety_appeals"."appellant_kind" in ('subject', 'notifier')),
	CONSTRAINT "safety_appeals_outcome_shape_check" CHECK (("safety_appeals"."state" in ('upheld', 'refused')) = ("safety_appeals"."decided_at" is not null)
        and ("safety_appeals"."state" in ('upheld', 'refused')) = ("safety_appeals"."reviewer_actor_reference" is not null)),
	CONSTRAINT "safety_appeals_upheld_shape_check" CHECK (("safety_appeals"."state" = 'upheld') = ("safety_appeals"."outcome_decision_id" is not null)),
	CONSTRAINT "safety_appeals_window_shape_check" CHECK (("safety_appeals"."window_closes_at" is null) = ("safety_appeals"."appeal_policy_version" is null)),
	CONSTRAINT "safety_appeals_window_order_check" CHECK ("safety_appeals"."window_closes_at" is null or "safety_appeals"."window_closes_at" > "safety_appeals"."submitted_at"),
	CONSTRAINT "safety_appeals_statement_check" CHECK ("safety_appeals"."statement" is null or char_length("safety_appeals"."statement") between 1 and 2000),
	CONSTRAINT "safety_appeals_version_check" CHECK ("safety_appeals"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "safety_appeals" ADD CONSTRAINT "safety_appeals_case_id_safety_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."safety_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_appeals" ADD CONSTRAINT "safety_appeals_decision_id_safety_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."safety_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_appeals" ADD CONSTRAINT "safety_appeals_outcome_decision_id_safety_decisions_id_fk" FOREIGN KEY ("outcome_decision_id") REFERENCES "public"."safety_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_appeals_decision_idx" ON "safety_appeals" USING btree ("decision_id","submitted_at");--> statement-breakpoint
CREATE INDEX "safety_appeals_case_idx" ON "safety_appeals" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "safety_appeals_appellant_idx" ON "safety_appeals" USING btree ("appellant_reference","submitted_at");--> statement-breakpoint
CREATE INDEX "safety_appeals_open_idx" ON "safety_appeals" USING btree ("state","submitted_at","id") WHERE "safety_appeals"."state" in ('received', 'under_review');--> statement-breakpoint
CREATE UNIQUE INDEX "safety_appeals_live_uk" ON "safety_appeals" USING btree ("decision_id","appellant_reference") WHERE "safety_appeals"."state" <> 'withdrawn';
