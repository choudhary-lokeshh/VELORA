import type { Metadata } from 'next';
import Link from 'next/link';

import { PublicShell } from '../../../src/product/public-shell';
import { pageMetadata } from '../../../src/seo/metadata';
import { aboutQuestionsRoute } from '../../../src/seo/routes';
import { resolvePublicSite } from '../../../src/seo/site';
import { faqData, JsonLd } from '../../../src/seo/structured-data';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return pageMetadata({ ...aboutQuestionsRoute, site: resolvePublicSite() });
}

/**
 * The questions people ask before they join, answered once.
 *
 * One array, rendered on the page and handed to the structured data beside it,
 * so what a search result shows and what a person reads cannot come apart. An
 * answer that is only in the structured data would be a claim made to machines
 * and withheld from people, which is the thing structured data is not for.
 */
const questions: readonly {
  readonly answer: string;
  readonly question: string;
}[] = [
  {
    answer:
      'VELORA is an adults-only social platform for meeting people you have not met, mainly through live conversations with one person at a time. It also has creator pages and the communities creators run.',
    question: 'What is VELORA?',
  },
  {
    answer:
      'No. There is no romantic matching, no compatibility score, and nothing that infers what you might like. It is for meeting people and having a conversation; what that becomes is between the two of you.',
    question: 'Is VELORA a dating app?',
  },
  {
    answer:
      'No. You can start a live conversation with your camera off, and you can turn it off partway through — your voice keeps working, and the other person is shown as talking to somebody whose camera is off rather than to a frozen picture.',
    question: 'Do I need to turn my camera on?',
  },
  {
    answer:
      'Meeting people is free, and so is talking to anybody the matcher finds. Coins are optional and buy two things: a bounded window in which the matcher narrows to a region, a language you speak, or a declared category, and gifts and memberships for creators who have published a page.',
    question: 'Is it free?',
  },
  {
    answer:
      'A premium preference narrows who the matcher will pair you with for a set window, and it holds from both sides rather than only your own search. You are charged once, on the first conversation the narrowing actually produced, and the window keeps narrowing until it expires.',
    question: 'How do premium preferences work?',
  },
  {
    answer:
      'A conversation carries on afterwards only if both people said yes. If only one did, the other is never told, and nobody is ever shown who passed on them.',
    question: 'How does staying in touch work?',
  },
  {
    answer:
      'Both are one press away during a conversation and after it. Neither tells the other person anything — they are not notified, not shown a message, and cannot tell from how the product behaves.',
    question: 'How do I report or block somebody?',
  },
  {
    answer:
      'You can close your account from your own settings inside the product. It is something you do rather than something you request.',
    question: 'How do I delete my account?',
  },
  {
    answer:
      'You must be an adult. You confirm that yourself when you join — it is a declaration you make, not an identity check VELORA has run, and VELORA does not verify anybody’s identity.',
    question: 'Who is allowed to use VELORA?',
  },
];

export default function AboutQuestionsPage() {
  return (
    <PublicShell
      currentPath={aboutQuestionsRoute.path}
      lede="The things people ask before signing up, answered with what the product actually does."
      title="Questions people ask"
    >
      <JsonLd data={faqData(questions)} />
      {questions.map((entry) => (
        <section className="v-public__section" key={entry.question}>
          <h2 className="v-subheading">{entry.question}</h2>
          <p>{entry.answer}</p>
        </section>
      ))}
      <section className="v-public__section">
        <h2 className="v-subheading">Something else?</h2>
        <p>
          <Link href="/about/live">How live conversations work</Link> and{' '}
          <Link href="/about/safety">safety and control</Link> go further than
          these answers do. Once you have an account, help and support are
          inside the product.
        </p>
      </section>
    </PublicShell>
  );
}
