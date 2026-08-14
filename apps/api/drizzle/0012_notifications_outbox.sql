CREATE TABLE "messaging_outbox" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"sequence" bigserial NOT NULL,
	"state" text NOT NULL,
	"subject_id" uuid,
	"subject_type" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messaging_outbox_state_check" CHECK ("messaging_outbox"."state" in ('pending', 'dispatched', 'dead_letter')),
	CONSTRAINT "messaging_outbox_attempts_check" CHECK ("messaging_outbox"."attempts" >= 0),
	CONSTRAINT "messaging_outbox_lease_shape_check" CHECK (("messaging_outbox"."lease_owner" is null) = ("messaging_outbox"."lease_expires_at" is null)),
	CONSTRAINT "messaging_outbox_lease_state_check" CHECK ("messaging_outbox"."lease_owner" is null or "messaging_outbox"."state" = 'pending'),
	CONSTRAINT "messaging_outbox_dispatched_shape_check" CHECK (("messaging_outbox"."state" = 'dispatched') = ("messaging_outbox"."dispatched_at" is not null)),
	CONSTRAINT "messaging_outbox_version_check" CHECK ("messaging_outbox"."event_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "notifications_attempts" (
	"attempt_number" integer NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"failure_reason" text,
	"id" bigserial PRIMARY KEY NOT NULL,
	"intent_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"provider_reference" text,
	CONSTRAINT "notifications_attempts_outcome_check" CHECK ("notifications_attempts"."outcome" in ('delivered', 'failed', 'suppressed')),
	CONSTRAINT "notifications_attempts_channel_check" CHECK ("notifications_attempts"."channel" in ('push', 'email', 'sms')),
	CONSTRAINT "notifications_attempts_number_check" CHECK ("notifications_attempts"."attempt_number" >= 1),
	CONSTRAINT "notifications_attempts_delivered_shape_check" CHECK ("notifications_attempts"."outcome" <> 'delivered' or "notifications_attempts"."provider_reference" is not null),
	CONSTRAINT "notifications_attempts_failed_shape_check" CHECK ("notifications_attempts"."outcome" <> 'failed' or "notifications_attempts"."failure_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "notifications_intents" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"channel" text NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"purpose" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"source_producer" text NOT NULL,
	"state" text NOT NULL,
	"subject_id" uuid,
	"suppression_reason" text,
	"template_key" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notifications_intents_state_check" CHECK ("notifications_intents"."state" in ('queued', 'attempted', 'delivered', 'suppressed', 'dead_letter')),
	CONSTRAINT "notifications_intents_channel_check" CHECK ("notifications_intents"."channel" in ('push', 'email', 'sms')),
	CONSTRAINT "notifications_intents_purpose_check" CHECK ("notifications_intents"."purpose" in ('transactional', 'safety', 'marketing')),
	CONSTRAINT "notifications_intents_suppression_check" CHECK ("notifications_intents"."suppression_reason" is null or "notifications_intents"."suppression_reason" in ('safety_block', 'recipient_not_deliverable', 'expired')),
	CONSTRAINT "notifications_intents_attempts_check" CHECK ("notifications_intents"."attempts" >= 0),
	CONSTRAINT "notifications_intents_version_check" CHECK ("notifications_intents"."version" >= 0),
	CONSTRAINT "notifications_intents_lease_shape_check" CHECK (("notifications_intents"."lease_owner" is null) = ("notifications_intents"."lease_expires_at" is null)),
	CONSTRAINT "notifications_intents_lease_state_check" CHECK ("notifications_intents"."lease_owner" is null or "notifications_intents"."state" = 'attempted'),
	CONSTRAINT "notifications_intents_delivered_shape_check" CHECK (("notifications_intents"."state" = 'delivered') = ("notifications_intents"."delivered_at" is not null)),
	CONSTRAINT "notifications_intents_suppressed_shape_check" CHECK (("notifications_intents"."state" = 'suppressed') = ("notifications_intents"."suppression_reason" is not null)),
	CONSTRAINT "notifications_intents_expiry_check" CHECK ("notifications_intents"."expires_at" > "notifications_intents"."created_at"),
	CONSTRAINT "notifications_intents_subject_check" CHECK ("notifications_intents"."subject_id" is null or "notifications_intents"."subject_id" <> "notifications_intents"."recipient_id")
);
--> statement-breakpoint
ALTER TABLE "notifications_attempts" ADD CONSTRAINT "notifications_attempts_intent_id_notifications_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."notifications_intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_outbox_sequence_uk" ON "messaging_outbox" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "messaging_outbox_claimable_idx" ON "messaging_outbox" USING btree ("available_at","sequence") WHERE "messaging_outbox"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "messaging_outbox_state_idx" ON "messaging_outbox" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_attempts_number_uk" ON "notifications_attempts" USING btree ("intent_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_attempts_provider_uk" ON "notifications_attempts" USING btree ("channel","provider_reference") WHERE "notifications_attempts"."provider_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_intents_source_uk" ON "notifications_intents" USING btree ("source_event_id","recipient_id","template_key");--> statement-breakpoint
CREATE INDEX "notifications_intents_due_idx" ON "notifications_intents" USING btree ("next_attempt_at","created_at") WHERE "notifications_intents"."state" in ('queued', 'attempted');--> statement-breakpoint
CREATE INDEX "notifications_intents_recipient_idx" ON "notifications_intents" USING btree ("recipient_id","created_at");
