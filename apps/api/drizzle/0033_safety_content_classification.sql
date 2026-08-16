-- TRUST & SAFETY content classification.
--
-- What a content item is, as its creator declares it. Three classes rather
-- than one `mature` boolean, because the classes carry different evidence
-- obligations: 18 U.S.C. 2257 attaches to depictions of *actual* sexually
-- explicit conduct and not to simulated conduct, so a taxonomy that could not
-- tell them apart would either over-collect evidence for one or under-collect
-- it for the other. The source and its retrieval date are recorded in
-- `docs/compliance/07-surface-and-distribution-eligibility.md`.
--
-- A missing row is not `general`. It is an item nobody has classified, and the
-- content gate refuses a mature capability on one rather than inferring a class
-- from silence.
--
-- **A row here enables nothing.** Declaring an item `mature_actual` makes it
-- refusable for a reason rather than refusable for a missing declaration. The
-- capability itself has one configured value in every environment and it is
-- off, and the configuration schema admits no other value, so there is no state
-- to flip. The partial index below expects to stay empty.
CREATE TABLE "safety_content_classifications" (
	"classification" text NOT NULL,
	"content_id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"declared_at" timestamp with time zone NOT NULL,
	"policy_version" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "safety_content_classifications_classification_check" CHECK ("safety_content_classifications"."classification" in ('general', 'mature_simulated', 'mature_actual')),
	CONSTRAINT "safety_content_classifications_version_check" CHECK ("safety_content_classifications"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX "safety_content_classifications_creator_idx" ON "safety_content_classifications" USING btree ("creator_id","declared_at");--> statement-breakpoint
CREATE INDEX "safety_content_classifications_mature_idx" ON "safety_content_classifications" USING btree ("classification","declared_at") WHERE "safety_content_classifications"."classification" in ('mature_actual', 'mature_simulated');
