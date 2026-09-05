# ADR-0047: Public entry, and a GROWTH domain that costs nothing to run

- Decision date: 2026-09-05
- ADR status: Accepted
- Owners: Founder (decision owner), GROWTH, USERS, Consumer Web, Consumer Mobile, Platform Admin

## Context

VELORA works and nobody can find it. Every previous phase built the product; none of them built a way in.

The owner's acquisition budget is ₹0, which is not a temporary constraint to be designed around but the fact that decides what can exist. There are no advertisements, no influencer arrangements, no paid placements, and no marketing tools with a subscription attached. What is left is exactly three things: a page a search engine can read, a person telling another person, and a time everybody agrees to be here at. This decision builds all three and refuses to build anything that would need money to keep running.

Four concrete failures made the product unfindable, and each of them was silent.

**Every public page was an empty document.** Consumer Web's entry page was a client component behind `PublicGate`, which renders a loading state until the session answer arrives — so the HTML the server actually sent to anything that does not run scripts was the word VELORA and "Loading VELORA". The same was true of a creator's public page, whose content arrived from a browser fetch after hydration. A crawler, a chat client building a link preview, and a person on a connection that dropped all saw the same nothing. Nothing failed, no test noticed, and no browser walk could have: every one of them runs scripts.

**There was no indexing policy at all.** No `robots.txt`, no sitemap, no canonical addresses, and one description on the root layout that every one of twenty-three routes inherited. The consequence in production would have been a search result showing `VELORA` seven times with the same sentence under each; the consequence in a preview deployment would have been worse, because nothing anywhere said which environment was allowed to be crawled.

**A person had no way to bring anybody.** There was no invitation, no shareable link beyond copying an address bar, and no record anywhere of how a single account arrived. The platform could not answer "where did our users come from" because it had never asked.

**A live product with few people is empty for arithmetic reasons rather than product ones.** People who came at nine different hours are nobody to meet. There was no mechanism at all for asking them to come at the same time.

A fifth thing was wrong in the copy rather than in the code. The entry page's third promise ended "nothing on VELORA can be bought", which was true when it was written and stopped being true when coins shipped.

## Decision

### GROWTH is a domain, and it owns how somebody arrived and nothing that follows

`docs/architecture/03-domain-boundaries.md` gains GROWTH. It owns invitation links, signup attribution, acquisition counts, and scheduled live windows. It must not own — and structurally cannot own — anything that follows from arriving: no entitlement, no balance, no standing, no reward, no profile, and no session.

Four tables in `0079_growth-acquisition`, and the shape of each is the rule rather than a place the rule is checked.

`growth_invites` is unique on the owner, so one account has one link forever. Minting a second code would silently break every link that person had already sent, and the index is what makes that impossible rather than a service remembering not to.

`growth_signup_attributions` is keyed on the account itself. **An account has exactly one origin, forever, and a second attribution is not refused — it is impossible.** A CHECK constraint refuses an inviter that is the invited account, which is the anti-self-referral rule stated where it survives the service being wrong.

`growth_acquisition_events` has four allowed names and no payload column, so a message, a profile field, or a token cannot end up in it. There is no address, referer, user agent, IP address, or session identifier anywhere in this migration. A funnel built out of those would be surveillance with a business justification attached, and it is not needed: invitations created, invitations opened, and signups by channel are all counted from rows that exist for a product reason.

`growth_live_windows` stores two instants and a name. Its state is derived on every read rather than stored, because a stored state is wrong for exactly as long as it takes a job to update it — and this repository has already been bitten twice by a sweep that was late, restarted, or never called.

Every account reference is an opaque USERS identifier with no foreign key, on the rule `docs/architecture/05-data-ownership.md` records. GROWTH holds identifiers it cannot resolve to a person.

### Attribution happens on the request that creates the account, and on no other

`POST /v1/users` gains an optional `acquisition` object. USERS does not read it, store it, or decide anything with it: it hands the value to GROWTH's published `SignupAttributionPort` **only when `outcome.created` is true**.

That condition is the whole anti-abuse design. A client provisions idempotently, so an account that already exists calls this route on every sign-in — and an attribution accepted there could be sent by an account that has existed for a year, claiming somebody's invitation by opening a link. Here it cannot: the only request that can carry an origin is the one that brought the account into existence.

The port returns nothing and cannot fail the account creation it is called from. A person's signup must not depend on a marketing fact being recordable.

**The attribution rule is first touch, held until signup and no longer.** The first arrival carrying an invitation or a campaign is the one kept; a later link does not replace it; nothing is remembered once the account exists. Last touch was the alternative and was rejected: it rewards whoever got somebody to tap most recently rather than whoever actually introduced them, and this product has no advertising to reward.

### An invitation is not a credential, and it never says who sent it

The code is twenty-two lowercase alphanumerics from the platform's own random source — about 113 bits, which is not a security property, because the code authorises nothing. It opens a page and attributes one signup. A holder of a code can do nothing a stranger typing the same address cannot, which is what makes it safe to post one publicly.

`POST /v1/growth/invitations/openings` answers one boolean and **never discloses the inviter**. An invitation address can be forwarded, posted in a group, or scraped, so anything answered there is answered to everybody who ever saw the link — and "X invited you" is a fact about X that X did not agree to publish to strangers. The invitation page says a person invited you and gets on with explaining VELORA.

An unusable code is not an error page. A link mistyped, truncated by a chat client, or withdrawn by its owner still brought somebody here, and turning them away over bookkeeping is the most expensive possible way to handle it.

There is deliberately no route that reads somebody else's invitation, lists who used yours, or counts them. A person who could see who joined through their link would hold a small social graph they were never given, and every reward scheme ever attached to that number ended with people buying accounts.

### Indexability is a decision, and its default is no

