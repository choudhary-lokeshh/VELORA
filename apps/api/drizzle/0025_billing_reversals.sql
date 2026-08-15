CREATE TABLE "billing_disputes" (
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"evidence_due_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text NOT NULL,
	"reason_code" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_disputes_state_check" CHECK ("billing_disputes"."state" in ('opened', 'under_review', 'won', 'lost', 'withdrawn')),
	CONSTRAINT "billing_disputes_reason_check" CHECK ("billing_disputes"."reason_code" in ('unrecognized', 'product_not_received', 'product_unacceptable', 'duplicate', 'fraudulent', 'subscription_cancelled', 'other')),
	CONSTRAINT "billing_disputes_amount_check" CHECK ("billing_disputes"."amount_minor" > 0),
	CONSTRAINT "billing_disputes_currency_check" CHECK ("billing_disputes"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_disputes_resolved_shape_check" CHECK (("billing_disputes"."state" in ('won', 'lost', 'withdrawn')) = ("billing_disputes"."resolved_at" is not null)),
	CONSTRAINT "billing_disputes_provider_reference_check" CHECK (char_length("billing_disputes"."provider_reference") between 1 and 200),
	CONSTRAINT "billing_disputes_version_check" CHECK ("billing_disputes"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "billing_refunds" (
	"amount_minor" bigint NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"initiated_by" text NOT NULL,
	"last_provider_sync_at" timestamp with time zone,
	"payment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"provider_reference" text,
	"reason_code" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "billing_refunds_state_check" CHECK ("billing_refunds"."state" in ('requested', 'provider_pending', 'succeeded', 'failed', 'reconciliation_pending')),
	CONSTRAINT "billing_refunds_reason_check" CHECK ("billing_refunds"."reason_code" in ('duplicate_charge', 'not_delivered', 'operator_correction', 'dispute_resolution')),
	CONSTRAINT "billing_refunds_amount_check" CHECK ("billing_refunds"."amount_minor" > 0),
	CONSTRAINT "billing_refunds_currency_check" CHECK ("billing_refunds"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_refunds_failure_reason_check" CHECK ("billing_refunds"."failure_reason" is null or "billing_refunds"."failure_reason" in ('declined', 'provider_error')),
	CONSTRAINT "billing_refunds_failure_shape_check" CHECK ("billing_refunds"."failure_reason" is null or "billing_refunds"."state" = 'failed'),
	CONSTRAINT "billing_refunds_settled_reference_check" CHECK ("billing_refunds"."state" <> 'succeeded' or "billing_refunds"."provider_reference" is not null),
	CONSTRAINT "billing_refunds_idempotency_key_check" CHECK (char_length("billing_refunds"."idempotency_key") between 8 and 128),
	CONSTRAINT "billing_refunds_provider_key_check" CHECK (char_length("billing_refunds"."provider_idempotency_key") between 8 and 200),
	CONSTRAINT "billing_refunds_provider_reference_check" CHECK ("billing_refunds"."provider_reference" is null or char_length("billing_refunds"."provider_reference") between 1 and 200),
	CONSTRAINT "billing_refunds_initiated_by_check" CHECK (char_length("billing_refunds"."initiated_by") between 1 and 200),
	CONSTRAINT "billing_refunds_version_check" CHECK ("billing_refunds"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD COLUMN "evidence_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD COLUMN "provider_dispute_reference" text;--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD COLUMN "provider_refund_reference" text;--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD COLUMN "reason_code" text;--> statement-breakpoint
-- Hand-ordered ahead of the two foreign keys below, which reference it. The
-- generator emits constraints in table order, and PostgreSQL will not accept a
-- composite foreign key whose target has no matching unique constraint yet.
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_currency_uk" UNIQUE("id","currency");--> statement-breakpoint
ALTER TABLE "billing_disputes" ADD CONSTRAINT "billing_disputes_payment_fk" FOREIGN KEY ("payment_id","currency") REFERENCES "public"."billing_payments"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_refunds" ADD CONSTRAINT "billing_refunds_payment_fk" FOREIGN KEY ("payment_id","currency") REFERENCES "public"."billing_payments"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_disputes_provider_uk" ON "billing_disputes" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "billing_disputes_payment_idx" ON "billing_disputes" USING btree ("payment_id","opened_at");--> statement-breakpoint
CREATE INDEX "billing_disputes_open_idx" ON "billing_disputes" USING btree ("evidence_due_at","id") WHERE "billing_disputes"."state" in ('opened', 'under_review');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refunds_idempotency_uk" ON "billing_refunds" USING btree ("payment_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refunds_provider_key_uk" ON "billing_refunds" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refunds_provider_reference_uk" ON "billing_refunds" USING btree ("provider","provider_reference") WHERE "billing_refunds"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "billing_refunds_payment_idx" ON "billing_refunds" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_refunds_unsettled_idx" ON "billing_refunds" USING btree ("updated_at","id") WHERE "billing_refunds"."state" in ('requested', 'provider_pending', 'reconciliation_pending');--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD CONSTRAINT "billing_provider_events_amount_shape_check" CHECK (("billing_provider_events"."amount_minor" is null) = ("billing_provider_events"."currency" is null));--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD CONSTRAINT "billing_provider_events_amount_check" CHECK ("billing_provider_events"."amount_minor" is null or "billing_provider_events"."amount_minor" > 0);--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD CONSTRAINT "billing_provider_events_currency_check" CHECK ("billing_provider_events"."currency" is null or "billing_provider_events"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD CONSTRAINT "billing_provider_events_reason_code_check" CHECK ("billing_provider_events"."reason_code" is null or "billing_provider_events"."reason_code" in ('unrecognized', 'product_not_received', 'product_unacceptable', 'duplicate', 'fraudulent', 'subscription_cancelled', 'other'));--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD CONSTRAINT "billing_provider_events_refund_reference_check" CHECK ("billing_provider_events"."provider_refund_reference" is null or char_length("billing_provider_events"."provider_refund_reference") between 1 and 200);--> statement-breakpoint
ALTER TABLE "billing_provider_events" ADD CONSTRAINT "billing_provider_events_dispute_reference_check" CHECK ("billing_provider_events"."provider_dispute_reference" is null or char_length("billing_provider_events"."provider_dispute_reference") between 1 and 200);--> statement-breakpoint
-- The over-refund invariant, enforced by PostgreSQL rather than by the service
-- that writes.
--
-- This is the one financial rule a read-then-decide check cannot uphold on its
-- own: the quantity being checked is the sum of rows other transactions are
-- inserting at the same moment, so fifty simultaneous full refunds would each
-- read a total that did not yet include the other forty-nine. Locking the
-- capture makes them queue instead. `for update` on `billing_payments` never
-- modifies that row — a capture is immutable — it is taken purely for the
-- ordering it imposes, and under `read committed` the sum that follows takes a
-- fresh snapshot and therefore sees whatever the previous holder committed.
--
-- The application takes the same lock for the sake of the error message. This
-- exists for the guarantee.
CREATE OR REPLACE FUNCTION velora_billing_refund_within_capture() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  captured bigint;
  captured_currency text;
  captured_state text;
  claimed bigint;
BEGIN
  -- Schema-qualified through `tg_table_schema` rather than named, because the
  -- function runs with a pinned `search_path` — a trigger that resolved table
  -- names through the caller's path could be pointed at a different table by
  -- whoever set the path.
  EXECUTE format(
    'select amount_minor, currency, state from %I.billing_payments where id = $1 for update',
    tg_table_schema
  ) INTO captured, captured_currency, captured_state USING new.payment_id;
  IF captured IS NULL THEN
    RAISE EXCEPTION 'a refund must name a payment that exists'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- Only settled money can be returned. Reversing anything else would be a
  -- claim about a movement that never happened.
  IF captured_state <> 'succeeded' THEN
    RAISE EXCEPTION 'payment % has not settled, so it cannot be reversed', new.payment_id
      USING ERRCODE = 'check_violation';
  END IF;
  -- The composite foreign key already forbids this. Stated again because the
  -- arithmetic below is only meaningful between amounts in one currency.
  IF new.currency IS DISTINCT FROM captured_currency THEN
    RAISE EXCEPTION 'a refund is denominated in the currency of the payment it reverses'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Everything except a refusal. A `failed` reversal released what it had
  -- reserved; every other state either moved money or may still do so.
  EXECUTE format(
    'select coalesce(sum(amount_minor), 0) from %I.%I where payment_id = $1 and state <> ''failed'' and id <> $2',
    tg_table_schema, tg_table_name
  ) INTO claimed USING new.payment_id, new.id;
  IF claimed + new.amount_minor > captured THEN
    RAISE EXCEPTION 'refunds against payment % would exceed the % captured', new.payment_id, captured
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_refunds_within_capture"
BEFORE INSERT OR UPDATE ON "billing_refunds"
FOR EACH ROW EXECUTE FUNCTION velora_billing_refund_within_capture();--> statement-breakpoint
-- A reversal is a money fact, so the parts of it that mean money are frozen.
--
-- Only the lifecycle may move: the state, the provider reference once the
-- provider gives one, the failure code, the sync instant, and the version. The
-- amount, the currency, the payment it reverses, the operator who asked for it,
-- the reason they gave, and both idempotency keys are what make the row an
-- auditable decision, and a repair that could rewrite them could rewrite what
-- was decided.
CREATE OR REPLACE FUNCTION velora_billing_refund_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.amount_minor IS DISTINCT FROM old.amount_minor
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.currency IS DISTINCT FROM old.currency
     OR new.id IS DISTINCT FROM old.id
     OR new.idempotency_key IS DISTINCT FROM old.idempotency_key
     OR new.initiated_by IS DISTINCT FROM old.initiated_by
     OR new.payment_id IS DISTINCT FROM old.payment_id
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_idempotency_key IS DISTINCT FROM old.provider_idempotency_key
     OR new.reason_code IS DISTINCT FROM old.reason_code THEN
    RAISE EXCEPTION 'a refund is frozen: only its lifecycle may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- A provider reference identifies the movement of money this reversal is.
  -- It may be learned once; it may never be changed to name a different one.
  IF old.provider_reference IS NOT NULL
     AND new.provider_reference IS DISTINCT FROM old.provider_reference THEN
    RAISE EXCEPTION 'a refund provider reference is written once'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_refunds_frozen"
BEFORE UPDATE ON "billing_refunds"
FOR EACH ROW EXECUTE FUNCTION velora_billing_refund_frozen();--> statement-breakpoint
CREATE TRIGGER "billing_refunds_retained"
BEFORE DELETE ON "billing_refunds"
FOR EACH ROW EXECUTE FUNCTION velora_billing_reject_delete();--> statement-breakpoint
-- A dispute is somebody else's account of what happened, so what they said is
-- frozen and only Velora's tracking of it moves.
--
-- The evidence deadline is the exception: a provider may extend one, and a
-- deadline Velora refused to update would be a date an operator planned around
-- after it had changed.
CREATE OR REPLACE FUNCTION velora_billing_dispute_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.amount_minor IS DISTINCT FROM old.amount_minor
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.currency IS DISTINCT FROM old.currency
     OR new.id IS DISTINCT FROM old.id
     OR new.opened_at IS DISTINCT FROM old.opened_at
     OR new.payment_id IS DISTINCT FROM old.payment_id
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_reference IS DISTINCT FROM old.provider_reference
     OR new.reason_code IS DISTINCT FROM old.reason_code THEN
    RAISE EXCEPTION 'a dispute is frozen: only its lifecycle and evidence deadline may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- A resolved dispute is where the money stopped. Nothing reopens it.
  IF old.state IN ('won', 'lost', 'withdrawn') THEN
    RAISE EXCEPTION 'a resolved dispute is final'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_disputes_frozen"
BEFORE UPDATE ON "billing_disputes"
FOR EACH ROW EXECUTE FUNCTION velora_billing_dispute_frozen();--> statement-breakpoint
CREATE TRIGGER "billing_disputes_retained"
BEFORE DELETE ON "billing_disputes"
FOR EACH ROW EXECUTE FUNCTION velora_billing_reject_delete();--> statement-breakpoint
-- The verified-receipt freeze, extended to the fields this migration adds.
--
-- The normalized amount, currency, dispute reason, and provider references are
-- evidence in exactly the same sense the digest is: they are what the provider
-- said, and the reason they are kept is so an inbound claim can be checked
-- against Velora's own record. A repair that could rewrite them could rewrite
-- the thing the check is against.
CREATE OR REPLACE FUNCTION velora_billing_event_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.amount_minor IS DISTINCT FROM old.amount_minor
     OR new.currency IS DISTINCT FROM old.currency
     OR new.event_type IS DISTINCT FROM old.event_type
     OR new.evidence_due_at IS DISTINCT FROM old.evidence_due_at
     OR new.id IS DISTINCT FROM old.id
     OR new.occurred_at IS DISTINCT FROM old.occurred_at
     OR new.payload_digest IS DISTINCT FROM old.payload_digest
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_dispute_reference IS DISTINCT FROM old.provider_dispute_reference
     OR new.provider_event_id IS DISTINCT FROM old.provider_event_id
     OR new.provider_payment_reference IS DISTINCT FROM old.provider_payment_reference
     OR new.provider_refund_reference IS DISTINCT FROM old.provider_refund_reference
     OR new.reason_code IS DISTINCT FROM old.reason_code
     OR new.received_at IS DISTINCT FROM old.received_at THEN
    RAISE EXCEPTION 'a verified provider event is evidence: only its processing state may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;
