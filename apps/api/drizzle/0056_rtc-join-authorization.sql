CREATE TABLE "realtime_join_issuances" (
	"authorization_generation" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "realtime_join_issuances_generation_check" CHECK ("realtime_join_issuances"."authorization_generation" >= 1),
	CONSTRAINT "realtime_join_issuances_expiry_check" CHECK ("realtime_join_issuances"."expires_at" > "realtime_join_issuances"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "realtime_join_issuances" ADD CONSTRAINT "realtime_join_issuances_session_id_realtime_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."realtime_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_join_issuances_session_idx" ON "realtime_join_issuances" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "realtime_join_issuances_user_idx" ON "realtime_join_issuances" USING btree ("user_id","issued_at");
