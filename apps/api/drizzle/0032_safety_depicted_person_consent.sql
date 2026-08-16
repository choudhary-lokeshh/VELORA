-- TRUST & SAFETY depicted-person evidence and consent.
--
-- Three records that answer two different questions about a piece of creator
-- content. *Who is depicted, and did anybody check?* is identity and age
-- evidence. *What did that person agree to?* is consent, and it is scoped
-- rather than universal, because "this person once consented to something" is
-- not permission for anything else.
--
-- Velora holds no identification document, no image, and no biometric
-- template, and there is no column here one could be put in. What it holds is a
-- reference to an approved verifier's outcome. `docs/compliance/07-surface-and-
-- distribution-eligibility.md` records the reasoning from primary sources: 18
-- U.S.C. 2257 requires identity and date of birth to be ascertained by
-- examining an identification document, and a table of those documents would be
-- the highest-value breach target the platform could build in exchange for
-- evidence Velora is probably not the right party to hold. Whether Velora is
-- that party at all is a legal question recorded as unresolved rather than
-- answered here.
--
-- A declaration is mutable and the evidence is not. A creator who adds a person
-- to a shoot has changed the answer rather than falsified the old one; who is
-- depicted and what they agreed to is append-only, because that is the part an
-- audit reads. A trigger refuses every update and delete on both evidence
-- tables.
--
-- Nothing here enables mature content. Two independent configuration gates
-- guard all of it and both refuse in every deployed environment: no verifier is
-- approved, so nobody can be recorded as verified, and no consent wording is
-- approved, so no grant can be recorded at all.
CREATE TABLE "safety_content_depictions" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"declaration" text NOT NULL,
	"declared_at" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "safety_content_depictions_declaration_check" CHECK ("safety_content_depictions"."declaration" in ('no_depicted_persons', 'depicted_persons')),
	CONSTRAINT "safety_content_depictions_version_check" CHECK ("safety_content_depictions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "safety_depicted_participants" (
	"adult_assurance_evidence_reference" text,
	"content_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"declared_at" timestamp with time zone NOT NULL,
	"evidence_state" text NOT NULL,
	"expires_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"identity_evidence_reference" text,
	"policy_version" text NOT NULL,
	"supersedes_id" uuid,
	"verifier" text,
	"verified_at" timestamp with time zone,
	"verifier_subject_reference" text,
	CONSTRAINT "safety_depicted_participants_state_check" CHECK ("safety_depicted_participants"."evidence_state" in ('asserted', 'verified')),
	CONSTRAINT "safety_depicted_participants_evidence_shape_check" CHECK (("safety_depicted_participants"."evidence_state" = 'verified') = ("safety_depicted_participants"."verifier" is not null)
        and ("safety_depicted_participants"."evidence_state" = 'verified') = ("safety_depicted_participants"."verifier_subject_reference" is not null)
        and ("safety_depicted_participants"."evidence_state" = 'verified') = ("safety_depicted_participants"."identity_evidence_reference" is not null)
        and ("safety_depicted_participants"."evidence_state" = 'verified') = ("safety_depicted_participants"."adult_assurance_evidence_reference" is not null)
        and ("safety_depicted_participants"."evidence_state" = 'verified') = ("safety_depicted_participants"."verified_at" is not null)),
	CONSTRAINT "safety_depicted_participants_expiry_check" CHECK ("safety_depicted_participants"."expires_at" is null
        or ("safety_depicted_participants"."verified_at" is not null and "safety_depicted_participants"."expires_at" > "safety_depicted_participants"."verified_at")),
	CONSTRAINT "safety_depicted_participants_reference_shape_check" CHECK (("safety_depicted_participants"."identity_evidence_reference" is null or "safety_depicted_participants"."identity_evidence_reference" ~ '^[A-Za-z0-9._:-]{1,200}$')
        and ("safety_depicted_participants"."adult_assurance_evidence_reference" is null or "safety_depicted_participants"."adult_assurance_evidence_reference" ~ '^[A-Za-z0-9._:-]{1,200}$')
        and ("safety_depicted_participants"."verifier_subject_reference" is null or "safety_depicted_participants"."verifier_subject_reference" ~ '^[A-Za-z0-9._:-]{1,200}$')),
	CONSTRAINT "safety_depicted_participants_supersedes_self_check" CHECK ("safety_depicted_participants"."supersedes_id" is null or "safety_depicted_participants"."supersedes_id" <> "safety_depicted_participants"."id")
);
--> statement-breakpoint
CREATE TABLE "safety_consent_records" (
	"actor_reference" text NOT NULL,
	"consent_evidence_reference" text,
	"content_id" uuid NOT NULL,
	"copy_version" text NOT NULL,
	"disposition" text NOT NULL,
	"expires_at" timestamp with time zone,
	"id" uuid PRIMARY KEY NOT NULL,
	"participant_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"scope" text NOT NULL,
	"supersedes_id" uuid,
	CONSTRAINT "safety_consent_records_disposition_check" CHECK ("safety_consent_records"."disposition" in ('grant', 'revoke')),
	CONSTRAINT "safety_consent_records_scope_check" CHECK ("safety_consent_records"."scope" in ('publication', 'distribution', 'commercial_use')),
	CONSTRAINT "safety_consent_records_revocation_shape_check" CHECK ("safety_consent_records"."disposition" = 'grant' or "safety_consent_records"."supersedes_id" is not null),
	CONSTRAINT "safety_consent_records_revocation_expiry_check" CHECK ("safety_consent_records"."disposition" = 'grant' or "safety_consent_records"."expires_at" is null),
	CONSTRAINT "safety_consent_records_expiry_check" CHECK ("safety_consent_records"."expires_at" is null or "safety_consent_records"."expires_at" > "safety_consent_records"."recorded_at"),
	CONSTRAINT "safety_consent_records_copy_version_check" CHECK (char_length("safety_consent_records"."copy_version") between 1 and 64),
	CONSTRAINT "safety_consent_records_grant_evidence_check" CHECK (("safety_consent_records"."disposition" = 'grant') = ("safety_consent_records"."consent_evidence_reference" is not null)),
	CONSTRAINT "safety_consent_records_evidence_reference_check" CHECK ("safety_consent_records"."consent_evidence_reference" is null
        or "safety_consent_records"."consent_evidence_reference" ~ '^[A-Za-z0-9._:-]{1,200}$'),
	CONSTRAINT "safety_consent_records_supersedes_self_check" CHECK ("safety_consent_records"."supersedes_id" is null or "safety_consent_records"."supersedes_id" <> "safety_consent_records"."id")
);
--> statement-breakpoint
-- A participant cannot exist without a declaration, so no item can carry
-- evidence about somebody nobody said was there.
ALTER TABLE "safety_depicted_participants" ADD CONSTRAINT "safety_depicted_participants_content_id_safety_content_depictions_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."safety_content_depictions"("content_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_depicted_participants" ADD CONSTRAINT "safety_depicted_participants_supersedes_id_safety_depicted_participants_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."safety_depicted_participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_content_depictions_creator_idx" ON "safety_content_depictions" USING btree ("creator_id","declared_at");--> statement-breakpoint
CREATE INDEX "safety_depicted_participants_content_idx" ON "safety_depicted_participants" USING btree ("content_id","declared_at","id");--> statement-breakpoint
-- The target of the composite foreign key below, so a consent record and the
-- participant it names always agree on which item they are about.
CREATE UNIQUE INDEX "safety_depicted_participants_identity_uk" ON "safety_depicted_participants" USING btree ("id","content_id");--> statement-breakpoint
-- One verified person appears once on one item. Before verification there is no
-- identifier to deduplicate on, and inventing one would mean deriving a stable
-- handle for a person from something the platform must not hold.
CREATE UNIQUE INDEX "safety_depicted_participants_subject_uk" ON "safety_depicted_participants" USING btree ("content_id","verifier_subject_reference") WHERE "safety_depicted_participants"."verifier_subject_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "safety_depicted_participants_supersedes_uk" ON "safety_depicted_participants" USING btree ("supersedes_id") WHERE "safety_depicted_participants"."supersedes_id" is not null;--> statement-breakpoint
ALTER TABLE "safety_consent_records" ADD CONSTRAINT "safety_consent_records_participant_fk" FOREIGN KEY ("participant_id","content_id") REFERENCES "public"."safety_depicted_participants"("id","content_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_consent_records" ADD CONSTRAINT "safety_consent_records_supersedes_id_safety_consent_records_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."safety_consent_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safety_consent_records_participant_idx" ON "safety_consent_records" USING btree ("participant_id","recorded_at","id");--> statement-breakpoint
CREATE INDEX "safety_consent_records_content_idx" ON "safety_consent_records" USING btree ("content_id","scope","recorded_at");--> statement-breakpoint
-- A withdrawal cannot fork: two records revoking the same grant would be two
-- equally valid histories of one person's decision.
CREATE UNIQUE INDEX "safety_consent_records_supersedes_uk" ON "safety_consent_records" USING btree ("supersedes_id") WHERE "safety_consent_records"."supersedes_id" is not null;--> statement-breakpoint

-- Append-only, enforced by PostgreSQL rather than by the code that writes.
-- The function is the one `0031_safety_evidence_decisions` created; these two
-- tables join the evidence and decision records under it, because a consent
-- record a creator could edit afterwards is not evidence of anything.
CREATE TRIGGER "safety_depicted_participants_append_only"
BEFORE UPDATE OR DELETE ON "safety_depicted_participants"
FOR EACH ROW EXECUTE FUNCTION velora_safety_reject_mutation();--> statement-breakpoint
CREATE TRIGGER "safety_consent_records_append_only"
BEFORE UPDATE OR DELETE ON "safety_consent_records"
FOR EACH ROW EXECUTE FUNCTION velora_safety_reject_mutation();
