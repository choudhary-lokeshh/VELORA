# Product gap matrix

## What this is

A product-facing audit of what a person can actually reach, taken against the
running code rather than against the plan. Every row names the evidence that
produced its classification, so a row can be re-checked rather than believed.

It is deliberately not an architecture document. The domains, contracts, and
freeze reports already say what exists; this says what a consumer, a creator,
or an operator can *do* with it, which is a different question and the one that
was not being asked.

Classification vocabulary:

| Class | Meaning |
|---|---|
| A | Fully surfaced — the capability exists and a person can reach all of it |
| B | Backend exists, no client surface reaches it |
| C | A surface exists but is materially shallower than the capability behind it |
| D | Partially connected — reachable through one path, absent from the paths a person would actually use |
| E | Neither backend nor surface exists |
| F | Blocked on an external provider or an unresolved legal decision, and honestly stated as such on the surface |

A row is F only when the block is genuinely external. "Nobody built the route
yet" is B, not F, however long it has been true.

## The one finding that dominates the rest

`MediaDeliveryService` is complete, composed at `apps/api/src/media/composition.ts`,
and called by no HTTP route anywhere in the API. It already decides audience,
re-derives entitlement inside the caller's transaction, issues either a
permanent public address or a signed credential bounded by
`mediaDeliveryCredentialSeconds`, and reports its own revocation exposure.

Two things keep it unreachable:

1. **No route.** Nothing in `apps/api/src/application.ts` maps a request to it.
2. **No peer rule.** `ConsumerProfileMediaAssociation.describe` in
   `apps/api/src/users/profile-media-association.ts` answers
   `viewerEntitled: viewerId === slot.userId`, with a comment recording that
   whether a *peer* may see somebody's profile image is DISCOVERY's question
   and that answering it inside USERS would mean inventing the rule.

The consequence reaches every consumer surface. `discoveryCandidateSchema` and
`conversationCounterpartSchema` both already publish `media: [{ id, position }]`,
so the projections are shaped for images and every person renders as an initial
on a tinted panel. The same holds for creators, from the other end: `creators_profiles`
holds avatar and cover asset references and the creator contract publishes no
route that would upload, attach, or address one.

This is the difference between a product that looks restrained and a product
that has no photographs in it. It is the first thing to fix and most of the
visual work depends on it.

## Consumer discovery and exploration

| Capability | Class | Evidence |
|---|---|---|
| Availability-scoped candidate feed | A | `/v1/discovery/candidates`, `apps/web/src/product/discovery.tsx` |
| Pass, signal interest, mutual introduction | A | `/v1/discovery/passes`, `/v1/discovery/introductions` |
| Candidate photographs | B | `discoveryCandidateSchema.media` published; no delivery route |
| Any filter or search at all | E | `apiQueryParameters` carries `cursor` and `pageSize` and nothing else for this route |
| Exploration hierarchy — sections a person can move between | E | One list, one ordering, no alternative view |
| Finding a creator without already knowing their handle | E | `/v1/creators` takes `handle` and answers one profile; no listing route exists |
| Browsing public creator content across creators | D | `/v1/creators/catalog` is real but handle-scoped, so it is reachable only from a page you already found |
| Browsing clubs | D | `/v1/creators/clubs` is handle-scoped in exactly the same way |
| Saving a person, a creator, or an item | E | No contract, no table, no surface |
| Interests or tags to explore by | E | `profileResponseSchema` carries display name, region, languages, bio, media — no taxonomy of any kind |

## Consumer profiles

| Capability | Class | Evidence |
|---|---|---|
| Own profile: edit, languages, region, availability, media upload | A | `apps/web/src/product/profile.tsx`, `media.tsx`, `availability.tsx` |
| Opening another consumer's profile as a page | E | No route under `apps/web/app`, and no contract wider than the card projection |
| Photographs on any consumer profile | B | Same delivery gap |
| Public creator page | C | `apps/web/src/product/creator-page.tsx` renders a real page from `publicCreatorResponseSchema`, which publishes a display name, a bio, links and a publication instant — no imagery, no location, no languages, no taxonomy |
| Creator hero or catalog imagery | B | `clubs_content_media` and the creator avatar/cover references exist; no creator media route is published |
| Report and block from a person surface | A | `apps/web/src/product/safety-actions.tsx` |
| Call entry from a mutual introduction | F | `apps/web/src/product/calls.tsx` exists and refuses; `REALTIME_RTC_PROVIDER` is rejected outside local and test |

## Social loop and messaging

