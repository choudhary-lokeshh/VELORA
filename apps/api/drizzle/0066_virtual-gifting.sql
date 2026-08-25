CREATE TABLE "billing_gift_catalog_items" (
	"created_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"state" text NOT NULL,
	"tier" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"visual" text NOT NULL,
	CONSTRAINT "billing_gift_catalog_state_check" CHECK ("billing_gift_catalog_items"."state" in ('active', 'inactive')),
	CONSTRAINT "billing_gift_catalog_tier_check" CHECK ("billing_gift_catalog_items"."tier" in ('small', 'medium', 'large', 'signature')),
	CONSTRAINT "billing_gift_catalog_visual_check" CHECK ("billing_gift_catalog_items"."visual" in ('rose', 'spark', 'heart', 'crown', 'celebration', 'diamond', 'star', 'ribbon')),
	CONSTRAINT "billing_gift_catalog_name_check" CHECK (char_length("billing_gift_catalog_items"."name") between 1 and 48),
	CONSTRAINT "billing_gift_catalog_description_check" CHECK (char_length("billing_gift_catalog_items"."description") between 1 and 160),
	CONSTRAINT "billing_gift_catalog_sort_check" CHECK ("billing_gift_catalog_items"."sort_order" >= 0)
);
--> statement-breakpoint
INSERT INTO "billing_gift_catalog_items" ("created_at", "description", "id", "name", "sort_order", "state", "tier", "updated_at", "visual") VALUES
('2026-08-25T00:00:00.000Z', 'A small bloom of appreciation.', '10000000-0000-4000-8000-000000000001', 'Rose', 0, 'active', 'small', '2026-08-25T00:00:00.000Z', 'rose'),
('2026-08-25T00:00:00.000Z', 'A bright spark for a standout moment.', '10000000-0000-4000-8000-000000000002', 'Spark', 1, 'active', 'small', '2026-08-25T00:00:00.000Z', 'spark'),
('2026-08-25T00:00:00.000Z', 'A warm signal of support.', '10000000-0000-4000-8000-000000000003', 'Heart', 2, 'active', 'medium', '2026-08-25T00:00:00.000Z', 'heart'),
('2026-08-25T00:00:00.000Z', 'A celebratory burst for work worth cheering.', '10000000-0000-4000-8000-000000000004', 'Celebration', 3, 'active', 'medium', '2026-08-25T00:00:00.000Z', 'celebration'),
('2026-08-25T00:00:00.000Z', 'A star for something exceptional.', '10000000-0000-4000-8000-000000000005', 'Star', 4, 'active', 'large', '2026-08-25T00:00:00.000Z', 'star'),
('2026-08-25T00:00:00.000Z', 'A ribbon for a milestone moment.', '10000000-0000-4000-8000-000000000006', 'Ribbon', 5, 'active', 'large', '2026-08-25T00:00:00.000Z', 'ribbon'),
('2026-08-25T00:00:00.000Z', 'A crown for a creator at their best.', '10000000-0000-4000-8000-000000000007', 'Crown', 6, 'active', 'signature', '2026-08-25T00:00:00.000Z', 'crown'),
('2026-08-25T00:00:00.000Z', 'A signature gift for unforgettable work.', '10000000-0000-4000-8000-000000000008', 'Diamond', 7, 'active', 'signature', '2026-08-25T00:00:00.000Z', 'diamond');
--> statement-breakpoint
CREATE TABLE "billing_gifts" (
	"catalog_item_id" uuid NOT NULL,
	"context_type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"offer_id" uuid NOT NULL,
	"payment_id" uuid,
	"recipient_creator_id" uuid NOT NULL,
	"recipient_display_name" text NOT NULL,
	"recipient_handle" text NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"reversed_at" timestamp with time zone,
	"sender_user_id" uuid NOT NULL,
	"sent_at" timestamp with time zone,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_gifts_state_check" CHECK ("billing_gifts"."state" in ('pending', 'sent', 'failed', 'partially_reversed', 'reversed')),
	CONSTRAINT "billing_gifts_context_check" CHECK ("billing_gifts"."context_type" in ('creator_profile')),
	CONSTRAINT "billing_gifts_idempotency_key_check" CHECK (char_length("billing_gifts"."idempotency_key") between 8 and 128),
	CONSTRAINT "billing_gifts_distinct_people_check" CHECK ("billing_gifts"."sender_user_id" <> "billing_gifts"."recipient_user_id"),
	CONSTRAINT "billing_gifts_recipient_name_check" CHECK (char_length("billing_gifts"."recipient_display_name") between 1 and 80),
	CONSTRAINT "billing_gifts_recipient_handle_check" CHECK (char_length("billing_gifts"."recipient_handle") between 3 and 32),
	CONSTRAINT "billing_gifts_version_check" CHECK ("billing_gifts"."version" >= 1),
	CONSTRAINT "billing_gifts_sent_shape_check" CHECK (("billing_gifts"."state" in ('sent', 'partially_reversed', 'reversed')) = ("billing_gifts"."sent_at" is not null)),
	CONSTRAINT "billing_gifts_reversed_shape_check" CHECK (("billing_gifts"."state" = 'reversed') = ("billing_gifts"."reversed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "billing_offers" DROP CONSTRAINT "billing_offers_resource_type_check";--> statement-breakpoint
DROP INDEX "billing_offers_live_uk";--> statement-breakpoint
ALTER TABLE "billing_gifts" ADD CONSTRAINT "billing_gifts_catalog_item_id_billing_gift_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."billing_gift_catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_gifts" ADD CONSTRAINT "billing_gifts_offer_id_billing_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."billing_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_gifts" ADD CONSTRAINT "billing_gifts_payment_id_billing_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."billing_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_gift_catalog_sort_uk" ON "billing_gift_catalog_items" USING btree ("sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_gifts_sender_idempotency_uk" ON "billing_gifts" USING btree ("sender_user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_gifts_payment_uk" ON "billing_gifts" USING btree ("payment_id") WHERE "billing_gifts"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX "billing_gifts_sender_history_idx" ON "billing_gifts" USING btree ("sender_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "billing_gifts_recipient_history_idx" ON "billing_gifts" USING btree ("recipient_creator_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_offers_live_uk" ON "billing_offers" USING btree ("creator_id","resource_type","resource_id","commercial_mode") WHERE "billing_offers"."state" <> 'retired';--> statement-breakpoint
ALTER TABLE "billing_offers" ADD CONSTRAINT "billing_offers_resource_type_check" CHECK ("billing_offers"."resource_type" in ('club', 'gift'));
--> statement-breakpoint
CREATE FUNCTION public.velora_billing_gift_catalog_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.sort_order IS DISTINCT FROM OLD.sort_order
     OR NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.visual IS DISTINCT FROM OLD.visual THEN
    RAISE EXCEPTION 'a gift catalog identity is frozen; retire it and publish a new item';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_gift_catalog_frozen
BEFORE UPDATE ON billing_gift_catalog_items
FOR EACH ROW EXECUTE FUNCTION public.velora_billing_gift_catalog_frozen();
--> statement-breakpoint
CREATE TRIGGER billing_gift_catalog_retain
BEFORE DELETE ON billing_gift_catalog_items
FOR EACH ROW EXECUTE FUNCTION public.velora_billing_reject_delete();
--> statement-breakpoint
CREATE FUNCTION public.velora_billing_gift_relationships() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM billing_offers
     WHERE id = NEW.offer_id
       AND creator_id = NEW.recipient_creator_id
       AND resource_type = 'gift'
       AND resource_id = NEW.catalog_item_id
       AND commercial_mode = 'one_time'
  ) THEN
    RAISE EXCEPTION 'a gift must name its recipient catalog offer';
  END IF;

  IF NEW.payment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM billing_payments
     WHERE id = NEW.payment_id
       AND offer_id = NEW.offer_id
       AND consumer_id = NEW.sender_user_id
  ) THEN
    RAISE EXCEPTION 'a gift payment must belong to its sender and offer';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_gift_relationships
BEFORE INSERT OR UPDATE ON billing_gifts
FOR EACH ROW EXECUTE FUNCTION public.velora_billing_gift_relationships();
--> statement-breakpoint
CREATE FUNCTION public.velora_billing_gift_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.catalog_item_id IS DISTINCT FROM OLD.catalog_item_id
     OR NEW.context_type IS DISTINCT FROM OLD.context_type
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.recipient_creator_id IS DISTINCT FROM OLD.recipient_creator_id
     OR NEW.recipient_display_name IS DISTINCT FROM OLD.recipient_display_name
     OR NEW.recipient_handle IS DISTINCT FROM OLD.recipient_handle
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
     OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS DISTINCT FROM OLD.payment_id)
     OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at)
     OR (OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at) THEN
    RAISE EXCEPTION 'a gift operation is frozen: only its lifecycle may advance';
  END IF;

  IF NOT (
    (OLD.state = 'pending' AND NEW.state IN ('pending', 'sent', 'failed'))
    OR (OLD.state = 'sent' AND NEW.state IN ('sent', 'partially_reversed', 'reversed'))
    OR (OLD.state = 'partially_reversed' AND NEW.state IN ('partially_reversed', 'reversed'))
    OR (OLD.state = 'failed' AND NEW.state = 'failed')
    OR (OLD.state = 'reversed' AND NEW.state = 'reversed')
  ) THEN
    RAISE EXCEPTION 'a gift lifecycle cannot move backward';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'a gift lifecycle update must advance its version exactly once';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_gift_frozen
BEFORE UPDATE ON billing_gifts
FOR EACH ROW EXECUTE FUNCTION public.velora_billing_gift_frozen();
--> statement-breakpoint
CREATE TRIGGER billing_gift_retain
BEFORE DELETE ON billing_gifts
FOR EACH ROW EXECUTE FUNCTION public.velora_billing_reject_delete();
