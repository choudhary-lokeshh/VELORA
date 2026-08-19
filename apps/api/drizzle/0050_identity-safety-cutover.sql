-- Move depicted-person identity and adult-threshold truth out of SAFETY.
-- SAFETY keeps the participant chain and scoped consent. IDENTITY receives one
-- subject per original assertion and one immutable fact for each evidence class.
ALTER TABLE "safety_depicted_participants" DROP CONSTRAINT "safety_depicted_participants_expiry_check";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP CONSTRAINT "safety_depicted_participants_reference_shape_check";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP CONSTRAINT "safety_depicted_participants_state_check";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP CONSTRAINT "safety_depicted_participants_evidence_shape_check";--> statement-breakpoint
DROP INDEX "safety_depicted_participants_subject_uk";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" ADD COLUMN "identity_subject_reference" uuid;--> statement-breakpoint

CREATE TEMPORARY TABLE "identity_safety_cutover_source" ON COMMIT DROP AS
SELECT participant.*,
  coalesce(participant.supersedes_id, participant.id) AS owner_reference,
  CASE
    WHEN participant.policy_version ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'
      THEN participant.policy_version
    ELSE 'legacy-safety:' || md5(participant.policy_version)
  END AS identity_policy_version,
  CASE
    WHEN participant.verifier ~ '^[a-z0-9][a-z0-9_.:/+-]{0,127}$'
      THEN participant.verifier
    ELSE 'legacy-safety:' || md5(participant.verifier)
  END AS identity_provider
FROM "safety_depicted_participants" AS participant
WHERE participant.evidence_state = 'verified';--> statement-breakpoint

INSERT INTO "identity_subjects" ("created_at", "id", "owner_domain", "owner_reference")
SELECT min(source.verified_at),
  (
    substr(md5('velora:identity:safety:' || source.owner_reference::text), 1, 8) || '-' ||
    substr(md5('velora:identity:safety:' || source.owner_reference::text), 9, 4) || '-' ||
    substr(md5('velora:identity:safety:' || source.owner_reference::text), 13, 4) || '-' ||
    substr(md5('velora:identity:safety:' || source.owner_reference::text), 17, 4) || '-' ||
    substr(md5('velora:identity:safety:' || source.owner_reference::text), 21, 12)
  )::uuid,
  'safety',
  source.owner_reference
FROM "identity_safety_cutover_source" AS source
GROUP BY source.owner_reference
ON CONFLICT ("owner_domain", "owner_reference") DO NOTHING;--> statement-breakpoint

-- One historical provider interaction established two distinct predicates.
-- They become separate terminal attempts because each attempt authorizes exactly
-- one evidence class. Synthetic attempt references remain unique while the old
-- provider fact references are preserved on their respective evidence rows.
INSERT INTO "identity_attempts" (
  "caller_idempotency_key", "completed_at", "created_at", "id", "input_digest",
  "jurisdiction", "policy_version", "provider", "provider_bound_at",
  "provider_idempotency_key", "provider_reference", "purpose",
  "required_evidence_class", "required_threshold", "state", "subject_id", "updated_at"
)
SELECT
  'legacy-safety-identity-' || source.id::text,
  source.verified_at,
  source.verified_at,
  (
    substr(md5('velora:legacy-safety-identity-attempt:' || source.id::text), 1, 8) || '-' ||
    substr(md5('velora:legacy-safety-identity-attempt:' || source.id::text), 9, 4) || '-' ||
    substr(md5('velora:legacy-safety-identity-attempt:' || source.id::text), 13, 4) || '-' ||
    substr(md5('velora:legacy-safety-identity-attempt:' || source.id::text), 17, 4) || '-' ||
    substr(md5('velora:legacy-safety-identity-attempt:' || source.id::text), 21, 12)
  )::uuid,
  md5('velora:legacy-safety-identity-input:' || source.id::text) ||
    md5('velora:legacy-safety-identity-input-2:' || source.id::text),
  'XX',
  source.identity_policy_version,
  source.identity_provider,
  source.verified_at,
  'legacy-safety-identity-' || source.id::text,
  'legacy-safety-identity-' || source.id::text,
  'depicted_person_identity',
  'depicted_person_identity',
  'legacy-depicted-identity',
  'succeeded',
  subject.id,
  source.verified_at
FROM "identity_safety_cutover_source" AS source
JOIN "identity_subjects" AS subject
  ON subject.owner_domain = 'safety' AND subject.owner_reference = source.owner_reference
