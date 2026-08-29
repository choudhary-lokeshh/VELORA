import type { IconName } from '../design/icons';

/**
 * The consumer's map of the product.
 *
 * Five destinations, named for what somebody is trying to do rather than for the
 * domain that answers them. `AGENTS.md` keeps backend architecture out of client
 * responsibility, and a navigation with an item per backend module would be
 * exactly that leak — which is why calling is not here. A call is placed against
 * a mutual introduction and against nothing else, so it belongs where the
 * relationship is rather than in a destination of its own.
 *
 * Account, availability, safety, and memberships sit under one "You" so the
 * first four items stay about other people, which is what the product is for.
 */
export interface Destination {
  readonly icon: IconName;
  readonly id: string;
  readonly label: string;
  /** Matched as a prefix, so `/messages/abc` still lights up Messages. */
  readonly path: string;
  readonly signal?: 'conversations' | 'notifications';
}

export const destinations: readonly Destination[] = [
  { icon: 'compass', id: 'discover', label: 'Discover', path: '/discover' },
  {
    icon: 'link',
    id: 'introductions',
    label: 'Introductions',
    path: '/introductions',
  },
  {
    icon: 'message',
    id: 'messages',
    label: 'Messages',
    path: '/messages',
    signal: 'conversations',
  },
  {
    icon: 'bell',
    id: 'notifications',
    label: 'Notices',
    path: '/notifications',
    signal: 'notifications',
  },
  { icon: 'user', id: 'you', label: 'You', path: '/you' },
];

/** Every route the shell owns, used to decide whether a path is inside it. */
export const applicationPaths: readonly string[] = [
  ...destinations.map((destination) => destination.path),
  '/welcome',
];

export function isCurrent(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * What to call the place a Back control returns to, when it has a name.
 *
 * Only a destination the navigation already names, and only when the target is
 * that destination itself rather than something inside it. Naming a page this
 * table does not name would mean inventing a word for it here, and a Back
 * labelled with a guess is worse than one labelled with an arrow.
 *
 * The query is dropped before matching: a Back that carries which section of
 * Discover somebody was reading still returns to Discover, and that is what it
 * should be called.
 */
export function destinationName(path: string): string | undefined {
  const address = path.split('?')[0] ?? path;
  return destinations.find((destination) => destination.path === address)
    ?.label;
}

/**
 * Where each page that can be navigated into is navigated into *from*.
 *
 * Declared rather than derived. Removing the last segment of an address looks
 * like the same thing and is not: a person is opened from Discover and there is
 * no `/people` listing, so truncation offers a Back that lands on an address
 * this product does not serve. The same is true of `/c/<handle>`. A nested
 * route missing from this table gets no Back at all, which is a visible gap
 * rather than a link into nothing.
 *
 * Each parent is an address the application serves, so a Back built from one
 * cannot 404 however the page was reached. A parent may be built from the
 * match — a club's way out is its own creator's page — but never by truncating
 * the path, because truncation is exactly what produced a Back into nothing.
 */
const ancestry: readonly {
  readonly of: RegExp;
  readonly parent: string | ((match: RegExpMatchArray) => string);
}[] = [
  { of: /^\/messages\/[^/]+$/u, parent: '/messages' },
  { of: /^\/people\/[^/]+$/u, parent: '/discover' },
  {
    of: /^\/c\/([^/]+)\/club\/([^/]+)\/join$/u,
    parent: (match) => `/c/${match[1] ?? ''}/club/${match[2] ?? ''}`,
  },
  {
    of: /^\/c\/([^/]+)\/club\/[^/]+$/u,
    parent: (match) => `/c/${match[1] ?? ''}`,
  },
  { of: /^\/c\/[^/]+$/u, parent: '/discover' },
  // A provider sends somebody back to these, so they are arrived at from
  // outside the site entirely. Memberships is where the thing they were paying
  // for lives, which is the only destination that is useful either way.
  { of: /^\/checkout\/[^/]+$/u, parent: '/you/memberships' },
  { of: /^\/you\/[^/]+$/u, parent: '/you' },
];

/** The destination one level up, when this page has one. */
export function parentOf(pathname: string): string | undefined {
  for (const entry of ancestry) {
    const match = entry.of.exec(pathname);
    if (match === null) continue;
    return typeof entry.parent === 'string'
      ? entry.parent
      : entry.parent(match);
  }
  return undefined;
}

/** This page's own address, query and all, as somewhere to come back to. */
export function addressOf(
  pathname: string,
  parameters: URLSearchParams,
): string {
  const query = parameters.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

/**
 * A link into a nested page that remembers where it was followed from.
 *
 * Only the address is carried, and only this origin's. What it buys is the
 * difference between returning to Discover and returning to the part of
 * Discover somebody was actually reading.
 */
export function nestedHref(href: string, from: string): string {
  return `${href}?from=${encodeURIComponent(from)}`;
}

/**
 * Where Back goes, given what the page was opened from.
 *
 * The parent alone is correct but forgetful: Discover keeps which section is
 * being browsed in the address, so returning to the bare parent from a creator
 * lands on People after somebody was reading Creators. A link into a nested
 * page therefore carries where it was followed from, and this restores it.
 *
 * What arrives in `from` is somebody else's string — it comes off the address —
 * so it is not trusted to be a destination. It is accepted only when it is this
 * origin's own path *and* is the declared parent, optionally carrying a query.
 * Anything else falls back to the parent, so the worst a crafted `from` can do
 * is send somebody one level up, which is where Back was going anyway.
 */
export function backTarget(
  pathname: string,
  from: string | null,
): string | undefined {
  const parent = parentOf(pathname);
  if (parent === undefined) return undefined;
  const requested = safeReturnPath(from);
  if (requested === undefined) return parent;
  return requested === parent || requested.startsWith(`${parent}?`)
    ? requested
    : parent;
}

/**
 * Whether a deep link may be followed after authentication.
 *
 * Only a path on this origin. A value starting with two slashes or a scheme is
 * an absolute address somebody else chose, and following one would turn the
 * sign-in page into an open redirect.
 */
export function safeReturnPath(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!value.startsWith('/')) return undefined;
  if (value.startsWith('//')) return undefined;
  if (value.includes('\\')) return undefined;
  return value;
}
