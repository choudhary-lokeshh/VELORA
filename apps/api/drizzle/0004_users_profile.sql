CREATE TABLE "users_preferences" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_preferences_version_check" CHECK ("users_preferences"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "users_profile_languages" (
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"language" text NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "users_profile_languages_user_id_language_pk" PRIMARY KEY("user_id","language"),
	CONSTRAINT "users_profile_languages_shape_check" CHECK ("users_profile_languages"."language" ~ '^[a-z]{2,3}$')
);
--> statement-breakpoint
CREATE TABLE "users_profile_media" (
	"byte_size" integer,
	"checksum" text,
	"content_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"ready_at" timestamp with time zone,
	"rejection_reason" text,
	"state" text NOT NULL,
	"state_changed_at" timestamp with time zone NOT NULL,
	"storage_key" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "users_profile_media_state_check" CHECK ("users_profile_media"."state" in ('pending_upload', 'ready', 'rejected', 'removed')),
	CONSTRAINT "users_profile_media_position_check" CHECK ("users_profile_media"."position" between 0 and 5),
	CONSTRAINT "users_profile_media_content_type_check" CHECK ("users_profile_media"."content_type" is null or "users_profile_media"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "users_profile_media_byte_size_check" CHECK ("users_profile_media"."byte_size" is null or ("users_profile_media"."byte_size" > 0 and "users_profile_media"."byte_size" <= 8388608)),
	CONSTRAINT "users_profile_media_checksum_check" CHECK ("users_profile_media"."checksum" is null or "users_profile_media"."checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "users_profile_media_ready_shape_check" CHECK ("users_profile_media"."state" <> 'ready' or ("users_profile_media"."byte_size" is not null and "users_profile_media"."content_type" is not null and "users_profile_media"."checksum" is not null and "users_profile_media"."ready_at" is not null)),
	CONSTRAINT "users_profile_media_rejection_shape_check" CHECK (("users_profile_media"."state" = 'rejected') = ("users_profile_media"."rejection_reason" is not null)),
	CONSTRAINT "users_profile_media_rejection_reason_check" CHECK ("users_profile_media"."rejection_reason" is null or "users_profile_media"."rejection_reason" in ('unsupported_type', 'too_large', 'not_uploaded', 'content_rejected'))
);
--> statement-breakpoint
CREATE TABLE "users_profiles" (
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_profiles_display_name_length_check" CHECK (char_length("users_profiles"."display_name") between 2 and 32),
	CONSTRAINT "users_profiles_display_name_shape_check" CHECK ("users_profiles"."display_name" !~ '[[:cntrl:]]' and btrim("users_profiles"."display_name") = "users_profiles"."display_name"),
	CONSTRAINT "users_profiles_bio_length_check" CHECK ("users_profiles"."bio" is null or char_length("users_profiles"."bio") <= 500),
	CONSTRAINT "users_profiles_version_check" CHECK ("users_profiles"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "users_preferences" ADD CONSTRAINT "users_preferences_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_profile_languages" ADD CONSTRAINT "users_profile_languages_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_profile_media" ADD CONSTRAINT "users_profile_media_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_profiles" ADD CONSTRAINT "users_profiles_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_profile_languages_language_idx" ON "users_profile_languages" USING btree ("language","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_profile_media_storage_key_uk" ON "users_profile_media" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "users_profile_media_position_uk" ON "users_profile_media" USING btree ("user_id","position") WHERE "users_profile_media"."state" <> 'removed';--> statement-breakpoint
CREATE INDEX "users_profile_media_user_state_idx" ON "users_profile_media" USING btree ("user_id","state");
