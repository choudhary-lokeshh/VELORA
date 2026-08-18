# Payment and payout provider eligibility

## Purpose and status

This document records what payment and payout providers currently say, in their own published policies, about businesses shaped like Velora. It exists so that provider selection is an evidence-backed decision rather than a popularity contest, and so that the reason production money movement stays blocked is written down with sources rather than asserted.

It is architecture and product guidance, not legal advice, and it is not a contract. A provider's published policy is the floor, never the approval: several providers below reserve the right to decline a business their public list appears to permit, and one of them says so explicitly. Nothing here authorises connecting a provider. That requires the full gate in [payments, tax, and payout gates](04-payments-tax-payout-gates.md) plus a provider-specific ADR under [provider adapters](../architecture/06-provider-adapters.md).

Findings are dated. A policy page is a moving document; an entry whose retrieval date has aged past its review trigger is stale evidence and must be re-verified before it supports any decision.

## How Velora must describe itself

Provider eligibility turns on what the business actually is, and Velora is two things at once. Describing only the flattering half to a provider would be misrepresentation, which is forbidden outright.

| Attribute | Value | Why a provider cares |
|---|---|---|
| Audience | Adults only, 18+ | Not by itself an adult-content business, but triggers enhanced diligence at several providers |
| Core product | Social discovery and mutual introductions between consumers | Falls under "online dating and matchmaking" at every provider that names the category |
| Commercial product | Creator private clubs — consumers pay a creator for access to that creator's content | Falls under "platform that enables content creators to receive payments in exchange for their content" |
| Money model | Platform collects from consumers and later disburses to third-party creators | Marketplace, platform, or payment-facilitator model, which is a separate policy axis from the content axis |
| Mature or explicit creator content | Not enabled. `Conditional / Compliance-Gated` in [product phases](../product/01-product-phases.md) and gated by [creator and content gates](03-creator-content-gates.md) | Decides the entire eligibility picture, and flips several providers from restricted to prohibited |

The last row is the one that matters most, and it has two answers. Velora today hosts no explicit content and has no path to publishing any. Velora's stated direction, recorded in [Creator Private Clubs](../product/03-creator-private-clubs.md), keeps mature creator content as a gated possibility. A provider approved against the first answer is not thereby approved against the second, and the eligibility matrix below is therefore evaluated twice.

## Eligibility matrix

Retrieved 2026-08-15 from the primary sources named in the last column. `Prohibited` and `Restricted` use each provider's own vocabulary. `Restricted` generally means the provider will consider the business under additional diligence and may require written approval; it never means permitted by default.

### Payment acceptance

