CREATE TABLE "identity_attempts" (
	"caller_idempotency_key" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"input_digest" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"policy_version" text NOT NULL,
	"provider" text NOT NULL,
	"provider_bound_at" timestamp with time zone,
	"provider_idempotency_key" text NOT NULL,
	"provider_reference" text,
	"purpose" text NOT NULL,
	"required_evidence_class" text NOT NULL,
	"required_threshold" text NOT NULL,
	"state" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_attempts_purpose_check" CHECK ("identity_attempts"."purpose" in ('adult_assurance', 'creator_identity', 'depicted_person_identity', 'depicted_person_adult_assurance', 'commercial_kyc')),
	CONSTRAINT "identity_attempts_evidence_class_check" CHECK ("identity_attempts"."required_evidence_class" in ('adult_threshold', 'identity', 'creator_identity', 'commercial_kyc', 'depicted_person_identity', 'depicted_person_adult_threshold')),
	CONSTRAINT "identity_attempts_state_check" CHECK ("identity_attempts"."state" in ('created', 'provider_starting', 'provider_pending', 'processing', 'succeeded', 'refused', 'failed', 'expired', 'cancelled', 'unavailable')),
	CONSTRAINT "identity_attempts_input_digest_check" CHECK ("identity_attempts"."input_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "identity_attempts_jurisdiction_check" CHECK ("identity_attempts"."jurisdiction" ~ '^[A-Z]{2}(-[A-Z0-9]{1,8})?$'),
	CONSTRAINT "identity_attempts_policy_version_check" CHECK ("identity_attempts"."policy_version" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_attempts_provider_check" CHECK ("identity_attempts"."provider" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_attempts_threshold_check" CHECK ("identity_attempts"."required_threshold" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_attempts_caller_idempotency_check" CHECK (char_length("identity_attempts"."caller_idempotency_key") between 8 and 128),
	CONSTRAINT "identity_attempts_provider_idempotency_check" CHECK (char_length("identity_attempts"."provider_idempotency_key") between 8 and 128),
	CONSTRAINT "identity_attempts_provider_reference_check" CHECK ("identity_attempts"."provider_reference" is null or char_length("identity_attempts"."provider_reference") between 1 and 256),
	CONSTRAINT "identity_attempts_provider_binding_check" CHECK (("identity_attempts"."provider_reference" is null) = ("identity_attempts"."provider_bound_at" is null)),
	CONSTRAINT "identity_attempts_completion_check" CHECK (("identity_attempts"."state" in ('succeeded', 'refused', 'failed', 'expired', 'cancelled', 'unavailable')) = ("identity_attempts"."completed_at" is not null)),
	CONSTRAINT "identity_attempts_time_order_check" CHECK ("identity_attempts"."updated_at" >= "identity_attempts"."created_at"
        and ("identity_attempts"."provider_bound_at" is null or "identity_attempts"."provider_bound_at" >= "identity_attempts"."created_at")
        and ("identity_attempts"."completed_at" is null or "identity_attempts"."completed_at" >= "identity_attempts"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "identity_evidence" (
	"attempt_id" uuid NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"evidence_class" text NOT NULL,
	"expires_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"normalized_result" text NOT NULL,
	"policy_version" text NOT NULL,
	"provider" text NOT NULL,
	"provider_fact_reference" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"subject_id" uuid NOT NULL,
	"supersedes_id" uuid,
	"threshold_context" text NOT NULL,
	CONSTRAINT "identity_evidence_class_check" CHECK ("identity_evidence"."evidence_class" in ('adult_threshold', 'identity', 'creator_identity', 'commercial_kyc', 'depicted_person_identity', 'depicted_person_adult_threshold')),
	CONSTRAINT "identity_evidence_result_check" CHECK ("identity_evidence"."normalized_result" in ('granted', 'refused', 'revoked', 'expired')),
	CONSTRAINT "identity_evidence_threshold_check" CHECK ("identity_evidence"."threshold_context" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_evidence_policy_version_check" CHECK ("identity_evidence"."policy_version" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_evidence_provider_check" CHECK ("identity_evidence"."provider" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_evidence_provider_fact_check" CHECK (char_length("identity_evidence"."provider_fact_reference") between 1 and 256),
	CONSTRAINT "identity_evidence_time_order_check" CHECK ("identity_evidence"."recorded_at" >= "identity_evidence"."effective_at"
        and ("identity_evidence"."expires_at" is null or "identity_evidence"."expires_at" >= "identity_evidence"."effective_at")),
	CONSTRAINT "identity_evidence_not_self_superseding_check" CHECK ("identity_evidence"."supersedes_id" is null or "identity_evidence"."supersedes_id" <> "identity_evidence"."id")
);
--> statement-breakpoint
CREATE TABLE "identity_outbox" (
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
	CONSTRAINT "identity_outbox_state_check" CHECK ("identity_outbox"."state" in ('pending', 'dispatched', 'dead_letter')),
	CONSTRAINT "identity_outbox_attempts_check" CHECK ("identity_outbox"."attempts" >= 0),
	CONSTRAINT "identity_outbox_lease_shape_check" CHECK (("identity_outbox"."lease_owner" is null) = ("identity_outbox"."lease_expires_at" is null)),
	CONSTRAINT "identity_outbox_lease_state_check" CHECK ("identity_outbox"."lease_owner" is null or "identity_outbox"."state" = 'pending'),
	CONSTRAINT "identity_outbox_dispatched_shape_check" CHECK (("identity_outbox"."state" = 'dispatched') = ("identity_outbox"."dispatched_at" is not null)),
	CONSTRAINT "identity_outbox_version_check" CHECK ("identity_outbox"."event_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "identity_provider_events" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"failure_reason" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"lease_owner" text,
	"normalized_event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload_digest" text NOT NULL,
	"processed_at" timestamp with time zone,
	"provider" text NOT NULL,
	"provider_account" text NOT NULL,
	"provider_environment" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"provider_reference" text,
	"received_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	CONSTRAINT "identity_provider_events_state_check" CHECK ("identity_provider_events"."state" in ('received', 'retry_wait', 'processed', 'ignored', 'dead_letter')),
	CONSTRAINT "identity_provider_events_digest_check" CHECK ("identity_provider_events"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "identity_provider_events_attempts_check" CHECK ("identity_provider_events"."attempts" >= 0),
	CONSTRAINT "identity_provider_events_lease_shape_check" CHECK (("identity_provider_events"."lease_owner" is null) = ("identity_provider_events"."lease_expires_at" is null)),
	CONSTRAINT "identity_provider_events_lease_state_check" CHECK ("identity_provider_events"."lease_owner" is null or "identity_provider_events"."state" in ('received', 'retry_wait')),
	CONSTRAINT "identity_provider_events_processed_shape_check" CHECK (("identity_provider_events"."state" in ('processed', 'ignored')) = ("identity_provider_events"."processed_at" is not null)),
	CONSTRAINT "identity_provider_events_dead_letter_shape_check" CHECK (("identity_provider_events"."state" = 'dead_letter') = ("identity_provider_events"."failure_reason" is not null)),
	CONSTRAINT "identity_provider_events_provider_check" CHECK ("identity_provider_events"."provider" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_provider_events_account_check" CHECK ("identity_provider_events"."provider_account" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_provider_events_environment_check" CHECK ("identity_provider_events"."provider_environment" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_provider_events_event_id_check" CHECK (char_length("identity_provider_events"."provider_event_id") between 1 and 256),
	CONSTRAINT "identity_provider_events_event_type_check" CHECK (char_length("identity_provider_events"."normalized_event_type") between 1 and 128),
	CONSTRAINT "identity_provider_events_reference_check" CHECK ("identity_provider_events"."provider_reference" is null or char_length("identity_provider_events"."provider_reference") between 1 and 256),
	CONSTRAINT "identity_provider_events_lease_owner_check" CHECK ("identity_provider_events"."lease_owner" is null or char_length("identity_provider_events"."lease_owner") between 1 and 128),
	CONSTRAINT "identity_provider_events_failure_reason_check" CHECK ("identity_provider_events"."failure_reason" is null or char_length("identity_provider_events"."failure_reason") between 1 and 128),
	CONSTRAINT "identity_provider_events_time_order_check" CHECK ("identity_provider_events"."received_at" >= "identity_provider_events"."occurred_at"
        and ("identity_provider_events"."processed_at" is null or "identity_provider_events"."processed_at" >= "identity_provider_events"."received_at"))
);
--> statement-breakpoint
CREATE TABLE "identity_reconciliation_findings" (
	"attempt_id" uuid,
	"detected_at" timestamp with time zone NOT NULL,
	"evidence_id" uuid,
	"fingerprint" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"reason_code" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"state" text NOT NULL,
	"subject_id" uuid,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "identity_reconciliation_findings_kind_check" CHECK ("identity_reconciliation_findings"."kind" in ('missing_provider_reference', 'provider_state_drift', 'stuck_attempt', 'evidence_expiry', 'callback_gap', 'deletion_obligation', 'retention_obligation')),
	CONSTRAINT "identity_reconciliation_findings_state_check" CHECK ("identity_reconciliation_findings"."state" in ('open', 'resolved', 'dead_letter')),
	CONSTRAINT "identity_reconciliation_findings_fingerprint_check" CHECK ("identity_reconciliation_findings"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "identity_reconciliation_findings_provider_check" CHECK ("identity_reconciliation_findings"."provider" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_reconciliation_findings_reason_check" CHECK ("identity_reconciliation_findings"."reason_code" ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'),
	CONSTRAINT "identity_reconciliation_findings_resolution_check" CHECK (("identity_reconciliation_findings"."state" <> 'open') = ("identity_reconciliation_findings"."resolved_at" is not null)),
	CONSTRAINT "identity_reconciliation_findings_time_order_check" CHECK ("identity_reconciliation_findings"."updated_at" >= "identity_reconciliation_findings"."detected_at"
        and ("identity_reconciliation_findings"."resolved_at" is null or "identity_reconciliation_findings"."resolved_at" >= "identity_reconciliation_findings"."detected_at"))
);
--> statement-breakpoint
CREATE TABLE "identity_subjects" (
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_domain" text NOT NULL,
	"owner_reference" uuid NOT NULL,
	CONSTRAINT "identity_subjects_owner_domain_check" CHECK ("identity_subjects"."owner_domain" in ('auth', 'creators', 'safety'))
);
--> statement-breakpoint
-- PostgreSQL requires composite unique targets to exist before their foreign
-- keys are added. Drizzle emits indexes after foreign keys, so these two owner
-- identity indexes are deliberately moved ahead of those constraints.
CREATE UNIQUE INDEX "identity_attempts_evidence_identity_uk" ON "identity_attempts" USING btree ("id","subject_id","required_evidence_class");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_evidence_chain_identity_uk" ON "identity_evidence" USING btree ("id","subject_id","evidence_class");--> statement-breakpoint
ALTER TABLE "identity_attempts" ADD CONSTRAINT "identity_attempts_subject_id_identity_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."identity_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_evidence" ADD CONSTRAINT "identity_evidence_subject_id_identity_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."identity_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_evidence" ADD CONSTRAINT "identity_evidence_attempt_identity_fk" FOREIGN KEY ("attempt_id","subject_id","evidence_class") REFERENCES "public"."identity_attempts"("id","subject_id","required_evidence_class") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_evidence" ADD CONSTRAINT "identity_evidence_supersession_identity_fk" FOREIGN KEY ("supersedes_id","subject_id","evidence_class") REFERENCES "public"."identity_evidence"("id","subject_id","evidence_class") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_reconciliation_findings" ADD CONSTRAINT "identity_reconciliation_findings_attempt_id_identity_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."identity_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_reconciliation_findings" ADD CONSTRAINT "identity_reconciliation_findings_evidence_id_identity_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."identity_evidence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_reconciliation_findings" ADD CONSTRAINT "identity_reconciliation_findings_subject_id_identity_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."identity_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_attempts_idempotency_uk" ON "identity_attempts" USING btree ("subject_id","purpose","caller_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_attempts_provider_idempotency_uk" ON "identity_attempts" USING btree ("provider","provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_attempts_provider_reference_uk" ON "identity_attempts" USING btree ("provider","provider_reference") WHERE "identity_attempts"."provider_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_attempts_active_uk" ON "identity_attempts" USING btree ("subject_id","purpose") WHERE "identity_attempts"."state" in ('created', 'provider_starting', 'provider_pending', 'processing');--> statement-breakpoint
CREATE INDEX "identity_attempts_subject_history_idx" ON "identity_attempts" USING btree ("subject_id","created_at","id");--> statement-breakpoint
CREATE INDEX "identity_attempts_recovery_idx" ON "identity_attempts" USING btree ("updated_at","id") WHERE "identity_attempts"."state" in ('created', 'provider_starting', 'provider_pending', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX "identity_evidence_supersedes_uk" ON "identity_evidence" USING btree ("supersedes_id") WHERE "identity_evidence"."supersedes_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_evidence_provider_fact_uk" ON "identity_evidence" USING btree ("provider","provider_fact_reference");--> statement-breakpoint
CREATE INDEX "identity_evidence_current_idx" ON "identity_evidence" USING btree ("subject_id","evidence_class","recorded_at","id");--> statement-breakpoint
CREATE INDEX "identity_evidence_expiry_idx" ON "identity_evidence" USING btree ("expires_at","id") WHERE "identity_evidence"."expires_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_outbox_sequence_uk" ON "identity_outbox" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "identity_outbox_claimable_idx" ON "identity_outbox" USING btree ("sequence") WHERE "identity_outbox"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "identity_outbox_state_idx" ON "identity_outbox" USING btree ("state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_provider_events_identity_uk" ON "identity_provider_events" USING btree ("provider","provider_account","provider_environment","provider_event_id");--> statement-breakpoint
CREATE INDEX "identity_provider_events_claimable_idx" ON "identity_provider_events" USING btree ("available_at","id") WHERE "identity_provider_events"."state" in ('received', 'retry_wait');--> statement-breakpoint
CREATE INDEX "identity_provider_events_reference_idx" ON "identity_provider_events" USING btree ("provider","provider_reference") WHERE "identity_provider_events"."provider_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_reconciliation_findings_fingerprint_uk" ON "identity_reconciliation_findings" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "identity_reconciliation_findings_open_idx" ON "identity_reconciliation_findings" USING btree ("detected_at","id") WHERE "identity_reconciliation_findings"."state" = 'open';--> statement-breakpoint
CREATE INDEX "identity_reconciliation_findings_subject_idx" ON "identity_reconciliation_findings" USING btree ("subject_id","detected_at","id") WHERE "identity_reconciliation_findings"."subject_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_subjects_owner_uk" ON "identity_subjects" USING btree ("owner_domain","owner_reference");--> statement-breakpoint

-- Subject and evidence identity is durable. A superseding fact is a new row;
-- no repair, operator, or later provider event may rewrite old evidence.
CREATE OR REPLACE FUNCTION velora_identity_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'identity assurance records are append-only: % on % is not permitted', tg_op, tg_table_name
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "identity_subjects_append_only"
BEFORE UPDATE OR DELETE ON "identity_subjects"
FOR EACH ROW EXECUTE FUNCTION velora_identity_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "identity_evidence_append_only"
BEFORE UPDATE OR DELETE ON "identity_evidence"
FOR EACH ROW EXECUTE FUNCTION velora_identity_reject_mutation();--> statement-breakpoint

-- A new link must advance the evidence timeline. The composite foreign key
-- already proves same subject and class, while the one-successor unique index
-- prevents a fork. Locking the predecessor makes concurrent successors resolve
-- against one stable row before the unique index chooses a winner.
CREATE OR REPLACE FUNCTION velora_identity_validate_supersession() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  source_attempt public.identity_attempts%ROWTYPE;
  predecessor public.identity_evidence%ROWTYPE;
BEGIN
  SELECT * INTO source_attempt
  FROM public.identity_attempts
  WHERE id = new.attempt_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'identity evidence attempt does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF new.provider <> source_attempt.provider
     OR new.policy_version <> source_attempt.policy_version THEN
    RAISE EXCEPTION 'identity evidence must preserve attempt provider and policy version'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF new.supersedes_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT * INTO predecessor
  FROM public.identity_evidence
  WHERE id = new.supersedes_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'superseded identity evidence does not exist'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF new.effective_at < predecessor.effective_at
     OR new.recorded_at < predecessor.recorded_at THEN
    RAISE EXCEPTION 'identity evidence supersession cannot move backward in time'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "identity_evidence_supersession_valid"
BEFORE INSERT ON "identity_evidence"
FOR EACH ROW EXECUTE FUNCTION velora_identity_validate_supersession();--> statement-breakpoint

-- Attempt identity is frozen after establishment. Only lifecycle, provider
-- binding, and their timestamps can move, and only through named transitions.
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
     AND new IS DISTINCT FROM old THEN
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
$$;--> statement-breakpoint
CREATE TRIGGER "identity_attempts_transition_valid"
BEFORE UPDATE ON "identity_attempts"
FOR EACH ROW EXECUTE FUNCTION velora_identity_attempt_transition();--> statement-breakpoint
CREATE TRIGGER "identity_attempts_retained"
BEFORE DELETE ON "identity_attempts"
FOR EACH ROW EXECUTE FUNCTION velora_identity_reject_mutation();--> statement-breakpoint

-- Verified receipt identity is evidence. Workers may move only processing
-- state, lease, retry, failure code, and settlement time.
CREATE OR REPLACE FUNCTION velora_identity_provider_event_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.id IS DISTINCT FROM old.id
     OR new.normalized_event_type IS DISTINCT FROM old.normalized_event_type
     OR new.occurred_at IS DISTINCT FROM old.occurred_at
     OR new.payload_digest IS DISTINCT FROM old.payload_digest
     OR new.provider IS DISTINCT FROM old.provider
     OR new.provider_account IS DISTINCT FROM old.provider_account
     OR new.provider_environment IS DISTINCT FROM old.provider_environment
     OR new.provider_event_id IS DISTINCT FROM old.provider_event_id
     OR new.provider_reference IS DISTINCT FROM old.provider_reference
     OR new.received_at IS DISTINCT FROM old.received_at THEN
    RAISE EXCEPTION 'verified identity provider event is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "identity_provider_events_frozen"
BEFORE UPDATE ON "identity_provider_events"
FOR EACH ROW EXECUTE FUNCTION velora_identity_provider_event_frozen();--> statement-breakpoint
CREATE TRIGGER "identity_provider_events_retained"
BEFORE DELETE ON "identity_provider_events"
FOR EACH ROW EXECUTE FUNCTION velora_identity_reject_mutation();--> statement-breakpoint

-- A finding may settle but may not be repointed at another provider, subject,
-- attempt, evidence row, or reason after it was recorded.
CREATE OR REPLACE FUNCTION velora_identity_finding_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.attempt_id IS DISTINCT FROM old.attempt_id
     OR new.detected_at IS DISTINCT FROM old.detected_at
     OR new.evidence_id IS DISTINCT FROM old.evidence_id
     OR new.fingerprint IS DISTINCT FROM old.fingerprint
     OR new.id IS DISTINCT FROM old.id
     OR new.kind IS DISTINCT FROM old.kind
     OR new.provider IS DISTINCT FROM old.provider
     OR new.reason_code IS DISTINCT FROM old.reason_code
     OR new.subject_id IS DISTINCT FROM old.subject_id THEN
    RAISE EXCEPTION 'identity reconciliation finding identity is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF old.state <> 'open' OR new.state NOT IN ('open', 'resolved', 'dead_letter') THEN
    RAISE EXCEPTION 'settled identity reconciliation finding cannot transition'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "identity_reconciliation_findings_frozen"
BEFORE UPDATE ON "identity_reconciliation_findings"
FOR EACH ROW EXECUTE FUNCTION velora_identity_finding_frozen();--> statement-breakpoint
CREATE TRIGGER "identity_reconciliation_findings_retained"
BEFORE DELETE ON "identity_reconciliation_findings"
FOR EACH ROW EXECUTE FUNCTION velora_identity_reject_mutation();
