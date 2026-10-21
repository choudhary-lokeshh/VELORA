import { useEffect, useState } from 'react';

/**
 * Whether the screen under test is the route on screen, as a navigator says.
 *
 * Screens are mounted without the router (see `render.tsx`), and Expo Router's
 * `useFocusEffect` cannot run outside one: it throws for want of a navigation
 * object. A suite that mounts a screen scoping behaviour to focus replaces the
 * hook with this one — `jest.mock('expo-router', …)` in that file — and moves
 * focus the way switching tabs does. The semantics are the real hook's: the
 * effect runs while focused, its cleanup runs on blur, and it runs again when
 * its callback changes while focused.
 */

const listeners = new Set<(focused: boolean) => void>();
let focusedNow = true;

export const focus = {
  /** Another tab is now on screen; this one stays mounted underneath. */
  blur(): void {
    focusedNow = false;
    for (const listener of listeners) listener(false);
  },
  /** This tab is on screen again. */
  regain(): void {
    focusedNow = true;
    for (const listener of listeners) listener(true);
  },
  /** Every test starts on the focused screen. */
  reset(): void {
    focusedNow = true;
  },
};

export function useFocusEffect(effect: () => undefined | (() => void)): void {
  const [focused, setFocused] = useState(focusedNow);
  useEffect(() => {
    listeners.add(setFocused);
    return () => {
      listeners.delete(setFocused);
    };
  }, []);
  useEffect(() => (focused ? effect() : undefined), [effect, focused]);
}
