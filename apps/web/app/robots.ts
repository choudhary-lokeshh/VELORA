import type { MetadataRoute } from 'next';

import { crawlDisallowedPrefixes } from '../src/seo/routes';
import { absoluteUrl, resolvePublicSite } from '../src/seo/site';

// Resolved from the environment on every request, like every other decision on
// this surface that depends on which environment is serving it. A `robots.txt`
// baked at build would be one environment's answer served by all of them, and
// the environment it would be baked from is a build machine.
export const dynamic = 'force-dynamic';

/**
 * What a crawler is asked to do here, which depends entirely on where here is.
 *
 * An environment with no declared public origin, or one that is not production,
 * disallows everything. That covers a developer's machine, the browser suite,
 * and any preview deployment, and it is the safe direction: a page that was
 * never offered can be offered later, while a preview that was indexed under a
 * hostname nobody meant to publish is somebody's afternoon spent in a search
 * console.
 *
 * Where indexing is allowed, the disallowed list is every address that answers
 * nothing without a session. It is not a privacy control and is not relied on
 * as one — the server refuses those addresses to an unauthenticated caller
 * whether or not a crawler read this file — it just stops a crawler spending
 * requests on loading states.
 *
 * The prefixes are written without a trailing slash, which is how a crawler
 * reads them as covering both the address itself and everything under it. None
 * of them is a prefix of an address this surface publishes, which is a property
 * `pathIsCrawlDisallowed` asserts against the indexable set rather than a thing
 * anybody has to remember.
 */
export default function robots(): MetadataRoute.Robots {
  const site = resolvePublicSite();

  if (!site.indexable) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: [...crawlDisallowedPrefixes] },
    ],
    sitemap: absoluteUrl(site, '/sitemap.xml'),
  };
}
