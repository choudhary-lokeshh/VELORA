import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicShell } from '../../src/product/public-shell';
import { readCreatorDirectory } from '../../src/server/public-reads';
import { pageMetadata } from '../../src/seo/metadata';
import { creatorsRoute } from '../../src/seo/routes';
import { resolvePublicSite } from '../../src/seo/site';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata({ ...creatorsRoute, site: resolvePublicSite() });
}

/**
 * How many creators this page shows at once.
 *
 * The listing's own ceiling, and there is deliberately no second page. Paging a
 * public listing means either a query parameter that turns one address into
 * many — each of which a crawler then has to be told is not a duplicate of the
 * first — or an opaque cursor in a link, which is an address that stops
 * working. The sitemap already offers every published creator, which is the
 * mechanism built for exactly this, so this page is a way in for a person
 * rather than an index for a machine.
 */
const shown = 50;

/**
 * Every creator who has published a page, most recently published first.
 *
 * Rendered on the server, so the names and the links are in the first response
 * rather than after hydration. That is the entire point of the page existing:
 * it is the only address from which a creator's page can be reached without
 * already knowing their handle.
 *
 * Ordering is publication order and nothing else. There is no popularity here
 * to sort by, and nothing on this page can be bought.
 */
export default async function CreatorsPage() {
  const directory = await readCreatorDirectory({ pageSize: shown });

  return (
    <PublicShell
      currentPath={creatorsRoute.path}
      lede="Everyone here published their own page. Nothing is ranked, and nothing on this list was paid for."
      title="Creators on VELORA"
    >
      {directory === undefined ? (
        <section className="v-public__section">
          <h2 className="v-subheading">This list could not be loaded</h2>
          <p>
            Something went wrong on our side rather than yours. Reloading is
            worth a try, and{' '}
            <Link href="/about/creators">
              what creator pages and communities are
            </Link>{' '}
            is readable either way.
          </p>
        </section>
      ) : directory.creators.length === 0 ? (
        <section className="v-public__section">
          <h2 className="v-subheading">Nobody has published a page yet</h2>
          <p>
            When somebody does, they will be here.{' '}
            <Link href="/about/creators">
              How creator pages and communities work
            </Link>{' '}
            explains what one is.
          </p>
        </section>
      ) : (
        <section className="v-public__section">
          <h2 className="v-subheading">Published pages</h2>
          <ul className="v-creator-list">
            {directory.creators.map((creator) => (
              <li className="v-creator-list__row" key={creator.handle}>
                <Link
                  className="v-creator-list__link"
                  href={`/c/${creator.handle}`}
                >
                  {creator.displayName}
                </Link>
                <p className="v-caption v-quiet">@{creator.handle}</p>
                {creator.bio === undefined ? null : (
                  <p className="v-small v-muted">{creator.bio}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </PublicShell>
  );
}
