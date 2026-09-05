# Public entry and search

What VELORA offers a search engine, what it refuses, and what is left that only the owner can do. [ADR-0047](../decisions/ADR-0047-public-entry-and-organic-acquisition.md) is the decision; this is the operational reference.

## Two conditions, and neither is a preference

Consumer Web is indexable only where **both** hold:

1. `VELORA_APP_ENV=production`
2. `VELORA_WEB_PUBLIC_ORIGIN` is set to an exact `scheme://host[:port]`

Anything else — a developer's machine, the browser suite, a preview deployment, production before a domain exists — publishes `robots.txt` disallowing everything, stamps `X-Robots-Tag: noindex, nofollow` on every response, writes `noindex` into every document, and serves an empty sitemap. That is the safe direction: a page never offered can be offered later, while a preview indexed under a hostname nobody meant to own cannot be un-indexed by editing a file.

Setting the origin alone changes nothing about indexing. It gives the environment absolute addresses — a canonical, a social preview, an invitation link that works when pasted — which is why local development sets it to the loopback address it actually answers at.

## The indexable matrix

`apps/web/src/seo/routes.ts` is the single policy. A page becomes indexable by being named there and by no other means; `apps/web/test/seo.test.ts` asserts every row below.

| Address | Offered to a crawler | Why |
|---|---|---|
| `/` | Yes | The entry. Server-rendered prose, one heading, links to every explanation |
| `/about` | Yes | What VELORA is, and that it is not a dating app |
| `/about/live` | Yes | How a live conversation works, camera optional |
| `/about/creators` | Yes | Creator pages and communities |
| `/about/safety` | Yes | Visibility, mutual interest, blocking and reporting |
| `/about/questions` | Yes | Visible questions and answers, with matching `FAQPage` data |
| `/creators` | Yes | The published creator listing, and the only hub a creator address is reached from |
| `/c/<handle>` | Yes | A creator's own published page |
| `/c/<handle>/club/<slug>` | Yes | A published community's public facts. Its feed is not in the projection |
| `/sign-in` | `noindex` | A door, not a destination |
| `/invite/<code>` | `noindex` | The code belongs to one person |
| `/live-window/<slug>` | `noindex` | News for a day, then a page about an afternoon that passed. Deliberately still crawlable, so a shared link previews |
| `/checkout/*` | `noindex` + disallowed | A payment return says nothing to anybody else |
| `/welcome`, `/you/*`, `/discover`, `/live`, `/introductions`, `/messages/*`, `/notifications`, `/people/*` | `noindex` + disallowed | Nothing behind them answers without a session |

`/live` is deliberately absent from the `robots.txt` disallow list. A `robots.txt` prefix has no word boundary, so `Disallow: /live` also covers `/live-window/…` — the address whose whole value is the preview it produces. The extra crawl request is the cheaper mistake, and `apps/web/test/seo.test.ts` asserts that no disallowed prefix covers an address that is offered or previewed.

**Robots is a request, not a control.** Every private address is refused by the server that owns it whether or not a crawler read the file.

## Canonical addresses

Built from the path alone, always. `/c/alex?ref=…&utm_source=…` and `/c/alex` publish the same canonical, so attribution travels in the address without the address becoming a second page. A trailing slash is dropped; a fragment is dropped; a query never participates.

The sitemap carries the static addresses plus every published creator, walked through the same public listing a person browses, bounded to 1,000 and paged 50 at a time. **No last-modified date is published**, because the listing does not carry one and a date invented here would be a claim about when somebody else changed their page. Club addresses are not listed: every published club is linked from its creator's page with real anchor text, and listing them would mean one request per creator to build one file.

## Social previews

Every indexable page publishes `og:title`, `og:description`, `og:url`, `og:type`, `og:site_name`, an image, and a `summary_large_image` Twitter card. The image is `apps/web/public/share/velora.png`, drawn by `pnpm surfaces:assets` from Consumer Web's own `sparkle` mark and tokens — first-party, deterministic, and committed. It carries no text: text in an SVG is rendered by whichever fonts the machine running the generator has, so a card with words would come out differently for whoever regenerated it, and every platform renders the page's own title and description beside the image anyway.

Dynamic per-creator imagery is a deliberate non-goal today. It would need a font binary in the repository and a render on every preview fetch, for words that are already in the card.

Nothing private reaches a document head. A creator preview carries a display name and the creator's own bio, bounded to 200 characters and cut at a word; a club preview carries the club's name and description. No identifier, no media reference, no publication instant, no membership, and no matching declaration.

## Structured data

`Organization` and `WebSite` on the entry page only. `ProfilePage` on a creator's page, carrying the name and handle the page already shows. `BreadcrumbList` on a club. `FAQPage` on `/about/questions`, built from the same array the page renders — an answer that existed only in the structured data would be a claim made to machines and withheld from people.

There is no `AggregateRating`, no `Review`, and no `interactionStatistic` anywhere, and `apps/web/test/seo.test.ts` fails if one appears.

## Where an operator sees this

Platform Admin, under Platform → Growth. It reports invitations made, invitations opened, and signups by channel over a fixed thirty-day window, and it is where a live window is scheduled and withdrawn. It names nobody, ranks nobody, and shows no percentage.

## What is left, and only the owner can do it

None of this is a completion blocker; all of it is external.

1. **Register a domain.** Everything below waits on it.
2. **Set `VELORA_WEB_PUBLIC_ORIGIN`** in the production environment to that origin, exactly, with no path or trailing slash. Indexing begins the moment this and `APP_ENV=production` are both true — so set it deliberately rather than as part of a first deploy.
3. **Set `EXPO_PUBLIC_WEB_ORIGIN`** to the same value for the next mobile build, so the app's invitation share control appears.
4. **Verify ownership in Google Search Console and Bing Webmaster Tools.** Both accept a DNS TXT record, which is the method that does not depend on a deploy.
5. **Submit `https://<origin>/sitemap.xml`** in both. `robots.txt` names it automatically once indexing is allowed.
6. **Android App Links**: publish `https://<origin>/.well-known/assetlinks.json` carrying the release signing certificate's SHA-256 fingerprint, then add the verified intent filter to `apps/mobile/app.config.ts`. Until then `velora://invite/<code>` is the only link the application resolves, and that boundary is stated rather than faked.

Nothing here has been submitted, and no submission has been claimed.

## Local and test behaviour

`.env.example` sets `VELORA_WEB_PUBLIC_ORIGIN=http://127.0.0.1:3000`, so a local run writes real absolute addresses and a copied invitation link works between two browsers on the machine. `bun run dev:domains` overrides it with the hostname it serves each surface at. The Playwright configuration sets it to whichever port that run adopted, so `e2e/seo.spec.ts` asserts canonicals against the address the browser actually fetched. None of those is indexable, because none of them is production.
