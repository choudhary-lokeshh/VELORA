CREATE TABLE "realtime_outbox" (
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
	CONSTRAINT "realtime_outbox_state_check" CHECK ("realtime_outbox"."state" in ('pending', 'dispatched', 'dead_letter')),
	CONSTRAINT "realtime_outbox_attempts_check" CHECK ("realtime_outbox"."attempts" >= 0),
	CONSTRAINT "realtime_outbox_lease_shape_check" CHECK (("realtime_outbox"."lease_owner" is null) = ("realtime_outbox"."lease_expires_at" is null)),
	CONSTRAINT "realtime_outbox_lease_state_check" CHECK ("realtime_outbox"."lease_owner" is null or "realtime_outbox"."state" = 'pending'),
	CONSTRAINT "realtime_outbox_dispatched_shape_check" CHECK (("realtime_outbox"."state" = 'dispatched') = ("realtime_outbox"."dispatched_at" is not null)),
	CONSTRAINT "realtime_outbox_version_check" CHECK ("realtime_outbox"."event_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "notifications_feed" DROP CONSTRAINT "notifications_feed_kind_check";--> statement-breakpoint
ALTER TABLE "notifications_feed" DROP CONSTRAINT "notifications_feed_target_check";--> statement-breakpoint
ALTER TABLE "notifications_feed" ADD COLUMN "call_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_outbox_sequence_uk" ON "realtime_outbox" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "realtime_outbox_claimable_idx" ON "realtime_outbox" USING btree ("sequence") WHERE "realtime_outbox"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "realtime_outbox_state_idx" ON "realtime_outbox" USING btree ("state","created_at");--> statement-breakpoint
ALTER TABLE "notifications_feed" ADD CONSTRAINT "notifications_feed_kind_check" CHECK ("notifications_feed"."kind" in ('message_received', 'introduction_mutual', 'call_incoming', 'call_missed'));--> statement-breakpoint
ALTER TABLE "notifications_feed" ADD CONSTRAINT "notifications_feed_target_check" CHECK (case "notifications_feed"."kind"
        when 'message_received' then "notifications_feed"."conversation_id" is not null and "notifications_feed"."introduction_id" is null and "notifications_feed"."call_id" is null
        when 'introduction_mutual' then "notifications_feed"."introduction_id" is not null and "notifications_feed"."conversation_id" is null and "notifications_feed"."call_id" is null
        when 'call_incoming' then "notifications_feed"."call_id" is not null and "notifications_feed"."conversation_id" is null and "notifications_feed"."introduction_id" is null
        when 'call_missed' then "notifications_feed"."call_id" is not null and "notifications_feed"."conversation_id" is null and "notifications_feed"."introduction_id" is null
        else false
      end);

