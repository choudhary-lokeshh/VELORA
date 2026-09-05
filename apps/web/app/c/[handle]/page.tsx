import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { resolveApiBaseUrl } from '../../../src/api';
import { ConnectedCreatorPublicPage } from '../../../src/product/creator-page';
import {
  arrivedWithoutSession,
  readPublicClubs,
  readPublicCreator,
} from '../../../src/server/public-reads';
import {
  boundedText,
  maximumDescriptionLength,
  pageMetadata,
} from '../../../src/seo/metadata';
import { resolvePublicSite } from '../../../src/seo/site';
import { JsonLd, profilePageData } from '../../../src/seo/structured-data';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

/**
 * What a search result and a shared link say about somebody else's page.
 *
 * Only the two fields the page itself shows, and both bounded: a display name
 * and the creator's own words about themselves. Nothing else in the public
 * projection goes near a document head — not the media identifiers, not the
 * publication instant, not the links — because a preview is read by machines
 * that keep what they are given, and the smallest honest answer is the right
 * one.
 *
 * A handle nobody holds, a page still in draft, and a creator who is no longer
 * active are one answer here exactly as they are on the page, and it is a
 * `noindex` title with no name in it — a preview that named somebody whose page
 * has been withdrawn would be publishing them after they stopped publishing
 * themselves.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const site = resolvePublicSite();
  const path = `/c/${handle}`;
  const found = await readPublicCreator(handle);

  if (found.kind !== 'creator') {
    return pageMetadata({
      description: 'There is nothing to show at this address.',
      indexable: false,
      path,
      site,
      title: 'This page is not available',
    });
  }

  const { bio, displayName } = found.creator;
  return pageMetadata({
    description:
      bio === undefined || bio.trim() === ''
        ? `${displayName} on VELORA — an adults-only place to meet new people through live conversations.`
        : boundedText(bio, maximumDescriptionLength),
    path,
    site,
    title: displayName,
    type: 'profile',
  });
}

/**
 * The canonical public creator address.
 *
 * The projection is read here rather than only in the browser, so the name, the
 * words, and the links are in the first response. That is what a crawler and a
 * link preview see, and it is what somebody on a slow connection reads while
 * the rest of the page is still arriving.
 *
 * A withdrawn or unknown page answers 404 rather than rendering a page that
 * says it is not available with a 200 beside it. A page that cannot be read
 * because the API is unreachable does not: that is our failure rather than a
 * statement about whether this creator exists, and the client asks again.
 */
export default async function CreatorPage({
  params,
}: {
  readonly params: Promise<{ readonly handle: string }>;
}) {
  const { handle } = await params;
  const found = await readPublicCreator(handle);
  if (found.kind === 'absent') notFound();

  // The clubs on this page are seeded only for a reader with no session, on the
  // same terms as the club page itself: the projection carries the reader's own
  // standing, so the anonymous one is right for a visitor and wrong for a
  // member. It is what puts the links to those clubs in the first response.
  const clubs =
    found.kind === 'creator' && (await arrivedWithoutSession())
      ? await readPublicClubs(handle)
      : undefined;
  const site = resolvePublicSite();
  return (
    <>
      {found.kind === 'creator' ? (
        <JsonLd
          data={profilePageData({
            ...(found.creator.bio === undefined
              ? {}
              : { description: found.creator.bio }),
            displayName: found.creator.displayName,
            handle: found.creator.handle,
            path: `/c/${handle}`,
            site,
          })}
        />
      ) : null}
      <ConnectedCreatorPublicPage
        apiBaseUrl={resolveApiBaseUrl()}
        handle={handle}
        shareOrigin={site.origin ?? ''}
        {...(found.kind === 'creator' ? { initialCreator: found.creator } : {})}
        {...(clubs === undefined ? {} : { initialClubs: clubs })}
      />
    </>
  );
}
