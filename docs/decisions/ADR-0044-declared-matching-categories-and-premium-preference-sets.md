# ADR-0044: Declared matching categories, premium preference sets, and platform-owned coin packs

- Decision date: 2026-09-01
- ADR status: Accepted
- Owners: Founder (decision owner), USERS, LIVE, WALLET, BILLING, Consumer Web, Consumer Mobile

## Context

[ADR-0043](ADR-0043-livekit-transport-coins-and-paid-live-preferences.md) built the coin ledger and sold one thing with it: a bounded window in which the matcher narrows to a declared region. It recorded three constraints it could not resolve, and this decision resolves all three.

**There was no gender field anywhere in the profile model.** `packages/validation/src/profile.ts` recorded why: the minimum discoverable profile was decided so that "nobody is asked to hand over sensitive data as the price of being seen". The filter this product is expected to sell had no column to read, and `livePremiumPreferenceKinds` was a closed list of one — `region` — precisely so the absence was checkable rather than asserted in prose.

**A window stopped narrowing the instant it was charged.** `captured` was a terminal state, so the fifteen minutes somebody bought silently became one match: the next Next handed them the whole pool, unfiltered and unannounced. Nothing in the code said so, and nothing in the product said so either.

**BILLING could not express a platform-owned offer.** `billing_offers.creator_id` was `not null` and every settled sale credited a creator payable, so a coin pack could only have been sold by pretending it belonged to a creator — putting a stranger's name on a sale they had no part in, a liability on a payable they never earned, and VELORA's own revenue into their earnings view.

A fourth was discovered while building this and is the one that mattered most. **A paid narrowing only applied to the buyer's own search.** The matcher read the buyer's window when the buyer polled, and the other person's poll allocated with no reference to it at all — so somebody who paid to meet only women was handed a man the moment his search picked them. The filter was worth nothing in exactly the case a person would notice.

## Decision

### A declared matching category is collected, and it comes only from the account owner

VELORA collects an optional, self-declared matching category: `woman`, `man`, `non_binary`, or `undisclosed`. Nothing is inferred from a camera, a face, a body, a name, a voice, a model, a pronoun, a location, or any behavioural signal, and no code path anywhere derives a value for it.

That is a property of the shape rather than a promise. There is exactly one writer, and it takes its subject from the authenticated principal, so no request can declare something about somebody else. There is exactly one reader outside USERS, and it answers "which of these identifiers declared this" over a candidate list the caller did not choose — never "what is this person". The vocabulary is closed and the database enforces it.

It lives in `users_matching_declarations`, its own table, rather than as a column on the profile. A nullable column would have been swept into every projection that already selects that row, and the difference between "declined to say" and "never asked" would have survived only as a convention about `NULL`. Every peer-facing view of a person in this repository is built from `users_profiles`, `users_profile_languages`, and `users_profile_media`; none of them joins this table, and a new one would have to be written on purpose.

**Existing accounts get no row and no backfill.** Choosing for somebody would be the exact inference this exists to avoid, and "never asked" is a real state that the product has to handle rather than migrate away.

**`undisclosed` is a real declaration and is deliberately unmatchable.** A preference for people who declined to say would turn declining into an answer with consequences, which would make the option a trap rather than a choice. Somebody who declined, and somebody who was never asked, are matched by `Everyone` — which is free — and by nothing narrower.

**It is never displayed.** No discovery card, live encounter, creator page, RTC session, provider payload, or log carries it. The server publishes it in exactly one place: the owner reading their own profile.

### Free-text self-description is not collected, and that is a decision rather than a gap

A person's own words about themselves are a different thing from a matching category with different rules: they would need a moderation taxonomy nobody has approved, they cannot be grouped, translated, or reasoned about by anybody deciding whether a filter over them is lawful, and they would not be filterable anyway. Collecting them and quietly making them unfilterable would be worse than not collecting them. The catalogue is extensible — adding a category is a value in two lists and a migration — so this can be revisited without a redesign.

### A premium selection is a conjunction of declared preferences, priced from a server catalogue

`livePremiumPreferenceKinds` becomes `gender`, `region`, and `language`. Every one of them is a field a person set about themselves. There is no age band, body attribute, appearance, orientation, compatibility score, popularity signal, or "people like the ones you liked" — each is either something VELORA does not collect, something no lawful basis covers, or something that would have to be computed, and a computed preference is an inferred one however it is dressed.

A selection is stored as three nullable columns on one entitlement rather than as a kind and a value, because a selection is a *conjunction* — "women, in France, who speak French" is one window and not three — and one column per kind is the shape where the database can state which combinations are legal.

**A selection costs the sum of the kinds in it**, read from a server-owned catalogue both surfaces render rather than restate. A flat price whatever is selected would mean the person who narrows on one thing subsidising the person who narrows on three; a tiered "bundle" price would be a discount structure nobody has approved. The numbers are development values — what a coin is worth in money is undecided, so what any of this costs in money is undecided with it — and they are changeable in one file with no migration and no client release.

A `language` preference must be one the buyer speaks. Asking for people who speak a language you do not speak is a search that means nothing, so the server refuses to sell it rather than selling a filter it would then have to either honour into an empty pool or quietly drop.

### A charged window is still a window

`captured` becomes an *open* state. The coins move once, on the first encounter the narrowing actually produced, and the window keeps narrowing until it expires with every further match inside it free. A charged window is closed by the sweep as `expired` rather than `released`, because the money settled at capture and giving it back would be handing over coins the platform had earned.

