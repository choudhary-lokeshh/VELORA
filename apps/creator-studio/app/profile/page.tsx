import { resolvePublicWebOrigin } from '../../src/api';
import { StudioGate } from '../../src/app/gate';
import { ProfileScreen } from '../../src/product/profile';

/*
 * The public origin is read on the server at request time, on the same terms as
 * the API endpoint: a value inlined at build would bake one environment's
 * address into the artifact every environment shares.
 */
export const dynamic = 'force-dynamic';

export default function ProfilePage() {
  return (
    <StudioGate narrow title="Public page">
      <ProfileScreen publicOrigin={resolvePublicWebOrigin() ?? ''} />
    </StudioGate>
  );
}
