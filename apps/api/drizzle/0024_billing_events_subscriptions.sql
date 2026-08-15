CREATE TABLE "billing_outbox" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"dispatched_at" timestamp with time zone,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"sequence" bigserial NOT NULL,
	"state" text NOT NULL,
	"subject_id" uuid,
	"subject_type" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_outbox_state_check" CHECK ("billing_outbox"."state" in ('pending', 'dispatched', 'dead_letter')),
	CONSTRAINT "billing_outbox_attempts_check" CHECK ("billing_outbox"."attempts" >= 0),
	CONSTRAINT "billing_outbox_lease_shape_check" CHECK (("billing_outbox"."lease_owner" is null) = ("billing_outbox"."lease_expires_at" is null)),
	CONSTRAINT "billing_outbox_lease_state_check" CHECK ("billing_outbox"."lease_owner" is null or "billing_outbox"."state" = 'pending'),
	CONSTRAINT "billing_outbox_dispatched_shape_check" CHECK (("billing_outbox"."state" = 'dispatched') = ("billing_outbox"."dispatched_at" is not null)),
	CONSTRAINT "billing_outbox_version_check" CHECK ("billing_outbox"."event_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "billing_provider_events" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_digest" text NOT NULL,
	"processed_at" timestamp with time zone,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_payment_reference" text,
	"received_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"status" text,
	CONSTRAINT "billing_provider_events_state_check" CHECK ("billing_provider_events"."state" in ('received', 'processed', 'ignored', 'retry_wait', 'dead_letter')),
	CONSTRAINT "billing_provider_events_digest_check" CHECK ("billing_provider_events"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "billing_provider_events_attempts_check" CHECK ("billing_provider_events"."attempts" >= 0),
	CONSTRAINT "billing_provider_events_event_id_check" CHECK (char_length("billing_provider_events"."provider_event_id") between 1 and 200),
	CONSTRAINT "billing_provider_events_event_type_check" CHECK (char_length("billing_provider_events"."event_type") between 1 and 120),
	CONSTRAINT "billing_provider_events_lease_shape_check" CHECK (("billing_provider_events"."lease_owner" is null) = ("billing_provider_events"."lease_expires_at" is null)),
	CONSTRAINT "billing_provider_events_lease_state_check" CHECK ("billing_provider_events"."lease_owner" is null or "billing_provider_events"."state" in ('received', 'retry_wait')),
	CONSTRAINT "billing_provider_events_processed_shape_check" CHECK (("billing_provider_events"."state" in ('processed', 'ignored')) = ("billing_provider_events"."processed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"amount_minor" bigint NOT NULL,
	"cancelled_at" timestamp with time zone,
	"consumer_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"offer_id" uuid NOT NULL,
	"origin_payment_id" uuid NOT NULL,
	"price_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_subscriptions_state_check" CHECK ("billing_subscriptions"."state" in ('pending', 'active', 'past_due', 'cancel_at_period_end', 'cancelled', 'terminated')),
	CONSTRAINT "billing_subscriptions_amount_check" CHECK ("billing_subscriptions"."amount_minor" > 0),
	CONSTRAINT "billing_subscriptions_currency_check" CHECK ("billing_subscriptions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_subscriptions_period_shape_check" CHECK (("billing_subscriptions"."current_period_start" is null) = ("billing_subscriptions"."current_period_end" is null)),
	CONSTRAINT "billing_subscriptions_period_order_check" CHECK ("billing_subscriptions"."current_period_end" is null or "billing_subscriptions"."current_period_end" > "billing_subscriptions"."current_period_start"),
	CONSTRAINT "billing_subscriptions_cancelled_shape_check" CHECK (("billing_subscriptions"."state" in ('cancelled', 'terminated')) = ("billing_subscriptions"."cancelled_at" is not null)),
	CONSTRAINT "billing_subscriptions_entitling_period_check" CHECK ("billing_subscriptions"."state" not in ('active', 'cancel_at_period_end') or "billing_subscriptions"."current_period_end" is not null),
	CONSTRAINT "billing_subscriptions_version_check" CHECK ("billing_subscriptions"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_price_fk" FOREIGN KEY ("price_id","currency") REFERENCES "public"."billing_prices"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_payment_fk" FOREIGN KEY ("origin_payment_id") REFERENCES "public"."billing_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_outbox_sequence_uk" ON "billing_outbox" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "billing_outbox_claimable_idx" ON "billing_outbox" USING btree ("sequence") WHERE "billing_outbox"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "billing_outbox_state_idx" ON "billing_outbox" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_provider_events_identity_uk" ON "billing_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "billing_provider_events_claimable_idx" ON "billing_provider_events" USING btree ("available_at","id") WHERE "billing_provider_events"."state" in ('received', 'retry_wait');--> statement-breakpoint
CREATE INDEX "billing_provider_events_reference_idx" ON "billing_provider_events" USING btree ("provider_payment_reference") WHERE "billing_provider_events"."provider_payment_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_live_uk" ON "billing_subscriptions" USING btree ("consumer_id","offer_id") WHERE "billing_subscriptions"."state" in ('pending', 'active', 'past_due', 'cancel_at_period_end');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_origin_uk" ON "billing_subscriptions" USING btree ("origin_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_provider_uk" ON "billing_subscriptions" USING btree ("provider","provider_reference") WHERE "billing_subscriptions"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "billing_subscriptions_consumer_idx" ON "billing_subscriptions" USING btree ("consumer_id","created_at","id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_offer_idx" ON "billing_subscriptions" USING btree ("offer_id","state");--> statement-breakpoint
-- A verified receipt is evidence, so what it says about the event is frozen.
--
-- Only the processing lifecycle moves: state, attempts, the lease, the retry
-- instant, the failure code, and when it settled. The provider, the event
-- identity, the type, the digest of the exact verified bytes, and when it was
-- received are what make the row evidence in the first place, and a repair that
-- could rewrite them could rewrite what arrived.
CREATE OR REPLACE FUNCTION velora_billing_event_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.event_type IS DISTINCT FROM old.event_type
     OR new.id IS DISTINCT FROM old.id
     OR new.occurred_at IS DISTINCT FROM old.occurred_at
     OR new.payload_digest IS DISTINCT FROM old.payload_digest
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_event_id IS DISTINCT FROM old.provider_event_id
     OR new.received_at IS DISTINCT FROM old.received_at THEN
    RAISE EXCEPTION 'a verified provider event is evidence: only its processing state may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_provider_events_frozen"
BEFORE UPDATE ON "billing_provider_events"
FOR EACH ROW EXECUTE FUNCTION velora_billing_event_frozen();--> statement-breakpoint
CREATE TRIGGER "billing_provider_events_retained"
BEFORE DELETE ON "billing_provider_events"
FOR EACH ROW EXECUTE FUNCTION velora_billing_reject_delete();--> statement-breakpoint
-- A subscription's money is frozen for the same reason a payment's is: it is
-- what somebody agreed to pay, and a later price change must not rewrite it.
CREATE OR REPLACE FUNCTION velora_billing_subscription_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.amount_minor IS DISTINCT FROM old.amount_minor
     OR new.consumer_id IS DISTINCT FROM old.consumer_id
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.currency IS DISTINCT FROM old.currency
     OR new.id IS DISTINCT FROM old.id
     OR new.offer_id IS DISTINCT FROM old.offer_id
     OR new.origin_payment_id IS DISTINCT FROM old.origin_payment_id
     OR new.price_id IS DISTINCT FROM old.price_id
     OR new.provider IS DISTINCT FROM old.provider THEN
    RAISE EXCEPTION 'a subscription is frozen: only its lifecycle and period may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_subscriptions_frozen"
BEFORE UPDATE ON "billing_subscriptions"
FOR EACH ROW EXECUTE FUNCTION velora_billing_subscription_frozen();--> statement-breakpoint
CREATE TRIGGER "billing_subscriptions_retained"
BEFORE DELETE ON "billing_subscriptions"
FOR EACH ROW EXECUTE FUNCTION velora_billing_reject_delete();
