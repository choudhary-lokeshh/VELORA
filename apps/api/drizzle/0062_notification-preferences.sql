CREATE TABLE "notifications_preferences" (
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"enabled" boolean NOT NULL,
	"recipient_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notifications_preferences_pk" PRIMARY KEY("recipient_id","category","channel"),
	CONSTRAINT "notifications_preferences_category_check" CHECK ("notifications_preferences"."category" in ('account_security', 'safety_legal', 'direct_message', 'introduction', 'call', 'marketing')),
	CONSTRAINT "notifications_preferences_channel_check" CHECK ("notifications_preferences"."channel" in ('push', 'email', 'sms')),
	CONSTRAINT "notifications_preferences_mandatory_check" CHECK ("notifications_preferences"."enabled" or "notifications_preferences"."category" not in ('account_security', 'safety_legal'))
);
--> statement-breakpoint
ALTER TABLE "notifications_intents" DROP CONSTRAINT "notifications_intents_suppression_check";--> statement-breakpoint
ALTER TABLE "notifications_intents" ADD CONSTRAINT "notifications_intents_suppression_check" CHECK ("notifications_intents"."suppression_reason" is null or "notifications_intents"."suppression_reason" in ('safety_block', 'recipient_not_deliverable', 'expired', 'recipient_opted_out'));
