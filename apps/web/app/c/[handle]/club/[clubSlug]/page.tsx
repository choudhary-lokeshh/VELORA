import { resolveApiBaseUrl } from '../../../../../src/api';
import { ConnectedClubPage } from '../../../../../src/product/club';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

/**
 * A private club's own address.
 *
 * Deliberately reachable without a session. Nothing here decides whether the
 * caller may read what is inside: the server re-derives that on the request and
 * answers with an empty feed when the answer is no, so a typed address is safe
 * and a shared link tells its recipient what the club is without telling them
 * what its members read.
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
  return (
    <ConnectedClubPage
      apiBaseUrl={resolveApiBaseUrl()}
      handle={handle}
      slug={clubSlug}
    />
  );
}
