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