`expired` and `released` are deliberately distinct, and the distinction is financial rather than cosmetic: a released window is one nobody was charged for, and an expired one is a window somebody paid for and used. Collapsing them would make "how often does a paid window find nobody" unanswerable, which is the one number that says whether this feature is honest.

### The narrowing holds from both sides of the pair

The matcher reads every candidate's own window in one query and asks USERS, as a membership question about the actor, whether this pair satisfies it. A candidate whose window the actor fails is skipped, and a window that did the work is charged whichever side's poll allocated — because what somebody pays must not depend on whose poll happened to arrive first.

The question is asked as a membership test rather than by reading attributes, and that is the whole privacy design: LIVE learns one bit per window — whether this pair is allowed — and never learns what anybody declared, including the actor. Reading the actor's own attributes into LIVE would have put a special-category value into a domain that has no use for one.

A pair who asked to meet bypasses both narrowings, as they already bypassed the buyer's. Two people who named each other have answered the question a preference asks, and a filter that then kept them apart would be the product overruling both of them.

### Widening is free; anything else is a new window

The one preference change allowed inside a window somebody already paid for is dropping preferences from it, because that can only ever ask for *less* and there is no version of it that could cost more. Adding a preference, or swapping one value for another, is a different window and is sold as one — refused by the server rather than silently re-priced.

Cancelling returns everything if the window never found anybody, and nothing if it did; the surface says which before the button is pressed. Changing your mind before anything is found therefore costs nothing either way, which is what makes the control something people will touch.

### Safety precedes preference, and money grants nothing

A premium window is an input to the candidate query and to nothing else. Eligibility, standing, blocks, enforcement, recently-met suppression, and RTC admission are asked identically and in the same order whether or not anybody paid, and any one of them refusing produces no encounter. There is no method on WALLET that a safety decision consults, and no field on the entitlement that could be read as a grant.

An empty pool is answered as an empty pool. No person is fabricated, no count is published, no wait is estimated, and the filter is never quietly widened to find somebody — the coins stay held and come back in full if the window closes having found nobody.

### Coins buy random live matching only

The entitlement narrows the random matcher. It does not affect Discover, does not affect who may be picked, and does not paywall profile browsing or requests to meet. Choosing a person is a different act with a different lifecycle, and a paid preference over it would turn browsing into a purchase.

### An offer says who is selling it

`billing_offers` gains `owner_type`. A creator offer names a creator and a platform offer must not; the database enforces the pairing, so "whose money is this" has one answer per row and no code path can reach it by defaulting. Coins are platform-only at the database too.

A platform sale posts its whole gross to a *platform-scoped* revenue position, creates no payable, publishes no revenue fact, and unwinds the one position it created. `platform_revenue` scoped to a creator means the platform's share of that creator's sales and is read by their earnings view; putting VELORA's own product revenue there would make a coin pack appear in somebody's earnings as money the platform kept out of their work.

Where VELORA sells its own products *from* is undecided, and the commerce authority says so: it answers `undefined` outside local and test, and the seller gate refuses. A platform offer is unbuyable in a deployed environment even if one existed there — and none does, because publishing the packs is gated on `WALLET_WEB_ACQUISITION`, a switch of its own rather than an inference from a payment provider being configured.

### One real purchase mints coins once, and a client never mints anything

Both channels credit through the same idempotent path. On the Web a purchase is proved by BILLING settling a payment and publishing an entitlement fact, which WALLET consumes; on Android by a server-side verification against the store. The acquisition row's unique index over channel and reference is consulted by the insert rather than by a prior read, so a provider redelivering five times, three client retries racing, a replayed relay dispatch, and a reinstalled store token all produce one credit. A store token and a payment identifier are different namespaces, so two real purchases through two channels are two credits.

No request in the contract can say what a purchase was worth. The coin count comes from the platform's own catalogue keyed by what the *store* or *BILLING* confirmed.

## Consequences

Coins are the one virtual asset and stay so. A second currency would bring exchange semantics, a second ledger position, refund complexity, and a surface that has to explain both; nothing in this product needs one, and the ledger is extensible if something eventually does.

The declared category is a special-category attribute. It is optional, never required for discovery, Live, or matching; erased with the account by cascade; and readable only by its owner. Whether a paid filter over it is lawful in a given market is a legal question that remains open and is recorded in [DECISIONS_REQUIRED](DECISIONS_REQUIRED.md); the collection and the sale are separable, and withdrawing the `gender` kind from the catalogue withdraws the sale without touching what anybody declared.

Nothing here is sellable anywhere but local and test. The coin ledger, both acquisition channels, live discovery, and the RTC provider are each refused outside them by configuration, and a platform offer additionally has no country to sell from.

## Alternatives considered

**Infer gender.** Rejected outright. Every mechanism — face, body, name, voice, model — is an inference about a person made without asking them, and the whole shape of this decision exists to make it unreachable rather than discouraged.

**Charge per match.** Rejected. It makes what somebody pays depend on how busy the product happens to be that minute, and it is what the previous terminal `captured` state accidentally implemented.

**Charge on activation with no refund.** Rejected. It means paying for a pool that turned out to be empty, which is the behaviour that makes a paid filter feel like a trick.

**Let a window's preferences be edited freely.** Rejected. Every version of it either produces a surprise charge or silently redefines what somebody bought.

**Model a coin pack as a creator offer owned by a platform account.** Rejected, and it is the failure mode this decision exists to avoid: a sentinel creator is a real identifier somebody eventually joins against, and the join would say VELORA's own sales belonged to a creator.
