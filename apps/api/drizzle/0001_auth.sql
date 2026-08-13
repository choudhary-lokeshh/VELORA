CREATE TABLE "auth_accounts" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"high_impact_restricted_until" timestamp with time zone,
	"high_impact_restriction_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_accounts_status_check" CHECK ("auth_accounts"."status" in ('active', 'locked', 'disabled')),
	CONSTRAINT "auth_accounts_restriction_pairing_check" CHECK (("auth_accounts"."high_impact_restricted_until" is null) = ("auth_accounts"."high_impact_restriction_reason" is null)),
	CONSTRAINT "auth_accounts_restriction_reason_check" CHECK ("auth_accounts"."high_impact_restriction_reason" is null or "auth_accounts"."high_impact_restriction_reason" in ('account_recovery', 'privileged_recovery'))
);
--> statement-breakpoint
CREATE TABLE "auth_admin_authenticators" (
	"account_id" uuid NOT NULL,
	"attachment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"credential_id" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"public_key" text NOT NULL,
	"revocation_reason" text,
	"revoked_at" timestamp with time zone,
	"sign_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "auth_admin_authenticators_attachment_check" CHECK ("auth_admin_authenticators"."attachment" is null or "auth_admin_authenticators"."attachment" in ('platform', 'cross_platform')),
	CONSTRAINT "auth_admin_authenticators_label_length_check" CHECK (char_length("auth_admin_authenticators"."label") between 1 and 64),
	CONSTRAINT "auth_admin_authenticators_sign_count_check" CHECK ("auth_admin_authenticators"."sign_count" >= 0),
	CONSTRAINT "auth_admin_authenticators_revocation_pairing_check" CHECK (("auth_admin_authenticators"."revoked_at" is null) = ("auth_admin_authenticators"."revocation_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "auth_high_impact_authorizations" (
	"actor_account_id" uuid NOT NULL,
	"actor_session_id" uuid NOT NULL,
	"approved_at" timestamp with time zone,
	"approver_account_id" uuid,
	"argument_digest" text NOT NULL,
	"assurance" text NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"before_state_digest" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"expected_effect_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"target_id" text NOT NULL,
	"target_type" text NOT NULL,
	CONSTRAINT "auth_high_impact_authorizations_assurance_check" CHECK ("auth_high_impact_authorizations"."assurance" in ('single_factor', 'multi_factor', 'phishing_resistant')),
	CONSTRAINT "auth_high_impact_authorizations_argument_digest_check" CHECK ("auth_high_impact_authorizations"."argument_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_high_impact_authorizations_before_digest_check" CHECK ("auth_high_impact_authorizations"."before_state_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_high_impact_authorizations_effect_digest_check" CHECK ("auth_high_impact_authorizations"."expected_effect_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_high_impact_authorizations_approval_pairing_check" CHECK (("auth_high_impact_authorizations"."approver_account_id" is null) = ("auth_high_impact_authorizations"."approved_at" is null)),
	CONSTRAINT "auth_high_impact_authorizations_expiry_after_authorization_check" CHECK ("auth_high_impact_authorizations"."expires_at" > "auth_high_impact_authorizations"."authorized_at")
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"last_authenticated_at" timestamp with time zone,
	"provider" text NOT NULL,
	"provider_subject" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_check" CHECK ("auth_identities"."provider" in ('local')),
	CONSTRAINT "auth_identities_subject_length_check" CHECK (char_length("auth_identities"."provider_subject") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "auth_known_devices" (
	"account_id" uuid NOT NULL,
	"device_digest" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_known_devices_device_digest_check" CHECK ("auth_known_devices"."device_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "auth_privileged_recovery_approvals" (
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approver_account_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_privileged_recovery_requests" (
	"completed_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"initiated_by_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"rejected_at" timestamp with time zone,
	"status" text NOT NULL,
	"target_account_id" uuid NOT NULL,
	CONSTRAINT "auth_privileged_recovery_requests_status_check" CHECK ("auth_privileged_recovery_requests"."status" in ('pending', 'completed', 'rejected', 'expired')),
	CONSTRAINT "auth_privileged_recovery_requests_reason_length_check" CHECK (char_length("auth_privileged_recovery_requests"."reason") between 1 and 500),
	CONSTRAINT "auth_privileged_recovery_requests_expiry_after_creation_check" CHECK ("auth_privileged_recovery_requests"."expires_at" > "auth_privileged_recovery_requests"."created_at"),
	CONSTRAINT "auth_privileged_recovery_requests_completion_status_check" CHECK (("auth_privileged_recovery_requests"."completed_at" is null) or ("auth_privileged_recovery_requests"."status" = 'completed'))
);
--> statement-breakpoint
CREATE TABLE "auth_recovery_rate_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text NOT NULL,
	"scope_digest" text NOT NULL,
	CONSTRAINT "auth_recovery_rate_events_scope_check" CHECK ("auth_recovery_rate_events"."scope" in ('account', 'destination', 'requester')),
	CONSTRAINT "auth_recovery_rate_events_digest_check" CHECK ("auth_recovery_rate_events"."scope_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "auth_recovery_requests" (
	"account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"destination_digest" text NOT NULL,
	"device_digest" text,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"risk_level" text NOT NULL,
	"token_digest" text NOT NULL,
	CONSTRAINT "auth_recovery_requests_channel_check" CHECK ("auth_recovery_requests"."channel" in ('email', 'passkey', 'recovery_code', 'support')),
	CONSTRAINT "auth_recovery_requests_risk_check" CHECK ("auth_recovery_requests"."risk_level" in ('standard', 'high')),
	CONSTRAINT "auth_recovery_requests_token_digest_check" CHECK ("auth_recovery_requests"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_recovery_requests_destination_digest_check" CHECK ("auth_recovery_requests"."destination_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_recovery_requests_device_digest_check" CHECK ("auth_recovery_requests"."device_digest" is null or "auth_recovery_requests"."device_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_recovery_requests_invalidation_pairing_check" CHECK (("auth_recovery_requests"."invalidated_at" is null) = ("auth_recovery_requests"."invalidation_reason" is null)),
	CONSTRAINT "auth_recovery_requests_expiry_after_creation_check" CHECK ("auth_recovery_requests"."expires_at" > "auth_recovery_requests"."created_at")
);
--> statement-breakpoint
CREATE TABLE "auth_refresh_families" (
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"account_id" uuid NOT NULL,
	"assurance" text NOT NULL,
	"assurance_established_at" timestamp with time zone NOT NULL,
	"audience" text NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"compromised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_digest" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"installation_id" text NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"revocation_reason" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_refresh_families_audience_check" CHECK ("auth_refresh_families"."audience" in ('consumer_mobile')),
	CONSTRAINT "auth_refresh_families_assurance_check" CHECK ("auth_refresh_families"."assurance" in ('single_factor', 'multi_factor', 'phishing_resistant')),
	CONSTRAINT "auth_refresh_families_installation_length_check" CHECK (char_length("auth_refresh_families"."installation_id") between 8 and 128),
	CONSTRAINT "auth_refresh_families_device_digest_check" CHECK ("auth_refresh_families"."device_digest" is null or "auth_refresh_families"."device_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_refresh_families_revocation_pairing_check" CHECK (("auth_refresh_families"."revoked_at" is null) = ("auth_refresh_families"."revocation_reason" is null)),
	CONSTRAINT "auth_refresh_families_revocation_reason_check" CHECK ("auth_refresh_families"."revocation_reason" is null or "auth_refresh_families"."revocation_reason" in ('logout', 'logout_all', 'account_recovery', 'privileged_recovery', 'refresh_reuse_detected', 'superseded', 'administrative')),
	CONSTRAINT "auth_refresh_families_compromise_implies_revoked_check" CHECK ("auth_refresh_families"."compromised_at" is null or "auth_refresh_families"."revoked_at" is not null),
	CONSTRAINT "auth_refresh_families_absolute_after_creation_check" CHECK ("auth_refresh_families"."absolute_expires_at" > "auth_refresh_families"."created_at"),
	CONSTRAINT "auth_refresh_families_idle_within_absolute_check" CHECK ("auth_refresh_families"."idle_expires_at" <= "auth_refresh_families"."absolute_expires_at")
);
--> statement-breakpoint
CREATE TABLE "auth_refresh_tokens" (
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"family_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"replaced_by_id" uuid,
	"token_digest" text NOT NULL,
	CONSTRAINT "auth_refresh_tokens_token_digest_check" CHECK ("auth_refresh_tokens"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_refresh_tokens_generation_check" CHECK ("auth_refresh_tokens"."generation" >= 0),
	CONSTRAINT "auth_refresh_tokens_replacement_requires_consumption_check" CHECK ("auth_refresh_tokens"."replaced_by_id" is null or "auth_refresh_tokens"."consumed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "auth_security_events" (
	"account_id" uuid,
	"audience" text,
	"correlation_id" text NOT NULL,
	"event_type" text NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"refresh_family_id" uuid,
	"session_id" uuid,
	CONSTRAINT "auth_security_events_type_check" CHECK ("auth_security_events"."event_type" in ('authentication_succeeded', 'authentication_failed', 'session_created', 'session_revoked', 'sessions_revoked_all', 'refresh_rotated', 'refresh_reuse_detected', 'refresh_family_revoked', 'recovery_started', 'recovery_completed', 'recovery_rejected', 'admin_authenticator_enrolled', 'admin_authenticator_revoked', 'admin_step_up_succeeded', 'admin_step_up_failed', 'high_impact_authorized', 'high_impact_executed', 'privileged_recovery_started', 'privileged_recovery_approved', 'privileged_recovery_completed')),
	CONSTRAINT "auth_security_events_audience_check" CHECK ("auth_security_events"."audience" is null or "auth_security_events"."audience" in ('consumer_web', 'creator_studio', 'consumer_mobile', 'platform_admin')),
	CONSTRAINT "auth_security_events_correlation_length_check" CHECK (char_length("auth_security_events"."correlation_id") between 1 and 128),
	CONSTRAINT "auth_security_events_reason_length_check" CHECK ("auth_security_events"."reason" is null or char_length("auth_security_events"."reason") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "auth_security_owners" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"designated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"absolute_expires_at" timestamp with time zone NOT NULL,
	"account_id" uuid NOT NULL,
	"assurance" text NOT NULL,
	"assurance_established_at" timestamp with time zone NOT NULL,
	"audience" text NOT NULL,
	"authenticated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"csrf_digest" text NOT NULL,
	"device_digest" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"revocation_reason" text,
	"revoked_at" timestamp with time zone,
	"token_digest" text NOT NULL,
	CONSTRAINT "auth_sessions_audience_check" CHECK ("auth_sessions"."audience" in ('consumer_web', 'creator_studio', 'platform_admin')),
	CONSTRAINT "auth_sessions_assurance_check" CHECK ("auth_sessions"."assurance" in ('single_factor', 'multi_factor', 'phishing_resistant')),
	CONSTRAINT "auth_sessions_token_digest_check" CHECK ("auth_sessions"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_sessions_csrf_digest_check" CHECK ("auth_sessions"."csrf_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_sessions_device_digest_check" CHECK ("auth_sessions"."device_digest" is null or "auth_sessions"."device_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_sessions_revocation_pairing_check" CHECK (("auth_sessions"."revoked_at" is null) = ("auth_sessions"."revocation_reason" is null)),
	CONSTRAINT "auth_sessions_revocation_reason_check" CHECK ("auth_sessions"."revocation_reason" is null or "auth_sessions"."revocation_reason" in ('logout', 'logout_all', 'account_recovery', 'privileged_recovery', 'refresh_reuse_detected', 'superseded', 'administrative')),
	CONSTRAINT "auth_sessions_absolute_after_creation_check" CHECK ("auth_sessions"."absolute_expires_at" > "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_idle_after_creation_check" CHECK ("auth_sessions"."idle_expires_at" > "auth_sessions"."created_at"),
	CONSTRAINT "auth_sessions_idle_within_absolute_check" CHECK ("auth_sessions"."idle_expires_at" <= "auth_sessions"."absolute_expires_at")
);
--> statement-breakpoint
ALTER TABLE "auth_admin_authenticators" ADD CONSTRAINT "auth_admin_authenticators_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_high_impact_authorizations" ADD CONSTRAINT "auth_high_impact_authorizations_actor_account_id_auth_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_high_impact_authorizations" ADD CONSTRAINT "auth_high_impact_authorizations_actor_session_id_auth_sessions_id_fk" FOREIGN KEY ("actor_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_high_impact_authorizations" ADD CONSTRAINT "auth_high_impact_authorizations_approver_account_id_auth_accounts_id_fk" FOREIGN KEY ("approver_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_known_devices" ADD CONSTRAINT "auth_known_devices_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_privileged_recovery_approvals" ADD CONSTRAINT "auth_privileged_recovery_approvals_approver_account_id_auth_accounts_id_fk" FOREIGN KEY ("approver_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_privileged_recovery_approvals" ADD CONSTRAINT "auth_privileged_recovery_approvals_request_id_auth_privileged_recovery_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."auth_privileged_recovery_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_privileged_recovery_requests" ADD CONSTRAINT "auth_privileged_recovery_requests_initiated_by_account_id_auth_accounts_id_fk" FOREIGN KEY ("initiated_by_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_privileged_recovery_requests" ADD CONSTRAINT "auth_privileged_recovery_requests_target_account_id_auth_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_recovery_requests" ADD CONSTRAINT "auth_recovery_requests_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_refresh_families" ADD CONSTRAINT "auth_refresh_families_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ADD CONSTRAINT "auth_refresh_tokens_family_id_auth_refresh_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."auth_refresh_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ADD CONSTRAINT "auth_refresh_tokens_replaced_by_id_auth_refresh_tokens_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."auth_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_security_events" ADD CONSTRAINT "auth_security_events_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_security_events" ADD CONSTRAINT "auth_security_events_refresh_family_id_auth_refresh_families_id_fk" FOREIGN KEY ("refresh_family_id") REFERENCES "public"."auth_refresh_families"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_security_events" ADD CONSTRAINT "auth_security_events_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_security_owners" ADD CONSTRAINT "auth_security_owners_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_auth_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."auth_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_admin_authenticators_credential_uk" ON "auth_admin_authenticators" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "auth_admin_authenticators_account_idx" ON "auth_admin_authenticators" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_high_impact_authorizations_actor_idx" ON "auth_high_impact_authorizations" USING btree ("actor_account_id","authorized_at");--> statement-breakpoint
CREATE INDEX "auth_high_impact_authorizations_target_idx" ON "auth_high_impact_authorizations" USING btree ("target_type","target_id","authorized_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_uk" ON "auth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "auth_identities_account_idx" ON "auth_identities" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_known_devices_account_device_uk" ON "auth_known_devices" USING btree ("account_id","device_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_privileged_recovery_approvals_unique_approver_uk" ON "auth_privileged_recovery_approvals" USING btree ("request_id","approver_account_id");--> statement-breakpoint
CREATE INDEX "auth_privileged_recovery_requests_target_idx" ON "auth_privileged_recovery_requests" USING btree ("target_account_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_recovery_rate_events_scope_idx" ON "auth_recovery_rate_events" USING btree ("scope","scope_digest","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_recovery_requests_token_digest_uk" ON "auth_recovery_requests" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "auth_recovery_requests_account_idx" ON "auth_recovery_requests" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_refresh_families_active_installation_uk" ON "auth_refresh_families" USING btree ("account_id","installation_id") WHERE "auth_refresh_families"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "auth_refresh_families_account_idx" ON "auth_refresh_families" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_refresh_tokens_token_digest_uk" ON "auth_refresh_tokens" USING btree ("token_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_refresh_tokens_family_generation_uk" ON "auth_refresh_tokens" USING btree ("family_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_refresh_tokens_live_family_uk" ON "auth_refresh_tokens" USING btree ("family_id") WHERE "auth_refresh_tokens"."consumed_at" is null;--> statement-breakpoint
CREATE INDEX "auth_security_events_account_idx" ON "auth_security_events" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "auth_security_events_type_idx" ON "auth_security_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_digest_uk" ON "auth_sessions" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "auth_sessions_account_active_idx" ON "auth_sessions" USING btree ("account_id","revoked_at");
