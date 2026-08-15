CREATE TABLE "billing_offers" (
	"activated_at" timestamp with time zone,
	"commercial_mode" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"creator_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"resource_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"retired_at" timestamp with time zone,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_offers_mode_uk" UNIQUE("id","commercial_mode"),
	CONSTRAINT "billing_offers_state_check" CHECK ("billing_offers"."state" in ('draft', 'active', 'retired')),
	CONSTRAINT "billing_offers_mode_check" CHECK ("billing_offers"."commercial_mode" in ('subscription', 'one_time')),
	CONSTRAINT "billing_offers_resource_type_check" CHECK ("billing_offers"."resource_type" in ('club')),
	CONSTRAINT "billing_offers_draft_shape_check" CHECK ("billing_offers"."state" <> 'draft' or "billing_offers"."activated_at" is null),
	CONSTRAINT "billing_offers_activated_shape_check" CHECK ("billing_offers"."state" <> 'active' or "billing_offers"."activated_at" is not null),
	CONSTRAINT "billing_offers_retired_shape_check" CHECK (("billing_offers"."state" = 'retired') = ("billing_offers"."retired_at" is not null)),
	CONSTRAINT "billing_offers_version_check" CHECK ("billing_offers"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "billing_prices" (
	"amount_minor" bigint NOT NULL,
	"billing_interval" text,
	"commercial_mode" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"retired_at" timestamp with time zone,
	"state" text NOT NULL,
	CONSTRAINT "billing_prices_state_check" CHECK ("billing_prices"."state" in ('active', 'retired')),
	CONSTRAINT "billing_prices_amount_check" CHECK ("billing_prices"."amount_minor" > 0),
	CONSTRAINT "billing_prices_currency_check" CHECK ("billing_prices"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_prices_interval_check" CHECK ("billing_prices"."billing_interval" is null or "billing_prices"."billing_interval" in ('month', 'year')),
	CONSTRAINT "billing_prices_recurrence_shape_check" CHECK (("billing_prices"."commercial_mode" = 'subscription') = ("billing_prices"."billing_interval" is not null)),
	CONSTRAINT "billing_prices_retired_shape_check" CHECK (("billing_prices"."state" = 'retired') = ("billing_prices"."retired_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "billing_prices" ADD CONSTRAINT "billing_prices_offer_fk" FOREIGN KEY ("offer_id","commercial_mode") REFERENCES "public"."billing_offers"("id","commercial_mode") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_offers_live_uk" ON "billing_offers" USING btree ("resource_type","resource_id","commercial_mode") WHERE "billing_offers"."state" <> 'retired';--> statement-breakpoint
CREATE INDEX "billing_offers_creator_idx" ON "billing_offers" USING btree ("creator_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_prices_live_uk" ON "billing_prices" USING btree ("offer_id","currency") WHERE "billing_prices"."state" = 'active';--> statement-breakpoint
CREATE INDEX "billing_prices_offer_idx" ON "billing_prices" USING btree ("offer_id","created_at","id");--> statement-breakpoint
-- A price is a money fact, so the parts of it that mean money are frozen.
--
-- Only the lifecycle may move: retiring a price sets its state and the instant
-- it stopped applying. The amount, the currency, the cadence, the offer it
-- belongs to, and when it took effect cannot change at all, because a purchase
-- references the exact row it was made against and an edit here would rewrite
-- what somebody agreed to pay long after they agreed to it.
CREATE OR REPLACE FUNCTION velora_billing_price_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.amount_minor IS DISTINCT FROM old.amount_minor
     OR new.billing_interval IS DISTINCT FROM old.billing_interval
     OR new.commercial_mode IS DISTINCT FROM old.commercial_mode
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.currency IS DISTINCT FROM old.currency
     OR new.effective_from IS DISTINCT FROM old.effective_from
     OR new.id IS DISTINCT FROM old.id
     OR new.offer_id IS DISTINCT FROM old.offer_id THEN
    RAISE EXCEPTION 'a published price is frozen: only its lifecycle may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
-- Deleting a price would orphan every purchase made under it, and deleting an
-- offer would orphan its prices. Withdrawal is a lifecycle state, never a
-- removal.
CREATE OR REPLACE FUNCTION velora_billing_reject_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'commercial records are retained: % on % is not permitted', tg_op, tg_table_name
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_prices_frozen"
BEFORE UPDATE ON "billing_prices"
FOR EACH ROW EXECUTE FUNCTION velora_billing_price_frozen();--> statement-breakpoint
CREATE TRIGGER "billing_prices_retained"
BEFORE DELETE ON "billing_prices"
FOR EACH ROW EXECUTE FUNCTION velora_billing_reject_delete();--> statement-breakpoint
CREATE TRIGGER "billing_offers_retained"
BEFORE DELETE ON "billing_offers"
FOR EACH ROW EXECUTE FUNCTION velora_billing_reject_delete();
