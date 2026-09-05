import type { Metadata } from 'next';
import { AppGate } from '../../src/app/gate';
import { Live } from '../../src/product/live';
import { privateMetadata } from '../../src/seo/metadata';

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
export const metadata: Metadata = privateMetadata('Live');

/**
 * Live discovery, the product's primary destination.
 *
 * Behind the same admission gate every other consumer screen uses: live
 * discovery is the first thing an admitted person sees and the last thing an
 * unadmitted one reaches, because it is the most exposing surface here.
 *
 * Immersive, which is the one place this shell lets a page out of the reading
 * column. The subject here is a camera and a person's face; a measure that
 * makes a paragraph legible is the wrong container for either, and a page
 * fighting its own shell with negative margins would be worse than the shell
 * being told.
 *
 * No `Suspense` boundary, unlike Discover: nothing on this screen reads the
 * query string, so there is nothing for a boundary to wait on and adding one
 * would only delay the first paint.
 */
export default function LivePage() {
  return (
    <AppGate immersive title="Live">
      <Live />
    </AppGate>
  );
}
