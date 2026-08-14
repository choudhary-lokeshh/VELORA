CREATE TABLE "users_availability" (
	"available_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid PRIMARY KEY NOT NULL,
	CONSTRAINT "users_availability_state_check" CHECK ("users_availability"."state" in ('available', 'unavailable')),
	CONSTRAINT "users_availability_window_shape_check" CHECK (("users_availability"."state" = 'available') = ("users_availability"."available_until" is not null)),
	CONSTRAINT "users_availability_revision_check" CHECK ("users_availability"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "users_availability" ADD CONSTRAINT "users_availability_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_availability_open_window_idx" ON "users_availability" USING btree ("available_until","user_id");
