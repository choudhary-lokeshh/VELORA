DROP INDEX "billing_prices_live_uk";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_prices_live_recurring_uk" ON "billing_prices" USING btree ("offer_id","currency","billing_interval") WHERE "billing_prices"."state" = 'active' and "billing_prices"."billing_interval" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_prices_live_once_uk" ON "billing_prices" USING btree ("offer_id","currency") WHERE "billing_prices"."state" = 'active' and "billing_prices"."billing_interval" is null;
