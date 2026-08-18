DROP INDEX "identity_attempts_subject_history_idx";--> statement-breakpoint
ALTER TABLE "identity_attempts" ADD COLUMN "sequence" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_attempts" DISABLE TRIGGER "identity_attempts_transition_valid";--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, updated_at, id) AS stable_sequence
  FROM identity_attempts
)
UPDATE identity_attempts AS attempt
SET sequence = ordered.stable_sequence
FROM ordered
WHERE attempt.id = ordered.id;--> statement-breakpoint
ALTER TABLE "identity_attempts" ENABLE TRIGGER "identity_attempts_transition_valid";--> statement-breakpoint
SELECT setval(
  pg_get_serial_sequence('identity_attempts', 'sequence'),
  coalesce((SELECT max(sequence) FROM identity_attempts), 1),
  EXISTS (SELECT 1 FROM identity_attempts)
);--> statement-breakpoint
CREATE INDEX "identity_attempts_subject_history_idx" ON "identity_attempts" USING btree ("subject_id","purpose","sequence");