| Capability | Class | Evidence |
|---|---|---|
| Discover → interest → mutual → conversation | A | The loop closes end to end |
| Conversation list with unread state | C | `conversationSchema` carries `lastMessageSequence` and `lastReadSequence`, so unread is derivable — but no last-message preview is published, so the list shows names and times and nothing about the conversation |
| Thread history, send, retry, long bodies | A | `apps/web/src/product/conversations.tsx` |
| Counterpart photograph in a conversation | B | `conversationCounterpartSchema.media` published; no delivery route |
| Typing or presence | E | Deliberately absent; presence is Phase 2 and unbuilt |
| Attachments | E | Deliberately absent from `packages/validation/src/messaging.ts` |
| Gifting from a conversation | E | Virtual gifts exist only for the published creator-profile context under ADR-0032; MESSAGING publishes no eligible gift-context contract |

## Activity and retention

| Capability | Class | Evidence |
|---|---|---|
| Notice list, read state, deep links | A | `apps/web/src/product/notifications.tsx` |
| Event vocabulary | C | `notificationKindSchema` has four kinds — message, mutual introduction, incoming call, missed call. Nothing about clubs, invitations, creator content, or safety reaches the activity centre |
| Grouping or prioritisation | E | Flat reverse-chronological list |
| Saved items as a retention surface | E | Nothing to save |
| Email or push arriving off-surface | F | `NOTIFICATIONS_DELIVERY_CHANNEL` refuses in every deployed environment; email additionally has no address to send to |

## Creator Studio

| Capability | Class | Evidence |
|---|---|---|
| Activation, profile, publication | A | `apps/creator-studio/src/product/activation.tsx`, `profile.tsx` |
| Content draft, edit, publish, archive | A | `catalog.tsx`, `content-editor.tsx` |
| Clubs, invitations, membership, revocation | A | `club.tsx`, `clubs.tsx` |
| Public preview | C | `preview.tsx` renders what the public projection publishes, which is thin for the same reason the public page is |
| Any creator imagery | B | Same creator media gap |
| Earnings and payouts | F | Real ledger-derived readouts that correctly report an unavailable capability; `BILLING_PAYMENT_PROVIDER` and `BILLING_COMMERCE_POLICY` refuse in every deployed environment |
| Received gifts | F | `apps/creator-studio/src/product/gifts.tsx` renders durable gift/payment/journal truth in local/test; production commerce remains provider- and policy-blocked |
| Anything telling a creator something happened while they were away | E | Recorded as an open decision: the notification contract is consumer-audience only |

## Platform Admin

| Capability | Class | Evidence |
|---|---|---|
| Cases, appeals, decisions, creators, money, platform readouts | A | `apps/admin/src/product/*` |
| Finding a record from an identifier without a database shell | A | `GET /v1/admin/search`; exact resolution only, never a prefix, so it cannot be used to enumerate |
| One account's operational record and its cross-domain timeline | A | `GET /v1/admin/accounts/detail`, `GET /v1/admin/accounts/timeline`; counts and states, no name, photograph, message, narrative, ticket text, or push token |
| What the platform has been doing | A | `GET /v1/admin/activity`, composed from the rows each domain already writes; there is no event table |
| Pausing a feature without a deploy | A | `GET`/`POST /v1/admin/controls`; three controls the server obeys on the paths they govern, written as compare-and-set with a published propagation bound |
| Signing an account out everywhere | A | `POST /v1/admin/accounts/session-revocation` through AUTH's own service; the security event commits with the revocation |
| Capability-scoped operator access | A | Twenty-two capabilities, seven roles, checked on every operator route; `apps/api/src/operations/*` |
| An audit of what operators did | A | `GET /v1/admin/operator-actions`; append-only, records refusals as well as changes |
| Stuck work, recorded failures, queue and dependency readiness | A | `GET /v1/admin/operations/state`; unconfigured, unavailable, and unknown are three different answers |
| Money invariants checked against themselves | A | `GET /v1/admin/commerce/reconciliation`; each finding publishes its own definition |
| Ending one person's live encounter from the console | E | Deliberate. Ending somebody's call is a safety decision and goes through TRUST & SAFETY, where it acquires a record, a reason, and an appeal path; an operator has a global pause that touches nobody in particular |
| Operator wallet adjustment | E | No adjustment reason vocabulary, no approval rule, and no double-entry correction semantics are decided; a balance edit without those is an unaudited change to somebody's money |
| Administrative broadcasts to consumers | E | No approved notification provider, and no decision about what a platform may send unprompted or which preference would govern it |
| CSV export of operator lists | E | Every operator list is paginated and readable in place; an export is a copy of personal data leaving the platform and needs a retention and handling answer first |
| Reaching the console in any environment | F | `UnavailablePrivilegedAuthenticatorVerifier` refuses every assertion, and `/v1/auth/local/web-sessions` admits no `platform_admin` audience. Both conditions are stated on screen. Since ADR-0048 a third applies in a deployed environment: an operator with no capability grant may do nothing, and who holds the first grant is an open decision |

