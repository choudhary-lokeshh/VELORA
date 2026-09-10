# Hosting and platform eligibility

## Status and method

Research date: **2026-09-11**. This is technical and product eligibility research, not legal advice and not procurement approval.

**No platform is selected, approved, or production-eligible.** The conventions of the other eligibility registers apply unchanged: public silence about VELORA's adult social business is treated as **unapproved**; a policy page that cannot be retrieved is treated as **unread rather than permissive**; and a free tier, a marketing page, or a working deployment is not approval.

Two limits of this research are stated rather than left to be discovered. **Primary-source retrieval succeeded for one candidate.** Fly.io's terms were read directly. Render's Terms of Use and Acceptable Use Policy are served as client-rendered documents and returned navigation markup rather than policy text from this network, so they are recorded as unread. **Free-tier figures below come from secondary comparison sources dated 2026** and are recorded as an indication of shape rather than as quoted terms; every one of them must be re-read from the vendor before it is relied on, and none of them is a reason to choose anything.

This register exists because [ADR-0049](../decisions/ADR-0049-deployment-enablement-and-production-auth.md) made a deployed environment startable, which turns "where does it run" from a distant question into the next one. It narrows nothing on purpose: the decision stays open in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

## The finding that matters most

**The identity provider decision has an option with no vendor content policy in it at all.**

Every provider class VELORA has assessed so far — payments, payouts, media, RTC, identity verification, notifications — has produced the same pattern: prohibition or silence, and silence is not permission. Authentication is the first class where a mature, self-operable option exists. Keycloak (Apache 2.0), Zitadel (AGPL-3.0 core, Apache-2.0 SDKs and protocol definitions), and Authentik are conforming OpenID providers an owner can run themselves, and `AUTH_IDENTITY_PROVIDER=oidc` speaks to any of them without a line of VELORA code changing.

That does not make them approved, and it moves rather than removes the question: an operated identity provider is an operated service with its own upgrades, backups, and on-call — the same trade the RTC register recorded for self-hosted LiveKit. What it does mean is that the identity blocker is not waiting on a vendor's discretion over what VELORA is, which is a materially different kind of blocker from the other seven.

## Application and container hosting

