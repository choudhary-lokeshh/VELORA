CREATE TABLE "operations_controls" (
	"changed_by" text NOT NULL,
	"enabled" boolean NOT NULL,
	"key" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "operations_controls_key_check" CHECK ("operations_controls"."key" in ('live.search', 'growth.invitations', 'growth.scheduled_windows')),
	CONSTRAINT "operations_controls_reason_length_check" CHECK (char_length("operations_controls"."reason") between 8 and 280),
	CONSTRAINT "operations_controls_version_check" CHECK ("operations_controls"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "operations_operator_actions" (
	"actor_reference" text NOT NULL,
	"action" text NOT NULL,
	"capability" text NOT NULL,
	"correlation_id" text,
	"failure_code" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"previous_state" text,
	"reason" text NOT NULL,
	"requested_state" text,
	"subject_id" text,
	"subject_type" text NOT NULL,
	CONSTRAINT "operations_operator_actions_action_check" CHECK ("operations_operator_actions"."action" in ('control.set', 'operator.role.granted', 'operator.role.revoked', 'sessions.revoked')),
	CONSTRAINT "operations_operator_actions_outcome_check" CHECK ("operations_operator_actions"."outcome" in ('applied', 'refused', 'failed')),
	CONSTRAINT "operations_operator_actions_subject_type_check" CHECK ("operations_operator_actions"."subject_type" in ('account', 'control', 'encounter', 'operator', 'platform')),
	CONSTRAINT "operations_operator_actions_capability_check" CHECK ("operations_operator_actions"."capability" in ('audit.read', 'billing.read', 'billing.refund', 'config.read', 'config.write', 'creators.enforce', 'creators.read', 'growth.manage', 'growth.read', 'live.control', 'live.read', 'operations.read', 'operators.manage', 'safety.enforce', 'safety.read', 'safety.resolve', 'sessions.revoke', 'support.read', 'support.update', 'users.read', 'users.restrict', 'wallet.read')),
	CONSTRAINT "operations_operator_actions_reason_length_check" CHECK (char_length("operations_operator_actions"."reason") between 8 and 280),
	CONSTRAINT "operations_operator_actions_failure_pairing_check" CHECK (("operations_operator_actions"."outcome" = 'applied') = ("operations_operator_actions"."failure_code" is null)),
	CONSTRAINT "operations_operator_actions_previous_state_length_check" CHECK ("operations_operator_actions"."previous_state" is null or char_length("operations_operator_actions"."previous_state") between 1 and 64),
	CONSTRAINT "operations_operator_actions_requested_state_length_check" CHECK ("operations_operator_actions"."requested_state" is null or char_length("operations_operator_actions"."requested_state") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "operations_operator_grants" (
	"granted_at" timestamp with time zone NOT NULL,
	"granted_by" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"role" text NOT NULL,
	"subject_reference" text NOT NULL,
	CONSTRAINT "operations_operator_grants_role_check" CHECK ("operations_operator_grants"."role" in ('super_admin', 'operations', 'safety', 'support', 'finance', 'growth', 'readonly')),
	CONSTRAINT "operations_operator_grants_reason_length_check" CHECK (char_length("operations_operator_grants"."reason") between 8 and 280),
	CONSTRAINT "operations_operator_grants_revocation_pairing_check" CHECK (("operations_operator_grants"."revoked_at" is null) = ("operations_operator_grants"."revoked_by" is null))
);
--> statement-breakpoint
CREATE INDEX "operations_operator_actions_recency_idx" ON "operations_operator_actions" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "operations_operator_actions_actor_idx" ON "operations_operator_actions" USING btree ("actor_reference","occurred_at");--> statement-breakpoint
CREATE INDEX "operations_operator_actions_subject_idx" ON "operations_operator_actions" USING btree ("subject_id","occurred_at") WHERE "operations_operator_actions"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX "operations_operator_actions_action_idx" ON "operations_operator_actions" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_operator_grants_live_uk" ON "operations_operator_grants" USING btree ("subject_reference") WHERE "operations_operator_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "operations_operator_grants_recency_idx" ON "operations_operator_grants" USING btree ("granted_at","id");
