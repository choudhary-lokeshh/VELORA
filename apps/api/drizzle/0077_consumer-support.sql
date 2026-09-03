-- Consumer support.
--
-- The one path a person uses when everything else about the product has failed
-- them, and it is two tables in this database rather than a call to a help
-- desk: nothing here can be unavailable, cost money, or be switched off.
--
-- `support_tickets` holds what somebody asked. The reference is generated
-- rather than derived from a counter — a sequential one would tell every
-- person who ever opened a ticket how many the platform has had — and its
-- shape is a CHECK as well as a generator rule, because a reference that did
-- not match is one nobody could type back into the surface that validates it.
-- The owner is an opaque consumer account reference with no foreign key, on
-- the ownership rule every other domain follows.
--
-- `support_ticket_events` is the working record. It is append-only, and the
-- trigger below is why that is a property rather than a convention: this is
-- what an operator relies on when somebody says "I was already told it was
-- fixed", and a record that can be edited is not that record.
--
-- Retention is `DECISION REQUIRED / LEGAL REVIEW REQUIRED` like every other
-- personal-data class here. Nothing expires and no correctness rule depends on
-- a row being physically gone, so an approved schedule later applies as a
-- deletion pass.

CREATE TABLE "support_ticket_events" (
	"actor_reference" text,
	"created_at" timestamp with time zone NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"sequence" bigserial NOT NULL,
	"status" text,
	"ticket_id" uuid NOT NULL,
	CONSTRAINT "support_ticket_events_kind_check" CHECK ("support_ticket_events"."kind" in ('opened', 'status_changed', 'note')),
	CONSTRAINT "support_ticket_events_status_check" CHECK ("support_ticket_events"."status" is null or "support_ticket_events"."status" in ('received', 'in_review', 'resolved', 'closed')),
	CONSTRAINT "support_ticket_events_shape_check" CHECK (("support_ticket_events"."kind" = 'note') = ("support_ticket_events"."status" is null)),
	CONSTRAINT "support_ticket_events_note_length_check" CHECK ("support_ticket_events"."note" is null or char_length("support_ticket_events"."note") between 1 and 1000),
	CONSTRAINT "support_ticket_events_note_presence_check" CHECK ("support_ticket_events"."kind" <> 'note' or "support_ticket_events"."note" is not null)
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"category" text NOT NULL,
	"client_ticket_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "support_tickets_category_check" CHECK ("support_tickets"."category" in ('account_access', 'live', 'safety', 'wallet', 'messaging', 'profile', 'other')),
	CONSTRAINT "support_tickets_status_check" CHECK ("support_tickets"."status" in ('received', 'in_review', 'resolved', 'closed')),
	CONSTRAINT "support_tickets_subject_length_check" CHECK (char_length("support_tickets"."subject") between 3 and 120),
	CONSTRAINT "support_tickets_description_length_check" CHECK (char_length("support_tickets"."description") between 10 and 4000),
	CONSTRAINT "support_tickets_client_ticket_id_length_check" CHECK (char_length("support_tickets"."client_ticket_id") between 8 and 128),
	CONSTRAINT "support_tickets_reference_shape_check" CHECK ("support_tickets"."reference" ~ '^VS-[0-9A-HJ-KMNP-TV-Z]{4}-[0-9A-HJ-KMNP-TV-Z]{4}$'),
	CONSTRAINT "support_tickets_updated_after_creation_check" CHECK ("support_tickets"."updated_at" >= "support_tickets"."created_at")
);
--> statement-breakpoint
ALTER TABLE "support_ticket_events" ADD CONSTRAINT "support_ticket_events_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_ticket_events_ticket_idx" ON "support_ticket_events" USING btree ("ticket_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "support_ticket_events_sequence_uk" ON "support_ticket_events" USING btree ("sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_owner_client_uk" ON "support_tickets" USING btree ("owner_id","client_ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_reference_uk" ON "support_tickets" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_sequence_uk" ON "support_tickets" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "support_tickets_owner_recency_idx" ON "support_tickets" USING btree ("owner_id","created_at","id");--> statement-breakpoint
CREATE INDEX "support_tickets_open_idx" ON "support_tickets" USING btree ("created_at","id") WHERE "support_tickets"."status" in ('received', 'in_review');--> statement-breakpoint
CREATE INDEX "support_tickets_status_recency_idx" ON "support_tickets" USING btree ("status","created_at","id");--> statement-breakpoint
-- The support history is evidence about what was said to somebody, so it is
-- written once and never rewritten. Expressed as a trigger rather than as a
-- convention: a history that a later code path can edit is not a history, and
-- the failure is silent — nobody notices a note that quietly changed.
CREATE OR REPLACE FUNCTION velora_support_events_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'support history is append-only: % on % is not permitted', tg_op, tg_table_name
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "support_ticket_events_append_only"
BEFORE UPDATE OR DELETE ON "support_ticket_events"
FOR EACH ROW EXECUTE FUNCTION velora_support_events_append_only();--> statement-breakpoint
-- A ticket is retained too. Its status moves and nothing else about it does:
-- what somebody wrote, who wrote it, and the reference they were given are the
-- record, and a support surface that could rewrite any of them would be a
-- surface that could rewrite the account of what happened.
CREATE OR REPLACE FUNCTION velora_support_ticket_frozen() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF new.category IS DISTINCT FROM old.category
     OR new.client_ticket_id IS DISTINCT FROM old.client_ticket_id
     OR new.created_at IS DISTINCT FROM old.created_at
     OR new.description IS DISTINCT FROM old.description
     OR new.id IS DISTINCT FROM old.id
     OR new.owner_id IS DISTINCT FROM old.owner_id
     OR new.reference IS DISTINCT FROM old.reference
     OR new.subject IS DISTINCT FROM old.subject THEN
    RAISE EXCEPTION 'a support ticket is frozen: only its status may change'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN new;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "support_tickets_frozen"
BEFORE UPDATE ON "support_tickets"
FOR EACH ROW EXECUTE FUNCTION velora_support_ticket_frozen();--> statement-breakpoint
CREATE TRIGGER "support_tickets_retained"
BEFORE DELETE ON "support_tickets"
FOR EACH ROW EXECUTE FUNCTION velora_support_events_append_only();
