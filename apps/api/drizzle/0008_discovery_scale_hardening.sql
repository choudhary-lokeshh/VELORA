ALTER TABLE "discovery_introductions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users_availability" ADD COLUMN "available_since" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_introductions_live_pair_high_uk" ON "discovery_introductions" USING btree ("pair_high_id","pair_low_id") WHERE "discovery_introductions"."state" <> 'closed';--> statement-breakpoint
UPDATE "discovery_introductions" SET "expires_at" = "created_at" + interval '24 hours' WHERE "state" = 'pending' AND "expires_at" IS NULL;--> statement-breakpoint
UPDATE "users_availability" SET "available_since" = "updated_at" WHERE "state" = 'available' AND "available_since" IS NULL;--> statement-breakpoint
ALTER TABLE "discovery_introductions" ADD CONSTRAINT "discovery_introductions_closed_reason_check" CHECK ("discovery_introductions"."closed_reason" is null or "discovery_introductions"."closed_reason" in ('withdrawn', 'declined', 'expired', 'enforcement'));--> statement-breakpoint
ALTER TABLE "discovery_introductions" ADD CONSTRAINT "discovery_introductions_pending_expiry_check" CHECK (("discovery_introductions"."state" = 'pending') <= ("discovery_introductions"."expires_at" is not null));--> statement-breakpoint
ALTER TABLE "users_availability" ADD CONSTRAINT "users_availability_session_shape_check" CHECK (("users_availability"."state" = 'available') = ("users_availability"."available_since" is not null));
