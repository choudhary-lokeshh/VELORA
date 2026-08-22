CREATE TABLE "notifications_provider_events" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"failure_reason" text,
	"feedback_type" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_digest" text NOT NULL,
	"processed_at" timestamp with time zone,
	"provider" text NOT NULL,
	"provider_account" text NOT NULL,
	"provider_environment" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_reference" text,
	"received_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"token_fingerprint" text,
	CONSTRAINT "notifications_provider_events_state_check" CHECK ("notifications_provider_events"."state" in ('received', 'retry_wait', 'processed', 'dead_letter')),
	CONSTRAINT "notifications_provider_events_type_check" CHECK ("notifications_provider_events"."feedback_type" in ('delivered', 'deferred', 'bounced', 'complained', 'token_invalid')),
	CONSTRAINT "notifications_provider_events_digest_check" CHECK ("notifications_provider_events"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "notifications_provider_events_token_check" CHECK ("notifications_provider_events"."token_fingerprint" is null or "notifications_provider_events"."token_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "notifications_provider_events_attempts_check" CHECK ("notifications_provider_events"."attempts" >= 0),
	CONSTRAINT "notifications_provider_events_lease_shape_check" CHECK (("notifications_provider_events"."lease_owner" is null) = ("notifications_provider_events"."lease_expires_at" is null)),
	CONSTRAINT "notifications_provider_events_lease_state_check" CHECK ("notifications_provider_events"."lease_owner" is null or "notifications_provider_events"."state" = 'received' or "notifications_provider_events"."state" = 'retry_wait'),
	CONSTRAINT "notifications_provider_events_processed_shape_check" CHECK (("notifications_provider_events"."state" = 'processed') = ("notifications_provider_events"."processed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_provider_events_identity_uk" ON "notifications_provider_events" USING btree ("provider","provider_account","provider_environment","provider_event_id");--> statement-breakpoint
CREATE INDEX "notifications_provider_events_claimable_idx" ON "notifications_provider_events" USING btree ("available_at","id") WHERE "notifications_provider_events"."state" in ('received', 'retry_wait');--> statement-breakpoint
CREATE INDEX "notifications_provider_events_reference_idx" ON "notifications_provider_events" USING btree ("provider","provider_reference") WHERE "notifications_provider_events"."provider_reference" is not null;
