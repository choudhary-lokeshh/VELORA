import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';

/**
 * Database handles, named once.
 *
 * Every domain owns its own tables, but they all live in one PostgreSQL
 * database behind one pool, and a service contract that has to run inside its
 * caller's transaction needs a way to say so in a type. Naming the handle here
 * keeps that from becoming an import of one domain's repository module by
 * another purely to borrow a type alias.
 *
 * This is a transport type. It confers no permission to read another domain's
 * tables: what a contract may read is decided by the contract, not by the
 * handle it is handed.
 */
export type DatabaseHandle = BunSQLDatabase;

export type TransactionHandle = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];

export type Executor = DatabaseHandle | TransactionHandle;
