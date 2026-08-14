import { sql, type SQL } from 'drizzle-orm';
import { text, timestamp, type PgColumn } from 'drizzle-orm/pg-core';

/**
 * Column and constraint vocabulary shared by every domain schema.
 *
 * These are mechanical helpers, not policy. A domain still declares its own
 * tables, its own allowed values, and its own invariants; this module only
 * stops each domain from writing a slightly different version of the same
 * `timestamptz` declaration or the same `in (...)` CHECK.
 */

export const timestamptz = (name: string) =>
  timestamp(name, { mode: 'date', withTimezone: true });

/** A lowercase SHA-256 hex digest. No plaintext credential is ever stored. */
export const digestColumn = (name: string) => text(name);

export const isHexDigest = (column: PgColumn): SQL =>
  sql`${column} ~ '^[0-9a-f]{64}$'`;

/** Two nullable columns that must be set and cleared together. */
export const nullablePairing = (first: PgColumn, second: PgColumn): SQL =>
  sql`(${first} is null) = (${second} is null)`;

/**
 * Values are compile-time constants, and a CHECK constraint is DDL where a
 * bound parameter is not usable, so the allowed set is inlined as SQL literals.
 * The shape guard makes an accidental quote or comment impossible to smuggle in.
 */
export function inList(column: PgColumn, values: readonly string[]): SQL {
  const literals = values
    .map((value) => {
      // Deliberately narrow: no quote, whitespace, semicolon, or comment
      // sequence can survive this, so an enumerated value can never carry SQL.
      if (!/^[a-z0-9][a-z0-9_/+.-]*$/u.test(value)) {
        throw new Error(`Unsafe enumerated constraint value: ${value}`);
      }
      return `'${value}'`;
    })
    .join(', ');
  return sql`${column} in (${sql.raw(literals)})`;
}

export function lengthBetween(
  column: PgColumn,
  minimum: number,
  maximum: number,
): SQL {
  return sql`char_length(${column}) between ${sql.raw(String(minimum))} and ${sql.raw(String(maximum))}`;
}
