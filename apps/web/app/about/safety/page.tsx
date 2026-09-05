import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicSection, PublicShell } from '../../../src/product/public-shell';
import { pageMetadata } from '../../../src/seo/metadata';
import { aboutSafetyRoute } from '../../../src/seo/routes';
import { resolvePublicSite } from '../../../src/seo/site';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata({ ...aboutSafetyRoute, site: resolvePublicSite() });
}

/**
 * What the product does about the thing people are actually worried about.
 *
 * The whole page is written in the negative where the negative is the point: a
 * safety page that lists features is reassuring, and a safety page that says
 * what cannot happen to you is useful. Nothing here describes a control that
 * does not exist, and nothing describes a review process that no one performs.
 */
export default function AboutSafetyPage() {
  return (
    <PublicShell
      currentPath={aboutSafetyRoute.path}
      lede="Leaving, blocking, and reporting all take one press, and none of them starts a conversation with the other person."
      title="Safety and control"
    >
      <PublicSection heading="You are visible when you decide to be">
        <p>
          Nobody can see that you are here until you start looking, and you stop
          being visible when you stop. There is no green dot, no last-seen time,
          and nothing that shows where you are.
        </p>
      </PublicSection>

      <PublicSection heading="Interest is only ever mutual">
        <p>
          Somebody hears from you only if you both said yes. If one of you did
          and the other did not, the one who did is never told — passing is
          silent, and nobody is handed a list of people who passed on them.
        </p>
      </PublicSection>

      <PublicSection heading="Blocking and reporting say nothing to the other person">
        <p>
          Both are available during a conversation and after it has ended. The
          person you block is not told, is not shown a message, and does not
          find out by the way the product behaves. A report goes to the people
          who review them, and what happens next is not something the person you
          reported can trace back to you.
        </p>
      </PublicSection>

      <PublicSection heading="What is never inferred about you">
        <p>
          Nothing about you is guessed from your camera, your face, your voice,
          your name, or how you behave. The one matching category VELORA
          collects is one you declare yourself, you can decline it, and it is
          never shown to anybody — not on a card, not in a conversation, and not
          to the person you are talking to.
        </p>
      </PublicSection>

      <PublicSection heading="Nobody can buy their way to you">
        <p>
          Coins can narrow your own search and can buy a gift or a membership
          from a creator who published a page. They cannot buy a conversation
          with a particular person, cannot put anybody in front of you, and
          cannot make somebody's interest in you count for more than yours in
          them.
        </p>
      </PublicSection>

      <PublicSection heading="Leaving for good">
        <p>
          You can close your account from inside the product, and closing it is
          a thing you do rather than a thing you ask for.{' '}
          <Link href="/about/questions">The questions page</Link> says what
          closing does.
        </p>
      </PublicSection>

      <PublicSection heading="What this is not">
        <p>
          VELORA does not verify anybody&apos;s identity, and being here is not
          evidence that a person is who they say they are. Messages are not
          end-to-end encrypted. Both of those are true today, and this page
          would be worth less if it left them out.
        </p>
      </PublicSection>
    </PublicShell>
  );
}
