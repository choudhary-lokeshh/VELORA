ALTER TABLE "discovery_introductions" DROP CONSTRAINT "discovery_introductions_mutual_shape_check";--> statement-breakpoint
ALTER TABLE "discovery_introductions" ADD CONSTRAINT "discovery_introductions_mutual_shape_check" CHECK (("discovery_introductions"."state" = 'mutual') <= ("discovery_introductions"."mutual_at" is not null)
        and ("discovery_introductions"."state" = 'pending') <= ("discovery_introductions"."mutual_at" is null));