ORDER BY source.id;--> statement-breakpoint

INSERT INTO "identity_attempts" (
  "caller_idempotency_key", "completed_at", "created_at", "id", "input_digest",
  "jurisdiction", "policy_version", "provider", "provider_bound_at",
  "provider_idempotency_key", "provider_reference", "purpose",
  "required_evidence_class", "required_threshold", "state", "subject_id", "updated_at"
)
SELECT
  'legacy-safety-adult-' || source.id::text,
  source.verified_at,
  source.verified_at,
  (
    substr(md5('velora:legacy-safety-adult-attempt:' || source.id::text), 1, 8) || '-' ||
    substr(md5('velora:legacy-safety-adult-attempt:' || source.id::text), 9, 4) || '-' ||
    substr(md5('velora:legacy-safety-adult-attempt:' || source.id::text), 13, 4) || '-' ||
    substr(md5('velora:legacy-safety-adult-attempt:' || source.id::text), 17, 4) || '-' ||
    substr(md5('velora:legacy-safety-adult-attempt:' || source.id::text), 21, 12)
  )::uuid,
  md5('velora:legacy-safety-adult-input:' || source.id::text) ||
    md5('velora:legacy-safety-adult-input-2:' || source.id::text),
  'XX',
  source.identity_policy_version,
  source.identity_provider,
  source.verified_at,
  'legacy-safety-adult-' || source.id::text,
  'legacy-safety-adult-' || source.id::text,
  'depicted_person_adult_assurance',
  'depicted_person_adult_threshold',
  'legacy-depicted-adult',
  'succeeded',
  subject.id,
  source.verified_at
FROM "identity_safety_cutover_source" AS source
JOIN "identity_subjects" AS subject
  ON subject.owner_domain = 'safety' AND subject.owner_reference = source.owner_reference
ORDER BY source.id;--> statement-breakpoint

INSERT INTO "identity_evidence" (
  "attempt_id", "effective_at", "evidence_class", "expires_at", "id",
  "normalized_result", "policy_version", "provider", "provider_fact_reference",
  "recorded_at", "subject_id", "supersedes_id", "threshold_context"
)
SELECT attempt.id,
  source.verified_at,
  'depicted_person_identity',
  source.expires_at,
  (
    substr(md5('velora:legacy-safety-identity-evidence:' || source.id::text), 1, 8) || '-' ||
    substr(md5('velora:legacy-safety-identity-evidence:' || source.id::text), 9, 4) || '-' ||
    substr(md5('velora:legacy-safety-identity-evidence:' || source.id::text), 13, 4) || '-' ||
    substr(md5('velora:legacy-safety-identity-evidence:' || source.id::text), 17, 4) || '-' ||
    substr(md5('velora:legacy-safety-identity-evidence:' || source.id::text), 21, 12)
  )::uuid,
  'granted',
  source.identity_policy_version,
  source.identity_provider,
  source.identity_evidence_reference,
  source.verified_at,
  subject.id,
  NULL,
  'legacy-depicted-identity'
FROM "identity_safety_cutover_source" AS source
JOIN "identity_subjects" AS subject
  ON subject.owner_domain = 'safety' AND subject.owner_reference = source.owner_reference
JOIN "identity_attempts" AS attempt
  ON attempt.subject_id = subject.id
  AND attempt.purpose = 'depicted_person_identity'
  AND attempt.caller_idempotency_key = 'legacy-safety-identity-' || source.id::text
ORDER BY source.id;--> statement-breakpoint

INSERT INTO "identity_evidence" (
  "attempt_id", "effective_at", "evidence_class", "expires_at", "id",
  "normalized_result", "policy_version", "provider", "provider_fact_reference",
  "recorded_at", "subject_id", "supersedes_id", "threshold_context"
)
SELECT attempt.id,
  source.verified_at,
  'depicted_person_adult_threshold',
  source.expires_at,
  (
    substr(md5('velora:legacy-safety-adult-evidence:' || source.id::text), 1, 8) || '-' ||
    substr(md5('velora:legacy-safety-adult-evidence:' || source.id::text), 9, 4) || '-' ||
    substr(md5('velora:legacy-safety-adult-evidence:' || source.id::text), 13, 4) || '-' ||
    substr(md5('velora:legacy-safety-adult-evidence:' || source.id::text), 17, 4) || '-' ||
    substr(md5('velora:legacy-safety-adult-evidence:' || source.id::text), 21, 12)
  )::uuid,
  'granted',
  source.identity_policy_version,
  source.identity_provider,
  source.adult_assurance_evidence_reference,
  source.verified_at,
  subject.id,
  NULL,
  'legacy-depicted-adult'
