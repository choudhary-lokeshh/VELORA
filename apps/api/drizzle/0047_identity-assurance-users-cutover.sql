CREATE TABLE "users_adult_declarations" (
	"decided_at" timestamp with time zone NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"policy_version" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"region" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "users_adult_declarations_outcome_check" CHECK ("users_adult_declarations"."outcome" in ('passed', 'failed')),
	CONSTRAINT "users_adult_declarations_policy_version_length_check" CHECK (char_length("users_adult_declarations"."policy_version") between 1 and 32),
	CONSTRAINT "users_adult_declarations_region_check" CHECK ("users_adult_declarations"."region" is null or "users_adult_declarations"."region" ~ '^[A-Z]{2}$'),
	CONSTRAINT "users_adult_declarations_recording_order_check" CHECK ("users_adult_declarations"."recorded_at" >= "users_adult_declarations"."decided_at")
);--> statement-breakpoint
ALTER TABLE "users_adult_declarations" ADD CONSTRAINT "users_adult_declarations_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_adult_declarations_user_idx" ON "users_adult_declarations" USING btree ("user_id","recorded_at","id");--> statement-breakpoint

-- Derive one stable recording timeline from the old sequence before splitting
-- ownership. Both new domains receive the same value, so current-decision order
-- remains the legacy row order even when timestamps tied or moved backward.
CREATE TEMPORARY TABLE "identity_users_cutover_source" ON COMMIT DROP AS
WITH ordered AS (
  SELECT legacy.*,
    row_number() OVER (PARTITION BY legacy.user_id ORDER BY legacy.id) AS source_order,
    max(greatest(legacy.created_at, legacy.decided_at)) OVER (
      PARTITION BY legacy.user_id ORDER BY legacy.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS recording_high_water
  FROM "users_adult_assurances" AS legacy
)
SELECT ordered.*,
  ordered.recording_high_water
    + ordered.source_order * interval '1 microsecond' AS migrated_recorded_at,
  CASE
    WHEN ordered.policy_version ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'
      THEN ordered.policy_version
    ELSE 'legacy-users:' || md5(ordered.policy_version)
  END AS identity_policy_version
FROM ordered;--> statement-breakpoint

INSERT INTO "users_adult_declarations" (
  "decided_at", "id", "outcome", "policy_version", "recorded_at", "region", "user_id"
)
SELECT decided_at, id, outcome, policy_version, migrated_recorded_at, region, user_id
FROM "identity_users_cutover_source"
WHERE assurance_class = 'self_declared'
ORDER BY user_id, id;--> statement-breakpoint

SELECT setval(
  pg_get_serial_sequence('users_adult_declarations', 'id'),
  coalesce((SELECT max(id) FROM users_adult_declarations), 1),
  EXISTS (SELECT 1 FROM users_adult_declarations)
);--> statement-breakpoint

-- AUTH remains principal owner. IDENTITY stores only its opaque reference and
-- has no foreign key into AUTH or USERS. Deterministic UUIDs make this cutover
-- repeatable inside its transaction without requiring a database extension.
INSERT INTO "identity_subjects" ("created_at", "id", "owner_domain", "owner_reference")
SELECT min(source.migrated_recorded_at),
  (
    substr(md5('velora:identity:auth:' || account.auth_account_id::text), 1, 8) || '-' ||
    substr(md5('velora:identity:auth:' || account.auth_account_id::text), 9, 4) || '-' ||
    substr(md5('velora:identity:auth:' || account.auth_account_id::text), 13, 4) || '-' ||
    substr(md5('velora:identity:auth:' || account.auth_account_id::text), 17, 4) || '-' ||
    substr(md5('velora:identity:auth:' || account.auth_account_id::text), 21, 12)
  )::uuid,
  'auth',
  account.auth_account_id
FROM "identity_users_cutover_source" AS source
JOIN "users_accounts" AS account ON account.id = source.user_id
WHERE source.assurance_class = 'verified_adult'
GROUP BY account.auth_account_id
ON CONFLICT ("owner_domain", "owner_reference") DO NOTHING;--> statement-breakpoint

INSERT INTO "identity_attempts" (
  "caller_idempotency_key", "completed_at", "created_at", "id", "input_digest",
  "jurisdiction", "policy_version", "provider", "provider_bound_at",
  "provider_idempotency_key", "provider_reference", "purpose",
  "required_evidence_class", "required_threshold", "state", "subject_id", "updated_at"
)
SELECT
  'legacy-users-' || source.id::text,
  source.migrated_recorded_at,
  source.migrated_recorded_at,
  (
    substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 1, 8) || '-' ||
    substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 9, 4) || '-' ||
    substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 13, 4) || '-' ||
    substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 17, 4) || '-' ||
    substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 21, 12)
  )::uuid,
  md5('velora:legacy-users-input:' || source.user_id::text || ':' || source.id::text) ||
    md5('velora:legacy-users-input-2:' || source.user_id::text || ':' || source.id::text),
  coalesce(source.region, 'XX'),
  source.identity_policy_version,
  'legacy-users',
  source.migrated_recorded_at,
  'legacy-users-' || source.id::text,
  'legacy-users-' || source.id::text,
  'adult_assurance',
  'adult_threshold',
  'legacy-adult-threshold',
  CASE
    WHEN source.outcome = 'passed' THEN 'succeeded'
    WHEN source.outcome IN ('failed', 'revoked') THEN 'refused'
    ELSE 'failed'
  END,
  subject.id,
  source.migrated_recorded_at
