CREATE TABLE "realtime_participants" (
	"accepted_at" timestamp with time zone,
	"id" bigserial PRIMARY KEY NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"role" text NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "realtime_participants_role_check" CHECK ("realtime_participants"."role" in ('caller', 'recipient')),
	CONSTRAINT "realtime_participants_accepted_order_check" CHECK ("realtime_participants"."accepted_at" is null or "realtime_participants"."accepted_at" >= "realtime_participants"."invited_at"),
	CONSTRAINT "realtime_participants_joined_order_check" CHECK ("realtime_participants"."joined_at" is null or "realtime_participants"."joined_at" >= "realtime_participants"."invited_at"),
	CONSTRAINT "realtime_participants_left_shape_check" CHECK ("realtime_participants"."left_at" is null or "realtime_participants"."joined_at" is not null),
	CONSTRAINT "realtime_participants_left_order_check" CHECK ("realtime_participants"."left_at" is null or "realtime_participants"."left_at" >= "realtime_participants"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "realtime_sessions" (
	"accepted_at" timestamp with time zone,
	"authorization_generation" integer DEFAULT 1 NOT NULL,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"end_reason" text,
	"ended_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"initiator_id" uuid NOT NULL,
	"invitation_expires_at" timestamp with time zone NOT NULL,
	"medium" text NOT NULL,
	"origin_introduction_id" uuid NOT NULL,
	"pair_high_id" uuid NOT NULL,
	"pair_low_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "realtime_sessions_state_check" CHECK ("realtime_sessions"."state" in ('invited', 'accepted', 'connecting', 'active', 'reconnecting', 'ending', 'ended', 'expired', 'rejected', 'cancelled', 'failed')),
	CONSTRAINT "realtime_sessions_medium_check" CHECK ("realtime_sessions"."medium" in ('voice', 'video')),
	CONSTRAINT "realtime_sessions_end_reason_check" CHECK ("realtime_sessions"."end_reason" is null or "realtime_sessions"."end_reason" in ('hung_up', 'declined', 'withdrawn', 'invitation_expired', 'safety_block', 'safety_enforcement', 'reconnect_expired', 'provider_unavailable', 'provider_failed', 'join_timeout', 'operator_terminated')),
	CONSTRAINT "realtime_sessions_pair_order_check" CHECK ("realtime_sessions"."pair_low_id" < "realtime_sessions"."pair_high_id"),
	CONSTRAINT "realtime_sessions_initiator_check" CHECK ("realtime_sessions"."initiator_id" in ("realtime_sessions"."pair_low_id", "realtime_sessions"."pair_high_id")),
	CONSTRAINT "realtime_sessions_generation_check" CHECK ("realtime_sessions"."authorization_generation" >= 1),
	CONSTRAINT "realtime_sessions_terminal_shape_check" CHECK (("realtime_sessions"."state" = any (array['ended', 'expired', 'rejected', 'cancelled', 'failed']::text[])) = ("realtime_sessions"."ended_at" is not null)),
	CONSTRAINT "realtime_sessions_end_reason_shape_check" CHECK (("realtime_sessions"."ended_at" is null) = ("realtime_sessions"."end_reason" is null)),
	CONSTRAINT "realtime_sessions_accepted_order_check" CHECK ("realtime_sessions"."accepted_at" is null or "realtime_sessions"."accepted_at" >= "realtime_sessions"."created_at"),
	CONSTRAINT "realtime_sessions_connected_order_check" CHECK ("realtime_sessions"."connected_at" is null or "realtime_sessions"."accepted_at" is not null),
	CONSTRAINT "realtime_sessions_ended_order_check" CHECK ("realtime_sessions"."ended_at" is null or "realtime_sessions"."ended_at" >= "realtime_sessions"."created_at"),
	CONSTRAINT "realtime_sessions_connected_after_accepted_check" CHECK ("realtime_sessions"."connected_at" is null or "realtime_sessions"."connected_at" >= "realtime_sessions"."accepted_at")
);
--> statement-breakpoint
ALTER TABLE "realtime_participants" ADD CONSTRAINT "realtime_participants_session_id_realtime_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."realtime_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_participants_membership_uk" ON "realtime_participants" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_participants_role_uk" ON "realtime_participants" USING btree ("session_id","role");--> statement-breakpoint
CREATE INDEX "realtime_participants_user_idx" ON "realtime_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_sessions_live_pair_uk" ON "realtime_sessions" USING btree ("pair_low_id","pair_high_id") WHERE "realtime_sessions"."state" <> all (array['ended', 'expired', 'rejected', 'cancelled', 'failed']::text[]);--> statement-breakpoint
CREATE INDEX "realtime_sessions_live_low_idx" ON "realtime_sessions" USING btree ("pair_low_id") WHERE "realtime_sessions"."state" <> all (array['ended', 'expired', 'rejected', 'cancelled', 'failed']::text[]);--> statement-breakpoint
CREATE INDEX "realtime_sessions_live_high_idx" ON "realtime_sessions" USING btree ("pair_high_id") WHERE "realtime_sessions"."state" <> all (array['ended', 'expired', 'rejected', 'cancelled', 'failed']::text[]);--> statement-breakpoint
CREATE INDEX "realtime_sessions_invitation_deadline_idx" ON "realtime_sessions" USING btree ("invitation_expires_at") WHERE "realtime_sessions"."state" = 'invited';--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_sessions_sequence_uk" ON "realtime_sessions" USING btree ("sequence");
