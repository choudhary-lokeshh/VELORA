-- Account closure.
--
-- Two vocabularies gain one value each, and both are about recording what
-- actually happened rather than the nearest thing already in the list.
--
-- AUTH gains `account_closed`. `administrative` would record an operator acting
-- on somebody who in fact acted on themselves, and `logout_all` is a person
-- signing other devices out of an account they still hold. Neither is true of
-- somebody who has left.
--
-- NOTIFICATIONS gains the same value for the same reason: `retired` records
-- somebody else acting on a registration and `signed_out` is a device leaving
-- an account that still exists. A registration retired for this reason is never
-- re-enabled, like every other one in that list — there is nothing left to
-- reach.
--
-- No table, column, or index changes. Everything closure needs on the USERS
-- side — the `deletion_pending` status, `deletion_requested_at`, and the CHECK
-- that refuses a deletion state with no recorded request — has been in
-- `0002_users` since Phase 1, unreachable because no route led to it.

ALTER TABLE "auth_refresh_families" DROP CONSTRAINT "auth_refresh_families_revocation_reason_check";--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP CONSTRAINT "auth_sessions_revocation_reason_check";--> statement-breakpoint
ALTER TABLE "notifications_push_devices" DROP CONSTRAINT "notifications_push_devices_disable_reason_check";--> statement-breakpoint
ALTER TABLE "auth_refresh_families" ADD CONSTRAINT "auth_refresh_families_revocation_reason_check" CHECK ("auth_refresh_families"."revocation_reason" is null or "auth_refresh_families"."revocation_reason" in ('logout', 'logout_all', 'account_recovery', 'privileged_recovery', 'refresh_reuse_detected', 'superseded', 'administrative', 'account_closed'));--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_revocation_reason_check" CHECK ("auth_sessions"."revocation_reason" is null or "auth_sessions"."revocation_reason" in ('logout', 'logout_all', 'account_recovery', 'privileged_recovery', 'refresh_reuse_detected', 'superseded', 'administrative', 'account_closed'));--> statement-breakpoint
ALTER TABLE "notifications_push_devices" ADD CONSTRAINT "notifications_push_devices_disable_reason_check" CHECK ("notifications_push_devices"."disable_reason" is null or "notifications_push_devices"."disable_reason" in ('signed_out', 'claimed_by_another_principal', 'token_rotated', 'provider_invalidated', 'retired', 'account_closed'));
