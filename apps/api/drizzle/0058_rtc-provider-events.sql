CREATE TABLE "realtime_provider_events" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"normalized_event_type" text NOT NULL,
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
	CONSTRAINT "realtime_provider_events_state_check" CHECK ("realtime_provider_events"."state" in ('received', 'retry_wait', 'processed', 'ignored', 'dead_letter')),
	CONSTRAINT "realtime_provider_events_digest_check" CHECK ("realtime_provider_events"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "realtime_provider_events_attempts_check" CHECK ("realtime_provider_events"."attempts" >= 0),
	CONSTRAINT "realtime_provider_events_lease_shape_check" CHECK (("realtime_provider_events"."lease_owner" is null) = ("realtime_provider_events"."lease_expires_at" is null)),
	CONSTRAINT "realtime_provider_events_lease_state_check" CHECK ("realtime_provider_events"."lease_owner" is null or "realtime_provider_events"."state" in ('received', 'retry_wait')),
	CONSTRAINT "realtime_provider_events_processed_shape_check" CHECK (("realtime_provider_events"."state" in ('processed', 'ignored')) = ("realtime_provider_events"."processed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_provider_events_identity_uk" ON "realtime_provider_events" USING btree ("provider","provider_account","provider_environment","provider_event_id");--> statement-breakpoint
CREATE INDEX "realtime_provider_events_claimable_idx" ON "realtime_provider_events" USING btree ("available_at","id") WHERE "realtime_provider_events"."state" in ('received', 'retry_wait');--> statement-breakpoint
CREATE INDEX "realtime_provider_events_reference_idx" ON "realtime_provider_events" USING btree ("provider","provider_reference") WHERE "realtime_provider_events"."provider_reference" is not null;