FROM "identity_safety_cutover_source" AS source
JOIN "identity_subjects" AS subject
  ON subject.owner_domain = 'safety' AND subject.owner_reference = source.owner_reference
JOIN "identity_attempts" AS attempt
  ON attempt.subject_id = subject.id
  AND attempt.purpose = 'depicted_person_adult_assurance'
  AND attempt.caller_idempotency_key = 'legacy-safety-adult-' || source.id::text
ORDER BY source.id;--> statement-breakpoint

ALTER TABLE "safety_depicted_participants" DISABLE TRIGGER "safety_depicted_participants_append_only";--> statement-breakpoint
UPDATE "safety_depicted_participants" AS participant
SET identity_subject_reference = subject.id,
  evidence_state = 'identity_referenced'
FROM "identity_safety_cutover_source" AS source
JOIN "identity_subjects" AS subject
  ON subject.owner_domain = 'safety' AND subject.owner_reference = source.owner_reference
WHERE participant.id = source.id;--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" ENABLE TRIGGER "safety_depicted_participants_append_only";--> statement-breakpoint

-- Abort before dropping the legacy facts if any participant, subject, attempt,
-- evidence row, or consent linkage was lost.
DO $$
DECLARE
  expected_verified bigint;
  expected_subjects bigint;
BEGIN
  SELECT count(*) INTO expected_verified FROM pg_temp.identity_safety_cutover_source;
  SELECT count(DISTINCT owner_reference) INTO expected_subjects
  FROM pg_temp.identity_safety_cutover_source;

  IF (
    SELECT count(*) FROM public.safety_depicted_participants
    WHERE evidence_state = 'identity_referenced'
  ) <> expected_verified THEN
    RAISE EXCEPTION 'identity safety cutover participant count mismatch';
  END IF;
  IF (
    SELECT count(*) FROM public.identity_subjects AS subject
    WHERE subject.owner_domain = 'safety'
      AND EXISTS (
        SELECT 1 FROM pg_temp.identity_safety_cutover_source AS source
        WHERE source.owner_reference = subject.owner_reference
      )
  ) <> expected_subjects THEN
    RAISE EXCEPTION 'identity safety cutover subject count mismatch';
  END IF;
  IF (
    SELECT count(*) FROM public.identity_attempts
    WHERE caller_idempotency_key LIKE 'legacy-safety-identity-%'
       OR caller_idempotency_key LIKE 'legacy-safety-adult-%'
  ) <> expected_verified * 2 THEN
    RAISE EXCEPTION 'identity safety cutover attempt count mismatch';
  END IF;
  IF (
    SELECT count(*) FROM public.identity_evidence
    WHERE threshold_context IN ('legacy-depicted-identity', 'legacy-depicted-adult')
  ) <> expected_verified * 2 THEN
    RAISE EXCEPTION 'identity safety cutover evidence count mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.safety_consent_records AS consent
    LEFT JOIN public.safety_depicted_participants AS participant
      ON participant.id = consent.participant_id
      AND participant.content_id = consent.content_id
    WHERE participant.id IS NULL
  ) THEN
    RAISE EXCEPTION 'identity safety cutover consent linkage mismatch';
  END IF;
END;
$$;--> statement-breakpoint

CREATE UNIQUE INDEX "safety_depicted_participants_subject_uk" ON "safety_depicted_participants" USING btree ("content_id","identity_subject_reference") WHERE "safety_depicted_participants"."identity_subject_reference" is not null;--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP COLUMN "adult_assurance_evidence_reference";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP COLUMN "expires_at";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP COLUMN "identity_evidence_reference";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP COLUMN "verifier";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP COLUMN "verified_at";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" DROP COLUMN "verifier_subject_reference";--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" ADD CONSTRAINT "safety_depicted_participants_state_check" CHECK ("safety_depicted_participants"."evidence_state" in ('asserted', 'identity_referenced'));--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" ADD CONSTRAINT "safety_depicted_participants_evidence_shape_check" CHECK (("safety_depicted_participants"."evidence_state" = 'identity_referenced') = ("safety_depicted_participants"."identity_subject_reference" is not null));
