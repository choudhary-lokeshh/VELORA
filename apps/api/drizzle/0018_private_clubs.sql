CREATE TABLE "clubs_invites" (
	"club_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	"revoked_at" timestamp with time zone,
	"token_digest" text NOT NULL,
	CONSTRAINT "clubs_invites_digest_check" CHECK ("clubs_invites"."token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "clubs_invites_expiry_check" CHECK ("clubs_invites"."expires_at" > "clubs_invites"."created_at"),
	CONSTRAINT "clubs_invites_redeemed_shape_check" CHECK (("clubs_invites"."redeemed_at" is null) = ("clubs_invites"."redeemed_by" is null)),
	CONSTRAINT "clubs_invites_settled_once_check" CHECK ("clubs_invites"."redeemed_at" is null or "clubs_invites"."revoked_at" is null)
);
--> statement-breakpoint
CREATE TABLE "clubs_memberships" (
	"club_id" uuid NOT NULL,
	"source" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "clubs_memberships_state_check" CHECK ("clubs_memberships"."state" in ('active', 'revoked')),
	CONSTRAINT "clubs_memberships_source_check" CHECK ("clubs_memberships"."source" in ('creator_invite', 'admin_grant', 'billing')),
	CONSTRAINT "clubs_memberships_revoked_shape_check" CHECK (("clubs_memberships"."state" = 'revoked') = ("clubs_memberships"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "clubs_clubs" (
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"creator_id" uuid NOT NULL,
	"description" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"lifecycle" text NOT NULL,
	"name" text NOT NULL,
	"published_at" timestamp with time zone,
	"slug" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "clubs_clubs_lifecycle_check" CHECK ("clubs_clubs"."lifecycle" in ('draft', 'published', 'closed')),
	CONSTRAINT "clubs_clubs_slug_shape_check" CHECK ("clubs_clubs"."slug" ~ '^[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$'),
	CONSTRAINT "clubs_clubs_name_check" CHECK (char_length("clubs_clubs"."name") between 2 and 80),
	CONSTRAINT "clubs_clubs_description_check" CHECK ("clubs_clubs"."description" is null or char_length("clubs_clubs"."description") between 1 and 600),
	CONSTRAINT "clubs_clubs_published_shape_check" CHECK (("clubs_clubs"."lifecycle" = 'published') = ("clubs_clubs"."published_at" is not null)),
	CONSTRAINT "clubs_clubs_closed_shape_check" CHECK (("clubs_clubs"."lifecycle" = 'closed') = ("clubs_clubs"."closed_at" is not null)),
	CONSTRAINT "clubs_clubs_version_check" CHECK ("clubs_clubs"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "clubs_content" ADD COLUMN "club_id" uuid;--> statement-breakpoint
ALTER TABLE "clubs_invites" ADD CONSTRAINT "clubs_invites_club_id_clubs_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs_clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clubs_memberships" ADD CONSTRAINT "clubs_memberships_club_id_clubs_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs_clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_invites_token_digest_uk" ON "clubs_invites" USING btree ("token_digest");--> statement-breakpoint
CREATE INDEX "clubs_invites_club_idx" ON "clubs_invites" USING btree ("club_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_memberships_live_uk" ON "clubs_memberships" USING btree ("club_id","member_id") WHERE "clubs_memberships"."state" = 'active';--> statement-breakpoint
CREATE INDEX "clubs_memberships_club_idx" ON "clubs_memberships" USING btree ("club_id","granted_at","id");--> statement-breakpoint
CREATE INDEX "clubs_memberships_member_idx" ON "clubs_memberships" USING btree ("member_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_clubs_creator_slug_uk" ON "clubs_clubs" USING btree ("creator_id","slug");--> statement-breakpoint
CREATE INDEX "clubs_clubs_creator_idx" ON "clubs_clubs" USING btree ("creator_id","created_at","id");
