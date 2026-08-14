CREATE TABLE "discovery_outbox" (
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
	CONSTRAINT "discovery_outbox_state_check" CHECK ("discovery_outbox"."state" in ('pending', 'dispatched', 'dead_letter')),
	CONSTRAINT "discovery_outbox_attempts_check" CHECK ("discovery_outbox"."attempts" >= 0),
	CONSTRAINT "discovery_outbox_lease_shape_check" CHECK (("discovery_outbox"."lease_owner" is null) = ("discovery_outbox"."lease_expires_at" is null)),
	CONSTRAINT "discovery_outbox_lease_state_check" CHECK ("discovery_outbox"."lease_owner" is null or "discovery_outbox"."state" = 'pending'),
	CONSTRAINT "discovery_outbox_dispatched_shape_check" CHECK (("discovery_outbox"."state" = 'dispatched') = ("discovery_outbox"."dispatched_at" is not null)),
	CONSTRAINT "discovery_outbox_version_check" CHECK ("discovery_outbox"."event_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "notifications_feed" (
	"conversation_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"introduction_id" uuid,
	"kind" text NOT NULL,
	"read_at" timestamp with time zone,
	"recipient_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	CONSTRAINT "notifications_feed_kind_check" CHECK ("notifications_feed"."kind" in ('message_received', 'introduction_mutual')),
	CONSTRAINT "notifications_feed_subject_check" CHECK ("notifications_feed"."subject_id" <> "notifications_feed"."recipient_id"),
	CONSTRAINT "notifications_feed_target_check" CHECK (case "notifications_feed"."kind"
        when 'message_received' then "notifications_feed"."conversation_id" is not null and "notifications_feed"."introduction_id" is null
        when 'introduction_mutual' then "notifications_feed"."introduction_id" is not null and "notifications_feed"."conversation_id" is null
        else false
      end)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_outbox_sequence_uk" ON "discovery_outbox" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "discovery_outbox_claimable_idx" ON "discovery_outbox" USING btree ("available_at","sequence") WHERE "discovery_outbox"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "discovery_outbox_state_idx" ON "discovery_outbox" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_feed_source_uk" ON "notifications_feed" USING btree ("source_event_id","recipient_id","template_key");--> statement-breakpoint
CREATE INDEX "notifications_feed_recipient_idx" ON "notifications_feed" USING btree ("recipient_id","created_at","id");
