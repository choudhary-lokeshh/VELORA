'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { Icon } from '../design/icons';
import { backTarget } from '../app/navigation';

/**
 * The way back out of a creator address that has nothing behind it.
 *
 * A withdrawn creator page answers 404, and Next renders a segment's
 * `not-found.tsx` with no props — no params, no query, nothing about the
 * request. So the one thing this page needs, the address somebody was on before
 * they followed the link, has to be read in the browser.
 *
 * It matters more here than almost anywhere else. `docs/decisions/ADR-0045-…`
 * declares a doorway per route precisely so that a creator opened from a
 * section of Discover returns to *that* section, and a page about a creator who
 * is gone is exactly where somebody must not be stranded. Answering 404 without
 * this would have kept the status honest and quietly taken the return with it.
 *
 * It appears only for somebody who arrived from inside the product. A visitor
 * who followed a link from elsewhere has no VELORA page behind them, and the
 * two ways on below are theirs.
 */
export function CreatorNotFoundBack() {
  const pathname = usePathname();
  const from = useSearchParams().get('from');
  const back = from === null ? undefined : backTarget(pathname, from);
  if (back === undefined) return null;
  return (
    <Link
      aria-label="Back"
      className="v-icon-btn"
      data-testid="topbar-back"
      href={back}
    >
      <Icon name="arrowLeft" size="md" />
    </Link>
  );
}