| Candidate | Content and business-model posture | Free-tier shape (secondary sources, 2026) | VELORA eligibility |
|---|---|---|---|
| Fly.io | Terms of Service §4.1, last updated 2026-04-29, warrants that "Customer Data shall not … (b) be deceptive, defamatory, obscene, pornographic or unlawful". The [Acceptable Use Policy](https://fly.io/legal/acceptable-use-policy/) separately prohibits "serving violent or harassing content (doxxing, revenge pornography)" and carries no other sexual-content clause. | No standing free allowance; a trial bounded by VM hours or days. Machines support scale-to-zero with sub-second to low-second cold starts. | **INELIGIBLE ON PUBLISHED TERMS for mature content; unresolved for the current product.** VELORA serves no pornographic data today — `SAFETY_MATURE_CONTENT` admits one value and it is `disabled` — so §4.1 is not breached by what the platform currently does. It forecloses the mature-content phase entirely, which makes it a platform VELORA would have to leave rather than one it could grow on. Written confirmation naming the business model is mandatory before any use. |
| Render | Terms of Use and Acceptable Use Policy could not be read from this network on the research date: both addresses returned navigation markup rather than document text. | The only assessed candidate with a standing free tier; free services idle out after inactivity with a cold start measured in tens of seconds. | **NOT APPROVED — policy text not retrievable.** Unread is not permissive. The idle-and-cold-start behaviour is separately disqualifying for the API, which must answer a readiness probe and a browser within a request timeout. |
| Google Cloud Run | Not assessed. | Scale-to-zero with a standing request allowance. | **NOT ASSESSED.** Google's platform terms and the AI/ML and content clauses that sit above them have not been read for this purpose. |
| Railway | Not assessed. | No standing free tier; a one-time trial credit. | **NOT ASSESSED.** |
| A virtual machine from a general-purpose provider | Not assessed. | Not applicable. | **NOT ASSESSED, and the shape most likely to survive the mature-content phase.** A provider selling compute rather than an application platform is where the other registers' self-hosted options already point, and it is the same operations trade each time. |

## Managed data stores

| Candidate | Fit | Free-tier shape (secondary sources, 2026) | VELORA eligibility |
|---|---|---|---|
| Neon (PostgreSQL) | Scale-to-zero PostgreSQL. | Compute-hours and half a gigabyte per project. | **NOT ASSESSED on terms.** Scale-to-zero is a poor fit for a pool that opens ten connections at startup and refuses to reap them ([ADR-0019](../decisions/ADR-0019-database-connection-admission.md)); a database that suspends underneath it is a readiness failure rather than a saving. |
| Supabase (PostgreSQL) | PostgreSQL plus an auth, storage, and realtime platform VELORA would use none of. | Half a gigabyte, and free projects paused after a week of inactivity. | **NOT ASSESSED on terms.** A project that pauses after a week is unusable for an environment that must answer a probe. |
| Upstash (Redis) | Serverless Redis. | Command-count and data-size bounded. | **NOT ASSESSED on terms.** A command-metered plan is a poor fit for BullMQ, which polls; the ephemeral and queue duties would need separate assessment because only one of them is disposable. |
| Self-operated PostgreSQL 18 and Redis 8 | Exactly what `compose.yaml` already runs locally. | Not applicable. | **NOT ASSESSED, and the only option with no vendor policy question.** It converts the question into backups, upgrades, and on-call, which the [deployment and release](../engineering/10-deployment-and-release.md) document already names as owner decisions. |

## Identity providers

| Candidate | Licence and shape | VELORA eligibility |
|---|---|---|
| Keycloak | Apache 2.0. Mature OpenID Connect, SAML, and LDAP federation; the most widely operated of the three. | **NOT APPROVED — no content-policy blocker.** Operating it is the whole of the remaining question: upgrades, backups, and who is paged. |
| Zitadel | Core AGPL-3.0 since v3; APIs, SDKs, and protocol definitions Apache 2.0, so an application that merely speaks OIDC to it is unaffected. Go, built for horizontal scale. | **NOT APPROVED — no content-policy blocker.** The licence matters only if an owner redistributes or embeds it, which VELORA would not. |
| Authentik | Open source, strongest administrative interface of the three at small scale. | **NOT APPROVED — no content-policy blocker.** |
| A hosted identity platform | Not assessed. | **NOT ASSESSED.** Every hosted candidate reintroduces exactly the vendor-discretion question the three above remove, and none has been read on its terms. |

## Email submission

Not assessed on primary text. A search of the four most commonly compared transactional providers returned product comparisons and no retrievable acceptable-use text addressing adult content, which is the same absence the [notification provider eligibility](11-notification-provider-eligibility.md) register already records.

Two things are worth stating anyway. `AUTH_RECOVERY_DELIVERY=smtp` speaks to an owner-operated relay exactly as it speaks to a hosted provider, so this class has a self-operated option like identity does. And email is blocked a second time regardless: no domain in VELORA stores a consumer's email address, so an approved provider would still have nowhere to send. That is the [email address ownership](../decisions/DECISIONS_REQUIRED.md) decision and no vendor answers it.

## What this register decides

Nothing, and deliberately. It records three things for the owner:

1. **Fly.io's published terms foreclose the mature-content phase**, which is the first hosting-specific content finding this project has and is worth knowing before anything is built on it.
2. **Two policy documents could not be read**, and they stay unread rather than becoming permissive by default.
3. **Authentication, and only authentication, has a credible option with no vendor content policy in it.** Every other blocked class still ends at somebody else's discretion.

The hosting decision itself remains open in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) under cloud, container, registry, DNS, and CDN, and it must be answered with written vendor confirmation naming VELORA's business model, exactly as the payment, media, and RTC registers require.

## Cross-references

[deployment and release](../engineering/10-deployment-and-release.md),
[configuration and environments](../engineering/07-configuration-environments.md),
[media provider eligibility](08-media-provider-eligibility.md),
[RTC provider eligibility](10-rtc-provider-eligibility.md),
[notification provider eligibility](11-notification-provider-eligibility.md),
[ADR-0014](../decisions/ADR-0014-deployment-environments-cicd.md),
[ADR-0049](../decisions/ADR-0049-deployment-enablement-and-production-auth.md).
