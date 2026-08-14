import { resolveApiBaseUrl } from '../src/api';
import { ConsumerShell } from '../src/product/shell';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

export default function ConsumerWebPage() {
  return <ConsumerShell apiBaseUrl={resolveApiBaseUrl()} />;
}
