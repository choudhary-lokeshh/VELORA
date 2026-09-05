import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSection, PublicShell } from '../../src/product/public-shell';
import { pageMetadata } from '../../src/seo/metadata';
import { aboutRoute } from '../../src/seo/routes';
import { resolvePublicSite } from '../../src/seo/site';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata({ ...aboutRoute, site: resolvePublicSite() });
}

/**
 * What the product is, for somebody who has never heard of it.
 *
 * Every sentence is something the platform does today. The one thing this page
 * is emphatic about is what VELORA is not, because it is the thing a person
 * arriving from a search result is most likely to have assumed — and because a
 * product that let the assumption stand in order to keep the visit would be
 * selling them something else.
 */
export default function AboutPage() {
  return (
    <PublicShell
      currentPath={aboutRoute.path}
      lede="VELORA is an adults-only place to meet people you have not met, one conversation at a time."
      title="What VELORA is"
    >
      <PublicSection heading="A conversation, not a queue of profiles">
        <p>
          The centre of VELORA is a live conversation with one person who is
          looking for the same thing at the same moment. You are not handed a
          stack of profiles to sort through, and there is no score, no ranking,
          and no feed deciding who is worth your time.{' '}
          <Link href="/about/live">How a live conversation actually works</Link>{' '}
          is its own page.
        </p>
      </PublicSection>

      <PublicSection heading="It is not a dating app">
        <p>
          VELORA does not match people for romance. There is no compatibility
          score, no algorithm reading what you like, and nothing that infers
          anything about you from your face, your voice, or where you are. What
          it is for is meeting people — a conversation with a stranger who is
          also here to have one, and whatever the two of you decide that
          becomes.
        </p>
        <p>
          It is for adults. You confirm that yourself when you join, and that is
          a declaration you make rather than an identity check we have run.
        </p>
      </PublicSection>

      <PublicSection heading="Three things you can do here">
        <ul>
          <li>
            Meet somebody live, with your camera on or off, for as long as both
            of you want to keep talking.
          </li>
          <li>
            Stay in touch with the people you both said yes to. Interest is only
            ever mutual, and passing is silent.
          </li>
          <li>
            Read the pages <Link href="/creators">creators publish</Link> and
            join the communities they run.
          </li>
        </ul>
      </PublicSection>

      <PublicSection heading="What it costs">
        <p>
          Meeting people is free. Coins buy two optional things and nothing
          else: a bounded window in which the matcher narrows to what you asked
          for, and gifts and memberships for creators who have published a page.
          Nobody can buy their way into a conversation you have not agreed to.
        </p>
      </PublicSection>

      <PublicSection heading="Where it is, and what it is not yet">
        <p>
          VELORA runs in a browser, on a phone as well as a desktop, and there
          is nothing to install. It is still being built, and pages like this
          one say what works rather than what is planned: messages are not
          end-to-end encrypted, and you are told that here rather than left to
          find out.
        </p>
      </PublicSection>
    </PublicShell>
  );
}
