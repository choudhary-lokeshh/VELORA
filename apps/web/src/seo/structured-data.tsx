import { absoluteUrl, type PublicSite } from './site';

/**
 * The machine-readable half of a page, and the rule that keeps it honest.
 *
 * Structured data may only restate what the page already shows a person. That
 * is not a style preference: a rating nobody left, a member count nobody
 * counted, or an FAQ with no questions on the page are all things a search
 * engine treats as a claim about the product, and all three would be claims
 * VELORA cannot support. So there is no `AggregateRating` here, no `Review`, no
 * `interactionStatistic`, and no `Event` for anything that is not scheduled.
 *
 * What is here is identity and structure: which organisation this is, what the
 * site is, where a page sits, and — on the one page that has visible questions
 * and answers — those questions and answers.
 */

type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

/**
 * One `application/ld+json` block.
 *
 * `<` is escaped on the way out. Everything passed in today is written in this
 * repository, but a document that closes its own script tag because somebody
 * later passed a creator's bio through here is a defect worth making
 * structurally impossible rather than remembering not to cause.
 */
export function JsonLd({ data }: { readonly data: JsonValue }) {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</gu, '\\u003c'),
      }}
      type="application/ld+json"
    />
  );
}

/**
 * Who publishes this, and what the site is.
 *
 * Carried by the entry page only. Repeating an organisation on every page says
 * nothing extra and gives every page a second thing that can drift.
 */
export function organizationData(site: PublicSite): JsonValue {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@id': `${site.origin ?? ''}#organization`,
        '@type': 'Organization',
        description:
          'An adults-only social platform for meeting new people through live conversations.',
        name: 'VELORA',
        url: absoluteUrl(site, '/'),
      },
      {
        '@id': `${site.origin ?? ''}#website`,
        '@type': 'WebSite',
        name: 'VELORA',
        publisher: { '@id': `${site.origin ?? ''}#organization` },
        url: absoluteUrl(site, '/'),
      },
    ],
  };
}

/** Where this page sits, named exactly as its links name it. */
export function breadcrumbData(
  site: PublicSite,
  trail: readonly { readonly name: string; readonly path: string }[],
): JsonValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, index) => ({
      '@type': 'ListItem',
      item: absoluteUrl(site, step.path),
      name: step.name,
      position: index + 1,
    })),
  };
}

/**
 * The questions and answers this page shows, and only those.
 *
 * The caller passes the same array it renders, so a question that exists here
 * and not on the page is not a thing anybody can write by accident.
 */
export function faqData(
  questions: readonly { readonly answer: string; readonly question: string }[],
): JsonValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((entry) => ({
      '@type': 'Question',
      acceptedAnswer: { '@type': 'Answer', text: entry.answer },
      name: entry.question,
    })),
  };
}

/**
 * A page whose subject is a person, for a creator who published one.
 *
 * `ProfilePage` and nothing more. The person carries the name and handle the
 * page itself shows and no other field: an identifier, a country, a language, a
 * membership, or anything the server did not put in the public projection has
 * no business being repeated in a format built for machines to collect.
 */
export function profilePageData(input: {
  readonly description?: string | undefined;
  readonly displayName: string;
  readonly handle: string;
  readonly path: string;
  readonly site: PublicSite;
}): JsonValue {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      alternateName: input.handle,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      name: input.displayName,
    },
    url: absoluteUrl(input.site, input.path),
  };
}
