ALTER TABLE "wallet_live_preference_entitlements" ADD COLUMN "preference_gender" text;--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" ADD COLUMN "preference_language" text;--> statement-breakpoint
-- A window is a conjunction of declared preferences rather than one kind and
-- one value. Existing rows all carry `preference_kind = 'region'` with a region
-- set, so they satisfy the replacement selection check unchanged and no data
-- moves; the kind column simply stops meaning anything once a window can hold
-- more than one narrowing at a time.
ALTER TABLE "wallet_live_preference_entitlements" DROP CONSTRAINT "wallet_live_preference_region_shape_check";--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" DROP CONSTRAINT "wallet_live_preference_kind_check";--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" DROP COLUMN "preference_kind";--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" ADD CONSTRAINT "wallet_live_preference_selection_check" CHECK ("wallet_live_preference_entitlements"."preference_gender" is not null or "wallet_live_preference_entitlements"."preference_region" is not null or "wallet_live_preference_entitlements"."preference_language" is not null);--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" ADD CONSTRAINT "wallet_live_preference_gender_check" CHECK ("wallet_live_preference_entitlements"."preference_gender" is null or "wallet_live_preference_entitlements"."preference_gender" in ('woman', 'man', 'non_binary'));--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" ADD CONSTRAINT "wallet_live_preference_language_check" CHECK ("wallet_live_preference_entitlements"."preference_language" is null or "wallet_live_preference_entitlements"."preference_language" ~ '^[a-z]{2,3}$');--> statement-breakpoint
-- `expired` is what a charged window becomes when its time is up. It is not a
-- settlement: the money moved at capture, and this state only records that the
-- narrowing has stopped. It is distinct from `released` because a released
-- window is one nobody was charged for, and collapsing the two would make "how
-- often does a paid window find nobody" unanswerable.
ALTER TABLE "wallet_live_preference_entitlements" DROP CONSTRAINT "wallet_live_preference_state_check";--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" ADD CONSTRAINT "wallet_live_preference_state_check" CHECK ("wallet_live_preference_entitlements"."state" in ('active', 'captured', 'expired', 'released', 'cancelled'));--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" DROP CONSTRAINT "wallet_live_preference_encounter_shape_check";--> statement-breakpoint
ALTER TABLE "wallet_live_preference_entitlements" ADD CONSTRAINT "wallet_live_preference_encounter_shape_check" CHECK (("wallet_live_preference_entitlements"."state" in ('captured', 'expired')) = ("wallet_live_preference_entitlements"."encounter_id" is not null));--> statement-breakpoint
-- One open window per person, now counting a charged one.
--
-- This is the load-bearing half of "a charged window is still a window". The
-- old index was on `state = 'active'` alone, so the instant a window was
-- charged it stopped blocking a second activation — and, worse, stopped being
-- found by the matcher at all, which meant the fifteen minutes somebody bought
-- silently became one match.
DROP INDEX "wallet_live_preference_active_uk";--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_live_preference_open_uk" ON "wallet_live_preference_entitlements" USING btree ("user_id") WHERE "wallet_live_preference_entitlements"."state" in ('active', 'captured');--> statement-breakpoint
DROP INDEX "wallet_live_preference_expiry_idx";--> statement-breakpoint
CREATE INDEX "wallet_live_preference_expiry_idx" ON "wallet_live_preference_entitlements" USING btree ("expires_at") WHERE "wallet_live_preference_entitlements"."state" in ('active', 'captured');
