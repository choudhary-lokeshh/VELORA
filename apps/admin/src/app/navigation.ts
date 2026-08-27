import type { IconName } from '../design/icons';

/**
 * The operator's map of the platform.
 *
 * Four destinations, named for the work rather than for the domain that answers
 * it. `AGENTS.md` keeps backend architecture out of client responsibility, and
 * a console with an item per backend module would be exactly that leak — which
 * is why "Billing", "Moderation", "Notifications", and "RTC" are not here.
 *
 * Queues is the operator's own work: the cases assigned to a queue and the
 * appeals against decisions already made. Creators is the directory and the
 * enforcement that acts on it. Money is what the platform holds and the one
 * financial operation there is. Platform is every subsystem's health in one
 * place, because an operator asking "is anything stuck" should ask once.
 *
 * The session sits under Access, reached from the foot of the navigation, so
 * the four destinations stay about the platform rather than about the operator.
 */
export interface Destination {
  readonly icon: IconName;
  readonly id: string;
  readonly label: string;
  /** Matched as a prefix, so `/queues/abc` still lights up Queues. */
  readonly path: string;
}

export const destinations: readonly Destination[] = [
  { icon: 'queue', id: 'queues', label: 'Queues', path: '/queues' },
  { icon: 'users', id: 'creators', label: 'Creators', path: '/creators' },
  { icon: 'ledger', id: 'money', label: 'Money', path: '/money' },
  { icon: 'gauge', id: 'platform', label: 'Platform', path: '/platform' },
];

/** The session area, reached from the foot rather than from the destinations. */
export const accessPath = '/access';

/**
 * The subsystems Platform reports on, which are peers rather than children.
 *
 * They sit under `/platform` because one of them has to be the address somebody
 * lands on, not because three of them are inside the fourth. An operator moves
 * between them with the tabs on the screen, so nothing here is a place to come
 * back from.
 */
export const platformAreas = [
  { label: 'Media', path: '/platform' },
  { label: 'Notifications', path: '/platform/notifications' },
  { label: 'Calling', path: '/platform/rtc' },
  { label: 'Identity', path: '/platform/identity' },
] as const;

export function isCurrent(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The destination one level up, when there is one.
 *
 * Only the four roots and the access page are places somebody arrives at.
 * Everything under one of them is a record an operator opened and has to be
 * able to leave — with one exception: Platform's areas are peers of each other,
 * and offering "back" from Identity to Media would dress a sideways move as a
 * return.
 */
const ancestry: readonly {
  readonly of: RegExp;
  readonly parent: string;
}[] = [{ of: /^\/queues\/[^/]+$/u, parent: '/queues' }];

export function parentOf(pathname: string): string | undefined {
  if (pathname === accessPath) return undefined;
  if (destinations.some((destination) => destination.path === pathname)) {
    return undefined;
  }
  if (platformAreas.some((area) => area.path === pathname)) return undefined;
  return ancestry.find((one) => one.of.test(pathname))?.parent;
}

/**
 * Whether a deep link may be followed after authentication.
 *
 * Only a path on this origin. A value starting with two slashes or a scheme is
 * an absolute address somebody else chose, and following one would turn the
 * access page into an open redirect — on the one surface in this product where
 * that would hand somebody a privileged destination.
 */
export function safeReturnPath(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!value.startsWith('/')) return undefined;
  if (value.startsWith('//')) return undefined;
  if (value.includes('\\')) return undefined;
  return value;
}
