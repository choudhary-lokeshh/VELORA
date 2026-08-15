import { FinancialOperations } from '../src/financial-state';
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
    </main>
  );
}
