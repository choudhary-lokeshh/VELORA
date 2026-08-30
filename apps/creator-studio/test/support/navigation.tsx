import {
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';

/**
 * The router, keeping the address it was sent to.
 *
 * The App Router hooks need a router context that only exists inside a running
 * Next.js application, so the unit suite substitutes this. It remains a
 * recorder — every navigation is still recorded and asserted — but it also
 * keeps the address and re-renders whatever reads it.
 *
 * That second half exists because a surface may legitimately keep a filter in
 * the query: the catalog does, so that Back from an item returns to the slice
 * the creator was working through. Against a stand-in that swallowed the new
 * address, a filter control that changed nothing would have passed.
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

function announce(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Splits an address the way the router does, and tells whoever is reading. */
function goTo(path: string): void {
  const [next = path, query = ''] = path.split('?');
  pathname = next;
  search = query;
  announce();
}

export function resetNavigation(next = '/', query = ''): void {
  pathname = next;
  search = query;
  parameters = {};
  records.length = 0;
  announce();
}

export function navigations(): readonly NavigationRecord[] {
  return records;
}

export function currentPath(): string {
  return pathname;
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

/*
 * Parsed once per distinct query string.
 *
 * `useSyncExternalStore` compares snapshots by identity, so returning a fresh
 * `URLSearchParams` on every read would report a change on every render and
 * loop forever.
 */
const parsed = new Map<string, URLSearchParams>();

function searchParams(): URLSearchParams {
  const existing = parsed.get(search);
  if (existing !== undefined) return existing;
  const made = new URLSearchParams(search);
  parsed.set(search, made);
  return made;
}

export function useSearchParams(): URLSearchParams {
  return useSyncExternalStore(subscribe, searchParams, searchParams);
}

/**
 * The dynamic segments of the current address.
 *
 * Studio has two addressed things — an item and a club — and both read their
 * identifier from the path. A test sets the path and the identifier falls out
 * of it, so a deep link is exercised the same way the browser exercises it.
 */
export function useParams(): Record<string, string> {
  return parameters;
}

let parameters: Record<string, string> = {};

export function setParams(next: Record<string, string>): void {
  parameters = next;
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
        event.preventDefault();
        onClick?.(event);
        router.push(href);
      }}
    >
      {children}
    </a>
  );
}

export default Link;
