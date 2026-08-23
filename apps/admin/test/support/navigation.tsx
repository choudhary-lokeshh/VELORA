import type { AnchorHTMLAttributes, ReactNode } from 'react';

/**
 * The router, standing still.
 *
 * The App Router hooks need a router context that only exists inside a running
 * Next.js application, so the unit suite substitutes this. It is deliberately a
 * recorder rather than a simulator: a test asserts *that* the surface navigated
 * and where to, and the destination it named is the thing worth asserting.
 *
 * Real navigation is proved in Playwright, where the router is real.
 */

export interface NavigationRecord {
  readonly path: string;
  readonly kind: 'push' | 'replace' | 'back';
}

let pathname = '/';
let search = '';
const records: NavigationRecord[] = [];

export function resetNavigation(next = '/', query = ''): void {
  pathname = next;
  search = query;
  parameters = {};
  records.length = 0;
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
    pathname = path.split('?')[0] ?? path;
  },
  refresh(): void {
    // No server components are re-rendered in the unit environment.
  },
  replace(path: string): void {
    records.push({ kind: 'replace', path });
    pathname = path.split('?')[0] ?? path;
  },
};

export function useRouter(): typeof router {
  return router;
}

export function usePathname(): string {
  return pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(search);
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