FROM "identity_users_cutover_source" AS source
JOIN "users_accounts" AS account ON account.id = source.user_id
JOIN "identity_subjects" AS subject
  ON subject.owner_domain = 'auth' AND subject.owner_reference = account.auth_account_id
WHERE source.assurance_class = 'verified_adult'
ORDER BY source.user_id, source.id;--> statement-breakpoint

-- Insert evidence in predecessor order so the existing chain trigger sees one
-- current tip at each row. Pending/review history remains a terminal attempt
-- with no grant, preserving a fail-closed current decision without fabricating
-- a refusal.
DO $$
DECLARE
  source record;
  subject_id uuid;
  attempt_id uuid;
  evidence_id uuid;
  previous_subject uuid := NULL;
  previous_evidence uuid := NULL;
BEGIN
  FOR source IN
    SELECT migrated.*, account.auth_account_id
    FROM pg_temp.identity_users_cutover_source AS migrated
    JOIN public.users_accounts AS account ON account.id = migrated.user_id
    WHERE migrated.assurance_class = 'verified_adult'
      AND migrated.outcome IN ('passed', 'failed', 'revoked')
    ORDER BY migrated.user_id, migrated.id
  LOOP
    SELECT identity_subject.id INTO STRICT subject_id
    FROM public.identity_subjects AS identity_subject
    WHERE identity_subject.owner_domain = 'auth'
      AND identity_subject.owner_reference = source.auth_account_id;

    attempt_id := (
      substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 1, 8) || '-' ||
      substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 9, 4) || '-' ||
      substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 13, 4) || '-' ||
      substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 17, 4) || '-' ||
      substr(md5('velora:legacy-users-attempt:' || source.user_id::text || ':' || source.id::text), 21, 12)
    )::uuid;
    evidence_id := (
      substr(md5('velora:legacy-users-evidence:' || source.user_id::text || ':' || source.id::text), 1, 8) || '-' ||
      substr(md5('velora:legacy-users-evidence:' || source.user_id::text || ':' || source.id::text), 9, 4) || '-' ||
      substr(md5('velora:legacy-users-evidence:' || source.user_id::text || ':' || source.id::text), 13, 4) || '-' ||
      substr(md5('velora:legacy-users-evidence:' || source.user_id::text || ':' || source.id::text), 17, 4) || '-' ||
      substr(md5('velora:legacy-users-evidence:' || source.user_id::text || ':' || source.id::text), 21, 12)
    )::uuid;

    IF previous_subject IS DISTINCT FROM subject_id THEN
      previous_subject := subject_id;
      previous_evidence := NULL;
    END IF;

    INSERT INTO public.identity_evidence (
      attempt_id, effective_at, evidence_class, expires_at, id,
      normalized_result, policy_version, provider, provider_fact_reference,
      recorded_at, subject_id, supersedes_id, threshold_context
    ) VALUES (
      attempt_id,
      source.migrated_recorded_at,
      'adult_threshold',
      CASE WHEN source.expires_at IS NULL THEN NULL
        ELSE greatest(source.expires_at, source.migrated_recorded_at) END,
      evidence_id,
      CASE source.outcome
        WHEN 'passed' THEN 'granted'
        WHEN 'failed' THEN 'refused'
        ELSE 'revoked'
      END,
      source.identity_policy_version,
      'legacy-users',
      'legacy-users-' || source.id::text,
      source.migrated_recorded_at,
      subject_id,
      previous_evidence,
      'legacy-adult-threshold'
    );
    previous_evidence := evidence_id;
  END LOOP;