`apps/web/src/seo/routes.ts` is the single policy. A page becomes indexable by being named there and by no other means, and three things read it: the sitemap offers exactly those addresses, `robots.txt` disallows the rest, and the middleware stamps `X-Robots-Tag: noindex` on every request for an address the policy does not name.

**Indexing requires two conditions and neither is a preference.** `VELORA_APP_ENV=production`, and a declared `VELORA_WEB_PUBLIC_ORIGIN`. An environment that is not production is serving fixtures, seeded people, and local-test adapters, every one of which would be indexed as though it were the product. An environment with no declared origin cannot write a canonical address, and a page indexed without one competes with itself under every hostname it happens to answer at. The default is therefore refusal, in the safe direction: a page never offered can be offered later, while a preview deployment that was indexed under a hostname nobody meant to publish is somebody's afternoon in a search console.

**The canonical is built from the path alone.** That is the entire defence against attribution splitting one page into an indexed copy per link anybody ever shared: `/c/alex?ref=…&utm_source=…` and `/c/alex` publish the same canonical, so a referral can travel in the address without the address becoming a second page.

### Public pages are rendered on the server, because that is what makes them pages

The entry page renders its prose in the first response and the signed-in redirect rides beside it rather than instead of it. A creator's public page and a club's page read the same public projections on the server and hand them to the client component as a starting value; the client still asks again on mount, so nothing depends on the server answer staying fresh.

The club and the creator's club list are seeded **only when the request carried no session cookie**. Those projections carry the reader's own standing, so the anonymous answer is right for a visitor and wrong for a member — it would show them a locked door they hold the key to for as long as their own read takes. Cookie presence authorises nothing here and is not read as authorisation: it answers a rendering question.

A withdrawn or unknown creator page and a closed club answer **404** rather than a 200 with an apology on it. A page that says "not available" and answers 200 is a page a search engine keeps, links to, and shows somebody a week later.

Five informational pages — what VELORA is, how live conversations work, creators and communities, safety, and the questions people ask — plus a public creator listing are the whole of the new public surface. There is no page that exists to hold a phrase, and there will not be: a sixth covering the same ground as one of these would compete with it for the same reader and teach neither of them anything.

### A live window concentrates people and promises nothing

`growth_live_windows` is an announcement that more people intend to be looking between two instants. It has no host, no attendee list, no capacity, and no registration, and **it publishes no attendance figure of any kind** — nothing knows, and a number nobody can verify would be the one dishonest thing in an otherwise honest feature. Ordinary Live is untouched before, during, and after: a window concentrates people rather than gating anybody.

Windows are platform-owned and operator-scheduled. A creator-hosted window was considered and deferred: it would imply a person will personally be there, and nothing in this architecture can make that true.

### Nothing is rewarded, and that is a decision rather than a gap

There is no referral reward, no credit, and no qualification state. When a reward exists it will need a qualification rule somebody has approved — signup alone is what every fraudulent referral scheme in history has paid for — and inventing the rule here would be inventing the approval with it.

### The entry page's third promise is now true again

"Nothing on VELORA can be bought" became "Nobody can buy their way into a conversation you have not agreed to". The first was true when written and stopped being true when coins shipped; the second is exactly true today and stays true when a payment provider is approved. The heading changed with it, from a claim about mutuality to a sentence that says what somebody came to do.

## Consequences

Consumer Web has a public surface: seven indexable addresses, five of them prose, all rendered on the server. Nothing about the signed-in product changed except that every route now carries a real title and an explicit index directive.

The API gains seven operations and the frozen runtime inventory moves from 183 to 190. Two of the seven are public because they have to be — an invitation is opened by somebody with no account, and a scheduled window is read by a page a stranger fetches.

Platform Admin gains a Growth area under Platform — the smallest screen on the console. It reports the counts above and offers the two acts only an operator can perform: scheduling a live window and withdrawing one. No per-inviter figure and no conversion rate appear on it, and neither could be added from the console, because the contract publishes no shape for either.

Consumer Mobile resolves `velora://invite/<code>` in the deep-link parser, above the gate, because the gate replaces every route with the welcome screen while there is no session — a route component for that address would never mount for exactly the person the link is for. The share control uses the platform's own sheet and a web address, because the person being invited does not have the application.

**HTTPS App Links remain unavailable and are not faked.** Android verification needs a registered domain and an `assetlinks.json` served from it, and VELORA has neither. The custom scheme works today and is what ships; the boundary is stated rather than papered over.

Search Console and Bing Webmaster ownership remain external and unstarted, and are not completion blockers. `docs/engineering/08-public-entry-and-seo.md` records exactly what has to be submitted, by whom, and in what order, once a domain exists.

Retention for every GROWTH table is `DECISION REQUIRED / LEGAL REVIEW REQUIRED`, like every other personal-data class here. Nothing expires and no correctness rule depends on a row being gone.

## Cross-references

- [Domain boundaries](../architecture/03-domain-boundaries.md) — GROWTH's row
- [Data ownership](../architecture/05-data-ownership.md) — GROWTH's tables
- [GROWTH domain](../domains/growth.md)
- [Public entry and SEO](../engineering/08-public-entry-and-seo.md) — the indexable matrix and what is left to do externally
- [Configuration and environments](../engineering/07-configuration-environments.md) — `VELORA_WEB_PUBLIC_ORIGIN`, `EXPO_PUBLIC_WEB_ORIGIN`
- [Consumer Web](../surfaces/01-consumer-web.md), [Consumer Mobile](../surfaces/02-consumer-mobile.md)
- [ADR-0040](ADR-0040-random-live-discovery.md), [ADR-0043](ADR-0043-livekit-transport-coins-and-paid-live-preferences.md) — what a live window points people at, and what coins actually buy
