DROP INDEX "identity_attempts_subject_history_idx";--> statement-breakpoint
CREATE INDEX "identity_attempts_subject_history_idx" ON "identity_attempts" USING btree ("subject_id","sequence");
