CREATE TABLE "safety_blocks" (
	"blocked_id" uuid NOT NULL,
	"blocker_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"revoked_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "safety_blocks_not_self_check" CHECK ("safety_blocks"."blocker_id" <> "safety_blocks"."blocked_id"),
	CONSTRAINT "safety_blocks_revocation_check" CHECK ("safety_blocks"."revoked_at" is null or "safety_blocks"."revoked_at" >= "safety_blocks"."created_at")
);
--> statement-breakpoint
CREATE TABLE "safety_enforcements" (
	"actor_reference" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"policy_version" text NOT NULL,
	"reason_code" text NOT NULL,
	"report_id" uuid,
	"scope" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"target_conversation_id" uuid,
	CONSTRAINT "safety_enforcements_scope_check" CHECK ("safety_enforcements"."scope" in ('account_restriction', 'conversation_closure')),
	CONSTRAINT "safety_enforcements_reason_check" CHECK ("safety_enforcements"."reason_code" in ('underage_risk', 'harassment', 'sexual_content_violation', 'impersonation', 'spam_or_scam', 'platform_integrity')),
	CONSTRAINT "safety_enforcements_target_check" CHECK (("safety_enforcements"."scope" = 'conversation_closure') = ("safety_enforcements"."target_conversation_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "safety_reports" (
	"client_report_id" text NOT NULL,
	"conversation_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"detail" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid,
	"policy_version" text NOT NULL,
	"reason_code" text NOT NULL,
	"reporter_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"state" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "safety_reports_not_self_check" CHECK ("safety_reports"."reporter_id" <> "safety_reports"."subject_id"),
	CONSTRAINT "safety_reports_state_check" CHECK ("safety_reports"."state" in ('received', 'under_review', 'actioned', 'dismissed')),
	CONSTRAINT "safety_reports_reason_check" CHECK ("safety_reports"."reason_code" in ('underage_concern', 'harassment', 'sexual_content_violation', 'impersonation', 'spam_or_scam', 'other')),
	CONSTRAINT "safety_reports_detail_check" CHECK ("safety_reports"."detail" is null or char_length("safety_reports"."detail") between 1 and 2000),
	CONSTRAINT "safety_reports_resolution_check" CHECK (("safety_reports"."state" in ('actioned', 'dismissed')) = ("safety_reports"."resolved_at" is not null)),
	CONSTRAINT "safety_reports_evidence_check" CHECK ("safety_reports"."message_id" is null or "safety_reports"."conversation_id" is not null),
	CONSTRAINT "safety_reports_version_check" CHECK ("safety_reports"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "safety_blocks_live_pair_uk" ON "safety_blocks" USING btree ("blocker_id","blocked_id") WHERE "safety_blocks"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "safety_blocks_blocked_idx" ON "safety_blocks" USING btree ("blocked_id","blocker_id");--> statement-breakpoint
CREATE INDEX "safety_enforcements_subject_idx" ON "safety_enforcements" USING btree ("subject_id","effective_at");--> statement-breakpoint
CREATE INDEX "safety_enforcements_report_idx" ON "safety_enforcements" USING btree ("report_id");--> statement-breakpoint
CREATE UNIQUE INDEX "safety_reports_client_id_uk" ON "safety_reports" USING btree ("reporter_id","client_report_id");--> statement-breakpoint
CREATE INDEX "safety_reports_state_idx" ON "safety_reports" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "safety_reports_subject_idx" ON "safety_reports" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "safety_reports_reporter_idx" ON "safety_reports" USING btree ("reporter_id","created_at");
