ALTER TABLE "identity_attempts" ADD COLUMN "reconciliation_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "identity_attempts_reconciliation_idx" ON "identity_attempts" USING btree ("reconciliation_checked_at" ASC NULLS FIRST,"id") WHERE "identity_attempts"."state" in ('created', 'provider_starting', 'provider_pending', 'processing', 'succeeded');
--> statement-breakpoint
-- A provider-truth scan is operational metadata, not a lifecycle or evidence
-- mutation. Terminal facts stay immutable while the scheduler may advance its
-- marker; all present and future semantic columns remain frozen by default.
CREATE OR REPLACE FUNCTION velora_identity_attempt_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.caller_idempotency_key IS DISTINCT FROM old.caller_idempotency_key
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.id IS DISTINCT FROM old.id
     OR new.input_digest IS DISTINCT FROM old.input_digest
     OR new.jurisdiction IS DISTINCT FROM old.jurisdiction
     OR new.policy_version IS DISTINCT FROM old.policy_version
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_idempotency_key IS DISTINCT FROM old.provider_idempotency_key
     OR new.purpose IS DISTINCT FROM old.purpose
     OR new.required_evidence_class IS DISTINCT FROM old.required_evidence_class
     OR new.required_threshold IS DISTINCT FROM old.required_threshold
     OR new.subject_id IS DISTINCT FROM old.subject_id THEN
    RAISE EXCEPTION 'identity attempt identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF old.provider_reference IS NOT NULL
     AND (new.provider_reference IS DISTINCT FROM old.provider_reference
          OR new.provider_bound_at IS DISTINCT FROM old.provider_bound_at) THEN
    RAISE EXCEPTION 'identity attempt provider binding is immutable once set'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF new.updated_at < old.updated_at THEN
    RAISE EXCEPTION 'identity attempt time cannot move backward'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF old.state IN ('succeeded', 'refused', 'failed', 'expired', 'cancelled', 'unavailable')
     AND (to_jsonb(new) - 'reconciliation_checked_at')
         IS DISTINCT FROM (to_jsonb(old) - 'reconciliation_checked_at') THEN
    RAISE EXCEPTION 'terminal identity attempt is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF new.state IS DISTINCT FROM old.state AND NOT (
    (old.state = 'created' AND new.state IN ('provider_starting', 'failed', 'expired', 'cancelled', 'unavailable'))
    OR (old.state = 'provider_starting' AND new.state IN ('provider_pending', 'processing', 'failed', 'expired', 'cancelled', 'unavailable'))
    OR (old.state = 'provider_pending' AND new.state IN ('processing', 'succeeded', 'refused', 'failed', 'expired', 'cancelled'))
    OR (old.state = 'processing' AND new.state IN ('succeeded', 'refused', 'failed', 'expired', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid identity attempt transition: % to %', old.state, new.state
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN new;
END;
$$;
