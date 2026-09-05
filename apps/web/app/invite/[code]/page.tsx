import type { Metadata } from 'next';

import { resolveApiBaseUrl } from '../../../src/api';
import { Invitation } from '../../../src/product/invitation';
import { pageMetadata } from '../../../src/seo/metadata';
import { resolvePublicSite } from '../../../src/seo/site';

export const dynamic = 'force-dynamic';

/**
 * An invitation's own address, and why it is never in a search result.
 *
 * The code belongs to one person and would be indexed under their name in a
 * results page nobody asked for, so every one of these addresses is `noindex` —
 * declared by the route policy, stamped on the response by the middleware, and
 * written into the document here. The canonical still points at this exact
 * address rather than at the entry page: a shared preview should say what the
 * link is, and collapsing it onto `/` would make every invitation ever sent
 * look like the same page.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  return pageMetadata({
    description:
      'You have been invited to VELORA — an adults-only place to meet new people through live conversations. Meeting people is free.',
    path: `/invite/${code}`,
    site: resolvePublicSite(),
    title: 'You are invited to VELORA',
  });
}

/**
 * The invitation landing.
 *
 * The code is passed straight through and nothing here decides whether it
 * works: the page asks the server on the client's behalf and reads the same
 * answer everybody gets. A code nobody holds and a code that has been withdrawn
 * are the same answer, and both still get a page.
 */
export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ readonly code: string }>;
}) {
  const { code } = await params;
  return <Invitation apiBaseUrl={resolveApiBaseUrl()} code={code} />;
}
