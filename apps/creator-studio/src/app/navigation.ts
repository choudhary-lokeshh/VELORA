import type { IconName } from '../design/icons';

/**
 * The creator's map of their own business.
 *
 * Five destinations, named for what a creator is trying to do rather than for
 * the domain that answers them. `AGENTS.md` keeps backend architecture out of
 * client responsibility, and a navigation with an item per backend module would
 * be exactly that leak — which is why "Offers", "Payouts", "Onboarding" and
 * "Safety" are not here. Selling, earnings and payouts are three reads of one
 * question a creator asks once, so they live under Money; standing, policies
 * and the session live under Account, reached from the identity affordance so
 * the five destinations stay about the work.
 *
 * Everything a creator makes is under Catalog or Clubs, and the public result of
 * both is under Profile. That is the whole product.
 */
export interface Destination {
  readonly icon: IconName;
  readonly id: string;
  readonly label: string;
  /** Matched as a prefix, so `/clubs/abc` still lights up Clubs. */
  readonly path: string;
}

export const destinations: readonly Destination[] = [
  { icon: 'home', id: 'home', label: 'Home', path: '/home' },
  { icon: 'user', id: 'profile', label: 'Profile', path: '/profile' },
  { icon: 'draft', id: 'catalog', label: 'Catalog', path: '/catalog' },
  { icon: 'users', id: 'clubs', label: 'Clubs', path: '/clubs' },
  { icon: 'wallet', id: 'money', label: 'Money', path: '/money' },
];

/** The account area, reached from the identity affordance rather than the nav. */
export const accountPath = '/account';

export function isCurrent(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The destination one level up, when there is one.
 *
 * Only the five roots and the account area are places somebody arrives at.
 * Everything under one of them is a page somebody navigated into and has to be
 * able to leave, which on a phone means a visible control rather than the
 * browser chrome the hand is nowhere near.
 */
export function parentOf(pathname: string): string | undefined {
  if (pathname === accountPath) return undefined;
  if (destinations.some((destination) => destination.path === pathname)) {
    return undefined;
  }
  const separator = pathname.lastIndexOf('/');
  if (separator <= 0) return undefined;
  return pathname.slice(0, separator);
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
