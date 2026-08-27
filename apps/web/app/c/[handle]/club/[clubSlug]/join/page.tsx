'use client';

import { use } from 'react';

import { AppGate } from '../../../../../../src/app/gate';
import { JoinClub } from '../../../../../../src/product/join';

/**
 * The confirmation before a purchase.
 *
 * Behind the gate, because starting a checkout is something only a signed-in
 * consumer may do — and because somebody who arrives here without a session
 * should be sent to sign in and returned, rather than shown a control that
 * would refuse.
 */
export default function JoinClubPage({
  params,
}: {
  readonly params: Promise<{
    readonly clubSlug: string;
    readonly handle: string;
  }>;
}) {
  const { clubSlug, handle } = use(params);
  return (
    <AppGate narrow title="Join">
      <JoinClub handle={handle} slug={clubSlug} />
    </AppGate>
  );
}
