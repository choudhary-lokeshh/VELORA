'use client';

import { useEffect } from 'react';

import { captureAcquisition } from './acquisition';

/**
 * Notices where somebody arrived from, once, wherever they arrived.
 *
 * Mounted at the document rather than on the pages that expect a campaign
 * parameter, because a shared link can be any address on this surface: a
 * creator's page, an explanation, the entry, an invitation. A capture that
 * lived only on the pages somebody remembered to add it to would lose exactly
 * the links that turned out to work.
 *
 * It reads the address directly instead of through the router's hook, which
 * keeps it out of every page's Suspense arrangement — this runs after paint and
 * has no bearing on what is rendered, so making a page's boundaries depend on it
 * would be paying for nothing.
 *
 * It draws nothing and can never fail a render: the capture swallows a browser
 * that refuses storage, and the honest consequence of that is a visit
 * attributed to nobody.
 */
export function AcquisitionCapture() {
  useEffect(() => {
    captureAcquisition({ search: globalThis.location.search });
  }, []);
  return null;
}
