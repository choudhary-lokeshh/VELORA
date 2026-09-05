import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RedirectWhenSignedIn } from '../src/app/gate';
import { Landing } from '../src/product/landing';
import { readLiveWindows } from '../src/server/public-reads';
import { pageMetadata } from '../src/seo/metadata';
import { homeRoute } from '../src/seo/routes';
import { resolvePublicSite } from '../src/seo/site';
import { JsonLd, organizationData } from '../src/seo/structured-data';

// The environment decides the canonical address and whether this page may be
// indexed at all, and it is read at request time for the same reason the API
// endpoint is: one build artifact serves every environment.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata({ ...homeRoute, site: resolvePublicSite() });
}

/**
 * The public entry, rendered before anybody knows whose it is.
 *
 * This is the address a search result, a shared link, and an invitation all
 * eventually lead to, so it is server-rendered prose rather than a shell that
 * fills itself in after hydration — a crawler and a person on a slow connection
 * see the same page, and neither has to run anything to read it.
 *
 * Somebody with a live session is still moved into the product, and still to
 * where they were going if they arrived following a link. That now happens
 * beside the page instead of instead of it.
 */
export default async function HomePage() {
  const site = resolvePublicSite();
  const liveWindows = await readLiveWindows();
  return (
    <>
      {/* Identity only, and only here. Who publishes this and what the site is
          are facts about the whole product, so repeating them on every page
          would add nothing and give every page a second thing that can drift. */}
      <JsonLd data={organizationData(site)} />
      <Landing liveWindows={liveWindows} />
      {/* Reads the query, so it waits behind a boundary rather than making the
          page it rides on client-rendered. */}
      <Suspense fallback={null}>
        <RedirectWhenSignedIn />
      </Suspense>
    </>
  );
}
