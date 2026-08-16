import { describe, expect, it } from 'bun:test';

import { Poller } from '../../src/jobs/poller.js';
import {
  startBackgroundCycles,
  type WorkerComposition,
} from '../../src/worker.js';
import { silentLogger } from '../support/harness.js';

/**
 * A cycle that is constructed and never started is invisible.
 *
 * The process comes up, reports itself healthy, and does that work exactly once
 * at boot — which is what had happened to the provider-event drain, the
 * component that applies verified provider events. Nothing else applies them:
 * the webhook route records and returns, deliberately never posting money on a
 * request thread. So a payment that settled after boot would have stayed
 * unposted until somebody restarted the worker.
 *
 * `startBackgroundCycles` names cycles by type rather than one by one, so the
 * property under test is that every `Poller` the composition holds is
 * scheduling afterwards — including one added later by somebody who never read
 * this file.
 */

function cycle(name: string): Poller {
  return new Poller({
    cycle: () => Promise.resolve(),
    // Long enough that nothing fires during the test; this is about scheduling.
    intervalMilliseconds: 3_600_000,
    logger: silentLogger(),
    name,
  });
}

describe('the worker starts every cycle it composes', () => {
  it('leaves no constructed poller unscheduled', async () => {
    const pollers = {
      deliverySweep: cycle('delivery'),
      financialReconciliation: cycle('reconciliation'),
      mediaInspection: cycle('media-inspection'),
      mediaProcessing: cycle('media-processing'),
      mediaUploadSweep: cycle('media-upload'),
      providerEventDrain: cycle('provider-events'),
      relayPoller: cycle('relay'),
      safetyDeadlineSweep: cycle('safety-deadlines'),
    };
    // The shape the worker actually hands over: cycles among things that are
    // not cycles, which is why the starter selects by type.
    const composition = {
      ...pollers,
      close: () => Promise.resolve(),
      drainOnce: () => Promise.resolve(),
      registry: { list: () => [] },
    } as unknown as WorkerComposition;

    for (const poller of Object.values(pollers)) {
      expect(poller.scheduling).toBe(false);
    }

    startBackgroundCycles(composition);

    for (const [name, poller] of Object.entries(pollers)) {
      expect(poller.scheduling, name).toBe(true);
    }

    await Promise.all(Object.values(pollers).map(async (p) => p.stop()));
  });

  it('starts a cycle nobody thought to name', async () => {
    // The regression that matters: the guarantee has to hold for a cycle added
    // after this test was written, or it only ever proved today's list.
    const added = cycle('some-later-sweep');
    const composition = {
      added,
      close: () => Promise.resolve(),
    } as unknown as WorkerComposition;

    startBackgroundCycles(composition);

    expect(added.scheduling).toBe(true);
    await added.stop();
  });
});
