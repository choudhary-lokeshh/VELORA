# ADR-0043: LiveKit as an RTC transport, coins as a server-owned ledger, and one paid matching preference

- Decision date: 2026-09-01
- ADR status: Accepted
- Owners: Founder (decision owner), REALTIME, LIVE, WALLET, BILLING, Consumer Web, Consumer Mobile

## Context

[ADR-0040](ADR-0040-random-live-discovery.md), [ADR-0041](ADR-0041-live-discovery-preferences-choice-and-presence.md), and [ADR-0042](ADR-0042-live-surface-refinements.md) built random live discovery and finished its surfaces. Everything about it is real except the one thing it is for: two strangers cannot see or hear each other, because [ADR-0025](ADR-0025-rtc-live-communications-architecture.md) locked a provider-neutral RTC architecture and no adapter had ever carried a packet. The `local-test` adapter answers every control operation faithfully and reaches no network, and `RtcLiveSessions.mediaTransport` reports `none` so both surfaces say so rather than pretending.

Two questions follow from making that real, and they are separate questions with separate owners.

**Which provider, and on whose terms.** [RTC provider eligibility](../compliance/10-rtc-provider-eligibility.md), researched from primary sources on 2026-08-20, assesses nine candidates and approves none. LiveKit Cloud is recorded there as the closest technical fit — per-participant, per-room, grant-scoped JWTs and callbacks that authenticate a SHA-256 of the exact raw body — and as **NOT APPROVED**, because its acceptable-use policy prohibits content that is "unlawful, fraudulent, deceptive, harassing, abusive...or otherwise objectionable", which is unbounded vendor discretion over exactly what VELORA is.

**What a paid matching preference is, and what it may cost.** The product intent is that free random matching stays free and a person may pay to narrow who they meet. Nothing about that is expressible today: there is no balance, no ledger, no entitlement, and no charging rule — and the two candidate charging models (a fee per tap, or a fee only on a successful match) are both defensible and produce different products.

Three constraints shaped every decision below, and each was discovered rather than assumed.

**There is no gender field anywhere in the profile model.** `packages/validation/src/profile.ts` records the reason: "Date of birth, precise location, gender, and orientation are not part of it, so nobody is asked to hand over sensitive data as the price of being seen." The "Women only" filter this product is eventually expected to sell has no column to read, and inventing one from a camera, a name, a voice, or a model would be exactly the inference that decision was made to avoid.

**BILLING's offer model is creator-scoped by construction.** `billing_offers.creator_id` is `not null` and revenue routes to a creator payable position, so a platform-owned coin pack is not an offer BILLING can currently express.

**Android gives one client the camera.** `expo-camera`'s preview is a native view rather than a `MediaStream`, so it cannot be published into a session — which makes the handover between preview and provider a correctness problem rather than a rendering one.

## Decision

### LiveKit is an adapter behind the existing port, and staging and production still refuse it

`REALTIME_RTC_PROVIDER` gains a third value, `livekit`, implementing `RtcProviderPort` unchanged. Nothing above the port learns a provider exists: the matcher, the join-authorization service, the orchestrator, the reconciler, and the provider-event inbox are untouched, and `mediaTransport` becomes `provider` because the adapter's `carriesMedia` capability is true rather than because its name was recognised.

It is refused in staging and production by the same guard that refuses `local-test`, and the refusal message now names the reason: an acceptable-use policy reserving discretion over "otherwise objectionable" content has given no answer rather than permission. Selecting it locally is how the integration is proved against a real provider before that answer arrives.

There is no fallback between the three values. A `livekit` selection missing its URL, key, or secret fails to compose. An environment that simulated media while claiming a provider would present "no approved provider exists" to one developer and a working call to the next, from the same commit, with nothing saying which they had.

### The room name is derived, opaque, and never supplied

A room is named by an HMAC of the platform's own idempotency key under the project's API secret. Deterministic, so an ambiguous create is recovered by asking the provider what it did with the key that was committed before the call — the two-transaction create ADR-0025 already requires. Unguessable without the secret, so it is not reproducible by anybody who learns a session identifier. And deliberately not the session identifier itself, so a provider, and anything a provider logs or exports, never holds one.

The platform's session reference travels in room metadata and is the only VELORA value the adapter sends anywhere. It has to survive a round trip because the orchestrator refuses a snapshot naming a different session. No display name, handle, region, language, or account identifier is ever given to the provider, and the participant identity is the existing per-session hash rather than an account.

Rooms are created with `maxParticipants: 2`. A random encounter is two strangers and never a third, and setting it at the provider means a stolen or replayed credential cannot add anybody to a conversation already in progress even if every check on this side were bypassed.

### A join authorization now says where to present the credential

