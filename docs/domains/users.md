# USERS domain

## Purpose and scope

USERS owns consumer account state, profile basics, self-managed preferences, availability, and account lifecycle coordination. It does not own credentials, discovery ranking, relationship state, reports/enforcement decisions, creator business identity, or billing.

## Flows and state

After AUTH identity exists, create account in `pending_profile`; completion of required profile/policy gates becomes `active` or `restricted` based on validated inputs and other-domain eligibility signals. User edits own permitted fields; field-level visibility is policy controlled. Deletion request transitions `active/restricted -> deletion_pending -> deactivated -> erased/anonymized` subject to defined holds. Account state change emits lifecycle fact for projections.

## Alternate/failure/authorization

Duplicate account-creation command resolves same identity idempotently. Conflicting profile changes use record version or last-write policy explicitly chosen per field. User may alter only own allowed profile; support/admin requests validated domain action, reason, and audit. Enforcement/age/region predicates may restrict product action without exposing private cause to other users.

## Data/security/events/phase

Own profile data classification/visibility and deletion coordination; share minimized profile view, never raw internal notes. Validate uploads via media policy; prevent unsafe free text exposure where applicable. Events: account/profile/availability/deletion lifecycle. V1. `DECISION REQUIRED`: required profile fields, visibility defaults, display-name policy, retention durations.

## Implemented consumer account

`0002_users` adds the one USERS-owned table implemented so far, `users_accounts`, and every constraint that protects a USERS invariant. It creates no table another domain owns and adds no column to an AUTH table.

The consumer account carries its own identifier, the AUTH account it belongs to, its lifecycle status, a coarse status reason, and the region and locale later consumer domains need. The consumer identifier is distinct from the AUTH account identifier on purpose, so a client that learns one of them learns nothing addressable in the other domain.

There is deliberately no database foreign key from `users_accounts` to `auth_accounts`. [Data ownership](../architecture/05-data-ownership.md) requires cross-domain references to be stable identifiers rather than shared schema, and an `on delete cascade` reaching in from AUTH would let identity removal silently erase consumer state that [account deletion](../flows/account-deletion.md) makes USERS responsible for coordinating. The invariant that does belong here — one consumer account per AUTH account — is a unique index USERS owns.

Database constraints refuse an unknown status, a `restricted` account with no recorded reason, any deletion state with no recorded request, a region that is not an uppercase ISO 3166-1 alpha-2 code, a locale outside the accepted BCP 47 shape, and a status change dated before the account existed. A restriction with no cause cannot be reviewed or lifted, so the database does not accept one.

Account creation is idempotent because [onboarding](../flows/onboarding.md) requires it. The insert races on the unique index rather than on a read followed by a write, so simultaneous first calls converge on one account and every caller sees it; this is asserted with real concurrent provisioning against PostgreSQL, not simulated.

## Implemented adult onboarding

`0003_users_onboarding` adds two append-only evidence tables. Neither is ever updated and neither is deleted while the account exists, because both answer questions about the past.

`users_policy_acknowledgements` records that an account accepted a named policy document at a named version, from a named consumer surface. A unique index over account, key, and version makes re-submission a no-op rather than a second contradictory record, and a new version produces a new row, so republishing terms never rewrites the evidence that someone accepted the earlier text.

`users_adult_assurances` records every adult-eligibility assessment. The identifier is a sequence rather than a timestamp so two assessments recorded in the same instant still have one unambiguous winner: the current assurance is simply the most recent row. A later failure, expiry, or revocation is therefore its own visible event rather than the absence of an earlier pass. No raw evidence has a column at all; the only provider-linked field is an opaque digest an adapter can use to find its own record.

The assurance classes are deliberately not interchangeable, as [adult verification](../compliance/02-adult-age-verification.md) requires. `self_declared` and `verified_adult` are separate values, a self-declaration is refused by CHECK constraint if it ever carries provider evidence, and identity proof and creator verification get their own values when their owning domains implement them rather than by widening either of these.

No birth date is collected. The minimum age per country is unresolved and `LEGAL REVIEW REQUIRED`, so collecting a date would be gathering sensitive data for a rule that does not exist. The declaration is a statement of adult status plus the region whose rules apply.

A negative declaration is recorded as a refusal and restricts the account; it is never discarded. An adults-only platform that silently dropped "no" would be relying on the client to enforce its central product rule. A refused account may declare again, which returns it to the ordinary pending path and leaves the refusal on the record. Only a restriction this domain applied for failed eligibility is lifted that way — a safety enforcement restriction belongs to Trust & Safety and is left exactly where it is.

## Onboarding progression

The onboarding step is derived from stored evidence on every read. Nothing stores a step. A stored step would be a second source of truth about facts that already exist — an acknowledgement row, an assurance row, an account status — and it would be the one that drifts; deriving it makes the contradictory states unrepresentable rather than merely unreachable.

The ladder is `adult_declaration -> policy_acknowledgement -> profile -> completed`, and an earlier step being unmet makes a later one unreachable whatever order a client calls the endpoints in. Only the versions currently required are accepted: acknowledging a version the platform no longer asks for is not evidence of agreeing to the one it does.

Activation to `active` requires the minimum profile, which the profile model does not yet define. A fully declared and acknowledged account therefore stops honestly at the `profile` step and stays `pending_profile`, rather than reporting a completion that has not happened.

## Adult assurance provider seam

Verification sits behind a provider-neutral port carrying only a normalized outcome. Self-declaration deliberately does not pass through it: nothing external is consulted, so routing it through a verifier would misrepresent what happened.

