import { describe, expect, it } from 'bun:test';

import {
  defaultJobRetryPolicy,
  JobRegistry,
  type JobRegistration,
} from '../../src/jobs/registry.js';
import { bullMqConnectionFromUrl } from '../../src/jobs/connection.js';
import { closeWorkers } from '../../src/jobs/runtime.js';
import { normalizeCorrelationId } from '../../src/http/correlation.js';
import { DenyAllOutboundHttp } from '../../src/security/ports.js';

const stringPayload = {
  parse(input: unknown) {
    if (typeof input !== 'string') throw new Error('Expected string');
    return input;
  },
};

function registration(
  overrides: Partial<JobRegistration<string>> = {},
): JobRegistration<string> {
  return {
    handler: () => Promise.resolve(),
    name: 'bootstrap.probe.v1',
    queue: 'bootstrap-probe',
    retry: defaultJobRetryPolicy,
    validate: stringPayload,
    version: 1,
    ...overrides,
  };
}

describe('platform seams', () => {
  it('denies outbound networking until an approved adapter is registered', async () => {
    const outbound = new DenyAllOutboundHttp();
    let outboundError: unknown;
    try {
      await outbound.execute({
        headers: {},
        method: 'GET',
        url: new URL('https://example.invalid'),
      });
    } catch (error) {
      outboundError = error;
    }
    expect(outboundError).toBeInstanceOf(Error);
    expect((outboundError as Error).message).toContain(
      'Outbound networking is not configured',
    );
  });

  it('enforces unique, versioned, bounded job registrations', () => {
    const registry = new JobRegistry();
    registry.register(registration());
    expect(() => {
      registry.register(registration());
    }).toThrow('Duplicate job registration');
    expect(() => {
      new JobRegistry().register(registration({ version: 2 }));
    }).toThrow('Job name and version must match');
    expect(() => {
      new JobRegistry().register(
        registration({
          retry: { attempts: 11, backoffMilliseconds: 30_000 },
        }),
      );
    }).toThrow('retry attempts');
  });

  it('parses only Redis URLs and decodes BullMQ credentials', () => {
    expect(
      bullMqConnectionFromUrl(
        'rediss://queue%40user:p%40ss%2Fword@redis.example:6380/4',
      ),
    ).toMatchObject({
      db: 4,
      host: 'redis.example',
      password: 'p@ss/word',
      port: 6380,
      username: 'queue@user',
    });
    expect(() => bullMqConnectionFromUrl('https://redis.example/1')).toThrow(
      'protocol is invalid',
    );
  });

  it('propagates worker shutdown failures promptly', async () => {
    let shutdownError: unknown;
    try {
      await closeWorkers([
        {
          close: () => Promise.reject(new Error('shutdown failed')),
        },
      ]);
    } catch (error) {
      shutdownError = error;
    }
    expect(shutdownError).toBeInstanceOf(Error);
    expect((shutdownError as Error).message).toContain('shutdown failed');
  });

  it('bounds untrusted correlation identifiers', () => {
    expect(normalizeCorrelationId('safe-request_01')).toBe('safe-request_01');
    expect(normalizeCorrelationId('line\nbreak')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/u,
    );
  });
});
