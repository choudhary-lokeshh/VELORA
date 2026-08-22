CREATE TABLE "notifications_push_devices" (
	"created_at" timestamp with time zone NOT NULL,
	"disable_reason" text,
	"disabled_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"platform" text NOT NULL,
	"recipient_id" uuid NOT NULL,
	"token_fingerprint" text NOT NULL,
	CONSTRAINT "notifications_push_devices_platform_check" CHECK ("notifications_push_devices"."platform" in ('ios', 'android')),
	CONSTRAINT "notifications_push_devices_fingerprint_check" CHECK ("notifications_push_devices"."token_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "notifications_push_devices_installation_check" CHECK (char_length("notifications_push_devices"."installation_id") between 8 and 256),
	CONSTRAINT "notifications_push_devices_disabled_shape_check" CHECK (("notifications_push_devices"."disabled_at" is null) = ("notifications_push_devices"."disable_reason" is null)),
	CONSTRAINT "notifications_push_devices_disable_reason_check" CHECK ("notifications_push_devices"."disable_reason" is null or "notifications_push_devices"."disable_reason" in ('signed_out', 'claimed_by_another_principal', 'token_rotated', 'provider_invalidated', 'retired')),
	CONSTRAINT "notifications_push_devices_seen_check" CHECK ("notifications_push_devices"."last_seen_at" >= "notifications_push_devices"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_push_devices_token_uk" ON "notifications_push_devices" USING btree ("token_fingerprint") WHERE "notifications_push_devices"."disabled_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_push_devices_installation_uk" ON "notifications_push_devices" USING btree ("recipient_id","installation_id") WHERE "notifications_push_devices"."disabled_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_push_devices_recipient_idx" ON "notifications_push_devices" USING btree ("recipient_id") WHERE "notifications_push_devices"."disabled_at" is null;
