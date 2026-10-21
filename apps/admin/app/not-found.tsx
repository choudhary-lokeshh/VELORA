import type { Metadata } from 'next';

import { homePath } from '../src/app/navigation';
import { ButtonLink } from '../src/design/primitives';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * An address that is not part of the console.
 *
 * Deliberately outside the shell: a page that does not exist has no place in a
 * navigation, and rendering the console around it would suggest it does.
 */
export default function NotFound() {
  return (
    <div className="a-door">
      <main className="a-door__inner" id="main">
        <h1 className="a-title">That page is not here</h1>
        <p className="a-small a-muted">
          The address may be wrong, or the record it pointed at may have been
          closed. Nothing was changed.
        </p>
        <p>
          <ButtonLink href={homePath} tone="primary">
            Back to the console
          </ButtonLink>
        </p>
      </main>
    </div>
  );
}
