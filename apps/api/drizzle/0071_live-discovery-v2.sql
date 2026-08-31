CREATE TABLE "live_invitations" (
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"inviter_id" uuid NOT NULL,
	"medium" text NOT NULL,
	"pair_high_id" uuid NOT NULL,
	"pair_low_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"sequence" bigserial NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "live_invitations_state_check" CHECK ("live_invitations"."state" in ('pending', 'accepted', 'met', 'declined', 'cancelled', 'expired')),
	CONSTRAINT "live_invitations_medium_check" CHECK ("live_invitations"."medium" in ('voice', 'video')),
	CONSTRAINT "live_invitations_pair_order_check" CHECK ("live_invitations"."pair_low_id" < "live_invitations"."pair_high_id"),
	CONSTRAINT "live_invitations_inviter_check" CHECK ("live_invitations"."inviter_id" in ("live_invitations"."pair_low_id", "live_invitations"."pair_high_id")),
	CONSTRAINT "live_invitations_resolved_shape_check" CHECK (("live_invitations"."state" in ('pending', 'accepted')) = ("live_invitations"."resolved_at" is null)),
	CONSTRAINT "live_invitations_expiry_order_check" CHECK ("live_invitations"."expires_at" > "live_invitations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "live_messages" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "live_participations" ADD COLUMN "preferred_language" text;--> statement-breakpoint
ALTER TABLE "live_participations" ADD COLUMN "preferred_region" text DEFAULT 'any' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "live_invitations_open_pair_uk" ON "live_invitations" USING btree ("pair_low_id","pair_high_id") WHERE "live_invitations"."state" in ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "live_invitations_low_open_idx" ON "live_invitations" USING btree ("pair_low_id","updated_at") WHERE "live_invitations"."state" in ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "live_invitations_high_open_idx" ON "live_invitations" USING btree ("pair_high_id","updated_at") WHERE "live_invitations"."state" in ('pending', 'accepted');--> statement-breakpoint
CREATE INDEX "live_invitations_inviter_recency_idx" ON "live_invitations" USING btree ("inviter_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_invitations_sequence_uk" ON "live_invitations" USING btree ("sequence");--> statement-breakpoint
ALTER TABLE "live_messages" ADD CONSTRAINT "live_messages_kind_check" CHECK ("live_messages"."kind" in ('text', 'reaction'));--> statement-breakpoint
ALTER TABLE "live_messages" ADD CONSTRAINT "live_messages_reaction_body_check" CHECK ("live_messages"."kind" <> 'reaction' or body in ('wave', 'smile', 'laugh', 'heart', 'fire', 'clap'));--> statement-breakpoint
ALTER TABLE "live_participations" ADD CONSTRAINT "live_participations_preferred_region_check" CHECK ("live_participations"."preferred_region" in ('any', 'same'));