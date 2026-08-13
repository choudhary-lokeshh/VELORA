import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/bun-sql';

import type { AuthDatabase } from '../../src/auth/repository.js';

const applicationRoot = resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);

export function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for integration tests`);
  }
  return value;
}

/**
 * AUTH integration tests run against their own database so the bootstrap
 * migration suite keeps its guarantee of starting from a genuinely empty one.
 */
export async function provisionAuthDatabase(
  databaseName: string,
): Promise<string> {
  const administrative = requiredEnvironment('TEST_DATABASE_URL');
  const target = new URL(administrative);
  target.pathname = `/${databaseName}`;

  const sql = new Bun.SQL(administrative, { max: 1 });
  try {
    await sql.unsafe(`drop database if exists "${databaseName}" with (force)`);
    await sql.unsafe(`create database "${databaseName}"`);
  } finally {
    await sql.close();
  }

  const migration = Bun.spawn(['bun', 'run', 'scripts/migrate-database.ts'], {
    cwd: applicationRoot,
    env: { ...Bun.env, DATABASE_URL: target.toString() },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    migration.exited,
    new Response(migration.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`AUTH migration failed: ${stderr}`);
  }
  return target.toString();
}

export interface AuthTestDatabase {
  close(): Promise<void>;
  readonly drizzle: AuthDatabase;
  readonly sql: Bun.SQL;
  truncate(): Promise<void>;
  readonly url: string;
}

export function connectAuthDatabase(url: string): AuthTestDatabase {
  const sql = new Bun.SQL(url, { max: 20 });
  return {
    async close() {
      await sql.close();
    },
    drizzle: drizzle(sql),
    sql,
    async truncate() {
      await sql.unsafe(
        'truncate table auth_accounts, auth_recovery_rate_events restart identity cascade',
      );
    },
    url,
  };
}

/**
 * Bun's SQL tag is typed as `any`. Tests narrow it here, once, so every call
 * site stays fully typed instead of spreading assertions through the suite.
 */
export async function rowsOf<Row>(result: unknown): Promise<Row[]> {
  return (await (result as Promise<unknown>)) as Row[];
}

export async function execute(result: unknown): Promise<void> {
  await (result as Promise<unknown>);
}
