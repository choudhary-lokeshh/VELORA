import type { IconName } from '../design/icons';

/**
 * The map of the product, on a phone.
 *
 * Five destinations, the same five Consumer Web has and named the same way:
 * for what somebody is trying to do rather than for the domain that answers it.
 * `AGENTS.md` keeps backend architecture out of client responsibility, and a
 * navigation with an item per backend module is exactly that leak.
 *
 * The wireframe this replaces had seven flat areas including "Calls" and
 * "Safety". Neither is a place somebody goes. A call is placed against a mutual
 * introduction and against nothing else, so it belongs where the relationship
 * is; safety is reached from the person or the conversation it is about, and
 * from You, so it is never more than one reach away and never a destination
 * that implies browsing.
 *
 * Account, availability, safety, and the session sit under one "You" so the
 * first four stay about other people, which is what the product is for.
 */
export interface Destination {
  readonly icon: IconName;
  readonly id: string;
  readonly label: string;
  /** The route name inside the tab group. */
  readonly name: string;
  readonly signal?: 'conversations' | 'notifications';
}

export const destinations: readonly Destination[] = [
  { icon: 'compass', id: 'discover', label: 'Discover', name: 'discover' },
  {
    icon: 'link',
    id: 'introductions',
    label: 'Introductions',
    name: 'introductions',
  },
  {
    icon: 'message',
    id: 'messages',
    label: 'Messages',
    name: 'messages',
    signal: 'conversations',
  },
  {
    icon: 'bell',
    id: 'notices',
    label: 'Notices',
    name: 'notices',
    signal: 'notifications',
  },
  { icon: 'user', id: 'you', label: 'You', name: 'you' },
];

/**
 * A count worth showing, and the point past which the exact number stops
 * helping. "9+" is the same decision as the other surface's, so the same
 * inbox does not read differently on two devices.
 */
export const signalCeiling = 9;

export function signalLabel(count: number): string {
  return count > signalCeiling ? `${String(signalCeiling)}+` : String(count);
}
