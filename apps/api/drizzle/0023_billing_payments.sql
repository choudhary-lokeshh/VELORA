CREATE TABLE "billing_payments" (
	"amount_minor" bigint NOT NULL,
	"consumer_id" uuid NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_provider_sync_at" timestamp with time zone,
	"offer_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"provider_reference" text,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_payments_state_check" CHECK ("billing_payments"."state" in ('created', 'provider_pending', 'requires_action', 'succeeded', 'failed', 'cancelled', 'reconciliation_pending')),
	CONSTRAINT "billing_payments_amount_check" CHECK ("billing_payments"."amount_minor" > 0),
	CONSTRAINT "billing_payments_currency_check" CHECK ("billing_payments"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_payments_failure_reason_check" CHECK ("billing_payments"."failure_reason" is null or "billing_payments"."failure_reason" in ('declined', 'cancelled_by_consumer', 'expired', 'provider_error')),
	CONSTRAINT "billing_payments_failure_shape_check" CHECK ("billing_payments"."failure_reason" is null or "billing_payments"."state" in ('failed', 'cancelled')),
	CONSTRAINT "billing_payments_settled_reference_check" CHECK ("billing_payments"."state" <> 'succeeded' or "billing_payments"."provider_reference" is not null),
	CONSTRAINT "billing_payments_idempotency_key_check" CHECK (char_length("billing_payments"."idempotency_key") between 8 and 128),
	CONSTRAINT "billing_payments_provider_key_check" CHECK (char_length("billing_payments"."provider_idempotency_key") between 8 and 200),
	CONSTRAINT "billing_payments_provider_reference_check" CHECK ("billing_payments"."provider_reference" is null or char_length("billing_payments"."provider_reference") between 1 and 200),
	CONSTRAINT "billing_payments_version_check" CHECK ("billing_payments"."version" >= 1)
);
--> statement-breakpoint
-- The foreign-key target has to exist before the key that references it.
ALTER TABLE "billing_prices" ADD CONSTRAINT "billing_prices_currency_uk" UNIQUE("id","currency");--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_price_fk" FOREIGN KEY ("price_id","currency") REFERENCES "public"."billing_prices"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_offer_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."billing_offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payments_idempotency_uk" ON "billing_payments" USING btree ("consumer_id","offer_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payments_provider_key_uk" ON "billing_payments" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payments_provider_reference_uk" ON "billing_payments" USING btree ("provider","provider_reference") WHERE "billing_payments"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "billing_payments_consumer_idx" ON "billing_payments" USING btree ("consumer_id","created_at","id");--> statement-breakpoint
CREATE INDEX "billing_payments_unsettled_idx" ON "billing_payments" USING btree ("updated_at","id") WHERE "billing_payments"."state" in ('created', 'provider_pending', 'requires_action', 'reconciliation_pending');--> statement-breakpoint
CREATE INDEX "billing_payments_offer_idx" ON "billing_payments" USING btree ("offer_id","created_at");--> statement-breakpoint
-- What a payment operation says about money is decided once and never edited.
--
-- The consumer, the offer, the price, the snapshot amount and currency, both
-- idempotency keys, and the provider are all frozen at insert. Only the
-- lifecycle moves: state, failure reason, the provider's reference once it
-- gives one, the reconciliation timestamp, and the version. Without this, a bug
-- or a manual repair could change what somebody was charged for after the fact,
-- and every receipt already issued would quietly disagree with the record.
--
-- A provider reference may be set once and never changed to a different one:
-- two provider objects for one operation would mean two claims on the same
-- money, and re-pointing an operation at a different charge is the shape a
-- fabricated settlement would take.
CREATE OR REPLACE FUNCTION velora_billing_payment_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.amount_minor IS DISTINCT FROM old.amount_minor
     OR new.consumer_id IS DISTINCT FROM old.consumer_id
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.currency IS DISTINCT FROM old.currency
     OR new.id IS DISTINCT FROM old.id
     OR new.idempotency_key IS DISTINCT FROM old.idempotency_key
     OR new.offer_id IS DISTINCT FROM old.offer_id
     OR new.price_id IS DISTINCT FROM old.price_id
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_idempotency_key IS DISTINCT FROM old.provider_idempotency_key THEN
    RAISE EXCEPTION 'a payment operation is frozen: only its lifecycle may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF old.provider_reference IS NOT NULL
     AND new.provider_reference IS DISTINCT FROM old.provider_reference THEN
    RAISE EXCEPTION 'a payment operation keeps the provider object it was given'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_payments_frozen"
BEFORE UPDATE ON "billing_payments"
FOR EACH ROW EXECUTE FUNCTION velora_billing_payment_frozen();--> statement-breakpoint
CREATE TRIGGER "billing_payments_retained"
BEFORE DELETE ON "billing_payments"
FOR EACH ROW EXECUTE FUNCTION velora_billing_reject_delete();
