import { resolveApiBaseUrl } from '../src/api';
import { CreatorStudio } from '../src/product/studio';

// The API endpoint is read from the environment on every request, so one build
// artifact serves every environment.
export const dynamic = 'force-dynamic';

export default function CreatorStudioPage() {
  return <CreatorStudio apiBaseUrl={resolveApiBaseUrl()} />;
}
