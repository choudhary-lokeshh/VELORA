import type { ServerConfig } from '@velora/config/server';
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql';

import {
  DatabaseAdmission,
  databaseAdmissionLimit,
  databaseAdmissionWaitMilliseconds,
  type DatabaseAdmissionSnapshot,
} from './admission.js';

export interface HealthDependency {
  close(): Promise<void>;
  isReady(): Promise<boolean>;
}

/**
 * Connections one process opens. Admission keeps in-flight work below this, so
 * the two numbers are read together: the difference is the margin that leaves
 * readiness probes and migrations a connection when request traffic is at its
 * bound.
 */
export const databasePoolMaxConnections = 10;

export interface DatabaseServiceOptions {
  readonly admissionLimit?: number;
  readonly admissionWaitMilliseconds?: number;
  readonly poolMax?: number;
}

export class DatabaseService implements HealthDependency {
  /**
   * The process-local bound on work that may touch this pool.
   *
   * Callers admit one unit at the edge — a request, a job, a poller cycle — and
   * everything that unit does inside its transaction runs under that one
   * permit. Admitting again further down would deadlock a unit against itself.
   */
  readonly admission: DatabaseAdmission;
  private readonly client: Bun.SQL;
  readonly database: BunSQLDatabase;
  readonly poolMax: number;

  constructor(config: ServerConfig, options: DatabaseServiceOptions = {}) {
    this.poolMax = options.poolMax ?? databasePoolMaxConnections;
    this.client = new Bun.SQL(config.DATABASE_URL, {
      connectionTimeout: 2,
      // Zero is Bun's "never reap". A pool that closes idle connections has to
      // re-establish them under whatever load arrives next, and establishing a
      // connection while the pool is also queueing callers is the state that
      // loses one permanently. Holding ten open costs ten backends and removes
      // the window; measured in the pool hardening study.
      idleTimeout: 0,
      max: this.poolMax,
    });
    this.database = drizzle(this.client);
    this.admission = new DatabaseAdmission({
      limit: options.admissionLimit ?? databaseAdmissionLimit,
      waitMilliseconds:
        options.admissionWaitMilliseconds ?? databaseAdmissionWaitMilliseconds,
    });
  }

  /**
   * Opens every pooled connection before the process reports ready.
   *
   * Reserving them all at once is what forces the pool to actually create
   * `poolMax` connections rather than serving the warm-up from one. A database
   * that cannot be reached fails here, which is where a startup should fail:
   * `connectionTimeout` bounds the attempt, and the message is the driver's,
   * carrying no credentials because the URL is never interpolated into it.
   */
  async warm(): Promise<void> {
    const attempts = await Promise.allSettled(
      Array.from({ length: this.poolMax }, async () => this.client.reserve()),
    );
    for (const attempt of attempts) {
      if (attempt.status === 'fulfilled') attempt.value.release();
    }
    const failed = attempts.find((attempt) => attempt.status === 'rejected');
    if (failed !== undefined) throw failed.reason;
  }

  async isReady(): Promise<boolean> {
    try {
      await this.client`select 1`;
      return true;
    } catch {
      return false;
    }
  }

  /** Pool and admission counters, safe to log. No identifiers, no payloads. */
  snapshot(): DatabaseAdmissionSnapshot & { readonly poolMax: number } {
    return { ...this.admission.snapshot(), poolMax: this.poolMax };
  }

  /**
   * Backends of this database that have been sitting inside a transaction.
   *
   * The observability seam for the driver defect this pool is hardened against:
   * a connection lost that way never leaves `idle in transaction`, so a count
   * that stays above zero across samples is the signal, not a spike. Deliberately
   * database-wide — a backend that has been abandoned is no longer attributable
   * to the pool that opened it.
   */
  async stalledTransactionCount(olderThanSeconds = 60): Promise<number> {
    const rows: { count: number }[] = await this.client`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and state in ('idle in transaction', 'idle in transaction (aborted)')
        and state_change < now() - make_interval(secs => ${olderThanSeconds})
    `;
    return rows[0]?.count ?? 0;
  }

  /** Sessions currently waiting on a pair advisory lock, for the same reason. */
  async advisoryLockWaiterCount(): Promise<number> {
    const rows: { count: number }[] = await this.client`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and wait_event = 'advisory'
    `;
    return rows[0]?.count ?? 0;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
