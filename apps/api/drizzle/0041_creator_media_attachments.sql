-- Creator media: an avatar, a cover, and images on content items.
--
-- Three attachments, all opaque MEDIA references with no foreign key, on the
-- ownership rule every other cross-domain reference here follows. CREATORS
-- decides which asset is an avatar and which is a cover; PRIVATE CLUBS decides
-- which images hang off which content item and in what order. Neither knows
-- what the bytes are, and neither decides whether they may be shown.
--
-- The uniqueness rules are about not spending one asset twice. An asset fills
-- at most one avatar slot and at most one cover slot across the whole platform,
-- cannot be both for the same creator, and belongs to at most one content item
-- — so detaching and reattaching elsewhere is an explicit act rather than a
-- second silent reference to the same bytes.
--
-- Nothing here is a publication decision. A row means a creator attached an
-- image; whether it reaches anybody depends on the item's lifecycle and
-- visibility, the viewer's club membership, the creator's standing, and the
-- content safety gate, all re-read at the moment a credential is issued.
CREATE TABLE "clubs_content_media" (
	"content_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "clubs_content_media_position_check" CHECK ("clubs_content_media"."position" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "creators_profiles" ADD COLUMN "avatar_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "creators_profiles" ADD COLUMN "cover_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "clubs_content_media" ADD CONSTRAINT "clubs_content_media_content_id_clubs_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."clubs_content"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_content_media_asset_uk" ON "clubs_content_media" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_content_media_position_uk" ON "clubs_content_media" USING btree ("content_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_profiles_avatar_uk" ON "creators_profiles" USING btree ("avatar_media_asset_id") WHERE "creators_profiles"."avatar_media_asset_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "creators_profiles_cover_uk" ON "creators_profiles" USING btree ("cover_media_asset_id") WHERE "creators_profiles"."cover_media_asset_id" is not null;--> statement-breakpoint
ALTER TABLE "creators_profiles" ADD CONSTRAINT "creators_profiles_distinct_media_check" CHECK ("creators_profiles"."avatar_media_asset_id" is null or "creators_profiles"."avatar_media_asset_id" <> "creators_profiles"."cover_media_asset_id");
