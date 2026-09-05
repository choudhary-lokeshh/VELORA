-- GROWTH: how somebody arrived, and nothing that follows from arriving.
--
-- Four tables and one idea. VELORA has no acquisition budget, so the only ways
-- anybody gets here are a person telling another person, a public page a search
-- engine can read, and a time everybody agrees to be here at. Each of those
-- needs exactly one durable fact recorded about it or it cannot be told apart
-- from a guess, and these are those facts.
--
-- `growth_invites` is one link per account, forever. The uniqueness on the
-- owner is what makes it forever: minting a second code would silently break
-- every link that person had already sent.
--
-- `growth_signup_attributions` is keyed on the account itself. That is the
-- whole idempotency design — a second attribution for the same person is not
-- refused by a service remembering to check, it is impossible — and the
-- self-referral CHECK is the anti-abuse rule stated where it cannot be
-- forgotten.
--
-- `growth_acquisition_events` has four allowed names and no payload column, so
-- a message, a profile field, or a token cannot end up in it. There is no
-- address, referer, user agent, IP, or session identifier anywhere in this
-- migration: a funnel built out of those would be surveillance with a business
-- justification attached, and none of it is needed to count invitations,
-- openings, and signups by channel.
--
-- `growth_live_windows` stores two instants and a name. State is derived on
-- every read rather than stored, because a stored state is wrong for exactly as
-- long as it takes a job to update it — and that job can be late, restarted, or
-- not running.
--
-- Every account reference is an opaque USERS identifier with no foreign key,
-- on the rule `docs/architecture/05-data-ownership.md` records.

CREATE TABLE "growth_acquisition_events" (
	"campaign" text,
	"dedupe_key" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"invite_id" uuid,
	"medium" text,
	"name" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text,
	"subject_id" uuid,
	CONSTRAINT "growth_acquisition_events_name_check" CHECK ("growth_acquisition_events"."name" in ('invite_created', 'invite_opened', 'invite_refused', 'signup_attributed'))
);
--> statement-breakpoint
CREATE TABLE "growth_invites" (
	"code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "growth_invites_code_shape_check" CHECK ("growth_invites"."code" ~ '^[a-z0-9]{22}$'),
	CONSTRAINT "growth_invites_code_length_check" CHECK (char_length("growth_invites"."code") between 22 and 22)
);
--> statement-breakpoint
CREATE TABLE "growth_live_windows" (
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"title" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "growth_live_windows_slug_shape_check" CHECK ("growth_live_windows"."slug" ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
	CONSTRAINT "growth_live_windows_title_length_check" CHECK (char_length("growth_live_windows"."title") between 2 and 80),
	CONSTRAINT "growth_live_windows_order_check" CHECK ("growth_live_windows"."ends_at" > "growth_live_windows"."starts_at"),
	CONSTRAINT "growth_live_windows_duration_check" CHECK ("growth_live_windows"."ends_at" <= "growth_live_windows"."starts_at" + interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE "growth_signup_attributions" (
	"attributed_at" timestamp with time zone NOT NULL,
	"campaign" text,
	"content" text,
	"invite_id" uuid,
	"inviter_user_id" uuid,
	"medium" text,
	"source" text NOT NULL,
	"user_id" uuid PRIMARY KEY NOT NULL,
	CONSTRAINT "growth_signup_attributions_self_referral_check" CHECK ("growth_signup_attributions"."inviter_user_id" is null or "growth_signup_attributions"."inviter_user_id" <> "growth_signup_attributions"."user_id"),
	CONSTRAINT "growth_signup_attributions_invite_pairing_check" CHECK (("growth_signup_attributions"."invite_id" is null) = ("growth_signup_attributions"."inviter_user_id" is null)),
	CONSTRAINT "growth_signup_attributions_source_length_check" CHECK (char_length("growth_signup_attributions"."source") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "growth_acquisition_events" ADD CONSTRAINT "growth_acquisition_events_invite_id_growth_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."growth_invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_signup_attributions" ADD CONSTRAINT "growth_signup_attributions_invite_id_growth_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."growth_invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "growth_acquisition_events_name_recency_idx" ON "growth_acquisition_events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_acquisition_events_dedupe_uk" ON "growth_acquisition_events" USING btree ("name","dedupe_key") WHERE "growth_acquisition_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "growth_invites_code_uk" ON "growth_invites" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_invites_inviter_uk" ON "growth_invites" USING btree ("inviter_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "growth_live_windows_slug_uk" ON "growth_live_windows" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "growth_live_windows_schedule_idx" ON "growth_live_windows" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "growth_signup_attributions_recency_idx" ON "growth_signup_attributions" USING btree ("attributed_at","user_id");--> statement-breakpoint
CREATE INDEX "growth_signup_attributions_source_idx" ON "growth_signup_attributions" USING btree ("source","attributed_at");--> statement-breakpoint
CREATE INDEX "growth_signup_attributions_inviter_idx" ON "growth_signup_attributions" USING btree ("inviter_user_id") WHERE "growth_signup_attributions"."inviter_user_id" is not null;
