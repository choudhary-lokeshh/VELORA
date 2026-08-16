-- TRUST & SAFETY moderation evidence and decisions.
--
-- A case could be worked but not explained. `safety_cases` records that a
-- review happened; nothing recorded what the reviewer looked at, what they
-- decided, or what changed as a result, so the only account of a consequential
-- decision was the enforcement row it happened to produce -- which says what is
-- in force and nothing about why.
--
-- Two append-only tables close that. Evidence is a reference or a minimal
-- snapshot, never a copy of another domain's record: the report keeps its
-- narrative, MESSAGING keeps its message bodies, and this table keeps an
-- identifier and, where a snapshot is the point, a bounded state label that
-- cannot hold a sentence. Exactly one evidence kind carries prose, and it is
-- the one that requires an author.
--
-- A decision names its case, its actor, its scope, its action from a closed
-- vocabulary, the policy version, what it cited, what stood before, and what
-- stands after. Corrections are superseding decisions rather than edits, and a
-- trigger refuses every update and delete on all three tables -- and on
-- `safety_enforcements`, which was documented as append-only and until now was
-- only append-only by convention.
--
-- Cases gain `decided`. A decided case and a closed one are both out of the
-- queue and are not the same fact: one was judged and one was dropped, and a
-- schema that could not tell them apart would make "was this reviewed" a
-- question nothing could answer.
ALTER TABLE "safety_cases" DROP CONSTRAINT "safety_cases_state_check";--> statement-breakpoint
ALTER TABLE "safety_cases" DROP CONSTRAINT "safety_cases_closed_shape_check";--> statement-breakpoint
DROP INDEX "safety_cases_open_target_uk";--> statement-breakpoint
ALTER TABLE "safety_cases" ADD CONSTRAINT "safety_cases_state_check" CHECK ("safety_cases"."state" in ('new', 'triaged', 'investigating', 'decided', 'closed'));--> statement-breakpoint
ALTER TABLE "safety_cases" ADD CONSTRAINT "safety_cases_closed_shape_check" CHECK (("safety_cases"."state" in ('decided', 'closed')) = ("safety_cases"."closed_at" is not null));--> statement-breakpoint
CREATE UNIQUE INDEX "safety_cases_open_target_uk" ON "safety_cases" USING btree ("target_type","target_id") WHERE "safety_cases"."state" not in ('decided', 'closed');--> statement-breakpoint

