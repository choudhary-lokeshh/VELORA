CREATE TABLE "clubs_benefits" (
	"club_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	CONSTRAINT "clubs_benefits_position_check" CHECK ("clubs_benefits"."position" >= 0),
	CONSTRAINT "clubs_benefits_position_bound_check" CHECK ("clubs_benefits"."position" < 8),
	CONSTRAINT "clubs_benefits_text_check" CHECK (char_length("clubs_benefits"."text") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "clubs_benefits" ADD CONSTRAINT "clubs_benefits_club_id_clubs_clubs_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."clubs_clubs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clubs_benefits_position_uk" ON "clubs_benefits" USING btree ("club_id","position");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_expiry_idx" ON "billing_subscriptions" USING btree ("current_period_end","id") WHERE "billing_subscriptions"."state" = 'cancel_at_period_end';
