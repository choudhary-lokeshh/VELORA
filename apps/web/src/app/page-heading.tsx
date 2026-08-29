'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Handing a page's name from the page to the bar above it, and back.
 *
 * On a wide window the shell already names the destination in the sidebar, so
 * the stylesheet hides a bar that would only repeat it. A phone has no sidebar
 * and keeps the bar — and until this existed, the result was every screen
 * printing its own name twice, a few pixels apart: once in the sticky bar and
 * once as the heading directly beneath it.
 *
 * The bar is not redundant, though. It is what stays on screen after the
 * heading has scrolled away, which is the moment a person actually needs to be
 * told where they are. So the name moves rather than being deleted: the bar
 * carries it exactly while the page's own heading is out of view.
 *
 * A page registers its heading; the shell watches it. Nothing is measured
 * during render, and a page that registers no heading leaves the bar naming it
 * — which is the safe direction to be wrong in, and what every surface outside
 * this shell gets, because there is no provider above them at all.
 */

interface PageHeadingContract {
  /** Called by the page's heading with its element, and with null on unmount. */
  readonly register: (node: HTMLElement | null) => void;
}

const noRegistration: PageHeadingContract = { register: () => undefined };

const PageHeadingContext = createContext<PageHeadingContract>(noRegistration);

/** Used by `PageHeader` to offer its heading to whatever shell is above it. */
export function usePageHeading(): (node: HTMLElement | null) => void {
  return useContext(PageHeadingContext).register;
}

/**
 * Watches the registered heading and reports whether it is on screen.
 *
 * `undefined` until something registers, which is how a caller tells "no page
 * heading exists here" apart from "one exists and has scrolled away".
 */
export function PageHeadingWatcher({
  children,
  onChange,
}: {
  readonly children: ReactNode;
  readonly onChange: (visible: boolean | undefined) => void;
}) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const [node, setNode] = useState<HTMLElement | null>(null);

  const register = useCallback((next: HTMLElement | null) => {
    setNode(next);
  }, []);

  useEffect(() => {
    if (node === null) {
      latest.current(undefined);
      return undefined;
    }
    // A browser without the observer — and a test renderer — gets the heading
    // treated as present, which leaves the bar quiet rather than leaving it
    // announcing a name the reader can already see.
    if (typeof IntersectionObserver === 'undefined') {
      latest.current(true);
      return undefined;
    }
    latest.current(true);
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry !== undefined) latest.current(entry.isIntersecting);
      },
      // The bar sits over the top of the page, so a heading underneath it is
      // not visible however much of it is technically within the viewport.
      { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      latest.current(undefined);
    };
  }, [node]);

  const value = useMemo<PageHeadingContract>(() => ({ register }), [register]);

  return (
    <PageHeadingContext.Provider value={value}>
      {children}
    </PageHeadingContext.Provider>
  );
}