`USERS_ADULT_ASSURANCE_VERIFIER` selects the adapter and defaults to `unavailable`, which refuses every request. Configuration rejects any other value in staging and production, so no deployed environment can grant verified adult status while age verification is unresolved in [open decisions](../decisions/DECISIONS_REQUIRED.md). A `local-test` adapter exists so the verified path is genuinely exercisable during development and in tests; it is named so no test using it reads as evidence about a real provider.

The policy versions the required documents carry are marked unpublished, because Velora has no approved terms, privacy notice, minimum age, or launch-country list and none is invented here. That marker is a real version whose content is unapproved, not a placeholder that behaves like one: publishing approved copy is a version bump, after which every account is asked again and the earlier evidence is preserved.

## Consumer authorization

The acting consumer is derived entirely from the presented credential. AUTH resolves the caller, and USERS looks up the consumer account by that caller's AUTH account identifier. No request body, query parameter, or header contributes an account identifier, so there is no value a client could substitute to act as somebody else.

Only the Consumer Web and Consumer Mobile audiences carry consumer product authority. Creator Studio and Platform Admin sessions are refused before any consumer lookup happens on their behalf, which keeps a privileged session from becoming a consumer actor by calling a consumer endpoint.

A caller with no consumer account receives the same answer as a caller addressing a route that does not exist. Both are `404`, so probing tells a caller nothing.

## Implemented profile, preferences, and media

`0004_users_profile` adds the four tables the approved V1 consumer policy needs: the profile itself, the languages it speaks, its images, and its self-managed preferences.

The minimum discoverable profile is a display name, a coarse region, at least one language, and at least one image in the `ready` state. Nothing else gates being seen. Date of birth, precise location, gender, and orientation are deliberately absent: a person is never asked to hand over sensitive data as the price of appearing in discovery, and none of it is needed to introduce two adults to each other.

A consumer profile is not a public page. It is served to its owner and, through the projections other domains build, only to authenticated consumers whose relationship permits it. Public creator storefront behaviour belongs to CREATORS and must not reach this model.

Languages are rows rather than an array column, because discovery ranks on language overlap and that is a join. The secondary index is ordered language-first for that query.

Profile edits use optimistic concurrency. The version is absent exactly when the caller believes no profile exists, and being wrong in either direction is a conflict rather than a silent create-or-overwrite, so a second device never quietly discards the first one's edit.

Account status follows the profile in both directions. Completing the minimum profile activates a `pending_profile` account; losing it — the last image removed, say — returns the account to `pending_profile` and turns discoverability off. The downward transition is the one that matters: without it an account would stay visible on a profile it no longer has.

### Profile media

Images move `pending_upload -> ready | rejected`, and an owner may remove one at any point. The transition to `ready` is the platform's decision, taken from the stored bytes: the content type is identified from the object's own header, the size is measured, and a client's claim about either is never stored. `docs/security/04-media-upload-delivery.md` requires exactly this.

A profile holds a bounded number of images in dense zero-based slots. The partial unique index over account and position — live objects only — is what makes concurrent uploads safe: two simultaneous creations cannot take the same slot, and removing an image frees its slot without renumbering anything or losing the removed record.

There is no URL column and no public address. Delivery is authorized and signed per request, so a link cannot outlive the authorization decision that produced it.

`USERS_PROFILE_MEDIA_STORAGE` selects the adapter and defaults to `unavailable`, which refuses every upload and every inspection. Staging and production reject any other value while no storage provider is approved in [open decisions](../decisions/DECISIONS_REQUIRED.md), so a deployed environment cannot accept an image and therefore cannot produce a discoverable account. That is the intended outcome: an empty discovery surface is better than one running on unverified media. The `local-test` adapter keeps objects in process memory for development and tests; it verifies magic bytes and size and performs no malware or moderation scanning, so its acceptance is never evidence about real user content.

### Preferences

Discoverability is off until the person turns it on, expressed as `not null default false` rather than as application logic, so an account cannot become visible because a code path forgot to set it. Turning it on is refused while the minimum profile is incomplete: the eligibility pipeline would exclude the account anyway, and a stored `true` that can never take effect is a preference that lies to the person who set it.

It is deliberately separate from availability. This is a durable choice about whether the account participates in discovery at all, not a statement about right now.

## Implemented availability

`0005_users_availability` adds one row per account holding what the person last chose and when it stops applying.

Availability is exactly what [consumer account and profile](../flows/consumer-account-profile.md) says it is: a user-managed, bounded preference. It is not presence, which belongs to REALTIME and does not exist; it is not consent to be contacted; it is not a promise of appearing in discovery; and it never overrides a block or an enforcement decision.

Being available always carries an end, enforced by CHECK constraint in both directions: availability with no end would be a presence claim the server cannot support, and an end with no availability describes nothing. A single window is bounded by one published policy constant, and a window that has already closed or runs longer than that is refused rather than quietly clamped, so a person knows how long they actually said they were around for.

Expiry is applied on read, never written back. A window closing is the passage of time rather than an event, and a job that rewrote rows at expiry would be a second writer racing the person who owns them. The stored choice and the value the platform acts on are returned as separate fields, so neither has to be inferred.

Availability does not use the expected-version rule profile edits use. A profile edit is a document two devices could each have meaningfully authored, so a conflict must be reported; availability is a switch, and the honest answer to two devices flipping it at once is that the last one wins and both then read the same state. PostgreSQL serializes that, and a revision counter records how many times it moved.

PostgreSQL is the only truth. A Redis projection would be a reasonable read accelerator later, but adding one now would buy an invalidation problem and a second place for availability to be wrong in exchange for a saving nothing has measured.

## Cross-references

[consumer product](../product/02-consumer-product.md), [consumer account/profile](../flows/consumer-account-profile.md), [onboarding](../flows/onboarding.md), [account deletion](../flows/account-deletion.md), [data ownership](../architecture/05-data-ownership.md).
