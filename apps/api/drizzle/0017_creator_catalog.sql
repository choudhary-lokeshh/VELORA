CREATE TABLE "clubs_content" (
	"archived_at" timestamp with time zone,
	"body" text,
	"created_at" timestamp with time zone NOT NULL,
	"creator_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"lifecycle" text NOT NULL,
	"published_at" timestamp with time zone,
	"summary" text,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"visibility" text NOT NULL,
	CONSTRAINT "clubs_content_lifecycle_check" CHECK ("clubs_content"."lifecycle" in ('draft', 'published', 'archived')),
	CONSTRAINT "clubs_content_visibility_check" CHECK ("clubs_content"."visibility" in ('public', 'members_only')),
	CONSTRAINT "clubs_content_title_check" CHECK (char_length("clubs_content"."title") between 2 and 120),
	CONSTRAINT "clubs_content_summary_check" CHECK ("clubs_content"."summary" is null or char_length("clubs_content"."summary") between 1 and 300),
	CONSTRAINT "clubs_content_body_check" CHECK ("clubs_content"."body" is null or char_length("clubs_content"."body") between 1 and 20000),
	CONSTRAINT "clubs_content_published_shape_check" CHECK (("clubs_content"."lifecycle" = 'published') = ("clubs_content"."published_at" is not null)),
	CONSTRAINT "clubs_content_archived_shape_check" CHECK (("clubs_content"."lifecycle" = 'archived') = ("clubs_content"."archived_at" is not null)),
	CONSTRAINT "clubs_content_version_check" CHECK ("clubs_content"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX "clubs_content_published_idx" ON "clubs_content" USING btree ("creator_id","published_at","id") WHERE "clubs_content"."lifecycle" = 'published';--> statement-breakpoint
CREATE INDEX "clubs_content_creator_idx" ON "clubs_content" USING btree ("creator_id","created_at","id");
