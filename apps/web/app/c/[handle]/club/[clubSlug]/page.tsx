import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { resolveApiBaseUrl } from '../../../../../src/api';
import { ConnectedClubPage } from '../../../../../src/product/club';
import {
  arrivedWithoutSession,
  readPublicClub,
} from '../../../../../src/server/public-reads';
import {
  boundedText,
  maximumDescriptionLength,
  pageMetadata,
} from '../../../../../src/seo/metadata';
import { resolvePublicSite } from '../../../../../src/seo/site';
import { breadcrumbData, JsonLd } from '../../../../../src/seo/structured-data';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

/**
 * What this club's address says about it to a search result or a shared link.
 *
 * The club's own name and its own description, and nothing that belongs to its
 * members. The feed is not here, cannot be here, and would not be even if
 * somebody added it: the projection this is built from is the anonymous one,
 * which the server answers with an empty feed for everybody who is not a
 * member. Benefits are the creator's published pitch and are safe; a post is
 * not, and never reaches this file to be leaked.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{
    readonly clubSlug: string;
    readonly handle: string;
  }>;
}): Promise<Metadata> {
  const { clubSlug, handle } = await params;
  const site = resolvePublicSite();
  const path = `/c/${handle}/club/${clubSlug}`;
  const found = await readPublicClub({ handle, slug: clubSlug });

  if (found.kind !== 'club') {
    return pageMetadata({
      description: 'There is nothing to show at this address.',
      indexable: false,
      path,
      site,
      title: 'This page is not available',
    });
  }

  const { description, name } = found.detail.club;
  return pageMetadata({
    description:
      description === undefined || description.trim() === ''
        ? `${name} is a community on VELORA, run by @${found.detail.creatorHandle}.`
        : boundedText(description, maximumDescriptionLength),
    path,
    site,
    title: name,
  });
}

/**
 * A private club's own address.
 *
 * Deliberately reachable without a session. Nothing here decides whether the
 * caller may read what is inside: the server re-derives that on the request and
 * answers with an empty feed when the answer is no, so a typed address is safe
 * and a shared link tells its recipient what the club is without telling them
 * what its members read.
 *
 * The anonymous answer is read on the server and handed down, but only when the
 * request arrived with no session. A member's own read is the one that decides
 * what they see, and seeding theirs with the anonymous projection would show
 * them a locked door they hold the key to for as long as their read takes.
 */
export default async function ClubPage({
  params,
}: {
  readonly params: Promise<{
    readonly clubSlug: string;
    readonly handle: string;
  }>;
}) {
  const { clubSlug, handle } = await params;
  const path = `/c/${handle}/club/${clubSlug}`;
  // Asked for every reader, not only the ones with no session, so a closed club
  // answers 404 whoever fetched it. What the session presence decides is the
  // separate question of whether the anonymous answer is the right thing to
  // *render* — for a member it is not.
  const found = await readPublicClub({ handle, slug: clubSlug });
  if (found.kind === 'absent') notFound();
  const detail =
    found.kind === 'club' && (await arrivedWithoutSession())
      ? found.detail
      : undefined;
  const site = resolvePublicSite();

  return (
    <>
      {found.kind === 'club' ? (
        <JsonLd
          data={breadcrumbData(site, [
            { name: 'Creators', path: '/creators' },
            { name: `@${found.detail.creatorHandle}`, path: `/c/${handle}` },
            { name: found.detail.club.name, path },
          ])}
        />
      ) : null}
      <ConnectedClubPage
        apiBaseUrl={resolveApiBaseUrl()}
        handle={handle}
        shareOrigin={site.origin ?? ''}
        slug={clubSlug}
        {...(detail === undefined ? {} : { initialDetail: detail })}
      />
    </>
  );
}
