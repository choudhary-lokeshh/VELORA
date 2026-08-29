'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Bootstrap } from '../src/app/gate';
import { homePath } from '../src/app/navigation';

/**
 * The console's front door, which is not a page.
 *
 * Platform Admin has no public surface — it is an operations console behind a
 * door, and `robots` says so — so the root does the one thing a root can
 * honestly do here: send an operator to the overview, where the gate decides
 * whether they may see anything. `replace` rather than `push`, so Back leaves
 * the site instead of bouncing off this address.
 */
export default function AdminRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace(homePath);
  }, [router]);
  return <Bootstrap />;
}
