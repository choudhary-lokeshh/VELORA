import { describe, expect, it } from 'bun:test';

import { reportDrainCycle } from '../../src/jobs/drain-report.js';

/**
 * The three durable drains and what they say.
 *
 * `Poller` already logs a cycle that throws. A dead letter does not throw — it
 * is the ordinary, documented outcome of a row that has used up a bounded retry
 * budget — so the most consequential thing these loops produce was the one
 * thing they did silently. What is asserted here is the level, because the
 * level is the whole decision: an operator filters on it, and a permanent loss
 * logged at `info` is a permanent loss nobody reads.
 */

interface Line {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly level: string;
  readonly message: string;
}

function recordingLogger() {
  const lines: Line[] = [];
  const at =
    (level: string) =>
    (fields: Readonly<Record<string, unknown>>, message: string) => {
      lines.push({ fields, level, message });
    };
  return {
    lines,
    logger: {
      debug: at('debug'),
      error: at('error'),
      fatal: at('fatal'),
      info: at('info'),
      trace: at('trace'),
      warn: at('warn'),
    },
  };
}

describe('a durable drain cycle', () => {
  it('says nothing at all when it claimed nothing', () => {
    const { lines, logger } = recordingLogger();
    reportDrainCycle(logger, 'outbox-relay', {
      claimed: 0,
      deadLettered: 0,
      retried: 0,
    });
    // Every few seconds, forever. A line here is how a log stops being read.
    expect(lines).toEqual([]);
  });

  it('reports an ordinary cycle at info', () => {
    const { lines, logger } = recordingLogger();
    reportDrainCycle(logger, 'outbox-relay', {
      claimed: 4,
      deadLettered: 0,
      retried: 0,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.fields.drain).toBe('outbox-relay');
  });

  it('warns when something was deferred, because it usually resolves itself', () => {
    const { lines, logger } = recordingLogger();
    reportDrainCycle(logger, 'billing-provider-events', {
      claimed: 4,
      deadLettered: 0,
      retried: 2,
    });
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.fields.retried).toBe(2);
  });

  it('errors when something was retired, because nothing else will pick it up', () => {
    const { lines, logger } = recordingLogger();
    reportDrainCycle(logger, 'identity-provider-events', {
      claimed: 4,
      deadLettered: 1,
      retried: 3,
    });
    // Permanent, and requiring somebody. A retry alongside it does not soften
    // that, so the dead letter decides the level.
    expect(lines[0]?.level).toBe('error');
    expect(lines[0]?.message).toBe(
      'durable work retired without being delivered',
    );
    expect(lines[0]?.fields.deadLettered).toBe(1);
  });

  it('carries counts and never an identifier', () => {
    const { lines, logger } = recordingLogger();
    reportDrainCycle(logger, 'outbox-relay', {
      claimed: 9,
      deadLettered: 2,
      retried: 1,
    });
    // How much is stuck and whether it is falling. Whose payment it was belongs
    // to the audit trail rather than to a line a wider audience reads.
    expect(Object.keys(lines[0]?.fields ?? {}).sort()).toEqual([
      'claimed',
      'deadLettered',
      'drain',
      'retried',
    ]);
  });
});
