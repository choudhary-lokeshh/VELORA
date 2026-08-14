CREATE TABLE "creators_accounts" (
	"activated_at" timestamp with time zone,
	"auth_account_id" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"status_reason" text,
	"suspended_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "creators_accounts_status_check" CHECK ("creators_accounts"."status" in ('applicant', 'active', 'suspended', 'closed')),
	CONSTRAINT "creators_accounts_status_reason_check" CHECK ("creators_accounts"."status_reason" is null or "creators_accounts"."status_reason" in ('onboarding_incomplete', 'eligibility_failed', 'safety_enforcement', 'platform_action', 'creator_requested')),
	CONSTRAINT "creators_accounts_active_reason_check" CHECK (("creators_accounts"."status" = 'active') = ("creators_accounts"."status_reason" is null)),
	CONSTRAINT "creators_accounts_activated_check" CHECK ("creators_accounts"."status" <> 'active' or "creators_accounts"."activated_at" is not null),
	CONSTRAINT "creators_accounts_closed_check" CHECK (("creators_accounts"."status" = 'closed') = ("creators_accounts"."closed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "creators_policy_acknowledgements" (
	"acknowledged_at" timestamp with time zone NOT NULL,
	"audience" text NOT NULL,
	"creator_id" uuid NOT NULL,
	"policy_key" text NOT NULL,
	"policy_version" text NOT NULL,
	CONSTRAINT "creators_policy_acknowledgements_creator_id_policy_key_policy_version_pk" PRIMARY KEY("creator_id","policy_key","policy_version"),
	CONSTRAINT "creators_policy_acknowledgements_key_check" CHECK ("creators_policy_acknowledgements"."policy_key" in ('creator_terms', 'creator_content_policy')),
	CONSTRAINT "creators_policy_acknowledgements_version_check" CHECK (char_length("creators_policy_acknowledgements"."policy_version") between 1 and 32),
	CONSTRAINT "creators_policy_acknowledgements_audience_check" CHECK ("creators_policy_acknowledgements"."audience" in ('creator_studio'))
);
--> statement-breakpoint
ALTER TABLE "creators_policy_acknowledgements" ADD CONSTRAINT "creators_policy_acknowledgements_creator_id_creators_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creators_accounts_auth_account_uk" ON "creators_accounts" USING btree ("auth_account_id");--> statement-breakpoint
CREATE INDEX "creators_accounts_status_idx" ON "creators_accounts" USING btree ("status","created_at");
