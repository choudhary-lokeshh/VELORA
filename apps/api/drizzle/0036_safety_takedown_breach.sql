-- TRUST & SAFETY: recording that a takedown deadline passed.
--
-- The worker sweep writes the fact as `system_fact` evidence on the case and
-- stamps it here in the same transaction, which is what makes the sweep
-- idempotent: a claim whose breach is recorded stops being offered, so a worker
-- that dies before committing has the work repeated and one that dies after it
-- does not. Two sweeps cannot both record one breach, because the stamp is
-- written only while the writer still holds the lease.
--
-- Recording a passed deadline decides nothing. It is a fact about the
-- platform's own timeliness; the decision the claim was owed is still a
-- reviewer's, and a sweep that quietly actioned a claim would be automation
-- deciding a safety matter, which this domain does not do.
--
-- On a platform that publishes no deadline policy there is nothing to pass, so
-- this column stays null everywhere -- which is the accurate state rather than
-- an idle loop pretending otherwise.
ALTER TABLE "safety_takedown_claims" ADD COLUMN "breach_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "safety_takedown_claims" ADD CONSTRAINT "safety_takedown_claims_breach_shape_check" CHECK ("safety_takedown_claims"."breach_recorded_at" is null or "safety_takedown_claims"."action_due_at" is not null);
