CREATE TABLE "live_encounters" (
	"created_at" timestamp with time zone NOT NULL,
	"end_reason" text,
	"ended_by_id" uuid,
	"ended_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"medium" text NOT NULL,
	"message_sequence" bigint DEFAULT 0 NOT NULL,
	"pair_high_id" uuid NOT NULL,
	"pair_low_id" uuid NOT NULL,
	"realtime_session_id" uuid,
	"sequence" bigserial NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_encounters_state_check" CHECK ("live_encounters"."state" in ('live', 'ended')),
	CONSTRAINT "live_encounters_medium_check" CHECK ("live_encounters"."medium" in ('voice', 'video')),
	CONSTRAINT "live_encounters_pair_order_check" CHECK ("live_encounters"."pair_low_id" < "live_encounters"."pair_high_id"),
	CONSTRAINT "live_encounters_terminal_shape_check" CHECK (("live_encounters"."state" = 'ended') = ("live_encounters"."ended_at" is not null)),
	CONSTRAINT "live_encounters_end_reason_shape_check" CHECK (("live_encounters"."ended_at" is null) = ("live_encounters"."end_reason" is null)),
	CONSTRAINT "live_encounters_end_reason_check" CHECK ("live_encounters"."end_reason" is null or end_reason in ('departed', 'presence_lapsed', 'session_failed', 'safety_block', 'safety_enforcement')),
	CONSTRAINT "live_encounters_ended_by_check" CHECK ("live_encounters"."ended_by_id" is null or ("live_encounters"."end_reason" = 'departed' and "live_encounters"."ended_by_id" in ("live_encounters"."pair_low_id", "live_encounters"."pair_high_id"))),
	CONSTRAINT "live_encounters_ended_order_check" CHECK ("live_encounters"."ended_at" is null or "live_encounters"."ended_at" >= "live_encounters"."created_at"),
	CONSTRAINT "live_encounters_sequence_check" CHECK ("live_encounters"."message_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "live_messages" (
	"body" text NOT NULL,
	"client_message_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"encounter_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"sender_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	CONSTRAINT "live_messages_sequence_check" CHECK ("live_messages"."sequence" >= 1),
	CONSTRAINT "live_messages_body_check" CHECK (char_length("live_messages"."body") between 1 and 4000 and btrim("live_messages"."body") <> ''),
	CONSTRAINT "live_messages_client_id_check" CHECK (char_length("live_messages"."client_message_id") between 8 and 128)
);
--> statement-breakpoint
CREATE TABLE "live_participations" (
	"encounter_id" uuid,
	"id" uuid PRIMARY KEY NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"medium" text NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"sequence" bigserial NOT NULL,
	"state" text NOT NULL,
	"state_entered_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "live_participations_state_check" CHECK ("live_participations"."state" in ('searching', 'matched', 'ended', 'left')),
	CONSTRAINT "live_participations_medium_check" CHECK ("live_participations"."medium" in ('voice', 'video')),
	CONSTRAINT "live_participations_encounter_shape_check" CHECK (("live_participations"."state" in ('matched', 'ended')) = ("live_participations"."encounter_id" is not null)),
	CONSTRAINT "live_participations_seen_order_check" CHECK ("live_participations"."seen_at" >= "live_participations"."joined_at"),
	CONSTRAINT "live_participations_state_order_check" CHECK ("live_participations"."state_entered_at" >= "live_participations"."joined_at")
);
--> statement-breakpoint
ALTER TABLE "realtime_sessions" DROP CONSTRAINT "realtime_sessions_end_reason_check";--> statement-breakpoint
ALTER TABLE "realtime_sessions" DROP CONSTRAINT "realtime_sessions_end_reason_state_check";--> statement-breakpoint
ALTER TABLE "realtime_sessions" ALTER COLUMN "origin_introduction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD COLUMN "live_encounter_id" uuid;--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD COLUMN "purpose" text DEFAULT 'introduced' NOT NULL;--> statement-breakpoint
ALTER TABLE "live_messages" ADD CONSTRAINT "live_messages_encounter_id_live_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."live_encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "live_encounters_live_pair_uk" ON "live_encounters" USING btree ("pair_low_id","pair_high_id") WHERE "live_encounters"."state" = 'live';--> statement-breakpoint
CREATE INDEX "live_encounters_pair_recency_idx" ON "live_encounters" USING btree ("pair_low_id","pair_high_id","created_at");--> statement-breakpoint
CREATE INDEX "live_encounters_low_recency_idx" ON "live_encounters" USING btree ("pair_low_id","created_at");--> statement-breakpoint
CREATE INDEX "live_encounters_high_recency_idx" ON "live_encounters" USING btree ("pair_high_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_encounters_sequence_uk" ON "live_encounters" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "live_encounters_session_uk" ON "live_encounters" USING btree ("realtime_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_messages_order_uk" ON "live_messages" USING btree ("encounter_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "live_messages_client_id_uk" ON "live_messages" USING btree ("encounter_id","sender_id","client_message_id");--> statement-breakpoint
CREATE INDEX "live_messages_sender_idx" ON "live_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_participations_live_user_uk" ON "live_participations" USING btree ("user_id") WHERE "live_participations"."state" <> 'left';--> statement-breakpoint
CREATE INDEX "live_participations_waiting_idx" ON "live_participations" USING btree ("state_entered_at") WHERE "live_participations"."state" = 'searching';--> statement-breakpoint
CREATE INDEX "live_participations_presence_idx" ON "live_participations" USING btree ("seen_at") WHERE "live_participations"."state" <> 'left';--> statement-breakpoint
CREATE UNIQUE INDEX "live_participations_sequence_uk" ON "live_participations" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "live_participations_encounter_idx" ON "live_participations" USING btree ("encounter_id") WHERE "live_participations"."encounter_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_sessions_live_encounter_uk" ON "realtime_sessions" USING btree ("live_encounter_id");--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_purpose_check" CHECK ("realtime_sessions"."purpose" in ('introduced', 'live_discovery'));--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_purpose_introduction_check" CHECK (("realtime_sessions"."purpose" = 'introduced') = ("realtime_sessions"."origin_introduction_id" is not null));--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_purpose_encounter_check" CHECK (("realtime_sessions"."purpose" = 'live_discovery') = ("realtime_sessions"."live_encounter_id" is not null));--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_end_reason_check" CHECK ("realtime_sessions"."end_reason" is null or "realtime_sessions"."end_reason" in ('hung_up', 'declined', 'withdrawn', 'invitation_expired', 'safety_block', 'safety_enforcement', 'reconnect_expired', 'provider_unavailable', 'provider_failed', 'join_timeout', 'operator_terminated', 'encounter_ended'));--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_end_reason_state_check" CHECK ("realtime_sessions"."end_reason" is null or (state = 'ended' and end_reason in ('hung_up', 'safety_block', 'safety_enforcement', 'reconnect_expired', 'provider_failed', 'operator_terminated', 'encounter_ended')) or (state = 'expired' and end_reason in ('invitation_expired')) or (state = 'rejected' and end_reason in ('declined')) or (state = 'cancelled' and end_reason in ('withdrawn')) or (state = 'failed' and end_reason in ('provider_unavailable', 'provider_failed', 'join_timeout')));
