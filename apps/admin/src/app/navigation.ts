import type { IconName } from '../design/icons';

/**
 * The operator's map of the platform.
 *
 * Six destinations, named for the work rather than for the domain that answers
 * it. `AGENTS.md` keeps backend architecture out of client responsibility, and
 * a console with an item per backend module would be exactly that leak — which
 * is why "Billing", "Moderation", "Notifications", and "RTC" are not here.
 *
 * Overview is the question an operator opens the console to ask: what needs a
 * person right now. Queues is their own work — the cases assigned to a queue,
 * the appeals against decisions already made, and the record of the decisions
 * themselves. Creators is the directory, the clubs those creators sell, and the
 * enforcement that acts on both. Accounts is the same for consumers, bounded to
 * the accounts the platform has itself decided are not in good standing.
 * Money is what the platform holds and every commercial record behind it.
 * Platform is every subsystem's health in one place, because an operator asking
 * "is anything stuck" should ask once.
 *
 * The session sits under Access, reached from the foot of the navigation, so
 * the six destinations stay about the platform rather than about the operator.
 *
 * **Nothing here is a permission.** Which operator may do what is an open
 * decision; the server refuses at every route regardless, and a destination
 * being visible has never meant a caller may act on what is behind it.
 */
export interface Destination {
  readonly icon: IconName;
  readonly id: string;
  readonly label: string;
  /** Matched as a prefix, so `/queues/abc` still lights up Queues. */
  readonly path: string;
}

export const destinations: readonly Destination[] = [
  { icon: 'pulse', id: 'overview', label: 'Overview', path: '/overview' },
  { icon: 'queue', id: 'queues', label: 'Queues', path: '/queues' },
  { icon: 'users', id: 'creators', label: 'Creators', path: '/creators' },
  { icon: 'person', id: 'accounts', label: 'Accounts', path: '/accounts' },
  { icon: 'ledger', id: 'money', label: 'Money', path: '/money' },
  { icon: 'gauge', id: 'platform', label: 'Platform', path: '/platform' },
];

/** The session area, reached from the foot rather than from the destinations. */
export const accessPath = '/access';

/** Where an operator who has just authenticated lands. */
export const homePath = '/overview';

/**
 * One area of a destination, which is a peer of its siblings rather than a
 * child of the first of them.
 *
 * The areas of a destination sit under one path because one of them has to be
 * the address somebody lands on, not because the others are inside it. An
 * operator moves between them with the tabs on the screen, so none of them is a
 * place to come back from — which is why `parentOf` refuses to offer a "back"
 * from one area to another, and why a sideways move is never dressed as a
 * return.
 */
export interface Area {
  readonly label: string;
  readonly path: string;
  /** Shown in the phone header, where there is no room for a sidebar. */
  readonly title: string;
}

export const queueAreas: readonly Area[] = [
  { label: 'Cases', path: '/queues', title: 'Queues' },
  { label: 'Appeals', path: '/queues/appeals', title: 'Appeals' },
  { label: 'Decisions', path: '/queues/decisions', title: 'Decisions' },
];

export const creatorAreas: readonly Area[] = [
  { label: 'Creators', path: '/creators', title: 'Creators' },
  { label: 'Clubs', path: '/creators/clubs', title: 'Clubs' },
];

export const moneyAreas: readonly Area[] = [
  { label: 'Summary', path: '/money', title: 'Money' },
  { label: 'Payments', path: '/money/payments', title: 'Payments' },
  { label: 'Payouts', path: '/money/payouts', title: 'Payouts' },
  { label: 'Disputes', path: '/money/disputes', title: 'Disputes' },
];

/**
 * The subsystems Platform reports on, which are peers rather than children.
 *
 * Security is one of them rather than an "Audit" destination of its own,
 * because AUTH's event log is that subsystem's own operational record and
 * every other subsystem's record is already read here. Settled moderation
 * decisions are the other half of the platform's audit trail, and they sit
 * under Queues with the work that produced them for the same reason.
 */
export const platformAreas: readonly Area[] = [
  { label: 'Media', path: '/platform', title: 'Media' },
  {
    label: 'Notifications',
    path: '/platform/notifications',
    title: 'Notifications',
  },
  { label: 'Calling', path: '/platform/rtc', title: 'Calling' },
  { label: 'Identity', path: '/platform/identity', title: 'Identity' },
  { label: 'Security', path: '/platform/security', title: 'Security' },
];

const allAreas: readonly Area[] = [
  ...queueAreas,
  ...creatorAreas,
  ...moneyAreas,
  ...platformAreas,
];

export function isCurrent(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The destination one level up, when there is one.
 *
 * Only the six roots, the areas of each, and the access page are places
 * somebody arrives at. Everything under one of them is a record an operator
 * opened and has to be able to leave.
 *
 * A record's parent is the area it was found in rather than the destination
 * root, because that is where the operator came from and where their filter,
 * their position, and their place in the queue still are. Truncating the path
 * would return them to the top of a list they had already worked halfway down.
 */
const ancestry: readonly {
  readonly of: RegExp;
  readonly parent: string;
}[] = [
  { of: /^\/queues\/[^/]+$/u, parent: '/queues' },
  { of: /^\/money\/payments\/[^/]+$/u, parent: '/money/payments' },
  { of: /^\/creators\/clubs\/[^/]+$/u, parent: '/creators/clubs' },
];

export function parentOf(pathname: string): string | undefined {
  if (pathname === accessPath) return undefined;
  if (destinations.some((destination) => destination.path === pathname)) {
    return undefined;
  }
  if (allAreas.some((area) => area.path === pathname)) return undefined;
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