CREATE TABLE "safety_evidence" (
	"actor_reference" text,
	"case_id" uuid NOT NULL,
	"external_reference" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"observed_at" timestamp with time zone,
	"policy_version" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"reference_id" uuid,
	"reference_type" text,
	"state_label" text,
	CONSTRAINT "safety_evidence_kind_check" CHECK ("safety_evidence"."kind" in ('report', 'message_reference', 'creator_content_reference', 'club_reference', 'creator_profile_state', 'consent_evidence_reference', 'external_verification_reference', 'operator_note', 'system_fact')),
	CONSTRAINT "safety_evidence_reference_type_check" CHECK ("safety_evidence"."reference_type" is null or "safety_evidence"."reference_type" in ('safety_report', 'message', 'creator_profile', 'creator_content', 'club', 'consent_record')),
	CONSTRAINT "safety_evidence_reference_pairing_check" CHECK (("safety_evidence"."reference_id" is null) = ("safety_evidence"."reference_type" is null)),
	CONSTRAINT "safety_evidence_reference_shape_check" CHECK (("safety_evidence"."kind" in ('club_reference', 'consent_evidence_reference', 'creator_content_reference', 'creator_profile_state', 'message_reference', 'report')) = ("safety_evidence"."reference_id" is not null)),
	CONSTRAINT "safety_evidence_snapshot_shape_check" CHECK (("safety_evidence"."state_label" is null) = ("safety_evidence"."observed_at" is null)),
	CONSTRAINT "safety_evidence_snapshot_kind_check" CHECK ("safety_evidence"."state_label" is null or "safety_evidence"."kind" in ('creator_profile_state', 'system_fact')),
	CONSTRAINT "safety_evidence_state_label_check" CHECK ("safety_evidence"."state_label" is null or "safety_evidence"."state_label" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "safety_evidence_note_shape_check" CHECK (("safety_evidence"."kind" = 'operator_note') = ("safety_evidence"."note" is not null)),
	CONSTRAINT "safety_evidence_note_length_check" CHECK ("safety_evidence"."note" is null or char_length("safety_evidence"."note") between 1 and 2000),
	CONSTRAINT "safety_evidence_note_actor_check" CHECK ("safety_evidence"."kind" <> 'operator_note' or "safety_evidence"."actor_reference" is not null),
	CONSTRAINT "safety_evidence_external_shape_check" CHECK (("safety_evidence"."kind" = 'external_verification_reference') = ("safety_evidence"."external_reference" is not null)),
	CONSTRAINT "safety_evidence_external_reference_check" CHECK ("safety_evidence"."external_reference" is null or "safety_evidence"."external_reference" ~ '^[A-Za-z0-9._:-]{1,200}$')
);
--> statement-breakpoint
CREATE TABLE "safety_decisions" (
	"action" text NOT NULL,
	"actor_reference" text NOT NULL,
	"case_id" uuid NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"enforcement_id" uuid,
	"expires_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"policy_version" text NOT NULL,
	"prior_state" text,
	"reason_code" text NOT NULL,
	"resulting_state" text,
	"scope" text,
	"subject_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"target_type" text NOT NULL,
	CONSTRAINT "safety_decisions_action_check" CHECK ("safety_decisions"."action" in ('no_action', 'temporary_hold', 'unpublish', 'restrict_capability', 'revoke_restriction', 'escalate')),
	CONSTRAINT "safety_decisions_reason_check" CHECK ("safety_decisions"."reason_code" in ('underage_risk', 'harassment', 'sexual_content_violation', 'impersonation', 'spam_or_scam', 'platform_integrity', 'no_violation_found', 'insufficient_evidence', 'requires_specialist_review')),
	CONSTRAINT "safety_decisions_enforcing_reason_check" CHECK ("safety_decisions"."action" not in ('restrict_capability', 'revoke_restriction', 'temporary_hold', 'unpublish')
        or "safety_decisions"."reason_code" in ('underage_risk', 'harassment', 'sexual_content_violation', 'impersonation', 'spam_or_scam', 'platform_integrity')),
	CONSTRAINT "safety_decisions_target_type_check" CHECK ("safety_decisions"."target_type" in ('consumer_account', 'creator_profile', 'creator_content', 'club', 'conversation')),
	CONSTRAINT "safety_decisions_scope_check" CHECK ("safety_decisions"."scope" is null or "safety_decisions"."scope" in ('account_restriction', 'conversation_closure', 'creator_suspension', 'creator_object_removal', 'club_membership_revocation')),
	CONSTRAINT "safety_decisions_enforcing_shape_check" CHECK (("safety_decisions"."action" in ('restrict_capability', 'revoke_restriction', 'temporary_hold', 'unpublish')) = ("safety_decisions"."scope" is not null)
        and ("safety_decisions"."action" in ('restrict_capability', 'revoke_restriction', 'temporary_hold', 'unpublish')) = ("safety_decisions"."enforcement_id" is not null)
        and ("safety_decisions"."action" in ('restrict_capability', 'revoke_restriction', 'temporary_hold', 'unpublish')) = ("safety_decisions"."prior_state" is not null)),
	CONSTRAINT "safety_decisions_state_pairing_check" CHECK (("safety_decisions"."prior_state" is null) = ("safety_decisions"."resulting_state" is null)),
	CONSTRAINT "safety_decisions_state_vocabulary_check" CHECK (("safety_decisions"."prior_state" is null or "safety_decisions"."prior_state" in ('unrestricted', 'restricted'))
        and ("safety_decisions"."resulting_state" is null or "safety_decisions"."resulting_state" in ('unrestricted', 'restricted'))),
	CONSTRAINT "safety_decisions_hold_shape_check" CHECK (("safety_decisions"."action" = 'temporary_hold') = ("safety_decisions"."expires_at" is not null)),
	CONSTRAINT "safety_decisions_hold_expiry_check" CHECK ("safety_decisions"."expires_at" is null or "safety_decisions"."expires_at" > "safety_decisions"."decided_at"),
	CONSTRAINT "safety_decisions_supersedes_self_check" CHECK ("safety_decisions"."supersedes_id" is null or "safety_decisions"."supersedes_id" <> "safety_decisions"."id")
);
--> statement-breakpoint
CREATE TABLE "safety_decision_evidence" (
	"case_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safety_decision_evidence_decision_id_evidence_id_pk" PRIMARY KEY("decision_id","evidence_id")
);
--> statement-breakpoint
ALTER TABLE "safety_evidence" ADD CONSTRAINT "safety_evidence_case_id_safety_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."safety_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_decisions" ADD CONSTRAINT "safety_decisions_case_id_safety_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."safety_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_decisions" ADD CONSTRAINT "safety_decisions_enforcement_id_safety_enforcements_id_fk" FOREIGN KEY ("enforcement_id") REFERENCES "public"."safety_enforcements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_decisions" ADD CONSTRAINT "safety_decisions_supersedes_id_safety_decisions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."safety_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_evidence_case_idx" ON "safety_evidence" USING btree ("case_id","recorded_at","id");--> statement-breakpoint
-- The target of the composite foreign key below. Both sides of a citation
-- carry the case, so a decision citing evidence from another case is refused by
-- PostgreSQL rather than by whichever caller remembered to check.
CREATE UNIQUE INDEX "safety_evidence_case_identity_uk" ON "safety_evidence" USING btree ("id","case_id");--> statement-breakpoint
CREATE INDEX "safety_evidence_reference_idx" ON "safety_evidence" USING btree ("reference_type","reference_id") WHERE "safety_evidence"."reference_id" is not null;--> statement-breakpoint
CREATE INDEX "safety_decisions_case_idx" ON "safety_decisions" USING btree ("case_id","decided_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_decisions_case_identity_uk" ON "safety_decisions" USING btree ("id","case_id");--> statement-breakpoint
CREATE INDEX "safety_decisions_subject_idx" ON "safety_decisions" USING btree ("subject_id","decided_at");--> statement-breakpoint
CREATE INDEX "safety_decisions_enforcement_idx" ON "safety_decisions" USING btree ("enforcement_id") WHERE "safety_decisions"."enforcement_id" is not null;--> statement-breakpoint
-- One settlement per case, and one correction per correction. Together these
-- are what make "exactly one final decision" a fact the database keeps rather
-- than a race two reviewers can both believe they won.
CREATE UNIQUE INDEX "safety_decisions_case_resolution_uk" ON "safety_decisions" USING btree ("case_id") WHERE "safety_decisions"."action" in ('no_action', 'restrict_capability', 'revoke_restriction', 'temporary_hold', 'unpublish') and "safety_decisions"."supersedes_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_decisions_supersedes_uk" ON "safety_decisions" USING btree ("supersedes_id") WHERE "safety_decisions"."supersedes_id" is not null;--> statement-breakpoint
ALTER TABLE "safety_decision_evidence" ADD CONSTRAINT "safety_decision_evidence_decision_fk" FOREIGN KEY ("decision_id","case_id") REFERENCES "public"."safety_decisions"("id","case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_decision_evidence" ADD CONSTRAINT "safety_decision_evidence_evidence_fk" FOREIGN KEY ("evidence_id","case_id") REFERENCES "public"."safety_evidence"("id","case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_decision_evidence_evidence_idx" ON "safety_decision_evidence" USING btree ("evidence_id");--> statement-breakpoint

-- Every report a case already carries becomes evidence in it, which is what it
-- always was: intake records the same row from here on. Reports resolved before
-- case management have no case to be evidence in, and inventing one for them
-- would fabricate a review that never happened.
INSERT INTO "safety_evidence" (
  "actor_reference", "case_id", "external_reference", "id", "kind", "note",
  "observed_at", "policy_version", "recorded_at", "reference_id",
  "reference_type", "state_label"
)
SELECT NULL, "case_id", NULL, gen_random_uuid(), 'report', NULL,
       NULL, 'v1-provisional', "created_at", "id", 'safety_report', NULL
FROM "safety_reports"
WHERE "case_id" IS NOT NULL;--> statement-breakpoint

-- Append-only, enforced by PostgreSQL rather than by the code that writes.
--
-- A decision that could be edited afterwards is not a record of a decision, and
-- evidence that could be edited after a decision cited it makes the decision
-- unexplainable in the one direction that matters. `safety_enforcements` joins
-- them: it has always been described as append-only and was until now only
-- append-only by convention.
CREATE OR REPLACE FUNCTION velora_safety_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'safety records are append-only: % on % is not permitted', tg_op, tg_table_name
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "safety_evidence_append_only"
BEFORE UPDATE OR DELETE ON "safety_evidence"
FOR EACH ROW EXECUTE FUNCTION velora_safety_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "safety_decisions_append_only"
BEFORE UPDATE OR DELETE ON "safety_decisions"
FOR EACH ROW EXECUTE FUNCTION velora_safety_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "safety_decision_evidence_append_only"
BEFORE UPDATE OR DELETE ON "safety_decision_evidence"
FOR EACH ROW EXECUTE FUNCTION velora_safety_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "safety_enforcements_append_only"
BEFORE UPDATE OR DELETE ON "safety_enforcements"
FOR EACH ROW EXECUTE FUNCTION velora_safety_reject_mutation();
