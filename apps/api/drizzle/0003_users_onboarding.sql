CREATE TABLE "users_adult_assurances" (
	"assurance_class" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"evidence_reference" text,
	"expires_at" timestamp with time zone,
	"id" bigserial PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"outcome" text NOT NULL,
	"policy_version" text NOT NULL,
	"region" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "users_adult_assurances_class_check" CHECK ("users_adult_assurances"."assurance_class" in ('self_declared', 'verified_adult')),
	CONSTRAINT "users_adult_assurances_outcome_check" CHECK ("users_adult_assurances"."outcome" in ('passed', 'failed', 'pending', 'review', 'revoked')),
	CONSTRAINT "users_adult_assurances_method_length_check" CHECK (char_length("users_adult_assurances"."method") between 1 and 64),
	CONSTRAINT "users_adult_assurances_policy_version_length_check" CHECK (char_length("users_adult_assurances"."policy_version") between 1 and 32),
	CONSTRAINT "users_adult_assurances_region_check" CHECK ("users_adult_assurances"."region" is null or "users_adult_assurances"."region" ~ '^[A-Z]{2}$'),
	CONSTRAINT "users_adult_assurances_evidence_check" CHECK ("users_adult_assurances"."evidence_reference" is null or "users_adult_assurances"."evidence_reference" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "users_adult_assurances_expiry_after_decision_check" CHECK ("users_adult_assurances"."expires_at" is null or "users_adult_assurances"."expires_at" > "users_adult_assurances"."decided_at"),
	CONSTRAINT "users_adult_assurances_self_declaration_shape_check" CHECK ("users_adult_assurances"."assurance_class" <> 'self_declared' or "users_adult_assurances"."evidence_reference" is null)
);
--> statement-breakpoint
CREATE TABLE "users_policy_acknowledgements" (
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audience" text NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"policy_key" text NOT NULL,
	"policy_version" text NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "users_policy_acknowledgements_key_check" CHECK ("users_policy_acknowledgements"."policy_key" in ('terms_of_service', 'privacy_notice')),
	CONSTRAINT "users_policy_acknowledgements_audience_check" CHECK ("users_policy_acknowledgements"."audience" in ('consumer_web', 'consumer_mobile')),
	CONSTRAINT "users_policy_acknowledgements_version_length_check" CHECK (char_length("users_policy_acknowledgements"."policy_version") between 1 and 32)
);
--> statement-breakpoint
ALTER TABLE "users_adult_assurances" ADD CONSTRAINT "users_adult_assurances_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_policy_acknowledgements" ADD CONSTRAINT "users_policy_acknowledgements_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_adult_assurances_user_idx" ON "users_adult_assurances" USING btree ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_policy_acknowledgements_unique_version_uk" ON "users_policy_acknowledgements" USING btree ("user_id","policy_key","policy_version");
