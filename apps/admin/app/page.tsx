import { FinancialOperations } from '../src/financial-state';
import { MediaOperations } from '../src/media-state';
import { resolveApiBaseUrl } from '../src/api';

/**
 * The Platform Admin surface.
 *
 * One screen, and it reads. `docs/product/04-platform-admin.md` makes ADMIN an
 * operations layer over other domains' truth rather than an owner of any, and
 * the only financial action an operator has anywhere in this product is issuing
 * a refund — which goes through BILLING's own service with an operator's
 * authority, a reason, and a record, not through a field on a screen.
 *
 * Two panels now, and the second reads for a stricter reason than the first.
 * MEDIA does offer an operator one action — asking a delivery layer to forget
 * an address — and it stays off this screen deliberately: it names one asset,
 * it is reached from a finding or a report rather than by browsing, and a
 * lookup box on a dashboard is where a search over everybody's private images
 * begins.
 *
 * In a deployed environment nobody reaches even this. ADR-0017 requires a
 * recent phishing-resistant assurance for privileged access and no verifier
 * that can produce one is approved, so every request here is refused before any
 * lookup happens on its behalf.
 */
// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

export default function PlatformAdminShell() {
  return (
    <main>
      <p>VELORA</p>
      <h1>Platform Admin</h1>
      <h2>Financial operations</h2>
      <FinancialOperations apiBaseUrl={resolveApiBaseUrl()} />
      <h2>Media operations</h2>
      <MediaOperations apiBaseUrl={resolveApiBaseUrl()} />
    </main>
  );
}
