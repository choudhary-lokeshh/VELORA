'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The three questions a creator asks about money, as three addresses.
 *
 * They are links rather than tabs because each is a page somebody may bookmark,
 * send to themselves, or reach with the browser's Back. A tab that looked
 * identical but lived in component state would take all three away.
 */
const pages = [
  { label: 'Earnings', path: '/money' },
  { label: 'Payouts', path: '/money/payouts' },
  { label: 'Selling', path: '/money/selling' },
] as const;

export function MoneyNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Money" className="s-subnav">
      {pages.map((page) => (
        <Link
          aria-current={pathname === page.path ? 'page' : undefined}
          className="s-subnav__item"
          data-testid={`money-nav-${page.label.toLowerCase()}`}
          href={page.path}
          key={page.path}
        >
          {page.label}
        </Link>
      ))}
    </nav>
  );
}
