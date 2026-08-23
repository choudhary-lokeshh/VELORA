'use client';

import Link from 'next/link';

import { Icon, type IconName } from '../design/icons';
import { ButtonLink } from '../design/primitives';

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
    body: 'Blocking and reporting are always one press away, and neither tells the other person anything. Nothing on VELORA can be bought, so nobody can pay their way to your attention.',
    icon: 'shield',
    title: 'Safety without a negotiation',
  },
];

export function Landing() {
  return (
    <div className="v-landing">
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
        <div className="v-landing__glow" />
        <div className="v-landing__copy">
          <p className="v-label" style={{ color: 'var(--ember)' }}>
            Adults only
          </p>
          <h1 className="v-display">Meet people who said yes too.</h1>
          <p className="v-landing__lede">
            VELORA introduces two adults only when both of them want it. You
            choose when you are visible, you are never told who passed, and
            nothing here can be bought.
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

      <footer className="v-landing__foot">
        <p className="v-caption">
          VELORA is in development. Messages are not end-to-end encrypted, and
          calls carry no audio or video yet.
        </p>
      </footer>
    </div>
  );
}
