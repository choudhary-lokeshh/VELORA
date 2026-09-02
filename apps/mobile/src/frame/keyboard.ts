import { useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, type View } from 'react-native';

/**
 * How much of a view the keyboard is standing on, measured rather than assumed.
 *
 * The manifest asks for `adjustResize` and Android 15 stopped honouring it: an
 * edge-to-edge window is not resized for the keyboard, it is handed an inset it
 * has to deal with itself. On a device that meant the composer — the one
 * control the keyboard exists to serve — was underneath it, with nothing on
 * screen to say what was being typed.
 *
 * Measuring the view in the window rather than trusting the keyboard's own
 * height is what makes this correct either way: where a window *is* resized the
 * view already ends above the keyboard and the overlap is zero, and where it is
 * not the overlap is exactly the part that is covered.
 *
 * One mechanism, used by the screen frame, the sheet, and the Live stage,
 * because the third copy of a keyboard calculation is where the three start to
 * disagree.
 */
export function useKeyboardOverlap(): {
  readonly overlap: number;
  readonly target: RefObject<View | null>;
} {
  const target = useRef<View | null>(null);
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      const top = event.endCoordinates.screenY;
      target.current?.measureInWindow((_x, y, _width, height) => {
        setOverlap(Math.max(0, y + height - top));
      });
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      setOverlap(0);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return { overlap, target };
}
