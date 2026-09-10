CREATE TABLE "auth_federated_authorizations" (
	"audience" text NOT NULL,
	"code_verifier" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"nonce" text NOT NULL,
	"return_to" text,
	"state_digest" text PRIMARY KEY NOT NULL,
	CONSTRAINT "auth_federated_authorizations_state_digest_check" CHECK ("auth_federated_authorizations"."state_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_federated_authorizations_audience_check" CHECK ("auth_federated_authorizations"."audience" in ('consumer_web', 'creator_studio', 'platform_admin')),
	CONSTRAINT "auth_federated_authorizations_lifetime_check" CHECK ("auth_federated_authorizations"."expires_at" > "auth_federated_authorizations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "auth_privileged_challenges" (
	"account_id" uuid NOT NULL,
	"challenge_digest" text PRIMARY KEY NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"purpose" text NOT NULL,
	CONSTRAINT "auth_privileged_challenges_digest_check" CHECK ("auth_privileged_challenges"."challenge_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_privileged_challenges_purpose_check" CHECK ("auth_privileged_challenges"."purpose" in ('enrolment', 'assertion')),
	CONSTRAINT "auth_privileged_challenges_lifetime_check" CHECK ("auth_privileged_challenges"."expires_at" > "auth_privileged_challenges"."created_at")
);
--> statement-breakpoint
CREATE TABLE "operations_operator_bootstraps" (
	"consumed_at" timestamp with time zone NOT NULL,
	"grant_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"subject_reference" text NOT NULL,
	"token_digest" text NOT NULL,
	CONSTRAINT "operations_operator_bootstraps_singleton_check" CHECK ("operations_operator_bootstraps"."singleton" is true),
	CONSTRAINT "operations_operator_bootstraps_token_digest_check" CHECK ("operations_operator_bootstraps"."token_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "auth_privileged_challenges" ADD CONSTRAINT "auth_privileged_challenges_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_federated_authorizations_expiry_idx" ON "auth_federated_authorizations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_privileged_challenges_account_idx" ON "auth_privileged_challenges" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_privileged_challenges_expiry_idx" ON "auth_privileged_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_operator_bootstraps_singleton_uk" ON "operations_operator_bootstraps" USING btree ("singleton");
