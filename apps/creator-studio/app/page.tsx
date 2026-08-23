'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Bootstrap } from '../src/app/gate';

/**
 * The workspace's front door, which is not a page.
 *
 * Creator Studio has no public landing surface — it is a workspace behind a
 * door, and `robots` says so — so the root does the one thing a root can
 * honestly do here: send somebody to Home, where the gate decides whether they
 * may see it. `replace` rather than `push`, so Back leaves the site instead of
 * bouncing off this address.
 */
export default function StudioRoot() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/home');
  }, [router]);
  return <Bootstrap />;
}
