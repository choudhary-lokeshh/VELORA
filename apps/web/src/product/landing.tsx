'use client';

import Link from 'next/link';

import type { LiveWindow } from '@velora/consumer-client';

import { Icon, type IconName } from '../design/icons';
import { ButtonLink } from '../design/primitives';
import { LiveWindows } from './live-windows';

/**
 * The public entry.
 *
 * Every sentence here is something the platform actually does. There is no
 * member count, no testimonial, no "join thousands", and no photograph of
 * anybody: `docs/design/01-design-principles.md` rules out gamified pressure and
 * artificial scarcity, and a number nobody can verify is both.
 *
 * It also does not promise what is not built. Nothing claims verified identity,
 * encrypted messaging, or a purchase — self-declaration is called a declaration,
 * and the parts of the product that are not enabled are simply not advertised.
 */

interface Point {
  readonly body: string;
  readonly icon: IconName;
  readonly title: string;
}

const points: readonly Point[] = [
  {
    body: 'You are shown to other people only during a window you choose, and it ends on its own. There is no green dot, and nobody can see where you are.',
    icon: 'clock',
    title: 'Visible when you decide',
  },
  {
    body: 'Interest is only ever mutual. The other person hears nothing unless they say yes too, and passing is silent — nobody is told they were passed over.',
    icon: 'link',
    title: 'Both, or neither',
  },
  {
    /*
     * This sentence used to end "nothing on VELORA can be bought". That was
     * true when it was written and stopped being true when coins shipped: a
     * bounded narrowing of your own search, a gift, and a membership are all
     * purchases. What survived the change is the claim that actually matters to
     * somebody standing at the door, and it is still exactly true — no amount
     * of money puts a person in a conversation you have not agreed to.
     */
    body: 'Blocking and reporting are always one press away, and neither tells the other person anything. Nobody can buy their way into a conversation you have not agreed to.',
    icon: 'shield',
    title: 'Safety without a negotiation',
  },
];

export function Landing({
  liveWindows = [],
}: {
  /**
   * The scheduled times, read on the server so they are in the first response.
   *
   * Empty is the ordinary state and renders nothing at all. A heading with no
   * times under it would be an announcement that there is nothing to announce.
   */
  readonly liveWindows?: readonly LiveWindow[];
}) {
  return (
    <div className="v-landing">
      {/*
        Outside the hero on purpose. The hero is a bounded reading column, and a
        wash anchored to it stops at that column's edge — which reads as a panel
        somebody forgot to style rather than as light.
      */}
      <div className="v-landing__glow" />
      <header className="v-landing__bar">
        <Link className="v-wordmark" href="/">
          <Icon name="sparkle" size="md" />
          VELORA
        </Link>
        <ButtonLink
          data-testid="landing-sign-in"
          href="/sign-in"
          tone="secondary"
        >
          Sign in
        </ButtonLink>
      </header>

      <main className="v-landing__hero" id="main">
        <div className="v-landing__copy">
          <p className="v-label v-accent">Adults only</p>
          {/*
            The one heading on the page, and it names what somebody came to do
            rather than what the product is proud of. "Meet people who said yes
            too" was true and said nothing to a person who had never heard of
            VELORA; the mutual half of it moved down one line, where it reads as
            a promise instead of as a riddle.
          */}
          <h1 className="v-display v-wrap">
            Meet new people, one live conversation at a time.
          </h1>
          <p className="v-landing__lede">
            VELORA puts two adults in a conversation only when both of them want
            it. You choose when you are visible, you are never told who passed,
            and nobody can buy their way to you.
          </p>
          <div className="v-landing__actions">
            <ButtonLink
              data-testid="landing-start"
              href="/sign-in"
              size="lg"
              tone="primary"
            >
              Get started
            </ButtonLink>
          </div>
          <p className="v-caption v-quiet">
            You must be an adult to use VELORA. We ask you to confirm it — that
            is a declaration you make, not an identity check we have run.
          </p>
        </div>
      </main>

      {liveWindows.length === 0 ? null : (
        <div className="v-landing__windows">
          <LiveWindows windows={liveWindows} />
        </div>
      )}

      <section aria-label="How VELORA works" className="v-landing__points">
        {points.map((point) => (
          <article className="v-landing__point" key={point.title}>
            <span className="v-landing__point-mark">
              <Icon name={point.icon} size="md" />
            </span>
            <h2 className="v-subheading">{point.title}</h2>
            <p className="v-small v-muted">{point.body}</p>
          </article>
        ))}
      </section>

      {/*
        The way to the rest of what is readable without an account.

        Real links with the destination's own name as their text, because that
        is what a person scanning needs and what tells a crawler what is on the
        other side. Five of them, not a wall: a footer carrying every phrase
        somebody hoped to rank for is a footer nobody reads, and this product
        has exactly five things worth explaining before somebody joins.
      */}
      <nav aria-label="More about VELORA" className="v-public__nav">
        <ul>
          <li>
            <Link href="/about">What VELORA is</Link>
          </li>
          <li>
            <Link href="/about/live">How live conversations work</Link>
          </li>
          <li>
            <Link href="/about/creators">Creators and communities</Link>
          </li>
          <li>
            <Link href="/about/safety">Safety and control</Link>
          </li>
          <li>
            <Link href="/about/questions">Questions people ask</Link>
          </li>
        </ul>
      </nav>

      {/*
        What is still true about a product in development, and only what is.

        This sentence used to end "calls carry no audio or video yet". That was
        written before a live conversation carried anything and stopped being
        true when the transport shipped: two people in a live encounter now see
        and hear each other. Leaving it up told every first visitor that the one
        thing the heading above promises does not work. What survives is the
        claim that is still exactly true and that somebody deciding whether to
        type something private deserves before they do.

        The one-to-one call placed from a conversation is still signalling
        only, and says so on its own panel, where the person is about to place
        one rather than three screens earlier.
      */}
      <footer className="v-landing__foot">
        <p className="v-caption">
          VELORA is in development, and messages are not end-to-end encrypted.
        </p>
      </footer>
    </div>
  );
}
