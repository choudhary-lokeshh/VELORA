/**
 * Which addresses on this surface a search engine is invited to keep.
 *
 * One list, read by three things that would otherwise drift apart: the sitemap
 * offers exactly these, `robots.txt` disallows everything else that is
 * reachable, and the middleware stamps `X-Robots-Tag: noindex` on every request
 * for an address absent from here. A page becomes indexable by being added to
 * this file and by no other means, which is what makes indexability a decision
 * rather than an accident of routing.
 *
 * Indexability is not a privacy boundary and is never treated as one. Every
 * private address is refused by the server that owns it whether or not a
 * crawler was told to stay away; this only decides what is offered.
 */

/** A static address with copy of its own, and the words search results show. */
export interface IndexableRoute {
  /**
   * The meta description. Written here rather than in the page so the two
   * cannot disagree, and kept inside the length a result actually renders.
   */
  readonly description: string;
  readonly path: string;
  /** The `<title>`, without the surface suffix the template adds. */
  readonly title: string;
}

/**
 * The entry, and the only address whose title is the product's name alone.
 *
 * Every other page reads as `<something> · VELORA`, which is the template the
 * root layout owns. The home page is the one where that would produce
 * `VELORA · VELORA`.
 */
export const homeRoute: IndexableRoute = {
  description:
    'VELORA is an adults-only place to meet new people through live conversations. You choose when you are visible, interest is only ever mutual, and the core of it is free.',
  path: '/',
  title: 'VELORA — meet new people through live conversations',
};

/**
 * The pages that explain the product to somebody who has not signed up.
 *
 * Five, and each one answers a different question a person actually arrives
 * with. There is no page here that exists to hold a phrase: a sixth page
 * covering the same ground as one of these would compete with it for the same
 * reader and teach neither of them anything, which is the whole failure mode of
 * generated landing pages.
 *
 * Every claim on them is something the product does today. Nothing describes a
 * capability behind a provider that is not connected, and nothing describes
 * VELORA as a dating product, because it is not one.
 */
export const aboutRoute: IndexableRoute = {
  description:
    'What VELORA is, who it is for, and what it is not. An adults-only social platform for meeting new people through live conversations, discovering creators, and joining communities — not a dating app.',
  path: '/about',
  title: 'What VELORA is',
};

export const aboutLiveRoute: IndexableRoute = {
  description:
    'How live conversations work on VELORA: one person at a time, both of you looking now, your camera optional and able to go off mid-conversation while your voice continues, and either of you free to leave.',
  path: '/about/live',
  title: 'How live conversations work',
};

export const aboutCreatorsRoute: IndexableRoute = {
  description:
    'Creators publish a public page on VELORA and can run communities people join. Read how a creator page and a community work before you sign up, or browse the creators who have published one.',
  path: '/about/creators',
  title: 'Creators and communities',
};

export const aboutSafetyRoute: IndexableRoute = {
  description:
    'How VELORA handles safety: you are visible only during a window you choose, interest is only ever mutual, and blocking and reporting are one press away and tell the other person nothing.',
  path: '/about/safety',
  title: 'Safety and control',
};

export const aboutQuestionsRoute: IndexableRoute = {
  description:
    'Answers to what people ask before joining VELORA — whether it is a dating app, whether a camera is required, what costs nothing, and how to close an account.',
  path: '/about/questions',
  title: 'Questions people ask',
};

export const informationalRoutes: readonly IndexableRoute[] = [
  aboutRoute,
  aboutLiveRoute,
  aboutCreatorsRoute,
  aboutSafetyRoute,
  aboutQuestionsRoute,
];

/**
 * The public listing of creators who have published a page.
 *
 * Separate from the informational set because its content is other people's
 * rather than ours, and because it is the hub every creator address is reached
 * from — both for a person browsing and for a crawler that has been given a
 * sitemap and nothing else.
 */
export const creatorsRoute: IndexableRoute = {
  description:
    'Creators who have published a public page on VELORA. Every page here was published by the creator themselves; nothing is listed by popularity and nothing here can be bought.',
  path: '/creators',
  title: 'Creators on VELORA',
};