`RtcProviderPort` gains `clientEndpoint`, and `JoinAuthorization` gains an optional `transport` naming the adapter and that address. It is adapter configuration rather than a per-grant value, it is `undefined` for every adapter that carries no media, and it is not a second credential: the address is a media project's public endpoint and admits nobody on its own.

This is what lets a surface tell "there is a session and nothing is carrying it" from "connect here", and it is why the Web hook reports `failed` rather than a spinner when a session exists with no transport behind it.

The token itself grants `roomJoin` on exactly one room, publish and subscribe, and nothing else — no `roomCreate`, no `roomAdmin`, no `roomList`, no `roomRecord`, no data channel, no metadata write — and its publishable sources are the medium's: a voice encounter may publish a microphone and cannot publish a camera. A screen share is absent from both, because a live encounter is two strangers looking at each other and no moderation position covers arbitrary content being put in front of one of them.

Revocation uses `revokeTokenTs`, which invalidates every credential minted before the removal instant. The platform's authorization generation was already the part of revocation VELORA fully controls; this is the provider honouring it too, rather than continuing to accept a bearer token this platform has already handed out.

### Coins are a ledger of their own, not an entry in BILLING's journal

WALLET is a new domain owning a balanced, append-only coin ledger under `wallet_`, with the same three invariants BILLING's journal has — balance checked at commit by a deferred constraint trigger, immutability enforced by triggers that refuse `UPDATE` and `DELETE` and refuse an entry written by any transaction other than the one that posted its transaction, and a correction that is a new transaction naming the one it repairs.

It is a second journal rather than a currency in the first, and the reason is structural. BILLING's journal enforces currency agreement between an entry, its account, and its transaction through composite foreign keys onto an ISO 4217 code. A coin has no currency. Giving it a fake one — `XXX`, a private code, a "VLC" — would make every currency-shaped rule in that journal a lie about coins, and would put a unit that buys nothing outside VELORA into the same books as money somebody paid. [ADR-0011](ADR-0011-payments-payouts.md) forbids a shared ledger and requires owner-specific journals; this is one.

The two books meet at exactly one place: a payment BILLING settles publishes an entitlement fact, and an issuance here consumes it.

Four positions and no more — `consumer_balance`, `consumer_reserved`, `platform_issuance`, `platform_revenue` — because a reservation has to be somewhere that is neither spendable nor spent.

A projected `wallet_balances` row carries `CHECK` constraints that neither position may go below zero, and it is the row a spend takes for update. That is what makes an overspend a database refusal rather than a race between two reads, and what serializes two concurrent activations without an advisory lock somebody has to remember to take. The projection is derived and is checked against the entries by an integration test rather than trusted.

### Reserve on activation, capture on the first filtered match, release in full on expiry

One charging rule, chosen deliberately over the two alternatives.

Charging on tap would mean somebody paying for a pool that turned out to be empty, which is the behaviour that makes a paid filter feel like a trick. Charging only after a successful match would mean the platform running a narrowed, more expensive search for free for anybody who never matched, and would make what somebody paid depend on how busy the product happened to be that minute.

So the coins leave the spendable balance the instant the window opens and are *held*: a real ledger position, not a flag, so a second activation cannot be funded by money already committed to the first and the books state at every instant exactly how much is held and against what. They are captured when the window produces an encounter and released in full when it does not — and the release is the worker's job, running whether or not anybody is watching, so somebody who closed the tab gets their coins back exactly as somebody still on the screen does.

Two consequences are deliberate. Cancelling inside the window returns everything, because changing your mind is not a consumption of what you bought. And a pair who had already agreed to meet bypasses the narrowed pool by design, so that match does not capture: charging for a match the filter did not make would be charging for the filter not being used.

### The one supported premium preference is a declared region, and it is not expressible in the free contract

`livePreferencesSchema` is unchanged. It still offers `any` or `same` and still cannot hold a country picker, and ADR-0041's reason for that stands: "people in a country I chose from a list" is a filter over a population, and a shape that could hold one makes it expressible whether or not a surface offers it.

The paid narrowing lives somewhere else entirely. A specific region is bought as a bounded window through `POST /v1/wallet/live-preference`, recorded against a ledger reservation, and read by the matcher from that record. A client can therefore never simply ask to filter a population; it can only hold a window that somebody deliberately opened, that expires, and that the live state reports back as `premium`.

A declared-gender preference is not implemented, and its absence is recorded as an owner decision rather than as an implementation gap. There is no field to read, and adding one is a product, policy, and legal decision about collecting a special-category attribute.

### Paying narrows a pool and authorizes nothing

The window is applied to the candidate *pool*, before any safety, standing, enforcement, or eligibility predicate is asked, and it can only make the pool smaller. Every one of those predicates is asked identically, in the same order, under the same pair lock, whether or not anybody paid — which is why `LivePremiumPreferencePort` has no method a safety decision consults, and why an integration test blocks a pair and proves that somebody who paid to find them is still refused and still not charged.

