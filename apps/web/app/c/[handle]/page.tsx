import { resolveApiBaseUrl } from '../../../src/api';
import { CreatorPublicPage } from '../../../src/product/creator-page';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

/**
 * The canonical public creator address.
 *
 * The handle is passed straight through to the page, which asks the server
 * about it. Nothing here decides whether the page exists: an unknown handle, a
 * draft profile, and a suspended creator all come back as the same answer, and
 * this route has no way to tell them apart.
 */
export default async function CreatorPage({
  params,
}: {
  readonly params: Promise<{ readonly handle: string }>;
}) {
  const { handle } = await params;
  return <CreatorPublicPage apiBaseUrl={resolveApiBaseUrl()} handle={handle} />;
}
