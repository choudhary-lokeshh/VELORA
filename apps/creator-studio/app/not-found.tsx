import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

/**
 * An address that is not part of the workspace.
 *
 * Deliberately outside the shell: a page that does not exist has no place in a
 * navigation, and rendering the sidebar around it would suggest it does.
 */
export default function NotFound() {
  return (
    <main className="s-entry" id="main">
      <div className="s-entry__inner">
        <h1 className="s-title">That page is not here</h1>
        <p className="s-small s-muted">
          The address may be wrong, or the thing it pointed at may have been
          archived or closed. Nothing was changed.
        </p>
        <Link className="s-btn s-btn--primary" href="/home">
          Back to Creator Studio
        </Link>
      </div>
    </main>
  );
}
