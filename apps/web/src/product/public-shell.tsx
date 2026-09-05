import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from '../design/icons';
import { ButtonLink } from '../design/primitives';
import {
  creatorsRoute,
  informationalRoutes,
  type IndexableRoute,
} from '../seo/routes';

/**
 * The frame every public page outside the product wears.
 *
 * Three jobs, and they are the same three on all of them: say which product
 * this is, offer the one action a visitor can take without an account, and
 * leave a way to the rest of what is readable without one. It is deliberately
 * the landing page's own frame rather than a second one — a person who follows
 * a link from the entry to an explanation and back has not changed products,
 * and a different bar on each would say they had.
 *
 * There is no session here and nothing waits for one. Everything on these pages
 * is the same for everybody, which is what lets them be delivered whole in the
 * first response instead of assembled after hydration.
 */

/** The page whose own address this is, so a nav never links to where it is. */
function otherPublicPages(current: string): readonly IndexableRoute[] {
  return [...informationalRoutes, creatorsRoute].filter(
    (route) => route.path !== current,
  );
}

export function PublicShell({
  children,
  currentPath,
  lede,
  title,
}: {
  readonly children: ReactNode;
  /** This page's own path, so the footer nav can leave it out. */
  readonly currentPath: string;
  /** The one sentence under the heading. Repeated in the meta description. */
  readonly lede: string;
  readonly title: string;
}) {
  return (
    <div className="v-landing">
      <div className="v-landing__glow" />
      <header className="v-landing__bar">
        <Link className="v-wordmark" href="/">
          <Icon name="sparkle" size="md" />
          VELORA
        </Link>
        <ButtonLink
          data-testid="public-sign-in"
          href="/sign-in"
          tone="secondary"
        >
          Sign in
        </ButtonLink>
      </header>

      <main className="v-public" id="main">
        <h1 className="v-display v-public__title">{title}</h1>
        <p className="v-landing__lede">{lede}</p>
        {children}
        <p className="v-public__cta">
          <ButtonLink
            data-testid="public-start"
            href="/sign-in"
            size="lg"
            tone="primary"
          >
            Get started
          </ButtonLink>
        </p>
      </main>

      <nav aria-label="More about VELORA" className="v-public__nav">
        <ul>
          {otherPublicPages(currentPath).map((route) => (
            <li key={route.path}>
              <Link href={route.path}>{route.title}</Link>
            </li>
          ))}
        </ul>
      </nav>

      <footer className="v-landing__foot">
        <p className="v-caption">
          VELORA is for adults. You confirm that yourself when you join — it is
          a declaration you make, not an identity check we have run.
        </p>
      </footer>
    </div>
  );
}

/**
 * One block of an explanation: a heading somebody can scan to, and prose.
 *
 * A section rather than a bare heading and paragraph so the page has structure
 * a screen reader can move through, which is the same structure a search result
 * reads to decide what the page is about. The two wanting the same thing is not
 * a coincidence.
 */
export function PublicSection({
  children,
  heading,
}: {
  readonly children: ReactNode;
  readonly heading: string;
}) {
  return (
    <section className="v-public__section">
      <h2 className="v-subheading">{heading}</h2>
      {children}
    </section>
  );
}
