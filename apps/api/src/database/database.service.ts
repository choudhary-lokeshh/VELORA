import type { ServerConfig } from '@velora/config/server';
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql';

export interface HealthDependency {
  close(): Promise<void>;
  isReady(): Promise<boolean>;
}

export class DatabaseService implements HealthDependency {
  private readonly client: Bun.SQL;
  readonly database: BunSQLDatabase;

  constructor(config: ServerConfig) {
    this.client = new Bun.SQL(config.DATABASE_URL, {
      connectionTimeout: 2,
      idleTimeout: 30,
      max: 10,
    });
    this.database = drizzle(this.client);
  }

  async isReady(): Promise<boolean> {
    try {
      await this.client`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
