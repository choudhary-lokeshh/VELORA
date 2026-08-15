ALTER TABLE "safety_enforcements" DROP CONSTRAINT "safety_enforcements_scope_check";--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD COLUMN "target_object_id" uuid;--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD COLUMN "target_object_type" text;--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_object_shape_check" CHECK (("safety_enforcements"."scope" in ('creator_object_removal', 'club_membership_revocation')) = ("safety_enforcements"."target_object_id" is not null));--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_object_pairing_check" CHECK (("safety_enforcements"."target_object_id" is null) = ("safety_enforcements"."target_object_type" is null));--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_object_type_check" CHECK ("safety_enforcements"."target_object_type" is null or "safety_enforcements"."target_object_type" in ('creator_profile', 'creator_content', 'club', 'club_membership'));--> statement-breakpoint
ALTER TABLE "safety_enforcements" ADD CONSTRAINT "safety_enforcements_scope_check" CHECK ("safety_enforcements"."scope" in ('account_restriction', 'conversation_closure', 'creator_suspension', 'creator_reinstatement', 'creator_object_removal', 'club_membership_revocation'));
