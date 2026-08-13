import Redis from 'ioredis';

import { digestValue } from './tokens.js';

/**
 * Ephemeral abuse throttling.
 *
 * Redis holds these counters because they are exactly the kind of disposable
 * state ADR-0016 allows it to hold. No security consequence depends on them
 * alone: recovery limits are additionally counted in PostgreSQL, single-use
 * rotation and family revocation are database invariants, and every credential
 * check happens against PostgreSQL. When Redis is unavailable the limiter says
 * so, and the caller records the degradation rather than turning an outage into
 * a lockout.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** True when the counter could not be consulted, so the answer is not a limit. */
  readonly degraded: boolean;
}

export interface RateLimiter {
  consume(input: {
    readonly bucket: string;
    readonly limit: number;
    readonly subject: string;
    readonly windowSeconds: number;
  }): Promise<RateLimitDecision>;
  close(): Promise<void>;
}

export class RedisRateLimiter implements RateLimiter {
  private readonly client: Redis;

  constructor(url: string) {
    this.client = new Redis(url, {
      connectionName: 'auth-rate-limit',
      connectTimeout: 1_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 100, 1_000),
    });
    this.client.on('error', () => undefined);
  }

  async consume(input: {
    readonly bucket: string;
    readonly limit: number;
    readonly subject: string;
    readonly windowSeconds: number;
  }): Promise<RateLimitDecision> {
    // The subject is digested so no address, device reference, or identity
    // subject is ever written to Redis in the clear.
    const window = Math.floor(Date.now() / (input.windowSeconds * 1000));
    const key = `auth:rl:${input.bucket}:${digestValue(input.subject)}:${String(window)}`;
    try {
      if (this.client.status === 'wait' || this.client.status === 'end') {
        await this.client.connect();
      }
      const used = await this.client.incr(key);
      if (used === 1) await this.client.expire(key, input.windowSeconds + 1);
      return { allowed: used <= input.limit, degraded: false };
    } catch {
      return { allowed: true, degraded: true };
    }
  }

  async close(): Promise<void> {
    if (this.client.status === 'ready') {
      await this.client.quit();
      return;
    }
    this.client.disconnect(false);
  }
}

/** Bounded in-memory limiter for tests and for single-process development. */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counters = new Map<string, number>();

  consume(input: {
    readonly bucket: string;
    readonly limit: number;
    readonly subject: string;
    readonly windowSeconds: number;
  }): Promise<RateLimitDecision> {
    const window = Math.floor(Date.now() / (input.windowSeconds * 1000));
    const key = `${input.bucket}:${digestValue(input.subject)}:${String(window)}`;
    const used = (this.counters.get(key) ?? 0) + 1;
    if (this.counters.size > 10_000) this.counters.clear();
    this.counters.set(key, used);
    return Promise.resolve({ allowed: used <= input.limit, degraded: false });
  }

  close(): Promise<void> {
    this.counters.clear();
    return Promise.resolve();
  }
}

/**
 * Attempt ceilings for authentication endpoints. These are abuse controls on a
 * mechanism, not the account-recovery quotas ADR-0017 locks; those live in
 * `./policy.js` and are additionally enforced in PostgreSQL.
 */
export const authAttemptLimits = {
  authenticate: { limit: 20, windowSeconds: 60 },
  recovery: { limit: 20, windowSeconds: 60 },
  refresh: { limit: 60, windowSeconds: 60 },
} as const;
