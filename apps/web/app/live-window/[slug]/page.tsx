import type { Metadata } from 'next';
import Link from 'next/link';

import { LiveWindows } from '../../../src/product/live-windows';
import { PublicShell } from '../../../src/product/public-shell';
import { ShareControl } from '../../../src/product/share';
import { readLiveWindows } from '../../../src/server/public-reads';
import { pageMetadata } from '../../../src/seo/metadata';
import { resolvePublicSite } from '../../../src/seo/site';

export const dynamic = 'force-dynamic';

/**
 * A scheduled time, at an address somebody can send to somebody else.
 *
 * Never indexed. A window is news for a day and then it is a page describing an
 * afternoon that has passed, and a search result pointing at one would be
 * offering somebody a thing that is over. It is still worth a social preview,
 * because the way this address travels is a person pasting it into a chat.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const found = (await readLiveWindows()).find(
    (window) => window.slug === slug,
  );
  return pageMetadata({
    description:
      found === undefined
        ? 'This time has passed. Meeting people on VELORA works at any hour.'
        : `${found.title} — a time VELORA is asking people to be looking at once. Meeting people is free, and works at any hour.`,
    path: `/live-window/${slug}`,
    site: resolvePublicSite(),
    title: found?.title ?? 'This time has passed',
  });
}

/**
 * One window's page.
 *
 * The times are read from the same public listing everything else reads, so a
 * window that has ended, been withdrawn, or never existed are one answer — and
 * that answer is a page rather than an error, because somebody following a
 * friend's link deserves to be told what happened and where to go instead.
 *
 * There is no attendee count here and no way to add one. Nothing knows how many
 * people will come, and a number on this page would be the one dishonest thing
 * in an otherwise honest feature.
 */
export default async function LiveWindowPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  const site = resolvePublicSite();
  const windows = await readLiveWindows();
  const found = windows.find((window) => window.slug === slug);

  if (found === undefined) {
    return (
      <PublicShell
        currentPath={`/live-window/${slug}`}
        lede="This time has passed, or the link has changed. Nothing about meeting people depends on it."
        title="This time has passed"
      >
        <section className="v-public__section">
          <h2 className="v-subheading">You can still meet somebody</h2>
          <p>
            Live conversations work at any hour, and always have.{' '}
            <Link href="/about/live">How they work</Link> explains what happens
            when you start looking.
          </p>
        </section>
        {windows.length === 0 ? null : <LiveWindows windows={windows} />}
      </PublicShell>
    );
  }

  return (
    <PublicShell
      currentPath={`/live-window/${slug}`}
      lede={
        found.state === 'active'
          ? 'This is happening now. Start looking and you will be put with somebody who is looking too.'
          : 'A time VELORA is asking everybody to be looking at once, so there are people to meet rather than an empty room.'
      }
      title={found.title}
    >
      <LiveWindows windows={[found]} />
      <section className="v-public__section">
        <h2 className="v-subheading">What actually happens</h2>
        <p>
          Nothing is reserved and nothing is promised. More people intend to be
          looking during this window, which is the only thing that makes a live
          product feel alive — and meeting somebody works exactly the same
          before it, during it, and after it.
        </p>
        <p>Nobody is told how many people are coming, because nothing knows.</p>
      </section>
      <ShareControl
        label="Share this time"
        origin={site.origin ?? ''}
        path={`/live-window/${found.slug}`}
        testId="live-window-share"
        text={`${found.title} on VELORA`}
        title={found.title}
      />
    </PublicShell>
  );
}
