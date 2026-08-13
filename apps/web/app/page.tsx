import { resolveApiBaseUrl } from '../src/api';
import { AuthPanel } from '../src/auth/panel';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

export default function ConsumerWebShell() {
  return (
    <main>
      <p>VELORA</p>
      <h1>Consumer Web</h1>
      <p>Foundation shell. Product UI is not implemented.</p>
      <AuthPanel apiBaseUrl={resolveApiBaseUrl()} />
    </main>
  );
}