A filtered match discloses nothing new to the person who was matched. They are told who they are with and nothing about why, exactly as in a free encounter; the region the searcher chose is their own private product state. The searcher learns no attribute they could not already read from the profile the encounter publishes.

### Android acquisition is a separate channel with no `google-play` adapter

Google Play requires digital goods consumed inside a Play-distributed application to be sold through Play Billing, and a Play purchase is proved by verifying a token against Google's own API from a server holding a service-account credential — a different mechanism, with a different proof, from a Web payment. So it is a different port.

`CoinAcquisitionPort` is declared in full: verify, then acknowledge, in that order and never the reverse, because Play refunds an unacknowledged purchase and acknowledging before the coins are durably credited would acknowledge a delivery that had not happened.

There is deliberately no `google-play` implementation. No Play Console project, product identifier, application signing key, or service-account credential exists to verify against, and a channel that could be selected and could not verify would mint currency on a client's word. `local-test` verifies a token it shaped itself, refuses a product the platform does not sell, and derives the coin amount from the platform's own catalogue — the three properties a real adapter must have, so the code above it cannot be written wrongly and pass.

The request shape carries no coin amount at all. A request that could say what a purchase was worth is a request that mints currency.

### Web acquisition is BILLING's, and it is blocked twice

The seam exists and is inert: WALLET consumes BILLING's published entitlement facts and credits coins for a `coins` resource type that nothing yet emits. So the day a platform-owned pack is sellable, Web acquisition is an offer and a catalogue entry rather than a second checkout.

It is blocked for two independent reasons, either of which alone is enough. No payment provider is approved in any environment. And BILLING cannot express a platform-owned product, so making one is a change to the money architecture with tax and revenue-split consequences — an owner decision, recorded as one.

### On Android the provider owns the devices, and the preview yields before it asks

`RECORD_AUDIO` is declared for the first time, and its previous absence was correct rather than an oversight: a permission a build cannot use is one asked for under false pretences, and until this release nothing could carry audio anywhere. It is still requested only after somebody presses Start.

Three permissions the RTC library contributes are refused. `BLUETOOTH` and `BLUETOOTH_ADMIN` are pre-Android-12 headset access, and whether VELORA asks anybody for Bluetooth is a product decision nobody has made; a call routes to the earpiece and the speaker without them. `FOREGROUND_SERVICE` is for media that continues behind other applications, and a live encounter deliberately does not.

Because Android gives one client the camera, the preview unmounts and the room opens both devices itself once an encounter is being carried — and it yields on the *server's* answer about the encounter rather than on the transport's own success, because yielding after a successful connection is yielding too late to work.

## Consequences

Two strangers can see and hear each other in local development against a real provider, through the same matcher, the same authorization, and the same surfaces that already existed. Nothing about who meets whom moved: VELORA chooses, and LiveKit transports a pairing VELORA has already authorized.

Free random matching is unchanged and stays free, including both narrowings it already offered.

Coins exist only where a coin ledger is configured, which is local and test. Every deployed environment refuses the ledger, so no balance, no window, and no charge is reachable in one — and the surfaces render nothing rather than a disabled control, because a control explaining a feature that does not exist is a control somebody will try to enable.

What is now blocked on people rather than on code is recorded in `DECISIONS_REQUIRED.md`: written provider confirmation, what a coin is worth, whether a balance expires or is refundable, its tax and consumer-protection treatment, a platform-owned coin pack in BILLING, a Play Console project and its product identifiers, and whether VELORA collects a declared gender at all.

## Alternatives considered

**Coins as a currency in BILLING's journal.** Smaller by one table set and wrong: it would require a fake ISO 4217 code, which makes every currency rule in that journal untrue about coins and puts a unit that buys nothing outside VELORA into the same books as real money.

**Charging per tap.** Simpler idempotency and a worse product: somebody pays, nobody matching is there, and the money is gone. The reservation costs a sweep and a settlement state and is the difference between a utility and a trick.

**Debiting only after a successful match.** Fairest-sounding and the least honest about cost: a narrowed search is more expensive to run and would then be free for everybody who never matched, which makes what somebody pays a function of how busy the product was.

**Inferring gender.** Rejected outright. Every mechanism that could produce it — a camera, a face, a name, a voice, a model — is an inference about a special-category attribute, and the profile model's existing decision not to ask for one is a stronger position than any accuracy figure.

**Letting the free preference contract carry a region code, gated by a server check.** It would have been fewer moving parts and would have made "filter a population" an expressible request that only a server check refused. Keeping it inexpressible is what makes the paid path the only path.
