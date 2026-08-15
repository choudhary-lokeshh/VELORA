# Surface and distribution eligibility

## Purpose and status

This document records what app-store operators, online-safety regulators, and record-keeping statutes currently say, in their own published sources, about a platform shaped like Velora carrying mature or sexually explicit content. It exists so that surface policy is an evidence-backed decision rather than an assumption, and so that "Velora is adults-only" never quietly becomes "Velora may publish mature content everywhere it runs".

It is architecture and product guidance, not legal advice, and it is not an approval. Nothing here enables mature content anywhere. Where a source requires legal judgement to apply, the judgement is recorded as unresolved in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) rather than made here.

Its authority is narrow and does not compete with its neighbours. [Creator and content gates](03-creator-content-gates.md) owns the gate list a creator and a content item must pass. [Payment provider eligibility](06-payment-provider-eligibility.md) owns what payment and payout providers say. This document owns one question those two do not answer: **on which surface, in which distribution channel, and against which evidence obligations may a given class of content legitimately be delivered at all.**

Findings are dated. A policy page is a moving document; an entry whose retrieval date has aged past its review trigger is stale evidence and must be re-verified before it supports any decision.

## The surfaces, and why they are not one surface

Velora reaches people through five surfaces, and they do not share a content policy:

| Surface | Distribution channel | Who governs what may be delivered |
|---|---|---|
| Consumer Web | Browser, Velora-operated | Velora policy, the law of the consumer's country, and the acquirer's card-network programme |
| Consumer Mobile — iOS | Apple App Store | Everything Consumer Web is subject to, **plus** the App Review Guidelines |
| Consumer Mobile — Android | Google Play | Everything Consumer Web is subject to, **plus** Google Play Developer Program Policy |
| Creator Studio | Browser, Velora-operated | Velora policy plus the creator's own country obligations |
| Platform Admin | Browser, Velora-operated, privileged | Velora policy; evidence access is role-scoped rather than content-classified |

The consequence is the single most important architectural fact in this document: **a content item can be entirely lawful, fully consented, fully moderated, and still be forbidden on two of the five surfaces.** Surface eligibility is therefore a separate predicate from content eligibility, evaluated separately, and never inferred from it.

The reverse inference is also forbidden. A surface being permitted to *show* something never implies a channel is permitted to *transact* it: app-store billing rules are a distinct axis recorded in [payments, tax, and payout gates](04-payments-tax-payout-gates.md), and no work in this repository may build a mechanism whose purpose is to route around either.

## Distribution channel findings

Retrieved 2026-08-16 from the primary sources named below.

### Apple — App Store Review Guidelines

| Finding | Source text | Effect on Velora |
|---|---|---|
| Sexually explicit content is not permitted in an App Store app | Guideline 1.1.4: "Overtly sexual or pornographic material, defined as 'explicit descriptions or displays of sexual organs or activities intended to stimulate erotic rather than aesthetic or emotional feelings.' This includes 'hookup' apps and other apps that may include pornography or be used to facilitate prostitution, or human trafficking and exploitation." | `MOBILE_IOS` may never carry mature content, its previews, or its catalogue metadata, whatever the platform decides elsewhere. The guideline also names the dating-adjacent category directly, which reaches the consumer product and not only the creator product |
| User-generated content carries four mandatory controls | Guideline 1.2: apps with user-generated content "must include: A method for filtering objectionable material from being posted to the app; A mechanism to report offensive content and timely responses to concerns; The ability to block abusive users from the service; Published contact information so users can easily reach you" | These are requirements for the **existing** product, not only for a mature future. Report, block, and timely response are Trust & Safety obligations today |
| A service used primarily for pornographic content may be removed without notice | Guideline 1.2: apps or services "that end up being used primarily for pornographic content … do not belong on the App Store and may be removed without notice" | Enabling mature content on Web while shipping an iOS app is not automatically safe. The guideline is written about what the *service* becomes, not only about what the binary contains. `LEGAL REVIEW REQUIRED` |
| Undisclosed or remotely-enabled functionality is prohibited | Guideline 2.3.1(a): "Don't include any hidden, dormant, or undocumented features in your app; your app's functionality should be clear to end users and App Review." | A server flag that turns mature content on inside a shipped iOS build would be exactly this. Surface policy must be enforced server-side *and* must not be a switch that changes what a reviewed binary does |
| Age rating must be answered honestly | Guideline 2.3.6: "Answer the age rating questions in App Store Connect honestly so that your app aligns properly with parental controls." | An 18+ rating is not a licence for 1.1.4 content; the two rules are independent |

Source: [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), retrieved 2026-08-16.

### Google — Play Developer Program Policy

