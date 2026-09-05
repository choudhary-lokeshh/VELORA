import type { Metadata } from 'next';
import { AppGate } from '../../../../../../src/app/gate';
import { JoinClub } from '../../../../../../src/product/join';
import { privateMetadata } from '../../../../../../src/seo/metadata';

/**
 * A real name for a browser tab and a history entry, and a refusal for
 * everything else.
 *
 * `noindex` is stated here as well as in the response header the middleware
 * stamps, because the two are read by different crawlers at different
 * moments and neither is worth relying on alone. Nothing behind this address
 * is visible without a session in any case; this is what stops it appearing
 * in a results page as a title with a sign-in form under it.
 */
export const metadata: Metadata = privateMetadata('Join');

/**
 * The confirmation before a purchase.
 *
 * Behind the gate, because starting a checkout is something only a signed-in
 * consumer may do — and because somebody who arrives here without a session
 * should be sent to sign in and returned, rather than shown a control that
 * would refuse.
 */
export default async function JoinClubPage({
  params,
}: {
  readonly params: Promise<{
    readonly clubSlug: string;
    readonly handle: string;
  }>;
}) {
  const { clubSlug, handle } = await params;
  return (
    <AppGate narrow title="Join">
      <JoinClub handle={handle} slug={clubSlug} />
    </AppGate>
  );
}
