import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/** Stay still until the system answers; changes outrank a slower initial read. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (value) => {
        changed = true;
        setReduced(value);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        if (active && !changed) setReduced(value);
      },
      () => {
        // An unavailable setting retains the safe, still presentation.
      },
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
