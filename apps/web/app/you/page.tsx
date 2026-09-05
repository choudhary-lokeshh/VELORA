import type { Metadata } from 'next';
import { AppGate } from '../../src/app/gate';
import { You } from '../../src/product/profile';
import { privateMetadata } from '../../src/seo/metadata';
import { resolvePublicSite } from '../../src/seo/site';

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
export const metadata: Metadata = privateMetadata('You');

/*
 * The public origin is read on the server, on the same terms as the API
 * endpoint next door: an invitation link has to name the address other people
 * will reach, and a value inlined at build would name whichever environment
 * built the artifact.
 */
export const dynamic = 'force-dynamic';

export default function YouPage() {
  return (
    <AppGate narrow title="You">
      <You origin={resolvePublicSite().origin ?? ''} />
    </AppGate>
  );
}
