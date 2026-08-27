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

/**
 * The part of the router leaving a screen needs.
 *
 * Declared as an interface rather than taken from `expo-router` so the rule
 * below can be exercised against a stack that is not a real one. What a test
 * has to be able to arrange is a screen with nothing behind it, and there is no
 * way to arrange that against a router that has already been mounted.
 */
export interface Stack {
  back(): void;
  canGoBack(): boolean;
  replace(path: string): void;
}

/**
 * Leaving a screen that was pushed.
 *
 * A phone has a system Back as well as the one on screen, and both have to end
 * up in the same place. Popping the stack is that place whenever there is a
 * stack to pop: it returns to the exact screen underneath, scrolled where it
 * was, which is what the hardware button does and what somebody expects the
 * arrow to do.
 *
 * There is not always a stack. A notification, a `velora://` link, and a cold
 * start on a deep link each put somebody on a pushed screen with nothing behind
 * it, and `back()` on an empty stack leaves the application — which on Android
 * means the screen somebody was reading disappears. So the fallback is an
 * explicit product parent, and `replace` rather than `push` so the screen being
 * left does not stay behind the one being entered.
 */
export function leave(stack: Stack, parent: string): void {
  if (stack.canGoBack()) {
    stack.back();
    return;
  }
  stack.replace(parent);
}
