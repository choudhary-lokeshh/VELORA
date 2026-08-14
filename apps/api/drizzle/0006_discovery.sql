CREATE TABLE "discovery_passes" (
	"candidate_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"passed_at" timestamp with time zone NOT NULL,
	"viewer_id" uuid NOT NULL,
	CONSTRAINT "discovery_passes_not_self_check" CHECK ("discovery_passes"."viewer_id" <> "discovery_passes"."candidate_id"),
	CONSTRAINT "discovery_passes_expiry_check" CHECK ("discovery_passes"."expires_at" > "discovery_passes"."passed_at")
);
--> statement-breakpoint
CREATE TABLE "discovery_presentations" (
	"candidate_id" uuid NOT NULL,
	"first_shown_at" timestamp with time zone NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"last_shown_at" timestamp with time zone NOT NULL,
	"ranking_version" text NOT NULL,
	"show_count" integer NOT NULL,
	"viewer_id" uuid NOT NULL,
	CONSTRAINT "discovery_presentations_show_count_check" CHECK ("discovery_presentations"."show_count" >= 1),
	CONSTRAINT "discovery_presentations_not_self_check" CHECK ("discovery_presentations"."viewer_id" <> "discovery_presentations"."candidate_id"),
	CONSTRAINT "discovery_presentations_order_check" CHECK ("discovery_presentations"."last_shown_at" >= "discovery_presentations"."first_shown_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_passes_pair_uk" ON "discovery_passes" USING btree ("viewer_id","candidate_id");--> statement-breakpoint
CREATE INDEX "discovery_passes_active_idx" ON "discovery_passes" USING btree ("viewer_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_presentations_pair_uk" ON "discovery_presentations" USING btree ("viewer_id","candidate_id");
