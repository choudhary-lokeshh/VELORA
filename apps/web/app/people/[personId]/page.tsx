import type { Metadata } from 'next';
import { AppGate } from '../../../src/app/gate';
import { PersonPage } from '../../../src/product/person';
import { privateMetadata } from '../../../src/seo/metadata';

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
export const metadata: Metadata = privateMetadata('Person');

/**
 * One person, at their own address.
 *
 * An address rather than a panel, so Back leaves the person instead of doing
 * nothing, a link somebody sends works, and a second tab is a second person.
 * Nothing here decides whether they exist: the identifier goes straight to the
 * server, and somebody nobody may see comes back exactly as somebody who does
 * not.
 */
export default async function Person({
  params,
}: {
  readonly params: Promise<{ readonly personId: string }>;
}) {
  const { personId } = await params;
  return (
    <AppGate narrow title="Person">
      <PersonPage personId={personId} />
    </AppGate>
  );
}
