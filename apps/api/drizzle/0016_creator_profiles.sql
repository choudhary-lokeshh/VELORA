CREATE TABLE "creators_profile_links" (
	"creator_id" uuid NOT NULL,
	"label" text,
	"position" integer NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "creators_profile_links_creator_id_position_pk" PRIMARY KEY("creator_id","position"),
	CONSTRAINT "creators_profile_links_position_check" CHECK ("creators_profile_links"."position" between 0 and 4),
	CONSTRAINT "creators_profile_links_url_check" CHECK ("creators_profile_links"."url" like 'https://%' and "creators_profile_links"."url" not like '%@%' and char_length("creators_profile_links"."url") between 9 and 200),
	CONSTRAINT "creators_profile_links_label_check" CHECK ("creators_profile_links"."label" is null or char_length("creators_profile_links"."label") between 1 and 40)
);
--> statement-breakpoint
CREATE TABLE "creators_profiles" (
	"bio" text,
	"created_at" timestamp with time zone NOT NULL,
	"creator_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"publication" text NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "creators_profiles_handle_shape_check" CHECK ("creators_profiles"."handle" ~ '^[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$'),
	CONSTRAINT "creators_profiles_handle_length_check" CHECK (char_length("creators_profiles"."handle") between 3 and 30),
	CONSTRAINT "creators_profiles_handle_reserved_check" CHECK (not "creators_profiles"."handle" in ('about', 'account', 'accounts', 'admin', 'administrator', 'api', 'app', 'auth', 'billing', 'blog', 'c', 'club', 'clubs', 'contact', 'creator', 'creators', 'dashboard', 'discovery', 'docs', 'explore', 'faq', 'help', 'home', 'legal', 'login', 'logout', 'me', 'messages', 'moderation', 'new', 'notifications', 'null', 'official', 'payments', 'payouts', 'policy', 'privacy', 'profile', 'register', 'report', 'root', 'safety', 'search', 'security', 'settings', 'signin', 'signout', 'signup', 'static', 'status', 'studio', 'support', 'system', 'terms', 'trust', 'undefined', 'user', 'users', 'velora', 'www')),
	CONSTRAINT "creators_profiles_display_name_check" CHECK (char_length("creators_profiles"."display_name") between 2 and 60),
	CONSTRAINT "creators_profiles_bio_check" CHECK ("creators_profiles"."bio" is null or char_length("creators_profiles"."bio") between 1 and 600),
	CONSTRAINT "creators_profiles_publication_check" CHECK ("creators_profiles"."publication" in ('draft', 'published')),
	CONSTRAINT "creators_profiles_published_shape_check" CHECK (("creators_profiles"."publication" = 'published') = ("creators_profiles"."published_at" is not null)),
	CONSTRAINT "creators_profiles_version_check" CHECK ("creators_profiles"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "creators_profile_links" ADD CONSTRAINT "creators_profile_links_creator_id_creators_profiles_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators_profiles"("creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators_profiles" ADD CONSTRAINT "creators_profiles_creator_id_creators_accounts_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creators_profiles_handle_uk" ON "creators_profiles" USING btree ("handle");