| Provider | Adult / sexually explicit content | Dating and matchmaking | Creator-payment platform | Verdict for Velora today | Verdict if mature content is enabled | Source and date |
|---|---|---|---|---|---|---|
| Stripe | **Prohibited.** "Pornography and other mature audience content (including literature, imagery and other media) designed for the purpose of sexual gratification", plus "adult services" and "any artificial-intelligence generated content that meets the above criteria" | **Restricted.** "Online dating and matchmaking services", with the note that "specific prohibitions apply in India, United Arab Emirates and Thailand" | **Restricted.** "Platforms that host or distribute third-party content and enable content creators to receive content-related tips and other payments in exchange for their content" | **Not eligible without Stripe's written approval.** Velora sits in two restricted categories simultaneously, and is prohibited outright for the dating product in India, UAE, and Thailand | **Ineligible.** Prohibited category, no approval path published | [Stripe restricted businesses](https://stripe.com/legal/restricted-businesses), page last updated 2026-05-13, retrieved 2026-08-15 |
| PayPal | **Prohibited for digital delivery.** Sexually oriented digital goods and content delivered through a digital medium — downloadable images or video and website subscriptions — are prohibited; certain physical sexually oriented goods are permitted US-domestic only | Not separately enumerated in the acceptable-use policy | Not separately enumerated | **Not eligible for the commercial product.** Creator club access is a digital subscription, which is the exact shape PayPal names | **Ineligible** | [PayPal acceptable use policy](https://www.paypal.com/us/legalhub/paypal/acceptableuse-full) and [sexually oriented goods policy](https://www.paypal.com/us/cshelp/article/what-is-paypal%E2%80%99s-policy-on-transactions-that-involve-sexually-oriented-goods-and-services-help384), retrieved 2026-08-15 |
| Adyen | **Prohibited.** "Content: books, magazines, audio, videos, websites, streaming services and other content formats deemed offensive or of a sexual nature"; adult goods excluding fetish products are Restricted | **Restricted** for the merchant model; **prohibited** for the platform model | Live-streaming without in-app currency Restricted for both models; live-streaming with in-app donations **prohibited** for platform businesses; marketplaces and aggregators Restricted for merchants only | **Not eligible as a platform.** Velora is unavoidably the platform model, and casual dating is prohibited there | **Ineligible** | [Adyen restricted and prohibited list](https://www.adyen.com/legal/list-restricted-prohibited), page last updated 2025-11-13, retrieved 2026-08-15 |
| Razorpay | Prohibited. Obscene and pornographic content is prohibited; adult entertainment and dating sites are named as high-risk categories | High-risk category | Not separately enumerated; intangible-goods restrictions apply and acquiring-bank discretion is explicit | **Not eligible without written acquiring-bank approval**, and India-specific dating prohibitions at other providers indicate the jurisdictional risk is real rather than theoretical | **Ineligible** | [Razorpay terms](https://razorpay.com/terms/), retrieved 2026-08-15 |
| Segpay | **Supported.** Adult and dating are named verticals | **Supported** | Supported; the company publishes creator-payout tooling | **Candidate, subject to onboarding.** Merchant entity must be located in the United States, United Kingdom, or Europe; settlement in USD, EUR, or GBP; high-risk card-network registration fees apply | **Candidate** — this is the category of provider that survives the mature-content answer | [Segpay high-risk verticals](https://segpay.com/verticals/high-risk/) and [client FAQ](https://cs.segpay.com/faq/), retrieved 2026-08-15 |
| CCBill | Publicly positioned as an adult-industry processor | Positioned for dating | Positioned for creator sites | **Unassessed.** The official policy pages returned HTTP 404 on retrieval and no primary source was obtained, so no eligibility claim is recorded here | **Unassessed** | Attempted 2026-08-15; no retrievable primary source |

### Payout and disbursement

| Provider | Adult / creator-payout stance | Verdict for Velora | Source and date |
|---|---|---|---|
| Stripe Connect | Inherits Stripe's restricted-businesses list in full | **Ineligible on the same grounds as Stripe acceptance.** A payout product does not have a separate content policy | [Stripe restricted businesses](https://stripe.com/legal/restricted-businesses), retrieved 2026-08-15 |
| PayPal Payouts | Inherits the PayPal acceptable-use policy | **Ineligible on the same grounds as PayPal acceptance** | [PayPal acceptable use policy](https://www.paypal.com/us/legalhub/paypal/acceptableuse-full), retrieved 2026-08-15 |
| Wise | **Prohibited.** "Pornography and other visual content depicting explicitly sexual acts"; "services of sexual nature (webcam shows, live chats, prostitution, escorts, etc)"; "sexually oriented establishments". Separately, "transmitting money, or any representation of monetary value, on behalf of third parties" is unsupported, and marketplaces outside the EEA, EU, and United States are restricted | **Ineligible twice over.** The third-party transmission clause describes creator payouts precisely, independent of any content question | [Wise acceptable use policy](https://wise.com/gb/legal/acceptable-use-policy), page last updated 2026-03-25, retrieved 2026-08-15 |
| Airwallex | Adult content and related services listed as an unsupported industry | **Ineligible** | [Airwallex unsupported industries](https://help.airwallex.com/hc/en-gb/articles/4410623274905-Unsupported-Industries), retrieved 2026-08-15 |
| Segpay | Publishes creator, model, and affiliate payout tooling alongside merchant settlement | **Candidate, subject to onboarding and to whether its payout instrument satisfies Velora's creator countries** | [Segpay creator payouts](https://segpay.com/newsroom/segpay-expands-virtual-segcard-offerings/), retrieved 2026-08-15 |

## Card-network constraints

Acquirer eligibility is not the whole gate. Both major networks impose requirements on adult-content merchants that reach Velora directly if mature content is ever enabled, and that reach the acquirer's willingness to board Velora even before that.

- **Visa Integrity Risk Program.** Adult content is treated as a legal but high-integrity-risk category. Merchants in it go through enhanced registration by their acquirer, are subject to closer performance monitoring, and their acquirer must certify quarterly to Visa that the merchant meets programme requirements and complies with the law. Source: [Visa network integrity](https://corporate.visa.com/en/about-visa/visa-network-integrity.html) and the [Visa Core Rules, 18 April 2026](https://usa.visa.com/content/dam/VCOM/download/about-visa/visa-rules-public.pdf), retrieved 2026-08-15.
- **Mastercard Specialty Merchant Registration.** Non-face-to-face adult content and services merchants must be registered. The requirements Mastercard has published include documented content controls, clear and documented consent from every depicted person, a complaint-resolution process that addresses illegal or non-consensual content within seven business days, and an appeals process allowing a depicted person to request removal. Source: [Mastercard Security Rules and Procedures, Merchant Edition, 3 February 2026](https://www.mastercard.com/content/dam/mccom/shared/business/support/rules-pdfs/SPME-Manual.pdf) and the [Mastercard adult content statement](https://www.mastercard.com/global/en/news-and-trends/press/2022/august/mastercard-statement-reinforcing-adult-content-standards.html), retrieved 2026-08-15.

The Mastercard consent, takedown, and appeals requirements are product requirements, not payment requirements. They would have to exist in MODERATION and TRUST & SAFETY before an acquirer could register Velora, which means enabling mature content is gated on moderation capability that does not exist yet, independently of whether a processor says yes.

## What this means for implementation

Four conclusions follow, and all four are enforced in code rather than merely written here.

**No provider is selected.** Every provider assessed above is either prohibited, restricted pending written approval Velora does not hold, or unassessed for want of a retrievable primary source. The Payments and Creator payouts rows in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) stay open.

**Silence is not approval.** Where a provider's list does not enumerate a category, that is recorded as "not separately enumerated" above and treated as unknown. It is never read as permission.

**Eligibility is evaluated twice, and the second answer governs the architecture.** Building against a provider that is eligible only while mature content stays disabled would make a later product decision into a payments migration. The money architecture is therefore provider-neutral by construction, and the adapter boundary is where a provider swap lands.

**Production activation is configuration that fails closed.** Every monetization capability is gated by a configuration value whose only deployable setting refuses, on the same pattern as `IDENTITY_VERIFICATION_PROVIDER`, `USERS_PROFILE_MEDIA_STORAGE`, and `CLUBS_BILLING_ENTITLEMENT`. Staging and production reject any other value, so no route, header, or environment string can reach a working payment path in a deployed environment before a provider is approved here.

## Review triggers

Re-verify every entry above, from primary sources, when any of the following happens:

- before any provider onboarding conversation begins;
- before any commercial pilot in any country;
- when mature or explicit creator content moves toward enablement;
- when a launch country is added or changed;
- when a provider announces a policy change affecting adult, dating, marketplace, or creator-platform categories;
- and in any case when the retrieval date above is more than 90 days old.

## Cross-references

[Payments, tax, and payout gates](04-payments-tax-payout-gates.md), [market entry gates](01-market-entry-gates.md), [creator and content gates](03-creator-content-gates.md), [monetisation](../product/05-monetisation.md), [BILLING](../domains/billing.md), [PAYOUTS](../domains/payouts.md), [payment lifecycle](../flows/payment-lifecycle.md), [money flow](../architecture/10-money-flow.md), [payment and webhook security](../security/05-payments-webhooks.md), [provider adapters](../architecture/06-provider-adapters.md), [ADR-0011](../decisions/ADR-0011-payments-payouts.md), [ADR-0021](../decisions/ADR-0021-monetization-money-architecture.md), [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md).
