import { AppGate } from '../../src/app/gate';
import { Live } from '../../src/product/live';

/**
 * Live discovery, the product's primary destination.
 *
 * Behind the same admission gate every other consumer screen uses: live
 * discovery is the first thing an admitted person sees and the last thing an
 * unadmitted one reaches, because it is the most exposing surface here.
 *
 * No `Suspense` boundary, unlike Discover: nothing on this screen reads the
 * query string, so there is nothing for a boundary to wait on and adding one
 * would only delay the first paint.
 */
export default function LivePage() {
  return (
    <AppGate title="Live">
      <Live />
    </AppGate>
  );
}
