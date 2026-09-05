import Link from 'next/link';
import { Suspense } from 'react';

import { CreatorNotFoundBack } from '../../../src/product/creator-back';

/**
 * A public address that has nothing behind it, answered with a 404.
 *
 * The status is the point. A page that says "not available" and answers 200 is
 * a page a search engine keeps, links to, and shows somebody a week later — a
 * tombstone indexed as content. Answering 404 is what makes a withdrawn creator
 * page and a withdrawn club disappear from a results page instead of lingering
 * there under the creator's name.
 *
 * The words are deliberately the same for every reason it could be empty. A
 * handle nobody holds, a page still in draft, a creator who is no longer
 * active, and a club that was closed are one answer, because telling them apart
 * would turn this address into a way to find out that somebody exists.
 *
 * It is a boundary for this whole subtree rather than the document's own
 * not-found page, so a creator address gets the sentence the rest of that
 * surface uses instead of the generic one — and keeps the Back control the rest
 * of that surface has. Somebody who opened a creator from a section of Discover
 * returns to that section even when the creator is gone, which is the case that
 * needs it most.
 */
export default function CreatorNotFound() {
  return (
    <div className="v-landing">
      <header className="v-landing__bar">
        {/* Reads the query, so it waits behind a boundary rather than making
            this page client-rendered. */}
        <Suspense fallback={null}>
          <CreatorNotFoundBack />
        </Suspense>
        <Link className="v-wordmark" href="/">
          VELORA
        </Link>
      </header>

      <main className="v-focus-page__panel" id="main">
        <h1 className="v-title">This page is not available</h1>
        <p className="v-muted">
          There is nothing to show at this address. The link may be old, or the
          person who published it may have taken it down.
        </p>
        {/*
          One way on, not two. The wordmark above is already a link home, and a
          second control saying so would be the same destination twice — which
          is also two links reading "VELORA" on one page, indistinguishable to
          anybody listening to them rather than looking.
        */}
        <div className="v-landing__actions">
          <Link className="v-btn v-btn--primary" href="/creators">
            Browse creators
          </Link>
        </div>
      </main>
    </div>
  );
}
