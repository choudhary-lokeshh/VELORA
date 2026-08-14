CREATE TABLE "users_accounts" (
	"auth_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"locale" text,
	"region" text,
	"status" text NOT NULL,
	"status_changed_at" timestamp with time zone NOT NULL,
	"status_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_accounts_status_check" CHECK ("users_accounts"."status" in ('pending_profile', 'active', 'restricted', 'deletion_pending', 'deactivated', 'erased')),
	CONSTRAINT "users_accounts_status_reason_check" CHECK ("users_accounts"."status_reason" is null or "users_accounts"."status_reason" in ('onboarding_incomplete', 'eligibility_failed', 'safety_enforcement', 'user_requested')),
	CONSTRAINT "users_accounts_restriction_requires_reason_check" CHECK ("users_accounts"."status" <> 'restricted' or "users_accounts"."status_reason" is not null),
	CONSTRAINT "users_accounts_deletion_requires_request_check" CHECK ("users_accounts"."status" not in ('deletion_pending', 'deactivated', 'erased') or "users_accounts"."deletion_requested_at" is not null),
	CONSTRAINT "users_accounts_region_check" CHECK ("users_accounts"."region" is null or "users_accounts"."region" ~ '^[A-Z]{2}$'),
	CONSTRAINT "users_accounts_locale_check" CHECK ("users_accounts"."locale" is null or "users_accounts"."locale" ~ '^[a-z]{2}(-[A-Z]{2})?$'),
	CONSTRAINT "users_accounts_status_changed_after_creation_check" CHECK ("users_accounts"."status_changed_at" >= "users_accounts"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_accounts_auth_account_uk" ON "users_accounts" USING btree ("auth_account_id");--> statement-breakpoint
CREATE INDEX "users_accounts_status_idx" ON "users_accounts" USING btree ("status");
