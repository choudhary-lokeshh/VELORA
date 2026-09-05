import type { MetadataRoute } from 'next';

import { readPublishedCreatorHandles } from '../src/server/public-reads';
import { staticIndexableRoutes } from '../src/seo/routes';
import { absoluteUrl, resolvePublicSite } from '../src/seo/site';

// The listing behind this is a live database read, and which environment is
// answering decides whether there is a sitemap at all.
export const dynamic = 'force-dynamic';

/**
 * The addresses VELORA offers a crawler, and nothing else.
 *
 * Two kinds. The static pages this surface writes itself, and the public page
 * of every creator who published one — asked for through the same public
 * listing a person browses, so a draft page, a withdrawn page, and a creator
 * who is no longer active are absent here for the same reason they are absent
 * there. Nothing in this file decides who is published; it asks.
 *
 * Nothing carries a last-modified date. The listing does not publish one, and a
 * date invented here would be a claim about when somebody else changed their
 * page — a crawler that believed it would either re-fetch pages that have not
 * moved or skip pages that have. An absent date means "ask when you like",
 * which is the truth.
 *
 * Club addresses are deliberately not listed. Every published club is linked
 * from its creator's page with real anchor text, which is how a crawler that
 * has been given this file finds them, and listing them here would mean one
 * request per creator to build one file — the sitemap would become the most
 * expensive page on the surface.
 *
 * An environment that is not indexable publishes an empty sitemap rather than
 * omitting the route. A crawler that followed a stale link to it gets a valid,
 * empty answer instead of a 404 to interpret.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = resolvePublicSite();
  if (!site.indexable) return [];

  const handles = await readPublishedCreatorHandles();

  return [
    ...staticIndexableRoutes.map((route) => ({
      url: absoluteUrl(site, route.path),
    })),
    ...handles.map((handle) => ({ url: absoluteUrl(site, `/c/${handle}`) })),
  ];
}
