CREATE TABLE "payouts_instructions" (
	"amount_minor" bigint NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"creator_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_provider_sync_at" timestamp with time zone,
	"provider" text NOT NULL,
	"provider_idempotency_key" text NOT NULL,
	"provider_reference" text,
	"requested_by" text NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payouts_instructions_state_check" CHECK ("payouts_instructions"."state" in ('requested', 'reserved', 'submitted', 'paid', 'failed', 'cancelled', 'reversed')),
	CONSTRAINT "payouts_instructions_amount_check" CHECK ("payouts_instructions"."amount_minor" > 0),
	CONSTRAINT "payouts_instructions_currency_check" CHECK ("payouts_instructions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payouts_instructions_failure_reason_check" CHECK ("payouts_instructions"."failure_reason" is null or "payouts_instructions"."failure_reason" in ('recipient_not_ready', 'declined', 'provider_error')),
	CONSTRAINT "payouts_instructions_failure_shape_check" CHECK ("payouts_instructions"."failure_reason" is null or "payouts_instructions"."state" in ('failed', 'reversed')),
	CONSTRAINT "payouts_instructions_paid_reference_check" CHECK ("payouts_instructions"."state" <> 'paid' or "payouts_instructions"."provider_reference" is not null),
	CONSTRAINT "payouts_instructions_idempotency_key_check" CHECK (char_length("payouts_instructions"."idempotency_key") between 8 and 128),
	CONSTRAINT "payouts_instructions_provider_key_check" CHECK (char_length("payouts_instructions"."provider_idempotency_key") between 8 and 200),
	CONSTRAINT "payouts_instructions_provider_reference_check" CHECK ("payouts_instructions"."provider_reference" is null or char_length("payouts_instructions"."provider_reference") between 1 and 200),
	CONSTRAINT "payouts_instructions_requested_by_check" CHECK (char_length("payouts_instructions"."requested_by") between 1 and 200),
	CONSTRAINT "payouts_instructions_version_check" CHECK ("payouts_instructions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "payouts_journal_accounts" (
	"category" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid,
	"subject_type" text NOT NULL,
	CONSTRAINT "payouts_journal_accounts_currency_uk" UNIQUE("id","currency"),
	CONSTRAINT "payouts_journal_accounts_category_check" CHECK ("payouts_journal_accounts"."category" in ('revenue_intake', 'creator_available', 'creator_reserved', 'creator_held', 'payout_disbursed')),
	CONSTRAINT "payouts_journal_accounts_subject_type_check" CHECK ("payouts_journal_accounts"."subject_type" in ('platform', 'creator', 'consumer')),
	CONSTRAINT "payouts_journal_accounts_currency_check" CHECK ("payouts_journal_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payouts_journal_accounts_subject_shape_check" CHECK (("payouts_journal_accounts"."subject_type" = 'platform') = ("payouts_journal_accounts"."subject_id" is null))
);
--> statement-breakpoint
CREATE TABLE "payouts_journal_entries" (
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"direction" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	CONSTRAINT "payouts_journal_entries_direction_check" CHECK ("payouts_journal_entries"."direction" in ('debit', 'credit')),
	CONSTRAINT "payouts_journal_entries_amount_check" CHECK ("payouts_journal_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payouts_journal_transactions" (
	"business_reference" text NOT NULL,
	"business_type" text NOT NULL,
	"corrects_transaction_id" uuid,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "payouts_journal_transactions_currency_uk" UNIQUE("id","currency"),
	CONSTRAINT "payouts_journal_transactions_reason_check" CHECK ("payouts_journal_transactions"."reason" in ('revenue_accrued', 'revenue_reversed', 'payout_reserved', 'reservation_released', 'payout_paid', 'hold_applied', 'hold_released', 'correction')),
	CONSTRAINT "payouts_journal_transactions_currency_check" CHECK ("payouts_journal_transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payouts_journal_transactions_business_type_check" CHECK ("payouts_journal_transactions"."business_type" ~ '^[a-z][a-z0-9_.]{1,63}$'),
	CONSTRAINT "payouts_journal_transactions_business_reference_check" CHECK (char_length("payouts_journal_transactions"."business_reference") between 1 and 200),
	CONSTRAINT "payouts_journal_transactions_correction_shape_check" CHECK (("payouts_journal_transactions"."reason" = 'correction') = ("payouts_journal_transactions"."corrects_transaction_id" is not null)),
	CONSTRAINT "payouts_journal_transactions_self_correction_check" CHECK ("payouts_journal_transactions"."corrects_transaction_id" is null or "payouts_journal_transactions"."corrects_transaction_id" <> "payouts_journal_transactions"."id")
);
--> statement-breakpoint
CREATE TABLE "payouts_outbox" (
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
	CONSTRAINT "payouts_outbox_state_check" CHECK ("payouts_outbox"."state" in ('pending', 'dispatched', 'dead_letter')),
	CONSTRAINT "payouts_outbox_attempts_check" CHECK ("payouts_outbox"."attempts" >= 0),
	CONSTRAINT "payouts_outbox_lease_shape_check" CHECK (("payouts_outbox"."lease_owner" is null) = ("payouts_outbox"."lease_expires_at" is null)),
	CONSTRAINT "payouts_outbox_lease_state_check" CHECK ("payouts_outbox"."lease_owner" is null or "payouts_outbox"."state" = 'pending'),
	CONSTRAINT "payouts_outbox_dispatched_shape_check" CHECK (("payouts_outbox"."state" = 'dispatched') = ("payouts_outbox"."dispatched_at" is not null)),
	CONSTRAINT "payouts_outbox_version_check" CHECK ("payouts_outbox"."event_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "payouts_recipients" (
	"capability_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"creator_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "payouts_recipients_status_check" CHECK ("payouts_recipients"."status" in ('absent', 'onboarding', 'ready', 'restricted')),
	CONSTRAINT "payouts_recipients_reference_shape_check" CHECK ("payouts_recipients"."status" = 'absent' or "payouts_recipients"."provider_reference" is not null),
	CONSTRAINT "payouts_recipients_reference_check" CHECK ("payouts_recipients"."provider_reference" is null or char_length("payouts_recipients"."provider_reference") between 1 and 200),
	CONSTRAINT "payouts_recipients_version_check" CHECK ("payouts_recipients"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "payouts_journal_entries" ADD CONSTRAINT "payouts_journal_entries_transaction_fk" FOREIGN KEY ("transaction_id","currency") REFERENCES "public"."payouts_journal_transactions"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts_journal_entries" ADD CONSTRAINT "payouts_journal_entries_account_fk" FOREIGN KEY ("account_id","currency") REFERENCES "public"."payouts_journal_accounts"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts_journal_transactions" ADD CONSTRAINT "payouts_journal_transactions_corrects_fk" FOREIGN KEY ("corrects_transaction_id","currency") REFERENCES "public"."payouts_journal_transactions"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_instructions_idempotency_uk" ON "payouts_instructions" USING btree ("creator_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_instructions_provider_key_uk" ON "payouts_instructions" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_instructions_provider_reference_uk" ON "payouts_instructions" USING btree ("provider","provider_reference") WHERE "payouts_instructions"."provider_reference" is not null;--> statement-breakpoint
CREATE INDEX "payouts_instructions_creator_idx" ON "payouts_instructions" USING btree ("creator_id","created_at","id");--> statement-breakpoint
CREATE INDEX "payouts_instructions_unsettled_idx" ON "payouts_instructions" USING btree ("updated_at","id") WHERE "payouts_instructions"."state" in ('requested', 'reserved', 'submitted');--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_journal_accounts_platform_uk" ON "payouts_journal_accounts" USING btree ("category","currency") WHERE "payouts_journal_accounts"."subject_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_journal_accounts_subject_uk" ON "payouts_journal_accounts" USING btree ("category","currency","subject_id") WHERE "payouts_journal_accounts"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX "payouts_journal_accounts_subject_idx" ON "payouts_journal_accounts" USING btree ("subject_id","currency") WHERE "payouts_journal_accounts"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX "payouts_journal_entries_account_idx" ON "payouts_journal_entries" USING btree ("account_id","direction","amount_minor");--> statement-breakpoint
CREATE INDEX "payouts_journal_entries_transaction_idx" ON "payouts_journal_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_journal_transactions_event_uk" ON "payouts_journal_transactions" USING btree ("business_type","business_reference");--> statement-breakpoint
CREATE INDEX "payouts_journal_transactions_occurred_idx" ON "payouts_journal_transactions" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "payouts_journal_transactions_corrects_idx" ON "payouts_journal_transactions" USING btree ("corrects_transaction_id") WHERE "payouts_journal_transactions"."corrects_transaction_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_outbox_sequence_uk" ON "payouts_outbox" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "payouts_outbox_claimable_idx" ON "payouts_outbox" USING btree ("sequence") WHERE "payouts_outbox"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "payouts_outbox_state_idx" ON "payouts_outbox" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_recipients_provider_uk" ON "payouts_recipients" USING btree ("provider","provider_reference") WHERE "payouts_recipients"."provider_reference" is not null;--> statement-breakpoint
-- The same journal invariants BILLING's book has, applied to this one.
--
-- The four functions were created by `0021_billing_journal` with
-- `CREATE OR REPLACE` and dispatch on the firing table, so PAYOUTS inherits
-- balance enforcement, immutability, and the same-transaction rule rather than
-- defining a second copy that can drift.
CREATE TRIGGER "payouts_journal_accounts_append_only"
BEFORE UPDATE OR DELETE ON "payouts_journal_accounts"
FOR EACH ROW EXECUTE FUNCTION velora_journal_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "payouts_journal_transactions_append_only"
BEFORE UPDATE OR DELETE ON "payouts_journal_transactions"
FOR EACH ROW EXECUTE FUNCTION velora_journal_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "payouts_journal_entries_append_only"
BEFORE UPDATE OR DELETE ON "payouts_journal_entries"
FOR EACH ROW EXECUTE FUNCTION velora_journal_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "payouts_journal_entries_same_transaction"
BEFORE INSERT ON "payouts_journal_entries"
FOR EACH ROW EXECUTE FUNCTION velora_journal_assert_same_transaction('payouts_journal_transactions');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "payouts_journal_entries_balanced"
AFTER INSERT ON "payouts_journal_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION velora_journal_assert_balanced();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "payouts_journal_transactions_posted"
AFTER INSERT ON "payouts_journal_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION velora_journal_assert_posted('payouts_journal_entries');--> statement-breakpoint
-- No creator position may be overdrawn.
--
-- This is the invariant that makes "a payout never exceeds what a creator is
-- owed" a property of the database rather than of the service that reserves.
-- A creator position is a liability: it is credited when revenue accrues and
-- debited when money is reserved, held, or sent, so debits minus credits is at
-- most zero for every one of them. A positive balance means somebody has been
-- paid, reserved, or held more than they ever earned — which is exactly the
-- shape a double-spend takes, and which no amount of application-level checking
-- can be trusted to prevent under concurrent writers.
--
-- Deferred to commit, so a transaction that moves an amount from one creator
-- position to another is judged on where it ends up rather than on the order
-- its two entries happened to be inserted in.
CREATE OR REPLACE FUNCTION velora_payouts_assert_not_overdrawn() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  overdrawn record;
BEGIN
  EXECUTE format(
    'select a.id, a.category, a.currency, a.subject_id,
            sum(case when e.direction = ''debit'' then e.amount_minor else -e.amount_minor end) as balance
       from %I.%I e
       join %I.%I a on a.id = e.account_id
      where e.account_id = $1
        and a.subject_type = ''creator''
      group by a.id, a.category, a.currency, a.subject_id
     having sum(case when e.direction = ''debit'' then e.amount_minor else -e.amount_minor end) > 0',
    tg_table_schema, tg_table_name, tg_table_schema, tg_argv[0]
  ) INTO overdrawn USING new.account_id;
  IF FOUND THEN
    RAISE EXCEPTION 'creator position % in % would be overdrawn by %', overdrawn.category, overdrawn.currency, overdrawn.balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "payouts_journal_entries_not_overdrawn"
AFTER INSERT ON "payouts_journal_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION velora_payouts_assert_not_overdrawn('payouts_journal_accounts');--> statement-breakpoint
-- A payout instruction is a money fact, so the parts of it that mean money are
-- frozen. Only the lifecycle moves: the state, the provider reference once the
-- provider gives one, the failure code, the sync instant, and the version.
CREATE OR REPLACE FUNCTION velora_payouts_instruction_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.amount_minor IS DISTINCT FROM old.amount_minor
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.creator_id IS DISTINCT FROM old.creator_id
     OR new.currency IS DISTINCT FROM old.currency
     OR new.id IS DISTINCT FROM old.id
     OR new.idempotency_key IS DISTINCT FROM old.idempotency_key
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_idempotency_key IS DISTINCT FROM old.provider_idempotency_key
     OR new.requested_by IS DISTINCT FROM old.requested_by THEN
    RAISE EXCEPTION 'a payout instruction is frozen: only its lifecycle may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- A provider reference identifies the movement of money this instruction is.
  -- It may be learned once; it may never be repointed at a different one.
  IF old.provider_reference IS NOT NULL
     AND new.provider_reference IS DISTINCT FROM old.provider_reference THEN
    RAISE EXCEPTION 'a payout instruction keeps the provider object it was given'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payouts_instructions_frozen"
BEFORE UPDATE ON "payouts_instructions"
FOR EACH ROW EXECUTE FUNCTION velora_payouts_instruction_frozen();--> statement-breakpoint
CREATE OR REPLACE FUNCTION velora_payouts_reject_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'payout records are retained: % on % is not permitted', tg_op, tg_table_name
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "payouts_instructions_retained"
BEFORE DELETE ON "payouts_instructions"
FOR EACH ROW EXECUTE FUNCTION velora_payouts_reject_delete();
