-- The not-overdrawn bound never fired.
--
-- `velora_payouts_assert_not_overdrawn` ran its check with `EXECUTE format(...)
-- INTO` and then branched on `IF FOUND`. PostgreSQL does not set `FOUND` for
-- `EXECUTE` — it sets `ROW_COUNT` and leaves `FOUND` alone — so the variable was
-- still false from the start of the invocation and the `RAISE` was unreachable.
-- The trigger was attached, deferred, and inert: a creator's position could be
-- debited past zero and the transaction committed.
--
-- It matters because that bound is the last thing standing between a reversal
-- and money that has already left. A payout settling and BILLING reversing the
-- sale it came from both debit the same position, and if both commit the
-- platform has paid out money it then took back on paper only.
--
-- Branching on the record itself is what the other trigger functions in this
-- schema already do: they read a value out and test the value, rather than
-- asking `FOUND` a question `EXECUTE` never answers.
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
  -- The record rather than `FOUND`: `EXECUTE` leaves `FOUND` untouched, so the
  -- only honest evidence a row came back is that the row has an identifier.
  IF overdrawn.id IS NOT NULL THEN
    RAISE EXCEPTION 'creator position % in % would be overdrawn by %', overdrawn.category, overdrawn.currency, overdrawn.balance
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
