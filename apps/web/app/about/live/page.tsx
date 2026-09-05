import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSection, PublicShell } from '../../../src/product/public-shell';
import { pageMetadata } from '../../../src/seo/metadata';
import { aboutLiveRoute } from '../../../src/seo/routes';
import { resolvePublicSite } from '../../../src/seo/site';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata({ ...aboutLiveRoute, site: resolvePublicSite() });
}

/**
 * The mechanics of the product's primary destination.
 *
 * Written for the question somebody actually has before signing up — do I have
 * to show my face, can I leave, who am I going to be talking to — rather than
 * for the phrase somebody might type. The two turn out to be close, because the
 * question is the phrase.
 */
export default function AboutLivePage() {
  return (
    <PublicShell
      currentPath={aboutLiveRoute.path}
      lede="One person, both of you looking at the same time, and no obligation to stay."
      title="How live conversations work"
    >
      <PublicSection heading="You are matched with one person who is also looking">
        <p>
          When you start looking, VELORA puts you with one other adult who
          started looking too. Nobody is pulled out of a list of people who were
          here earlier, and nothing is shown to you because it was popular.
          While there is nobody yet, the screen says so and keeps your place —
          there is no queue position, no estimate, and nobody is invented to
          fill the wait.
        </p>
      </PublicSection>

      <PublicSection heading="Your camera is optional, and it stays optional">
        <p>
          You can start with your camera off, and you can turn it off partway
          through. Your voice keeps working when you do — the conversation
          continues, and the other person is told your camera is off rather than
          being left looking at a frozen picture of you. The same is true in
          reverse: a person who has turned their camera off is shown as here and
          quiet, not as gone.
        </p>
      </PublicSection>

      <PublicSection heading="Either of you can end it, at any point">
        <p>
          Leaving takes one press, and so does moving on to the next person.
          Neither tells the other person anything about why, and neither costs
          you anything.
        </p>
      </PublicSection>

      <PublicSection heading="Nothing continues unless both of you want it to">
        <p>
          A conversation ends when it ends. It becomes something that carries on
          only if both of you say so — and if only one of you does, the other is
          never told. Passing is silent, in both directions, every time.
        </p>
      </PublicSection>

      <PublicSection heading="What you can choose, and what it costs">
        <p>
          Meeting anyone is free. If you want the matcher narrowed — to a
          region, a language you speak, or a category people have declared about
          themselves — that is a bounded window you buy with coins, and it
          narrows both directions rather than only your own search. Nothing you
          declare about yourself is shown to anybody, and nothing about you is
          guessed from your camera, your voice, or your name.
        </p>
      </PublicSection>

      <PublicSection heading="If a conversation goes wrong">
        <p>
          Blocking and reporting are one press away during the conversation and
          afterwards, and neither tells the other person anything.{' '}
          <Link href="/about/safety">What VELORA does about safety</Link> covers
          the rest.
        </p>
      </PublicSection>
    </PublicShell>
  );
}
