export interface paths {
    "/v1/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getLiveness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/health/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/local/web-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Development and test identity adapter. It is refused outside the local and test application environments and can never mint Platform Admin authority. */
        post: operations["createLocalWebSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/local/mobile-sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Development and test identity adapter for Consumer Mobile. It is refused outside the local and test application environments. */
        post: operations["createLocalMobileSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getAuthSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/mobile/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["refreshMobileSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/logout-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["logoutAll"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/recovery": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["startAccountRecovery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/auth/recovery/completion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["completeAccountRecovery"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Idempotent. The AUTH account is derived from the presented credential, so the request body can never name another account. A repeated call returns the existing account unchanged, whatever its lifecycle state. */
        post: operations["createConsumerAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getConsumerAccount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getConsumerOnboarding"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/onboarding/adult-declaration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Self-declared adult status and the region whose rules apply. This is the weakest assurance class and is never equivalent to a verified adult check. No birth date is collected. */
        post: operations["declareAdult"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/onboarding/acknowledgements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["acknowledgeConsumerPolicies"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getConsumerProfile"];
        put?: never;
        /** expectedVersion is absent exactly when no profile exists yet. Being wrong in either direction is a conflict rather than a silent create or overwrite. */
        post: operations["saveConsumerProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A new consumer is not discoverable. Discoverability is off until it is turned on here, and it cannot be turned on while the minimum discoverable profile is incomplete. */
        post: operations["saveConsumerPreferences"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/profile/media": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["createConsumerProfileMediaUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/profile/media/completion": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The platform decides the object's type, size, and acceptability from the stored bytes. A client never declares what it uploaded. */
        post: operations["completeConsumerProfileMediaUpload"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/profile/media/removal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["removeConsumerProfileMedia"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/users/me/availability": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getConsumerAvailability"];
        put?: never;
        /** A bounded, user-managed preference. It is not presence, not consent to be contacted, not a guarantee of appearing in discovery, and never an override of a block or an enforcement decision. Being available always carries an end. */
        post: operations["saveConsumerAvailability"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Idempotent, and explicit: nobody becomes a creator by being a consumer. The principal is derived from the presented credential, so the body can never name another account, and exactly one creator account exists per principal however many concurrent calls arrive. No legal name, business registration, tax identifier, payout credential, or identity document is collected — those belong to a later verification and payout architecture that does not exist yet. */
        post: operations["createCreatorAccount"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A caller with no creator capability receives the same answer as a caller addressing a route that does not exist, so probing this endpoint reveals nothing. */
        get: operations["getCreatorAccount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getCreatorOnboarding"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/onboarding/acknowledgements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Acknowledgement evidence is append-only and versioned. When approved creator legal copy replaces the unpublished version, the version string changes, every creator is asked again, and the evidence that they accepted the earlier version is preserved rather than rewritten. */
        post: operations["acknowledgeCreatorPolicies"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["getCreatorProfile"];
        put?: never;
        /** The handle is canonicalized server-side and claimed on the first save; database uniqueness decides who gets it, so fifty simultaneous claims of the same name settle on exactly one owner. It is immutable afterwards — this milestone has no self-service rename, and a save naming a different handle is refused rather than quietly ignored. A profile is created as a draft: publishing is a separate, explicit decision. */
        post: operations["saveCreatorProfile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/profile/publication": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publishing is what makes a creator page reachable without a session, so it is never a side effect of saving. Only an active creator may publish; unpublishing takes the page down immediately for every later read. */
        post: operations["setCreatorProfilePublication"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creators": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The only creator route a visitor with no session may call, and it answers with an allow-listed projection rather than a filtered record: no creator identifier, no AUTH subject, no consumer identifier, no lifecycle or moderation state, no counts, and nothing purchasable. An unknown handle, a draft profile, and a creator who is not active are all the same 404, so the endpoint cannot be used to discover that somebody exists. */
        get: operations["getPublicCreator"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listCreatorContent"];
        put?: never;
        /** Everything starts as a draft and nothing a creator writes becomes visible by being written. An edit carries the version it was read at, so a second tab cannot overwrite work it never saw, and an item identifier that belongs to another creator is answered exactly as one that does not exist. */
        post: operations["saveCreatorContent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/content/lifecycle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Publishing is a decision about who may see something, so it is never a side effect of saving. Only an active creator may publish; archiving withdraws an item without destroying the record, and a concurrent transition is refused rather than applied twice. */
        post: operations["setCreatorContentLifecycle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creators/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The catalog half of the public creator page, and the same rule: a handle nobody holds, a profile that is a draft, a creator who is not active, and a creator with nothing published are one indistinguishable 404. Drafts, archived items, and members-only items never appear, and paging is bounded and keyed on the publication instant so a page boundary cannot move. */
        get: operations["getPublicCreatorCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/clubs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listCreatorClubs"];
        put?: never;
        /** A club starts as a draft with nobody in it. The slug is unique within the creator rather than globally, is canonicalized server-side, and is not renameable in this milestone because it already appears in links people hold. */
        post: operations["saveCreatorClub"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/clubs/lifecycle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Only a published club appears publicly or admits anybody. Closing is final in this milestone: reopening would put people back inside a space they were removed from with nobody deciding it, and no approved policy says what that means. */
        post: operations["setCreatorClubLifecycle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/clubs/invites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listClubInvites"];
        put?: never;
        /** A complimentary invitation and never a purchase: the membership it creates records that it came from a creator invite. The secret is 256 bits of server-generated randomness, stored only as a digest, bounded by an expiry, revocable, and usable once. */
        post: operations["issueClubInvite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/clubs/invites/revocation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["revokeClubInvite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/clubs/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A creator learns how many people hold access and can withdraw one, and nothing else: no name, no consumer identifier, no contact detail, and no behaviour. Subscriber private behaviour stays out of creator views entirely. */
        get: operations["listClubMemberships"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/clubs/members/revocation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Withdrawal takes effect on the next protected read rather than on a schedule, because every read asks whether the entitlement is live rather than trusting something computed when it was granted. */
        post: operations["revokeClubMembership"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/clubs/redemptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redemption is single-use and settled by the database rather than by a read, so a secret presented many times at once admits its holder exactly once. A claim that cannot be completed is released rather than spent. */
        post: operations["redeemClubInvite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/clubs/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listClubAccess"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/clubs/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Every condition is asked at the moment of the read: the item is published and club-scoped, the club is published, the creator is active, the account is in good standing, and the entitlement is live. Nothing consults a cached decision, because a cached decision is how a revoked member keeps reading. An item the caller may not read is the same 404 as one that does not exist. */
        get: operations["getClubContent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creators/clubs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Metadata only: a name, a description, and the slug. No member count, no member list, no invitation, no content, and no control implying anybody can pay to join — no payment path exists, so offering one would be a lie in a button. */
        get: operations["getPublicCreatorClubs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/provider-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** The provider's signature over the exact bytes is the entire credential: there is no session, no audience, and no CSRF token here. Size is bounded before the body is read as data, and the signature is checked before it is parsed as anything. */
        post: operations["receiveProviderEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listConsumerSubscriptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/checkouts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["readCheckout"];
        put?: never;
        /** The request names an offer and a currency and nothing else. The amount is read from the price row inside the transaction that records the operation, so no client can propose what it pays. A client idempotency key is required, scoped by consumer and offer, so a double-click resolves to one purchase. */
        post: operations["startCheckout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/earnings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Nothing here is a forecast, a trend, or a projection of future income. Every figure describes money that has already moved, and `tax` is zero everywhere because no tax authority is configured — which is a statement about what Velora withheld rather than about what anybody owes. */
        get: operations["getCreatorEarnings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/earnings/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The currency is required rather than defaulted, because defaulting would pick one of a creator’s currencies for them and show it as though it were all of their money. Paging is keyset rather than offset, so a settlement landing mid-read cannot shift a page boundary. */
        get: operations["getCreatorEarningsHistory"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/safety/readiness": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Reports the configured source by name rather than a boolean, because "off" and "off because nobody has approved one" are different facts. Surface ineligibility is reported separately from the blockers: both app stores prohibit the class outright with no published approval path, so it is a permanent property of those surfaces rather than something anybody is working on. */
        get: operations["getMatureContentReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/payouts/readiness": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** In a deployed environment this always answers that payouts are unavailable, for two independent reasons: no assessed payout provider is eligible for Velora’s business model, and no settlement window, reserve, or minimum payout is published. The balances are still shown, because the money is real whatever the platform can currently do with it. */
        get: operations["getPayoutReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/payouts/onboarding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Velora collects nothing. There is no field in this API, and no column in this domain, for a bank account number, a routing number, a government identifier, or an identity document — not encrypted, not tokenized, not redacted: absent. The provider gathers, verifies, and retains all of it under its own compliance obligations, and Velora keeps a reference to the record plus a normalized capability answer. */
        post: operations["startPayoutOnboarding"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/payouts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listCreatorPayouts"];
        put?: never;
        /** No payout exceeds the amount derived from journal entries, and the database refuses a posting that would overdraw a creator whatever the service believes. An ambiguous provider answer leaves the instruction submitted with its reservation intact rather than retried, because a payout whose answer was lost has either moved money or not. */
        post: operations["requestPayout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/offers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listCommercialOffers"];
        put?: never;
        /** An offer points at a resource another domain owns and says what kind of commercial relationship it would create. It does not say what it costs and it is not purchasable. */
        post: operations["createCommercialOffer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/offers/prices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A price is never edited. The amount is an integer count of minor units carried beside its currency, and changing what something costs means retiring one price and publishing another, because a purchase references the exact row it was made against. */
        post: operations["publishCommercialPrice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/offers/prices/retirement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["retireCommercialPrice"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/creator/offers/lifecycle": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Activation re-reads every authority inside the transaction that performs it: approved commercial terms, the creator standing, the resource being owned and published, and at least one live price in a currency still approved. Retiring withdraws the offer and every live price on it, and deletes nothing. */
        post: operations["setCommercialOfferLifecycle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/creators": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Operational state only: no AUTH subject, no consumer identifier, no contact detail, no financial data, and no moderation narrative. Search is a bounded prefix over the public handle, which is already public. */
        get: operations["listAdminCreators"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/creators/suspension": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Stops the creator operating and takes their public surfaces down immediately, because every public read rechecks current creator state. It does not touch the person's consumer account: a creator suspension and a global restriction are different decisions with different scopes, and conflating them would ban somebody from a product they were not accused of anything in. */
        post: operations["suspendCreator"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/creators/reinstatement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restoration is its own record rather than an edit of the suspension, because the question an audit asks is what was done and by whom, not only what is in force now. Nothing a creator had published comes back automatically: publication is their decision to take again. */
        post: operations["reinstateCreator"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/creators/object-removal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Takes one profile, item, or club out of public view without destroying it. Removal and deletion are different acts, and an object that is merely unpublished remains evidence and remains the creator’s. The object must belong to the named creator; one that does not is answered exactly as one that does not exist. */
        post: operations["removeCreatorObject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/creators/membership-revocation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Withdraws one entitlement as a platform action. It takes effect on the next protected read, because every read asks whether the entitlement is live rather than trusting anything computed earlier. */
        post: operations["revokeMembershipAsAdmin"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/cases": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A case is about a target and never about who reported it. There is no reporter field in this response and no report count, so no operator view can group people by who they complained about or act on how many people did. */
        get: operations["listModerationCases"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/case": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The reporter narrative is here because a reviewer cannot judge an allegation without it. The reporter is not: there is no field for one, so no response this contract can produce carries a reporter identity even to an operator. */
        get: operations["getModerationCase"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/cases/claim": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A lease rather than an assignment: a reviewer whose session ends mid-review releases the case when the lease lapses instead of holding it out of the queue for ever. Claiming a case somebody else currently holds is refused, so a claim is not a way to take a review out from under whoever is doing it. */
        post: operations["claimModerationCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/cases/triage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Priority is an input here and nowhere else. Nothing computes it and nothing raises it because a second report arrived, because making report volume an input to urgency would let twenty coordinated accounts escalate anybody. */
        post: operations["triageModerationCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/cases/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** A reviewer's own words, recorded as evidence and readable only through the case. Evidence is appended and never edited or removed, so a note is a fact about what somebody thought at a moment rather than a field somebody keeps current. */
        post: operations["addModerationNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/cases/decisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** An explicit command with a closed action vocabulary, and the only way a decision is ever recorded. There is no endpoint anywhere in this API that edits one: a correction is a superseding decision that names the original, and the original stays exactly as written. */
        post: operations["decideModerationCase"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/appeals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The appellant's own words are absent from this queue. An operator reads a complaint through the case it belongs to; a list shape carrying prose is a shape a log line or a metric label eventually carries too. */
        get: operations["listModerationAppeals"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/safety/appeals/outcome": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Upholding a complaint names the superseding decision that replaced the original, and the server refuses one that does not genuinely replace it. Every outcome records the operator who reached it, because a complaint may not be decided solely by automated means and a column only a person fills is how that stops being a promise. */
        post: operations["answerModerationAppeal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/billing/state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** A read and only a read. There is no operation anywhere in this API that edits a financial row; the one financial action an operator has is issuing a refund, and that goes through BILLING’s own service with an operator’s authority. Reporting the configured adapter name rather than a boolean is what makes "off" and "off because nobody has approved one" distinguishable. */
        get: operations["getAdminFinancialState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/admin/billing/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** There is no consumer-facing refund path anywhere in the API, because refund eligibility is unresolved commercial policy and a self-service control would be a promise nobody approved. This operator route exists so the accounting is exercisable; in a deployed environment it refuses, because no payment provider is approved and no Platform Admin session can hold the assurance it requires. */
        post: operations["issueRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/discovery/candidates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Eligibility is a fixed conjunction of account, adult, profile, discoverability, availability, pair, and language conditions. Ordering is deterministic and explainable, and nothing purchasable affects either. */
        get: operations["getDiscoveryCandidates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/discovery/passes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Private. The other person is never notified, no reputation is derived from it, and it is not a block: a block is a stronger, indefinite suppression owned by Trust and Safety. */
        post: operations["passDiscoveryCandidate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/discovery/introductions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listIntroductions"];
        put?: never;
        /** A mutual introduction requires both people to opt in independently. Two simultaneous reciprocal signals produce exactly one introduction. */
        post: operations["createIntroductionSignal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/messaging/conversations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listConversations"];
        put?: never;
        /** A conversation is created from a mutual introduction and from nothing else. There is no other route into messaging a stranger. */
        post: operations["createConversation"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/messaging/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Message bodies are stored in a form the server can read so moderation and reporting are possible. Messaging is not end-to-end encrypted and is never described as such. */
        get: operations["listMessages"];
        put?: never;
        /** Membership and current safety eligibility are revalidated at the moment of the send, never taken from the page the client is holding. */
        post: operations["sendMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/safety/blocks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listBlocks"];
        put?: never;
        /** Available to every authenticated consumer regardless of admission standing. A person must be able to stop somebody contacting them even when their own account is restricted. */
        post: operations["blockConsumer"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/safety/blocks/removal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["removeBlock"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/safety/standing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The category and the scope, and nothing else. The review's finding, the evidence, the reviewer, and anything that could identify a reporter have no field in this response, so nothing can carry them. */
        get: operations["getSafetyStanding"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/safety/appeals": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The state and the dates. An appellant already knows what they wrote, and echoing stored text back over the API turns a record into a readable store. */
        get: operations["listOwnAppeals"];
        put?: never;
        /** There is no field saying which kind of appellant the caller is. Who they are to this decision — the person it was about, or the person whose report was dismissed — is derived on the server from the decision and the case, because a client-declared role is a client-authoritative fact about entitlement. */
        post: operations["createAppeal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/safety/appeals/withdrawal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Withdrawing leaves the record. Both facts matter: a complaint was made, and the person decided not to pursue it. */
        post: operations["withdrawAppeal"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/safety/reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listOwnReports"];
        put?: never;
        /** Reporter identity, narrative, and every internal rationale are absent from every response this API can produce. The person reported is never told that a report exists. */
        post: operations["createReport"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/messaging/conversations/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["markConversationRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/discovery/introductions/decline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["declineIntroduction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/discovery/introductions/withdrawal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["withdrawIntroduction"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["markNotificationsRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AdultDeclarationRequest: {
            declaresAdult: boolean;
            region: string;
        };
        ApiError: {
            code: string;
            correlationId: string;
            message: string;
        };
        ConsumerAccountResponse: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            locale?: string;
            region?: string;
            /** @enum {string} */
            status: "pending_profile" | "active" | "restricted" | "deletion_pending" | "deactivated" | "erased";
            /** @enum {string} */
            statusReason?: "onboarding_incomplete" | "eligibility_failed" | "safety_enforcement" | "user_requested";
        };
        CreateConsumerAccountRequest: {
            locale?: string;
        };
        CreateCreatorAccountRequest: Record<string, never>;
        CreatorAccountResponse: {
            /** Format: date-time */
            activatedAt?: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            status: "applicant" | "active" | "suspended" | "closed";
            /** @enum {string} */
            statusReason?: "onboarding_incomplete" | "eligibility_failed" | "safety_enforcement" | "platform_action" | "creator_requested";
        };
        CreatorOnboardingStateResponse: {
            account: {
                /** Format: date-time */
                activatedAt?: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                status: "applicant" | "active" | "suspended" | "closed";
                /** @enum {string} */
                statusReason?: "onboarding_incomplete" | "eligibility_failed" | "safety_enforcement" | "platform_action" | "creator_requested";
            };
            /** @enum {string} */
            adultGateReason?: "no_consumer_account" | "adult_declaration_missing" | "not_in_good_standing";
            adultGateSatisfied: boolean;
            outstandingPolicies: {
                /** @enum {string} */
                key: "creator_terms" | "creator_content_policy";
                version: string;
            }[];
            /** @enum {string} */
            step: "adult_eligibility" | "policy_acknowledgement" | "completed";
        };
        CreatorPolicyAcknowledgementRequest: {
            acknowledgements: {
                /** @enum {string} */
                key: "creator_terms" | "creator_content_policy";
                version: string;
            }[];
        };
        CheckoutResponse: {
            payment: {
                amount: {
                    amountMinor: string;
                    /** @enum {string} */
                    currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                };
                /** Format: date-time */
                createdAt: string;
                /** @enum {string} */
                failureReason?: "declined" | "cancelled_by_consumer" | "expired" | "provider_error";
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                offerId: string;
                /** @enum {string} */
                state: "created" | "provider_pending" | "requires_action" | "succeeded" | "failed" | "cancelled" | "reconciliation_pending";
                /** Format: date-time */
                updatedAt: string;
            };
            /** Format: uri */
            redirectUrl?: string;
        };
        ConsumerSubscriptionListResponse: {
            subscriptions: {
                amount: {
                    amountMinor: string;
                    /** @enum {string} */
                    currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                };
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                currentPeriodEnd?: string;
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                offerId: string;
                /** @enum {string} */
                state: "pending" | "active" | "past_due" | "cancel_at_period_end" | "cancelled" | "terminated";
            }[];
        };
        CreatorEarningsHistoryResponse: {
            /** @enum {string} */
            currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
            entries: {
                amount: {
                    amountMinor: string;
                    /** @enum {string} */
                    currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                };
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                kind: "capture" | "dispute" | "refund";
                /** Format: date-time */
                occurredAt: string;
                /** Format: uuid */
                offerId: string;
                state: string;
            }[];
            nextCursor?: string;
        };
        CreatorEarningsResponse: {
            currencies: {
                /** @enum {string} */
                currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                disputed: string;
                gross: string;
                payable: string;
                platform: string;
                reversed: string;
                tax: string;
            }[];
            readiness: {
                currencies: ("AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR")[];
                enabled: boolean;
                intervals: ("month" | "year")[];
                modes: ("subscription" | "one_time")[];
                source: string;
            };
        };
        CreatorPayoutHistoryResponse: {
            payouts: {
                amount: {
                    amountMinor: string;
                    /** @enum {string} */
                    currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                };
                /** Format: date-time */
                createdAt: string;
                /** @enum {string} */
                failureReason?: "recipient_not_ready" | "declined" | "provider_error";
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                state: "requested" | "reserved" | "submitted" | "paid" | "failed" | "cancelled" | "reversed";
                /** Format: date-time */
                updatedAt: string;
            }[];
        };
        CreatorPayoutReadinessResponse: {
            balances: {
                available: string;
                /** @enum {string} */
                currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                held: string;
                releasable: string;
                reserved: string;
            }[];
            enabled: boolean;
            policySource: string;
            providerSource: string;
            /** @enum {string} */
            recipientStatus: "absent" | "onboarding" | "ready" | "restricted";
        };
        IssueRefundRequest: {
            amountMinor: string;
            /** @enum {string} */
            currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
            /** Format: uuid */
            paymentId: string;
            /** @enum {string} */
            reasonCode: "duplicate_charge" | "not_delivered" | "operator_correction" | "dispute_resolution";
        };
        PayoutOnboardingResponse: {
            /** Format: uri */
            onboardingUrl: string;
            /** @enum {string} */
            recipientStatus: "absent" | "onboarding" | "ready" | "restricted";
        };
        PayoutResponse: {
            payout: {
                amount: {
                    amountMinor: string;
                    /** @enum {string} */
                    currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                };
                /** Format: date-time */
                createdAt: string;
                /** @enum {string} */
                failureReason?: "recipient_not_ready" | "declined" | "provider_error";
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                state: "requested" | "reserved" | "submitted" | "paid" | "failed" | "cancelled" | "reversed";
                /** Format: date-time */
                updatedAt: string;
            };
        };
        RequestPayoutRequest: {
            amountMinor: string;
            /** @enum {string} */
            currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
        };
        ProviderEventAcknowledgement: {
            /** @constant */
            received: true;
        };
        RefundResponse: {
            refund: {
                amount: {
                    amountMinor: string;
                    /** @enum {string} */
                    currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                };
                /** Format: date-time */
                createdAt: string;
                /** @enum {string} */
                failureReason?: "declined" | "provider_error";
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                paymentId: string;
                /** @enum {string} */
                reasonCode: "duplicate_charge" | "not_delivered" | "operator_correction" | "dispute_resolution";
                /** @enum {string} */
                state: "requested" | "provider_pending" | "succeeded" | "failed" | "reconciliation_pending";
                /** Format: date-time */
                updatedAt: string;
            };
        };
        StartCheckoutRequest: {
            /** @enum {string} */
            currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
            /** Format: uuid */
            offerId: string;
        };
        CommercialOfferLifecycleRequest: {
            /** Format: uuid */
            offerId: string;
            /** @enum {string} */
            state: "active" | "retired";
            version: number;
        };
        CommercialOfferListResponse: {
            nextCursor?: string;
            offers: {
                /** Format: date-time */
                activatedAt?: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                mode: "subscription" | "one_time";
                prices: {
                    amount: {
                        amountMinor: string;
                        /** @enum {string} */
                        currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                    };
                    /** Format: date-time */
                    createdAt: string;
                    /** Format: date-time */
                    effectiveFrom: string;
                    /** Format: uuid */
                    id: string;
                    /** @enum {string} */
                    interval?: "month" | "year";
                    /** Format: date-time */
                    retiredAt?: string;
                    /** @enum {string} */
                    state: "active" | "retired";
                }[];
                /** Format: uuid */
                resourceId: string;
                /** @enum {string} */
                resourceType: "club";
                /** Format: date-time */
                retiredAt?: string;
                /** @enum {string} */
                state: "draft" | "active" | "retired";
                /** Format: date-time */
                updatedAt: string;
                version: number;
            }[];
            readiness: {
                currencies: ("AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR")[];
                enabled: boolean;
                intervals: ("month" | "year")[];
                modes: ("subscription" | "one_time")[];
                source: string;
            };
        };
        CommercialOfferResponse: {
            offer: {
                /** Format: date-time */
                activatedAt?: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                mode: "subscription" | "one_time";
                prices: {
                    amount: {
                        amountMinor: string;
                        /** @enum {string} */
                        currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                    };
                    /** Format: date-time */
                    createdAt: string;
                    /** Format: date-time */
                    effectiveFrom: string;
                    /** Format: uuid */
                    id: string;
                    /** @enum {string} */
                    interval?: "month" | "year";
                    /** Format: date-time */
                    retiredAt?: string;
                    /** @enum {string} */
                    state: "active" | "retired";
                }[];
                /** Format: uuid */
                resourceId: string;
                /** @enum {string} */
                resourceType: "club";
                /** Format: date-time */
                retiredAt?: string;
                /** @enum {string} */
                state: "draft" | "active" | "retired";
                /** Format: date-time */
                updatedAt: string;
                version: number;
            };
        };
        CreateCommercialOfferRequest: {
            /** @enum {string} */
            mode: "subscription" | "one_time";
            /** Format: uuid */
            resourceId: string;
            /** @enum {string} */
            resourceType: "club";
        };
        PublishCommercialPriceRequest: {
            amountMinor: string;
            /** @enum {string} */
            currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
            /** @enum {string} */
            interval?: "month" | "year";
            /** Format: uuid */
            offerId: string;
        };
        RetireCommercialPriceRequest: {
            /** Format: uuid */
            offerId: string;
            /** Format: uuid */
            priceId: string;
        };
        AdminCreatorListResponse: {
            creators: {
                /** Format: date-time */
                activatedAt?: string;
                /** Format: date-time */
                createdAt: string;
                handle?: string;
                /** Format: uuid */
                id: string;
                profilePublished: boolean;
                /** @enum {string} */
                status: "applicant" | "active" | "suspended" | "closed";
                statusReason?: string;
                /** Format: date-time */
                suspendedAt?: string;
            }[];
            nextCursor?: string;
        };
        AdminFinancialStateResponse: {
            capabilities: {
                commerceEligibility: string;
                commercePolicy: string;
                paymentProvider: string;
                payoutPolicy: string;
                payoutProvider: string;
                taxAuthority: string;
            };
            disputes: {
                count: number;
                state: string;
            }[];
            openDisputeTotals: {
                amountMinor: string;
                /** @enum {string} */
                currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
            }[];
            payableTotals: {
                amountMinor: string;
                /** @enum {string} */
                currency: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
            }[];
            payments: {
                count: number;
                state: string;
            }[];
            payouts: {
                count: number;
                state: string;
            }[];
            reconciliation: {
                count: number;
                state: string;
            }[];
            refunds: {
                count: number;
                state: string;
            }[];
            subscriptions: {
                count: number;
                state: string;
            }[];
        };
        AdminOperationResponse: {
            creator: {
                /** Format: date-time */
                activatedAt?: string;
                /** Format: date-time */
                createdAt: string;
                handle?: string;
                /** Format: uuid */
                id: string;
                profilePublished: boolean;
                /** @enum {string} */
                status: "applicant" | "active" | "suspended" | "closed";
                statusReason?: string;
                /** Format: date-time */
                suspendedAt?: string;
            };
            /** @enum {string} */
            disposition: "restrict" | "lift";
            /** Format: uuid */
            enforcementId: string;
            /** @enum {string} */
            reasonCode: "underage_risk" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "platform_integrity";
            /** Format: date-time */
            recordedAt: string;
            /** @enum {string} */
            scope: "account_restriction" | "conversation_closure" | "creator_suspension" | "creator_object_removal" | "club_membership_revocation";
        };
        AdminReinstateCreatorRequest: {
            /** Format: uuid */
            creatorId: string;
            /** @enum {string} */
            reasonCode: "underage_risk" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "platform_integrity";
        };
        AdminRemoveObjectRequest: {
            /** Format: uuid */
            creatorId: string;
            /** Format: uuid */
            objectId?: string;
            /** @enum {string} */
            objectType: "creator_profile" | "creator_content" | "club";
            /** @enum {string} */
            reasonCode: "underage_risk" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "platform_integrity";
        };
        AdminRevokeMembershipRequest: {
            /** Format: uuid */
            creatorId: string;
            /** Format: uuid */
            membershipId: string;
            /** @enum {string} */
            reasonCode: "underage_risk" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "platform_integrity";
        };
        AdminSuspendCreatorRequest: {
            /** Format: uuid */
            creatorId: string;
            /** @enum {string} */
            reasonCode: "underage_risk" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "platform_integrity";
        };
        ModerationAppealListResponse: {
            appeals: {
                /** @enum {string} */
                appellantKind: "subject" | "notifier";
                /** Format: uuid */
                decisionId: string;
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                outcomeDecisionId?: string;
                /** @enum {string} */
                state: "received" | "under_review" | "upheld" | "refused" | "withdrawn";
                /** Format: date-time */
                submittedAt: string;
                version: number;
                /** Format: date-time */
                windowClosesAt?: string;
            }[];
        };
        ModerationAppealOutcomeRequest: {
            /** Format: uuid */
            appealId: string;
            expectedVersion: number;
            /** @enum {string} */
            outcome: "upheld" | "refused";
            /** Format: uuid */
            outcomeDecisionId?: string;
        };
        ModerationAppealResponse: {
            appeal: {
                /** @enum {string} */
                appellantKind: "subject" | "notifier";
                /** Format: uuid */
                decisionId: string;
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                outcomeDecisionId?: string;
                /** @enum {string} */
                state: "received" | "under_review" | "upheld" | "refused" | "withdrawn";
                /** Format: date-time */
                submittedAt: string;
                version: number;
                /** Format: date-time */
                windowClosesAt?: string;
            };
        };
        ModerationCaseDetailResponse: {
            case: {
                assigned: boolean;
                /** Format: date-time */
                assignmentExpiresAt?: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                openedAt: string;
                policyVersion: string;
                /** @enum {string} */
                priority: "untriaged" | "low" | "normal" | "high" | "urgent";
                /** @enum {string} */
                queue: "consumer_conduct" | "creator_content" | "creator_identity";
                /** @enum {string} */
                state: "new" | "triaged" | "investigating" | "decided" | "closed";
                /** Format: uuid */
                targetId: string;
                /** @enum {string} */
                targetType: "consumer_account" | "creator_profile" | "creator_content" | "club" | "conversation";
                version: number;
            };
            decisions: {
                action: string;
                /** Format: date-time */
                decidedAt: string;
                /** Format: uuid */
                enforcementId?: string;
                evidenceIds: string[];
                /** Format: date-time */
                expiresAt?: string;
                /** Format: uuid */
                id: string;
                policyVersion: string;
                priorState?: string;
                reasonCode: string;
                resultingState?: string;
                /** @enum {string} */
                scope?: "account_restriction" | "conversation_closure" | "creator_suspension" | "creator_object_removal" | "club_membership_revocation";
                /** Format: uuid */
                supersedesId?: string;
            }[];
            evidence: {
                /** Format: uuid */
                id: string;
                kind: string;
                note?: string;
                /** Format: date-time */
                observedAt?: string;
                /** Format: date-time */
                recordedAt: string;
                /** Format: uuid */
                referenceId?: string;
                referenceType?: string;
                stateLabel?: string;
            }[];
            reports: {
                /** Format: date-time */
                createdAt: string;
                detail?: string;
                /** Format: uuid */
                id: string;
                reasonCode: string;
                sourceSurface?: string;
                state: string;
                /** @enum {string} */
                targetType: "consumer_account" | "creator_profile" | "creator_content" | "club" | "conversation";
            }[];
            truncated: boolean;
        };
        ModerationCaseListResponse: {
            cases: {
                assigned: boolean;
                /** Format: date-time */
                assignmentExpiresAt?: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                openedAt: string;
                policyVersion: string;
                /** @enum {string} */
                priority: "untriaged" | "low" | "normal" | "high" | "urgent";
                /** @enum {string} */
                queue: "consumer_conduct" | "creator_content" | "creator_identity";
                /** @enum {string} */
                state: "new" | "triaged" | "investigating" | "decided" | "closed";
                /** Format: uuid */
                targetId: string;
                /** @enum {string} */
                targetType: "consumer_account" | "creator_profile" | "creator_content" | "club" | "conversation";
                version: number;
            }[];
            nextCursor?: string;
        };
        ModerationCaseRequest: {
            /** Format: uuid */
            caseId: string;
        };
        ModerationCaseResponse: {
            case: {
                assigned: boolean;
                /** Format: date-time */
                assignmentExpiresAt?: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                openedAt: string;
                policyVersion: string;
                /** @enum {string} */
                priority: "untriaged" | "low" | "normal" | "high" | "urgent";
                /** @enum {string} */
                queue: "consumer_conduct" | "creator_content" | "creator_identity";
                /** @enum {string} */
                state: "new" | "triaged" | "investigating" | "decided" | "closed";
                /** Format: uuid */
                targetId: string;
                /** @enum {string} */
                targetType: "consumer_account" | "creator_profile" | "creator_content" | "club" | "conversation";
                version: number;
            };
        };
        ModerationDecisionRequest: {
            /** @enum {string} */
            action: "no_action" | "temporary_hold" | "unpublish" | "restrict_capability" | "revoke_restriction" | "escalate";
            /** Format: uuid */
            caseId: string;
            evidenceIds: string[];
            expectedVersion: number;
            /** Format: date-time */
            expiresAt?: string;
            /** @enum {string} */
            priority?: "untriaged" | "low" | "normal" | "high" | "urgent";
            /** @enum {string} */
            reasonCode: "underage_risk" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "platform_integrity" | "no_violation_found" | "insufficient_evidence" | "requires_specialist_review";
            /** @enum {string} */
            scope?: "account_restriction" | "conversation_closure" | "creator_suspension" | "creator_object_removal" | "club_membership_revocation";
            /** Format: uuid */
            supersedesDecisionId?: string;
            /** Format: uuid */
            targetConversationId?: string;
        };
        ModerationDecisionResponse: {
            decision: {
                action: string;
                /** Format: date-time */
                decidedAt: string;
                /** Format: uuid */
                enforcementId?: string;
                evidenceIds: string[];
                /** Format: date-time */
                expiresAt?: string;
                /** Format: uuid */
                id: string;
                policyVersion: string;
                priorState?: string;
                reasonCode: string;
                resultingState?: string;
                /** @enum {string} */
                scope?: "account_restriction" | "conversation_closure" | "creator_suspension" | "creator_object_removal" | "club_membership_revocation";
                /** Format: uuid */
                supersedesId?: string;
            };
        };
        ModerationNoteRequest: {
            /** Format: uuid */
            caseId: string;
            note: string;
        };
        ModerationTriageRequest: {
            /** Format: uuid */
            caseId: string;
            /** @enum {string} */
            priority: "untriaged" | "low" | "normal" | "high" | "urgent";
            /** @enum {string} */
            state: "triaged" | "investigating";
        };
        ClubAccessListResponse: {
            access: {
                /** Format: uuid */
                clubId: string;
                clubName: string;
                creatorHandle: string;
                /** Format: date-time */
                grantedAt: string;
                /** @enum {string} */
                source: "creator_invite" | "admin_grant" | "billing";
            }[];
        };
        ClubInviteIssuedResponse: {
            invite: {
                /** Format: uuid */
                clubId: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                expiresAt: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                redeemedAt?: string;
                /** Format: date-time */
                revokedAt?: string;
            };
            secret: string;
        };
        ClubInviteListResponse: {
            invites: {
                /** Format: uuid */
                clubId: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: date-time */
                expiresAt: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                redeemedAt?: string;
                /** Format: date-time */
                revokedAt?: string;
            }[];
        };
        ClubLifecycleRequest: {
            /** Format: uuid */
            clubId: string;
            /** @enum {string} */
            lifecycle: "draft" | "published" | "closed";
            version: number;
        };
        ClubMembershipListResponse: {
            memberships: {
                /** Format: uuid */
                clubId: string;
                /** Format: date-time */
                grantedAt: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                revokedAt?: string;
                /** @enum {string} */
                source: "creator_invite" | "admin_grant" | "billing";
                /** @enum {string} */
                state: "active" | "revoked";
            }[];
            nextCursor?: string;
        };
        CreatorClubListResponse: {
            clubs: {
                /** Format: date-time */
                createdAt: string;
                description?: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                lifecycle: "draft" | "published" | "closed";
                memberCount: number;
                name: string;
                /** Format: date-time */
                publishedAt?: string;
                slug: string;
                /** Format: date-time */
                updatedAt: string;
                version: number;
            }[];
            nextCursor?: string;
        };
        CreatorContentLifecycleRequest: {
            /** Format: uuid */
            contentId: string;
            /** @enum {string} */
            lifecycle: "draft" | "published" | "archived";
            version: number;
        };
        IssueClubInviteRequest: {
            /** Format: uuid */
            clubId: string;
        };
        PublicClubListResponse: {
            clubs: {
                description?: string;
                name: string;
                slug: string;
            }[];
            handle: string;
        };
        RedeemClubInviteRequest: {
            secret: string;
        };
        RevokeClubInviteRequest: {
            /** Format: uuid */
            inviteId: string;
        };
        RevokeClubMembershipRequest: {
            /** Format: uuid */
            membershipId: string;
        };
        SaveCreatorClubRequest: {
            /** Format: uuid */
            clubId?: string;
            description?: string;
            name: string;
            slug: string;
            version?: number;
        };
        CreatorContentListResponse: {
            content: {
                /** Format: date-time */
                archivedAt?: string;
                body?: string;
                /** Format: uuid */
                clubId?: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                lifecycle: "draft" | "published" | "archived";
                /** Format: date-time */
                publishedAt?: string;
                summary?: string;
                title: string;
                /** Format: date-time */
                updatedAt: string;
                version: number;
                /** @enum {string} */
                visibility: "public" | "members_only";
            }[];
            nextCursor?: string;
        };
        CreatorProfilePublicationRequest: {
            /** @enum {string} */
            publication: "draft" | "published";
            version: number;
        };
        PublicCreatorCatalogResponse: {
            content: {
                body?: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                publishedAt: string;
                summary?: string;
                title: string;
            }[];
            handle: string;
            nextCursor?: string;
        };
        SaveCreatorContentRequest: {
            body?: string;
            /** Format: uuid */
            clubId?: string;
            /** Format: uuid */
            contentId?: string;
            summary?: string;
            title: string;
            version?: number;
            /** @enum {string} */
            visibility: "public" | "members_only";
        };
        CreatorProfileResponse: {
            bio?: string;
            displayName: string;
            handle: string;
            links: {
                label?: string;
                url: string;
            }[];
            /** @enum {string} */
            publication: "draft" | "published";
            /** Format: date-time */
            publishedAt?: string;
            publicPath: string;
            /** Format: date-time */
            updatedAt: string;
            version: number;
        };
        PublicCreatorResponse: {
            bio?: string;
            displayName: string;
            handle: string;
            links: {
                label?: string;
                url: string;
            }[];
            /** Format: date-time */
            publishedAt: string;
        };
        SaveCreatorProfileRequest: {
            bio?: string;
            displayName: string;
            handle: string;
            links?: {
                label?: string;
                url: string;
            }[];
            version?: number;
        };
        OnboardingStateResponse: {
            account: {
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                locale?: string;
                region?: string;
                /** @enum {string} */
                status: "pending_profile" | "active" | "restricted" | "deletion_pending" | "deactivated" | "erased";
                /** @enum {string} */
                statusReason?: "onboarding_incomplete" | "eligibility_failed" | "safety_enforcement" | "user_requested";
            };
            /** @enum {string} */
            adultAssurance: "none" | "self_declared" | "verified_adult";
            adultAssuranceRefused: boolean;
            outstandingPolicies: {
                /** @enum {string} */
                key: "terms_of_service" | "privacy_notice";
                version: string;
            }[];
            outstandingProfile: ("display_name" | "language" | "ready_media" | "region")[];
            /** @enum {string} */
            step: "adult_declaration" | "policy_acknowledgement" | "profile" | "completed";
        };
        PolicyAcknowledgementRequest: {
            acknowledgements: {
                /** @enum {string} */
                key: "terms_of_service" | "privacy_notice";
                version: string;
            }[];
        };
        AvailabilityResponse: {
            /** Format: date-time */
            availableUntil?: string;
            /** @enum {string} */
            effectiveState: "available" | "unavailable";
            /** @enum {string} */
            state: "available" | "unavailable";
            /** Format: date-time */
            updatedAt: string;
        };
        DiscoveryFeedResponse: {
            candidates: {
                bio?: string;
                displayName: string;
                /** Format: uuid */
                id: string;
                media: {
                    /** Format: uuid */
                    id: string;
                    position: number;
                }[];
                region?: string;
                sharedLanguages: string[];
            }[];
            nextCursor?: string;
            rankingVersion: string;
        };
        DiscoveryPassRequest: {
            /** Format: uuid */
            candidateId: string;
        };
        DiscoveryPassResponse: {
            /** Format: date-time */
            suppressedUntil: string;
        };
        CreateIntroductionRequest: {
            /** Format: uuid */
            candidateId: string;
        };
        Introduction: {
            counterpart: {
                bio?: string;
                displayName: string;
                /** Format: uuid */
                id: string;
                media: {
                    /** Format: uuid */
                    id: string;
                    position: number;
                }[];
                region?: string;
                sharedLanguages: string[];
            };
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            mutualAt?: string;
            /** @enum {string} */
            role: "initiator" | "recipient";
            /** @enum {string} */
            state: "pending" | "mutual" | "closed";
        };
        IntroductionListResponse: {
            introductions: {
                counterpart: {
                    bio?: string;
                    displayName: string;
                    /** Format: uuid */
                    id: string;
                    media: {
                        /** Format: uuid */
                        id: string;
                        position: number;
                    }[];
                    region?: string;
                    sharedLanguages: string[];
                };
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                mutualAt?: string;
                /** @enum {string} */
                role: "initiator" | "recipient";
                /** @enum {string} */
                state: "pending" | "mutual" | "closed";
            }[];
            nextCursor?: string;
        };
        IntroductionReferenceRequest: {
            /** Format: uuid */
            introductionId: string;
        };
        Conversation: {
            counterpart: {
                displayName: string;
                /** Format: uuid */
                id: string;
                media: {
                    /** Format: uuid */
                    id: string;
                    position: number;
                }[];
            };
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            lastActivityAt: string;
            lastMessageSequence: number;
            lastReadSequence: number;
            /** @enum {string} */
            state: "active" | "closed";
        };
        ConversationListResponse: {
            conversations: {
                counterpart: {
                    displayName: string;
                    /** Format: uuid */
                    id: string;
                    media: {
                        /** Format: uuid */
                        id: string;
                        position: number;
                    }[];
                };
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** Format: date-time */
                lastActivityAt: string;
                lastMessageSequence: number;
                lastReadSequence: number;
                /** @enum {string} */
                state: "active" | "closed";
            }[];
            nextCursor?: string;
        };
        ConversationReadResponse: {
            /** Format: uuid */
            conversationId: string;
            lastReadSequence: number;
        };
        CreateConversationRequest: {
            /** Format: uuid */
            introductionId: string;
        };
        MarkConversationReadRequest: {
            /** Format: uuid */
            conversationId: string;
            sequence: number;
        };
        Message: {
            body: string;
            clientMessageId: string;
            /** Format: uuid */
            conversationId: string;
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            senderId: string;
            sequence: number;
        };
        MessageListResponse: {
            /** Format: uuid */
            conversationId: string;
            messages: {
                body: string;
                clientMessageId: string;
                /** Format: uuid */
                conversationId: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                senderId: string;
                sequence: number;
            }[];
            nextCursor?: string;
        };
        SendMessageRequest: {
            body: string;
            clientMessageId: string;
            /** Format: uuid */
            conversationId: string;
        };
        MarkNotificationsReadRequest: {
            notificationIds: string[];
        };
        NotificationListResponse: {
            notifications: {
                /** Format: uuid */
                conversationId?: string;
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** Format: uuid */
                introductionId?: string;
                /** @enum {string} */
                kind: "message_received" | "introduction_mutual";
                /** Format: date-time */
                readAt?: string;
                /** Format: uuid */
                subjectId: string;
            }[];
            nextCursor?: string;
        };
        NotificationReadResponse: {
            readIds: string[];
        };
        Block: {
            /** Format: uuid */
            blockedId: string;
            /** Format: date-time */
            createdAt: string;
        };
        BlockListResponse: {
            blocks: {
                /** Format: uuid */
                blockedId: string;
                /** Format: date-time */
                createdAt: string;
            }[];
            nextCursor?: string;
        };
        BlockRequest: {
            /** Format: uuid */
            targetId: string;
        };
        CreateReportRequest: {
            clientReportId: string;
            /** Format: uuid */
            conversationId?: string;
            detail?: string;
            /** Format: uuid */
            messageId?: string;
            /** @enum {string} */
            reasonCode: "underage_concern" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "other";
            target: {
                /** Format: uuid */
                accountId: string;
                /** @constant */
                type: "consumer_account";
            } | {
                handle: string;
                /** @constant */
                type: "creator_profile";
            } | {
                /** Format: uuid */
                contentId: string;
                /** @constant */
                type: "creator_content";
            } | {
                handle: string;
                slug: string;
                /** @constant */
                type: "club";
            } | {
                /** Format: uuid */
                conversationId: string;
                /** @constant */
                type: "conversation";
            };
        };
        Report: {
            /** Format: date-time */
            createdAt: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            reasonCode: "underage_concern" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "other";
            /** @enum {string} */
            state: "received" | "under_review" | "actioned" | "dismissed";
            /** @enum {string} */
            targetType: "consumer_account" | "creator_profile" | "creator_content" | "club" | "conversation";
        };
        ReportListResponse: {
            nextCursor?: string;
            reports: {
                /** Format: date-time */
                createdAt: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                reasonCode: "underage_concern" | "harassment" | "sexual_content_violation" | "impersonation" | "spam_or_scam" | "other";
                /** @enum {string} */
                state: "received" | "under_review" | "actioned" | "dismissed";
                /** @enum {string} */
                targetType: "consumer_account" | "creator_profile" | "creator_content" | "club" | "conversation";
            }[];
        };
        Appeal: {
            /** Format: uuid */
            decisionId: string;
            /** Format: uuid */
            id: string;
            /** @enum {string} */
            state: "received" | "under_review" | "upheld" | "refused" | "withdrawn";
            /** Format: date-time */
            submittedAt: string;
            /** Format: date-time */
            windowClosesAt?: string;
        };
        AppealListResponse: {
            appeals: {
                /** Format: uuid */
                decisionId: string;
                /** Format: uuid */
                id: string;
                /** @enum {string} */
                state: "received" | "under_review" | "upheld" | "refused" | "withdrawn";
                /** Format: date-time */
                submittedAt: string;
                /** Format: date-time */
                windowClosesAt?: string;
            }[];
        };
        CreateAppealRequest: {
            /** Format: uuid */
            decisionId: string;
            statement?: string;
        };
        CreatorMatureReadinessResponse: {
            blockers: ("mature_content_capability_disabled" | "depicted_person_verifier_unavailable" | "consent_wording_unpublished" | "content_taxonomy_undecided")[];
            consentPolicySource: string;
            enabled: boolean;
            matureContentSource: string;
            surfaces: {
                eligible: boolean;
                /** @enum {string} */
                surface: "web" | "mobile_ios" | "mobile_android" | "creator_studio" | "platform_admin";
            }[];
            verifierSource: string;
        };
        SafetyStandingResponse: {
            statements: {
                appealable: boolean;
                /** Format: date-time */
                appealWindowClosesAt?: string;
                /** Format: date-time */
                decidedAt: string;
                /** Format: uuid */
                decisionId: string;
                /** @enum {string} */
                reasonCode: "account_restricted" | "creator_capability_suspended" | "conversation_closed" | "object_restricted";
                /** @enum {string} */
                scope: "account_restriction" | "conversation_closure" | "creator_suspension" | "creator_object_removal" | "club_membership_revocation";
            }[];
        };
        WithdrawAppealRequest: {
            /** Format: uuid */
            appealId: string;
        };
        ProfileMediaReferenceRequest: {
            /** Format: uuid */
            mediaId: string;
        };
        SaveAvailabilityRequest: {
            /** Format: date-time */
            availableUntil?: string;
            /** @enum {string} */
            state: "available" | "unavailable";
        };
        ProfileMediaUploadResponse: {
            /** Format: date-time */
            expiresAt: string;
            /** @constant */
            maximumBytes: 8388608;
            /** Format: uuid */
            mediaId: string;
            /** @constant */
            method: "PUT";
            uploadHeaders: {
                [key: string]: string;
            };
            /** Format: uri */
            uploadUrl: string;
        };
        ProfileResponse: {
            bio?: string;
            complete: boolean;
            discoverable: boolean;
            displayName?: string;
            languages: string[];
            media: {
                /** Format: uuid */
                id: string;
                position: number;
                /** @enum {string} */
                rejectionReason?: "unsupported_type" | "too_large" | "not_uploaded" | "content_rejected";
                /** @enum {string} */
                state: "pending_upload" | "checking" | "preparing" | "ready" | "rejected" | "removed";
                /** Format: date-time */
                uploadExpiresAt?: string;
            }[];
            outstandingRequirements: ("display_name" | "language" | "ready_media" | "region")[];
            preferencesVersion?: number;
            region?: string;
            version?: number;
        };
        SavePreferencesRequest: {
            discoverable: boolean;
            expectedVersion?: number;
        };
        SaveProfileRequest: {
            bio?: string;
            displayName: string;
            expectedVersion?: number;
            languages: string[];
        };
        AuthAcknowledgement: {
            /** @enum {string} */
            status: "accepted" | "revoked";
        };
        AuthSessionResponse: {
            /** Format: date-time */
            absoluteExpiresAt: string;
            /** Format: uuid */
            accountId: string;
            /** @enum {string} */
            assurance: "single_factor" | "multi_factor" | "phishing_resistant";
            /** Format: date-time */
            assuranceEstablishedAt: string;
            /** @enum {string} */
            audience: "consumer_web" | "creator_studio" | "consumer_mobile" | "platform_admin";
            /** Format: date-time */
            authenticatedAt: string;
            csrfToken?: string;
            /** Format: date-time */
            idleExpiresAt: string;
        };
        LivenessResponse: {
            /** @constant */
            status: "ok";
        };
        LocalMobileSessionRequest: {
            deviceId?: string;
            installationId: string;
            subject: string;
        };
        LocalWebSessionRequest: {
            /** @enum {string} */
            audience: "consumer_web" | "creator_studio";
            deviceId?: string;
            subject: string;
        };
        MobileRefreshRequest: {
            refreshToken: string;
        };
        MobileTokenResponse: {
            accessToken: string;
            /** Format: date-time */
            accessTokenExpiresAt: string;
            /** Format: uuid */
            accountId: string;
            /** @enum {string} */
            assurance: "single_factor" | "multi_factor" | "phishing_resistant";
            /** @constant */
            audience: "consumer_mobile";
            refreshToken: string;
            /** Format: date-time */
            refreshTokenAbsoluteExpiresAt: string;
            /** Format: date-time */
            refreshTokenIdleExpiresAt: string;
        };
        ReadinessResponse: {
            dependencies: {
                /** @enum {string} */
                ephemeralRedis: "up" | "down";
                /** @enum {string} */
                postgres: "up" | "down";
                /** @enum {string} */
                queueRedis: "up" | "down";
            };
            /** @enum {string} */
            status: "ready" | "unavailable";
        };
        RecoveryCompletionRequest: {
            deviceId?: string;
            token: string;
        };
        RecoveryStartRequest: {
            /** @constant */
            channel: "email";
            deviceId?: string;
            subject: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getLiveness: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Process is alive */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LivenessResponse"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getReadiness: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dependencies are ready */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadinessResponse"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A required dependency is unavailable */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadinessResponse"];
                };
            };
        };
    };
    createLocalWebSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-device */
                "x-velora-device"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocalWebSessionRequest"];
            };
        };
        responses: {
            /** @description A browser session was established and its audience-scoped cookie was set */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthSessionResponse"];
                };
            };
            /** @description The browser origin, Fetch Metadata, or CSRF evidence for this state-changing request was rejected, or the requested identity adapter is not enabled. The body is an ApiError. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Too many attempts from this caller. The body is an ApiError with code AUTH_RATE_LIMITED. */
            429: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createLocalMobileSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-device */
                "x-velora-device"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LocalMobileSessionRequest"];
            };
        };
        responses: {
            /** @description An access token and a new refresh family were issued */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MobileTokenResponse"];
                };
            };
            /** @description The browser origin, Fetch Metadata, or CSRF evidence for this state-changing request was rejected, or the requested identity adapter is not enabled. The body is an ApiError. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Too many attempts from this caller. The body is an ApiError with code AUTH_RATE_LIMITED. */
            429: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAuthSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The server-derived authentication context for the caller */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthSessionResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    refreshMobileSession: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MobileRefreshRequest"];
            };
        };
        responses: {
            /** @description The presented refresh token was consumed and its successor issued */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MobileTokenResponse"];
                };
            };
            /** @description The refresh token is unknown, expired, already rotated, or its family is revoked, and a token that was already rotated additionally revokes its family. The body is an ApiError with code AUTH_REFRESH_INVALID. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Too many attempts from this caller. The body is an ApiError with code AUTH_RATE_LIMITED. */
            429: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-csrf */
                "x-velora-csrf"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The current authority is revoked. The operation is idempotent and succeeds when there is nothing to revoke. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthAcknowledgement"];
                };
            };
            /** @description The browser origin, Fetch Metadata, or CSRF evidence for this state-changing request was rejected, or the requested identity adapter is not enabled. The body is an ApiError. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    logoutAll: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-csrf */
                "x-velora-csrf"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every browser session and refresh family for the account is revoked */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthAcknowledgement"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin, Fetch Metadata, or CSRF evidence for this state-changing request was rejected, or the requested identity adapter is not enabled. The body is an ApiError. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    startAccountRecovery: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-device */
                "x-velora-device"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecoveryStartRequest"];
            };
        };
        responses: {
            /** @description The request was accepted. The response is identical whether or not an account exists. */
            202: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthAcknowledgement"];
                };
            };
            /** @description The browser origin, Fetch Metadata, or CSRF evidence for this state-changing request was rejected, or the requested identity adapter is not enabled. The body is an ApiError. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Too many attempts from this caller. The body is an ApiError with code AUTH_RATE_LIMITED. */
            429: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    completeAccountRecovery: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-device */
                "x-velora-device"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RecoveryCompletionRequest"];
            };
        };
        responses: {
            /** @description Recovery completed. Prior authority is revoked and a new Consumer Web session was established. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthSessionResponse"];
                };
            };
            /** @description The recovery token is unknown, expired, or already consumed. The body is an ApiError with code AUTH_RECOVERY_INVALID. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The request was rejected by browser origin policy, or the recovery is high risk and requires a second independent signal or reviewed handling. The body is an ApiError. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Too many attempts from this caller. The body is an ApiError with code AUTH_RATE_LIMITED. */
            429: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createConsumerAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateConsumerAccountRequest"];
            };
        };
        responses: {
            /** @description A consumer account already existed for the caller and was returned unchanged. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsumerAccountResponse"];
                };
            };
            /** @description A consumer account was created for the caller. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsumerAccountResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getConsumerAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own consumer account. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsumerAccountResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getConsumerOnboarding: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's admission state, derived from stored evidence rather than from any client-supplied step. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingStateResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    declareAdult: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdultDeclarationRequest"];
            };
        };
        responses: {
            /** @description The declaration was recorded and the resulting admission state is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingStateResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The account declared that it is not an adult, or is otherwise not eligible to continue. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. The declaration is recorded either way. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    acknowledgeConsumerPolicies: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PolicyAcknowledgementRequest"];
            };
        };
        responses: {
            /** @description Acknowledgement evidence was recorded and the resulting admission state is returned. Re-acknowledging a version already held changes nothing. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingStateResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description An earlier admission step is outstanding, or a version was submitted that is not the one currently required. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getConsumerProfile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own profile, its images, and what the minimum discoverable profile still lacks. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    saveConsumerProfile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveProfileRequest"];
            };
        };
        responses: {
            /** @description The profile was created or updated and is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, or the addressed object is no longer in a state that allows this. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    saveConsumerPreferences: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SavePreferencesRequest"];
            };
        };
        responses: {
            /** @description The preference was recorded and the profile is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The account has not reached the profile step of admission, or is in a lifecycle state that does not permit profile edits, or asked to become discoverable without a complete minimum profile. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createConsumerProfileMediaUpload: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A slot was reserved and a short-lived, object-bound upload capability was issued. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileMediaUploadResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The account may not edit its profile, or already holds the maximum number of images. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or LIMIT_REACHED. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved media storage provider is configured for this environment, so the object could not be stored or inspected. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    completeConsumerProfileMediaUpload: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileMediaReferenceRequest"];
            };
        };
        responses: {
            /** @description The stored object was inspected and the image is now ready or rejected. The resulting profile is returned either way. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, or the addressed object is no longer in a state that allows this. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved media storage provider is configured for this environment, so the object could not be stored or inspected. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    removeConsumerProfileMedia: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProfileMediaReferenceRequest"];
            };
        };
        responses: {
            /** @description The image no longer belongs to the profile. The resulting profile is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, or the addressed object is no longer in a state that allows this. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getConsumerAvailability: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own availability, with an expired window already resolved to unavailable. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AvailabilityResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    saveConsumerAvailability: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveAvailabilityRequest"];
            };
        };
        responses: {
            /** @description Availability was recorded and the resulting state is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AvailabilityResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The account has not reached the profile step of admission, or is in a lifecycle state that does not permit profile edits, or asked to become discoverable without a complete minimum profile. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The body failed contract validation, or the requested window has already closed or is longer than policy allows. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createCreatorAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCreatorAccountRequest"];
            };
        };
        responses: {
            /** @description Creator capability already existed for the caller and was returned unchanged. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorAccountResponse"];
                };
            };
            /** @description Creator capability was established for the caller, as an applicant. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorAccountResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Creator capability may not be established or advanced: the principal has no consumer account, has not declared adult status, or is not in good standing. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. It never says which condition failed — the onboarding state does, and only to the person it describes. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getCreatorAccount: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own creator capability. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorAccountResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getCreatorOnboarding: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description What creator activation still requires, derived from stored evidence. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorOnboardingStateResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    acknowledgeCreatorPolicies: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatorPolicyAcknowledgementRequest"];
            };
        };
        responses: {
            /** @description Acknowledgement evidence was recorded and the resulting activation state is returned. Re-acknowledging a version already held changes nothing. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorOnboardingStateResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The adult gate is unmet, the capability is not in a state that accepts acknowledgement, or a version was submitted that is not the one currently required. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getCreatorProfile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The creator's own profile, including a draft nobody else can see. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    saveCreatorProfile: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveCreatorProfileRequest"];
            };
        };
        responses: {
            /** @description The profile was updated and is returned with a new version. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorProfileResponse"];
                };
            };
            /** @description The profile was created as a draft and the handle was claimed. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    setCreatorProfilePublication: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatorProfilePublicationRequest"];
            };
        };
        responses: {
            /** @description The publication state was set and the profile is returned with a new version. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorProfileResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getPublicCreator: {
        parameters: {
            query?: {
                /** @description Canonical creator handle */
                handle?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The explicitly public projection of a published creator profile. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicCreatorResponse"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listCreatorContent: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum items to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The creator's own catalog, newest first, including drafts and archived items nobody else can see. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorContentListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    saveCreatorContent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveCreatorContentRequest"];
            };
        };
        responses: {
            /** @description The item was updated and is returned with a new version. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorContentListResponse"];
                };
            };
            /** @description The item was created as a draft. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorContentListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    setCreatorContentLifecycle: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreatorContentLifecycleRequest"];
            };
        };
        responses: {
            /** @description The lifecycle transition was applied and the item is returned with a new version. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorContentListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getPublicCreatorCatalog: {
        parameters: {
            query?: {
                /** @description Canonical creator handle */
                handle?: string;
                /** @description Opaque forward-only position in this catalog */
                cursor?: string;
                /** @description Maximum items to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Published public items for an active creator whose profile is published, newest first. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicCreatorCatalogResponse"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listCreatorClubs: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum clubs to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The creator's own clubs with a live member count computed from current entitlements. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorClubListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    saveCreatorClub: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveCreatorClubRequest"];
            };
        };
        responses: {
            /** @description The club was updated and is returned with a new version. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorClubListResponse"];
                };
            };
            /** @description The club was created as a draft, with no members and no public presence. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorClubListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    setCreatorClubLifecycle: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ClubLifecycleRequest"];
            };
        };
        responses: {
            /** @description The club lifecycle transition was applied. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorClubListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listClubInvites: {
        parameters: {
            query?: {
                /** @description Which club */
                clubId?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Invitations for one club, with no secret in any of them. A secret is returned once, when it is created. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClubInviteListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    issueClubInvite: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IssueClubInviteRequest"];
            };
        };
        responses: {
            /** @description A complimentary invitation was created. The secret is in this response and nowhere else. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClubInviteIssuedResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    revokeClubInvite: {
        parameters: {
            query?: {
                /** @description Which club */
                clubId?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevokeClubInviteRequest"];
            };
        };
        responses: {
            /** @description The invitation is withdrawn and can no longer be used. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClubInviteListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listClubMemberships: {
        parameters: {
            query?: {
                /** @description Which club */
                clubId?: string;
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum memberships to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Entitlements to one club, with where each came from and whether it is live. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClubMembershipListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    revokeClubMembership: {
        parameters: {
            query?: {
                /** @description Which club */
                clubId?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RevokeClubMembershipRequest"];
            };
        };
        responses: {
            /** @description The entitlement is withdrawn. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClubMembershipListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    redeemClubInvite: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RedeemClubInviteRequest"];
            };
        };
        responses: {
            /** @description The invitation admitted the caller, and the access they now hold is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClubAccessListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The invitation could not admit the caller. The body is an ApiError with code ACTION_NOT_PERMITTED. It never says which condition failed: an unknown secret, an expired one, one already used, one withdrawn, a club that is not published, a creator who is not active, and an account that may not be admitted are deliberately one answer, because anything finer is an oracle for guessing invitations. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listClubAccess: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every live entitlement the caller holds. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ClubAccessListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getClubContent: {
        parameters: {
            query?: {
                /** @description Which item */
                contentId?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The protected item, because every condition currently permits it. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorContentListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getPublicCreatorClubs: {
        parameters: {
            query?: {
                /** @description Canonical creator handle */
                handle?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Published clubs on a published creator page. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicClubListResponse"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    receiveProviderEvent: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The event was verified and a durable receipt exists. A redelivery is acknowledged identically to a first delivery, because a provider that got a different answer for a repeat would learn which of its events Velora had already seen. Nothing about the business is decided on this request: a worker drains the receipts afterwards. */
            202: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderEventAcknowledgement"];
                };
            };
            /** @description The signature over the raw body did not verify. Nothing was written, nothing was decided, and the refusal is audited. This is also the answer when the payload is malformed after verification, so a caller learns nothing about how close a forged signature was. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listConsumerSubscriptions: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own subscriptions. `past_due` appears and grants nothing: whether a lapsed payment keeps access is grace policy nobody has approved, and the fail-closed reading of an unresolved policy is no access. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConsumerSubscriptionListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    readCheckout: {
        parameters: {
            query?: {
                /** @description Which payment */
                paymentId?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One of the caller's own payments. This is what a provider return URL reads: an ordinary authorized read of server state, with no transition on the path, so arriving at a success URL by hand tells somebody exactly what the platform already believed. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckoutResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    startCheckout: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-idempotency-key */
                "x-velora-idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StartCheckoutRequest"];
            };
        };
        responses: {
            /** @description The payment operation exists. It is committed before any provider is contacted, so a process that dies between the two leaves something reconciliation can resolve rather than a charge nobody has a record of. A redirect URL is present when this call created one and absent on a replay. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CheckoutResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller may not buy this: the account is not in good standing, the offer is not active, no live price exists in the requested currency, or the audience is Consumer Mobile. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. Purchases are Consumer Web only in this milestone. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The same idempotency key was reused for a different purchase. The body is an ApiError with code IDEMPOTENCY_KEY_MISMATCH. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getCreatorEarnings: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Every currency this creator has been paid in, with what was grossed, what the platform kept, what has been returned, what is currently claimed back, and what the platform owes them. One set of figures per currency and never a total: a sum across currencies is a number with no meaning. `payable` is the only authoritative figure — it is a ledger balance derived on read — and the rest are projections over the commercial records that produced it. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorEarningsResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getCreatorEarningsHistory: {
        parameters: {
            query?: {
                /** @description Which currency */
                currency?: "AED" | "AUD" | "BHD" | "BRL" | "CAD" | "CHF" | "CLP" | "CNY" | "COP" | "CZK" | "DKK" | "EUR" | "GBP" | "HKD" | "IDR" | "ILS" | "INR" | "ISK" | "JOD" | "JPY" | "KRW" | "KWD" | "MXN" | "MYR" | "NOK" | "NZD" | "OMR" | "PHP" | "PLN" | "RON" | "SAR" | "SEK" | "SGD" | "THB" | "TND" | "TRY" | "TWD" | "USD" | "VND" | "ZAR";
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum entries to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One currency's commercial history, newest first: captures, reversals, and cardholder claims in one sequence, because reading them apart turns one story into three lists nobody can line up. It carries no consumer identifier, name, or contact detail — who bought something is not the seller's to know. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorEarningsHistoryResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getMatureContentReadiness: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Whether mature creator content is available to this creator, and what stands in the way. It is not available, in any environment, and the blockers say why rather than leaving a creator to assume the remaining work is theirs. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorMatureReadinessResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getPayoutReadiness: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Whether this creator could be paid, and what they hold in each currency. The two refusal reasons are separate fields on purpose: a creator whose provider record is fine but whose platform has published no settlement terms is in a different position from one who has not finished onboarding. `releasable` is what approved terms would let go right now, and it is zero wherever no terms are published. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorPayoutReadinessResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    startPayoutOnboarding: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A link into the payout provider's own hosted onboarding, and what the provider currently says about the record it created. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PayoutOnboardingResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listCreatorPayouts: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description This creator's own payout instructions, newest first. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreatorPayoutHistoryResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    requestPayout: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-idempotency-key */
                "x-velora-idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RequestPayoutRequest"];
            };
        };
        responses: {
            /** @description The instruction exists and its reservation is posted. The reservation is an accounting transaction rather than a lock, so it is visible to every replica that reads the book, and it is committed before any provider is contacted. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PayoutResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The payout could not be made: the provider does not say this recipient can be paid, the amount exceeds what approved terms currently release, or the same idempotency key was reused for a different amount. The body is an ApiError with code STATE_CONFLICT or IDEMPOTENCY_KEY_MISMATCH. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listCommercialOffers: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum offers to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The creator's own commercial offers with their price history, and a readiness statement describing what the platform may currently sell. Readiness is returned whether or not anything is sellable, because a creator is entitled to know that monetisation is unavailable rather than meeting a form that refuses. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommercialOfferListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Creator Studio audience. The body is an ApiError, with code CREATOR_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createCommercialOffer: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateCommercialOfferRequest"];
            };
        };
        responses: {
            /** @description Draft commercial terms were opened against a resource the creator owns. A draft carries no price and nothing can be bought under it. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommercialOfferResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The commercial action is not permitted: the creator may not operate, the resource does not exist or does not belong to them, activation was attempted against a resource that is not published, or the amount, currency, or cadence is outside approved commercial terms. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. It never says which — an offer endpoint that distinguished "no such club" from "not yours" would let one creator enumerate another's catalog. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent change won, the offer is not in a state that allows this, a live offer already covers this resource and mode, or a live price already exists in this currency. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    publishCommercialPrice: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishCommercialPriceRequest"];
            };
        };
        responses: {
            /** @description A price was published against the offer and is frozen from this moment. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommercialOfferResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The commercial action is not permitted: the creator may not operate, the resource does not exist or does not belong to them, activation was attempted against a resource that is not published, or the amount, currency, or cadence is outside approved commercial terms. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. It never says which — an offer endpoint that distinguished "no such club" from "not yours" would let one creator enumerate another's catalog. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent change won, the offer is not in a state that allows this, a live offer already covers this resource and mode, or a live price already exists in this currency. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    retireCommercialPrice: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RetireCommercialPriceRequest"];
            };
        };
        responses: {
            /** @description The price was withdrawn. It is retained in full, and any purchase made under it is unaffected. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommercialOfferResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The commercial action is not permitted: the creator may not operate, the resource does not exist or does not belong to them, activation was attempted against a resource that is not published, or the amount, currency, or cadence is outside approved commercial terms. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. It never says which — an offer endpoint that distinguished "no such club" from "not yours" would let one creator enumerate another's catalog. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent change won, the offer is not in a state that allows this, a live offer already covers this resource and mode, or a live price already exists in this currency. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    setCommercialOfferLifecycle: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CommercialOfferLifecycleRequest"];
            };
        };
        responses: {
            /** @description The offer lifecycle transition was applied. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CommercialOfferResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The commercial action is not permitted: the creator may not operate, the resource does not exist or does not belong to them, activation was attempted against a resource that is not published, or the amount, currency, or cadence is outside approved commercial terms. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. It never says which — an offer endpoint that distinguished "no such club" from "not yours" would let one creator enumerate another's catalog. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent change won, the offer is not in a state that allows this, a live offer already covers this resource and mode, or a live price already exists in this currency. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listAdminCreators: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum creators to return */
                pageSize?: number;
                /** @description Public handle prefix to search for */
                adminSearch?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Creators in operational terms, newest first, bounded and paged. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminCreatorListResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    suspendCreator: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminSuspendCreatorRequest"];
            };
        };
        responses: {
            /** @description The capability is suspended and the enforcement record that says so is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOperationResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    reinstateCreator: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminReinstateCreatorRequest"];
            };
        };
        responses: {
            /** @description The capability is restored and the record is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOperationResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    removeCreatorObject: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminRemoveObjectRequest"];
            };
        };
        responses: {
            /** @description The object is no longer public and the enforcement record is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOperationResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    revokeMembershipAsAdmin: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminRevokeMembershipRequest"];
            };
        };
        responses: {
            /** @description The entitlement is withdrawn and the record is returned. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminOperationResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listModerationCases: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this queue */
                cursor?: string;
                /** @description Maximum cases to return */
                pageSize?: number;
                /** @description Operator queue to read */
                moderationQueue?: "consumer_conduct" | "creator_content" | "creator_identity";
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Open cases, oldest first, bounded and keyset paged. Ordered by when a case was opened rather than by how many reports it carries, because a queue sorted by complaint count is a queue anybody with several accounts can steer. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationCaseListResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getModerationCase: {
        parameters: {
            query?: {
                /** @description Case to read */
                caseId?: string;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description One case with the reports that are evidence in it, everything recorded as evidence, and every decision taken on it in order. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationCaseDetailResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    claimModerationCase: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModerationCaseRequest"];
            };
        };
        responses: {
            /** @description The case is held by the caller and the lease is running. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationCaseResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    triageModerationCase: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModerationTriageRequest"];
            };
        };
        responses: {
            /** @description The reviewer's judgement is recorded and the case moved. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationCaseResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    addModerationNote: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModerationNoteRequest"];
            };
        };
        responses: {
            /** @description The note is recorded as evidence in the case. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationCaseResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    decideModerationCase: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModerationDecisionRequest"];
            };
        };
        responses: {
            /** @description The decision is recorded, any enforcement it produced is applied through the domain that owns what changed, and every still-open report in the case is resolved. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationDecisionResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listModerationAppeals: {
        parameters: {
            query?: {
                /** @description Maximum appeals to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Complaints still owed an answer, oldest first. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationAppealListResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    answerModerationAppeal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModerationAppealOutcomeRequest"];
            };
        };
        responses: {
            /** @description The complaint is answered and the record says by whom. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModerationAppealResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description A concurrent edit won, the capability is not in a state that allows this, the handle is already taken, or a save named a handle other than the one already claimed. The body is an ApiError with code STATE_CONFLICT. The caller should re-read and decide again. The four are deliberately one code: which of them applied would tell a caller whether somebody else holds a handle they cannot see. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getAdminFinancialState: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The platform's money in operational terms: how many operations, reversals, claims, subscriptions, and payout instructions are in each state; what is currently being claimed back and what is still owed to creators, per currency; what needs a person to look at it; and which capability seams are open. Counts and per-currency totals only — no provider reference, no recipient reference, no bank detail, no identity document, and no consumer contact detail. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminFinancialStateResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    issueRefund: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
                /** @description Contract header x-velora-idempotency-key */
                "x-velora-idempotency-key"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IssueRefundRequest"];
            };
        };
        responses: {
            /** @description The refund operation exists. It is committed before the provider is contacted, so a process that dies between the two leaves something reconciliation can resolve rather than a reversal nobody has a record of. A replayed idempotency key answers with the operation it already created. */
            201: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RefundResponse"];
                };
            };
            /** @description No valid session accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, the caller is not a Platform Admin audience, or the operation requires a fresh phishing-resistant assurance the caller does not hold. The body is an ApiError, with code ACTION_NOT_PERMITTED in the audience and step-up cases. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The reversal could not be recorded: the payment did not settle, the currency is not the currency it was captured in, the refunds outstanding against it would exceed what was captured, or the same idempotency key was reused for a different amount. The body is an ApiError with code STATE_CONFLICT or IDEMPOTENCY_KEY_MISMATCH. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No approved commercial terms are published in this environment, so nothing can be made purchasable. The body is an ApiError with code DEPENDENCY_UNAVAILABLE. This is a truthful statement about the platform rather than a client error, and no payment or payout provider is approved either. This status is also the shared capacity refusal, with code SERVICE_UNAVAILABLE; the code tells the two apart. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getDiscoveryCandidates: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this feed */
                cursor?: string;
                /** @description Maximum candidates to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Candidates the caller is currently eligible to see, in the deterministic V1 order. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscoveryFeedResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not eligible to browse: the account is not active, or the minimum discoverable profile is incomplete. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The cursor or page size failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    passDiscoveryCandidate: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DiscoveryPassRequest"];
            };
        };
        responses: {
            /** @description The pair is suppressed from ordinary discovery until the returned instant. Repeating the call renews the window. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscoveryPassResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not eligible to act on candidates. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listIntroductions: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum introductions to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own live introductions, newest first, with the other person in the same minimized shape discovery uses. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IntroductionListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not eligible to act on introductions: the account is not active or the minimum discoverable profile is incomplete. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The cursor or page size failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createIntroductionSignal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateIntroductionRequest"];
            };
        };
        responses: {
            /** @description The signal was recorded. The introduction is mutual when the other person had already signalled, and pending otherwise. Repeating the call returns the same introduction unchanged. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Introduction"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The candidate is not currently introducible by this caller. Absent and not-permitted are deliberately indistinguishable, so nothing is disclosed about another account. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not eligible to act on introductions: the account is not active or the minimum discoverable profile is incomplete. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listConversations: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum conversations to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own conversations, most recently active first. A conversation the caller is no longer permitted to communicate in is absent. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller may not communicate here: the account is not active, the conversation is closed, or current safety eligibility denies the pair. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. Nothing in it says which, or why. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The cursor or page size failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createConversation: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateConversationRequest"];
            };
        };
        responses: {
            /** @description The conversation authorized by that mutual introduction. Repeating the call returns the same conversation rather than creating a second one. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Conversation"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No mutual introduction of the caller matches that identifier. A pending, closed, expired, or someone else’s introduction is indistinguishable from one that does not exist. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller may not communicate here: the account is not active, the conversation is closed, or current safety eligibility denies the pair. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. Nothing in it says which, or why. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listMessages: {
        parameters: {
            query?: {
                /** @description Conversation to read */
                conversationId?: string;
                /** @description Opaque backward position in this conversation */
                cursor?: string;
                /** @description Maximum messages to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Messages in the conversation, newest first. Paging is keyset on the server-assigned sequence, so a page boundary cannot move. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not a participant in that conversation, or it does not exist. The two are deliberately indistinguishable. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller may not communicate here: the account is not active, the conversation is closed, or current safety eligibility denies the pair. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. Nothing in it says which, or why. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The conversation identifier, cursor, or page size failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    sendMessage: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SendMessageRequest"];
            };
        };
        responses: {
            /** @description The message as it was persisted, with its server-assigned sequence. Repeating a send with the same client message identifier returns the original message and creates nothing. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Message"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not a participant in that conversation, or it does not exist. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller may not send here — account, conversation state, or current safety eligibility — or the same client message identifier was already used for a different body. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE, ACTION_NOT_PERMITTED, or IDEMPOTENCY_KEY_MISMATCH. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listBlocks: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum blocks to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own live blocks, newest first. It never shows who has blocked the caller. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlockListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The cursor or page size failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    blockConsumer: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BlockRequest"];
            };
        };
        responses: {
            /** @description The block that now stands. Repeating the call returns the same block and changes nothing. The other person is never told. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Block"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The target is the caller, or is not an account this platform has. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    removeBlock: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BlockRequest"];
            };
        };
        responses: {
            /** @description The block is withdrawn. The record that it was made and withdrawn stays, and the other person is not told either way. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Block"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller holds no live block of that account. Absent and never-made are indistinguishable. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    getSafetyStanding: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description What is currently in force against the caller and why, with the redress available. Only decisions that imposed something and that nothing has replaced: a restriction that was lifted is not something somebody is under. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SafetyStandingResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listOwnAppeals: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Complaints the caller made, newest first. There is no route to anybody else's. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AppealListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createAppeal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateAppealRequest"];
            };
        };
        responses: {
            /** @description The complaint as its own appellant may see it. Its state and its dates, and never the reviewer, the outcome record, or the statement they wrote. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Appeal"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller already has a live complaint about this decision, or the published window has closed. The body is an ApiError with code STATE_CONFLICT. Withdrawing an existing complaint frees the caller to make another; what is refused is contesting one decision twice at once. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The body failed contract validation, or this caller may not complain about this decision. The body is an ApiError with code VALIDATION_FAILED. A decision about somebody else, a dismissal of somebody else's report, and a decision of a kind nobody may contest answer identically, so probing this path enumerates nothing. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    withdrawAppeal: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WithdrawAppealRequest"];
            };
        };
        responses: {
            /** @description The complaint is withdrawn and the record of it stays. The caller is free to complain about the same decision again. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Appeal"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The complaint has already been answered or already withdrawn. The body is an ApiError with code STATE_CONFLICT. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The body failed contract validation, or the complaint is not the caller's. The body is an ApiError with code VALIDATION_FAILED. Somebody else's complaint is answered exactly as one that does not exist. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listOwnReports: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum reports to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Reports the caller filed, newest first. There is no route to anybody else's, and no route that returns a reporter. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReportListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The cursor or page size failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    createReport: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateReportRequest"];
            };
        };
        responses: {
            /** @description The report as its own reporter may see it. Repeating the call with the same client report identifier returns the original and creates nothing. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Report"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Too many reports from this account in the current window. The body is an ApiError with code RATE_LIMITED. No report already made is removed or altered. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The body failed contract validation, or the subject is the caller or is not an account this platform has. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    markConversationRead: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkConversationReadRequest"];
            };
        };
        responses: {
            /** @description The read position after the update. It is monotonic: a position below the one already recorded is accepted and changes nothing. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConversationReadResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not a participant in that conversation, or it does not exist. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller may not communicate here: the account is not active, the conversation is closed, or current safety eligibility denies the pair. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE or ACTION_NOT_PERMITTED. Nothing in it says which, or why. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    declineIntroduction: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntroductionReferenceRequest"];
            };
        };
        responses: {
            /** @description The pending introduction is closed. The other person is not told why, and the pair is suppressed from ordinary discovery for the usual window. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Introduction"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No pending introduction of the caller matches that identifier. Absent and not-permitted are indistinguishable. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not eligible to act on introductions: the account is not active or the minimum discoverable profile is incomplete. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    withdrawIntroduction: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["IntroductionReferenceRequest"];
            };
        };
        responses: {
            /** @description The caller withdrew their own pending signal. Nothing is disclosed to the other person and no suppression is recorded. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Introduction"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No pending introduction the caller initiated matches that identifier. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The caller is not eligible to act on introductions: the account is not active or the minimum discoverable profile is incomplete. The body is an ApiError with code ACCOUNT_NOT_ELIGIBLE. */
            409: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                /** @description Opaque forward-only position in this list */
                cursor?: string;
                /** @description Maximum notifications to return */
                pageSize?: number;
            };
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The caller's own in-app notifications, newest first. Notices about a person the caller may no longer interact with are absent, and nothing about external delivery — attempts, provider state, or why a notice was suppressed — appears in this response. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationListResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The cursor or page size failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
    markNotificationsRead: {
        parameters: {
            query?: never;
            header?: {
                /** @description Caller-provided correlation identifier */
                "x-correlation-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MarkNotificationsReadRequest"];
            };
        };
        responses: {
            /** @description The identifiers that were the caller’s own and are now read. An identifier belonging to somebody else, or to nothing, is absent rather than refused, so this operation cannot be used to test whether a notification exists. */
            200: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationReadResponse"];
                };
            };
            /** @description No valid session or access token accompanied the request. The body is an ApiError with code AUTH_REQUIRED. */
            401: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The browser origin or CSRF evidence was rejected, or the caller is not a Consumer Web or Consumer Mobile audience. The body is an ApiError, with code CONSUMER_SURFACE_REQUIRED in the audience case. */
            403: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description No operation matches the requested path and method, or the addressed resource does not exist or is not visible to this caller. The two are deliberately indistinguishable. The body is an ApiError. */
            404: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body exceeds the maximum accepted size. The body is an ApiError with code PAYLOAD_TOO_LARGE. */
            413: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Request body failed contract validation. The body is an ApiError with code VALIDATION_FAILED. */
            422: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description Unexpected server failure. The body is an ApiError with code INTERNAL_ERROR. */
            500: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
            /** @description The instance has no capacity to begin this request and declined to hold it. The body is an ApiError with code SERVICE_UNAVAILABLE, and Retry-After says when to try again. The requested action has not started, so retrying is as safe as the operation itself is. The two health probes are exempt: an instance at its limit must still be able to report whether it is alive and what it thinks of its dependencies. */
            503: {
                headers: {
                    /** @description Request correlation identifier */
                    "x-correlation-id"?: string;
                    /** @description Seconds to wait before retrying. Present on a capacity refusal. */
                    "retry-after"?: number;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ApiError"];
                };
            };
        };
    };
}

