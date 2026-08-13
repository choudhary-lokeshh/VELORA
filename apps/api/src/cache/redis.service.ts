import Redis from 'ioredis';

import type { HealthDependency } from '../database/database.service.js';

export class RedisHealthService implements HealthDependency {
  private readonly client: Redis;

  constructor(
    url: string,
    connectionName: 'ephemeral-readiness' | 'queue-readiness',
  ) {
    this.client = new Redis(url, {
      connectionName,
      connectTimeout: 1_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => Math.min(attempt * 100, 1_000),
    });
    this.client.on('error', () => undefined);
  }

  async isReady(): Promise<boolean> {
    try {
      if (this.client.status === 'wait' || this.client.status === 'end') {
        await this.client.connect();
      }
      await this.client.ping();
      return true;
    } catch {
      return false;
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
