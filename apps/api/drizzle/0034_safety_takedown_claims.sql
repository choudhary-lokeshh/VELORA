-- TRUST & SAFETY takedown claims.
--
-- A claim asks for one specific item to come down. It is not a report: a report
-- is filed by a Velora account about a target, and a claim can come from
-- somebody with no account at all -- a depicted person asking for a depiction
-- of themselves to be removed is the case
-- `docs/compliance/07-surface-and-distribution-eligibility.md` records, where
-- the card-network requirement is exactly that route.
--
-- A claim decides nothing by existing. It opens or joins a case and is reviewed
-- there like any other allegation; removing the item is a moderation decision
-- with its own record. What the claim adds is when the platform is *owed* an
-- answer.
--
-- **Every deadline comes from a published policy** and is stored beside the
-- version that produced it. Production publishes none, so production records
-- claims with all three deadline columns null and computes nothing. That is the
-- accurate state of a platform whose obligations nobody has approved, and it is
-- better than a hard-coded number that would look like compliance and carry no
-- authority. The seven-business-day card-network figure is recorded as evidence
-- about what a policy will need to say, and is deliberately not compiled in.
--
-- Urgency is derived from what is alleged rather than chosen by the claimant,
-- so nobody can mark their own complaint urgent, and it affects only the
-- deadline -- never the decision and never a reviewer's priority.
--
-- Nothing here holds a name, an address, or a means of contact. Only an account
-- holder has an identifier, because that is the only claimant this domain
-- already knows.
CREATE TABLE "safety_takedown_claims" (
	"acknowledged_at" timestamp with time zone,
	"acknowledgement_due_at" timestamp with time zone,
	"action_due_at" timestamp with time zone,
	"case_id" uuid NOT NULL,
	"claimant_account_id" uuid,
	"claimant_kind" text NOT NULL,
	"completed_at" timestamp with time zone,
	"consent_record_id" uuid,
	"content_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"decided_at" timestamp with time zone,
	"deadline_policy_version" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_actor_reference" text,
	"lease_expires_at" timestamp with time zone,
	"policy_version" text NOT NULL,
	"reason_code" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"triage_due_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"urgency" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "safety_takedown_claims_state_check" CHECK ("safety_takedown_claims"."state" in ('received', 'acknowledged', 'decided', 'completed', 'dismissed')),
	CONSTRAINT "safety_takedown_claims_reason_check" CHECK ("safety_takedown_claims"."reason_code" in ('non_consensual_content', 'consent_withdrawn', 'illegal_content', 'other')),
	CONSTRAINT "safety_takedown_claims_claimant_kind_check" CHECK ("safety_takedown_claims"."claimant_kind" in ('depicted_person', 'account_holder', 'operator', 'external')),
	CONSTRAINT "safety_takedown_claims_urgency_check" CHECK ("safety_takedown_claims"."urgency" in ('standard', 'urgent')),
	CONSTRAINT "safety_takedown_claims_claimant_shape_check" CHECK (("safety_takedown_claims"."claimant_kind" = 'account_holder') = ("safety_takedown_claims"."claimant_account_id" is not null)),
	CONSTRAINT "safety_takedown_claims_consent_shape_check" CHECK ("safety_takedown_claims"."consent_record_id" is null or "safety_takedown_claims"."reason_code" = 'consent_withdrawn'),
	CONSTRAINT "safety_takedown_claims_deadline_shape_check" CHECK (("safety_takedown_claims"."deadline_policy_version" is null) = ("safety_takedown_claims"."acknowledgement_due_at" is null)
        and ("safety_takedown_claims"."deadline_policy_version" is null) = ("safety_takedown_claims"."triage_due_at" is null)
        and ("safety_takedown_claims"."deadline_policy_version" is null) = ("safety_takedown_claims"."action_due_at" is null)),
	CONSTRAINT "safety_takedown_claims_deadline_order_check" CHECK ("safety_takedown_claims"."acknowledgement_due_at" is null
        or ("safety_takedown_claims"."acknowledgement_due_at" > "safety_takedown_claims"."received_at"
          and "safety_takedown_claims"."triage_due_at" >= "safety_takedown_claims"."acknowledgement_due_at"
          and "safety_takedown_claims"."action_due_at" >= "safety_takedown_claims"."triage_due_at")),
	CONSTRAINT "safety_takedown_claims_progress_check" CHECK (("safety_takedown_claims"."state" not in ('acknowledged', 'decided', 'completed') or "safety_takedown_claims"."acknowledged_at" is not null)
        and ("safety_takedown_claims"."state" in ('decided', 'completed', 'dismissed')) = ("safety_takedown_claims"."decided_at" is not null)
        and ("safety_takedown_claims"."state" = 'completed') = ("safety_takedown_claims"."completed_at" is not null)),
	CONSTRAINT "safety_takedown_claims_lease_shape_check" CHECK (("safety_takedown_claims"."lease_actor_reference" is null) = ("safety_takedown_claims"."lease_expires_at" is null)),
	CONSTRAINT "safety_takedown_claims_version_check" CHECK ("safety_takedown_claims"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "safety_takedown_claims" ADD CONSTRAINT "safety_takedown_claims_case_id_safety_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."safety_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_takedown_claims" ADD CONSTRAINT "safety_takedown_claims_consent_record_id_safety_consent_records_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."safety_consent_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_takedown_claims_content_idx" ON "safety_takedown_claims" USING btree ("content_id","received_at");--> statement-breakpoint
CREATE INDEX "safety_takedown_claims_case_idx" ON "safety_takedown_claims" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "safety_takedown_claims_due_idx" ON "safety_takedown_claims" USING btree ("action_due_at","id") WHERE "safety_takedown_claims"."action_due_at" is not null;--> statement-breakpoint
CREATE INDEX "safety_takedown_claims_claimant_idx" ON "safety_takedown_claims" USING btree ("claimant_account_id","received_at") WHERE "safety_takedown_claims"."claimant_account_id" is not null;
