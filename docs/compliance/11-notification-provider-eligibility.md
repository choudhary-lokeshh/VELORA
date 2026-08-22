# Notification provider eligibility

## Status and method

`DECISION REQUIRED / LEGAL REVIEW REQUIRED`. This register records what email and mobile-push providers publish about the business VELORA is, read from each vendor's own current policy text on the retrieval date below. It decides nothing about product design; it decides whether a vendor may carry a notice at all.

Findings were retrieved on **2026-08-22** from official vendor sources only. Marketing pages, support articles, and third-party summaries were not treated as terms — one support article for a vendor assessed here described an adult-business accommodation that the vendor's own governing policy contradicts, so only the governing document is quoted.

Three rules apply, and they are the same rules the [media](08-media-provider-eligibility.md), [identity](09-identity-verification-provider-eligibility.md), and [RTC](10-rtc-provider-eligibility.md) registers use.

- **Silence is not permission.** A policy that never mentions lawful adult content has given no answer. It is recorded as unresolved, never as approval.
- **Unread is not permissive.** A policy that could not be retrieved is unresolved, and the reason is recorded.
- **A prohibition is decisive.** Where a vendor forecloses the category, no technical assessment reopens it. Only a written exception naming VELORA's business would.

## Email eligibility matrix

| Candidate | Governing source and retrieval | Published content posture | VELORA eligibility |
| --- | --- | --- | --- |
| Amazon SES | [AWS Acceptable Use Policy](https://aws.amazon.com/aup/), read 2026-08-22 | Six prohibited categories: illegal or fraudulent activity, violating the rights of others, threatening violence or terrorism, child sexual exploitation or abuse, violating the security or integrity of systems, and distributing spam. No clause addresses lawful adult content, pornography, or dating services in either direction. | **NOT APPROVED — silent.** The policy forecloses nothing VELORA does and permits nothing either. The same AWS AUP is already recorded as unresolved for Chime SDK in the RTC register, so one written answer from AWS would move both. Sender identity, domain verification, region, and bounce/complaint handling are all assessable only after that answer. |
| Postmark | [Terms of Service](https://postmarkapp.com/terms-of-service), read 2026-08-22 | Restricted business types include, verbatim, "Pornography/sexually explicit content" and "Escort services". | **INELIGIBLE ON PUBLISHED TERMS.** A prohibition, not a silence. Excluded unless the vendor issues a written exception naming VELORA's business. |
| Resend | [Acceptable Use Policy](https://resend.com/legal/acceptable-use), read 2026-08-22 | Prohibited sending content includes, verbatim, "Pornography/sexually explicit content" and "Escort services", closing with "Other emails that we find, in our sole discretion, hurt our reputation or our deliverability". | **INELIGIBLE ON PUBLISHED TERMS.** The named prohibition decides it; the sole-discretion clause would make any accommodation revocable without notice even if one were granted. |
| SendGrid | [Twilio Email Policy](https://www.twilio.com/en-us/legal/service-country-specific-terms/email), effective 2026-04-09, read 2026-08-22 | Prohibited content includes, verbatim, "Pornography or sexually explicit content" and "Escort services, mail-order bride or spouse finders, international marriage brokers, and other similar services". Separately, for age-restricted-but-permitted categories, a sender "must verify that a recipient is at least of legal age to provide affirmative consent to receive such an email based on where that recipient is located". | **INELIGIBLE ON PUBLISHED TERMS.** "Other similar services" reaches an adults-only introduction platform on its face. The general [Twilio AUP](https://www.twilio.com/en-us/legal/aup) contains no adult-content clause, and a vendor support article describes an adult-business accommodation; neither overrides the service-specific policy quoted here, and the discrepancy is itself a reason to require a written answer rather than to rely on the more permissive text. |
| Mailgun (Sinch Email) | [Acceptable Use Policy](https://www.mailgun.com/legal/aup/), read 2026-08-22 | Prohibits content that "Constitutes, depicts, fosters, promotes or relates in any manner to child pornography, bestiality, non-consensual sex acts". No clause addresses lawful adult content between consenting adults. Section 3 states the vendor "does not work in principle with senders who promote the following activities" and requires "sufficient and specific guarantees" before working with certain business types. | **NOT APPROVED — written guarantees required and not held.** The only assessed email vendor whose text contemplates a case-by-case answer rather than a blanket rule. The prohibitions it does state are ones VELORA independently enforces. The eligibility question is whether Sinch will put an answer in writing. |
| SparkPost (Bird) | [Acceptable Use Policy](https://bird.com/legal/acceptable-use-policy), read 2026-08-22 | Prohibits transmitting content that "is racist, obscene, offensive, tortious, libelous, defamatory, discriminatory...or pornographic". | **INELIGIBLE ON PUBLISHED TERMS.** "Obscene", "offensive", and "pornographic" in one unbounded list is a prohibition over exactly the category VELORA operates in. |

## Mobile push eligibility matrix

| Candidate | Governing source and retrieval | Published content posture | VELORA eligibility |
| --- | --- | --- | --- |
| Apple APNs | [Apple Developer Program License Agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/) §3.2 and Attachment 1, read 2026-08-22 | §3.2 prohibits use "for any unlawful or illegal activity", "to threaten, incite, or promote violence, terrorism, or other serious harm", and "to create or distribute any content or activity that promotes child sexual exploitation or abuse". The APNs-specific terms live in Attachment 1, which is not rendered on the public agreement page and was not retrievable on the retrieval date. | **NOT APPROVED — governing attachment not retrieved, and separately unreachable.** The main agreement forecloses nothing VELORA does, but the APNs-specific text is the part that governs and it has not been read. Distribution is gated independently by the App Store Review Guidelines already recorded in [surface and distribution eligibility](07-surface-and-distribution-eligibility.md). |
| Firebase Cloud Messaging | [Google Cloud Platform Acceptable Use Policy](https://cloud.google.com/terms/aup), read 2026-08-22 | Not assessed. Firebase services are subject to the Google Cloud Platform terms, and the AUP page could not be retrieved in readable form on the retrieval date. | **NOT APPROVED — policy text not retrievable.** Unread is not permissive. Re-retrieve before any assessment. |
| Expo Push Service | [Expo Terms of Service](https://expo.dev/terms) §2.4 and §2.7, read 2026-08-22 | The Terms prohibit developing apps that are "crypto-mining projects, scrapers, spyware, or malware, or that otherwise violate the applicable terms and policies of app distribution services", and incorporate an Acceptable Use Policy and Community Guidelines by reference whose text is not in the Terms. No push-specific service level, rate limit, or content clause appears in the Terms. | **NOT APPROVED — incorporated policy not read, and it relays rather than replaces.** Expo's push service forwards to APNs and FCM, so it inherits both of their unresolved answers and adds a third party to the trust path for a notification payload. The §2.4 clause also makes app-store policy compliance a term of the Expo agreement itself. |

## The blocker that is VELORA's own

No push provider can be assessed into eligibility, because the mobile application cannot register for push at all. A device token is issued by APNs or FCM to a signed native binary holding the right entitlement; Velora has no native build pipeline. [The RTC freeze report](../architecture/16-rtc-freeze-report.md) already records the same gap for mobile media: "a native build pipeline that compiles, links, signs, and runs the app before the gate may call it verified."

This is worth stating separately from the vendor findings because it does not move when a vendor answers. Even an approved provider with signed terms would deliver nothing until that pipeline exists, and any push integration built before it can be proven is untested code claiming a capability. The delivery core is therefore built provider-neutral and push registration remains refused.

## What the matrix decides

Four of six assessed email vendors prohibit the category in their own published words. One is silent. One will consider it with written guarantees nobody has obtained. That is not a shortlist; it is the finding that transactional email for an adults-only platform is a commercial negotiation rather than a signup, and it has to be treated as one.

Nothing here changes what the platform builds. It changes what the platform may switch on. `NOTIFICATIONS_DELIVERY_CHANNEL` stays `unavailable` in every deployed environment, and `unavailable` is not an error state: it reports that no attempt was made, spends no attempt budget, records no attempt row, and leaves the notice owed in PostgreSQL. A provider approved a year from now inherits a backlog that is intact rather than one that quietly expired.

## Required provider decision record

Before any email or push provider is enabled in a deployed environment, a decision record must carry all of:

- the vendor's written answer, naming VELORA's business, on whether an adults-only social platform may send transactional mail or push through the service;
- which document that answer amends, and whether it survives the vendor's unilateral-change and sole-discretion clauses;
- sender identity and domain-verification posture, and who holds the DNS authority for it;
- the regions the vendor processes in, against [data residency and retention](05-data-residency-retention.md);
- callback authentication: the exact signature scheme, over which bytes, with which key custody and rotation path;
- bounce, complaint, and suppression semantics, including whether the vendor maintains its own suppression list and whether VELORA can read and write it;
- rate limits, payload bounds, and documented retry semantics;
- for push, the token-invalidation signal and how a token retired by the provider reaches this platform;
- an operations owner and alert routing;
- security, privacy, and legal review, recorded per the rule in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).

A provider that satisfies the technical half and none of the written half is not eligible. That ordering is deliberate: the technical work is recoverable, and sending an adults-only platform's mail through a vendor that forbids it is not.

## Review triggers

Re-retrieve every source above when any of these happens: a vendor publishes a new effective date; VELORA obtains a written answer from any vendor; a launch country is approved; the native build pipeline lands; or twelve months pass from the retrieval date, whichever is first.

## Current decision

**No email provider is approved. No push provider is approved. Live delivery is blocked on both channels.** The delivery core is provider-neutral and fail-closed, the test adapter is refused outside local and test, and the only deployable behaviour is to hold the notice.

## Cross-references

- [NOTIFICATIONS](../domains/notifications.md): what the domain owns, and what it minimizes.
- [Notification request and delivery flow](../flows/notification-delivery.md): the delivery path and its privacy rules.
- [ADR-0026](../decisions/ADR-0026-notification-delivery-platform.md): the delivery platform architecture these findings constrain.
- [Surface and distribution eligibility](07-surface-and-distribution-eligibility.md): the App Store and Play gates that govern the mobile surface independently of any push vendor.
- [Provider adapters](../architecture/06-provider-adapters.md): why every one of these sits behind a port.
