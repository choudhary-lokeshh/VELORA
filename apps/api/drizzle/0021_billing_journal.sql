CREATE TABLE "billing_journal_accounts" (
	"category" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid,
	"subject_type" text NOT NULL,
	CONSTRAINT "billing_journal_accounts_currency_uk" UNIQUE("id","currency"),
	CONSTRAINT "billing_journal_accounts_category_check" CHECK ("billing_journal_accounts"."category" in ('provider_clearing', 'customer_settlement', 'platform_revenue', 'creator_payable', 'refunds', 'disputes', 'reserves', 'payout_clearing', 'tax_payable')),
	CONSTRAINT "billing_journal_accounts_subject_type_check" CHECK ("billing_journal_accounts"."subject_type" in ('platform', 'creator', 'consumer')),
	CONSTRAINT "billing_journal_accounts_currency_check" CHECK ("billing_journal_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_journal_accounts_subject_shape_check" CHECK (("billing_journal_accounts"."subject_type" = 'platform') = ("billing_journal_accounts"."subject_id" is null))
);
--> statement-breakpoint
CREATE TABLE "billing_journal_entries" (
	"account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"direction" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	CONSTRAINT "billing_journal_entries_direction_check" CHECK ("billing_journal_entries"."direction" in ('debit', 'credit')),
	CONSTRAINT "billing_journal_entries_amount_check" CHECK ("billing_journal_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_journal_transactions" (
	"business_reference" text NOT NULL,
	"business_type" text NOT NULL,
	"corrects_transaction_id" uuid,
	"correlation_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"currency" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "billing_journal_transactions_currency_uk" UNIQUE("id","currency"),
	CONSTRAINT "billing_journal_transactions_reason_check" CHECK ("billing_journal_transactions"."reason" in ('payment_captured', 'refund_issued', 'dispute_opened', 'dispute_resolved', 'payout_settled', 'correction')),
	CONSTRAINT "billing_journal_transactions_currency_check" CHECK ("billing_journal_transactions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "billing_journal_transactions_business_type_check" CHECK ("billing_journal_transactions"."business_type" ~ '^[a-z][a-z0-9_.]{1,63}$'),
	CONSTRAINT "billing_journal_transactions_business_reference_check" CHECK (char_length("billing_journal_transactions"."business_reference") between 1 and 200),
	CONSTRAINT "billing_journal_transactions_correction_shape_check" CHECK (("billing_journal_transactions"."reason" = 'correction') = ("billing_journal_transactions"."corrects_transaction_id" is not null)),
	CONSTRAINT "billing_journal_transactions_self_correction_check" CHECK ("billing_journal_transactions"."corrects_transaction_id" is null or "billing_journal_transactions"."corrects_transaction_id" <> "billing_journal_transactions"."id")
);
--> statement-breakpoint
ALTER TABLE "billing_journal_entries" ADD CONSTRAINT "billing_journal_entries_transaction_fk" FOREIGN KEY ("transaction_id","currency") REFERENCES "public"."billing_journal_transactions"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_journal_entries" ADD CONSTRAINT "billing_journal_entries_account_fk" FOREIGN KEY ("account_id","currency") REFERENCES "public"."billing_journal_accounts"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_journal_transactions" ADD CONSTRAINT "billing_journal_transactions_corrects_fk" FOREIGN KEY ("corrects_transaction_id","currency") REFERENCES "public"."billing_journal_transactions"("id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_journal_accounts_platform_uk" ON "billing_journal_accounts" USING btree ("category","currency") WHERE "billing_journal_accounts"."subject_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_journal_accounts_subject_uk" ON "billing_journal_accounts" USING btree ("category","currency","subject_id") WHERE "billing_journal_accounts"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX "billing_journal_accounts_subject_idx" ON "billing_journal_accounts" USING btree ("subject_id","currency") WHERE "billing_journal_accounts"."subject_id" is not null;--> statement-breakpoint
CREATE INDEX "billing_journal_entries_account_idx" ON "billing_journal_entries" USING btree ("account_id","direction","amount_minor");--> statement-breakpoint
CREATE INDEX "billing_journal_entries_transaction_idx" ON "billing_journal_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_journal_transactions_event_uk" ON "billing_journal_transactions" USING btree ("business_type","business_reference");--> statement-breakpoint
CREATE INDEX "billing_journal_transactions_occurred_idx" ON "billing_journal_transactions" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "billing_journal_transactions_corrects_idx" ON "billing_journal_transactions" USING btree ("corrects_transaction_id") WHERE "billing_journal_transactions"."corrects_transaction_id" is not null;--> statement-breakpoint
-- Journal invariants that PostgreSQL enforces rather than the application.
--
-- An accounting rule upheld only by the code that writes is a rule one bug away
-- from being false, and a financial book is the last place to discover that. The
-- four functions below are shared by every owner-specific journal: BILLING
-- instantiates them here and PAYOUTS re-runs the same CREATE OR REPLACE for its
-- own tables, so both books inherit identical guarantees.
CREATE OR REPLACE FUNCTION velora_journal_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'financial journal rows are append-only: % on % is not permitted', tg_op, tg_table_name
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
-- Deferred to commit on purpose. Entries arrive after the transaction row they
-- belong to, so a check that ran per statement would reject the first one.
CREATE OR REPLACE FUNCTION velora_journal_assert_balanced() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  imbalance numeric;
BEGIN
  EXECUTE format(
    'select coalesce(sum(case when direction = ''debit'' then amount_minor else -amount_minor end), 0) from %I.%I where transaction_id = $1',
    tg_table_schema, tg_table_name
  ) INTO imbalance USING new.transaction_id;
  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'journal transaction % does not balance; debits minus credits is %', new.transaction_id, imbalance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- A transaction with no entries would balance vacuously, so the balance check
-- alone is not enough to make an empty posting impossible.
CREATE OR REPLACE FUNCTION velora_journal_assert_posted() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  entry_count integer;
BEGIN
  EXECUTE format('select count(*) from %I.%I where transaction_id = $1', tg_table_schema, tg_argv[0])
    INTO entry_count USING new.id;
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'journal transaction % has % entries; a balanced transaction needs at least two', new.id, entry_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Closes the one mutation an append-only rule would otherwise miss. Two entries
-- that balance on their own can be appended to a transaction posted last year,
-- changing what it says without updating a single row. An entry is therefore
-- only insertable by the transaction that created the journal transaction it
-- belongs to, which `xmin` identifies exactly.
CREATE OR REPLACE FUNCTION velora_journal_assert_same_transaction() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  posted_here boolean;
BEGIN
  EXECUTE format(
    'select xmin = pg_current_xact_id()::xid from %I.%I where id = $1',
    tg_table_schema, tg_argv[0]
  ) INTO posted_here USING new.transaction_id;
  IF posted_here IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'journal entries may only be written by the transaction that posted journal transaction %', new.transaction_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "billing_journal_accounts_append_only"
BEFORE UPDATE OR DELETE ON "billing_journal_accounts"
FOR EACH ROW EXECUTE FUNCTION velora_journal_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "billing_journal_transactions_append_only"
BEFORE UPDATE OR DELETE ON "billing_journal_transactions"
FOR EACH ROW EXECUTE FUNCTION velora_journal_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "billing_journal_entries_append_only"
BEFORE UPDATE OR DELETE ON "billing_journal_entries"
FOR EACH ROW EXECUTE FUNCTION velora_journal_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "billing_journal_entries_same_transaction"
BEFORE INSERT ON "billing_journal_entries"
FOR EACH ROW EXECUTE FUNCTION velora_journal_assert_same_transaction('billing_journal_transactions');--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "billing_journal_entries_balanced"
AFTER INSERT ON "billing_journal_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION velora_journal_assert_balanced();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "billing_journal_transactions_posted"
AFTER INSERT ON "billing_journal_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION velora_journal_assert_posted('billing_journal_entries');
