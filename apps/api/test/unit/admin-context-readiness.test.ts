import { describe, expect, it } from 'bun:test';

import {
  AdminContextResolver,
  type PrivilegedReadinessPort,
} from '../../src/admin/context.js';
import type { CallerResolver } from '../../src/auth/caller.js';
import type { OperatorStanding } from '../../src/operations/service.js';

/**
 * Restart audit A3. ADR-0017 asks for two independently stored authenticators
 * before production privileged access, and AUTH reported whether an operator
 * met that without anything enforcing it. Where readiness applies, an operator
 * who has not met it is refused every capability and the first grant, however
 * fresh their assurance. Reading their own standing stays open, so the console
 * can still say what is missing.
 */

const now = new Date('2026-10-21T10:00:00.000Z');

const freshOperator = {
  absoluteExpiresAt: new Date(now.getTime() + 28_800_000),
  accountId: 'operator-account',
  assurance: 'phishing_resistant' as const,
  assuranceEstablishedAt: now,
  audience: 'platform_admin' as const,
  authenticatedAt: now,
  idleExpiresAt: new Date(now.getTime() + 900_000),
  sessionId: 'operator-session',
  transport: 'cookie' as const,
};

const caller = {
  resolve: () =>
    Promise.resolve({ context: freshOperator, kind: 'authenticated' as const }),
} as unknown as CallerResolver;

const standing = {
  standingOf: (): Promise<OperatorStanding> =>
    Promise.resolve({
      capabilities: ['creators.read'],
      role: 'super_admin',
      source: 'grant',
    }),
};

function readiness(ready: boolean): PrivilegedReadinessPort & {
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    productionReadiness: (accountId: string) => {
      asked.push(accountId);
      return Promise.resolve({ ready });
    },
  };
}

const request = {
  body: '',
  correlationId: 'correlation',
  rawBody: new Uint8Array(),
  request: new Request('https://admin.velora.test/v1/admin/creators'),
};

function resolver(port?: PrivilegedReadinessPort): AdminContextResolver {
  return new AdminContextResolver({
    caller,
    now: () => now,
    ...(port === undefined ? {} : { readiness: port }),
    standing,
  });
}

describe('privileged readiness at the Admin boundary', () => {
  it('refuses a capability to an operator short of the required authenticators', async () => {
    const port = readiness(false);
    const resolved = await resolver(port).resolve(request, 'creators.read');
    expect('failure' in resolved && resolved.failure.status).toBe(403);
    expect(port.asked).toEqual(['operator-account']);
  });

  it('admits a capability once the operator holds them', async () => {
    const resolved = await resolver(readiness(true)).resolve(
      request,
      'creators.read',
    );
    expect('context' in resolved).toBe(true);
  });

  it('applies no readiness where none is configured', async () => {
    const resolved = await resolver().resolve(request, 'creators.read');
    expect('context' in resolved).toBe(true);
  });

  it('refuses the first grant to an operator short of them', async () => {
    const resolved = await resolver(readiness(false)).resolveReadyStanding(
      request,
    );
    expect('failure' in resolved && resolved.failure.status).toBe(403);
  });

  it('still tells an unready operator their own standing', async () => {
    const resolved = await resolver(readiness(false)).resolveStanding(request);
    expect('context' in resolved).toBe(true);
  });
});
