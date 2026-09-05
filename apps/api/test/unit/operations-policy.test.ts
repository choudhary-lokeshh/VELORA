import { describe, expect, it } from 'bun:test';

import { bounded, operatorFanOut } from '../../src/database/fan-out.js';
import {
  capabilitiesOfRole,
  controlDefault,
  controlKeys,
  isActivityDomain,
  isActivityType,
  isControlKey,
  operationalControls,
  operatorCapabilities,
  operatorRoles,
  roleCapabilities,
  type OperatorCapability,
} from '../../src/operations/policy.js';
import { CachedControlReader } from '../../src/operations/controls.js';
import type { OperationsRepository } from '../../src/operations/repository.js';

/**
 * The operator vocabulary, and the two mechanics everything else rests on.
 *
 * What is asserted here is what a database cannot: that a role cannot name a
 * capability that does not exist, that a cached control fails in the safe
 * direction rather than reverting, and that a bounded fan-out is actually
 * bounded — which is the thing that stopped one operator screen taking the
 * whole connection pool.
 */

describe('the operator capability vocabulary', () => {
  it('gives every role only capabilities that exist', () => {
    const known = new Set<string>(operatorCapabilities);
    for (const role of operatorRoles) {
      for (const capability of roleCapabilities[role]) {
        expect(known.has(capability)).toBe(true);
      }
    }
  });

  it('gives the super administrator everything and readonly no writes', () => {
    expect([...capabilitiesOfRole('super_admin')].sort()).toEqual(
      [...operatorCapabilities].sort(),
    );
    for (const capability of capabilitiesOfRole('readonly')) {
      // Every readonly capability ends in `.read`. A write that slipped into
      // this role would be a role nobody would notice was not read-only.
      expect(capability.endsWith('.read')).toBe(true);
    }
  });

  it('keeps the capability that can grant capabilities to one role', () => {
    const holders = operatorRoles.filter((role) =>
      capabilitiesOfRole(role).includes('operators.manage'),
    );
    // Whoever holds it can grant themselves every other capability, so it is
    // kept visible in one role rather than folded into a general admin idea.
    expect(holders).toEqual(['super_admin']);
  });

  it('separates every write capability from its read', () => {
    const writes: readonly OperatorCapability[] = [
      'config.write',
      'creators.enforce',
      'growth.manage',
      'live.control',
      'safety.enforce',
      'sessions.revoke',
      'support.update',
      'users.restrict',
    ];
    for (const write of writes) {
      const holders = operatorRoles.filter((role) =>
        capabilitiesOfRole(role).includes(write),
      );
      // A write nobody holds is a control nobody can use; a write everybody
      // holds is not a capability model. Both are worth failing on.
      expect(holders.length).toBeGreaterThan(0);
      expect(holders.length).toBeLessThan(operatorRoles.length);
    }
  });
});

describe('the operational controls', () => {
  it('defaults every control to on', () => {
    for (const key of controlKeys) {
      // These are pause switches over features that already shipped, so a
      // platform nobody has touched behaves the way it did before the control
      // store existed. A default of off would have disabled a working product
      // the first time the migration ran.
      expect(controlDefault(key)).toBe(true);
    }
  });

  it('gives every control words describing what it governs', () => {
    for (const control of operationalControls) {
      expect(control.summary.length).toBeGreaterThan(20);
    }
  });

  it('refuses a key outside the vocabulary', () => {
    expect(isControlKey('live.search')).toBe(true);
    expect(isControlKey('live.everything')).toBe(false);
  });
});

describe('the activity taxonomy', () => {
  it('admits only the governed domains and types', () => {
    expect(isActivityDomain('safety')).toBe(true);
    expect(isActivityDomain('passwords')).toBe(false);
    expect(isActivityType('live.encounter_ended')).toBe(true);
    expect(isActivityType('live.camera_disabled')).toBe(false);
  });
});

describe('a cached control reader', () => {
  function readerOver(
    answers: (boolean | Error)[],
    clock: { value: number },
  ): { readonly reader: CachedControlReader; readonly reads: () => number } {
    let reads = 0;
    const repository = {
      readControl: async () => {
        const answer = answers[Math.min(reads, answers.length - 1)];
        reads += 1;
        if (answer instanceof Error) throw answer;
        return Promise.resolve(
          answer === undefined
            ? undefined
            : {
                changedBy: 'session:test',
                enabled: answer,
                key: 'live.search' as const,
                reason: 'a reason long enough',
                updatedAt: new Date(),
                version: 1,
              },
        );
      },
    } as unknown as OperationsRepository;
    return {
      reads: () => reads,
      reader: new CachedControlReader({
        monotonic: () => clock.value,
        repository,
      }),
    };
  }

  it('answers the declared default when nothing has ever been set', async () => {
    const clock = { value: 0 };
    const { reader } = readerOver([], clock);
    expect(await reader.isEnabled('live.search')).toBe(true);
  });

  it('does not ask again inside the cache window', async () => {
    const clock = { value: 0 };
    const { reader, reads } = readerOver([false, false], clock);
    expect(await reader.isEnabled('live.search')).toBe(false);
    clock.value = 1_000;
    expect(await reader.isEnabled('live.search')).toBe(false);
    expect(reads()).toBe(1);
  });

  it('asks again once the window has passed', async () => {
    const clock = { value: 0 };
    const { reader, reads } = readerOver([false, true], clock);
    expect(await reader.isEnabled('live.search')).toBe(false);
    clock.value = 60_000;
    expect(await reader.isEnabled('live.search')).toBe(true);
    expect(reads()).toBe(2);
  });

  it('keeps the last known value when the store cannot be read', async () => {
    const clock = { value: 0 };
    const { reader } = readerOver(
      [false, new Error('database is gone')],
      clock,
    );
    expect(await reader.isEnabled('live.search')).toBe(false);
    clock.value = 60_000;
    // Not the default. An operator who paused live search must not have the
    // pause undone by the very failure they were reacting to.
    expect(await reader.isEnabled('live.search')).toBe(false);
  });

  it('falls back to the shipped default when it has never had an answer', async () => {
    const clock = { value: 0 };
    const { reader } = readerOver([new Error('database is gone')], clock);
    expect(await reader.isEnabled('live.search')).toBe(true);
  });

  it('forgets one control without forgetting the others', async () => {
    const clock = { value: 0 };
    const { reader, reads } = readerOver([false, true], clock);
    expect(await reader.isEnabled('live.search')).toBe(false);
    reader.forget('live.search');
    expect(await reader.isEnabled('live.search')).toBe(true);
    expect(reads()).toBe(2);
  });
});

describe('a bounded fan-out', () => {
  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, (_, index) => async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return index;
    });

    const results = await bounded(tasks);
    // The whole point: one operator screen reading twenty tables must not take
    // twenty pooled connections. ADR-0019's admission bound counts requests,
    // not queries, so it cannot see that happening.
    expect(peak).toBeLessThanOrEqual(operatorFanOut);
    expect(results).toEqual(tasks.map((_, index) => index));
  });

  it('preserves input order whatever order the tasks settle in', async () => {
    const delays = [30, 0, 20, 10, 5];
    const results = await bounded(
      delays.map((delay, index) => async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return index;
      }),
      2,
    );
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it('answers nothing for nothing', async () => {
    expect(await bounded([])).toEqual([]);
  });
});
