ALTER TABLE "auth_identities" DROP CONSTRAINT "auth_identities_provider_check";--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_provider_check" CHECK ("auth_identities"."provider" in ('local', 'oidc'));
