CREATE TABLE "users_matching_declarations" (
	"created_at" timestamp with time zone NOT NULL,
	"matching_gender" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"user_id" uuid PRIMARY KEY NOT NULL,
	CONSTRAINT "users_matching_declarations_gender_check" CHECK ("users_matching_declarations"."matching_gender" in ('woman', 'man', 'non_binary', 'undisclosed')),
	CONSTRAINT "users_matching_declarations_updated_after_creation_check" CHECK ("users_matching_declarations"."updated_at" >= "users_matching_declarations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "users_matching_declarations" ADD CONSTRAINT "users_matching_declarations_user_id_users_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_matching_declarations_category_idx" ON "users_matching_declarations" USING btree ("matching_gender","user_id");
--> statement-breakpoint
-- There is deliberately no backfill, and no default.
--
-- Every account that exists when this runs has no row here, which is the state
-- that means "nobody has been asked". Choosing a value for somebody would be
-- exactly the inference this attribute exists to make impossible, and a default
-- would be the same thing spelled as DDL: a declaration nobody made, indexed
-- and matchable.
--
-- The absence is also why this is a new table rather than a column. A nullable
-- column on `users_profiles` would have been swept into every projection that
-- already selects that row, and the difference between "declined to say" and
-- "never asked" would have had to survive as a convention about NULL.