## Monetisation

| Capability | Class | Evidence |
|---|---|---|
| Journals, offers, prices, checkout orchestration, webhook inbox, refunds, disputes, reconciliation | A as architecture | `apps/api/src/billing/*`, `apps/api/src/money/*` |
| Creator sets a membership price and puts it on sale | A local/test; F production | `apps/creator-studio/src/product/selling.tsx` drafts an offer, publishes monthly and yearly prices, activates and retires; `BILLING_COMMERCE_POLICY` approves nothing in a deployed environment, so the controls are absent there rather than refusing |
| Consumer buys a membership | A local/test; F production | `/c/[handle]` → `/c/[handle]/club/[clubSlug]/join` → the provider's hosted page → `/checkout/return`; proved end to end in `e2e/membership-journey.spec.ts` and `apps/api/test/integration/billing-memberships.test.ts` |
| Reading what a membership admits somebody to | A | `/c/[handle]/club/[clubSlug]`, `GET /v1/clubs`; a caller the entitlement question refuses gets an empty feed rather than a filtered one |
| Stopping a membership | A | `POST /v1/billing/subscriptions/cancellation` schedules the end of renewal from Consumer Web and Consumer Mobile; the paid period is never taken back |
| Leaving an invitation-based club | A | `POST /v1/clubs/departures`; a paid membership is refused and routed to cancellation |
| Payment history a consumer can read | A | `GET /v1/billing/payments`; stated as a record of attempts rather than as receipts, because what a receipt must carry is unresolved |
| Operator dispute queue | A | `GET /v1/admin/billing/disputes`, `apps/admin/src/product/money.tsx`; a read with no evidence submission, because nothing has decided what evidence may be sent |
| Evidence submission on a dispute | F | No approved provider, and no decision about what may be submitted or by whom |
| Buying anything from Consumer Mobile | F | The API refuses `consumer_mobile` at the purchase route; an external purchase link is unresolved store policy and is deliberately absent |
| Membership tiers | E | No tier exists in the domain; a creator who wants two levels makes two clubs, which the access rules already enforce |
| Renewal actually being collected | F | Recurring collection is the provider's, and no provider is approved; `subscription.past_due` and period-end expiry are implemented, a successful renewal charge is not |
| Virtual gifting | A local/test; F production | Data-driven catalog, durable gift object, send/receipt/history, verified provider inbox, balanced ledger and reversals exist; production provider, terms, tax, channel, design, and payout gates remain closed |

## Demo population

| Capability | Class | Evidence |
|---|---|---|
| Seeded local world | A | `scripts/seed-local-world.mjs` creates 32 fictional adults, 12 creators, 41 public pieces, and 6 clubs entirely through authenticated API routes, including repeat-safe invitations, catalog provisioning, and settled gifts; `pnpm seed:check` locks the population and non-local refusal floors |

The Android freeze report records that a profile photograph had to be written
straight into the database to get a walk past onboarding. That is the shape of
this gap: the product has been demonstrated by hand-editing rows.

## What the classification implies about order

The rows are not independent. Photographs unblock discovery, profiles,
conversations, creator pages and the Studio preview simultaneously. Creator
discovery needs a listing route that does not exist. The seeded world and local/test
gifting path now exist; live gifting remains downstream of provider, terms, tax,
channel, design, and payout decisions rather than more client wiring.

Monetisation has moved from architecture to product. A membership can be priced,
bought, read, cancelled, and expired end to end in local and test, through the
product's own routes and a real browser. What is left there is not client wiring:
it is a payment provider, published commercial terms, a launch country, a tax
authority, a refund and grace policy, a payout capability, and a store-channel
decision for mobile purchasing. Every one of those is an approval rather than a
build, and each is refused by configuration in the meantime.

The remaining order starts with creator discoverability and profile depth, then
the social and Studio depth work. Production commerce resumes only after its
external gates are approved; repeating its local implementation would not close
any of them.

## Cross-references

[Product phases](01-product-phases.md), [consumer product](02-consumer-product.md),
[Creator Private Clubs](03-creator-private-clubs.md),
[Consumer Web freeze report](../architecture/18-consumer-web-freeze-report.md),
[Creator Studio freeze report](../architecture/19-creator-studio-freeze-report.md),
[media freeze report](../architecture/13-media-freeze-report.md),
[open decisions](../decisions/DECISIONS_REQUIRED.md).
