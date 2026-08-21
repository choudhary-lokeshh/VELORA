CREATE TABLE "realtime_provider_obligations" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"discharged_at" timestamp with time zone,
	"failure_reason" text,
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"participant_reference" text,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"session_id" uuid NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "realtime_provider_obligations_kind_check" CHECK ("realtime_provider_obligations"."kind" in ('create_session', 'revoke_participant', 'terminate_session')),
	CONSTRAINT "realtime_provider_obligations_state_check" CHECK ("realtime_provider_obligations"."state" in ('pending', 'discharged', 'abandoned')),
	CONSTRAINT "realtime_provider_obligations_attempts_check" CHECK ("realtime_provider_obligations"."attempts" >= 0),
	CONSTRAINT "realtime_provider_obligations_lease_shape_check" CHECK (("realtime_provider_obligations"."lease_owner" is null) = ("realtime_provider_obligations"."lease_expires_at" is null)),
	CONSTRAINT "realtime_provider_obligations_lease_state_check" CHECK ("realtime_provider_obligations"."lease_owner" is null or "realtime_provider_obligations"."state" = 'pending'),
	CONSTRAINT "realtime_provider_obligations_discharged_shape_check" CHECK (("realtime_provider_obligations"."state" = 'discharged') = ("realtime_provider_obligations"."discharged_at" is not null)),
	CONSTRAINT "realtime_provider_obligations_participant_shape_check" CHECK (("realtime_provider_obligations"."kind" = 'revoke_participant') = ("realtime_provider_obligations"."participant_reference" is not null)),
	CONSTRAINT "realtime_provider_obligations_reference_length_check" CHECK (char_length("realtime_provider_obligations"."provider_reference") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD COLUMN "provider_bound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD COLUMN "provider_idempotency_key" text;--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD COLUMN "provider_reference" text;--> statement-breakpoint
ALTER TABLE "realtime_provider_obligations" ADD CONSTRAINT "realtime_provider_obligations_session_id_realtime_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."realtime_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_provider_obligations_claimable_idx" ON "realtime_provider_obligations" USING btree ("id") WHERE "realtime_provider_obligations"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "realtime_provider_obligations_session_idx" ON "realtime_provider_obligations" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_sessions_provider_key_uk" ON "realtime_sessions" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_sessions_provider_reference_uk" ON "realtime_sessions" USING btree ("provider","provider_reference");--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_provider_binding_shape_check" CHECK (("realtime_sessions"."provider_reference" is null) = ("realtime_sessions"."provider_bound_at" is null));--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_provider_named_check" CHECK ("realtime_sessions"."provider_reference" is null or "realtime_sessions"."provider" is not null);--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_provider_reference_length_check" CHECK ("realtime_sessions"."provider_reference" is null or char_length("realtime_sessions"."provider_reference") between 1 and 200);--> statement-breakpoint
ALTER TABLE "realtime_sessions" ADD CONSTRAINT "realtime_sessions_provider_key_length_check" CHECK ("realtime_sessions"."provider_idempotency_key" is null or char_length("realtime_sessions"."provider_idempotency_key") between 1 and 200);
