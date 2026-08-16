-- Five indexes, every one of them added because a plan was measured rather
-- than because a column looked like it wanted one.
--
-- Measured on the real schema at four hundred thousand assets, two hundred
-- thousand upload windows, two hundred thousand stored objects, and two hundred
-- thousand obligations, with `EXPLAIN (ANALYZE, BUFFERS)`. Buffers rather than
-- timings throughout: a duration is a property of the machine that ran it, and
-- a buffer count is a property of the plan, which is the thing a later change
-- can silently take away.
--
-- `media_assets_lifecycle_idx` is narrow, on the lifecycle alone, and it earns
-- its keep twice. Reconciliation's stall query filters on *which* transient
-- state an asset is in, and the existing partial index is keyed on the instant
-- rather than the state -- so with nothing leading on the lifecycle the planner
-- scanned every asset on the platform every sixty seconds: 10,440 buffers,
-- against 6 now. The same index turns the operator screen's `group by
-- lifecycle` into an index-only scan: 10,450 buffers against 349. A composite
-- on (lifecycle, lifecycle_changed_at, id) fixes the stall query just as well,
-- is seven times the size, and is then declined by the planner for the
-- aggregate for being wider than the question -- so it would have cost more and
-- fixed less. Wider is not safer.
--
-- `media_objects_role_state_idx` and `media_obligations_kind_state_idx` are the
-- other two halves of that screen: 7,424 buffers against 177, and 3,472 against
-- 177. The claimable index cannot serve the obligations one, because it is
-- partial on `pending` and the screen's whole purpose is to show what was
-- discharged and what was given up on.
--
-- These three were declined once, on the reasoning that covering indexes would
-- tax every write for a screen nobody reads continuously. That was a judgement
-- made without numbers. Measured, they are 2,784 kB, 1,416 kB, and 1,416 kB
-- against an 82 MB table, and they buy twenty to thirty times. The write cost
-- is one b-tree append per insert and per transition on a low-cardinality
-- column.
--
-- `media_upload_sessions_stranded_idx` makes the crash window cheap as well as
-- visible. The recovery sweep looks for windows that committed and never got a
-- provider capability; without an index it scanned every open window and sorted
-- the result on every cycle. Partial, so it holds only the stranded ones: 32 kB
-- against a 42 MB table, and it shrinks back to nothing as they are recovered.
--
-- `users_profile_media_readiness_idx` is recreated with NULLS FIRST, and this
-- one is a defect rather than a tuning. The readiness sweep orders `asc nulls
-- first` so a never-checked slot is picked up before a stale one; a b-tree ASC
-- index stores nulls **last**, so the index as declared could not serve that
-- ordering at all and the planner answered with a sequential scan and a sort of
-- every attached slot, every cycle. The comment above the query claimed the
-- index served it. Confirmed on two hundred thousand rows: parallel seq scan
-- plus sort before, plain index scan after.
--
-- Dropping and recreating rather than reindexing, because the ordering is part
-- of the index definition and cannot be altered in place. The index is a sweep
-- accelerator and nothing reads through it for correctness, so the window in
-- which it does not exist costs a slower sweep and never a wrong answer.
DROP INDEX "users_profile_media_readiness_idx";--> statement-breakpoint
CREATE INDEX "media_assets_lifecycle_idx" ON "media_assets" USING btree ("lifecycle");--> statement-breakpoint
CREATE INDEX "media_objects_role_state_idx" ON "media_objects" USING btree ("role","state");--> statement-breakpoint
CREATE INDEX "media_obligations_kind_state_idx" ON "media_obligations" USING btree ("kind","state");--> statement-breakpoint
CREATE INDEX "media_upload_sessions_stranded_idx" ON "media_upload_sessions" USING btree ("created_at","id") WHERE "media_upload_sessions"."state" = 'issued' and "media_upload_sessions"."provider_reference" is null;--> statement-breakpoint
CREATE INDEX "users_profile_media_readiness_idx" ON "users_profile_media" USING btree ("readiness_checked_at" NULLS FIRST,"id") WHERE "users_profile_media"."state" = 'attached';