/** Every static address offered to a crawler, in the order a person meets them. */
export const staticIndexableRoutes: readonly IndexableRoute[] = [
  homeRoute,
  ...informationalRoutes,
  creatorsRoute,
];

/**
 * Addresses that are public, reachable, and deliberately not indexed.
 *
 * Each is a doorway rather than a destination. A sign-in form, an invitation
 * landing, and a payment return have nothing a search result could usefully
 * offer, and an invitation in particular would be indexed under a code that
 * belongs to one person. They are `noindex` rather than disallowed, so a
 * crawler that follows a shared link reads the refusal instead of guessing.
 */
const publicUnindexedPrefixes: readonly string[] = [
  '/checkout',
  '/invite',
  // A window is news for a day and then it is a page about an afternoon that
  // has passed. It is deliberately not disallowed: the way this address travels
  // is somebody pasting it into a chat, and the preview that produces is worth
  // having.
  '/live-window',
  '/sign-in',
  '/welcome',
];

/**
 * Everything a crawler is asked not to fetch at all.
 *
 * Broader than the unindexed set above and for a different reason: these
 * addresses answer nothing without a session, so fetching one costs a request
 * and returns a loading state. `robots.txt` is a request, not a control —
 * authentication is what actually refuses them — and the list is written as
 * prefixes because every one of them owns its whole subtree.
 */
export const crawlDisallowedPrefixes: readonly string[] = [
  '/checkout',
  '/discover',
  '/introductions',
  '/invite',
  '/messages',
  '/notifications',
  '/people',
  '/sign-in',
  '/welcome',
  '/you',
];

/*
 * `/live` is deliberately absent from that list.
 *
 * A `robots.txt` prefix has no word boundary, so `Disallow: /live` also covers
 * `/live-window/…` — the address somebody pastes into a chat, whose whole value
 * is the preview it produces. Blocking it would have cost the one thing that
 * route exists for, and gained one saved request against a page that already
 * carries `noindex` in its header and its document. The cheaper mistake is the
 * extra request.
 */

const staticIndexablePaths = new Set(
  staticIndexableRoutes.map((route) => route.path),
);

/**
 * The two public addresses whose content belongs to somebody else.
 *
 * A creator who has published a page, and a club that creator has published
 * inside it. Both are matched by shape here and answered by the server on the
 * way through: this decides that the *address* may be indexed, and the page
 * itself still refuses when the server publishes nothing for it.
 */
const publicEntityPatterns: readonly RegExp[] = [
  /^\/c\/[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]$/u,
  /^\/c\/[a-z0-9][a-z0-9_-]{1,28}[a-z0-9]\/club\/[a-z0-9][a-z0-9_-]{1,38}[a-z0-9]$/u,
];

/**
 * Whether this address may carry an index directive at all.
 *
 * The join step inside a club is deliberately excluded by the patterns above:
 * it is an action, it needs a session, and it has no content of its own.
 */
export function pathIsIndexable(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (publicUnindexedPrefixes.some((prefix) => underPrefix(path, prefix))) {
    return false;
  }
  if (staticIndexablePaths.has(path)) return true;
  return publicEntityPatterns.some((pattern) => pattern.test(path));
}

/** Whether `robots.txt` asks a crawler to skip this address. */
export function pathIsCrawlDisallowed(pathname: string): boolean {
  const path = normalizePath(pathname);
  return crawlDisallowedPrefixes.some((prefix) => underPrefix(path, prefix));
}

/**
 * One address written one way.
 *
 * A trailing slash and the same path without one are the same page to this
 * product and two pages to a crawler, so the trailing slash is dropped before
 * anything compares or publishes an address. The root keeps its single slash,
 * because dropping that leaves the empty string.
 */
export function normalizePath(pathname: string): string {
  const path = pathname.split('?')[0]?.split('#')[0] ?? pathname;
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path === '' ? '/' : path;
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}
