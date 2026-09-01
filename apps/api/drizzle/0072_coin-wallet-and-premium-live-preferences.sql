CREATE TABLE "wallet_live_preference_entitlements" (
	"coins" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"encounter_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"preference_kind" text NOT NULL,
	"preference_region" text,
	"reservation_transaction_id" uuid NOT NULL,
	"sequence" bigserial NOT NULL,
	"settled_at" timestamp with time zone,
	"settlement_transaction_id" uuid,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "wallet_live_preference_reservation_uk" UNIQUE("reservation_transaction_id"),
	CONSTRAINT "wallet_live_preference_state_check" CHECK ("wallet_live_preference_entitlements"."state" in ('active', 'captured', 'released', 'cancelled')),
	CONSTRAINT "wallet_live_preference_kind_check" CHECK ("wallet_live_preference_entitlements"."preference_kind" in ('region')),
	CONSTRAINT "wallet_live_preference_region_shape_check" CHECK (("wallet_live_preference_entitlements"."preference_kind" = 'region') = ("wallet_live_preference_entitlements"."preference_region" is not null)),
	CONSTRAINT "wallet_live_preference_region_check" CHECK ("wallet_live_preference_entitlements"."preference_region" is null or "wallet_live_preference_entitlements"."preference_region" ~ '^[A-Z]{2}$'),
	CONSTRAINT "wallet_live_preference_coins_check" CHECK ("wallet_live_preference_entitlements"."coins" > 0),
	CONSTRAINT "wallet_live_preference_expiry_order_check" CHECK ("wallet_live_preference_entitlements"."expires_at" > "wallet_live_preference_entitlements"."created_at"),
	CONSTRAINT "wallet_live_preference_settlement_shape_check" CHECK (("wallet_live_preference_entitlements"."state" <> 'active') = ("wallet_live_preference_entitlements"."settlement_transaction_id" is not null)),
	CONSTRAINT "wallet_live_preference_settled_shape_check" CHECK (("wallet_live_preference_entitlements"."settled_at" is null) = ("wallet_live_preference_entitlements"."settlement_transaction_id" is null)),
	CONSTRAINT "wallet_live_preference_encounter_shape_check" CHECK (("wallet_live_preference_entitlements"."state" = 'captured') = ("wallet_live_preference_entitlements"."encounter_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "wallet_accounts" (
	"category" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_id" uuid,
	"subject_type" text NOT NULL,
	CONSTRAINT "wallet_accounts_category_check" CHECK ("wallet_accounts"."category" in ('consumer_balance', 'consumer_reserved', 'platform_issuance', 'platform_revenue')),
	CONSTRAINT "wallet_accounts_subject_type_check" CHECK ("wallet_accounts"."subject_type" in ('platform', 'consumer')),
	CONSTRAINT "wallet_accounts_subject_shape_check" CHECK (("wallet_accounts"."subject_type" = 'platform') = ("wallet_accounts"."subject_id" is null))
);
--> statement-breakpoint
CREATE TABLE "wallet_acquisitions" (
	"channel" text NOT NULL,
	"coins" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"purchase_reference" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "wallet_acquisitions_coins_check" CHECK ("wallet_acquisitions"."coins" > 0),
	CONSTRAINT "wallet_acquisitions_channel_check" CHECK ("wallet_acquisitions"."channel" in ('web', 'android')),
	CONSTRAINT "wallet_acquisitions_reference_check" CHECK (char_length("wallet_acquisitions"."purchase_reference") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "wallet_balances" (
	"available" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "wallet_balances_available_check" CHECK ("wallet_balances"."available" >= 0),
	CONSTRAINT "wallet_balances_reserved_check" CHECK ("wallet_balances"."reserved" >= 0),
	CONSTRAINT "wallet_balances_version_check" CHECK ("wallet_balances"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "wallet_entries" (
	"account_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"direction" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" bigserial NOT NULL,
	"transaction_id" uuid NOT NULL,
	CONSTRAINT "wallet_entries_direction_check" CHECK ("wallet_entries"."direction" in ('debit', 'credit')),
	CONSTRAINT "wallet_entries_amount_check" CHECK ("wallet_entries"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"business_reference" text NOT NULL,
	"business_type" text NOT NULL,
	"corrects_transaction_id" uuid,
	"correlation_id" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"sequence" bigserial NOT NULL,
	CONSTRAINT "wallet_transactions_reason_check" CHECK ("wallet_transactions"."reason" in ('grant', 'purchase', 'purchase_reversed', 'reservation', 'capture', 'release', 'correction')),
	CONSTRAINT "wallet_transactions_business_type_check" CHECK ("wallet_transactions"."business_type" ~ '^[a-z][a-z0-9_.]{1,63}$'),
	CONSTRAINT "wallet_transactions_business_reference_check" CHECK (char_length("wallet_transactions"."business_reference") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "wallet_acquisitions" ADD CONSTRAINT "wallet_acquisitions_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_account_id_wallet_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."wallet_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_transaction_id_wallet_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_corrects_fk" FOREIGN KEY ("corrects_transaction_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_live_preference_active_uk" ON "wallet_live_preference_entitlements" USING btree ("user_id") WHERE "wallet_live_preference_entitlements"."state" = 'active';--> statement-breakpoint
CREATE INDEX "wallet_live_preference_expiry_idx" ON "wallet_live_preference_entitlements" USING btree ("expires_at") WHERE "wallet_live_preference_entitlements"."state" = 'active';--> statement-breakpoint
CREATE INDEX "wallet_live_preference_user_recency_idx" ON "wallet_live_preference_entitlements" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_live_preference_sequence_uk" ON "wallet_live_preference_entitlements" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_live_preference_settlement_uk" ON "wallet_live_preference_entitlements" USING btree ("settlement_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_accounts_identity_uk" ON "wallet_accounts" USING btree ("category",coalesce("subject_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_acquisitions_purchase_uk" ON "wallet_acquisitions" USING btree ("channel","purchase_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_acquisitions_transaction_uk" ON "wallet_acquisitions" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "wallet_acquisitions_user_idx" ON "wallet_acquisitions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_acquisitions_sequence_uk" ON "wallet_acquisitions" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "wallet_entries_transaction_idx" ON "wallet_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "wallet_entries_account_idx" ON "wallet_entries" USING btree ("account_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_entries_sequence_uk" ON "wallet_entries" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_business_uk" ON "wallet_transactions" USING btree ("business_type","business_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_sequence_uk" ON "wallet_transactions" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "wallet_transactions_occurred_idx" ON "wallet_transactions" USING btree ("occurred_at");
--> statement-breakpoint
-- Coin-ledger invariants that PostgreSQL enforces rather than the application.
--
-- The same reasoning `0021_billing_journal.sql` records, applied to a book
-- denominated in coins rather than in money: an accounting rule upheld only by
-- the code that writes is a rule one bug away from being false, and a balance
-- somebody can spend is the last place to discover that.
--
-- Separate functions from the money journal's, and deliberately so. That
-- journal's balance check reads `amount_minor`; this one reads `amount`, and a
-- shared function taking a column name as an argument would be a function whose
-- correctness depended on every caller passing the right string.
CREATE OR REPLACE FUNCTION velora_wallet_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'coin ledger rows are append-only: % on % is not permitted', tg_op, tg_table_name
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
-- Deferred to commit on purpose. Entries arrive after the transaction row they
-- belong to, so a check that ran per statement would reject the first one.
CREATE OR REPLACE FUNCTION velora_wallet_assert_balanced() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  imbalance numeric;
BEGIN
  SELECT coalesce(sum(case when direction = 'debit' then amount else -amount end), 0)
    INTO imbalance FROM public.wallet_entries WHERE transaction_id = new.transaction_id;
  IF imbalance <> 0 THEN
    RAISE EXCEPTION 'coin transaction % does not balance; debits minus credits is %', new.transaction_id, imbalance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- A transaction with no entries would balance vacuously, so the balance check
-- alone is not enough to make an empty posting impossible.
CREATE OR REPLACE FUNCTION velora_wallet_assert_posted() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  entry_count integer;
BEGIN
  SELECT count(*) INTO entry_count FROM public.wallet_entries WHERE transaction_id = new.id;
  IF entry_count < 2 THEN
    RAISE EXCEPTION 'coin transaction % has % entries; a balanced transaction needs at least two', new.id, entry_count
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
-- Closes the one mutation an append-only rule would otherwise miss. Two entries
-- that balance on their own can be appended to a transaction posted last year,
-- changing what it says without updating a single row. An entry is therefore
-- only insertable by the transaction that created the coin transaction it
-- belongs to, which `xmin` identifies exactly.
CREATE OR REPLACE FUNCTION velora_wallet_assert_same_transaction() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  posted_here boolean;
BEGIN
  SELECT xmin = pg_current_xact_id()::xid INTO posted_here
    FROM public.wallet_transactions WHERE id = new.transaction_id;
  IF posted_here IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'coin entries may only be written by the transaction that posted coin transaction %', new.transaction_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "wallet_accounts_append_only"
BEFORE UPDATE OR DELETE ON "wallet_accounts"
FOR EACH ROW EXECUTE FUNCTION velora_wallet_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "wallet_transactions_append_only"
BEFORE UPDATE OR DELETE ON "wallet_transactions"
FOR EACH ROW EXECUTE FUNCTION velora_wallet_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "wallet_entries_append_only"
BEFORE UPDATE OR DELETE ON "wallet_entries"
FOR EACH ROW EXECUTE FUNCTION velora_wallet_reject_mutation();--> statement-breakpoint
-- An acquisition is the record that one external purchase was turned into
-- coins. Editing one would rewrite which purchase paid for a balance, so it is
-- append-only for the same reason the entries are.
CREATE TRIGGER "wallet_acquisitions_append_only"
BEFORE UPDATE OR DELETE ON "wallet_acquisitions"
FOR EACH ROW EXECUTE FUNCTION velora_wallet_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "wallet_entries_same_transaction"
BEFORE INSERT ON "wallet_entries"
FOR EACH ROW EXECUTE FUNCTION velora_wallet_assert_same_transaction();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "wallet_entries_balanced"
AFTER INSERT ON "wallet_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION velora_wallet_assert_balanced();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "wallet_transactions_posted"
AFTER INSERT ON "wallet_transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION velora_wallet_assert_posted();
