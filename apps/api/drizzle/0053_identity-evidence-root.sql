CREATE UNIQUE INDEX "identity_evidence_root_uk" ON "identity_evidence" USING btree ("subject_id","evidence_class") WHERE "identity_evidence"."supersedes_id" is null;