END;
$$;--> statement-breakpoint

-- Abort before retirement if any source row or chain edge was lost. Drizzle
-- commits a migration file atomically, so an abort leaves the mixed table as
-- the authoritative rollback path.
DO $$
DECLARE
  expected_declarations bigint;
  expected_verified bigint;
  expected_evidence bigint;
  expected_evidence_subjects bigint;
  expected_subjects bigint;
BEGIN
  SELECT count(*) INTO expected_declarations
  FROM pg_temp.identity_users_cutover_source WHERE assurance_class = 'self_declared';
  SELECT count(*) INTO expected_verified
  FROM pg_temp.identity_users_cutover_source WHERE assurance_class = 'verified_adult';
  SELECT count(*) INTO expected_evidence
  FROM pg_temp.identity_users_cutover_source
  WHERE assurance_class = 'verified_adult' AND outcome IN ('passed', 'failed', 'revoked');
  SELECT count(DISTINCT user_id) INTO expected_evidence_subjects
  FROM pg_temp.identity_users_cutover_source
  WHERE assurance_class = 'verified_adult' AND outcome IN ('passed', 'failed', 'revoked');
  SELECT count(DISTINCT user_id) INTO expected_subjects
  FROM pg_temp.identity_users_cutover_source WHERE assurance_class = 'verified_adult';

  IF (SELECT count(*) FROM public.users_adult_declarations) <> expected_declarations THEN
    RAISE EXCEPTION 'identity users cutover declaration count mismatch';
  END IF;
  IF (SELECT count(*) FROM public.identity_attempts WHERE provider = 'legacy-users') <> expected_verified THEN
    RAISE EXCEPTION 'identity users cutover attempt count mismatch';
  END IF;
  IF (SELECT count(*) FROM public.identity_evidence WHERE provider = 'legacy-users') <> expected_evidence THEN
    RAISE EXCEPTION 'identity users cutover evidence count mismatch';
  END IF;
  IF (
    SELECT count(*) FROM public.identity_subjects AS subject
    WHERE subject.owner_domain = 'auth'
      AND EXISTS (
        SELECT 1 FROM public.users_accounts AS account
        JOIN pg_temp.identity_users_cutover_source AS source ON source.user_id = account.id
        WHERE source.assurance_class = 'verified_adult'
          AND account.auth_account_id = subject.owner_reference
      )
  ) <> expected_subjects THEN
    RAISE EXCEPTION 'identity users cutover subject count mismatch';
  END IF;
  IF (
    SELECT count(*) FROM public.identity_evidence
    WHERE provider = 'legacy-users' AND supersedes_id IS NOT NULL
  ) <> expected_evidence - expected_evidence_subjects THEN
    RAISE EXCEPTION 'identity users cutover evidence chain mismatch';
  END IF;
END;
$$;--> statement-breakpoint

DROP TABLE "users_adult_assurances";--> statement-breakpoint

CREATE OR REPLACE FUNCTION velora_users_adult_declaration_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'adult declarations are append-only'
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "users_adult_declarations_append_only"
BEFORE UPDATE OR DELETE ON "users_adult_declarations"
FOR EACH ROW EXECUTE FUNCTION velora_users_adult_declaration_immutable();
