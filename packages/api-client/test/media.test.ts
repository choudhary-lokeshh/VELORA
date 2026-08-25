import { describe, expect, it } from 'vitest';

import { createMediaAddressBook } from '../src/media.js';
import type { ApiResult } from '../src/result.js';

interface DeliveryList {
  readonly deliveries: readonly {
    readonly assetId: string;
    readonly expiresAt?: string | undefined;
    readonly url: string;
  }[];
}

/**
 * The address book, tested where the interesting failures actually are.
 *
 * None of them are visual. They are about how many requests a screenful of
 * people costs, what happens to a reference the platform declined, and whether
 * an address is ever used past the moment it stops working — and getting any of
 * those wrong is either a request loop or a broken image, on every surface at
 * once.
 */

interface Recorded {
  readonly assetIds: readonly string[];
  readonly variant: string;
}

function book(input: {
  readonly answer?: (assetIds: readonly string[]) => ApiResult<DeliveryList>;
  readonly now?: () => number;
}) {
  const requests: Recorded[] = [];
  const exchange = (query: {
    readonly assetIds: readonly string[];
    readonly variant: string;
  }): Promise<ApiResult<DeliveryList>> => {
    requests.push({ assetIds: [...query.assetIds], variant: query.variant });
    return Promise.resolve(
      input.answer?.(query.assetIds) ?? {
        kind: 'ok',
        value: {
          deliveries: query.assetIds.map((assetId) => ({
            assetId,
            expiresAt: new Date(
              (input.now?.() ?? Date.now()) + 300_000,
            ).toISOString(),
            url: `https://media.test/${assetId}`,
          })),
        },
      },
    );
  };
  return {
    requests,
    subject: createMediaAddressBook({
      exchange,
      ...(input.now === undefined ? {} : { now: input.now }),
    }),
  };
}

const reference = (index: number) =>
  `0000000${String(index)}-0000-4000-8000-000000000000`;

describe('addresses are obtained once and kept while they work', () => {
  it('asks for a whole screenful in one request', async () => {
    const harness = book({});
    const wanted = Array.from({ length: 12 }, (_, index) => reference(index));

    const resolved = await harness.subject.resolve(wanted, 'card');

    expect(harness.requests).toHaveLength(1);
    expect(resolved.size).toBe(12);
  });

  it('splits a batch larger than the contract allows', async () => {
    const harness = book({});
    const wanted = Array.from({ length: 30 }, (_, index) => reference(index));

    await harness.subject.resolve(wanted, 'card');

    expect(harness.requests.map((one) => one.assetIds.length)).toEqual([24, 6]);
  });

  it('does not ask again for something it already holds', async () => {
    const harness = book({});

    await harness.subject.resolve([reference(1)], 'card');
    await harness.subject.resolve([reference(1), reference(2)], 'card');

    expect(harness.requests.map((one) => one.assetIds)).toEqual([
      [reference(1)],
      [reference(2)],
    ]);
  });

  it('treats a different variant as a different thing to ask for', async () => {
    const harness = book({});

    await harness.subject.resolve([reference(1)], 'card');
    await harness.subject.resolve([reference(1)], 'display');

    expect(harness.requests.map((one) => one.variant)).toEqual([
      'card',
      'display',
    ]);
  });

  it('stops using an address once it is close to expiring', async () => {
    let clock = 1_000_000;
    const harness = book({ now: () => clock });

    await harness.subject.resolve([reference(1)], 'card');
    // Past the grant's own expiry, and past the minimum hold with it.
    clock += 400_000;
    await harness.subject.resolve([reference(1)], 'card');

    expect(harness.requests).toHaveLength(2);
  });

  it('holds briefly even when a skewed clock says the grant is already dead', async () => {
    // A device running a day ahead of the server. Every grant it receives looks
    // expired on arrival, and without a floor this would ask again forever.
    const clock = Date.parse('2026-08-15T12:00:00.000Z');
    const harness = book({
      answer: (assetIds) => ({
        kind: 'ok',
        value: {
          deliveries: assetIds.map((assetId) => ({
            assetId,
            expiresAt: '2026-08-14T12:00:00.000Z',
            url: `https://media.test/${assetId}`,
          })),
        },
      }),
      now: () => clock,
    });

    const first = await harness.subject.resolve([reference(1)], 'card');
    const second = await harness.subject.resolve([reference(1)], 'card');

    expect(first.size).toBe(1);
    expect(second.size).toBe(1);
    expect(harness.requests).toHaveLength(1);
  });
});

describe('a reference the platform will not serve', () => {
  it('is absent rather than an error, and is not asked about again immediately', async () => {
    const harness = book({
      answer: () => ({ kind: 'ok', value: { deliveries: [] } }),
    });

    const resolved = await harness.subject.resolve([reference(1)], 'card');
    await harness.subject.resolve([reference(1)], 'card');

    expect(resolved.size).toBe(0);
    expect(harness.requests).toHaveLength(1);
  });

  it('is asked about again once the refusal is old enough to be stale', async () => {
    let clock = 1_000_000;
    const harness = book({
      answer: () => ({ kind: 'ok', value: { deliveries: [] } }),
      now: () => clock,
    });

    await harness.subject.resolve([reference(1)], 'card');
    clock += 61_000;
    await harness.subject.resolve([reference(1)], 'card');

    expect(harness.requests).toHaveLength(2);
  });
});

describe('a platform that cannot deliver at all says so once', () => {
  it('reports the environment rather than the reference', async () => {
    const harness = book({
      answer: () => ({
        code: 'DEPENDENCY_UNAVAILABLE',
        kind: 'refused',
        status: 503,
      }),
    });

    await harness.subject.resolve([reference(1)], 'card');

    expect(harness.subject.deliveryUnavailable()).toBe(true);
  });

  it('does not blame the environment for an ordinary transport failure', async () => {
    const harness = book({ answer: () => ({ kind: 'unavailable' }) });

    await harness.subject.resolve([reference(1)], 'card');

    expect(harness.subject.deliveryUnavailable()).toBe(false);
  });

  it('caches nothing on a failure, so the next render asks again', async () => {
    const harness = book({ answer: () => ({ kind: 'unavailable' }) });

    await harness.subject.resolve([reference(1)], 'card');
    await harness.subject.resolve([reference(1)], 'card');

    expect(harness.requests).toHaveLength(2);
  });
});

describe('holding nothing after signing out', () => {
  it('drops every address it was given', async () => {
    const harness = book({});
    await harness.subject.resolve([reference(1)], 'card');

    harness.subject.clear();
    await harness.subject.resolve([reference(1)], 'card');

    expect(harness.requests).toHaveLength(2);
  });
});

describe('two callers asking at once', () => {
  it('share one request rather than issuing two', async () => {
    const harness = book({});

    // Neither is awaited before the other is made, which is what two components
    // rendering the same person in one frame actually does.
    const first = harness.subject.resolve([reference(1)], 'card');
    const second = harness.subject.resolve([reference(1)], 'card');
    const [left, right] = await Promise.all([first, second]);

    expect(harness.requests).toHaveLength(1);
    expect(left.size).toBe(1);
    expect(right.size).toBe(1);
  });
});
