DROP INDEX "discovery_outbox_claimable_idx";--> statement-breakpoint
DROP INDEX "messaging_outbox_claimable_idx";--> statement-breakpoint
CREATE INDEX "discovery_outbox_claimable_idx" ON "discovery_outbox" USING btree ("sequence") WHERE "discovery_outbox"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "messaging_outbox_claimable_idx" ON "messaging_outbox" USING btree ("sequence") WHERE "messaging_outbox"."state" = 'pending';
