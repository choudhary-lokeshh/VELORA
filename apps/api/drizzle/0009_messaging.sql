CREATE TABLE "messaging_conversations" (
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"message_sequence" bigint DEFAULT 0 NOT NULL,
	"origin_introduction_id" uuid NOT NULL,
	"pair_high_id" uuid NOT NULL,
	"pair_low_id" uuid NOT NULL,
	"state" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messaging_conversations_state_check" CHECK ("messaging_conversations"."state" in ('active', 'closed')),
	CONSTRAINT "messaging_conversations_pair_order_check" CHECK ("messaging_conversations"."pair_low_id" < "messaging_conversations"."pair_high_id"),
	CONSTRAINT "messaging_conversations_sequence_check" CHECK ("messaging_conversations"."message_sequence" >= 0),
	CONSTRAINT "messaging_conversations_activity_check" CHECK ("messaging_conversations"."last_activity_at" >= "messaging_conversations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "messaging_messages" (
	"body" text NOT NULL,
	"client_message_id" text NOT NULL,
	"conversation_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"sender_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messaging_messages_sequence_check" CHECK ("messaging_messages"."sequence" >= 1),
	CONSTRAINT "messaging_messages_body_check" CHECK (char_length("messaging_messages"."body") between 1 and 4000 and btrim("messaging_messages"."body") <> ''),
	CONSTRAINT "messaging_messages_client_id_check" CHECK (char_length("messaging_messages"."client_message_id") between 8 and 128)
);
--> statement-breakpoint
CREATE TABLE "messaging_participants" (
	"conversation_id" uuid NOT NULL,
	"id" bigserial PRIMARY KEY NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"last_read_at" timestamp with time zone,
	"last_read_sequence" bigint DEFAULT 0 NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "messaging_participants_read_sequence_check" CHECK ("messaging_participants"."last_read_sequence" >= 0),
	CONSTRAINT "messaging_participants_read_shape_check" CHECK (("messaging_participants"."last_read_sequence" = 0) or ("messaging_participants"."last_read_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_conversation_id_messaging_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."messaging_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_participants" ADD CONSTRAINT "messaging_participants_conversation_id_messaging_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."messaging_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_conversations_pair_uk" ON "messaging_conversations" USING btree ("pair_low_id","pair_high_id");--> statement-breakpoint
CREATE INDEX "messaging_conversations_low_activity_idx" ON "messaging_conversations" USING btree ("pair_low_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "messaging_conversations_high_activity_idx" ON "messaging_conversations" USING btree ("pair_high_id","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_messages_order_uk" ON "messaging_messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_messages_client_id_uk" ON "messaging_messages" USING btree ("conversation_id","sender_id","client_message_id");--> statement-breakpoint
CREATE INDEX "messaging_messages_sender_idx" ON "messaging_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_participants_membership_uk" ON "messaging_participants" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "messaging_participants_user_idx" ON "messaging_participants" USING btree ("user_id");
