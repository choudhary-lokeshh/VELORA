import {
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';

/**
 * The router, as much of it as a unit test needs.
 *
 * The App Router hooks need a router context that only exists inside a running
 * Next.js application, so the unit suite substitutes this. It records every
 * navigation, because a test asserts *that* the surface navigated and where to.
 *
 * It also keeps the address it was sent to and re-renders whatever is reading
 * it. That part is not decoration: several surfaces here keep a section, a
 * group, or a filter in the query deliberately, so that Back, a reload, a
 * second tab, and a link all behave the way they behave everywhere else. A
 * recorder that swallowed the new address would make every one of those
 * untestable outside a browser, and a control that changed nothing would pass.
 *
 * Real navigation is still proved in Playwright, where the router is real.
 */

export interface NavigationRecord {
  readonly path: string;
  readonly kind: 'push' | 'replace' | 'back';
}

let pathname = '/';
let search = '';
const records: NavigationRecord[] = [];
const listeners = new Set<() => void>();

/**
 * One object per query string.
 *
 * `useSyncExternalStore` compares snapshots by identity and re-reads until two
 * agree, so handing back a fresh `URLSearchParams` every render would never
 * settle.
 */
const parsed = new Map<string, URLSearchParams>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function announce(): void {
  for (const listener of [...listeners]) listener();
}

function goTo(path: string): void {
  const [next, query = ''] = path.split('?');
  pathname = next ?? path;
  search = query;
  announce();
}

export function resetNavigation(next = '/', query = ''): void {
  pathname = next;
  search = query;
  records.length = 0;
  announce();
}

export function navigations(): readonly NavigationRecord[] {
  return records;
}

export function currentPath(): string {
  return pathname;
}

/** Arrives somewhere the way a completed navigation would, records included. */
export function navigateTo(path: string): void {
  router.push(path);
}

const router = {
  back(): void {
    records.push({ kind: 'back', path: pathname });
  },
  forward(): void {
    // Nothing records a forward yet; it exists so the shape matches the hook.
  },
  prefetch(): void {
    // Prefetching is a performance detail with no observable behaviour here.
  },
  push(path: string): void {
    records.push({ kind: 'push', path });
    goTo(path);
  },
  refresh(): void {
    // No server components are re-rendered in the unit environment.
  },
  replace(path: string): void {
    records.push({ kind: 'replace', path });
    goTo(path);
  },
};

export function useRouter(): typeof router {
  return router;
}

export function usePathname(): string {
  return useSyncExternalStore(
    subscribe,
    () => pathname,
    () => pathname,
  );
}

export function useSearchParams(): URLSearchParams {
  const query = useSyncExternalStore(
    subscribe,
    () => search,
    () => search,
  );
  let held = parsed.get(query);
  if (held === undefined) {
    held = new URLSearchParams(query);
    parsed.set(query, held);
  }
  return held;
}

export function notFound(): never {
  throw new Error('not found');
}

export function redirect(path: string): never {
  router.replace(path);
  throw new Error(`redirected to ${path}`);
}

/**
 * `next/link`, reduced to what it is in the document: an anchor.
 *
 * It records the navigation on activation so a test can assert where a row led,
 * and it prevents the default so jsdom does not complain about an unimplemented
 * page load.
 */
export function Link({
  children,
  href,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly children: ReactNode;
  readonly href: string;
}) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(event) => {
        // The real `next/link` runs the caller's handler first and honours a
        // `preventDefault` by not navigating — the shell's Back uses exactly
        // that to pop history instead of pushing. The default is prevented
        // afterwards either way, so jsdom never attempts a page load.
        onClick?.(event);
        const handled = event.defaultPrevented;
        event.preventDefault();
        if (!handled) router.push(href);
      }}
    >
      {children}
    </a>
  );
}

export default Link;
