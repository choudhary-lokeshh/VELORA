CREATE TABLE "ai_capability_activations" (
	"capability" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"environment" text NOT NULL,
	"output_schema_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"safety_version" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_capability_activations_environment_capability_pk" PRIMARY KEY("environment","capability"),
	CONSTRAINT "ai_capability_activations_environment_check" CHECK ("ai_capability_activations"."environment" in ('local', 'test', 'staging', 'production'))
);
--> statement-breakpoint
CREATE TABLE "ai_run_events" (
	"created_at" timestamp with time zone NOT NULL,
	"event" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"reason_code" text,
	"run_id" uuid NOT NULL,
	CONSTRAINT "ai_run_events_event_check" CHECK ("ai_run_events"."event" in ('admitted', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ai_run_events_reason_check" CHECK (("ai_run_events"."event" = 'failed') = ("ai_run_events"."reason_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"actor_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"capability" text NOT NULL,
	"completed_at" timestamp with time zone,
	"correlation_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"estimated_cost_microunits" integer DEFAULT 0 NOT NULL,
	"failure_code" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"input_characters" integer NOT NULL,
	"input_digest" text NOT NULL,
	"model_id" text NOT NULL,
	"output_characters" integer DEFAULT 0 NOT NULL,
	"output_digest" text,
	"output_schema_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"provider_id" text NOT NULL,
	"safety_version" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	CONSTRAINT "ai_runs_state_check" CHECK ("ai_runs"."state" in ('running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "ai_runs_input_digest_check" CHECK ("ai_runs"."input_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_runs_output_digest_check" CHECK ("ai_runs"."output_digest" is null or "ai_runs"."output_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_runs_measurements_check" CHECK ("ai_runs"."input_characters" >= 0 and "ai_runs"."output_characters" >= 0 and "ai_runs"."estimated_cost_microunits" >= 0),
	CONSTRAINT "ai_runs_terminal_shape_check" CHECK (("ai_runs"."state" = 'running' and "ai_runs"."completed_at" is null and "ai_runs"."cancelled_at" is null and "ai_runs"."output_characters" = 0 and "ai_runs"."output_digest" is null and "ai_runs"."estimated_cost_microunits" = 0 and "ai_runs"."failure_code" is null) or
          ("ai_runs"."state" = 'succeeded' and "ai_runs"."completed_at" is not null and "ai_runs"."cancelled_at" is null and "ai_runs"."output_digest" is not null and "ai_runs"."failure_code" is null) or
          ("ai_runs"."state" = 'failed' and "ai_runs"."completed_at" is not null and "ai_runs"."cancelled_at" is null and "ai_runs"."output_characters" = 0 and "ai_runs"."output_digest" is null and "ai_runs"."estimated_cost_microunits" = 0 and "ai_runs"."failure_code" is not null) or
          ("ai_runs"."state" = 'cancelled' and "ai_runs"."completed_at" is not null and "ai_runs"."cancelled_at" is not null and "ai_runs"."output_characters" = 0 and "ai_runs"."output_digest" is null and "ai_runs"."estimated_cost_microunits" = 0 and "ai_runs"."failure_code" is null))
);
--> statement-breakpoint
CREATE TABLE "ai_usage_daily" (
	"actor_id" uuid NOT NULL,
	"day" date NOT NULL,
	"estimated_cost_microunits" integer DEFAULT 0 NOT NULL,
	"input_characters" integer DEFAULT 0 NOT NULL,
	"output_characters" integer DEFAULT 0 NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_usage_daily_actor_id_day_pk" PRIMARY KEY("actor_id","day"),
	CONSTRAINT "ai_usage_daily_counts_check" CHECK ("ai_usage_daily"."run_count" >= 0 and "ai_usage_daily"."input_characters" >= 0 and "ai_usage_daily"."output_characters" >= 0 and "ai_usage_daily"."estimated_cost_microunits" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_run_events" ADD CONSTRAINT "ai_run_events_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_run_events_run_idx" ON "ai_run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_actor_created_idx" ON "ai_runs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_active_idx" ON "ai_runs" USING btree ("created_at") WHERE "ai_runs"."state" = 'running';
--> statement-breakpoint
INSERT INTO "ai_capability_activations" (
  "capability", "enabled", "environment", "output_schema_version",
  "prompt_version", "safety_version", "updated_at"
)
SELECT capability, true, environment, 'suggestion.v1', '2026-08-26.1',
       'draft-safety.1', TIMESTAMPTZ '2026-08-26 00:00:00+00'
FROM unnest(ARRAY['local', 'test']) AS environment
CROSS JOIN unnest(ARRAY[
  'consumer_profile_bio', 'consumer_chat_reply', 'creator_profile_bio',
  'creator_content_caption', 'creator_content_title',
  'creator_content_description', 'creator_content_idea',
  'creator_club_announcement', 'admin_case_summary'
]) AS capability;
--> statement-breakpoint
CREATE FUNCTION ai_protect_run() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ai runs are retained audit records';
  END IF;
  IF OLD.state <> 'running' THEN
    RAISE EXCEPTION 'terminal ai runs are immutable';
  END IF;
  IF NEW.state = 'running' THEN
    RAISE EXCEPTION 'an ai run may only transition once to a terminal state';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.audience IS DISTINCT FROM OLD.audience
    OR NEW.capability IS DISTINCT FROM OLD.capability
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
    OR NEW.input_characters IS DISTINCT FROM OLD.input_characters
    OR NEW.input_digest IS DISTINCT FROM OLD.input_digest
    OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
    OR NEW.model_id IS DISTINCT FROM OLD.model_id
    OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
    OR NEW.output_schema_version IS DISTINCT FROM OLD.output_schema_version
    OR NEW.safety_version IS DISTINCT FROM OLD.safety_version THEN
    RAISE EXCEPTION 'ai run identity and release pins are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_runs_protect_trigger
BEFORE UPDATE OR DELETE ON "ai_runs"
FOR EACH ROW EXECUTE FUNCTION ai_protect_run();
--> statement-breakpoint
CREATE FUNCTION ai_protect_run_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'ai run events are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_run_events_protect_trigger
BEFORE UPDATE OR DELETE ON "ai_run_events"
FOR EACH ROW EXECUTE FUNCTION ai_protect_run_event();
