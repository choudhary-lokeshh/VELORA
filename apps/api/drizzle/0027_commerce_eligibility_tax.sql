ALTER TABLE "billing_payments" ADD COLUMN "tax_authority" text;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD COLUMN "tax_minor" bigint;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_tax_shape_check" CHECK (("billing_payments"."tax_minor" is null) = ("billing_payments"."tax_authority" is null));--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_tax_range_check" CHECK ("billing_payments"."tax_minor" is null or ("billing_payments"."tax_minor" >= 0 and "billing_payments"."tax_minor" <= "billing_payments"."amount_minor"));--> statement-breakpoint
-- A tax assessment is evidence, so it is frozen with the rest of what the
-- purchase meant.
--
-- The freeze from `0023` is replaced with one covering the two columns this
-- migration adds. Recomputing a historical sale against today's rates, or
-- repairing an old assessment in place, would silently rewrite what somebody
-- was charged — and a rate change is precisely the event that makes somebody
-- want to. A correction is a new record referencing the old one, exactly as it
-- is everywhere else in these books.
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
     OR new.provider_idempotency_key IS DISTINCT FROM old.provider_idempotency_key
     OR new.tax_authority IS DISTINCT FROM old.tax_authority
     OR new.tax_minor IS DISTINCT FROM old.tax_minor THEN
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
$$;
