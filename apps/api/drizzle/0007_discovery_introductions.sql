CREATE TABLE "discovery_introductions" (
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"initiator_id" uuid NOT NULL,
	"mutual_at" timestamp with time zone,
	"pair_high_id" uuid NOT NULL,
	"pair_low_id" uuid NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "discovery_introductions_state_check" CHECK ("discovery_introductions"."state" in ('pending', 'mutual', 'closed')),
	CONSTRAINT "discovery_introductions_pair_order_check" CHECK ("discovery_introductions"."pair_low_id" < "discovery_introductions"."pair_high_id"),
	CONSTRAINT "discovery_introductions_initiator_check" CHECK ("discovery_introductions"."initiator_id" in ("discovery_introductions"."pair_low_id", "discovery_introductions"."pair_high_id")),
	CONSTRAINT "discovery_introductions_closure_shape_check" CHECK (("discovery_introductions"."state" = 'closed') = ("discovery_introductions"."closed_at" is not null) and ("discovery_introductions"."closed_at" is null) = ("discovery_introductions"."closed_reason" is null)),
	CONSTRAINT "discovery_introductions_mutual_shape_check" CHECK (("discovery_introductions"."state" = 'mutual') = ("discovery_introductions"."mutual_at" is not null)),
	CONSTRAINT "discovery_introductions_version_check" CHECK ("discovery_introductions"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_introductions_live_pair_uk" ON "discovery_introductions" USING btree ("pair_low_id","pair_high_id") WHERE "discovery_introductions"."state" <> 'closed';--> statement-breakpoint
CREATE INDEX "discovery_introductions_low_idx" ON "discovery_introductions" USING btree ("pair_low_id","state");--> statement-breakpoint
CREATE INDEX "discovery_introductions_high_idx" ON "discovery_introductions" USING btree ("pair_high_id","state");