| Finding | Source text | Effect on Velora |
|---|---|---|
| Sexual content is prohibited | Sexual Content and Profanity policy: "We don't allow apps that contain or promote sexual content or profanity, including pornography, or any content or services intended to be sexually gratifying." | `MOBILE_ANDROID` may never carry mature content, its previews, or its catalogue metadata |
| Compensated sexual acts are prohibited | The same policy forbids "apps or app content that appear to promote or solicit a sexual act in exchange for compensation" | Reaches the creator commercial product directly if mature content were ever paid-for on Android |
| Non-consensual sexual content is prohibited outright | The same policy bans apps that "contain or promote content associated with sexually predatory behavior, or distribute non-consensual sexual content" | Consent evidence is not merely a card-network requirement; it is a distribution requirement |
| The educational/documentary/scientific/artistic exception is narrow | Nudity "may be allowed if the primary purpose is educational, documentary, scientific or artistic, and is not gratuitous" | Not a path for Velora's product. No implementation may treat it as one |

Source: [Google Play Sexual Content and Profanity policy](https://support.google.com/googleplay/android-developer/answer/9878810), retrieved 2026-08-16. The page publishes no effective date, so the retrieval date is the only date this finding carries.

### What follows for the mobile surfaces

Both stores prohibit the content class outright. The finding is therefore not "restricted pending approval" — it is a prohibition with no published approval path, which is a materially different answer from the payment-provider findings in [provider eligibility](06-payment-provider-eligibility.md), where several providers publish a written-approval route.

The architecture consequence is fixed: **under current published policy, `MOBILE_IOS` and `MOBILE_ANDROID` are structurally ineligible surfaces for mature content**, and that ineligibility is a property of the surface rather than a per-country or per-creator configuration. A future change would be a policy change by Apple or Google, re-verified from primary sources, not a Velora decision.

## Age assurance findings

### Ofcom — UK Online Safety Act

Ofcom's published guidance on age checks distinguishes methods capable of being **highly effective** from methods that are not, and names self-declaration in the second group.

| Finding | Effect on Velora |
|---|---|
| Services publishing or allowing pornographic content must use highly effective age assurance | Velora's existing `self_declared` assurance class cannot gate mature content for a UK audience |
| Methods Ofcom identifies as capable of being highly effective include open banking, photo-ID matching, facial age estimation, mobile-network-operator checks, credit-card checks, digital identity services, and email-based age estimation | The future verifier port must be able to consume a normalized outcome from a provider in this family without Velora storing the underlying evidence |
| Self-declaration of age, and online payments that do not require age verification, are stated as **not** highly effective | Two bypasses are closed by name. Neither an age checkbox nor the existence of a completed purchase may ever be treated as age assurance |
| The criteria are that a method be technically accurate, robust, reliable and fair | A provider claim alone is not evidence of the standard being met; assessment is a `LEGAL REVIEW REQUIRED` gate |

Source: [Ofcom — age checks to protect children online](https://www.ofcom.org.uk/online-safety/protecting-children/age-checks-to-protect-children-online/), retrieved 2026-08-16. The compliance dates the source states for the two service classes are recorded there; whether Velora falls into one of them, and in which other jurisdictions an equivalent duty applies, is `LEGAL REVIEW REQUIRED` and is not decided here.

This finding is the reason [adult age and verification gates](02-adult-age-verification.md) keeps `verified_adult` a distinct assurance class from `self_declared` rather than a synonym, and why no code path widens one into the other.

Nothing in this section may be read as a conclusion that any particular country's law applies to Velora. It is recorded because it changes architecture: an assurance model with only a self-declaration tier cannot satisfy the strongest published standard Velora has found, so the model must have a stronger tier before mature content is reachable, and that tier must fail closed while no approved provider fills it.

## Depicted-person record-keeping findings

### 18 U.S.C. § 2257 — United States

The statute places record-keeping duties on the producer of visual depictions of **actual** sexually explicit conduct: ascertaining, by examination of an identification document, each performer's name and date of birth, and recording any other name the performer has used.

| Finding | Effect on Velora |
|---|---|
| The duty attaches to the producer of the depiction | Whether Velora is a producer, a secondary producer, or neither for creator-uploaded content is a legal question. `LEGAL REVIEW REQUIRED`; it is not answered in this repository |
| Identity and date of birth must be ascertained by examining an identification document | An architecture in which a creator merely *asserts* that a depicted person is an adult cannot satisfy this. Self-assertion is recorded as an assertion, never as verified evidence |
| The statute as retrieved does not itself fix a retention duration | No retention or destruction period may be invented in code. This joins the existing safety-evidence retention decision as `LEGAL REVIEW REQUIRED` |
| The scope is actual, not simulated, conduct | The classification taxonomy must be able to distinguish classes with different evidence obligations rather than carrying one `mature` boolean |

Source: [18 U.S.C. § 2257](https://www.law.cornell.edu/uscode/text/18/2257), retrieved 2026-08-16.

The architectural consequence is the one the consent model is built around: **evidence about a depicted person must be referenceable, scoped, and durable, and Velora must not hold the raw identity document to achieve that.** A reference to an approved verification provider's receipt satisfies both halves; a column holding a scan satisfies neither, because it creates the largest breach liability on the platform in exchange for evidence Velora is not the right party to hold.

## Notice, reasons, and appeal findings

### Regulation (EU) 2022/2065 — Digital Services Act

The obligations that shape the case, decision, and appeal model:

| Article | Obligation as published | Effect on Velora |
|---|---|---|
| Article 16 — notice and action | Hosting providers must operate accessible, easy-to-use mechanisms allowing anybody to notify allegedly illegal content, and notices must be capable of being sufficiently precise and adequately substantiated | Report intake must accept a substantiated notice, not only a category selection, and must be reachable |
| Article 17 — statement of reasons | A provider restricting visibility, removing content, or restricting an account must give the affected recipient the reasons for the decision and the redress available | An enforcement that the subject cannot be told the category and scope of is not deliverable. This is why enforcement carries an explicit scope and a disclosable reason code separate from internal rationale |
| Article 20 — internal complaint-handling | Online platforms must provide a complaint system usable **for at least six months** following the decision, handled in a timely, non-discriminatory, non-arbitrary and fair manner, and not decided solely by automated means | Appeal eligibility, an appeal window, and a human decision are structural requirements, not product niceties. The six-month figure is the source's, not an invention |

Source: [Regulation (EU) 2022/2065](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065), retrieved 2026-08-16. Whether and where these obligations bind Velora is `LEGAL REVIEW REQUIRED`; they are recorded because they set the *shape* of the machinery — notice, reasons, human appeal, bounded window — and building that shape late is far more expensive than building it now.

## Card-network constraints that reach this document

[Provider eligibility](06-payment-provider-eligibility.md) records the payment findings in full and remains their authority. Two of them are product requirements rather than payment requirements, and are restated here only because they land on Trust & Safety rather than on BILLING:

- **Documented consent from every depicted person.** Mastercard's published standards require confirmation of age and consent from anyone appearing in content on an adult-content site.
- **A complaint process with a bounded resolution time, and an appeals process.** The requirements recorded in [provider eligibility](06-payment-provider-eligibility.md) include resolution of illegal or non-consensual content complaints within seven business days and an appeals route allowing a depicted person to request removal.

The seven-business-day figure is a **card-network programme requirement recorded from a primary source, not a legal deadline and not a Velora policy value.** No deadline may be hard-coded from it. Deadlines belong to a versioned, published policy record, and production carries none until one is approved.

## What follows for implementation

Five conclusions, each of which must be enforced in code rather than merely written here.

**Surface is a first-class policy input.** A content decision that does not name a surface is incomplete. `WEB`, `MOBILE_IOS`, `MOBILE_ANDROID`, `CREATOR_STUDIO`, and `ADMIN` are a closed vocabulary, and mature eligibility is evaluated per surface.

**Mobile is ineligible for mature content, structurally.** Not by configuration that could be flipped, but as a property of the surface under both stores' published prohibitions. Any future change requires re-verified primary sources and a recorded decision.

**Self-declaration is never age assurance for mature content.** The strongest published standard Velora has found names it as insufficient. A stronger assurance class must exist, must be a distinct value, and must fail closed while no approved provider fills it.

**Depicted-person evidence is a reference, never a document.** Velora records that evidence exists, what it covers, who attested it, when it expires, and where it can be re-obtained. It does not record the identity document, and a creator's assertion is stored as an assertion.

**Mature-content enablement is configuration that fails closed.** On the same pattern as `USERS_ADULT_ASSURANCE_VERIFIER`, `BILLING_COMMERCE_POLICY`, and `USERS_PROFILE_MEDIA_STORAGE`: the only deployable value refuses, staging and production reject any other value, and no route, header, request field, client flag, or environment string reaches an enabled mature path in a deployed environment.

## Open decisions

Recorded in [DECISIONS_REQUIRED](../decisions/DECISIONS_REQUIRED.md) rather than answered here:

- whether Velora is a producer or secondary producer for creator-uploaded depictions, and what record-keeping duty follows;
- which jurisdictions' age-assurance duties apply to Velora, and the assurance tier each requires;
- which online-safety, notice-and-action, and appeal duties apply, in which countries, and on what timetable;
- retention and legal-hold treatment for reports, evidence, consent records, and enforcement history;
- approved consent copy, scope wording, and revocation terms;
- whether an iOS or Android application may ship at all while mature content is enabled on Web, given Apple Guideline 1.2's service-level test;
- the approved takedown, triage, and action deadlines, and the policy version that publishes them.

## Review triggers

Re-verify every finding above, from primary sources, when any of the following happens:

- before any mobile application is submitted to either store;
- before mature or explicit creator content moves toward enablement on any surface;
- before any age-assurance provider conversation begins;
- when a launch country is added or changed;
- when Apple, Google, a card network, or a named regulator announces a policy change affecting adult content, age assurance, user-generated content, or notice-and-action duties;
- and in any case when the retrieval date above is more than 90 days old.

## Cross-references

See [market entry gates](01-market-entry-gates.md), [adult age and verification gates](02-adult-age-verification.md), [creator and content gates](03-creator-content-gates.md), [payments, tax, and payout gates](04-payments-tax-payout-gates.md), [data residency and retention](05-data-residency-retention.md), [payment provider eligibility](06-payment-provider-eligibility.md), [TRUST & SAFETY](../domains/trust-safety.md), [MODERATION](../domains/moderation.md), and [ADR-0022](../decisions/ADR-0022-trust-safety-policy-enforcement-authority.md).
