-- Whose sale an offer is, and therefore whose money it becomes.
--
-- Every existing offer is a creator's, so the default is `creator` and the
-- backfill is the default. It is dropped immediately afterwards: a default
-- would mean a future insert that forgot to say who was selling would silently
-- claim to be a creator's, which is the one mistake this column exists to make
-- impossible.
ALTER TABLE "billing_offers" ADD COLUMN "owner_type" text DEFAULT 'creator' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_offers" ALTER COLUMN "owner_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "billing_offers" ALTER COLUMN "creator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_offers" ADD CONSTRAINT "billing_offers_owner_type_check" CHECK ("billing_offers"."owner_type" in ('creator', 'platform'));--> statement-breakpoint
-- A creator offer names a creator and a platform offer must not. Without this,
-- "whose money is this" would be answerable two ways for the same row, and the
-- settlement that reads it would pick one.
ALTER TABLE "billing_offers" ADD CONSTRAINT "billing_offers_owner_shape_check" CHECK (("billing_offers"."owner_type" = 'creator') = ("billing_offers"."creator_id" is not null));--> statement-breakpoint
-- Coins are the platform's own product and nobody else's. A creator selling
-- them would be a creator selling VELORA's currency.
ALTER TABLE "billing_offers" DROP CONSTRAINT "billing_offers_resource_type_check";--> statement-breakpoint
ALTER TABLE "billing_offers" ADD CONSTRAINT "billing_offers_resource_type_check" CHECK ("billing_offers"."resource_type" in ('club', 'gift', 'coins'));--> statement-breakpoint
ALTER TABLE "billing_offers" ADD CONSTRAINT "billing_offers_coins_owner_check" CHECK ("billing_offers"."resource_type" <> 'coins' or "billing_offers"."owner_type" = 'platform');--> statement-breakpoint
-- The seller is coalesced rather than left null in both of these, because two
-- platform offers for the same resource would both have a null creator and
-- NULLs do not collide in a unique index — so the one-live-offer rule would
-- silently stop applying to exactly the offers nobody owns.
DROP INDEX "billing_offers_live_uk";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_offers_live_uk" ON "billing_offers" USING btree (coalesce("creator_id", '00000000-0000-0000-0000-000000000000'::uuid),"resource_type","resource_id","commercial_mode") WHERE "billing_offers"."state" <> 'retired';--> statement-breakpoint
DROP INDEX "billing_offers_creator_idx";--> statement-breakpoint
CREATE INDEX "billing_offers_creator_idx" ON "billing_offers" USING btree (coalesce("creator_id", '00000000-0000-0000-0000-000000000000'::uuid),"created_at","id");
